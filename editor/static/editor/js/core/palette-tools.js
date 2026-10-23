// Pure helpers of the palette editor. Colors are packed RGBA numbers. The *Order functions return index lists,
// so the editor can move other per-entry data (such as where each entry came from) along with the colors.
import { unpack, pack, rgbToOklab, oklabToRgb, rgbToHsv, clamp } from './colors.js';

const BLACK = pack(0, 0, 0);

function describe(c) {
  const [r, g, b] = unpack(c);
  const [h, s] = rgbToHsv(r, g, b);
  return { h, s, L: rgbToOklab(r, g, b)[0] };
}

// key: 'hue' (grays first, by lightness), 'lightness' (OKLab L, dark → light) or 'saturation' (gray → vivid).
// Stable: equal colors keep their order.
export function sortOrder(colors, key = 'hue') {
  const info = colors.map(describe);
  const order = colors.map((_, i) => i);
  const compare = {
    hue: (a, b) => {
      const ga = info[a].s < 0.0001;
      const gb = info[b].s < 0.0001;
      if (ga !== gb) return ga ? -1 : 1;
      if (!ga && Math.abs(info[a].h - info[b].h) > 1e-9) return info[a].h - info[b].h;
      return info[a].L - info[b].L;
    },
    lightness: (a, b) => info[a].L - info[b].L,
    saturation: (a, b) => info[a].s - info[b].s || info[a].L - info[b].L,
  }[key];
  if (!compare) throw new Error(`Unknown sort key: ${key}`);
  return order.sort((a, b) => compare(a, b) || a - b);
}

export function sortColors(colors, key = 'hue') {
  return sortOrder(colors, key).map((i) => colors[i]);
}

// Indices of the first occurrence of each color.
export function dedupeOrder(colors) {
  const seen = new Set();
  const order = [];
  colors.forEach((c, i) => {
    const v = c >>> 0;
    if (seen.has(v)) return;
    seen.add(v);
    order.push(i);
  });
  return order;
}

export function dedupeColors(colors) {
  return dedupeOrder(colors).map((i) => colors[i]);
}

export function reverseColors(colors) {
  return [...colors].reverse();
}

// `steps` colors from a to b (both included), interpolated in OKLab; the alpha is interpolated linearly.
export function rampBetween(a, b, steps) {
  const n = clamp(Math.round(steps), 2, 256);
  const [r1, g1, b1, a1] = unpack(a);
  const [r2, g2, b2, a2] = unpack(b);
  const p = rgbToOklab(r1, g1, b1);
  const q = rgbToOklab(r2, g2, b2);
  const colors = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (i === 0) colors.push(a >>> 0);
    else if (i === n - 1) colors.push(b >>> 0);
    else colors.push(pack(...oklabToRgb(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t), Math.round(a1 + (a2 - a1) * t)));
  }
  return colors;
}

// Replaces the entries from index i to j (any order, both included) by a ramp of `steps` colors between them.
export function insertRamp(colors, i, j, steps) {
  const [from, to] = i <= j ? [i, j] : [j, i];
  const ramp = rampBetween(colors[i], colors[j], steps);
  if (i > j) ramp.reverse();
  return [...colors.slice(0, from), ...ramp, ...colors.slice(to + 1)];
}

// Cuts the palette or grows it with `fill` (black) up to n colors.
export function resizePalette(colors, n, fill = BLACK) {
  const size = clamp(Math.round(n), 1, 256);
  if (colors.length >= size) return colors.slice(0, size);
  return [...colors, ...Array(size - colors.length).fill(fill >>> 0)];
}

export function moveItem(list, from, to) {
  const copy = [...list];
  if (from < 0 || from >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(clamp(to, 0, copy.length), 0, item);
  return copy;
}
