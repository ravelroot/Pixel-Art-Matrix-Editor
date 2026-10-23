// Selections and region operations on Uint32Array matrices (packed RGBA).
// A selection is { x, y, width, height, mask? }: `mask` is a Uint8Array(width * height) (1 = selected) for
// non-rectangular selections. A missing (or null) mask means the whole rectangle is selected, so plain
// rectangles keep exactly the 2.0.0 shape { x, y, width, height }.

// Normalizes two corners (in any order) into a rectangle { x, y, width, height } clipped to the matrix.
export function rectFrom(x0, y0, x1, y1, docWidth, docHeight) {
  let xa = Math.max(0, Math.min(x0, x1));
  let ya = Math.max(0, Math.min(y0, y1));
  let xb = Math.min(docWidth - 1, Math.max(x0, x1));
  let yb = Math.min(docHeight - 1, Math.max(y0, y1));
  if (xb < xa || yb < ya) return null;
  return { x: xa, y: ya, width: xb - xa + 1, height: yb - ya + 1 };
}

// Clips any selection (it may be outside the matrix) to the document bounds. Masks are cropped and trimmed.
export function clipToDocument(r, docWidth, docHeight) {
  if (!r) return null;
  const rect = rectFrom(r.x, r.y, r.x + r.width - 1, r.y + r.height - 1, docWidth, docHeight);
  if (!rect || !r.mask) return rect;
  const mask = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = (rect.y + y - r.y) * r.width + (rect.x - r.x);
    mask.set(r.mask.subarray(from, from + rect.width), y * rect.width);
  }
  return trimMask({ ...rect, mask });
}

export function contains(r, x, y) {
  if (!r) return true;
  if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) return false;
  return !r.mask || r.mask[(y - r.y) * r.width + (x - r.x)] !== 0;
}

// Makes a selection canonical: trims its mask to the bounding box of the selected pixels, drops the mask when
// the whole box is selected and returns null when nothing is selected.
export function trimMask(r) {
  if (!r) return null;
  if (!r.mask) return { x: r.x, y: r.y, width: r.width, height: r.height };
  let xa = r.width;
  let ya = r.height;
  let xb = -1;
  let yb = -1;
  let count = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (!r.mask[y * r.width + x]) continue;
      count++;
      if (x < xa) xa = x;
      if (x > xb) xb = x;
      if (y < ya) ya = y;
      if (y > yb) yb = y;
    }
  }
  if (xb < 0) return null;
  const width = xb - xa + 1;
  const height = yb - ya + 1;
  const out = { x: r.x + xa, y: r.y + ya, width, height };
  if (count === width * height) return out;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const from = (ya + y) * r.width + xa;
    mask.set(r.mask.subarray(from, from + width), y * width);
  }
  out.mask = mask;
  return out;
}

// Selection as a document-sized mask (1 = selected). A null selection gives an empty mask.
export function toDocumentMask(r, docWidth, docHeight) {
  const out = new Uint8Array(docWidth * docHeight);
  const c = clipToDocument(r, docWidth, docHeight);
  if (!c) return out;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (!c.mask || c.mask[y * c.width + x]) out[(c.y + y) * docWidth + c.x + x] = 1;
    }
  }
  return out;
}

export function fromDocumentMask(mask, docWidth, docHeight) {
  return trimMask({ x: 0, y: 0, width: docWidth, height: docHeight, mask });
}

// Selection made of the given pixel indices (or of the pixels for which select(x, y) is called).
export function selectionFromIndices(indices, docWidth, docHeight) {
  const mask = new Uint8Array(docWidth * docHeight);
  for (const i of indices) if (i >= 0 && i < mask.length) mask[i] = 1;
  return fromDocumentMask(mask, docWidth, docHeight);
}

export function selectionFromPoints(draw, docWidth, docHeight) {
  const mask = new Uint8Array(docWidth * docHeight);
  draw((x, y) => {
    if (x >= 0 && y >= 0 && x < docWidth && y < docHeight) mask[y * docWidth + x] = 1;
  });
  return fromDocumentMask(mask, docWidth, docHeight);
}

export const SELECTION_MODES = ['replace', 'add', 'subtract', 'intersect'];

