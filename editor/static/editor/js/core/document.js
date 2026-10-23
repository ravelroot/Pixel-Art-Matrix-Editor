import { overlay } from './colors.js';
import { encodeRLE, decodeRLE } from './rle.js';
import { blendInto, blendPixel } from './blend.js';
import { fitTileGrids, renderTilesets } from './tilemap.js';

export const MAX_SIDE = 1024;

let sequence = 0;

export function newId(prefix) {
  sequence = (sequence + 1) % 1679616;
  return prefix + Date.now().toString(36) + sequence.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6);
}

export function validateSide(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > MAX_SIDE) throw new Error(`O tamanho precisa ficar entre 1 e ${MAX_SIDE}.`);
  return n;
}

// Default values of the layer fields added in 2.1.0 (writers omit them when they hold these values).
export const LAYER_DEFAULTS = { blendMode: 'normal', kind: 'image', parent: null, collapsed: false, tileset: null, reference: false };

function isEmpty(px) {
  for (let i = 0; i < px.length; i++) if (px[i] !== 0) return false;
  return true;
}

export class PixelDocument {
  constructor(width = 32, height = 32, options = {}) {
    this.name = options.name ?? 'Sem título';
    this.width = validateSide(width);
    this.height = validateSide(height);
    this.fps = options.fps ?? 8;
    this.palette = options.palette ? [...options.palette] : [];
    this.colorMode = 'rgba';
    this.layers = [];
    this.frames = [];
    this.cells = new Map();
    // Linked cels: cell key → key of the source cel (same layer). Linked keys share the same Uint32Array.
    this.links = new Map();
    this.tags = [];
    this.slices = [];
    this.tilesets = [];
    // Tilemap cels: cell key → Uint32Array of tile indices (columns × rows).
    this.tileCells = new Map();
    if (!options.empty) {
      this.addLayer('Camada 1');
      this.addFrame();
    }
  }

  get total() {
    return this.width * this.height;
  }

  key(frameId, layerId) {
    return frameId + ':' + layerId;
  }

  hasCell(frameId, layerId) {
    return this.cells.has(this.key(frameId, layerId));
  }

  cell(frameId, layerId) {
    const k = this.key(frameId, layerId);
    let pixels = this.cells.get(k);
    if (!pixels) {
      const source = this.links.get(k);
      pixels = source ? this.cells.get(source) : null;
      if (!pixels) {
        pixels = new Uint32Array(this.total);
        if (source) this.cells.set(source, pixels);
      }
      this.cells.set(k, pixels);
    }
    return pixels;
  }

  cellByKey(k) {
    const [q, c] = k.split(':');
    return this.cell(q, c);
  }

  layerIndex(id) {
    return this.layers.findIndex((c) => c.id === id);
  }

  frameIndex(id) {
    return this.frames.findIndex((q) => q.id === id);
  }

  layer(id) {
    return this.layers.find((c) => c.id === id) ?? null;
  }

  // ---- layers and groups ---------------------------------------------------------------------------------

  // `parent` undefined: the new layer joins the group of the layer just below the insertion point.
  addLayer(name, position = this.layers.length, parent = undefined, kind = 'image') {
    if (parent === undefined) parent = position > 0 ? (this.layers[position - 1]?.parent ?? null) : null;
    const layer = {
      id: newId('c'),
      name: name ?? (kind === 'group' ? `Grupo ${this.layers.filter((c) => c.kind === 'group').length + 1}` : `Camada ${this.layers.filter((c) => c.kind !== 'group').length + 1}`),
      visible: true,
      opacity: 100,
      locked: false,
      blendMode: 'normal',
      kind,
      parent,
      collapsed: false,
      tileset: null,
      reference: false,
    };
    this.layers.splice(position, 0, layer);
    return layer;
  }

  addGroup(name, position = this.layers.length, parent = undefined) {
    return this.addLayer(name ?? null, position, parent, 'group');
  }

  isGroup(id) {
    return this.layer(id)?.kind === 'group';
  }

  // True when layer `id` is inside group `groupId` (at any depth).
  isDescendant(id, groupId) {
    let c = this.layer(id);
    const seen = new Set();
    while (c && c.parent && !seen.has(c.id)) {
      seen.add(c.id);
      if (c.parent === groupId) return true;
      c = this.layer(c.parent);
    }
    return false;
  }

