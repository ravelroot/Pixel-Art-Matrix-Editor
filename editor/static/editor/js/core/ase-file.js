// .aseprite / .ase reader and writer, implemented from the public file format specification
// (docs/ase-file-specs.md in the Aseprite repository). Little-endian binary: a 128-byte header, then frames
// made of chunks. Images are zlib streams (see zlib.js), so both directions are async.
import { PixelDocument, newId } from './document.js';
import { deflate, inflate, ByteWriter } from './zlib.js';
import { colorToHex, hexToColor } from './colors.js';

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'addition', 'subtract', 'divide',
];
export const TAG_DIRECTIONS = ['forward', 'reverse', 'pingpong', 'pingpong'];

const HEADER_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const CHUNK = {
  oldPalette: 0x0004,
  oldPalette64: 0x0011,
  layer: 0x2004,
  cel: 0x2005,
  tags: 0x2018,
  palette: 0x2019,
  userData: 0x2020,
  slice: 0x2022,
  tileset: 0x2023,
};
const LAYER_FLAGS = { visible: 1, editable: 2, background: 8, collapsed: 32, reference: 64 };

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }

  need(n) {
    if (this.p + n > this.bytes.length) throw new Error('Arquivo .ase incompleto ou corrompido.');
  }

  u8() {
    this.need(1);
    return this.bytes[this.p++];
  }

  u16() {
    this.need(2);
    const v = this.view.getUint16(this.p, true);
    this.p += 2;
    return v;
  }

  i16() {
    this.need(2);
    const v = this.view.getInt16(this.p, true);
    this.p += 2;
    return v;
  }

  u32() {
    this.need(4);
    const v = this.view.getUint32(this.p, true);
    this.p += 4;
    return v;
  }

  i32() {
    this.need(4);
    const v = this.view.getInt32(this.p, true);
    this.p += 4;
    return v;
  }

  take(n) {
    this.need(n);
    const b = this.bytes.subarray(this.p, this.p + n);
    this.p += n;
    return b;
  }

  string() {
    const n = this.u16();
    return new TextDecoder().decode(this.take(n));
  }
}

const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

// Converts raw PIXEL[] bytes of the sprite color depth into packed RGBA.
function toRGBA(raw, count, depth, palette, transparentIndex, opaqueIndex) {
  const out = new Uint32Array(count);
  if (depth === 32) {
    for (let i = 0, j = 0; i < count && j + 3 < raw.length; i++, j += 4) out[i] = rgba(raw[j], raw[j + 1], raw[j + 2], raw[j + 3]);
  } else if (depth === 16) {
    for (let i = 0, j = 0; i < count && j + 1 < raw.length; i++, j += 2) out[i] = rgba(raw[j], raw[j], raw[j], raw[j + 1]);
  } else {
    for (let i = 0; i < count && i < raw.length; i++) {
      const k = raw[i];
      out[i] = k === transparentIndex && !opaqueIndex ? 0 : (palette[k] ?? 0);
    }
  }
  return out;
}

function readTiles(raw, count, bits) {
  const out = new Uint32Array(count);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const size = bits / 8;
  for (let i = 0; i < count && (i + 1) * size <= raw.length; i++) {
    out[i] = size === 1 ? raw[i] : size === 2 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true);
  }
  return out;
}

