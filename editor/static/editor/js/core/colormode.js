// Document color modes: 'rgba' (free colors), 'indexed' (every pixel is a palette color) and 'grayscale'.
// Pure functions on Uint32Array matrices (packed RGBA); the alpha of each pixel is always kept.
import { unpack, pack, rgbToOklab, oklabToRgb, clamp } from './colors.js';

export const COLOR_MODES = ['rgba', 'indexed', 'grayscale'];

// 4×4 Bayer thresholds (0..15) for the ordered dithering of the indexed conversion.
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// A document without the field (2.0.0 files) is RGBA.
export function colorModeOf(doc) {
  return COLOR_MODES.includes(doc?.colorMode) ? doc.colorMode : 'rgba';
}

// Opaque, unique (by RGB) palette colors with their OKLab coordinates, ready for nearest-color searches.
export function preparePalette(colors) {
  const seen = new Set();
  const prepared = [];
  for (const c of colors || []) {
    if (c === null || c === undefined || !(c >>> 24)) continue;
    const rgb = (c & 0x00ffffff) >>> 0;
    if (seen.has(rgb)) continue;
    seen.add(rgb);
    const [r, g, b] = unpack(c);
    prepared.push({ color: (c | 0xff000000) >>> 0, rgb, lab: rgbToOklab(r, g, b) });
  }
  return prepared;
}

function closest(r, g, b, prepared) {
  const [L, A, B] = rgbToOklab(r, g, b);
  let best = prepared[0];
  let smallest = Infinity;
  for (const p of prepared) {
    const d = (L - p.lab[0]) ** 2 + (A - p.lab[1]) ** 2 + (B - p.lab[2]) ** 2;
    if (d < smallest) {
      smallest = d;
      best = p;
    }
  }
  return best;
}

// Nearest palette color (Euclidean distance in OKLab), keeping the alpha of `color`. Transparent stays as is.
export function nearestColor(color, palette) {
  const prepared = Array.isArray(palette) && palette[0]?.lab ? palette : preparePalette(palette);
  if (!(color >>> 24) || !prepared.length) return color >>> 0;
  const [r, g, b] = unpack(color);
  return (closest(r, g, b, prepared).rgb | (color & 0xff000000)) >>> 0;
}

// Gray with the same perceived lightness (OKLab L), the same formula as the "Tons de cinza" filter.
export function grayOf(color) {
  const [r, g, b, a] = unpack(color);
  if (!a) return color >>> 0;
  const [L] = rgbToOklab(r, g, b);
  const [v] = oklabToRgb(L, 0, 0);
  return pack(v, v, v, a);
}

export function isGray(color) {
  const [r, g, b] = unpack(color);
  return r === g && g === b;
}

export function toGrayscalePixels(pixels) {
  const out = pixels.slice();
  const cache = new Map();
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (!(c >>> 24)) continue;
    let g = cache.get(c);
    if (g === undefined) cache.set(c, (g = grayOf(c)));
    out[i] = g;
  }
  return out;
}

// Maps every opaque pixel to the nearest palette color. With `dither`, a 4×4 ordered (Bayer) offset is added
// to the RGB before the search, so flat areas between two palette colors become a pattern of both.
export function toIndexedPixels(pixels, width, colors, { dither = false, amount = 0.5 } = {}) {
  const prepared = preparePalette(colors);
  const out = pixels.slice();
  if (!prepared.length) return out;
  const spread = (255 * clamp(amount, 0, 1)) / Math.max(1, Math.cbrt(prepared.length) - 1);
  const cache = new Map();
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (!(c >>> 24)) continue;
    let r = c & 255;
    let g = (c >>> 8) & 255;
    let b = (c >>> 16) & 255;
    if (dither && spread > 0) {
      const x = i % width;
      const y = (i / width) | 0;
      const offset = ((BAYER_4[y & 3][x & 3] + 0.5) / 16 - 0.5) * spread;
      r = clamp(Math.round(r + offset), 0, 255);
      g = clamp(Math.round(g + offset), 0, 255);
      b = clamp(Math.round(b + offset), 0, 255);
      out[i] = (closest(r, g, b, prepared).rgb | (c & 0xff000000)) >>> 0;
      continue;
    }
    let rgb = cache.get(c & 0x00ffffff);
    if (rgb === undefined) cache.set(c & 0x00ffffff, (rgb = closest(r, g, b, prepared).rgb));
    out[i] = (rgb | (c & 0xff000000)) >>> 0;
  }
  return out;
}