  depth(id) {
    let d = 0;
    let c = this.layer(id);
    while (c?.parent && d < 64) {
      d++;
      c = this.layer(c.parent);
    }
    return d;
  }

  children(groupId) {
    return this.layers.filter((c) => c.parent === groupId);
  }

  // A layer is drawn only when it and every group above it are visible.
  isVisible(id) {
    let c = this.layer(id);
    let guard = 0;
    while (c && guard++ < 64) {
      if (!c.visible) return false;
      c = c.parent ? this.layer(c.parent) : null;
    }
    return true;
  }

  // Index range [start, end] of a layer and everything inside it (a group's children sit right below it).
  block(id) {
    const end = this.layerIndex(id);
    if (end < 0) return null;
    let start = end;
    if (this.layers[end].kind === 'group') while (start > 0 && this.isDescendant(this.layers[start - 1].id, id)) start--;
    return [start, end];
  }

  dropKey(k) {
    if (this.links.has(k)) {
      this.links.delete(k);
    } else {
      const dependents = [...this.links].filter(([, s]) => s === k).map(([d]) => d);
      if (dependents.length) {
        const [first, ...rest] = dependents;
        this.links.delete(first);
        for (const d of rest) this.links.set(d, first);
      }
    }
    this.cells.delete(k);
    this.tileCells.delete(k);
  }

  removeLayer(id) {
    const range = this.block(id);
    if (!range) return false;
    const [start, end] = range;
    const removed = this.layers.slice(start, end + 1);
    const remaining = this.layers.length - removed.length;
    const drawable = this.layers.filter((c, i) => (i < start || i > end) && c.kind !== 'group').length;
    if (remaining < 1 || drawable < 1) return false;
    this.layers.splice(start, removed.length);
    for (const c of removed) for (const q of this.frames) this.dropKey(this.key(q.id, c.id));
    return true;
  }

  // Moves a layer (with its children, when it is a group) one step up (+1) or down (-1) among its siblings.
  // Reaching the edge of its group takes it out of the group; meeting an expanded group puts it inside.
  moveLayer(id, delta) {
    const range = this.block(id);
    if (!range) return false;
    const layer = this.layer(id);
    const [start, end] = range;
    const length = end - start + 1;
    const moveBlock = (to) => {
      const items = this.layers.splice(start, length);
      this.layers.splice(to, 0, ...items);
    };
    if (delta > 0) {
      const next = this.layers[end + 1];
      if (!next) return false;
      if (next.id === layer.parent) {
        layer.parent = next.parent;
        moveBlock(end + 1 - length + 1);
        return true;
      }
      // The sibling above: the item whose parent is ours, owning the layer `next`.
      let sibling = next;
      while (sibling && sibling.parent !== layer.parent) sibling = this.layer(sibling.parent);
      if (!sibling) return false;
      if (sibling.kind === 'group' && !sibling.collapsed) {
        layer.parent = sibling.id;
        return true;
      }
      const siblingEnd = this.layerIndex(sibling.id);
      moveBlock(siblingEnd - length + 1);
      return true;
    }
    if (delta < 0) {
      const previous = this.layers[start - 1];
      const insideParent = previous && (layer.parent === null || this.isDescendant(previous.id, layer.parent));
      if (!insideParent) {
        if (!layer.parent) return false;
        layer.parent = this.layer(layer.parent)?.parent ?? null;
        return true;
      }
      if (previous.kind === 'group' && previous.parent === layer.parent && !previous.collapsed) {
        layer.parent = previous.id;
        moveBlock(start - 1);
        return true;
      }
      // Sibling below: `previous` is its top (a layer or a group header).
      const [siblingStart] = this.block(previous.id);
      moveBlock(siblingStart);
      return true;
    }
    return false;
  }

  // Wraps the layer (with its children) in a new group placed right above it.
  groupLayer(id, name = null) {
    const range = this.block(id);
    if (!range) return null;
    const layer = this.layer(id);
    const group = this.addGroup(name, range[1] + 1, layer.parent);
    layer.parent = group.id;
    return group;
  }

  // Removes the group header and gives its children to the group's parent.
  ungroup(id) {
    const group = this.layer(id);
    if (!group || group.kind !== 'group') return false;
    for (const c of this.layers) if (c.parent === id) c.parent = group.parent;
    this.layers.splice(this.layerIndex(id), 1);
    for (const q of this.frames) this.dropKey(this.key(q.id, id));
    return true;
  }

