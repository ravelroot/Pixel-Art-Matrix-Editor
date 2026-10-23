import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, rgbToOklch } from '../../editor/static/editor/js/core/colors.js';
import { lCorner, pixelPerfect, line } from '../../editor/static/editor/js/core/geometry.js';
import { BAYER, bayerThreshold, patternPixel, linearGradient, radialGradient, gradient } from '../../editor/static/editor/js/core/dither.js';
import {
  rectFrom,
  clipToDocument,
  contains,
  extractRegion,
  pasteRegion,
  indicesOf,
  contentBounds,
  shiftWrapped,
} from '../../editor/static/editor/js/core/selection.js';
import { outline, invert, toGrayscale, convertToPalette, lightnessStep, paletteRamp, paletteStep } from '../../editor/static/editor/js/core/filters.js';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { Stroke, History } from '../../editor/static/editor/js/core/history.js';

const BLACK = pack(0, 0, 0);
const WHITE = pack(255, 255, 255);
const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);

const matrix = (width, height, points, color = BLACK) => {
  const px = new Uint32Array(width * height);
  for (const [x, y] of points) px[y * width + x] = color;
  return px;
};

test('bayer: matrices 2, 4 and 8 are permutations of 0..n²-1', () => {
  for (const n of [2, 4, 8]) {
    const values = BAYER[n].flat().sort((a, b) => a - b);
    assert.deepEqual(values, Array.from({ length: n * n }, (_, i) => i));
  }
  assert.deepEqual(BAYER[4][0], [0, 8, 2, 10]);
  assert.ok(bayerThreshold(0, 0, 4) > 0 && bayerThreshold(0, 0, 4) < 1);
  assert.equal(bayerThreshold(-1, -1, 4), bayerThreshold(3, 3, 4), 'the pattern also repeats at negative coordinates');
});

test('dither: density controls the exact fraction of painted pixels', () => {
  for (const density of [0.125, 0.25, 0.5, 0.75, 0.875]) {
    let painted = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (patternPixel(x, y, density, 4)) painted++;
    assert.equal(painted, Math.round(64 * density));
  }
  // 50% in Bayer 4×4 is a perfect checkerboard.
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.equal(patternPixel(x, y, 0.5, 4), (x + y) % 2 === 0);
});

test('gradient: linear projection and radial distance stay between 0 and 1', () => {
  assert.equal(linearGradient(0, 0, 0, 0, 10, 0), 0);
  assert.equal(linearGradient(5, 3, 0, 0, 10, 0), 0.5);
  assert.equal(linearGradient(20, 0, 0, 0, 10, 0), 1);
  assert.equal(linearGradient(-4, 0, 0, 0, 10, 0), 0);
  assert.equal(linearGradient(3, 3, 2, 2, 2, 2), 0);
  assert.equal(radialGradient(5, 5, 5, 5, 9, 5), 0);
  assert.equal(radialGradient(7, 5, 5, 5, 9, 5), 0.5);
  assert.equal(radialGradient(50, 5, 5, 5, 9, 5), 1);
});

test('gradient: goes from the start color to the end color, only at the requested indices', () => {
  const pairs = new Map(gradient(16, 1, { ax: 0, ay: 0, bx: 15, by: 0, start: BLACK, end: WHITE, matrix: 4 }));
  assert.equal(pairs.get(0), BLACK);
  assert.equal(pairs.get(15), WHITE);
  const whites = [...pairs.values()].filter((c) => c === WHITE).length;
  assert.ok(whites > 4 && whites < 12, 'halfway is dithered');
  const partial = gradient(8, 8, { ax: 0, ay: 0, bx: 7, by: 7, start: BLACK, end: WHITE, indices: [0, 9, 63] });
  assert.deepEqual(partial.map(([i]) => i), [0, 9, 63]);
});

