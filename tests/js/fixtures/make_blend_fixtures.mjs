// Writes tests/fixtures/blend-parity.json: small random documents (nested groups, pass-through and isolated groups,
// every blend mode, opacities, hidden and reference layers) with the editor's composite of frame 1 as the expected
// pixels. The editor (core/document.js + core/blend.js) is the reference renderer; the server (editor/blend.py) and
// the Java tool (Blend.java) must match every pixel. Run: node tests/js/fixtures/make_blend_fixtures.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PixelDocument } from '../../../editor/static/editor/js/core/document.js';
import { serialize } from '../../../editor/static/editor/js/core/format.js';
import { BLEND_MODES } from '../../../editor/static/editor/js/core/blend.js';
import { pack } from '../../../editor/static/editor/js/core/colors.js';

const COUNT = 30;
let seed = 2101;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const pick = (items) => items[Math.floor(rnd() * items.length)];
let nextMode = 0;

export function hex(c) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return `#${h(c & 255)}${h((c >>> 8) & 255)}${h((c >>> 16) & 255)}${h(c >>> 24)}`;
}

function randomPixel() {
  if (rnd() < 0.2) return 0;
  const a = pick([255, 255, 255, 128, 150, 200, 1, 254, Math.floor(rnd() * 256) || 1]);
  const v = () => Math.floor(rnd() * 256);
  const kind = rnd();
  if (kind < 0.15) {
    const g = v();
    return pack(g, g, g, a); // gray: every channel ties
  }
  if (kind < 0.35) {
    const [x, y] = [v(), v()];
    return pick([pack(x, x, y, a), pack(x, y, x, a), pack(y, x, x, a)]); // two channels tie
  }
  if (kind < 0.45) return pack(pick([0, 255]), pick([0, 255, 128]), pick([0, 255]), a);
  return pack(v(), v(), v(), a);
}

function configure(layer, group) {
  layer.opacity = pick([100, 100, 100, 75, 60, 50, 35, 1]);
  layer.blendMode = BLEND_MODES[nextMode++ % BLEND_MODES.length];
  if (group && rnd() < 0.4) {
    layer.blendMode = 'normal'; // pass-through group
    layer.opacity = 100;
  }
  layer.visible = rnd() < 0.9;
  layer.reference = rnd() < 0.08;
}

function fill(doc, layer) {
  const px = doc.cell(doc.frames[0].id, layer.id);
  for (let i = 0; i < px.length; i++) px[i] = randomPixel();
}

function build(doc, parent, depth) {
  const count = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < count; k++) {
    const position = parent ? doc.layerIndex(parent) : doc.layers.length;
    if (depth < 3 && rnd() < 0.35) {
      const group = doc.addGroup(null, position, parent);
      configure(group, true);
      build(doc, group.id, depth + 1);
    } else {
      const layer = doc.addLayer(null, position, parent);
      configure(layer, false);
      fill(doc, layer);
    }
  }
}

export function makeDocuments() {
  const documents = [];
  for (let n = 0; n < COUNT; n++) {
    const doc = new PixelDocument(4 + Math.floor(rnd() * 3), 3 + Math.floor(rnd() * 3), { name: `Paridade ${n + 1}` });
    const base = doc.layers[0];
    base.opacity = pick([100, 100, 60, 35]);
    fill(doc, base);
    build(doc, null, 0);
    documents.push({ data: serialize(doc), expected: Array.from(doc.composite(0), hex) });
  }
  return documents;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('../../fixtures/blend-parity.json', import.meta.url);
  const body = { generator: 'tests/js/fixtures/make_blend_fixtures.mjs', frame: 0, documents: makeDocuments() };
  writeFileSync(out, JSON.stringify(body) + '\n');
  console.log(`${body.documents.length} documents -> ${fileURLToPath(out)}`);
}
