import { PixelDocument, validateSide, LAYER_DEFAULTS } from './document.js';
import { encodeRLE, decodeRLE, toBase64, fromBase64 } from './rle.js';
import { hexToColor, colorToHex } from './colors.js';
import { isBlendMode } from './blend.js';
import { renderTilesets, MAX_TILES } from './tilemap.js';

export const FORMAT = 'crivo';
export const FORMAT_VERSION = 2;

// Crivo 1.x saved files with Portuguese keys (format version 1). They are converted to version 2 on read.
export function upgradeDocument(data) {
  if (!data || typeof data !== 'object' || !('formato' in data)) return data;
  return {
    format: data.formato,
    version: 2,
    name: data.nome,
    width: data.largura,
    height: data.altura,
    fps: data.fps,
    palette: data.paleta,
    layers: (data.camadas || []).map((c) => ({ id: c.id, name: c.nome, visible: c.visivel, opacity: c.opacidade, locked: c.bloqueada })),
    frames: (data.quadros || []).map((q) => ({ id: q.id, duration: q.duracao })),
    cells: (data.celulas || []).map((c) => ({ frame: c.quadro, layer: c.camada, rle: c.rle })),
  };
}

export function serialize(doc) {
  const cells = [];
  for (const q of doc.frames) {
    for (const c of doc.layers) {
      const k = doc.key(q.id, c.id);
      const link = doc.links?.get(k);
      const tiles = c.kind === 'tilemap' ? doc.tileCells?.get(k) : null;
      const hasTiles = Boolean(tiles?.some((v) => v !== 0));
      if (!doc.hasCell(q.id, c.id) && !hasTiles && !link) continue;
      const px = doc.hasCell(q.id, c.id) ? doc.cell(q.id, c.id) : new Uint32Array(doc.total);
      if (!px.some((v) => v !== 0) && !hasTiles && !link) continue;
      const cel = { frame: q.id, layer: c.id, rle: toBase64(encodeRLE(px)) };
      if (link) cel.link = link.slice(0, link.indexOf(':'));
      if (hasTiles) cel.tiles = toBase64(encodeRLE(tiles));
      cells.push(cel);
    }
  }
  const data = {
    format: FORMAT,
    version: FORMAT_VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    palette: doc.palette.map((c) => colorToHex(c)),
    layers: doc.layers.map((c) => {
      const layer = {
        id: c.id,
        name: c.name,
        visible: c.visible,
        opacity: c.opacity,
        locked: c.locked,
      };
      // 2.1.0 keys, written only when they differ from the default (2.0.0 files stay byte-identical).
      for (const [k, fallback] of Object.entries(LAYER_DEFAULTS)) if (c[k] !== undefined && c[k] !== fallback) layer[k] = c[k];
      return layer;
    }),
    frames: doc.frames.map((q) => ({ id: q.id, duration: q.duration })),
    cells,
  };
  if (doc.colorMode && doc.colorMode !== 'rgba') data.colorMode = doc.colorMode;
  if (doc.tags?.length) data.tags = doc.tags.map((t) => ({ id: t.id, name: t.name, from: t.from, to: t.to, direction: t.direction, repeat: t.repeat, color: t.color }));
  if (doc.slices?.length) {
    data.slices = doc.slices.map((s) => {
      const slice = { id: s.id, name: s.name, color: s.color, x: s.x, y: s.y, width: s.width, height: s.height };
      if (s.center) slice.center = { x: s.center.x, y: s.center.y, width: s.center.width, height: s.center.height };
      if (s.pivot) slice.pivot = { x: s.pivot.x, y: s.pivot.y };
      return slice;
    });
  }
  if (doc.tilesets?.length) {
    data.tilesets = doc.tilesets.map((t) => ({ id: t.id, name: t.name, tileWidth: t.tileWidth, tileHeight: t.tileHeight, tiles: t.tiles.map((tile) => toBase64(encodeRLE(tile))) }));
  }
  return data;
}

