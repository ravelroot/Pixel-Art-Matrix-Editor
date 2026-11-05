import { unpack, pack, rgbToOklab, oklabToRgb, rgbToOklch, oklchToRgb } from './colors.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
const allowed = (filter, i) => !filter || filter(i);
const opaque = (c) => c >>> 24 !== 0;

export function scale2x(src, width, height) {
  const w2 = width * 2;
  const out = new Uint32Array(w2 * height * 2);
  const at = (x, y) => src[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      let e0 = p;
      let e1 = p;
      let e2 = p;
      let e3 = p;
      if (a !== d && c !== b) {
        if (c === a) e0 = a;
        if (a === b) e1 = b;
        if (d === c) e2 = c;
        if (b === d) e3 = d;
      }
      const o = y * 2 * w2 + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + w2] = e2;
      out[o + w2 + 1] = e3;
    }
  }
  return out;
}

export function scale3x(src, width, height) {
  const w3 = width * 3;
  const out = new Uint32Array(w3 * height * 3);
  const at = (x, y) => src[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const A = at(x - 1, y - 1);
      const B = at(x, y - 1);
      const C = at(x + 1, y - 1);
      const D = at(x - 1, y);
      const E = at(x, y);
      const F = at(x + 1, y);
      const G = at(x - 1, y + 1);
      const H = at(x, y + 1);
      const I = at(x + 1, y + 1);
      const e = [E, E, E, E, E, E, E, E, E];
      if (B !== H && D !== F) {
        e[0] = D === B ? D : E;
        e[1] = (D === B && E !== C) || (B === F && E !== A) ? B : E;
        e[2] = B === F ? F : E;
        e[3] = (D === B && E !== G) || (D === H && E !== A) ? D : E;
        e[5] = (B === F && E !== I) || (H === F && E !== C) ? F : E;
        e[6] = D === H ? D : E;
        e[7] = (D === H && E !== I) || (H === F && E !== G) ? H : E;
        e[8] = H === F ? F : E;
      }
      const o = y * 3 * w3 + x * 3;
      for (let k = 0; k < 9; k++) out[o + Math.floor(k / 3) * w3 + (k % 3)] = e[k];
    }
  }
  return out;
}

export function upscalePixelArt(src, width, height, factor) {
  if (factor === 3) return { pixels: scale3x(src, width, height), width: width * 3, height: height * 3 };
  let pixels = scale2x(src, width, height);
  let w = width * 2;
  let h = height * 2;
  if (factor === 4) {
    pixels = scale2x(pixels, w, h);
    w *= 2;
    h *= 2;
  }
  return { pixels, width: w, height: h };
}

function shade(color, amount = 0.2) {
  const [r, g, b, a] = unpack(color);
  const [L, C, H] = rgbToOklch(r, g, b);
  const target = 265;
  const delta = ((((target - H) % 360) + 540) % 360) - 180;
  const [nr, ng, nb] = oklchToRgb(Math.max(0, L - amount), C * 0.9, (H + delta * 0.25 + 360) % 360);
  return pack(nr, ng, nb, a);
}

export function innerOutline(pixels, width, height, color, { neighbors = 4, filter = null } = {}) {
  const list = neighbors === 8 ? N8 : N4;
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque(pixels[i]) || !allowed(filter, i) || pixels[i] === color >>> 0) continue;
      for (const [dx, dy] of list) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !opaque(pixels[ny * width + nx])) {
          changes.push([i, color >>> 0]);
          break;
        }
      }
    }
  }
  return changes;
}

export function selectiveOutline(pixels, width, height, { amount = 0.22, filter = null } = {}) {
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (opaque(pixels[i]) || !allowed(filter, i)) continue;
      const counts = new Map();
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const c = pixels[ny * width + nx];
        if (opaque(c)) counts.set(c, (counts.get(c) || 0) + 1);
      }
      if (!counts.size) continue;
      let best = 0;
      let color = 0;
      for (const [c, n] of counts) {
        if (n > best || (n === best && rgbToOklab(...unpack(c).slice(0, 3))[0] < rgbToOklab(...unpack(color).slice(0, 3))[0])) {
          best = n;
          color = c;
        }
      }
      changes.push([i, shade(color, amount) | 0xff000000]);
    }
  }
  return changes.map(([i, c]) => [i, c >>> 0]);
}

export function dropShadow(pixels, width, height, color, { dx = 1, dy = 1, filter = null } = {}) {
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (opaque(pixels[i]) || !allowed(filter, i)) continue;
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      if (opaque(pixels[sy * width + sx])) changes.push([i, color >>> 0]);
    }
  }
  return changes;
}

