import { PixelDocument, validateSide } from './document.js';
import { encodeRLE, decodeRLE, toBase64, fromBase64 } from './rle.js';
import { hexToColor, colorToHex } from './colors.js';

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
      if (!doc.hasCell(q.id, c.id)) continue;
      const px = doc.cell(q.id, c.id);
      if (!px.some((v) => v !== 0)) continue;
      cells.push({ frame: q.id, layer: c.id, rle: toBase64(encodeRLE(px)) });
    }
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    palette: doc.palette.map((c) => colorToHex(c)),
    layers: doc.layers.map((c) => ({
      id: c.id,
      name: c.name,
      visible: c.visible,
      opacity: c.opacity,
      locked: c.locked,
    })),
    frames: doc.frames.map((q) => ({ id: q.id, duration: q.duration })),
    cells,
  };
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
    doc.layers.push({
      id: String(c.id),
      name: String(c.name || 'Camada').slice(0, 80),
      visible: c.visible !== false,
      opacity: Math.min(100, Math.max(0, Number(c.opacity ?? 100))),
      locked: Boolean(c.locked),
    });
  }
  for (const q of data.frames || []) {
    if (!q.id || ids.has(q.id)) throw new Error('Quadros com identificador repetido.');
    ids.add(q.id);
    doc.frames.push({ id: String(q.id), duration: q.duration ? Number(q.duration) : null });
  }
  if (!doc.layers.length) doc.addLayer('Camada 1');
  if (!doc.frames.length) doc.addFrame();
  for (const cel of data.cells || []) {
    if (doc.frameIndex(cel.frame) < 0 || doc.layerIndex(cel.layer) < 0) continue;
    doc.cells.set(doc.key(cel.frame, cel.layer), decodeRLE(fromBase64(cel.rle), doc.total));
  }
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