const DIRECTIONS = ['forward', 'reverse', 'pingpong'];
const COLOR_MODES = ['rgba', 'indexed', 'grayscale'];
const int = (v, min, max, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const hex = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const rect = (r, doc) =>
  r && typeof r === 'object' ? { x: int(r.x, -doc.width, doc.width * 2), y: int(r.y, -doc.height, doc.height * 2), width: int(r.width, 1, doc.width * 2, 1), height: int(r.height, 1, doc.height * 2, 1) } : null;

// Optional 2.1.0 data: tags, slices, tilesets, color mode. Invalid entries are dropped, never fatal.
function readExtras(doc, data) {
  if (COLOR_MODES.includes(data.colorMode)) doc.colorMode = data.colorMode;
  const ids = new Set();
  for (const t of Array.isArray(data.tilesets) ? data.tilesets : []) {
    const tw = int(t?.tileWidth, 0, 256, 0);
    const th = int(t?.tileHeight, 0, 256, 0);
    if (!t?.id || ids.has(String(t.id)) || !tw || !th) continue;
    ids.add(String(t.id));
    const tiles = (Array.isArray(t.tiles) ? t.tiles : []).slice(0, MAX_TILES).map((rle) => decodeRLE(fromBase64(String(rle)), tw * th));
    if (!tiles.length) tiles.push(new Uint32Array(tw * th));
    doc.tilesets.push({ id: String(t.id), name: String(t.name || 'Tileset').slice(0, 80), tileWidth: tw, tileHeight: th, tiles });
  }
  for (const t of Array.isArray(data.tags) ? data.tags : []) {
    const a = doc.frameIndex(t?.from);
    const b = doc.frameIndex(t?.to);
    if (a < 0 || b < 0) continue;
    doc.tags.push({
      id: String(t.id || 'g' + doc.tags.length),
      name: String(t.name || 'Tag').slice(0, 80),
      from: doc.frames[Math.min(a, b)].id,
      to: doc.frames[Math.max(a, b)].id,
      direction: DIRECTIONS.includes(t.direction) ? t.direction : 'forward',
      repeat: int(t.repeat, 0, 9999),
      color: hex(t.color, '#5d1c16'),
    });
  }
  for (const s of Array.isArray(data.slices) ? data.slices : []) {
    const r = rect(s, doc);
    if (!r) continue;
    const pivot = s.pivot && typeof s.pivot === 'object' ? { x: int(s.pivot.x, -MAX_PIVOT, MAX_PIVOT), y: int(s.pivot.y, -MAX_PIVOT, MAX_PIVOT) } : null;
    doc.slices.push({ id: String(s.id || 's' + doc.slices.length), name: String(s.name || 'Slice').slice(0, 80), color: hex(s.color, '#2f80ed'), ...r, center: rect(s.center, doc), pivot });
  }
}

const MAX_PIVOT = 4096;

function readLayerExtras(layer, c) {
  layer.blendMode = isBlendMode(c.blendMode) ? c.blendMode : 'normal';
  layer.kind = ['image', 'group', 'tilemap'].includes(c.kind) ? c.kind : 'image';
  layer.parent = c.parent ? String(c.parent) : null;
  layer.collapsed = Boolean(c.collapsed);
  layer.tileset = c.tileset ? String(c.tileset) : null;
  layer.reference = Boolean(c.reference);
  return layer;
}

// Parents must be groups placed above their children; anything else is flattened to the top level.
function fixLayerTree(doc) {
  doc.layers.forEach((c, i) => {
    if (!c.parent) return;
    const p = doc.layerIndex(c.parent);
    if (p <= i || doc.layers[p].kind !== 'group') c.parent = null;
  });
  for (const c of doc.layers) {
    if (c.kind === 'tilemap' && !doc.tilesets.some((t) => t.id === c.tileset)) {
      c.kind = 'image';
      c.tileset = null;
    }
    if (c.kind !== 'tilemap') c.tileset = null;
  }
  if (!doc.layers.some((c) => c.kind !== 'group')) doc.addLayer('Camada 1', 0, null);
}

export function deserialize(data) {
  if (typeof data === 'string') data = JSON.parse(data);
  data = upgradeDocument(data);
  if (!data || data.format !== FORMAT) throw new Error('Este arquivo não é um projeto do Crivo.');
  if (data.version > FORMAT_VERSION) throw new Error('Este projeto foi salvo por uma versão mais nova do Crivo.');
  const doc = new PixelDocument(validateSide(data.width), validateSide(data.height), {
    name: String(data.name || 'Sem título').slice(0, 120),
    fps: Math.min(60, Math.max(1, Number(data.fps) || 8)),
    empty: true,
  });
  doc.palette = (data.palette || []).map(hexToColor).filter((c) => c !== null);
  const ids = new Set();
  for (const c of data.layers || []) {
    if (!c.id || ids.has(c.id)) throw new Error('Camadas com identificador repetido.');
    ids.add(c.id);
    doc.layers.push(
      readLayerExtras(
        {
          id: String(c.id),
          name: String(c.name || 'Camada').slice(0, 80),
          visible: c.visible !== false,
          opacity: Math.min(100, Math.max(0, Number(c.opacity ?? 100))),
          locked: Boolean(c.locked),
        },
        c,
      ),
    );
  }
  for (const q of data.frames || []) {
    if (!q.id || ids.has(q.id)) throw new Error('Quadros com identificador repetido.');
    ids.add(q.id);
    doc.frames.push({ id: String(q.id), duration: q.duration ? Number(q.duration) : null });
  }
  if (!doc.layers.length) doc.addLayer('Camada 1');
  if (!doc.frames.length) doc.addFrame();
  readExtras(doc, data);
  fixLayerTree(doc);
  const links = [];
  for (const cel of data.cells || []) {
    if (doc.frameIndex(cel.frame) < 0 || doc.layerIndex(cel.layer) < 0) continue;
    const k = doc.key(cel.frame, cel.layer);
    doc.cells.set(k, decodeRLE(fromBase64(cel.rle), doc.total));
    const layer = doc.layer(cel.layer);
    if (cel.tiles && layer.kind === 'tilemap') {
      const t = doc.tilesets.find((x) => x.id === layer.tileset);
      const size = Math.ceil(doc.width / t.tileWidth) * Math.ceil(doc.height / t.tileHeight);
      const grid = decodeRLE(fromBase64(String(cel.tiles)), size);
      for (let i = 0; i < grid.length; i++) if (grid[i] >= t.tiles.length) grid[i] = 0;
      doc.tileCells.set(k, grid);
    }
    if (cel.link && cel.link !== cel.frame && doc.frameIndex(cel.link) >= 0) links.push([cel.layer, cel.frame, String(cel.link)]);
  }
  for (const [layerId, frameId, source] of links) {
    if (doc.links.has(doc.key(source, layerId))) continue;
    doc.linkCels(layerId, [frameId], source);
  }
  if (doc.tileCells.size) renderTilesets(doc);
  return doc;
}

export function fileNameFor(name, extension) {
  const base = String(name || 'crivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (base || 'crivo') + '.' + extension;
}