export function cleanOrphans(pixels, width, height, { filter = null } = {}) {
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = pixels[i];
      if (!opaque(c) || !allowed(filter, i)) continue;
      const around = new Map();
      let total = 0;
      let same = 0;
      let opaqueNear = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = pixels[ny * width + nx];
        total++;
        if (n === c) same++;
        if (opaque(n)) opaqueNear++;
        around.set(n, (around.get(n) || 0) + 1);
      }
      if (same) continue;
      if (!opaqueNear) {
        changes.push([i, 0]);
        continue;
      }
      if (around.size === 1 && total >= 3) changes.push([i, [...around.keys()][0] >>> 0]);
    }
  }
  return changes;
}

function medianCut(colors, count) {
  let boxes = [colors];
  while (boxes.length < count) {
    let pick = -1;
    let widest = -1;
    let axis = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let k = 0; k < 3; k++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of box) {
          if (c.lab[k] < lo) lo = c.lab[k];
          if (c.lab[k] > hi) hi = c.lab[k];
        }
        const span = (hi - lo) * (k === 0 ? 1 : 1.4) * Math.sqrt(box.reduce((s, c) => s + c.n, 0));
        if (span > widest) {
          widest = span;
          pick = bi;
          axis = k;
        }
      }
    });
    if (pick < 0 || widest <= 0) break;
    const box = boxes[pick].slice().sort((a, b) => a.lab[axis] - b.lab[axis]);
    const half = box.reduce((s, c) => s + c.n, 0) / 2;
    let acc = 0;
    let cut = 1;
    for (let k = 0; k < box.length - 1; k++) {
      acc += box[k].n;
      if (acc >= half) {
        cut = k + 1;
        break;
      }
      cut = k + 1;
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.filter((b) => b.length).map((box) => {
    const n = box.reduce((s, c) => s + c.n, 0);
    const lab = [0, 1, 2].map((k) => box.reduce((s, c) => s + c.lab[k] * c.n, 0) / n);
    return lab;
  });
}

export function reducePalette(pixels, count) {
  const hist = new Map();
  for (const c of pixels) if (opaque(c)) hist.set(c | 0xff000000, (hist.get(c | 0xff000000) || 0) + 1);
  const colors = [...hist].map(([c, n]) => {
    const [r, g, b] = unpack(c >>> 0);
    return { c: c >>> 0, n, lab: rgbToOklab(r, g, b) };
  });
  if (colors.length <= count) return colors.map((x) => x.c);
  let centers = medianCut(colors, count);
  for (let round = 0; round < 6; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const col of colors) {
      let best = 0;
      let dist = Infinity;
      centers.forEach((ctr, k) => {
        const d = (col.lab[0] - ctr[0]) ** 2 + (col.lab[1] - ctr[1]) ** 2 + (col.lab[2] - ctr[2]) ** 2;
        if (d < dist) {
          dist = d;
          best = k;
        }
      });
      const s = sums[best];
      s[0] += col.lab[0] * col.n;
      s[1] += col.lab[1] * col.n;
      s[2] += col.lab[2] * col.n;
      s[3] += col.n;
    }
    centers = centers.map((ctr, k) => (sums[k][3] ? [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]] : ctr));
  }
  const out = [];
  for (const [L, a, b] of centers) {
    const [r, g, bb] = oklabToRgb(L, a, b);
    const c = pack(r, g, bb, 255);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

export function reduceColors(pixels, count, { filter = null } = {}) {
  const n = Math.max(1, Math.min(256, Math.round(count)));
  const source = filter ? pixels.filter((_, i) => filter(i)) : pixels;
  const palette = reducePalette(source, n);
  const labs = palette.map((c) => rgbToOklab(...unpack(c).slice(0, 3)));
  const cache = new Map();
  const changes = [];
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    if (!opaque(c) || !allowed(filter, i)) continue;
    let mapped = cache.get(c);
    if (mapped === undefined) {
      const [r, g, b, a] = unpack(c);
      const lab = rgbToOklab(r, g, b);
      let best = 0;
      let dist = Infinity;
      labs.forEach((l, k) => {
        const d = (lab[0] - l[0]) ** 2 + (lab[1] - l[1]) ** 2 + (lab[2] - l[2]) ** 2;
        if (d < dist) {
          dist = d;
          best = k;
        }
      });
      const [pr, pg, pb] = unpack(palette[best]);
      mapped = pack(pr, pg, pb, a);
      cache.set(c, mapped);
    }
    if (mapped !== c) changes.push([i, mapped]);
  }
  return { changes, palette };
}

