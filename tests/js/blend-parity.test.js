import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize } from '../../editor/static/editor/js/core/format.js';
import { BLEND_MODES } from '../../editor/static/editor/js/core/blend.js';
import { hex } from './fixtures/make_blend_fixtures.mjs';

// tests/fixtures/blend-parity.json is written by tests/js/fixtures/make_blend_fixtures.mjs. The same pixels are
// checked by the server (editor/tests/test_features_2_1.py) and by the Java tool (tools/java Tests.java).
const fixture = JSON.parse(readFileSync(new URL('../fixtures/blend-parity.json', import.meta.url), 'utf8'));

test('blend parity: the editor renders every fixture document as recorded', () => {
  assert.ok(fixture.documents.length >= 30);
  for (const [n, { data, expected }] of fixture.documents.entries()) {
    const doc = deserialize(data);
    assert.deepEqual(Array.from(doc.composite(0), hex), expected, `document ${n + 1}`);
  }
});

test('blend parity: the fixture covers every mode, nested and pass-through groups, hidden and reference layers', () => {
  const layers = fixture.documents.flatMap(({ data }) => data.layers);
  const modes = new Set(layers.map((l) => l.blendMode ?? 'normal'));
  assert.deepEqual([...BLEND_MODES].filter((m) => !modes.has(m)), []);
  const groups = layers.filter((l) => l.kind === 'group');
  assert.ok(groups.some((g) => (g.blendMode ?? 'normal') === 'normal' && g.opacity === 100), 'pass-through group');
  assert.ok(groups.some((g) => (g.blendMode ?? 'normal') !== 'normal'), 'isolated group');
  assert.ok(groups.some((g) => g.parent), 'nested group');
  assert.ok(layers.some((l) => !l.visible) && layers.some((l) => l.reference));
});
