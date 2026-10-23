import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, hexToColor, colorToHex, generateRamp, rgbToOklch, oklchToRgb, overlay, unpack } from '../../editor/static/editor/js/core/colors.js';
import { line, rectangle, ellipse, brush, mirrors, constrain, scaleDetection } from '../../editor/static/editor/js/core/geometry.js';
import { fill, region } from '../../editor/static/editor/js/core/fill.js';
import { encodeRLE, decodeRLE, toBase64, fromBase64 } from '../../editor/static/editor/js/core/rle.js';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { History, Stroke, CELL_THRESHOLD } from '../../editor/static/editor/js/core/history.js';
import { serialize, deserialize, fileNameFor, upgradeDocument, FORMAT_VERSION } from '../../editor/static/editor/js/core/format.js';

const BLACK = pack(0, 0, 0);
const RED = pack(255, 0, 0);
const BLUE = pack(0, 0, 255);

const collect = (fn) => {
  const points = new Set();
  fn((x, y) => points.add(`${x},${y}`));
  return points;
};

test('colors: hex round trip, with and without alpha', () => {
  assert.equal(colorToHex(hexToColor('#5D1C16')), '#5d1c16');
  assert.equal(colorToHex(hexToColor('#5d1c1680')), '#5d1c1680');
  assert.equal(colorToHex(hexToColor('abc')), '#aabbcc');
  assert.equal(hexToColor('xyz'), null);
  assert.deepEqual(unpack(RED), [255, 0, 0, 255]);
});

test('colors: OKLCH converts back to the same RGB', () => {
  for (const hex of ['#5d1c16', '#a3b4be', '#f6e4a6', '#7a6e46', '#000000', '#ffffff']) {
    const [r, g, b] = unpack(hexToColor(hex));
    const roundTrip = oklchToRgb(...rgbToOklch(r, g, b));
    roundTrip.forEach((v, i) => assert.ok(Math.abs(v - [r, g, b][i]) <= 1, `${hex} channel ${i}`));
  }
});

test('colors: shades are sorted from darkest to lightest', () => {
  const { ramp, shades, tints } = generateRamp(hexToColor('#7a6e46'), { steps: 4 });
  assert.equal(ramp.length, 9);
  assert.equal(shades.length, 4);
  assert.equal(tints.length, 4);
  const L = ramp.map((c) => rgbToOklch(...unpack(c).slice(0, 3))[0]);
  for (let i = 1; i < L.length; i++) assert.ok(L[i] > L[i - 1], `lightness ${i}`);
});

test('colors: blending respects opacity', () => {
  const mid = overlay(BLUE, RED, 0.5);
  const [r, , b, a] = unpack(mid);
  assert.ok(Math.abs(r - 128) <= 1 && Math.abs(b - 127) <= 1 && a === 255);
  assert.equal(overlay(0, RED, 1), RED);
});

test('geometry: Bresenham line joins the ends without gaps', () => {
  const points = [];
  line(0, 0, 7, 3, (x, y) => points.push([x, y]));
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [7, 3]);
  assert.equal(points.length, 8);
  for (let i = 1; i < points.length; i++) {
    assert.ok(Math.abs(points[i][0] - points[i - 1][0]) <= 1 && Math.abs(points[i][1] - points[i - 1][1]) <= 1);
  }
});

test('geometry: outlined and filled rectangle', () => {
  assert.equal(collect((p) => rectangle(0, 0, 4, 3, false, p)).size, 14);
  assert.equal(collect((p) => rectangle(4, 3, 0, 0, true, p)).size, 20);
  assert.equal(collect((p) => rectangle(2, 2, 2, 2, false, p)).size, 1);
});

test('geometry: ellipse is symmetric and fits the box', () => {
  for (const [w, h] of [[8, 8], [9, 5], [16, 7], [2, 2]]) {
    const points = collect((p) => ellipse(0, 0, w - 1, h - 1, false, p));
    for (const k of points) {
      const [x, y] = k.split(',').map(Number);
      assert.ok(x >= 0 && x < w && y >= 0 && y < h, `${w}x${h} outside: ${k}`);
      assert.ok(points.has(`${w - 1 - x},${y}`), `${w}x${h} without horizontal mirror of ${k}`);
      assert.ok(points.has(`${x},${h - 1 - y}`), `${w}x${h} without vertical mirror of ${k}`);
    }
    const filled = collect((p) => ellipse(0, 0, w - 1, h - 1, true, p));
    assert.ok(filled.size >= points.size);
  }
});