test('pixel perfect: removes the middle pixel of L corners', () => {
  assert.equal(lCorner([0, 0], [1, 0], [1, 1]), true);
  assert.equal(lCorner([0, 0], [1, 0], [2, 0]), false);
  assert.equal(lCorner([0, 0], [1, 1], [2, 2]), false);
  const staircase = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]];
  assert.deepEqual(pixelPerfect(staircase), [[0, 0], [1, 1], [2, 2], [3, 2]]);
  const straight = [];
  line(0, 0, 6, 0, (x, y) => straight.push([x, y]));
  assert.deepEqual(pixelPerfect(straight), straight, 'a straight line does not change');
  assert.deepEqual(pixelPerfect([[1, 1], [1, 1], [2, 1]]), [[1, 1], [2, 1]], 'repeated points are ignored');
});

test('selection: rectangle normalized, clipped and tested', () => {
  assert.deepEqual(rectFrom(5, 6, 2, 1, 16, 16), { x: 2, y: 1, width: 4, height: 6 });
  assert.deepEqual(rectFrom(-3, -3, 40, 2, 16, 16), { x: 0, y: 0, width: 16, height: 3 });
  assert.equal(rectFrom(20, 20, 30, 30, 16, 16), null);
  assert.deepEqual(clipToDocument({ x: 14, y: 14, width: 5, height: 5 }, 16, 16), { x: 14, y: 14, width: 2, height: 2 });
  const r = { x: 2, y: 2, width: 3, height: 3 };
  assert.equal(contains(r, 2, 2), true);
  assert.equal(contains(r, 5, 2), false);
  assert.equal(contains(null, 99, 99), true, 'without a selection the whole matrix counts');
  assert.deepEqual([...indicesOf({ x: 1, y: 1, width: 2, height: 2 }, 4, 4)], [5, 6, 9, 10]);
});