// Combines the current selection with a new shape: replace, add (union), subtract or intersect.
export function combineSelections(current, shape, mode, docWidth, docHeight) {
  if (mode === 'replace' || !SELECTION_MODES.includes(mode)) return clipToDocument(shape, docWidth, docHeight);
  if (mode === 'add' && !current) return clipToDocument(shape, docWidth, docHeight);
  const a = toDocumentMask(current, docWidth, docHeight);
  const b = toDocumentMask(shape, docWidth, docHeight);
  for (let i = 0; i < a.length; i++) {
    if (mode === 'add') a[i] = a[i] | b[i];
    else if (mode === 'subtract') a[i] = a[i] & (b[i] ^ 1);
    else a[i] = a[i] & b[i];
  }
  return fromDocumentMask(a, docWidth, docHeight);
}

// Everything that is not selected (no selection: everything).
export function invertSelection(r, docWidth, docHeight) {
  const m = toDocumentMask(r, docWidth, docHeight);
  for (let i = 0; i < m.length; i++) m[i] ^= 1;
  return fromDocumentMask(m, docWidth, docHeight);
}

// Grows (amount > 0) or shrinks (amount < 0) the selection by whole pixels, with a square brush (a rectangle
// grows into a rectangle). Outside the matrix counts as not selected.
export function expandSelection(r, amount, docWidth, docHeight) {
  if (!r || !amount) return clipToDocument(r, docWidth, docHeight);
  const grow = amount > 0;
  const n = Math.abs(amount);
  let m = toDocumentMask(r, docWidth, docHeight);
  const pass = (src, horizontal) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < docHeight; y++) {
      for (let x = 0; x < docWidth; x++) {
        let v = grow ? 0 : 1;
        for (let k = -n; k <= n; k++) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          const inside = sx >= 0 && sy >= 0 && sx < docWidth && sy < docHeight;
          const s = inside ? src[sy * docWidth + sx] : 0;
          if (grow && s) {
            v = 1;
            break;
          }
          if (!grow && !s) {
            v = 0;
            break;
          }
        }
        out[y * docWidth + x] = v;
      }
    }
    return out;
  };
  m = pass(pass(m, true), false);
  return fromDocumentMask(m, docWidth, docHeight);
}

// Outline of the selected area as unit edges merged into runs: [x0, y0, x1, y1] in matrix coordinates.
export function selectionEdges(r) {
  if (!r) return [];
  const { x: ox, y: oy, width: w, height: h } = r;
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (!r.mask || r.mask[y * w + x] !== 0);
  const edges = [];
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y - 1) !== at(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        edges.push([ox + start, oy + y, ox + x, oy + y]);
        start = -1;
      }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x - 1, y) !== at(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        edges.push([ox + x, oy + start, ox + x, oy + y]);
        start = -1;
      }
    }
  }
  return edges;
}

// Copies the pixels of a selection into a new matrix { width, height, pixels, mask? }. Pixels outside the mask
// come out transparent and the region carries a copy of the mask.
export function extractRegion(pixels, docWidth, r) {
  const output = new Uint32Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const start = (r.y + y) * docWidth + r.x;
    output.set(pixels.subarray(start, start + r.width), y * r.width);
  }
  const region = { width: r.width, height: r.height, pixels: output };
  if (r.mask) {
    for (let i = 0; i < output.length; i++) if (!r.mask[i]) output[i] = 0;
    region.mask = r.mask.slice();
  }
  return region;
}

// Calls paint(index, color) for each pixel of the region pasted at (x0, y0), clipping to the document.
// With opaqueOnly, transparent pixels of the region do not erase what is below. Pixels outside the region's
// mask (if any) are never pasted.
export function pasteRegion(region, docWidth, docHeight, x0, y0, paint, { opaqueOnly = false } = {}) {
  for (let y = 0; y < region.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= docHeight) continue;
    for (let x = 0; x < region.width; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= docWidth) continue;
      if (region.mask && !region.mask[y * region.width + x]) continue;
      const color = region.pixels[y * region.width + x];
      if (opaqueOnly && !(color >>> 24)) continue;
      paint(ty * docWidth + tx, color);
    }
  }
}

// Indices of all selected pixels of a selection (or of the whole matrix, if r is null).
export function indicesOf(r, docWidth, docHeight) {
  const area = r ?? { x: 0, y: 0, width: docWidth, height: docHeight };
  const mask = area.mask;
  let count = area.width * area.height;
  if (mask) {
    count = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  }
  const output = new Uint32Array(count);
  let k = 0;
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      if (mask && !mask[y * area.width + x]) continue;
      output[k++] = (area.y + y) * docWidth + area.x + x;
    }
  }
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
