// Rectangular selection and region operations on Uint32Array matrices (packed RGBA).

// Normalizes two corners (in any order) into a rectangle { x, y, width, height } clipped to the matrix.
export function rectFrom(x0, y0, x1, y1, docWidth, docHeight) {
  let xa = Math.max(0, Math.min(x0, x1));
  let ya = Math.max(0, Math.min(y0, y1));
  let xb = Math.min(docWidth - 1, Math.max(x0, x1));
  let yb = Math.min(docHeight - 1, Math.max(y0, y1));
  if (xb < xa || yb < ya) return null;
  return { x: xa, y: ya, width: xb - xa + 1, height: yb - ya + 1 };
}

// Clips any rectangle (it may be outside the matrix) to the document bounds.
export function clipToDocument(r, docWidth, docHeight) {
  if (!r) return null;
  return rectFrom(r.x, r.y, r.x + r.width - 1, r.y + r.height - 1, docWidth, docHeight);
}

export function contains(r, x, y) {
  return !r || (x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height);
}

// Copies the pixels of a rectangle into a new matrix { width, height, pixels }.
export function extractRegion(pixels, docWidth, r) {
  const output = new Uint32Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const start = (r.y + y) * docWidth + r.x;
    output.set(pixels.subarray(start, start + r.width), y * r.width);
  }
  return { width: r.width, height: r.height, pixels: output };
}

// Calls paint(index, color) for each pixel of the region pasted at (x0, y0), clipping to the document.
// With opaqueOnly, transparent pixels of the region do not erase what is below.
export function pasteRegion(region, docWidth, docHeight, x0, y0, paint, { opaqueOnly = false } = {}) {
  for (let y = 0; y < region.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= docHeight) continue;
    for (let x = 0; x < region.width; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= docWidth) continue;
      const color = region.pixels[y * region.width + x];
      if (opaqueOnly && !(color >>> 24)) continue;
      paint(ty * docWidth + tx, color);
    }
  }
}

// Indices of all pixels of a rectangle (or of the whole matrix, if r is null).
export function indicesOf(r, docWidth, docHeight) {
  const area = r ?? { x: 0, y: 0, width: docWidth, height: docHeight };
  const output = new Uint32Array(area.width * area.height);
  let k = 0;
  for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) output[k++] = y * docWidth + x;
  return output;
}

// Smallest rectangle that contains all non-transparent pixels of several matrices of the same size.
export function contentBounds(matrices, width, height) {
  let xa = width;
  let ya = height;
  let xb = -1;
  let yb = -1;
  for (const px of matrices) {
    for (let y = 0; y < height; y++) {
      const base = y * width;
      for (let x = 0; x < width; x++) {
        if (!(px[base + x] >>> 24)) continue;
        if (x < xa) xa = x;
        if (x > xb) xb = x;
        if (y < ya) ya = y;
        if (y > yb) yb = y;
      }
    }
  }
  if (xb < 0) return null;
  return { x: xa, y: ya, width: xb - xa + 1, height: yb - ya + 1 };
}

// Shifts the matrix with wrap-around: what leaves on one side comes back on the other.
export function shiftWrapped(pixels, width, height, dx, dy) {
  const output = new Uint32Array(pixels.length);
  const mx = ((dx % width) + width) % width;
  const my = ((dy % height) + height) % height;
  for (let y = 0; y < height; y++) {
    const ny = (y + my) % height;
    for (let x = 0; x < width; x++) output[ny * width + ((x + mx) % width)] = pixels[y * width + x];
  }
  return output;
}