export function countColors(pixels) {
  const set = new Set();
  for (const c of pixels) if (opaque(c)) set.add(c);
  return set.size;
}

function lightness(c) {
  const [r, g, b] = unpack(c);
  return rgbToOklab(r, g, b)[0];
}

export function gradientMap(pixels, colors, { filter = null } = {}) {
  const ramp = [...new Set(colors.map((c) => (c | 0xff000000) >>> 0))].sort((a, b) => lightness(a) - lightness(b));
  if (ramp.length < 2) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pixels.length; i++) {
    if (!opaque(pixels[i]) || !allowed(filter, i)) continue;
    const L = lightness(pixels[i]);
    if (L < lo) lo = L;
    if (L > hi) hi = L;
  }
  if (lo === Infinity) return [];
  const span = hi - lo || 1;
  const cache = new Map();
  const changes = [];
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    if (!opaque(c) || !allowed(filter, i)) continue;
    let mapped = cache.get(c);
    if (mapped === undefined) {
      const k = Math.min(ramp.length - 1, Math.max(0, Math.round(((lightness(c) - lo) / span) * (ramp.length - 1))));
      const [r, g, b] = unpack(ramp[k]);
      mapped = pack(r, g, b, unpack(c)[3]);
      cache.set(c, mapped);
    }
    if (mapped !== c) changes.push([i, mapped]);
  }
  return changes;
}

function tone(color, dl, towards) {
  const [r, g, b, a] = unpack(color);
  const [L, C, H] = rgbToOklch(r, g, b);
  const delta = ((((towards - H) % 360) + 540) % 360) - 180;
  const [nr, ng, nb] = oklchToRgb(Math.max(0, Math.min(1, L + dl)), C * (dl > 0 ? 0.92 : 1.02), (H + delta * 0.18 + 360) % 360);
  return pack(nr, ng, nb, a);
}

export function autoShade(pixels, width, height, { light = 'top-left', amount = 0.09, filter = null } = {}) {
  const dirs = { 'top-left': [-1, -1], top: [0, -1], 'top-right': [1, -1], left: [-1, 0], right: [1, 0] };
  const [lx, ly] = dirs[light] || dirs['top-left'];
  const empty = (x, y) => x < 0 || y < 0 || x >= width || y >= height || !opaque(pixels[y * width + x]);
  const changes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = pixels[i];
      if (!opaque(c) || !allowed(filter, i)) continue;
      const lit = empty(x + lx, y + ly) || (lx && empty(x + lx, y)) || (ly && empty(x, y + ly));
      const dark = empty(x - lx, y - ly) || (lx && empty(x - lx, y)) || (ly && empty(x, y - ly));
      if (lit === dark) continue;
      const next = lit ? tone(c, amount, 90) : tone(c, -amount * 1.3, 265);
      if (next !== c) changes.push([i, next]);
    }
  }
  return changes;
}

export function hueShiftRamp(color, steps = 5, { shift = 28 } = {}) {
  const n = Math.max(2, Math.min(16, Math.round(steps)));
  const [r, g, b] = unpack(color);
  const [L, C, H] = rgbToOklch(r, g, b);
  const base = pack(r, g, b, 255);
  const toward = (target, t) => {
    const delta = ((((target - H) % 360) + 540) % 360) - 180;
    return (H + Math.sign(delta) * Math.min(Math.abs(delta), shift * t) + 360) % 360;
  };
  const mid = (n - 1) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = mid === 0 ? 0 : (i - mid) / mid;
    if (Math.abs(t) < 1e-9) {
      out.push(base);
      continue;
    }
    const k = Math.abs(t);
    const dark = t < 0;
    const l = dark ? L - Math.min(0.28, Math.max(0.06, L - 0.06)) * k : L + Math.min(0.3, Math.max(0.04, 0.97 - L)) * k;
    const c = C < 0.02 ? C : C * (dark ? 1 - 0.12 * k : 1 - 0.38 * k);
    const h = C < 0.02 ? H : toward(dark ? 265 : 85, k);
    const [nr, ng, nb] = oklchToRgb(Math.min(0.99, Math.max(0.02, l)), Math.max(0, c), h);
    out.push(pack(nr, ng, nb, 255));
  }
  return [...new Set(out)];
}