test('geometry: brush, mirrors and angle constraint', () => {
  assert.equal(brush(1).length, 1);
  assert.equal(brush(3).length, 9);
  assert.ok(brush(5, 'circle').length < 25);
  assert.deepEqual(mirrors(1, 2, 8, 8, 'both'), [[1, 2], [6, 2], [1, 5], [6, 5]]);
  assert.deepEqual(constrain(0, 0, 10, 1, 'line'), [10, 0]);
  assert.deepEqual(constrain(0, 0, 9, 10, 'line'), [10, 10]);
  assert.deepEqual(constrain(0, 0, 3, 7, 'square'), [7, 7]);
});

test('geometry: detects the pixel size of an enlarged image', () => {
  const base = Uint32Array.from([BLACK, RED, BLUE, BLACK]);
  const enlarged = new Uint32Array(8 * 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) enlarged[y * 8 + x] = base[Math.floor(y / 4) * 2 + Math.floor(x / 4)];
  assert.equal(scaleDetection(enlarged, 8, 8), 4);
});

test('fill: bucket respects borders and connectivity', () => {
  const L = 5;
  const px = new Uint32Array(25);
  for (let i = 0; i < 5; i++) px[i * L + 2] = BLACK;
  const changed = fill(px, L, 5, 0, 0, RED);
  assert.equal(changed.length, 10);
  assert.equal(px[4], 0);
  const diag = new Uint32Array(9);
  diag[0] = BLACK;
  diag[4] = BLACK;
  diag[8] = BLACK;
  assert.equal(region(diag, 3, 3, 0, 0, { connectivity: 4 }).length, 1);
  assert.equal(region(diag, 3, 3, 0, 0, { connectivity: 8 }).length, 3);
  assert.equal(region(px, L, 5, 3, 0, { contiguous: false }).length, 10);
});

test('fill: tolerance joins similar colors', () => {
  const px = Uint32Array.from([pack(100, 0, 0), pack(110, 0, 0), pack(200, 0, 0)]);
  assert.equal(region(px, 3, 1, 0, 0, { tolerance: 0 }).length, 1);
  assert.equal(region(px, 3, 1, 0, 0, { tolerance: 20 }).length, 2);
});

test('rle and base64: lossless round trip', () => {
  const px = new Uint32Array(4096);
  px.fill(RED, 100, 3000);
  px[3500] = hexToColor('#12345678');
  const bytes = encodeRLE(px);
  assert.ok(bytes.length < 40);
  assert.deepEqual(decodeRLE(bytes, px.length), px);
  for (const n of [0, 1, 2, 3, 4, 5, 255]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
    assert.deepEqual(fromBase64(toBase64(data)), data);
  }
  assert.equal(toBase64(Uint8Array.from([77, 97, 110])), 'TWFu');
  assert.throws(() => decodeRLE(bytes, 10));
});

test('document: layers, compositing and opacity', () => {
  const doc = new PixelDocument(4, 4);
  const q = doc.frames[0].id;
  const c1 = doc.layers[0];
  const c2 = doc.addLayer('Topo');
  doc.cell(q, c1.id)[0] = BLUE;
  doc.cell(q, c2.id)[0] = RED;
  assert.equal(doc.composite(0)[0], RED);
  c2.visible = false;
  assert.equal(doc.composite(0)[0], BLUE);
  c2.visible = true;
  c2.opacity = 50;
  doc.mergeDown(c2.id);
  assert.equal(doc.layers.length, 1);
  assert.notEqual(doc.composite(0)[0], BLUE);
});

test('document: resize with anchor and scale', () => {
  const doc = new PixelDocument(2, 2);
  const px = doc.cell(doc.frames[0].id, doc.layers[0].id);
  px.set([1, 2, 3, 4].map((n) => pack(n, 0, 0)));
  doc.resize(4, 4, 0.5, 0.5);
  const newProject = doc.cell(doc.frames[0].id, doc.layers[0].id);
  assert.equal(newProject[1 * 4 + 1], pack(1, 0, 0));
  assert.equal(newProject[2 * 4 + 2], pack(4, 0, 0));
  doc.resize(2, 2, 0.5, 0.5);
  doc.scale(4, 4);
  assert.equal(doc.cell(doc.frames[0].id, doc.layers[0].id)[0], pack(1, 0, 0));
  doc.rotate(1);
  assert.equal(doc.width, 4);
});

