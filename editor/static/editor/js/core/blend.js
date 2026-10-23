// Layer blend modes. `normal` keeps the exact 2.0.0 integer path (overlay() in colors.js); the other modes follow
// the W3C Compositing and Blending Level 1 formulas on doubles in [0, 1]. The same math lives in editor/blend.py
// and in the Java CLI (Blend.java): keep the evaluation order identical in the three languages.
import { overlay } from './colors.js';

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'addition', 'subtract', 'divide',
];

export const BLEND_LABELS = {
  normal: 'Normal',
  multiply: 'Multiplicar',
  screen: 'Tela',
  overlay: 'Sobrepor',
  darken: 'Escurecer',
  lighten: 'Clarear',
  'color-dodge': 'Subexposição de cor',
  'color-burn': 'Superexposição de cor',
  'hard-light': 'Luz forte',
  'soft-light': 'Luz suave',
  difference: 'Diferença',
  exclusion: 'Exclusão',
  hue: 'Matiz',
  saturation: 'Saturação',
  color: 'Cor',
  luminosity: 'Luminosidade',
  addition: 'Adição',
  subtract: 'Subtração',
  divide: 'Divisão',
};

export function isBlendMode(mode) {
  return BLEND_MODES.includes(mode);
}

function multiply(b, s) {
  return b * s;
}

function screen(b, s) {
  return b + s - b * s;
}

function hardLight(b, s) {
  return s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1);
}

function colorDodge(b, s) {
  if (b === 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
}

function colorBurn(b, s) {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
}

function softLight(b, s) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

const SEPARABLE = {
  multiply,
  screen,
  overlay: (b, s) => hardLight(s, b),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': colorDodge,
  'color-burn': colorBurn,
  'hard-light': hardLight,
  'soft-light': softLight,
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  addition: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s === 0 ? 1 : Math.min(1, b / s)),
};

function lum(c) {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

function clipColor(c) {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
}

function setLum(c, l) {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function sat(c) {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

function setSat(c, s) {
  // Indices of the max, mid and min channels (ties resolved by channel order, like the reference implementations).
  const order = [0, 1, 2].sort((i, j) => c[j] - c[i]);
  const [max, mid, min] = order;
  const out = [0, 0, 0];
  if (c[max] > c[min]) {
    out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
    out[max] = s;
  }
  out[min] = 0;
  return out;
}

const NON_SEPARABLE = {
  hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
  saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
  color: (b, s) => setLum(s, lum(b)),
  luminosity: (b, s) => setLum(b, lum(s)),
};

// B(Cb, Cs) for the three channels at once; arrays of doubles in [0, 1].
export function blendChannels(mode, b, s) {
  const f = SEPARABLE[mode];
  if (f) return [f(b[0], s[0]), f(b[1], s[1]), f(b[2], s[2])];
  const g = NON_SEPARABLE[mode];
  if (g) return g(b, s);
  return [s[0], s[1], s[2]];
}

// Composites `front` over `back` (packed 0xAABBGGRR) with the layer opacity in [0, 1] and the blend mode.
export function blendPixel(mode, back, front, opacity = 1) {
  if (mode === 'normal' || !mode) return overlay(back, front, opacity);
  const as = (((front >>> 24) & 255) / 255) * opacity;
  if (as <= 0) return back;
  const ab = ((back >>> 24) & 255) / 255;
  const cb = [(back & 255) / 255, ((back >>> 8) & 255) / 255, ((back >>> 16) & 255) / 255];
  const cs = [(front & 255) / 255, ((front >>> 8) & 255) / 255, ((front >>> 16) & 255) / 255];
  const mixed = blendChannels(mode, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return 0;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const csp = (1 - ab) * cs[k] + ab * mixed[k];
    const co = (as * csp + ab * cb[k] * (1 - as)) / ao;
    out[k] = Math.max(0, Math.min(255, Math.floor(co * 255 + 0.5)));
  }
  const a = Math.max(0, Math.min(255, Math.floor(ao * 255 + 0.5)));
  return ((a << 24) | (out[2] << 16) | (out[1] << 8) | out[0]) >>> 0;
}

// Blends a whole layer buffer into dest (same size). Fully transparent source pixels are skipped.
export function blendInto(dest, source, mode, opacity) {
  if (opacity <= 0) return dest;
  const normal = mode === 'normal' || !mode;
  for (let p = 0; p < source.length; p++) {
    const c = source[p];
    const a = c >>> 24;
    if (a === 0) continue;
    if (normal) {
      if (a === 255 && opacity >= 1) dest[p] = c;
      else dest[p] = overlay(dest[p], c, opacity);
    } else {
      dest[p] = blendPixel(mode, dest[p], c, opacity);
    }
  }
  return dest;
}
