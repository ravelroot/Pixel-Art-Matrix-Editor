import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, rgbToHsv, hsvToRgb, rgbToOklab } from '../../editor/static/editor/js/core/colors.js';
import {
  colorModeOf,
  nearestColor,
  grayOf,
  isGray,
  toGrayscalePixels,
  toIndexedPixels,
  snapColor,
  constrainPixels,
  paletteRemap,
  remapPixels,
  convertDocument,
  remapDocument,
} from '../../editor/static/editor/js/core/colormode.js';
import { sortColors, sortOrder, dedupeColors, dedupeOrder, reverseColors, rampBetween, insertRamp, resizePalette, moveItem } from '../../editor/static/editor/js/core/palette-tools.js';
import {
  brightnessContrast,
  hueSaturation,
  colorCurve,
  curveTable,
  posterize,
  despeckle,
  convolve,
  CONVOLUTION_PRESETS,
  applyAdjustment,
  changesBetween,
} from '../../editor/static/editor/js/core/adjust.js';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';

const BLACK = pack(0, 0, 0);
const WHITE = pack(255, 255, 255);
const RED = pack(255, 0, 0);
const GREEN = pack(0, 255, 0);
const BLUE = pack(0, 0, 255);
const px = (...colors) => Uint32Array.from(colors);