// Parses the chunks without decompressing anything (synchronous part of the reader).
export function parseAseprite(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const r = new Reader(bytes);
  if (bytes.length < 128) throw new Error('Arquivo .ase incompleto ou corrompido.');
  r.u32();
  if (r.u16() !== HEADER_MAGIC) throw new Error('Este arquivo não é um .ase válido.');
  const header = { frames: r.u16(), width: r.u16(), height: r.u16(), depth: r.u16(), flags: r.u32(), speed: r.u16() };
  r.u32();
  r.u32();
  header.transparentIndex = r.u8();
  r.p = 128;
  if (![8, 16, 32].includes(header.depth)) throw new Error(`Profundidade de cor não suportada: ${header.depth} bits.`);
  const file = { header, layers: [], frames: [], cels: [], palette: [], tags: [], slices: [], tilesets: [] };
  let newPalette = false;
  let userTargets = [];
  for (let f = 0; f < header.frames; f++) {
    const frameStart = r.p;
    const frameSize = r.u32();
    if (r.u16() !== FRAME_MAGIC) throw new Error('Quadro inválido no arquivo .ase.');
    const oldCount = r.u16();
    const duration = r.u16();
    r.p += 2;
    const newCount = r.u32();
    const count = newCount || oldCount;
    file.frames.push({ duration });
    for (let c = 0; c < count; c++) {
      const start = r.p;
      const size = r.u32();
      const type = r.u16();
      if (size < 6) throw new Error('Bloco inválido no arquivo .ase.');
      const end = start + size;
      const targets = [];
      if (type === CHUNK.layer) {
        const flags = r.u16();
        const kind = r.u16();
        const level = r.u16();
        r.u16();
        r.u16();
        const blend = r.u16();
        const opacity = r.u8();
        r.p += 3;
        const name = r.string();
        const layer = { flags, kind, level, blend, opacity, name, tileset: kind === 2 ? r.u32() : null };
        file.layers.push(layer);
        targets.push(layer);
      } else if (type === CHUNK.cel) {
        const cel = { frame: f, layer: r.u16(), x: r.i16(), y: r.i16(), opacity: r.u8(), type: r.u16() };
        r.i16();
        r.p += 5;
        if (cel.type === 1) cel.link = r.u16();
        else if (cel.type === 0 || cel.type === 2) {
          cel.width = r.u16();
          cel.height = r.u16();
          cel.data = bytes.subarray(r.p, end);
        } else if (cel.type === 3) {
          cel.width = r.u16();
          cel.height = r.u16();
          cel.bits = r.u16();
          cel.idMask = r.u32();
          cel.xFlip = r.u32();
          cel.yFlip = r.u32();
          cel.dFlip = r.u32();
          r.p += 10;
          cel.data = bytes.subarray(r.p, end);
        }
        file.cels.push(cel);
      } else if (type === CHUNK.palette) {
        const total = r.u32();
        const from = r.u32();
        const to = r.u32();
        r.p += 8;
        if (!newPalette) file.palette = [];
        newPalette = true;
        file.palette.length = Math.max(file.palette.length, Math.min(total, 65536));
        for (let i = from; i <= to && r.p < end; i++) {
          const flags = r.u16();
          file.palette[i] = rgba(r.u8(), r.u8(), r.u8(), r.u8());
          if (flags & 1) r.string();
        }
      } else if ((type === CHUNK.oldPalette || type === CHUNK.oldPalette64) && !newPalette) {
        const scale = type === CHUNK.oldPalette64 ? (v) => Math.round((v * 255) / 63) : (v) => v;
        const packets = r.u16();
        let index = 0;
        for (let k = 0; k < packets; k++) {
          index += r.u8();
          const n = r.u8() || 256;
          for (let i = 0; i < n; i++) file.palette[index++] = rgba(scale(r.u8()), scale(r.u8()), scale(r.u8()));
        }
      } else if (type === CHUNK.tags) {
        const n = r.u16();
        r.p += 8;
        for (let k = 0; k < n; k++) {
          const tag = { from: r.u16(), to: r.u16(), direction: TAG_DIRECTIONS[r.u8()] ?? 'forward', repeat: r.u16() };
          r.p += 6;
          tag.color = colorToHex(rgba(r.u8(), r.u8(), r.u8()));
          r.u8();
          tag.name = r.string();
          file.tags.push(tag);
          targets.push(tag);
        }
      } else if (type === CHUNK.slice) {
        const keys = r.u32();
        const flags = r.u32();
        r.u32();
        const slice = { name: r.string(), color: '#0000ff', center: null, pivot: null };
        if (keys > 0) {
          r.u32();
          slice.x = r.i32();
          slice.y = r.i32();
          slice.width = r.u32();
          slice.height = r.u32();
          if (flags & 1) slice.center = { x: r.i32(), y: r.i32(), width: r.u32(), height: r.u32() };
          if (flags & 2) slice.pivot = { x: r.i32(), y: r.i32() };
          file.slices.push(slice);
          targets.push(slice);
        }
      } else if (type === CHUNK.tileset) {
        const tileset = { id: r.u32(), flags: r.u32(), count: r.u32(), tileWidth: r.u16(), tileHeight: r.u16() };
        r.i16();
        r.p += 14;
        tileset.name = r.string();
        if (tileset.flags & 1) r.p += 8;
        if (tileset.flags & 2) {
          const length = r.u32();
          tileset.data = r.take(Math.min(length, end - r.p));
        }
        file.tilesets.push(tileset);
        targets.push(tileset);
      } else if (type === CHUNK.userData) {
        const flags = r.u32();
        if (flags & 1) r.string();
        const target = userTargets.shift();
        if (flags & 2 && target && 'color' in target) target.color = colorToHex(rgba(r.u8(), r.u8(), r.u8()));
      }
      // Color profile, cel extra, external files, masks and anything unknown are skipped.
      if (type !== CHUNK.userData) userTargets = targets;
      r.p = end;
    }
    r.p = frameStart + frameSize;
  }
  return file;
}

