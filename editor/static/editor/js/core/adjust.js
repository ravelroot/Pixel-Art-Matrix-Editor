// Color adjustments on Uint32Array matrices (packed RGBA). Every function is pure: it returns a new matrix,
// keeps the alpha of every pixel, never touches transparent pixels and, when `indices` is given (a selection),
// changes only those pixels. Signature: fn(pixels, options, { width, height, indices }).
import { unpack, pack, clamp, rgbToHsl, hslToRgb } from './colors.js';

const byte = (v) => clamp(Math.round(v), 0, 255);

function forEachTarget(pixels, indices, fn) {
  if (indices) {
    for (const i of indices) if (i < pixels.length && pixels[i] >>> 24) fn(i);
  } else {
    for (let i = 0; i < pixels.length; i++) if (pixels[i] >>> 24) fn(i);
  }
}

// Per-color adjustments: each distinct color is computed once.
function mapColors(pixels, indices, fn) {
  const out = pixels.slice();
  const cache = new Map();
  forEachTarget(pixels, indices, (i) => {
    const c = pixels[i];
    let m = cache.get(c);
    if (m === undefined) {
      const [r, g, b, a] = unpack(c);
      m = pack(...fn(r, g, b), a);
      cache.set(c, m);
    }
    out[i] = m;
  });
  return out;
}

// brightness and contrast in -100..100 (0 = unchanged).
export function brightnessContrast(pixels, { brightness = 0, contrast = 0 } = {}, { indices = null } = {}) {
  const shift = clamp(brightness, -100, 100) * 2.55;
  const c = clamp(contrast, -100, 100) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) table[v] = byte(factor * (v + shift - 128) + 128);
  return mapColors(pixels, indices, (r, g, b) => [table[r], table[g], table[b]]);
}

const scaleUnit = (v, amount) => (amount >= 0 ? v + (1 - v) * amount : v * (1 + amount));

// hue in -180..180 degrees; saturation and lightness in -100..100. With `colorize`, every pixel gets the hue
// (0..360 when negative values wrap) and a saturation of 50% + saturation/2, keeping its own lightness.
export function hueSaturation(pixels, { hue = 0, saturation = 0, lightness = 0, colorize = false } = {}, { indices = null } = {}) {
  const s = clamp(saturation, -100, 100) / 100;
  const l = clamp(lightness, -100, 100) / 100;
  if (!colorize && !hue && !s && !l) return pixels.slice();
  return mapColors(pixels, indices, (r, g, b) => {
    const [H, S, L] = rgbToHsl(r, g, b);
    if (colorize) return hslToRgb(((hue % 360) + 360) % 360, clamp(0.5 + s / 2, 0, 1), clamp(scaleUnit(L, l), 0, 1));
    return hslToRgb(H + hue, clamp(scaleUnit(S, s), 0, 1), clamp(scaleUnit(L, l), 0, 1));
  });
}

// Lookup table 0..255 from curve points [[in, out], ...] (linear between the points, flat outside them).
export function curveTable(points = [[0, 0], [255, 255]]) {
  const list = [...points]
    .map(([x, y]) => [clamp(Math.round(x), 0, 255), clamp(Math.round(y), 0, 255)])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0]);
  const table = new Uint8Array(256);
  if (!list.length) {
    for (let v = 0; v < 256; v++) table[v] = v;
    return table;
  }
  for (let v = 0; v < 256; v++) {
    if (v <= list[0][0]) table[v] = list[0][1];
    else if (v >= list.at(-1)[0]) table[v] = list.at(-1)[1];
    else {
      let k = 1;
      while (list[k][0] < v) k++;
      const [x0, y0] = list[k - 1];
      const [x1, y1] = list[k];
      table[v] = byte(y0 + ((y1 - y0) * (v - x0)) / (x1 - x0));
    }
  }
  return table;
}

// Curves: { rgb, r, g, b } point lists (any may be missing); or the shorthand { points, channel: 'rgb'|'r'|'g'|'b' }.
// The per-channel curve is applied first, then the RGB curve.
export function colorCurve(pixels, options = {}, { indices = null } = {}) {
  const curves = options.points ? { [options.channel || 'rgb']: options.points } : options.curves || options;
  const identity = curveTable();
  const table = (key) => (Array.isArray(curves[key]) ? curveTable(curves[key]) : identity);
  const all = table('rgb');
  const [tr, tg, tb] = ['r', 'g', 'b'].map(table);
  return mapColors(pixels, indices, (r, g, b) => [all[tr[r]], all[tg[g]], all[tb[b]]]);
}

