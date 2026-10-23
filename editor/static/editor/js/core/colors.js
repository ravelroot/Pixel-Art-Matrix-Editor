export const TRANSPARENT = 0;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function pack(r, g, b, a = 255) {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function unpack(c) {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}

export function alpha(c) {
  return (c >>> 24) & 255;
}

export function hexToColor(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

const two = (v) => v.toString(16).padStart(2, '0');

export function colorToHex(c, alwaysAlpha = false) {
  const [r, g, b, a] = unpack(c);
  return '#' + two(r) + two(g) + two(b) + (alwaysAlpha || a !== 255 ? two(a) : '');
}

export function colorToHex6(c) {
  const [r, g, b] = unpack(c);
  return '#' + two(r) + two(g) + two(b);
}

export function withAlpha(c, a) {
  return ((c & 0x00ffffff) | ((a & 255) << 24)) >>> 0;
}

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const linear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const gamut = (v) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function rgbToOklab(r, g, b) {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinearRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToRgb(L, a, b) {
  return oklabToLinearRgb(L, a, b).map((v) => clamp(Math.round(gamut(clamp(v, 0, 1))), 0, 255));
}

export function rgbToOklch(r, g, b) {
  const [L, a, bb] = rgbToOklab(r, g, b);
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

function inGamut(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const rgb = oklabToLinearRgb(L, C * Math.cos(rad), C * Math.sin(rad));
  return rgb.every((v) => v >= -0.0005 && v <= 1.0005);
}

export function oklchToRgb(L, C, H) {
  L = clamp(L, 0, 1);
  C = Math.max(0, C);
  if (!inGamut(L, C, H)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(L, mid, H)) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  const rad = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
}

function nudgeHue(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return (h + step + 360) % 360;
}

export const LIGHT_HUE = 95;
export const SHADOW_HUE = 275;

export function generateRamp(color, { steps = 3, intensity = 0.8, hueShift = 18, saturation = 0 } = {}) {
  const [r, g, b, a] = unpack(color);
  const [L, C, H] = rgbToOklch(r, g, b);
  const grayscale = C < 0.012;
  const shades = [];
  const tints = [];
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * clamp(intensity, 0, 1);
    const Ls = L - (L - 0.08) * t;
    const Ll = L + (0.985 - L) * t;
    const Hs = grayscale ? H : nudgeHue(H, SHADOW_HUE, hueShift * t);
    const Hl = grayscale ? H : nudgeHue(H, LIGHT_HUE, hueShift * t);
    const Cs = grayscale ? C : C * (1 - 0.15 * t) * (1 + saturation);
    const Cl = grayscale ? C : C * (1 - 0.55 * t) * (1 + saturation);
    shades.push(pack(...oklchToRgb(Ls, Cs, Hs), a));
    tints.push(pack(...oklchToRgb(Ll, Cl, Hl), a));
  }
  return { shades: shades.reverse(), base: color, tints, ramp: [...shades, color, ...tints] };
}

export function distance(c1, c2) {
  const a = unpack(c1);
  const b = unpack(c2);
  if (a[3] === 0 && b[3] === 0) return 0;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
}

export function overlay(background, front, opacity = 1) {
  const sa = (((front >>> 24) & 255) / 255) * opacity;
  if (sa <= 0) return background;
  const da = ((background >>> 24) & 255) / 255;
  if (sa >= 1 || da === 0) {
    if (sa >= 1) return front;
    return withAlpha(front, Math.round(sa * 255));
  }
  const oa = sa + da * (1 - sa);
  const mix = (s, d) => Math.round((s * sa + d * da * (1 - sa)) / oa);
  return pack(
    mix(front & 255, background & 255),
    mix((front >>> 8) & 255, (background >>> 8) & 255),
    mix((front >>> 16) & 255, (background >>> 16) & 255),
    Math.round(oa * 255),
  );
}

export function luminance(c) {
  const [r, g, b] = unpack(c);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
