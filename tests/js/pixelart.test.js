import test from 'node:test';
import assert from 'node:assert/strict';
import { scale2x, scale3x, upscalePixelArt, innerOutline, selectiveOutline, dropShadow, cleanOrphans, reduceColors, reducePalette, countColors } from '../../editor/static/editor/js/core/pixelart.js';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { pack, unpack, rgbToOklab } from '../../editor/static/editor/js/core/colors.js';

const R = pack(200, 40, 40);
const B = pack(30, 30, 120);
const W = pack(250, 250, 250);
const O = 0;

function grid(rows, map) {
  const h = rows.length;
  const w = rows[0].length;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = map[rows[y][x]] ?? 0;
  return { px, w, h };
}

test('Scale2x keeps flat areas and rounds the staircase of a diagonal without new colors', () => {
  const { px, w, h } = grid(['R.', '.R'], { R, '.': O });
  const out = scale2x(px, w, h);
  assert.equal(out.length, 16);
  const colors = new Set(out);
  assert.ok([...colors].every((c) => c === R || c === O), 'no new colors');
  const flat = scale2x(new Uint32Array(9).fill(B), 3, 3);
  assert.ok(flat.every((c) => c === B));
  const d = grid(['R..', 'RR.', 'RRR'], { R, '.': O });
  const up = scale2x(d.px, 3, 3);
  assert.equal(up[3], O, 'the outer corner of the step stays empty');
  assert.equal(up[8], R, 'the step gets a half pixel that rounds the diagonal');
  assert.equal(up[2], O);
});

test('Scale3x and Scale4x give 3× and 4× the size and preserve single-color images', () => {
  const s3 = scale3x(new Uint32Array(4).fill(W), 2, 2);
  assert.equal(s3.length, 36);
  assert.ok(s3.every((c) => c === W));
  const { pixels, width, height } = upscalePixelArt(new Uint32Array([R, B, B, R]), 2, 2, 4);
  assert.deepEqual([width, height, pixels.length], [8, 8, 64]);
  assert.ok(pixels.every((c) => c === R || c === B));
});

test('the document scales every cell with a custom function and keeps the size limits', () => {
  const doc = new PixelDocument(4, 3, { name: 'x' });
  doc.cell(doc.frames[0].id, doc.layers[0].id).fill(R);
  doc.scaleWith(8, 6, (px, w, h) => scale2x(px, w, h));
  assert.deepEqual([doc.width, doc.height], [8, 6]);
  assert.ok(doc.cell(doc.frames[0].id, doc.layers[0].id).every((c) => c === R));
  assert.throws(() => doc.scaleWith(2000, 6, () => new Uint32Array(12000)));
});

test('inner outline paints the border inside, sel-out paints a darker shade of each neighbor outside', () => {
  const { px, w, h } = grid(['.....', '.RRR.', '.RRR.', '.RRR.', '.....'], { R, '.': O });
  const inner = innerOutline(px, w, h, B);
  assert.equal(inner.length, 8, 'the 8 border pixels of the 3×3 square');
  assert.ok(!inner.some(([i]) => i === 2 * w + 2), 'the center stays');
  const sel = selectiveOutline(px, w, h);
  assert.equal(sel.length, 12);
  const [, c] = sel[0];
  const [r, g, b, a] = unpack(c);
  assert.equal(a, 255);
  assert.ok(rgbToOklab(r, g, b)[0] < rgbToOklab(200, 40, 40)[0], 'darker than the neighbor');
});

test('drop shadow goes down and to the right only where it is empty', () => {
  const { px, w, h } = grid(['RR.', 'RR.', '...'], { R, '.': O });
  const out = dropShadow(px, w, h, B);
  assert.deepEqual(out.map(([i]) => i).sort((a, b) => a - b), [5, 7, 8]);
  assert.ok(out.every(([, c]) => c === B));
});