function setLink(doc, layerId, sourceFrameId, frameId) {
  if (typeof doc.linkCels === 'function') doc.linkCels(layerId, [sourceFrameId, frameId]);
  else doc.cells.set(doc.key(frameId, layerId), doc.cell(sourceFrameId, layerId).slice());
}

// Reads a .aseprite/.ase file into a PixelDocument (async: the images are zlib streams).
export async function readAseprite(bytes, { name = 'Sem título' } = {}) {
  const file = parseAseprite(bytes);
  const { header } = file;
  const fps = header.speed > 0 ? Math.min(60, Math.max(1, Math.round(1000 / header.speed))) : 8;
  const doc = new PixelDocument(header.width, header.height, { name: String(name).slice(0, 120), fps, empty: true });
  const W = doc.width;
  const H = doc.height;
  doc.colorMode = header.depth === 8 ? 'indexed' : header.depth === 16 ? 'grayscale' : 'rgba';
  const palette = [...file.palette].map((c) => c ?? 0);
  doc.palette = palette.slice(0, 256);
  const defaultDuration = Math.round(1000 / fps);
  for (const fr of file.frames) {
    const d = fr.duration || defaultDuration;
    doc.frames.push({ id: newId('q'), duration: d === header.speed || d === defaultDuration ? null : d });
  }
  if (!doc.frames.length) doc.addFrame();

  // Tilesets: the image is tileWidth × (tileHeight × count), in the sprite color depth.
  const tilesets = new Map();
  for (const ts of file.tilesets) {
    const tiles = [];
    const n = ts.tileWidth * ts.tileHeight;
    if (ts.data) {
      const raw = await inflate(ts.data);
      const px = toRGBA(raw, n * ts.count, header.depth, palette, header.transparentIndex, false);
      for (let k = 0; k < ts.count; k++) tiles.push(px.slice(k * n, (k + 1) * n));
    }
    if (!tiles.length) tiles.push(new Uint32Array(n));
    tilesets.set(ts.id, { id: newId('t'), name: ts.name || `Tileset ${tilesets.size + 1}`, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, tiles });
  }
  doc.tilesets = [...tilesets.values()];
  if (!(doc.tileCells instanceof Map)) doc.tileCells = new Map();

  // Child levels → tree → flat list, bottom to top, with each group right above its children.
  const root = { children: [] };
  const stack = [root];
  file.layers.forEach((info, index) => {
    const node = { info, index, children: [] };
    const level = Math.min(info.level, stack.length - 1);
    stack[level].children.push(node);
    stack.length = level + 1;
    stack.push(node);
  });
  const byIndex = new Map();
  const opacityValid = Boolean(header.flags & 1);
  const emit = (node, parent) => {
    const { info } = node;
    const kind = info.kind === 1 ? 'group' : info.kind === 2 ? 'tilemap' : 'image';
    const layer = {
      id: newId('c'),
      name: String(info.name || `Camada ${doc.layers.length + 1}`).slice(0, 80),
      visible: Boolean(info.flags & LAYER_FLAGS.visible),
      opacity: opacityValid ? Math.round((info.opacity * 100) / 255) : 100,
      locked: !(info.flags & LAYER_FLAGS.editable),
      blendMode: BLEND_MODES[info.blend] ?? 'normal',
      kind,
      parent,
      collapsed: Boolean(info.flags & LAYER_FLAGS.collapsed),
      tileset: kind === 'tilemap' ? (tilesets.get(info.tileset)?.id ?? null) : null,
      reference: Boolean(info.flags & LAYER_FLAGS.reference),
    };
    byIndex.set(node.index, { layer, background: Boolean(info.flags & LAYER_FLAGS.background), tileset: tilesets.get(info.tileset) ?? null });
    for (const child of node.children) emit(child, layer.id);
    doc.layers.push(layer);
  };
  for (const node of root.children) emit(node, null);
  if (!doc.layers.length) doc.addLayer('Camada 1');

  const links = [];
  for (const cel of file.cels) {
    const target = byIndex.get(cel.layer);
    const frame = doc.frames[cel.frame];
    if (!target || !frame || target.layer.kind === 'group') continue;
    if (cel.type === 1) {
      if (doc.frames[cel.link]) links.push({ layerId: target.layer.id, from: doc.frames[cel.link].id, to: frame.id });
      continue;
    }
    if (![0, 2, 3].includes(cel.type) || !cel.data) continue;
    const raw = cel.type === 0 ? cel.data : await inflate(cel.data);
    let image;
    let iw;
    let ih;
    if (cel.type === 3) {
      const ts = target.tileset;
      if (!ts || ![8, 16, 32].includes(cel.bits)) continue;
      const tw = ts.tileWidth;
      const th = ts.tileHeight;
      const ids = readTiles(raw, cel.width * cel.height, cel.bits);
      iw = cel.width * tw;
      ih = cel.height * th;
      image = new Uint32Array(iw * ih);
      for (let ty = 0; ty < cel.height; ty++) {
        for (let tx = 0; tx < cel.width; tx++) {
          const v = ids[ty * cel.width + tx];
          const tile = ts.tiles[(v & cel.idMask) >>> 0];
          if (!tile) continue;
          const fx = Boolean(v & cel.xFlip);
          const fy = Boolean(v & cel.yFlip);
          const fd = Boolean(v & cel.dFlip);
          for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
              let sx = fd ? y : x;
              let sy = fd ? x : y;
              if (fx) sx = tw - 1 - sx;
              if (fy) sy = th - 1 - sy;
              if (sx < tw && sy < th) image[(ty * th + y) * iw + tx * tw + x] = tile[sy * tw + sx];
            }
          }
        }
      }
      // Tile indices, when the cel sits on the document tile grid.
      if (cel.x % tw === 0 && cel.y % th === 0) {
        const cols = Math.ceil(W / tw);
        const rows = Math.ceil(H / th);
        const grid = new Uint32Array(cols * rows);
        for (let ty = 0; ty < cel.height; ty++) {
          for (let tx = 0; tx < cel.width; tx++) {
            const gx = cel.x / tw + tx;
            const gy = cel.y / th + ty;
            if (gx >= 0 && gy >= 0 && gx < cols && gy < rows) grid[gy * cols + gx] = (ids[ty * cel.width + tx] & cel.idMask) >>> 0;
          }
        }
        doc.tileCells.set(doc.key(frame.id, target.layer.id), grid);
      }
    } else {
      iw = cel.width;
      ih = cel.height;
      image = toRGBA(raw, iw * ih, header.depth, palette, header.transparentIndex, target.background);
    }
    const dest = doc.cell(frame.id, target.layer.id);
    const opacity = cel.opacity;
    for (let y = 0; y < ih; y++) {
      const dy = cel.y + y;
      if (dy < 0 || dy >= H) continue;
      for (let x = 0; x < iw; x++) {
        const dx = cel.x + x;
        if (dx < 0 || dx >= W) continue;
        let c = image[y * iw + x];
        if (opacity < 255 && c >>> 24) c = ((c & 0x00ffffff) | (Math.round(((c >>> 24) * opacity) / 255) << 24)) >>> 0;
        dest[dy * W + dx] = c;
      }
    }
  }
  for (const l of links) {
    if (!doc.hasCell(l.from, l.layerId)) continue;
    setLink(doc, l.layerId, l.from, l.to);
  }

  doc.tags = file.tags
    .filter((t) => doc.frames[t.from] && doc.frames[t.to])
    .map((t) => ({ id: newId('t'), name: String(t.name || 'Tag').slice(0, 80), from: doc.frames[Math.min(t.from, t.to)].id, to: doc.frames[Math.max(t.from, t.to)].id, direction: t.direction, repeat: t.repeat, color: t.color }));
  doc.slices = file.slices.map((s) => ({ id: newId('s'), name: String(s.name || 'Slice').slice(0, 80), color: s.color, x: s.x, y: s.y, width: s.width, height: s.height, center: s.center, pivot: s.pivot }));
  return doc;
}

