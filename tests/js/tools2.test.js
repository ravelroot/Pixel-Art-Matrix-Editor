import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, overlay } from '../../editor/static/editor/js/core/colors.js';
import { bezier, line } from '../../editor/static/editor/js/core/geometry.js';
import {
  INK_MODES,
  applyInk,
  seededRandom,
  sprayPoints,
  sprayCount,
  brushFromRegion,
  blurPixel,
  jumble,
  jumbleTarget,
} from '../../editor/static/editor/js/core/brush.js';

const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);
const HALF_BLUE = pack(0, 0, 255, 128);
const HALF_RED = pack(255, 0, 0, 128);

test('ink modes: simple, alpha compositing, lock alpha and behind', () => {
  assert.deepEqual(INK_MODES, ['simple', 'composite', 'lockAlpha', 'behind']);
  assert.equal(applyInk(RED, HALF_BLUE, 'simple'), HALF_BLUE, 'simple replaces, like 2.0.0');
  assert.equal(applyInk(RED, HALF_BLUE, 'composite'), overlay(RED, HALF_BLUE));
  assert.equal(applyInk(RED, BLUE, 'composite'), BLUE, 'an opaque color covers');
  assert.equal(applyInk(0, HALF_BLUE, 'composite'), HALF_BLUE);
  assert.equal(applyInk(0, BLUE, 'lockAlpha'), null, 'lock alpha never paints transparent pixels');
  assert.equal(applyInk(HALF_RED, BLUE, 'lockAlpha'), pack(0, 0, 255, 128), 'lock alpha keeps the alpha of the pixel');
  assert.equal(applyInk(RED, BLUE, 'behind'), null, 'behind leaves opaque pixels alone');
  assert.equal(applyInk(0, BLUE, 'behind'), BLUE, 'behind paints where it is transparent');
  assert.equal(applyInk(HALF_RED, BLUE, 'behind'), overlay(BLUE, HALF_RED), 'behind shows the color under semi-transparent pixels');
});

test('spray: a seeded generator repeats the same points, all inside the radius', () => {
  const a = sprayPoints(10, 10, 5, 40, seededRandom(42));
  const b = sprayPoints(10, 10, 5, 40, seededRandom(42));
  const c = sprayPoints(10, 10, 5, 40, seededRandom(7));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 40);
  for (const [x, y] of sprayPoints(0, 0, 1, 200, seededRandom(3))) assert.ok(Number.isInteger(x) && Number.isInteger(y) && x * x + y * y <= 1);
  for (const [x, y] of a) assert.ok((x - 10) ** 2 + (y - 10) ** 2 <= 25, `${x},${y} is outside the radius`);
  const rng = seededRandom(1);
  for (let k = 0; k < 1000; k++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1);
  }
  assert.equal(sprayCount(1, 1), 1, 'always at least one point');
  assert.ok(sprayCount(16, 100) > sprayCount(16, 10));
});

test('curve: the Bézier starts and ends at its endpoints and has no gaps', () => {
  const pts = [];
  bezier([0, 0], [8, 0], [8, 8], [0, 8], (x, y) => pts.push([x, y]));
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [0, 8]);
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    assert.ok(Math.max(Math.abs(ax - bx), Math.abs(ay - by)) === 1, 'consecutive pixels touch');
  }
  assert.equal(new Set(pts.map(String)).size, pts.length, 'no pixel twice');
  const straight = [];
  bezier([0, 0], [0, 0], [6, 3], [6, 3], (x, y) => straight.push([x, y]));
  const ref = [];
  line(0, 0, 6, 3, (x, y) => ref.push([x, y]));
  assert.deepEqual(straight[0], ref[0]);
  assert.deepEqual(straight.at(-1), ref.at(-1));
});

test('custom brush: made from the visible pixels, centered', () => {
  const b = brushFromRegion({ width: 3, height: 3, pixels: Uint32Array.of(0, RED, 0, RED, BLUE, RED, 0, RED, 0) });
  assert.equal(b.points.length, 5);
  assert.deepEqual(b.points.find(([dx, dy]) => dx === 0 && dy === 0), [0, 0, BLUE]);
  assert.deepEqual(b.points.find(([dx, dy]) => dx === -1 && dy === 0), [-1, 0, RED]);
  const masked = brushFromRegion({ width: 2, height: 1, pixels: Uint32Array.of(RED, RED), mask: Uint8Array.of(1, 0) });
  assert.equal(masked.points.length, 1);
  assert.equal(brushFromRegion({ width: 1, height: 1, pixels: Uint32Array.of(0) }), null);
});

test('blur: averages neighbors by alpha, keeps alpha and transparency', () => {
  const w = 3;
  const px = Uint32Array.of(RED, RED, RED, BLUE, BLUE, BLUE, 0, 0, HALF_RED);
  const read = (x, y) => px[y * w + x];
  assert.equal(blurPixel(read, 3, 3, 0, 2), 0, 'transparent stays transparent');
  const center = blurPixel(read, 3, 3, 1, 1);
  assert.equal(center >>> 24, 255, 'alpha of the pixel is kept');
  assert.ok((center & 255) > 0 && ((center >>> 16) & 255) > 0, 'mixes red and blue');
  assert.equal(blurPixel(read, 3, 3, 2, 2) >>> 24, 128);
  const flat = new Uint32Array(9).fill(RED);
  assert.equal(blurPixel((x, y) => flat[y * 3 + x], 3, 3, 1, 1), RED, 'a flat area does not change');
});

test('jumble: swaps neighbors without creating or losing colors', () => {
  const w = 6;
  const h = 5;
  const px = new Uint32Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = [RED, BLUE, 0, HALF_RED][i % 4];
  const before = [...px].sort();
  const points = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) points.push([x, y]);
  jumble(px, w, h, points, seededRandom(9));
  assert.deepEqual([...px].sort(), before, 'same multiset of colors (palette and alpha preserved)');
  const again = new Uint32Array(w * h);
  for (let i = 0; i < again.length; i++) again[i] = [RED, BLUE, 0, HALF_RED][i % 4];
  jumble(again, w, h, points, seededRandom(9));
  assert.deepEqual([...again], [...px], 'deterministic with the same seed');
  assert.equal(jumbleTarget(0, 0, 1, 1, seededRandom(1)), -1, 'a 1×1 matrix has no neighbor');
  const only = jumbleTarget(1, 1, 3, 3, seededRandom(2), (x, y) => x === 2 && y === 1);
  assert.equal(only, 1 * 3 + 2, 'respects the allowed area (selection)');
});
