
function bayer(n) {
  if (n === 1) return [[0]];
  const m = bayer(n / 2);
  const t = n / 2;
  const r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < t; x++) {
      const v = 4 * m[y][x];
      r[y][x] = v;
      r[y][x + t] = v + 2;
      r[y + t][x] = v + 3;
      r[y + t][x + t] = v + 1;
    }
  }
  return r;
}

export const BAYER = {
  2: bayer(2),
  4: bayer(4),
  8: bayer(8),
};

export function bayerThreshold(x, y, n = 4) {
  const m = BAYER[n] ?? BAYER[4];
  const yy = ((y % n) + n) % n;
  const xx = ((x % n) + n) % n;
  return (m[yy][xx] + 0.5) / (n * n);
}

export function patternPixel(x, y, density, n = 4) {
  return bayerThreshold(x, y, n) < density;
}

export function linearGradient(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function radialGradient(x, y, ax, ay, bx, by) {
  const radius = Math.hypot(bx - ax, by - ay);
  if (radius === 0) return 0;
  const t = Math.hypot(x - ax, y - ay) / radius;
  return t > 1 ? 1 : t;
}

export function gradientColor(x, y, t, start, end, n = 4) {
  return t > bayerThreshold(x, y, n) ? end : start;
}

export function gradient(width, height, { ax, ay, bx, by, type = 'linear', matrix = 4, start, end, indices = null }) {
  const value = type === 'radial' ? radialGradient : linearGradient;
  const result = [];
  const visit = (i) => {
    const x = i % width;
    const y = (i / width) | 0;
    result.push([i, gradientColor(x, y, value(x + 0.5, y + 0.5, ax + 0.5, ay + 0.5, bx + 0.5, by + 0.5), start, end, matrix)]);
  };
  if (indices) for (const i of indices) visit(i);
  else for (let i = 0; i < width * height; i++) visit(i);
  return result;
}