test('selection: copy and paste a region, clipping at the edges', () => {
  const px = matrix(4, 4, [[1, 1], [2, 2]], RED);
  const region = extractRegion(px, 4, { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual([...region.pixels], [RED, 0, 0, RED]);
  const dest = new Uint32Array(16).fill(BLUE);
  pasteRegion(region, 4, 4, 3, 3, (i, c) => (dest[i] = c));
  assert.equal(dest[15], RED, 'only the corner that fits is pasted');
  assert.equal(dest.filter((c) => c === RED).length, 1);
  const opaque = new Uint32Array(16).fill(BLUE);
  pasteRegion(region, 4, 4, 0, 0, (i, c) => (opaque[i] = c), { opaqueOnly: true });
  assert.equal(opaque[1], BLUE, 'transparent does not erase what is below');
  assert.equal(opaque[0], RED);
});

test('trim: content bounds across several cells', () => {
  const a = matrix(8, 8, [[2, 3]]);
  const b = matrix(8, 8, [[5, 1]]);
  assert.deepEqual(contentBounds([a, b], 8, 8), { x: 2, y: 1, width: 4, height: 3 });
  assert.equal(contentBounds([new Uint32Array(64)], 8, 8), null);
});

test('document: cropping keeps the pixels of every layer and frame', () => {
  const doc = new PixelDocument(8, 8);
  doc.addLayer('Cima');
  doc.addFrame();
  const [q1, q2] = doc.frames;
  const [c1, c2] = doc.layers;
  doc.cell(q1.id, c1.id)[3 * 8 + 4] = RED;
  doc.cell(q2.id, c2.id)[5 * 8 + 6] = BLUE;
  doc.crop(4, 3, 3, 3);
  assert.equal(doc.width, 3);
  assert.equal(doc.height, 3);
  assert.equal(doc.cell(q1.id, c1.id)[0], RED);
  assert.equal(doc.cell(q2.id, c2.id)[2 * 3 + 2], BLUE);
  assert.throws(() => doc.crop(0, 0, 0, 3));
});

test('tile: shifting with wrap-around is reversible', () => {
  const px = matrix(5, 3, [[0, 0], [4, 2]]);
  const mid = shiftWrapped(px, 5, 3, 2, 1);
  assert.equal(mid[1 * 5 + 2], BLACK);
  assert.equal(mid[0 * 5 + 1], BLACK, 'what leaves on the right/bottom comes back on the left/top');
  assert.deepEqual([...shiftWrapped(mid, 5, 3, -2, -1)], [...px]);
});

test('outline: 4 and 8 neighbors around a pixel', () => {
  const px = matrix(5, 5, [[2, 2]]);
  assert.equal(outline(px, 5, 5, RED, { neighbors: 4 }).length, 4);
  assert.equal(outline(px, 5, 5, RED, { neighbors: 8 }).length, 8);
  const rightOnly = outline(px, 5, 5, RED, { neighbors: 8, filter: (i) => i % 5 === 3 });
  assert.equal(rightOnly.length, 3);
  assert.ok(rightOnly.every(([, c]) => c === RED));
});

test('filters: invert, grayscale and palette conversion keep the alpha', () => {
  const semi = pack(255, 0, 0, 128);
  const px = Uint32Array.from([semi, 0, WHITE]);
  const inverted = new Map(invert(px));
  assert.deepEqual(unpack(inverted.get(0)), [0, 255, 255, 128]);
  assert.equal(inverted.has(1), false, 'transparent stays as it is');
  assert.equal(inverted.get(2), BLACK);
  const grayscale = new Map(toGrayscale(px));
  const [r, g, b, a] = unpack(grayscale.get(0));
  assert.ok(r === g && g === b && a === 128);
  const converted = new Map(convertToPalette(Uint32Array.from([pack(250, 10, 10), pack(20, 20, 240, 77)]), ['#ff0000', '#0000ff', '#ffffff']));
  assert.equal(converted.get(0), RED);
  assert.deepEqual(unpack(converted.get(1)), [0, 0, 255, 77]);
  assert.deepEqual(convertToPalette(Uint32Array.from([RED]), []), []);
});

test('lighten and darken: OKLCH lightness and palette ramp', () => {
  const base = pack(120, 60, 40);
  const [r, g, b] = unpack(base);
  const L = rgbToOklch(r, g, b)[0];
  const lighter = unpack(lightnessStep(base, 0.1));
  const darker = unpack(lightnessStep(base, -0.1));
  assert.ok(rgbToOklch(...lighter.slice(0, 3))[0] > L);
  assert.ok(rgbToOklch(...darker.slice(0, 3))[0] < L);
  assert.equal(lightnessStep(0, 0.2), 0, 'transparent does not change');
  const ramp = paletteRamp(['#ffffff', '#000000', '#808080', '#808080']);
  assert.equal(ramp.length, 3, 'repeated colors are added once');
  assert.equal(paletteStep(BLACK, ramp, 1), pack(128, 128, 128));
  assert.equal(paletteStep(WHITE, ramp, 1), WHITE, 'at the top of the ramp it does not go past the end');
  assert.equal(paletteStep(pack(10, 10, 10), ramp, 1), BLACK, 'a color outside the palette goes to the nearest one');
});

test('history: moving pixels along the stroke becomes a single undoable step', () => {
  const doc = new PixelDocument(4, 4);
  const [q] = doc.frames;
  const [c] = doc.layers;
  const px = doc.cell(q.id, c.id);
  px[0] = RED;
  const h = new History();
  const stroke = new Stroke(doc.key(q.id, c.id), px);
  const region = extractRegion(px, 4, { x: 0, y: 0, width: 1, height: 1 });
  for (const dx of [1, 2, 3]) {
    stroke.revertVisual();
    stroke.paint(0, 0);
    pasteRegion(region, 4, 4, dx, 0, (i, color) => stroke.paint(i, color), { opaqueOnly: true });
  }
  h.record(stroke.finish('Mover pixels'));
  assert.equal(px[3], RED);
  assert.equal(px[0], 0);
  assert.equal(px[1], 0, 'intermediate positions leave no trail');
  h.undo(doc);
  assert.equal(px[0], RED);
  assert.equal(px[3], 0);
});