// ---------------------------------------------------------------------------------------------------------

function writeString(w, s) {
  const b = new TextEncoder().encode(String(s ?? ''));
  w.u16(b.length);
  w.bytes(b);
}

function contentBox(px, W, H) {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[y * W + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// Flat list (bottom → top, groups above their children) → file order (pre-order, group before children).
export function layerFileOrder(layers) {
  const ids = new Set(layers.map((l) => l.id));
  const children = new Map();
  for (const l of layers) {
    const p = l.parent && ids.has(l.parent) && l.parent !== l.id ? l.parent : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(l);
  }
  const out = [];
  const seen = new Set();
  const visit = (l, level) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    out.push({ layer: l, level });
    for (const c of children.get(l.id) ?? []) visit(c, level + 1);
  };
  for (const l of children.get(null) ?? []) visit(l, 0);
  for (const l of layers) visit(l, 0);
  return out;
}

function chunk(w, type, fill) {
  const start = w.length;
  w.u32(0);
  w.u16(type);
  fill();
  w.setU32(start, w.length - start);
}

// Writes the document as a 32-bit RGBA .aseprite file. compress: false writes raw cels (type 0);
// palette: colors for the palette chunk (default: doc.palette, or the colors in use).
export async function writeAseprite(doc, { compress = true, palette: colors = null } = {}) {
  const useZlib = compress && typeof CompressionStream === 'function';
  const W = doc.width;
  const H = doc.height;
  const fps = doc.fps || 8;
  const speed = Math.max(1, Math.round(1000 / fps));
  let palette = (colors?.length ? colors : doc.palette || []).slice(0, 256);
  if (!palette.length) palette = (doc.usedColors?.() ?? []).slice(0, 256);
  if (!palette.length) palette = [rgba(0, 0, 0)];
  const order = layerFileOrder(doc.layers);
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  const slices = Array.isArray(doc.slices) ? doc.slices : [];
  // Tilesets (images stacked vertically, always zlib) and the tilemap layers that can be written as tilemaps.
  const tilesets = [];
  for (const ts of Array.isArray(doc.tilesets) ? doc.tilesets : []) {
    const n = ts.tileWidth * ts.tileHeight;
    const tiles = ts.tiles?.length ? ts.tiles : [new Uint32Array(n)];
    const image = new Uint32Array(n * tiles.length);
    tiles.forEach((t, k) => image.set(t.subarray(0, n), k * n));
    tilesets.push({ ts, count: tiles.length, data: await deflate(new Uint8Array(image.buffer)) });
  }
  const tilesetIndex = (layer) => (layer.kind === 'tilemap' && layer.tileset != null ? tilesets.findIndex((t) => t.ts.id === layer.tileset) : -1);

  const w = new ByteWriter(4096);
  w.u32(0); // file size, patched at the end
  w.u16(HEADER_MAGIC);
  w.u16(doc.frames.length);
  w.u16(W);
  w.u16(H);
  w.u16(32);
  w.u32(1 | 2); // layer opacity valid; group blend/opacity valid
  w.u16(speed);
  w.u32(0);
  w.u32(0);
  w.u8(0); // transparent index (indexed only)
  w.zeros(3);
  w.u16(palette.length);
  w.u8(1);
  w.u8(1);
  w.u16(0);
  w.u16(0);
  w.u16(16);
  w.u16(16);
  w.zeros(84);

  // Linked cels: the first frame that uses a pixel buffer is written, the next ones point to it.
  const firstUse = new Map(order.map(({ layer }) => [layer.id, new Map()]));
  for (let f = 0; f < doc.frames.length; f++) {
    const frame = doc.frames[f];
    const frameStart = w.length;
    w.u32(0);
    w.u16(FRAME_MAGIC);
    const countAt = w.length;
    w.u16(0);
    w.u16(Math.max(1, Math.min(65535, Math.round(frame.duration || speed))));
    w.zeros(2);
    w.u32(0);
    let chunks = 0;
    if (f === 0) {
      chunk(w, CHUNK.palette, () => {
        w.u32(palette.length);
        w.u32(0);
        w.u32(palette.length - 1);
        w.zeros(8);
        for (const c of palette) {
          w.u16(0);
          w.u8(c & 255);
          w.u8((c >>> 8) & 255);
          w.u8((c >>> 16) & 255);
          w.u8(c >>> 24);
        }
      });
      chunks++;
      tilesets.forEach(({ ts, count, data }, i) => {
        chunk(w, CHUNK.tileset, () => {
          w.u32(i);
          w.u32(2 | 4); // tiles inside this file; tile 0 is the empty tile
          w.u32(count);
          w.u16(ts.tileWidth);
          w.u16(ts.tileHeight);
          w.u16(1);
          w.zeros(14);
          writeString(w, ts.name);
          w.u32(data.length);
          w.bytes(data);
        });
        chunks++;
      });
      for (const { layer, level } of order) {
        chunk(w, CHUNK.layer, () => {
          const flags =
            (layer.visible !== false ? LAYER_FLAGS.visible : 0) |
            (layer.locked ? 0 : LAYER_FLAGS.editable) |
            (layer.collapsed ? LAYER_FLAGS.collapsed : 0) |
            (layer.reference ? LAYER_FLAGS.reference : 0);
          w.u16(flags);
          const tileset = tilesetIndex(layer);
          w.u16(layer.kind === 'group' ? 1 : tileset >= 0 ? 2 : 0);
          w.u16(level);
          w.u16(0);
          w.u16(0);
          w.u16(Math.max(0, BLEND_MODES.indexOf(layer.blendMode || 'normal')));
          w.u8(Math.round((Math.min(100, Math.max(0, layer.opacity ?? 100)) * 255) / 100));
          w.zeros(3);
          writeString(w, layer.name);
          if (tileset >= 0) w.u32(tileset);
        });
        chunks++;
      }
      if (tags.length) {
        chunk(w, CHUNK.tags, () => {
          w.u16(tags.length);
          w.zeros(8);
          for (const t of tags) {
            const a = Math.max(0, doc.frameIndex(t.from));
            const b = Math.max(0, doc.frameIndex(t.to));
            const color = hexToColor(t.color || '#000000') ?? 0;
            w.u16(Math.min(a, b));
            w.u16(Math.max(a, b));
            w.u8(Math.max(0, ['forward', 'reverse', 'pingpong'].indexOf(t.direction)));
            w.u16(Math.max(0, Math.min(65535, Number(t.repeat) || 0)));
            w.zeros(6);
            w.u8(color & 255);
            w.u8((color >>> 8) & 255);
            w.u8((color >>> 16) & 255);
            w.u8(0);
            writeString(w, t.name);
          }
        });
        chunks++;
        for (const t of tags) {
          const color = hexToColor(t.color || '#000000') ?? 0;
          chunk(w, CHUNK.userData, () => {
            w.u32(2);
            w.u8(color & 255);
            w.u8((color >>> 8) & 255);
            w.u8((color >>> 16) & 255);
            w.u8(255);
          });
          chunks++;
        }
      }
      for (const s of slices) {
        chunk(w, CHUNK.slice, () => {
          w.u32(1);
          w.u32((s.center ? 1 : 0) | (s.pivot ? 2 : 0));
          w.u32(0);
          writeString(w, s.name);
          w.u32(0);
          w.u32(s.x | 0);
          w.u32(s.y | 0);
          w.u32(Math.max(0, s.width | 0));
          w.u32(Math.max(0, s.height | 0));
          if (s.center) {
            w.u32(s.center.x | 0);
            w.u32(s.center.y | 0);
            w.u32(Math.max(0, s.center.width | 0));
            w.u32(Math.max(0, s.center.height | 0));
          }
          if (s.pivot) {
            w.u32(s.pivot.x | 0);
            w.u32(s.pivot.y | 0);
          }
        });
        chunks++;
        const color = hexToColor(s.color || '#0000ff') ?? 0;
        chunk(w, CHUNK.userData, () => {
          w.u32(2);
          w.u8(color & 255);
          w.u8((color >>> 8) & 255);
          w.u8((color >>> 16) & 255);
          w.u8(255);
        });
        chunks++;
      }
    }
    for (let index = 0; index < order.length; index++) {
      const { layer } = order[index];
      if (layer.kind === 'group') continue;
      const key = doc.key(frame.id, layer.id);
      if (!doc.hasCell(frame.id, layer.id) && !doc.links?.has?.(key)) continue;
      const px = doc.cell(frame.id, layer.id);
      const box = contentBox(px, W, H);
      if (!box) continue;
      const uses = firstUse.get(layer.id);
      const source = uses.get(px);
      if (source !== undefined) {
        chunk(w, CHUNK.cel, () => {
          w.u16(index);
          w.u16(0);
          w.u16(0);
          w.u8(255);
          w.u16(1);
          w.u16(0);
          w.zeros(5);
          w.u16(source);
        });
        chunks++;
        continue;
      }
      uses.set(px, f);
      const tileset = tilesetIndex(layer);
      const grid = tileset >= 0 ? doc.tileCells?.get(key) : null;
      if (grid) {
        const { tileWidth, tileHeight } = tilesets[tileset].ts;
        const columns = Math.ceil(W / tileWidth);
        const rows = Math.ceil(H / tileHeight);
        const ids = new Uint32Array(columns * rows);
        ids.set(grid.subarray(0, ids.length));
        const data = await deflate(new Uint8Array(ids.buffer));
        chunk(w, CHUNK.cel, () => {
          w.u16(index);
          w.u16(0);
          w.u16(0);
          w.u8(255);
          w.u16(3);
          w.u16(0);
          w.zeros(5);
          w.u16(columns);
          w.u16(rows);
          w.u16(32);
          w.u32(0x1fffffff);
          w.u32(0x20000000);
          w.u32(0x40000000);
          w.u32(0x80000000);
          w.zeros(10);
          w.bytes(data);
        });
        chunks++;
        continue;
      }
      const raw = new Uint8Array(box.width * box.height * 4);
      for (let y = 0; y < box.height; y++) {
        const row = new Uint8Array(px.buffer, px.byteOffset + ((box.y + y) * W + box.x) * 4, box.width * 4);
        raw.set(row, y * box.width * 4);
      }
      const data = useZlib ? await deflate(raw) : raw;
      chunk(w, CHUNK.cel, () => {
        w.u16(index);
        w.u16(box.x);
        w.u16(box.y);
        w.u8(255);
        w.u16(useZlib ? 2 : 0);
        w.u16(0);
        w.zeros(5);
        w.u16(box.width);
        w.u16(box.height);
        w.bytes(data);
      });
      chunks++;
    }
    w.setU32(frameStart, w.length - frameStart);
    w.buffer[countAt] = Math.min(chunks, 0xffff) & 255;
    w.buffer[countAt + 1] = (Math.min(chunks, 0xffff) >>> 8) & 255;
    w.setU32(countAt + 6, chunks);
  }
  w.setU32(0, w.length);
  return w.result();
}

export const isAsepriteName = (name) => /\.(aseprite|ase)$/i.test(String(name || ''));