test('history: undoes and redoes pixels, large cells and structure', () => {
  const doc = new PixelDocument(64, 64);
  const h = new History();
  const key = doc.key(doc.frames[0].id, doc.layers[0].id);
  const stroke = new Stroke(key, doc.cellByKey(key));
  stroke.paint(5, RED);
  stroke.paint(6, RED);
  h.record(stroke.finish('Lápis'));
  assert.equal(h.past[0].type, 'pixels');
  const large = new Stroke(key, doc.cellByKey(key));
  for (let i = 0; i < CELL_THRESHOLD + 10; i++) large.paint(i, BLUE);
  h.record(large.finish('Balde'));
  assert.equal(h.past[1].type, 'cell');
  const before = doc.snapshot();
  doc.addLayer('Nova');
  h.recordState('Nova camada', before, doc.snapshot());
  assert.equal(doc.layers.length, 2);
  h.undo(doc);
  assert.equal(doc.layers.length, 1);
  h.undo(doc);
  assert.equal(doc.cellByKey(key)[100], 0);
  assert.equal(doc.cellByKey(key)[5], RED);
  h.undo(doc);
  assert.equal(doc.cellByKey(key)[5], 0);
  h.redo(doc);
  h.redo(doc);
  h.redo(doc);
  assert.equal(doc.layers.length, 2);
  assert.equal(doc.cellByKey(key)[100], BLUE);
  assert.ok(h.bytes > 0 && h.bytes < 64 * 1024);
});

test('history: a new action clears the redo stack', () => {
  const doc = new PixelDocument(8, 8);
  const h = new History();
  const key = doc.key(doc.frames[0].id, doc.layers[0].id);
  for (let i = 0; i < 3; i++) {
    const t = new Stroke(key, doc.cellByKey(key));
    t.paint(i, RED);
    h.record(t.finish('Lápis'));
  }
  h.undo(doc);
  h.undo(doc);
  assert.equal(h.future.length, 2);
  const t = new Stroke(key, doc.cellByKey(key));
  t.paint(10, BLUE);
  h.record(t.finish('Lápis'));
  assert.equal(h.future.length, 0);
  assert.equal(h.past.length, 2);
});

test('format: serializes and restores the whole project', () => {
  const doc = new PixelDocument(16, 8, { name: 'Poção' });
  doc.addLayer('Brilho');
  doc.duplicateFrame(doc.frames[0].id);
  doc.cell(doc.frames[1].id, doc.layers[1].id)[17] = RED;
  doc.layers[1].opacity = 40;
  doc.palette = [RED, BLUE];
  const text = JSON.stringify(serialize(doc));
  const roundTrip = deserialize(text);
  assert.equal(roundTrip.name, 'Poção');
  assert.equal(roundTrip.width, 16);
  assert.equal(roundTrip.frames.length, 2);
  assert.equal(roundTrip.layers[1].opacity, 40);
  assert.equal(roundTrip.cell(roundTrip.frames[1].id, roundTrip.layers[1].id)[17], RED);
  assert.deepEqual(roundTrip.palette, [RED, BLUE]);
  assert.equal(serialize(doc).version, FORMAT_VERSION);
  assert.throws(() => deserialize({ format: 'other' }));
  assert.throws(() => deserialize({ ...serialize(doc), version: FORMAT_VERSION + 1 }));
  assert.equal(fileNameFor('Poção de Vida!', 'png'), 'pocao-de-vida.png');
});

test('format: Crivo 1.x files (format version 1, Portuguese keys) still open', () => {
  const doc = new PixelDocument(4, 2, { name: 'Antigo' });
  doc.addLayer('Brilho');
  doc.cell(doc.frames[0].id, doc.layers[1].id)[5] = RED;
  doc.layers[1].visible = false;
  doc.frames[0].duration = 250;
  const v2 = serialize(doc);
  const v1 = {
    formato: 'crivo',
    versao: 1,
    nome: v2.name,
    largura: v2.width,
    altura: v2.height,
    fps: v2.fps,
    paleta: v2.palette,
    camadas: v2.layers.map((c) => ({ id: c.id, nome: c.name, visivel: c.visible, opacidade: c.opacity, bloqueada: c.locked })),
    quadros: v2.frames.map((q) => ({ id: q.id, duracao: q.duration })),
    celulas: v2.cells.map((c) => ({ quadro: c.frame, camada: c.layer, rle: c.rle })),
  };
  assert.deepEqual(upgradeDocument(v1), { ...v2, version: 2 });
  assert.equal(upgradeDocument(v2), v2);
  const opened = deserialize(JSON.stringify(v1));
  assert.equal(opened.name, 'Antigo');
  assert.equal(opened.layers[1].visible, false);
  assert.equal(opened.frames[0].duration, 250);
  assert.equal(opened.cell(opened.frames[0].id, opened.layers[1].id)[5], RED);
});