// levels in 2..256 per channel.
export function posterize(pixels, { levels = 4 } = {}, { indices = null } = {}) {
  const n = clamp(Math.round(levels), 2, 256);
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) table[v] = byte((Math.round((v / 255) * (n - 1)) * 255) / (n - 1));
  return mapColors(pixels, indices, (r, g, b) => [table[r], table[g], table[b]]);
}

// Despeckle: per-channel median of the opaque pixels of the 3×3 neighborhood (the window is clipped at the edges).
export function despeckle(pixels, options = {}, { width, height, indices = null } = {}) {
  const out = pixels.slice();
  const rs = [];
  const gs = [];
  const bs = [];
  const median = (list) => list.sort((p, q) => p - q)[list.length >> 1];
  forEachTarget(pixels, indices, (i) => {
    const x = i % width;
    const y = (i / width) | 0;
    rs.length = gs.length = bs.length = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const c = pixels[ny * width + nx];
        if (!(c >>> 24)) continue;
        rs.push(c & 255);
        gs.push((c >>> 8) & 255);
        bs.push((c >>> 16) & 255);
      }
    }
    out[i] = pack(median(rs), median(gs), median(bs), pixels[i] >>> 24);
  });
  return out;
}

export const CONVOLUTION_PRESETS = {
  smooth: { label: 'Suavizar', kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1], divisor: 9 },
  sharpen: { label: 'Nitidez', kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], divisor: 1 },
  edges: { label: 'Realce de bordas', kernel: [-1, -1, -1, -1, 10, -1, -1, -1, -1], divisor: 2 },
  gaussian: { label: 'Desfoque gaussiano 3×3', kernel: [1, 2, 1, 2, 4, 2, 1, 2, 1], divisor: 16 },
};

// Convolution with a square kernel (3×3, 5×5...). Edges repeat the border pixel. With `skipTransparent`
// (default), transparent neighbors count as the center pixel, so sprite borders do not bleed into black.
export function convolve(pixels, { preset = null, kernel = null, divisor = null, bias = 0, skipTransparent = true } = {}, { width, height, indices = null } = {}) {
  const p = CONVOLUTION_PRESETS[preset];
  const k = kernel ?? p?.kernel ?? CONVOLUTION_PRESETS.smooth.kernel;
  const size = Math.round(Math.sqrt(k.length));
  if (size * size !== k.length || size % 2 === 0) throw new Error('The kernel must be a square with an odd side.');
  const sum = k.reduce((s, v) => s + v, 0);
  const div = divisor ?? (kernel ? sum : p?.divisor ?? sum) ?? 1;
  const d = div || 1;
  const half = size >> 1;
  const out = pixels.slice();
  forEachTarget(pixels, indices, (i) => {
    const x = i % width;
    const y = (i / width) | 0;
    const center = pixels[i];
    let r = 0;
    let g = 0;
    let b = 0;
    for (let ky = 0; ky < size; ky++) {
      const ny = clamp(y + ky - half, 0, height - 1);
      for (let kx = 0; kx < size; kx++) {
        const w = k[ky * size + kx];
        if (!w) continue;
        const nx = clamp(x + kx - half, 0, width - 1);
        let c = pixels[ny * width + nx];
        if (skipTransparent && !(c >>> 24)) c = center;
        r += w * (c & 255);
        g += w * ((c >>> 8) & 255);
        b += w * ((c >>> 16) & 255);
      }
    }
    out[i] = pack(byte(r / d + bias), byte(g / d + bias), byte(b / d + bias), center >>> 24);
  });
  return out;
}

export const ADJUSTMENTS = {
  brightnessContrast,
  hueSaturation,
  colorCurve,
  posterize,
  despeckle,
  convolve,
};

export function applyAdjustment(id, pixels, options, context) {
  const fn = ADJUSTMENTS[id];
  if (!fn) throw new Error(`Unknown adjustment: ${id}`);
  return fn(pixels, options, context);
}

// [index, color] pairs of the pixels that differ (the format editor.applyChanges records as one undo step).
export function changesBetween(before, after) {
  const changes = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changes.push([i, after[i]]);
  return changes;
}
