export function line(x0, y0, x1, y1, point) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    point(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

export function rectangle(x0, y0, x1, y1, filled, point) {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  if (filled) {
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) point(x, y);
    return;
  }
  for (let x = xa; x <= xb; x++) {
    point(x, ya);
    if (yb !== ya) point(x, yb);
  }
  for (let y = ya + 1; y < yb; y++) {
    point(xa, y);
    if (xb !== xa) point(xb, y);
  }
}

export function ellipse(x0, y0, x1, y1, filled, point) {
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let error = dx + dy + b1 * a * a;
  if (x0 > x1) {
    x0 = x1;
    x1 += a;
  }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  const span = (xa, xb, y) => {
    for (let x = xa; x <= xb; x++) point(x, y);
  };
  do {
    if (filled) {
      span(x0, x1, y0);
      span(x0, x1, y1);
    } else {
      point(x1, y0);
      point(x0, y0);
      point(x0, y1);
      point(x1, y1);
    }
    const e2 = 2 * error;
    if (e2 <= dy) {
      y0++;
      y1--;
      dy += a;
      error += dy;
    }
    if (e2 >= dx || 2 * error > dy) {
      x0++;
      x1--;
      dx += b1;
      error += dx;
    }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    if (filled) {
      span(x0 - 1, x1 + 1, y0++);
      span(x0 - 1, x1 + 1, y1--);
    } else {
      point(x0 - 1, y0);
      point(x1 + 1, y0++);
      point(x0 - 1, y1);
      point(x1 + 1, y1--);
    }
  }
}

export function constrain(x0, y0, x1, y1, mode) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (mode === 'square') {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return [x0 + Math.sign(dx || 1) * m, y0 + Math.sign(dy || 1) * m];
  }
  const angle = Math.atan2(dy, dx);
  const eighth = Math.round(angle / (Math.PI / 4));
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  if (eighth % 2 === 0) {
    return Math.abs(eighth) === 2 ? [x0, y1] : [x1, y0];
  }
  return [x0 + Math.sign(dx || 1) * len, y0 + Math.sign(dy || 1) * len];
}

export function brush(size, shape = 'square') {
  const points = [];
  const start = -Math.floor((size - 1) / 2);
  const end = start + size - 1;
  const center = (start + end) / 2;
  const radius = size / 2;
  for (let y = start; y <= end; y++) {
    for (let x = start; x <= end; x++) {
      if (shape === 'circle' && size > 2) {
        const d = Math.hypot(x - center, y - center);
        if (d > radius - 0.25) continue;
      }
      points.push([x, y]);
    }
  }
  return points;
}

export function mirrors(x, y, width, height, symmetry) {
  const points = [[x, y]];
  const mx = width - 1 - x;
  const my = height - 1 - y;
  if (symmetry === 'horizontal' || symmetry === 'both') points.push([mx, y]);
  if (symmetry === 'vertical' || symmetry === 'both') points.push([x, my]);
  if (symmetry === 'both') points.push([mx, my]);
  return points;
}

export function scaleDetection(pixels, width, height) {
  const gcd = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  let g = 0;
  for (let y = 0; y < height; y++) {
    let run = 1;
    const base = y * width;
    for (let x = 1; x <= width; x++) {
      if (x < width && pixels[base + x] === pixels[base + x - 1]) run++;
      else {
        g = gcd(g, run);
        if (g === 1) return 1;
        run = 1;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let run = 1;
    for (let y = 1; y <= height; y++) {
      if (y < height && pixels[y * width + x] === pixels[(y - 1) * width + x]) run++;
      else {
        g = gcd(g, run);
        if (g === 1) return 1;
        run = 1;
      }
    }
  }
  return Math.max(1, g);
}

// Pixel perfect: three consecutive points of a stroke form an "L corner" when the first and the
// third are diagonal neighbors and the middle one touches both by the sides. Removing the middle one leaves
// the line 1 pixel thick, without doubled steps.
export function lCorner(a, b, c) {
  if (Math.abs(a[0] - c[0]) !== 1 || Math.abs(a[1] - c[1]) !== 1) return false;
  const touchesA = (b[0] === a[0] && Math.abs(b[1] - a[1]) === 1) || (b[1] === a[1] && Math.abs(b[0] - a[0]) === 1);
  const touchesC = (b[0] === c[0] && Math.abs(b[1] - c[1]) === 1) || (b[1] === c[1] && Math.abs(b[0] - c[0]) === 1);
  return touchesA && touchesC;
}

export function pixelPerfect(points) {
  const output = [];
  for (const p of points) {
    const last = output.at(-1);
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    output.push(p);
    while (output.length >= 3 && lCorner(output.at(-3), output.at(-2), output.at(-1))) output.splice(-2, 1);
  }
  return output;
}

// Closed polygon through the given [x, y] vertices (pixel coordinates). Filled: every pixel whose center is
// inside (even-odd rule) plus the edges, so thin or self-crossing shapes keep their outline.
export function polygon(points, filled, point) {
  if (!points.length) return;
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[(k + 1) % n];
    line(ax, ay, bx, by, point);
  }
  if (!filled || n < 3) return;
  let ya = Infinity;
  let yb = -Infinity;
  for (const [, y] of points) {
    ya = Math.min(ya, y);
    yb = Math.max(yb, y);
  }
  for (let y = ya; y <= yb; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let k = 0; k < n; k++) {
      const [ax, ay] = points[k];
      const [bx, by] = points[(k + 1) % n];
      const y0 = ay + 0.5;
      const y1 = by + 0.5;
      if (y0 === y1 || cy < Math.min(y0, y1) || cy >= Math.max(y0, y1)) continue;
      xs.push(ax + 0.5 + ((cy - y0) * (bx - ax)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 <= xs[k + 1]; x++) point(x, y);
    }
  }
}

// Cubic Bézier from p0 to p3 with control points c1 and c2 ([x, y] each), as a connected 1 px path.
export function bezier(p0, c1, c2, p3, point) {
  const length = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p3[0] - c2[0], p3[1] - c2[1]);
  const steps = Math.max(1, Math.ceil(length));
  let last = null;
  const seen = new Set();
  const emit = (x, y) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    point(x, y);
  };
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const x = Math.round(u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0]);
    const y = Math.round(u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]);
    if (last) line(last[0], last[1], x, y, emit);
    else emit(x, y);
    last = [x, y];
  }
}