  duplicateLayer(id) {
    const range = this.block(id);
    if (!range) return null;
    const [start, end] = range;
    const originals = this.layers.slice(start, end + 1);
    const ids = new Map(originals.map((c) => [c.id, newId('c')]));
    const copies = originals.map((c) => ({
      ...c,
      id: ids.get(c.id),
      name: c.id === id ? `${c.name} (cópia)` : c.name,
      parent: ids.get(c.parent) ?? c.parent,
    }));
    this.layers.splice(end + 1, 0, ...copies);
    for (const c of originals) {
      const copyId = ids.get(c.id);
      for (const q of this.frames) {
        const k = this.key(q.id, c.id);
        const nk = this.key(q.id, copyId);
        const source = this.links.get(k);
        if (source) {
          this.links.set(nk, source.slice(0, source.indexOf(':') + 1) + copyId);
          continue;
        }
        if (this.cells.has(k)) this.cells.set(nk, this.cells.get(k).slice());
        if (this.tileCells.has(k)) this.tileCells.set(nk, this.tileCells.get(k).slice());
      }
    }
    this.relink();
    return copies.find((c) => c.id === ids.get(id));
  }

  mergeDown(id) {
    const i = this.layerIndex(id);
    if (i <= 0) return false;
    const upper = this.layers[i];
    const lower = this.layers[i - 1];
    if (upper.kind !== 'image' || lower.kind !== 'image') throw new Error('Só dá para mesclar duas camadas de imagem (grupos e camadas de tiles ficam de fora).');
    const opacity = upper.opacity / 100;
    for (const q of this.frames) this.unlinkCel(q.id, lower.id);
    for (const q of this.frames) {
      if (!this.hasCell(q.id, upper.id)) continue;
      const origin = this.cell(q.id, upper.id);
      const dest = this.cell(q.id, lower.id);
      const mode = upper.blendMode || 'normal';
      for (let p = 0; p < origin.length; p++) {
        if (!(origin[p] >>> 24)) continue;
        dest[p] = mode === 'normal' ? overlay(dest[p], origin[p], opacity) : blendPixel(mode, dest[p], origin[p], opacity);
      }
    }
    this.removeLayer(upper.id);
    return true;
  }

  // ---- linked cels -----------------------------------------------------------------------------------------

  sourceKey(k) {
    return this.links.get(k) ?? k;
  }

  isLinked(frameId, layerId) {
    const k = this.key(frameId, layerId);
    if (this.links.has(k)) return true;
    for (const s of this.links.values()) if (s === k) return true;
    return false;
  }

  // Links the cel of `layerId` in every frame of `frameIds` to the cel of `sourceFrameId` (default: the first).
  linkCels(layerId, frameIds, sourceFrameId = frameIds[0]) {
    const layer = this.layer(layerId);
    if (!layer || layer.kind === 'group') return false;
    const source = this.sourceKey(this.key(sourceFrameId, layerId));
    const pixels = this.cell(...source.split(':'));
    const tiles = this.tileCells.get(source);
    let changed = false;
    for (const f of frameIds) {
      const k = this.key(f, layerId);
      if (k === source || this.links.get(k) === source || this.frameIndex(f) < 0) continue;
      // Cels that followed k now follow the new source as well.
      for (const [d, s] of this.links) if (s === k) this.links.set(d, source);
      this.links.delete(k);
      this.links.set(k, source);
      changed = true;
    }
    for (const [d, s] of this.links) {
      if (s !== source) continue;
      this.cells.set(d, pixels);
      if (tiles) this.tileCells.set(d, tiles);
    }
    return changed;
  }

  unlinkCel(frameId, layerId) {
    const k = this.key(frameId, layerId);
    if (this.links.has(k)) {
      this.links.delete(k);
      if (this.cells.has(k)) this.cells.set(k, this.cells.get(k).slice());
      if (this.tileCells.has(k)) this.tileCells.set(k, this.tileCells.get(k).slice());
      return true;
    }
    const dependents = [...this.links].filter(([, s]) => s === k).map(([d]) => d);
    if (!dependents.length) return false;
    const [first, ...rest] = dependents;
    this.links.delete(first);
    for (const d of rest) this.links.set(d, first);
    if (this.cells.has(k)) this.cells.set(k, this.cells.get(k).slice());
    if (this.tileCells.has(k)) this.tileCells.set(k, this.tileCells.get(k).slice());
    return true;
  }

