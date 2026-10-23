import { distance } from './colors.js';

function comparator(target, tolerance) {
  if (tolerance <= 0) {
    if (((target >>> 24) & 255) === 0) return (c) => ((c >>> 24) & 255) === 0;
    return (c) => c === target;
  }
  return (c) => distance(c, target) <= tolerance;
}

export function region(pixels, width, height, x, y, { connectivity = 4, tolerance = 0, contiguous = true } = {}) {
  if (x < 0 || y < 0 || x >= width || y >= height) return new Uint32Array(0);
  const matches = comparator(pixels[y * width + x], tolerance);
  if (!contiguous) {
    const all = [];
    for (let i = 0; i < pixels.length; i++) if (matches(pixels[i])) all.push(i);
    return Uint32Array.from(all);
  }
  const visited = new Uint8Array(width * height);
  const found = [];
  const stack = [x, y];
  const diagonal = connectivity === 8;
  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    const base = cy * width;
    if (visited[base + cx] || !matches(pixels[base + cx])) continue;
    let xi = cx;
    while (xi > 0 && !visited[base + xi - 1] && matches(pixels[base + xi - 1])) xi--;
    let xf = cx;
    while (xf < width - 1 && !visited[base + xf + 1] && matches(pixels[base + xf + 1])) xf++;
    for (let i = xi; i <= xf; i++) {
      visited[base + i] = 1;
      found.push(base + i);
    }
    const from = diagonal ? Math.max(0, xi - 1) : xi;
    const to = diagonal ? Math.min(width - 1, xf + 1) : xf;
    for (let ny = cy - 1; ny <= cy + 1; ny += 2) {
      if (ny < 0 || ny >= height) continue;
      const nb = ny * width;
      let inSpan = false;
      for (let i = from; i <= to; i++) {
        const free = !visited[nb + i] && matches(pixels[nb + i]);
        if (free && !inSpan) {
          stack.push(i, ny);
          inSpan = true;
        } else if (!free) {
          inSpan = false;
        }
      }
    }
  }
  return Uint32Array.from(found);
}

export function fill(pixels, width, height, x, y, color, options = {}) {
  const indices = region(pixels, width, height, x, y, options);
  const changed = [];
  for (const i of indices) {
    if (pixels[i] !== color) {
      pixels[i] = color;
      changed.push(i);
    }
  }
  return Uint32Array.from(changed);
}