test('clean orphans removes isolated pixels and fixes single pixels surrounded by one color', () => {
  const { px, w, h } = grid(['BBB.....', 'BRB...R.', 'BBB.....'], { R, B, '.': O });
  const out = cleanOrphans(px, w, h);
  const map = new Map(out);
  assert.equal(map.get(1 * w + 6), 0, 'the lonely red pixel is erased');
  assert.equal(map.get(1 * w + 1), B, 'the red pixel inside blue becomes blue');
  assert.equal(out.length, 2);
});

test('reduce colors picks a smaller palette in OKLab and maps every pixel to it', () => {
  const px = new Uint32Array(64);
  for (let i = 0; i < 64; i++) px[i] = pack(i * 4, 255 - i * 4, 128);
  assert.equal(countColors(px), 64);
  const { changes, palette } = reduceColors(px, 4);
  assert.ok(palette.length <= 4 && palette.length >= 2);
  const out = px.slice();
  for (const [i, c] of changes) out[i] = c;
  assert.ok(countColors(out) <= 4);
  assert.deepEqual(reducePalette(new Uint32Array([R, R, B]), 8).sort(), [R, B].sort(), 'keeps the colors when there are few');
  const transparent = new Uint32Array([0, R, B, W]);
  const r2 = reduceColors(transparent, 1);
  assert.ok(!r2.changes.some(([i]) => i === 0), 'transparent pixels stay');
});

test('gradient map follows the lightness of each pixel and auto shading lights one side and darkens the other', async () => {
  const { gradientMap, autoShade } = await import('../../editor/static/editor/js/core/pixelart.js');
  const dark = pack(20, 20, 20);
  const mid = pack(120, 120, 120);
  const light = pack(230, 230, 230);
  const px = new Uint32Array([dark, mid, light, 0]);
  const map = new Map(gradientMap(px, [pack(250, 220, 120), pack(60, 20, 40)]));
  assert.equal(map.get(0), pack(60, 20, 40), 'the darkest pixel takes the darkest palette color');
  assert.equal(map.get(2), pack(250, 220, 120));
  assert.ok(!map.has(3));
  const { px: sq, w, h } = grid(['.....', '.RRR.', '.RRR.', '.RRR.', '.....'], { R, '.': O });
  const shade = new Map(autoShade(sq, w, h));
  const L = (c) => rgbToOklab(...unpack(c).slice(0, 3))[0];
  const base = L(R);
  assert.ok(L(shade.get(1 * w + 1)) > base, 'the top-left corner is lit');
  assert.ok(L(shade.get(3 * w + 3)) < base, 'the bottom-right corner is in shadow');
  assert.ok(!shade.has(2 * w + 2), 'the center stays');
});

test('hue shifted ramps keep the base color in the middle, go from dark to light and bend the hue', async () => {
  const { hueShiftRamp } = await import('../../editor/static/editor/js/core/pixelart.js');
  const { rgbToOklch } = await import('../../editor/static/editor/js/core/colors.js');
  const base = pack(70, 160, 90);
  const ramp = hueShiftRamp(base, 5);
  assert.equal(ramp.length, 5);
  assert.equal(ramp[2], base);
  const lch = ramp.map((c) => rgbToOklch(...unpack(c).slice(0, 3)));
  for (let i = 1; i < lch.length; i++) assert.ok(lch[i][0] > lch[i - 1][0], 'lighter at every step');
  const H = lch[2][2];
  assert.ok(Math.abs(lch[0][2] - H) > 5 && lch[0][2] > H, 'the shadow moves toward blue');
  assert.ok(lch[4][2] < H, 'the light moves toward yellow');
  assert.ok(ramp.every((c) => unpack(c)[3] === 255));
  const gray = hueShiftRamp(pack(128, 128, 128), 3);
  assert.equal(gray.length, 3);
  assert.ok(gray.every((c) => { const [r, g, b] = unpack(c); return Math.abs(r - g) < 4 && Math.abs(g - b) < 6; }), 'grays stay neutral');
  assert.equal(hueShiftRamp(R, 99).length <= 16, true);
});