  // Makes every linked key point to its source's arrays again (after operations that rebuild the cells).
  relink() {
    for (const [k, source] of [...this.links]) {
      const [q, c] = source.split(':');
      if (this.frameIndex(q) < 0 || this.layerIndex(c) < 0 || k === source) {
        this.links.delete(k);
        continue;
      }
      this.cells.set(k, this.cell(q, c));
      if (this.tileCells.has(source)) this.tileCells.set(k, this.tileCells.get(source));
    }
  }

  // ---- frames -------------------------------------------------------------------------------------------------

  addFrame(position = this.frames.length, duration = null) {
    const frame = { id: newId('q'), duration };
    this.frames.splice(position, 0, frame);
    return frame;
  }

  // New frame whose cels are linked to the cels of `sourceFrameId`.
  addLinkedFrame(sourceFrameId, position = this.frameIndex(sourceFrameId) + 1) {
    const i = this.frameIndex(sourceFrameId);
    if (i < 0) return null;
    const frame = this.addFrame(position, this.frames[i].duration);
    for (const c of this.layers) {
      if (c.kind === 'group') continue;
      this.linkCels(c.id, [sourceFrameId, frame.id], sourceFrameId);
    }
    return frame;
  }

  duplicateFrame(id) {
    const i = this.frameIndex(id);
    if (i < 0) return null;
    const copy = this.addFrame(i + 1, this.frames[i].duration);
    for (const c of this.layers) {
      if (this.hasCell(id, c.id)) this.cells.set(this.key(copy.id, c.id), this.cell(id, c.id).slice());
      const k = this.key(id, c.id);
      if (this.tileCells.has(k)) this.tileCells.set(this.key(copy.id, c.id), this.tileCells.get(k).slice());
    }
    return copy;
  }

  removeFrame(id) {
    if (this.frames.length <= 1) return false;
    const i = this.frameIndex(id);
    if (i < 0) return false;
    this.tags = this.tags.filter((t) => {
      if (t.from === id && t.to === id) return false;
      if (t.from === id) t.from = this.frames[i + 1]?.id ?? t.to;
      if (t.to === id) t.to = this.frames[i - 1]?.id ?? t.from;
      return true;
    });
    this.frames.splice(i, 1);
    for (const c of this.layers) this.dropKey(this.key(id, c.id));
    return true;
  }

  moveFrame(id, delta) {
    const i = this.frameIndex(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.frames.length) return false;
    const [q] = this.frames.splice(i, 1);
    this.frames.splice(j, 0, q);
    for (const t of this.tags) if (this.frameIndex(t.from) > this.frameIndex(t.to)) [t.from, t.to] = [t.to, t.from];
    return true;
  }

  // ---- tags and slices ------------------------------------------------------------------------------------------

  addTag({ name, from, to, direction = 'forward', repeat = 0, color = '#5d1c16' } = {}) {
    let a = this.frameIndex(from);
    let b = this.frameIndex(to);
    if (a < 0 || b < 0) throw new Error('A tag precisa começar e terminar em quadros existentes.');
    if (a > b) [a, b] = [b, a];
    const tag = { id: newId('g'), name: name || `Tag ${this.tags.length + 1}`, from: this.frames[a].id, to: this.frames[b].id, direction, repeat, color };
    this.tags.push(tag);
    return tag;
  }

  // The innermost tag that contains the frame (the one with the smallest range).
  tagAt(frameIndex) {
    let best = null;
    for (const t of this.tags) {
      const a = this.frameIndex(t.from);
      const b = this.frameIndex(t.to);
      if (frameIndex < a || frameIndex > b) continue;
      if (!best || b - a < this.frameIndex(best.to) - this.frameIndex(best.from)) best = t;
    }
    return best;
  }

  addSlice({ name, color = '#2f80ed', x = 0, y = 0, width = this.width, height = this.height, center = null, pivot = null } = {}) {
    const slice = { id: newId('s'), name: name || `Slice ${this.slices.length + 1}`, color, x, y, width, height, center, pivot };
    this.slices.push(slice);
    return slice;
  }

  // ---- composition -----------------------------------------------------------------------------------------

