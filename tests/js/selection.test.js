import test from 'node:test';
import assert from 'node:assert/strict';
import { pack } from '../../editor/static/editor/js/core/colors.js';
import { polygon } from '../../editor/static/editor/js/core/geometry.js';
import { region } from '../../editor/static/editor/js/core/fill.js';
import {
  rectFrom,
  clipToDocument,
  contains,
  trimMask,
  extractRegion,
  pasteRegion,
  indicesOf,
  combineSelections,
  invertSelection,
  expandSelection,
  selectionFromIndices,
  selectionFromPoints,
  selectionEdges,
  toDocumentMask,
} from '../../editor/static/editor/js/core/selection.js';
import { rotSprite, rotateQuarter, flipRegion, scale2x, transformRegion } from '../../editor/static/editor/js/core/transform.js';

const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);
const W = 8;
const H = 6;

const maskString = (sel, w = W, h = H) => {
  const m = toDocumentMask(sel, w, h);
  const rows = [];
  for (let y = 0; y < h; y++) rows.push([...m.subarray(y * w, y * w + w)].map((v) => (v ? '#' : '.')).join(''));
  return rows;
};

const fromRows = (rows) => selectionFromPoints((p) => rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && p(x, y))), rows[0].length, rows.length);

test('mask: rectangles keep the 2.0.0 shape and trimmed masks drop to rectangles', () => {
  const r = combineSelections(null, rectFrom(1, 1, 3, 2, W, H), 'replace', W, H);
  assert.deepEqual(r, { x: 1, y: 1, width: 3, height: 2 });
  assert.equal('mask' in r, false);
  const full = trimMask({ x: 2, y: 2, width: 2, height: 1, mask: Uint8Array.of(1, 1) });
  assert.deepEqual(full, { x: 2, y: 2, width: 2, height: 1 });
  assert.equal(trimMask({ x: 0, y: 0, width: 2, height: 2, mask: new Uint8Array(4) }), null);
  const trimmed = trimMask({ x: 0, y: 0, width: 3, height: 3, mask: Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 1, 1) });
  assert.deepEqual({ ...trimmed, mask: [...trimmed.mask] }, { x: 1, y: 1, width: 2, height: 2, mask: [1, 0, 1, 1] });
});

test('mask: add, subtract, intersect and invert', () => {
  const a = rectFrom(0, 0, 3, 3, W, H);
  const b = rectFrom(2, 2, 5, 4, W, H);
  assert.deepEqual(maskString(combineSelections(a, b, 'add', W, H)), ['####....', '####....', '######..', '######..', '..####..', '........']);
  assert.deepEqual(maskString(combineSelections(a, b, 'subtract', W, H)), ['####....', '####....', '##......', '##......', '........', '........']);
  const inter = combineSelections(a, b, 'intersect', W, H);
  assert.deepEqual(inter, { x: 2, y: 2, width: 2, height: 2 });
  assert.equal(combineSelections(a, rectFrom(6, 5, 7, 5, W, H), 'intersect', W, H), null, 'disjoint intersection is empty');
  assert.deepEqual(combineSelections(null, b, 'add', W, H), b, 'adding to nothing gives the shape');
  assert.equal(combineSelections(null, b, 'subtract', W, H), null);
  const inv = invertSelection(a, W, H);
  assert.deepEqual(maskString(inv), ['....####', '....####', '....####', '....####', '########', '########']);
  assert.deepEqual(invertSelection(inv, W, H), a, 'inverting twice gives the rectangle back');
  assert.deepEqual(invertSelection(null, W, H), { x: 0, y: 0, width: W, height: H }, 'no selection inverts to everything');
});

test('mask: contains, indicesOf and clipping honor the mask', () => {
  const sel = fromRows(['#...', '.#..', '..#.']);
  assert.deepEqual({ x: sel.x, y: sel.y, width: sel.width, height: sel.height }, { x: 0, y: 0, width: 3, height: 3 });
  assert.equal(contains(sel, 0, 0), true);
  assert.equal(contains(sel, 1, 0), false);
  assert.equal(contains(sel, 2, 2), true);
  assert.equal(contains(sel, 3, 3), false);
  assert.equal(contains(null, 3, 3), true);
  assert.deepEqual([...indicesOf(sel, 4, 3)], [0, 5, 10]);
  const moved = { ...sel, x: -1, y: 0 };
  const clipped = clipToDocument(moved, 4, 3);
  assert.deepEqual([...indicesOf(clipped, 4, 3)], [4, 9]);
  assert.equal(selectionEdges(rectFrom(0, 0, 1, 1, 4, 4)).length, 4, 'a rectangle has 4 merged edges');
  assert.equal(selectionEdges(sel).length, 8, 'touching edges of the diagonal staircase merge into runs');
});

test('mask: extract and paste carry only the selected pixels', () => {
  const px = new Uint32Array(16).fill(RED);
  const sel = fromRows(['##..', '#...', '....', '....']);
  const reg = extractRegion(px, 4, sel);
  assert.deepEqual([...reg.pixels], [RED, RED, RED, 0]);
  assert.deepEqual([...reg.mask], [1, 1, 1, 0]);
  const dest = new Uint32Array(16).fill(BLUE);
  pasteRegion({ ...reg, pixels: Uint32Array.of(RED, RED, RED, RED) }, 4, 4, 2, 2, (i, c) => (dest[i] = c));
  assert.equal(dest[2 * 4 + 2], RED);
  assert.equal(dest[3 * 4 + 3], BLUE, 'pixels outside the mask are never pasted');
  const plain = extractRegion(px, 4, { x: 0, y: 0, width: 2, height: 2 });
  assert.equal('mask' in plain, false);
});

