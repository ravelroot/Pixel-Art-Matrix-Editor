import { overlay, pack } from './colors.js';

export const INK_MODES = ['simple', 'composite', 'lockAlpha', 'behind'];

export function applyInk(dst, src, mode = 'simple') {
  dst >>>= 0;
  src >>>= 0;
  if (mode === 'composite') return overlay(dst, src) >>> 0;
  if (mode === 'lockAlpha') {
    if (!(dst >>> 24) || !(src >>> 24)) return null;
    return ((dst & 0xff000000) | (src & 0x00ffffff)) >>> 0;
  }
  if (mode === 'behind') {
    if (dst >>> 24 === 255) return null;
    return overlay(src, dst) >>> 0;
  }
  return src;
}

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sprayPoints(cx, cy, radius, count, rng = Math.random) {
  const points = [];
  for (let k = 0; k < count; k++) {
    const r = radius * Math.sqrt(rng());
    const t = rng() * 2 * Math.PI;
    let dx = Math.round(r * Math.cos(t));
    let dy = Math.round(r * Math.sin(t));
    if (dx * dx + dy * dy > radius * radius) {
      dx = Math.trunc(r * Math.cos(t));
      dy = Math.trunc(r * Math.sin(t));
    }
    points.push([cx + dx, cy + dy]);
  }
  return points;
}

export function sprayCount(radius, density) {
  return Math.max(1, Math.round(Math.PI * radius * radius * (density / 100) * 0.06));
}

export function brushFromRegion(region) {
  const points = [];
  const ox = Math.floor(region.width / 2);
  const oy = Math.floor(region.height / 2);
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const i = y * region.width + x;
      if (region.mask && !region.mask[i]) continue;
      const c = region.pixels[i] >>> 0;
      if (!(c >>> 24)) continue;
      points.push([x - ox, y - oy, c]);
    }
  }
  if (!points.length) return null;
  return { width: region.width, height: region.height, pixels: region.pixels.slice(), points };
}

export function blurPixel(read, width, height, x, y) {
  const center = read(x, y) >>> 0;
  const alpha = center >>> 24;
  if (!alpha) return center;
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const c = read(sx, sy) >>> 0;
      const a = c >>> 24;
      if (!a) continue;
      r += (c & 255) * a;
      g += ((c >>> 8) & 255) * a;
      b += ((c >>> 16) & 255) * a;
      weight += a;
    }
  }
  return pack(Math.round(r / weight), Math.round(g / weight), Math.round(b / weight), alpha) >>> 0;
}

export function jumbleTarget(x, y, width, height, rng = Math.random, allowed = () => true) {
  const options = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height || !allowed(sx, sy)) continue;
      options.push(sy * width + sx);
    }
  }
  if (!options.length) return -1;
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

export function jumble(pixels, width, height, points, rng = Math.random, allowed = () => true) {
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= width || y >= height || !allowed(x, y)) continue;
    const i = y * width + x;
    const j = jumbleTarget(x, y, width, height, rng, allowed);
    if (j < 0) continue;
    const t = pixels[i];
    pixels[i] = pixels[j];
    pixels[j] = t;
  }
  return pixels;
}
