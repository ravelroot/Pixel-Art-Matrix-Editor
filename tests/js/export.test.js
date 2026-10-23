import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pack, hexToColor } from '../../editor/static/editor/js/core/colors.js';
import { buildMatrices, generateData, sheetLayout, scaleNearest, identifier, flattenBackground, sheetMetadata, generateJava, generateC } from '../../editor/static/editor/js/core/export.js';
import { importPalette, exportPalette, PRESET_PALETTES, extractPalette } from '../../editor/static/editor/js/core/palettes.js';
import { deserialize } from '../../editor/static/editor/js/core/format.js';

const V = pack(255, 0, 0);
const A = pack(0, 0, 255);
const frame = Uint32Array.from([V, 0, A, V]);

test('export: index and color matrices', () => {
  const i = buildMatrices([frame], 2, 2);
  assert.deepEqual(i.palette, ['#ff0000', '#0000ff']);
  assert.deepEqual(i.frames[0], [[0, -1], [1, 0]]);
  const h = buildMatrices([frame], 2, 2, { mode: 'hex' });
  assert.deepEqual(h.frames[0], [['#ff0000', null], ['#0000ff', '#ff0000']]);
  const p = buildMatrices([frame], 2, 2, { palette: [A, V] });
  assert.deepEqual(p.frames[0], [[1, -1], [0, 1]]);
});

test('export: every format generates valid code', () => {
  const data = buildMatrices([frame, frame], 2, 2);
  const json = JSON.parse(generateData('json', data, 'Poção Azul'));
  assert.equal(json.frames.length, 2);
  assert.equal(json.transparent, -1);
  assert.equal(generateData('csv', data, 'x').split('\n')[0], '0,-1');
  const js = generateData('js', data, 'Poção Azul');
  assert.match(js, /^export const pocaoAzul = \{/);
  const mod = new Function(js.replace('export const', 'return'))();
  assert.deepEqual(mod.frames[1][1], [1, 0]);
  assert.match(generateData('py', data, 'Poção Azul'), /^POCAO_AZUL = \{/);
  const c = generateData('c', data, 'Poção Azul');
  assert.match(c, /static const int16_t pocao_azul_pixels\[POCAO_AZUL_FRAMES\]\[POCAO_AZUL_HEIGHT\]\[POCAO_AZUL_WIDTH\]/);
  assert.match(c, /0xFF0000FF/);
  const java = generateData('java', buildMatrices([frame], 2, 2, { mode: 'hex' }), '1 espada');
  assert.match(java, /public final class Sprite1Espada/);
  assert.match(java, /0xFFFF0000/);
  assert.equal(identifier('ação rápida', 'snake'), 'acao_rapida');
});

test('export: sprite sheet and scale', () => {
  const h = sheetLayout(5, 16, 16, { layout: 'horizontal', spacing: 2 });
  assert.equal(h.width, 5 * 16 + 4 * 2);
  assert.equal(h.height, 16);
  const g = sheetLayout(5, 8, 8, { layout: 'grid', columns: 2, margin: 1 });
  assert.deepEqual([g.columns, g.rows, g.width, g.height], [2, 3, 18, 26]);
  assert.deepEqual(g.positions[3], { x: 9, y: 9, width: 8, height: 8 });
  const v = sheetLayout(3, 4, 4, { layout: 'vertical' });
  assert.deepEqual([v.width, v.height], [4, 12]);
  const e = scaleNearest(frame, 2, 2, 3);
  assert.equal(e.length, 36);
  assert.equal(e[0], V);
  assert.equal(e[3], 0);
  assert.equal(e[6 * 3 + 2], A);
  assert.equal(e[6 * 3 + 4], V);
  assert.equal(flattenBackground(Uint32Array.from([0]), hexToColor('#ffffff'))[0], hexToColor('#ffffff'));
  assert.equal(sheetMetadata('x', v, [{ duration: 50 }], 10).frames[1].duration, 100);
});

test('palettes: presets, import and export', () => {
  const names = PRESET_PALETTES.map((p) => p.slug);
  for (const s of ['crivo', 'game-boy', 'nes', 'pico-8', 'cga']) assert.ok(names.includes(s));
  assert.equal(PRESET_PALETTES.find((p) => p.slug === 'pico-8').colors.length, 16);
  assert.equal(new Set(PRESET_PALETTES.find((p) => p.slug === 'nes').colors).size, 55);
  const gpl = 'GIMP Palette\nName: Teste\nColumns: 4\n#\n255   0   0\tVermelho\n  0   0 255\tAzul\n';
  assert.deepEqual(importPalette(gpl, 'teste.gpl'), { name: 'Teste', colors: [V, A] });
  assert.deepEqual(importPalette('ff0000\n0000ff\n', 'lospec.hex').colors, [V, A]);
  assert.deepEqual(importPalette('; paint.net\nFFFF0000\n', 'pdn.txt').colors, [V]);
  assert.equal(importPalette('{"name":"J","colors":["#f00"]}', 'p.json').name, 'J');
  assert.deepEqual(importPalette('{"nome":"J","cores":["#f00"]}', 'p.json'), { name: 'J', colors: [V] });
  assert.throws(() => importPalette('nothing here', 'x.txt'));
  const roundTrip = exportPalette({ name: 'Round trip', colors: [V, A] }, 'gpl');
  assert.deepEqual(importPalette(roundTrip, 'round-trip.gpl').colors, [V, A]);
  assert.equal(exportPalette({ name: 'x', colors: [V] }, 'hex'), 'ff0000\n');
  assert.deepEqual(extractPalette(Uint32Array.from([A, V, V, 0])), [V, A]);
});

test('examples: the .crivo files open without errors', () => {
  for (const name of ['potion.crivo', 'heart.crivo', 'game-boy-slime.crivo']) {
    const doc = deserialize(readFileSync(new URL(`../../examples/${name}`, import.meta.url), 'utf8'));
    assert.equal(doc.width, 16);
    assert.ok(doc.frames.length >= 2);
    assert.ok(doc.composite(0).some((c) => c !== 0));
  }
});

test('java: a large matrix is packed as text (staying under the Java 64 KB limit) and C uses int32 with many colors', () => {
  const L = 70;
  const px = new Uint32Array(L * L).map((_, i) => (i % 3 ? (0xff000000 | (i * 77)) >>> 0 : 0));
  const data = buildMatrices([px], L, L, { mode: 'indices' });
  const source = generateJava(data, 'Meu Sprite');
  assert.match(source, /public final class MeuSprite/);
  assert.match(source, /private static final String\[\] DATA = \{/);
  assert.ok(source.split(',').length < 1000, 'the values do not become a huge literal');
  assert.doesNotMatch(source, /\\u000[aAdD]|\\u0022|\\u005[cC]/, 'no \\u escapes that Java would read before the text');
  const small = generateJava(buildMatrices([px.slice(0, 16)], 4, 4, { mode: 'indices' }), 'x');
  assert.doesNotMatch(small, /String\[\] DATA/);
  const many = { width: 1, height: 1, mode: 'indices', palette: Array(40000).fill('#000000'), frames: [[[39999]]] };
  assert.match(generateC(many, 'a'), /static const int32_t/);
});
