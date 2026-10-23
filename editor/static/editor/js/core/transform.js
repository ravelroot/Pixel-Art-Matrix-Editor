// Pixel-art transforms of regions { width, height, pixels, mask? } (mask absent = whole rectangle):
// exact quarter turns and flips, and a RotSprite-style rotation/scale for any angle (Scale2x upscaling, then
// nearest-neighbor sampling), which never invents colors.

function maskAt(region, i) {
  return !region.mask || region.mask[i] !== 0;
}

// Exact clockwise rotation by turns × 90°.
export function rotateQuarter(region, turns) {
  const t = ((turns % 4) + 4) % 4;
  const { width: w, height: h } = region;
  const width = t % 2 ? h : w;
  const height = t % 2 ? w : h;
  const pixels = new Uint32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = x;
      let ny = y;
      if (t === 1) [nx, ny] = [h - 1 - y, x];
      else if (t === 2) [nx, ny] = [w - 1 - x, h - 1 - y];
      else if (t === 3) [nx, ny] = [y, w - 1 - x];
      const i = y * w + x;
      pixels[ny * width + nx] = region.pixels[i];
      mask[ny * width + nx] = maskAt(region, i) ? 1 : 0;
    }
  }
  return finish(width, height, pixels, mask);
}

export function flipRegion(region, axis) {
  const { width: w, height: h } = region;
  const pixels = new Uint32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = axis === 'horizontal' ? w - 1 - x : x;
      const sy = axis === 'vertical' ? h - 1 - y : y;
      const i = sy * w + sx;
      pixels[y * w + x] = region.pixels[i];
      mask[y * w + x] = maskAt(region, i) ? 1 : 0;
    }
  }
  return finish(w, h, pixels, mask);
}

function finish(width, height, pixels, mask) {
  const out = { width, height, pixels };
  if (mask.some((v) => !v)) {
    for (let i = 0; i < pixels.length; i++) if (!mask[i]) pixels[i] = 0;
    out.mask = mask;
  }
  return out;
}

// Scale2x (EPX): doubles a matrix, rounding diagonal steps instead of making blocks. No new colors.
export function scale2x(pixels, w, h) {
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  const at = (x, y) => pixels[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = pixels[y * w + x];
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const o = y * 2 * W + x * 2;
      out[o] = c === a && c !== d && a !== b ? a : p;
      out[o + 1] = a === b && a !== c && b !== d ? b : p;
      out[o + W] = d === c && d !== b && c !== a ? c : p;
      out[o + W + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out;
}

// RotSprite-style rotation (degrees, clockwise on screen) and scale of a region. Multiples of 90° without
// scaling are exact. The result grows to hold the whole rotated shape and carries the covered pixels as mask.
export function rotSprite(region, angle = 0, scaleX = 1, scaleY = scaleX) {
  const a = ((angle % 360) + 360) % 360;
  if (a % 90 === 0 && scaleX === 1 && scaleY === 1) return rotateQuarter(region, a / 90);
  const { width: w, height: h } = region;
  const passes = w * h <= 128 * 128 ? 3 : w * h <= 256 * 256 ? 2 : 1;
  let up = region.pixels;
  let uw = w;
  let uh = h;
  for (let k = 0; k < passes; k++) {
    up = scale2x(up, uw, uh);
    uw *= 2;
    uh *= 2;
  }
  const k = 1 << passes;
  const t = (a * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const sw = w * scaleX;
  const sh = h * scaleY;
  const width = Math.max(1, Math.ceil(Math.abs(sw * cos) + Math.abs(sh * sin) - 1e-6));
  const height = Math.max(1, Math.ceil(Math.abs(sw * sin) + Math.abs(sh * cos) - 1e-6));
  const pixels = new Uint32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      const u = ox + 0.5 - width / 2;
      const v = oy + 0.5 - height / 2;
      const sx = (u * cos + v * sin) / scaleX + w / 2;
      const sy = (-u * sin + v * cos) / scaleY + h / 2;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = Math.floor(sy) * w + Math.floor(sx);
      if (!maskAt(region, i)) continue;
      const ux = Math.min(uw - 1, Math.floor(sx * k));
      const uy = Math.min(uh - 1, Math.floor(sy * k));
      pixels[oy * width + ox] = up[uy * uw + ux];
      mask[oy * width + ox] = 1;
    }
  }
  return finish(width, height, pixels, mask);
}

// Flip, then rotate and scale (scale in percent).
export function transformRegion(region, { angle = 0, scale = 100, flipH = false, flipV = false } = {}) {
  let r = region;
  if (flipH) r = flipRegion(r, 'horizontal');
  if (flipV) r = flipRegion(r, 'vertical');
  const s = Math.max(0.01, scale / 100);
  return rotSprite(r, angle, s, s);
}