test('lasso and polygon: closed shapes fill their inside and keep their edges', () => {
  const tri = selectionFromPoints((p) => polygon([[0, 0], [5, 0], [0, 5]], true, p), W, H);
  assert.deepEqual(maskString(tri), ['######..', '#####...', '####....', '###.....', '##......', '#.......']);
  const outline = [];
  polygon([[0, 0], [3, 0], [3, 3], [0, 3]], false, (x, y) => outline.push(`${x},${y}`));
  assert.equal(new Set(outline).size, 12, 'outline of a 4×4 square');
  assert.ok(!outline.includes('1,1'));
  const thin = selectionFromPoints((p) => polygon([[1, 1], [6, 1]], true, p), W, H);
  assert.deepEqual(thin, { x: 1, y: 1, width: 6, height: 1 }, 'a lasso along a line still selects the line');
});

test('magic wand: contiguous and global selection by color', () => {
  const px = new Uint32Array(W * H);
  for (const [x, y] of [[1, 1], [2, 1], [5, 4]]) px[y * W + x] = RED;
  const near = selectionFromIndices(region(px, W, H, 1, 1, { contiguous: true }), W, H);
  assert.deepEqual(near, { x: 1, y: 1, width: 2, height: 1 });
  const all = selectionFromIndices(region(px, W, H, 1, 1, { contiguous: false }), W, H);
  assert.deepEqual({ x: all.x, y: all.y, width: all.width, height: all.height }, { x: 1, y: 1, width: 5, height: 4 });
  assert.equal(all.mask.reduce((s, v) => s + v, 0), 3);
  const background = selectionFromIndices(region(px, W, H, 0, 0, { contiguous: true }), W, H);
  assert.equal(contains(background, 1, 1), false);
  assert.equal(contains(background, 7, 5), true);
});

test('expand and contract selection with a square brush', () => {
  const r = rectFrom(3, 2, 4, 3, W, H);
  assert.deepEqual(expandSelection(r, 1, W, H), { x: 2, y: 1, width: 4, height: 4 });
  assert.deepEqual(expandSelection(r, 10, W, H), { x: 0, y: 0, width: W, height: H }, 'expanding stops at the edges');
  assert.deepEqual(expandSelection(expandSelection(r, 2, W, H), -2, W, H), r);
  assert.equal(expandSelection(r, -1, W, H), null, 'contracting a 2×2 by 1 empties it');
  assert.deepEqual(expandSelection({ x: 0, y: 0, width: W, height: H }, -1, W, H), { x: 1, y: 1, width: W - 2, height: H - 2 });
  const dot = fromRows(['.....', '..#..', '.....']);
  assert.deepEqual(maskString(expandSelection(dot, 1, 5, 3), 5, 3), ['.###.', '.###.', '.###.']);
});

const sample = () => {
  const w = 5;
  const h = 3;
  const pixels = new Uint32Array(w * h);
  for (let i = 0; i < pixels.length; i++) pixels[i] = pack(i * 10, 255 - i * 10, i, 255);
  return { width: w, height: h, pixels };
};

test('rotsprite: 0° is the identity and 90° steps are exact rotations', () => {
  const r = sample();
  assert.deepEqual(rotSprite(r, 0), r);
  assert.deepEqual(rotSprite(r, 360), r);
  const q = rotateQuarter(r, 1);
  assert.equal(q.width, 3);
  assert.equal(q.height, 5);
  assert.equal(q.pixels[0 * 3 + 2], r.pixels[0], 'top-left goes to top-right (clockwise)');
  assert.equal(q.pixels[4 * 3 + 2], r.pixels[4], 'top-right goes to bottom-right');
  assert.deepEqual(rotSprite(r, 90), q);
  assert.deepEqual(rotSprite(r, -270), q);
  assert.deepEqual(rotSprite(r, 180), rotateQuarter(r, 2));
  assert.deepEqual(rotateQuarter(rotateQuarter(r, 1), 3), r);
});

test('rotsprite: any angle and scale only reuse the original colors', () => {
  const r = sample();
  const colors = new Set(r.pixels);
  for (const [angle, scale] of [[30, 1], [45, 1], [17, 1.5], [0, 2], [200, 0.5]]) {
    const t = rotSprite(r, angle, scale, scale);
    for (let i = 0; i < t.pixels.length; i++) {
      if (t.mask && !t.mask[i]) assert.equal(t.pixels[i], 0);
      else assert.ok(colors.has(t.pixels[i]), `angle ${angle}: color ${t.pixels[i]} is new`);
    }
  }
  const big = rotSprite(r, 0, 2, 2);
  assert.equal(big.width, 10);
  assert.equal(big.height, 6);
  const diagonal = rotSprite({ width: 4, height: 4, pixels: new Uint32Array(16).fill(RED) }, 45);
  assert.ok(diagonal.width >= 5 && diagonal.width <= 6, 'the box grows to hold the rotated square');
  assert.ok(diagonal.mask, 'corners outside the rotated square are not covered');
  // Scale2x keeps a single pixel square and rounds diagonals.
  assert.deepEqual([...scale2x(Uint32Array.of(RED), 1, 1)], [RED, RED, RED, RED]);
});

test('transform: flips carry the mask along', () => {
  const r = { width: 3, height: 1, pixels: Uint32Array.of(RED, 0, BLUE), mask: Uint8Array.of(1, 0, 1) };
  const f = flipRegion(r, 'horizontal');
  assert.deepEqual([...f.pixels], [BLUE, 0, RED]);
  assert.deepEqual([...f.mask], [1, 0, 1]);
  const t = transformRegion({ width: 2, height: 1, pixels: Uint32Array.of(RED, BLUE) }, { flipH: true });
  assert.deepEqual([...t.pixels], [BLUE, RED]);
});