  // Groups composite their children: a group in normal mode at 100% passes them straight through; otherwise
  // the children are composited into a separate buffer that is then blended with the group's mode and opacity.
  composite(frameIndex, dest = new Uint32Array(this.total), { includeHidden = false, includeReference = false } = {}) {
    dest.fill(0);
    const frame = this.frames[frameIndex];
    if (!frame) return dest;
    const byParent = new Map();
    const ids = new Set(this.layers.map((c) => c.id));
    for (const c of this.layers) {
      const p = c.parent && ids.has(c.parent) ? c.parent : null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(c);
    }
    const draw = (parent, target, depth) => {
      for (const layer of byParent.get(parent) ?? []) {
        if (!layer.visible && !includeHidden) continue;
        if (layer.reference && !includeReference) continue;
        const opacity = layer.opacity / 100;
        if (opacity <= 0) continue;
        if (layer.kind === 'group') {
          if (depth > 32) continue;
          if ((layer.blendMode || 'normal') === 'normal' && layer.opacity >= 100) draw(layer.id, target, depth + 1);
          else blendInto(target, draw(layer.id, new Uint32Array(this.total), depth + 1), layer.blendMode, opacity);
          continue;
        }
        if (!this.hasCell(frame.id, layer.id)) continue;
        blendInto(target, this.cell(frame.id, layer.id), layer.blendMode, opacity);
      }
      return target;
    };
    return draw(null, dest, 0);
  }

  // ---- geometry ------------------------------------------------------------------------------------------------

  afterGeometry(oldWidth) {
    this.relink();
    if (this.tileCells.size) fitTileGrids(this, oldWidth);
  }

