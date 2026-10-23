// Color and shape filters applied to a pixel matrix. They all return [index, newColor] pairs
// only for the pixels that change, so the interface records everything as a single history step.
import { unpack, pack, rgbToOklab, oklabToRgb, rgbToOklch, oklchToRgb, hexToColor, clamp } from './colors.js';

const NEIGHBORS_4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBORS_8 = [...NEIGHBORS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

const allowed = (filter, i) => !filter || filter(i);

// 1 px outer outline: transparent pixels that touch (4 or 8 neighbors) an opaque pixel.
export function outline(pixels, width, height, color, { neighbors = 4, filter = null } = {}) {
  const list = neighbors === 8 ? NEIGHBORS_8 : NEIGHBORS_4;
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (pixels[i] >>> 24 || !allowed(filter, i)) continue;
      for (const [dx, dy] of list) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (pixels[ny * width + nx] >>> 24) {
          changes.push([i, color >>> 0]);
          break;
        }
      }
    }
  }
  return changes;
}

function applyPerPixel(pixels, filter, fn) {
  const changes = [];
  const cache = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    if (!(c >>> 24) || !allowed(filter, i)) continue;
    let mapped = cache.get(c);
    if (mapped === undefined) {
      mapped = fn(c) >>> 0;
      cache.set(c, mapped);
    }
    if (mapped !== c) changes.push([i, mapped]);
  }
  return changes;
}

export function invert(pixels, { filter = null } = {}) {
  return applyPerPixel(pixels, filter, (c) => {
    const [r, g, b, a] = unpack(c);
    return pack(255 - r, 255 - g, 255 - b, a);
  });
}

export function toGrayscale(pixels, { filter = null } = {}) {
  return applyPerPixel(pixels, filter, (c) => {
    const [r, g, b, a] = unpack(c);
    const [L] = rgbToOklab(r, g, b);
    const [v] = oklabToRgb(L, 0, 0);
    return pack(v, v, v, a);
  });
}

function preparePalette(palette) {
  return palette
    .map((p) => (typeof p === 'string' ? hexToColor(p) : p))
    .filter((c) => c !== null && c >>> 24)
    .map((c) => {
      const [r, g, b] = unpack(c);
      return { color: c >>> 0, lab: rgbToOklab(r, g, b) };
    });
}

export function nearest(color, preparedPalette) {
  const [r, g, b] = unpack(color);
  const [L, A, B] = rgbToOklab(r, g, b);
  let best = null;
  let smallest = Infinity;
  for (const p of preparedPalette) {
    const d = (L - p.lab[0]) ** 2 + (A - p.lab[1]) ** 2 + (B - p.lab[2]) ** 2;
    if (d < smallest) {
      smallest = d;
      best = p;
    }
  }
  return best;
}

// Replaces each opaque pixel with the nearest palette color (Euclidean distance in OKLab). Keeps the alpha.
export function convertToPalette(pixels, palette, { filter = null } = {}) {
  const prepared = preparePalette(palette);
  if (!prepared.length) return [];
  return applyPerPixel(pixels, filter, (c) => {
    const target = nearest(c, prepared).color;
    return ((target & 0x00ffffff) | (c & 0xff000000)) >>> 0;
  });
}

// Lightens (step > 0) or darkens (step < 0) a color by adding the step to the OKLCH L.
export function lightnessStep(color, step) {
  const [r, g, b, a] = unpack(color);
  if (!a) return color >>> 0;
  const [L, C, H] = rgbToOklch(r, g, b);
  return pack(...oklchToRgb(clamp(L + step, 0, 1), C, H), a);
}

// Ramp: palette sorted from the darkest to the lightest color (OKLab L).
export function paletteRamp(palette) {
  const prepared = preparePalette(palette);
  const unique = new Map();
  for (const p of prepared) unique.set(p.color & 0x00ffffff, p);
  return [...unique.values()].sort((a, b) => a.lab[0] - b.lab[0]);
}

// Moves the color one step along the palette ramp (up lightens, down darkens).
// A color outside the palette first goes to the nearest color.
export function paletteStep(color, ramp, direction) {
  if (!(color >>> 24) || !ramp.length) return color >>> 0;
  const rgb = color & 0x00ffffff;
  let i = ramp.findIndex((p) => (p.color & 0x00ffffff) === rgb);
  if (i < 0) i = ramp.indexOf(nearest(color, ramp));
  else i = clamp(i + Math.sign(direction), 0, ramp.length - 1);
  return ((ramp[i].color & 0x00ffffff) | (color & 0xff000000)) >>> 0;
}