// Converts a matrix to a mode ('rgba' leaves the pixels alone).
export function convertPixels(pixels, width, mode, colors, options = {}) {
  if (mode === 'indexed') return toIndexedPixels(pixels, width, colors, options);
  if (mode === 'grayscale') return toGrayscalePixels(pixels);
  return pixels.slice();
}

// The color a drawing tool may use in a mode: the nearest palette color (indexed) or its gray (grayscale).
export function snapColor(color, mode, colors) {
  if (mode === 'indexed') return nearestColor(color, colors);
  if (mode === 'grayscale') return grayOf(color);
  return color >>> 0;
}

// Keeps only the pixels that changed between `before` and `after` inside the mode (used after adjustments).
export function constrainPixels(before, after, mode, colors) {
  if (mode !== 'indexed' && mode !== 'grayscale') return after;
  const prepared = mode === 'indexed' ? preparePalette(colors) : null;
  if (prepared && !prepared.length) return after;
  const out = after.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] === before[i] || !(out[i] >>> 24)) continue;
    out[i] = mode === 'indexed' ? nearestColor(out[i], prepared) : grayOf(out[i]);
  }
  return out;
}

// Palette edit → pixel remap. `origins[j]` is the index in `oldColors` the new entry j came from (-1 if new).
// Returns a Map of old RGB → new RGB: edited entries map to their new color, removed entries to the nearest
// color left in the new palette. Unchanged colors are not in the map.
export function paletteRemap(oldColors, newColors, origins) {
  const map = new Map();
  const prepared = preparePalette(newColors);
  const handled = new Set();
  oldColors.forEach((old, i) => {
    const rgb = (old & 0x00ffffff) >>> 0;
    if (handled.has(rgb)) return;
    handled.add(rgb);
    const j = origins.indexOf(i);
    let target;
    if (j >= 0) target = (newColors[j] & 0x00ffffff) >>> 0;
    else if (newColors.some((c) => ((c & 0x00ffffff) >>> 0) === rgb)) return;
    else if (prepared.length) target = nearestColor(old | 0xff000000, prepared) & 0x00ffffff;
    else return;
    if (target !== rgb) map.set(rgb, target >>> 0);
  });
  return map;
}

// Applies a Map of RGB → RGB to a matrix, keeping the alpha. Returns a new matrix and how many pixels changed.
export function remapPixels(pixels, map) {
  const out = pixels.slice();
  let changed = 0;
  if (!map.size) return { pixels: out, changed };
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (!(c >>> 24)) continue;
    const to = map.get((c & 0x00ffffff) >>> 0);
    if (to === undefined) continue;
    out[i] = (to | (c & 0xff000000)) >>> 0;
    changed++;
  }
  return { pixels: out, changed };
}

// Every distinct pixel matrix of the document: cels (linked cels share one array, visited once) and tileset tiles.
export function documentMatrices(doc) {
  const seen = new Set();
  const list = [];
  const add = (px) => {
    if (px && !seen.has(px)) {
      seen.add(px);
      list.push(px);
    }
  };
  for (const px of doc.cells.values()) add(px);
  for (const t of doc.tilesets || []) for (const tile of t.tiles || []) add(tile);
  return list;
}

function countDifferences(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// Converts every cel (and tile) of the document in place. Returns the number of pixels changed.
export function convertDocument(doc, mode, colors, options = {}) {
  let changed = 0;
  const cells = new Set(doc.cells.values());
  for (const px of documentMatrices(doc)) {
    // Tiles are small and repeat across the map: they are never dithered, so equal tiles stay equal.
    const width = cells.has(px) ? doc.width : Math.max(1, Math.round(Math.sqrt(px.length)));
    const out = convertPixels(px, width, mode, colors, cells.has(px) ? options : { ...options, dither: false });
    changed += countDifferences(px, out);
    px.set(out);
  }
  return changed;
}

// Applies a palette remap (see paletteRemap) to every cel and tile of the document, in place.
export function remapDocument(doc, map) {
  let changed = 0;
  if (!map.size) return 0;
  for (const px of documentMatrices(doc)) {
    const r = remapPixels(px, map);
    if (r.changed) px.set(r.pixels);
    changed += r.changed;
  }
  return changed;
}