  resize(newWidth, newHeight, anchorX = 0.5, anchorY = 0.5) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    const oldWidth = this.width;
    const dx = Math.round((newWidth - this.width) * anchorX);
    const dy = Math.round((newHeight - this.height) * anchorY);
    for (const [k, origin] of this.cells) {
      if (this.links.has(k)) continue;
      const dest = new Uint32Array(newWidth * newHeight);
      for (let y = 0; y < this.height; y++) {
        const ny = y + dy;
        if (ny < 0 || ny >= newHeight) continue;
        for (let x = 0; x < this.width; x++) {
          const nx = x + dx;
          if (nx < 0 || nx >= newWidth) continue;
          dest[ny * newWidth + nx] = origin[y * this.width + x];
        }
      }
      this.cells.set(k, dest);
    }
    this.width = newWidth;
    this.height = newHeight;
    this.afterGeometry(oldWidth);
  }

  scale(newWidth, newHeight) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    const oldWidth = this.width;
    for (const [k, origin] of this.cells) {
      if (this.links.has(k)) continue;
      const dest = new Uint32Array(newWidth * newHeight);
      for (let y = 0; y < newHeight; y++) {
        const sy = Math.min(this.height - 1, Math.floor(((y + 0.5) * this.height) / newHeight));
        for (let x = 0; x < newWidth; x++) {
          const sx = Math.min(this.width - 1, Math.floor(((x + 0.5) * this.width) / newWidth));
          dest[y * newWidth + x] = origin[sy * this.width + sx];
        }
      }
      this.cells.set(k, dest);
    }
    this.width = newWidth;
    this.height = newHeight;
    this.afterGeometry(oldWidth);
  }

  crop(x, y, newWidth, newHeight) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    const oldWidth = this.width;
    x = Math.round(x);
    y = Math.round(y);
    for (const [k, origin] of this.cells) {
      if (this.links.has(k)) continue;
      const dest = new Uint32Array(newWidth * newHeight);
      for (let ny = 0; ny < newHeight; ny++) {
        const sy = ny + y;
        if (sy < 0 || sy >= this.height) continue;
        for (let nx = 0; nx < newWidth; nx++) {
          const sx = nx + x;
          if (sx < 0 || sx >= this.width) continue;
          dest[ny * newWidth + nx] = origin[sy * this.width + sx];
        }
      }
      this.cells.set(k, dest);
    }
    this.width = newWidth;
    this.height = newHeight;
    this.afterGeometry(oldWidth);
  }

  flipCell(pixels, axis) {
    const L = this.width;
    const A = this.height;
    const copy = pixels.slice();
    for (let y = 0; y < A; y++) {
      for (let x = 0; x < L; x++) {
        const sx = axis === 'horizontal' ? L - 1 - x : x;
        const sy = axis === 'vertical' ? A - 1 - y : y;
        pixels[y * L + x] = copy[sy * L + sx];
      }
    }
  }

  rotate(dir = 1) {
    const L = this.width;
    const A = this.height;
    for (const [k, origin] of this.cells) {
      if (this.links.has(k)) continue;
      const dest = new Uint32Array(L * A);
      for (let y = 0; y < A; y++) {
        for (let x = 0; x < L; x++) {
          const nx = dir > 0 ? A - 1 - y : y;
          const ny = dir > 0 ? x : L - 1 - x;
          dest[ny * A + nx] = origin[y * L + x];
        }
      }
      this.cells.set(k, dest);
    }
    this.width = A;
    this.height = L;
    this.afterGeometry(L);
  }

  usedColors() {
    const colors = new Map();
    for (let q = 0; q < this.frames.length; q++) {
      const px = this.composite(q);
      for (const c of px) if (c >>> 24 && !colors.has(c)) colors.set(c, colors.size);
    }
    return [...colors.keys()];
  }

  // ---- history -------------------------------------------------------------------------------------------------

  snapshot() {
    const cells = new Map();
    for (const [k, px] of this.cells) {
      if (this.links.has(k)) continue;
      if (!isEmpty(px)) cells.set(k, encodeRLE(px));
    }
    const tileCells = new Map();
    for (const [k, grid] of this.tileCells) if (!this.links.has(k)) tileCells.set(k, encodeRLE(grid));
    return {
      name: this.name,
      width: this.width,
      height: this.height,
      fps: this.fps,
      colorMode: this.colorMode,
      layers: this.layers.map((c) => ({ ...c })),
      frames: this.frames.map((q) => ({ ...q })),
      cells,
      links: new Map(this.links),
      tags: this.tags.map((t) => ({ ...t })),
      slices: this.slices.map((s) => ({ ...s, center: s.center ? { ...s.center } : null, pivot: s.pivot ? { ...s.pivot } : null })),
      tilesets: this.tilesets.map((t) => ({ ...t, tiles: t.tiles.map((tile) => encodeRLE(tile)) })),
      tileCells,
    };
  }

  restore(state) {
    this.name = state.name;
    this.width = state.width;
    this.height = state.height;
    this.fps = state.fps;
    this.colorMode = state.colorMode ?? 'rgba';
    this.layers = state.layers.map((c) => ({ ...c }));
    this.frames = state.frames.map((q) => ({ ...q }));
    this.cells = new Map();
    for (const [k, bytes] of state.cells) this.cells.set(k, decodeRLE(bytes, this.total));
    this.links = new Map(state.links ?? []);
    this.tags = (state.tags ?? []).map((t) => ({ ...t }));
    this.slices = (state.slices ?? []).map((s) => ({ ...s, center: s.center ? { ...s.center } : null, pivot: s.pivot ? { ...s.pivot } : null }));
    this.tilesets = (state.tilesets ?? []).map((t) => ({ ...t, tiles: t.tiles.map((bytes) => decodeRLE(bytes, t.tileWidth * t.tileHeight)) }));
    this.tileCells = new Map();
    for (const [k, bytes] of state.tileCells ?? []) {
      const layer = this.layer(k.slice(k.indexOf(':') + 1));
      const tileset = this.tilesets.find((t) => t.id === layer?.tileset);
      if (tileset) this.tileCells.set(k, decodeRLE(bytes, Math.ceil(this.width / tileset.tileWidth) * Math.ceil(this.height / tileset.tileHeight)));
    }
    this.relink();
  }

  // Re-renders the pixels of every tilemap cel (after loading or editing tiles).
  renderTiles() {
    renderTilesets(this);
  }

  static snapshotBytes(state) {
    let total = 256 + state.layers.length * 96 + state.frames.length * 48;
    for (const bytes of state.cells.values()) total += bytes.byteLength + 64;
    for (const bytes of state.tileCells?.values() ?? []) total += bytes.byteLength + 64;
    for (const t of state.tilesets ?? []) for (const bytes of t.tiles) total += bytes.byteLength + 16;
    total += ((state.tags?.length ?? 0) + (state.slices?.length ?? 0) + (state.links?.size ?? 0)) * 96;
    return total;
  }
}
