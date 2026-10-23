import { overlay } from './colors.js';
import { encodeRLE, decodeRLE } from './rle.js';

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

export class PixelDocument {
  constructor(width = 32, height = 32, options = {}) {
    this.name = options.name ?? 'Sem título';
    this.width = validateSide(width);
    this.height = validateSide(height);
    this.fps = options.fps ?? 8;
    this.palette = options.palette ? [...options.palette] : [];
    this.layers = [];
    this.frames = [];
    this.cells = new Map();
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
      pixels = new Uint32Array(this.total);
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

  addLayer(name, position = this.layers.length) {
    const layer = {
      id: newId('c'),
      name: name ?? `Camada ${this.layers.length + 1}`,
      visible: true,
      opacity: 100,
      locked: false,
    };
    this.layers.splice(position, 0, layer);
    return layer;
  }

  removeLayer(id) {
    if (this.layers.length <= 1) return false;
    const i = this.layerIndex(id);
    if (i < 0) return false;
    this.layers.splice(i, 1);
    for (const q of this.frames) this.cells.delete(this.key(q.id, id));
    return true;
  }

  moveLayer(id, delta) {
    const i = this.layerIndex(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    const [c] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, c);
    return true;
  }

  duplicateLayer(id) {
    const i = this.layerIndex(id);
    if (i < 0) return null;
    const original = this.layers[i];
    const copy = this.addLayer(`${original.name} (cópia)`, i + 1);
    copy.visible = original.visible;
    copy.opacity = original.opacity;
    for (const q of this.frames) {
      if (this.hasCell(q.id, id)) this.cells.set(this.key(q.id, copy.id), this.cell(q.id, id).slice());
    }
    return copy;
  }

  mergeDown(id) {
    const i = this.layerIndex(id);
    if (i <= 0) return false;
    const upper = this.layers[i];
    const lower = this.layers[i - 1];
    const opacity = upper.opacity / 100;
    for (const q of this.frames) {
      if (!this.hasCell(q.id, upper.id)) continue;
      const origin = this.cell(q.id, upper.id);
      const dest = this.cell(q.id, lower.id);
      for (let p = 0; p < origin.length; p++) {
        if (origin[p] >>> 24) dest[p] = overlay(dest[p], origin[p], opacity);
      }
    }
    this.removeLayer(upper.id);
    return true;
  }

  addFrame(position = this.frames.length, duration = null) {
    const frame = { id: newId('q'), duration };
    this.frames.splice(position, 0, frame);
    return frame;
  }

  duplicateFrame(id) {
    const i = this.frameIndex(id);
    if (i < 0) return null;
    const copy = this.addFrame(i + 1, this.frames[i].duration);
    for (const c of this.layers) {
      if (this.hasCell(id, c.id)) this.cells.set(this.key(copy.id, c.id), this.cell(id, c.id).slice());
    }
    return copy;
  }

  removeFrame(id) {
    if (this.frames.length <= 1) return false;
    const i = this.frameIndex(id);
    if (i < 0) return false;
    this.frames.splice(i, 1);
    for (const c of this.layers) this.cells.delete(this.key(id, c.id));
    return true;
  }

  moveFrame(id, delta) {
    const i = this.frameIndex(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.frames.length) return false;
    const [q] = this.frames.splice(i, 1);
    this.frames.splice(j, 0, q);
    return true;
  }

  composite(frameIndex, dest = new Uint32Array(this.total), { includeHidden = false } = {}) {
    dest.fill(0);
    const frame = this.frames[frameIndex];
    if (!frame) return dest;
    for (const layer of this.layers) {
      if (!layer.visible && !includeHidden) continue;
      if (!this.hasCell(frame.id, layer.id)) continue;
      const origin = this.cell(frame.id, layer.id);
      const opacity = layer.opacity / 100;
      if (opacity <= 0) continue;
      for (let p = 0; p < origin.length; p++) {
        const c = origin[p];
        const a = c >>> 24;
        if (a === 0) continue;
        if (a === 255 && opacity >= 1) dest[p] = c;
        else dest[p] = overlay(dest[p], c, opacity);
      }
    }
    return dest;
  }

  resize(newWidth, newHeight, anchorX = 0.5, anchorY = 0.5) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    const dx = Math.round((newWidth - this.width) * anchorX);
    const dy = Math.round((newHeight - this.height) * anchorY);
    for (const [k, origin] of this.cells) {
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
  }

  scale(newWidth, newHeight) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    for (const [k, origin] of this.cells) {
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
  }

  crop(x, y, newWidth, newHeight) {
    newWidth = validateSide(newWidth);
    newHeight = validateSide(newHeight);
    x = Math.round(x);
    y = Math.round(y);
    for (const [k, origin] of this.cells) {
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
  }

  usedColors() {
    const colors = new Map();
    for (let q = 0; q < this.frames.length; q++) {
      const px = this.composite(q);
      for (const c of px) if (c >>> 24 && !colors.has(c)) colors.set(c, colors.size);
    }
    return [...colors.keys()];
  }

  snapshot() {
    const cells = new Map();
    for (const [k, px] of this.cells) {
      let empty = true;
      for (let i = 0; i < px.length; i++) {
        if (px[i] !== 0) {
          empty = false;
          break;
        }
      }
      if (!empty) cells.set(k, encodeRLE(px));
    }
    return {
      name: this.name,
      width: this.width,
      height: this.height,
      fps: this.fps,
      layers: this.layers.map((c) => ({ ...c })),
      frames: this.frames.map((q) => ({ ...q })),
      cells,
    };
  }

  restore(state) {
    this.name = state.name;
    this.width = state.width;
    this.height = state.height;
    this.fps = state.fps;
    this.layers = state.layers.map((c) => ({ ...c }));
    this.frames = state.frames.map((q) => ({ ...q }));
    this.cells = new Map();
    for (const [k, bytes] of state.cells) this.cells.set(k, decodeRLE(bytes, this.total));
  }

  static snapshotBytes(state) {
    let total = 256 + state.layers.length * 96 + state.frames.length * 48;
    for (const bytes of state.cells.values()) total += bytes.byteLength + 64;
    return total;
  }
}