// ---------------------------------------------------------------------------------------------- HSV
test('colors: HSV round trip and known values', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), [0, 1, 1]);
  assert.deepEqual(rgbToHsv(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(hsvToRgb(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(hsvToRgb(240, 1, 0.5), [0, 0, 128]);
  for (const [r, g, b] of [[93, 28, 22], [163, 180, 190], [246, 228, 166], [1, 2, 3], [255, 255, 255]]) {
    assert.deepEqual(hsvToRgb(...rgbToHsv(r, g, b)), [r, g, b]);
  }
});

// ---------------------------------------------------------------------------------------- color modes
test('colormode: missing or unknown mode is rgba', () => {
  assert.equal(colorModeOf({}), 'rgba');
  assert.equal(colorModeOf(null), 'rgba');
  assert.equal(colorModeOf({ colorMode: 'bogus' }), 'rgba');
  assert.equal(colorModeOf({ colorMode: 'indexed' }), 'indexed');
});

test('colormode: nearest color keeps the alpha and ignores transparent pixels', () => {
  const palette = [BLACK, WHITE, RED];
  assert.equal(nearestColor(pack(250, 20, 10), palette), RED);
  assert.equal(nearestColor(pack(240, 240, 240, 128), palette), pack(255, 255, 255, 128));
  assert.equal(nearestColor(pack(20, 20, 20), palette), BLACK);
  assert.equal(nearestColor(0, palette), 0);
  assert.equal(nearestColor(pack(1, 2, 3), []), pack(1, 2, 3), 'empty palette: unchanged');
});

test('colormode: indexed conversion maps every pixel to the palette', () => {
  const out = toIndexedPixels(px(pack(250, 10, 10), pack(10, 10, 10), 0, pack(200, 200, 200, 77)), 2, [BLACK, WHITE, RED]);
  assert.deepEqual([...out], [RED, BLACK, 0, pack(255, 255, 255, 77)]);
});

test('colormode: ordered dithering mixes the two nearest colors in flat areas', () => {
  const gray = new Uint32Array(16).fill(pack(128, 128, 128));
  const plain = toIndexedPixels(gray, 4, [BLACK, WHITE]);
  assert.equal(new Set(plain).size, 1);
  const dithered = toIndexedPixels(gray, 4, [BLACK, WHITE], { dither: true, amount: 1 });
  const whites = [...dithered].filter((c) => c === WHITE).length;
  assert.ok(whites >= 6 && whites <= 10, `about half white, got ${whites}`);
  assert.ok([...dithered].every((c) => c === WHITE || c === BLACK));
});

test('colormode: grayscale converts to the gray of the same lightness', () => {
  const out = toGrayscalePixels(px(RED, pack(10, 200, 30, 90), 0));
  assert.ok(isGray(out[0]) && isGray(out[1]));
  assert.equal(unpack(out[1])[3], 90, 'alpha kept');
  assert.equal(out[2], 0);
  const [L] = rgbToOklab(255, 0, 0);
  const [Lg] = rgbToOklab(...unpack(out[0]).slice(0, 3));
  assert.ok(Math.abs(L - Lg) < 0.01);
  assert.equal(grayOf(WHITE), WHITE);
  assert.equal(snapColor(RED, 'grayscale', []), grayOf(RED));
  assert.equal(snapColor(pack(240, 10, 0), 'indexed', [RED, BLUE]), RED);
  assert.equal(snapColor(pack(240, 10, 0), 'rgba', [RED, BLUE]), pack(240, 10, 0));
});

test('colormode: constrainPixels snaps only the pixels that changed', () => {
  const before = px(pack(1, 1, 1), RED);
  const after = px(pack(1, 1, 1), pack(250, 0, 0));
  assert.deepEqual([...constrainPixels(before, after, 'indexed', [BLACK, RED])], [pack(1, 1, 1), RED]);
  assert.equal(constrainPixels(before, after, 'rgba', []), after);
});

test('colormode: palette edit remaps edited and removed entries', () => {
  const old = [BLACK, RED, BLUE];
  // RED edited to GREEN, BLUE removed, a new white entry added.
  const map = paletteRemap(old, [BLACK, GREEN, WHITE], [0, 1, -1]);
  assert.equal(map.get(RED & 0xffffff), GREEN & 0xffffff);
  assert.equal(map.has(BLACK & 0xffffff), false);
  assert.ok(map.has(BLUE & 0xffffff), 'removed entry goes to the nearest color left');
  const { pixels, changed } = remapPixels(px(RED, pack(255, 0, 0, 100), BLACK, 0), map);
  assert.deepEqual([...pixels], [GREEN, pack(0, 255, 0, 100), BLACK, 0]);
  assert.equal(changed, 2);
  // Swapping the colors of two entries swaps the pixels at once; only reordering entries changes nothing.
  const swap = paletteRemap([RED, BLUE], [BLUE, RED], [0, 1]);
  assert.deepEqual([...remapPixels(px(RED, BLUE), swap).pixels], [BLUE, RED]);
  assert.equal(paletteRemap([RED, BLUE], [BLUE, RED], [1, 0]).size, 0);
});

test('colormode: whole document conversion and remap, linked cels once', () => {
  const d = new PixelDocument(2, 1);
  d.addFrame();
  const a = d.cell(d.frames[0].id, d.layers[0].id);
  a.set([pack(250, 5, 5), pack(5, 5, 250)]);
  d.cells.set(d.key(d.frames[1].id, d.layers[0].id), a); // a linked cel shares the array
  d.tilesets = [{ id: 't', tiles: [new Uint32Array(4), Uint32Array.from([pack(240, 0, 0), 0, 0, 0])] }];
  const changed = convertDocument(d, 'indexed', [RED, BLUE], { dither: true });
  assert.deepEqual([...a], [RED, BLUE]);
  assert.equal(d.tilesets[0].tiles[1][0], RED);
  assert.equal(changed, 3);
  assert.equal(remapDocument(d, paletteRemap([RED, BLUE], [GREEN, BLUE], [0, 1])), 2);
  assert.deepEqual([...a], [GREEN, BLUE]);
});

// --------------------------------------------------------------------------------------- palette tools
test('palette tools: sort by hue, lightness and saturation', () => {
  const gray = pack(128, 128, 128);
  const colors = [BLUE, WHITE, RED, gray, GREEN, BLACK];
  assert.deepEqual(sortColors(colors, 'hue'), [BLACK, gray, WHITE, RED, GREEN, BLUE]);
  assert.deepEqual(sortColors(colors, 'lightness').slice(0, 2), [BLACK, BLUE]);
  assert.equal(sortColors(colors, 'lightness').at(-1), WHITE);
  assert.deepEqual(sortColors([RED, gray, pack(200, 150, 150)], 'saturation'), [gray, pack(200, 150, 150), RED]);
  assert.deepEqual(sortOrder([RED, RED], 'hue'), [0, 1], 'stable');
  assert.throws(() => sortOrder(colors, 'nope'));
});

test('palette tools: dedupe, reverse, resize and move', () => {
  assert.deepEqual(dedupeColors([RED, BLUE, RED, GREEN, BLUE]), [RED, BLUE, GREEN]);
  assert.deepEqual(dedupeOrder([RED, BLUE, RED]), [0, 1]);
  assert.deepEqual(reverseColors([RED, BLUE]), [BLUE, RED]);
  assert.deepEqual(resizePalette([RED, BLUE, GREEN], 2), [RED, BLUE]);
  assert.deepEqual(resizePalette([RED], 3), [RED, BLACK, BLACK]);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
});

test('palette tools: OKLab ramp between two colors', () => {
  const ramp = rampBetween(BLACK, WHITE, 5);
  assert.equal(ramp.length, 5);
  assert.equal(ramp[0], BLACK);
  assert.equal(ramp[4], WHITE);
  const Ls = ramp.map((c) => rgbToOklab(...unpack(c).slice(0, 3))[0]);
  for (let i = 1; i < 5; i++) assert.ok(Math.abs(Ls[i] - Ls[i - 1] - 0.25) < 0.01, 'even steps of perceived lightness');
  assert.ok(ramp.slice(1, 4).every(isGray));
  assert.equal(unpack(rampBetween(pack(0, 0, 0, 0), pack(0, 0, 0, 255), 3)[1])[3], 128, 'alpha interpolated');
  const inserted = insertRamp([RED, GREEN, BLUE, WHITE], 1, 3, 4);
  assert.equal(inserted.length, 1 + 4);
  assert.equal(inserted[1], GREEN);
  assert.equal(inserted[4], WHITE);
  const reversed = insertRamp([RED, GREEN, BLUE, WHITE], 3, 1, 4);
  assert.equal(reversed[1], GREEN);
  assert.equal(reversed[4], WHITE);
});

// ---------------------------------------------------------------------------------------- adjustments
const ctx = (width, height, indices = null) => ({ width, height, indices });

test('adjust: brightness and contrast', () => {
  const src = px(pack(100, 150, 200, 77), 0, pack(10, 20, 30));
  assert.deepEqual([...brightnessContrast(src, {}, ctx(3, 1))], [...src], 'zero is identity');
  const brighter = brightnessContrast(src, { brightness: 20 }, ctx(3, 1));
  assert.deepEqual(unpack(brighter[0]), [151, 201, 251, 77], '+20% adds 51 and keeps alpha');
  assert.equal(brighter[1], 0, 'transparent untouched');
  const contrast = brightnessContrast(px(pack(128, 64, 192)), { contrast: 100 }, ctx(1, 1));
  assert.deepEqual(unpack(contrast[0]), [128, 0, 255, 255]);
  const only = brightnessContrast(src, { brightness: 20 }, ctx(3, 1, [2]));
  assert.equal(only[0], src[0], 'outside the index list nothing changes');
  assert.deepEqual(unpack(only[2]), [61, 71, 81, 255]);
});

test('adjust: hue, saturation, lightness and colorize', () => {
  assert.equal(hueSaturation(px(RED), { hue: 120 }, ctx(1, 1))[0], GREEN);
  assert.equal(hueSaturation(px(RED), { saturation: -100 }, ctx(1, 1))[0], pack(128, 128, 128));
  assert.equal(hueSaturation(px(pack(10, 20, 30, 9)), { lightness: 100 }, ctx(1, 1))[0], pack(255, 255, 255, 9));
  const [r, g, b] = unpack(hueSaturation(px(pack(128, 128, 128)), { colorize: true, hue: 240, saturation: 100 }, ctx(1, 1))[0]);
  assert.ok(r <= 2 && g <= 2 && b >= 250, 'colorized blue');
  const src = px(RED, BLUE);
  const out = hueSaturation(src, { hue: 120 }, ctx(2, 1, [1]));
  assert.equal(out[0], RED);
  assert.equal(out[1], RED, 'blue + 120° = red');
});

test('adjust: color curve per RGB and per channel', () => {
  const table = curveTable([[0, 255], [255, 0]]);
  assert.equal(table[0], 255);
  assert.equal(table[255], 0);
  assert.equal(curveTable([[64, 0], [192, 255]])[128], 128);
  assert.equal(curveTable([[64, 0], [192, 255]])[10], 0, 'flat before the first point');
  const inverted = colorCurve(px(pack(10, 20, 30, 40)), { points: [[0, 255], [255, 0]] }, ctx(1, 1));
  assert.deepEqual(unpack(inverted[0]), [245, 235, 225, 40]);
  const redOnly = colorCurve(px(pack(10, 20, 30)), { curves: { r: [[0, 100], [255, 100]] } }, ctx(1, 1));
  assert.deepEqual(unpack(redOnly[0]), [100, 20, 30, 255]);
  assert.deepEqual(unpack(colorCurve(px(pack(10, 20, 30)), { points: [[0, 0], [255, 255]], channel: 'g' }, ctx(1, 1))[0]), [10, 20, 30, 255]);
});

test('adjust: posterize', () => {
  const out = posterize(px(pack(0, 100, 200, 5), pack(127, 128, 255)), { levels: 2 }, ctx(2, 1));
  assert.deepEqual(unpack(out[0]), [0, 0, 255, 5]);
  assert.deepEqual(unpack(out[1]), [0, 255, 255, 255]);
  assert.deepEqual(unpack(posterize(px(pack(100, 100, 100)), { levels: 3 }, ctx(1, 1))[0]), [128, 128, 128, 255]);
});

test('adjust: despeckle removes an isolated pixel, edges and transparency handled', () => {
  const src = new Uint32Array(9).fill(WHITE);
  src[4] = BLACK;
  const out = despeckle(src, {}, ctx(3, 3));
  assert.equal(out[4], WHITE, 'the speck becomes the median');
  assert.equal(out[0], WHITE, 'corner uses the clipped window');
  const holes = Uint32Array.from([0, 0, 0, 0, pack(9, 9, 9, 99), 0, 0, 0, 0]);
  assert.equal(despeckle(holes, {}, ctx(3, 3))[4], pack(9, 9, 9, 99), 'only opaque neighbors count');
  assert.equal(despeckle(src, {}, ctx(3, 3, [0]))[4], BLACK, 'index list respected');
});

test('adjust: convolution presets, edges and transparent pixels', () => {
  const flat = new Uint32Array(9).fill(pack(80, 90, 100, 200));
  for (const preset of Object.keys(CONVOLUTION_PRESETS)) {
    assert.deepEqual([...convolve(flat, { preset }, ctx(3, 3))], [...flat], `${preset}: a flat image stays flat (edges repeat)`);
  }
  const line = px(BLACK, WHITE, BLACK);
  const smooth = convolve(line, { kernel: [0, 0, 0, 1, 1, 1, 0, 0, 0] }, ctx(3, 1));
  assert.deepEqual(unpack(smooth[1]), [85, 85, 85, 255]);
  assert.deepEqual(unpack(smooth[0]), [85, 85, 85, 255], 'left edge repeats the border pixel');
  const sprite = px(0, WHITE, WHITE);
  assert.equal(convolve(sprite, { preset: 'smooth' }, ctx(3, 1))[1], WHITE, 'transparent neighbors skipped by default');
  assert.notEqual(convolve(sprite, { preset: 'smooth', skipTransparent: false }, ctx(3, 1))[1], WHITE, 'without skipping, black bleeds in');
  assert.equal(convolve(sprite, { preset: 'smooth' }, ctx(3, 1))[0], 0, 'transparent pixels stay transparent');
  const sharp = convolve(px(pack(100, 100, 100), pack(150, 150, 150), pack(100, 100, 100)), { preset: 'sharpen' }, ctx(3, 1, [0]));
  assert.equal(sharp[1], pack(150, 150, 150), 'index list respected');
  assert.deepEqual(unpack(sharp[0]), [50, 50, 50, 255]);
  assert.throws(() => convolve(line, { kernel: [1, 1] }, ctx(3, 1)));
});

test('adjust: dispatcher and change list', () => {
  const src = px(RED, 0);
  const out = applyAdjustment('brightnessContrast', src, { brightness: -100 }, ctx(2, 1));
  assert.deepEqual(changesBetween(src, out), [[0, BLACK]]);
  assert.throws(() => applyAdjustment('nope', src, {}, ctx(2, 1)));
});
