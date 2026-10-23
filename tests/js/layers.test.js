import test from 'node:test';
import assert from 'node:assert/strict';
import { pack, overlay } from '../../editor/static/editor/js/core/colors.js';
import { blendPixel, BLEND_MODES } from '../../editor/static/editor/js/core/blend.js';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { History } from '../../editor/static/editor/js/core/history.js';
import { serialize, deserialize } from '../../editor/static/editor/js/core/format.js';
import { tagSequence, Playback } from '../../editor/static/editor/js/core/animation.js';
import { createTileset, addTile, placeTile, applyPixelsToTiles, tileIndexAt, tileGrid } from '../../editor/static/editor/js/core/tilemap.js';
import { encodeRLE, toBase64 } from '../../editor/static/editor/js/core/rle.js';

const RED = pack(255, 0, 0);
const GREEN = pack(0, 255, 0);
const BLUE = pack(0, 0, 255);
const WHITE = pack(255, 255, 255);
const BACK = pack(200, 100, 50);
const FRONT = pack(100, 150, 200);

// ---- blend math --------------------------------------------------------------------------------------------

test('blend: separable modes match hand-computed values (opaque over opaque)', () => {
  const cases = {
    multiply: [78, 59, 39],
    screen: [222, 191, 211],
    overlay: [188, 118, 78],
    darken: [100, 100, 50],
    lighten: [200, 150, 200],
    difference: [100, 50, 150],
    exclusion: [143, 132, 172],
    addition: [255, 250, 250],
    subtract: [100, 0, 0],
    divide: [255, 170, 64],
  };
  for (const [mode, [r, g, b]] of Object.entries(cases)) assert.equal(blendPixel(mode, BACK, FRONT), pack(r, g, b), mode);
});

test('blend: dodge, burn, hard and soft light on simple values', () => {
  const gray = pack(128, 128, 128);
  assert.equal(blendPixel('color-dodge', pack(0, 128, 255), gray), pack(0, 255, 255));
  assert.equal(blendPixel('color-burn', pack(255, 128, 0), gray), pack(255, 2, 0));
  assert.equal(blendPixel('hard-light', WHITE, pack(0, 0, 0)), pack(0, 0, 0));
  assert.equal(blendPixel('soft-light', gray, pack(0, 0, 0)), pack(64, 64, 64));
});

test('blend: non-separable modes', () => {
  const gray = pack(128, 128, 128);
  assert.equal(blendPixel('hue', gray, RED), gray, 'gray has no saturation to give the hue');
  assert.equal(blendPixel('saturation', gray, RED), gray);
  assert.equal(blendPixel('color', gray, RED), pack(255, 74, 74));
  assert.equal(blendPixel('luminosity', RED, RED), RED);
});

test('blend: opacity, transparent backdrop and the exact normal path', () => {
  assert.equal(blendPixel('multiply', WHITE, pack(0, 0, 0), 0.5), pack(128, 128, 128));
  assert.equal(blendPixel('multiply', 0, FRONT), FRONT, 'over transparent the source shows as is');
  assert.equal(blendPixel('screen', BACK, 0), BACK, 'transparent source keeps the backdrop');
  const half = pack(10, 20, 30, 77);
  assert.equal(blendPixel('normal', BACK, half, 0.6), overlay(BACK, half, 0.6));
  assert.equal(BLEND_MODES.length, 19);
  for (const mode of BLEND_MODES) assert.equal(blendPixel(mode, 0, 0), 0, mode);
});

// ---- groups ------------------------------------------------------------------------------------------------

function docWithGroup() {
  const doc = new PixelDocument(2, 1);
  const base = doc.layers[0];
  const group = doc.addGroup('G');
  const child = doc.addLayer('Filho', doc.layerIndex(group.id), group.id);
  const q = doc.frames[0].id;
  doc.cell(q, base.id).fill(WHITE);
  doc.cell(q, child.id)[0] = FRONT;
  return { doc, base, group, child, q };
}

test('groups: pass-through, opacity, blend mode and visibility apply to the children', () => {
  const { doc, group, child } = docWithGroup();
  assert.deepEqual(doc.layers.map((c) => c.name), ['Camada 1', 'Filho', 'G']);
  assert.equal(child.parent, group.id);
  assert.equal(doc.composite(0)[0], FRONT, 'normal group at 100% passes through');
  group.visible = false;
  assert.equal(doc.composite(0)[0], WHITE, 'hidden group hides its children');
  assert.equal(doc.composite(0, undefined, { includeHidden: true })[0], FRONT);
  group.visible = true;
  group.opacity = 50;
  assert.equal(doc.composite(0)[0], overlay(WHITE, FRONT, 0.5));
  group.opacity = 100;
  group.blendMode = 'darken';
  assert.equal(doc.composite(0)[0], pack(100, 150, 200));
  group.blendMode = 'multiply';
  child.blendMode = 'normal';
  doc.cell(doc.frames[0].id, child.id)[1] = pack(0, 0, 0, 0);
  assert.equal(doc.composite(0)[1], WHITE, 'transparent child pixel leaves the backdrop');
});

test('groups: an ungrouped 2.0.0 document composites exactly as before', () => {
  const doc = new PixelDocument(3, 1);
  const top = doc.addLayer('Topo');
  const q = doc.frames[0].id;
  doc.cell(q, doc.layers[0].id).set([RED, pack(1, 2, 3, 100), 0]);
  doc.cell(q, top.id).set([pack(9, 9, 9, 128), BLUE, pack(4, 5, 6, 255)]);
  top.opacity = 70;
  const expected = new Uint32Array(3);
  for (const layer of doc.layers) {
    const px = doc.cell(q, layer.id);
    for (let p = 0; p < 3; p++) if (px[p] >>> 24) expected[p] = overlay(expected[p], px[p], layer.opacity / 100);
  }
  assert.deepEqual([...doc.composite(0)], [...expected]);
});

test('groups: move in and out, nested groups, duplicate and delete with children', () => {
  const { doc, base, group, child } = docWithGroup();
  const inner = doc.addGroup('Interno', doc.layerIndex(child.id) + 1, group.id);
  assert.equal(doc.depth(inner.id), 1);
  // The base layer sits right below the expanded group G: moving it up enters G as its bottom child.
  assert.ok(doc.moveLayer(base.id, 1));
  assert.equal(base.parent, group.id, 'entered the group from below');
  assert.ok(doc.moveLayer(base.id, -1));
  assert.equal(base.parent, null, 'left the group at its bottom');
  // The expanded inner group is the sibling above the child: moving up enters it, moving up again leaves it.
  assert.ok(doc.moveLayer(child.id, 1));
  assert.equal(child.parent, inner.id);
  assert.ok(doc.moveLayer(child.id, 1));
  assert.equal(child.parent, group.id, 'leaving the inner group puts it above the inner header');
  assert.ok(doc.layerIndex(child.id) > doc.layerIndex(inner.id));
  const copy = doc.duplicateLayer(group.id);
  assert.equal(copy.kind, 'group');
  assert.equal(doc.layers.filter((c) => c.parent === copy.id).length, 2);
  assert.equal(doc.cell(doc.frames[0].id, doc.layers.find((c) => c.parent === copy.id && c.kind === 'image').id)[0], FRONT);
  const before = doc.layers.length;
  assert.ok(doc.removeLayer(copy.id));
  assert.equal(doc.layers.length, before - 3);
  assert.ok(doc.ungroup(inner.id));
  assert.equal(doc.layers.some((c) => c.id === inner.id), false);
  assert.throws(() => doc.mergeDown(group.id), /mesclar/);
});

test('groups: a group can only be removed while an image layer remains elsewhere', () => {
  const doc = new PixelDocument(2, 2);
  const group = doc.groupLayer(doc.layers[0].id);
  assert.equal(doc.removeLayer(group.id), false);
  assert.equal(doc.removeLayer(doc.layers[0].id), false);
});

// ---- blend modes in merge, reference layers -----------------------------------------------------------------

test('reference layers show only when asked and mergeDown honors the blend mode', () => {
  const doc = new PixelDocument(1, 1);
  const q = doc.frames[0].id;
  doc.cell(q, doc.layers[0].id)[0] = BACK;
  const ref = doc.addLayer('Ref');
  ref.reference = true;
  doc.cell(q, ref.id)[0] = RED;
  assert.equal(doc.composite(0)[0], BACK);
  assert.equal(doc.composite(0, undefined, { includeReference: true })[0], RED);
  ref.reference = false;
  ref.blendMode = 'multiply';
  doc.cell(q, ref.id)[0] = FRONT;
  const expected = blendPixel('multiply', BACK, FRONT);
  assert.equal(doc.composite(0)[0], expected);
  doc.mergeDown(ref.id);
  assert.equal(doc.cell(q, doc.layers[0].id)[0], expected);
});

// ---- linked cels -------------------------------------------------------------------------------------------

test('linked cels share pixels, survive history, unlink and frame removal', () => {
  const doc = new PixelDocument(2, 2);
  const layer = doc.layers[0].id;
  const [a] = doc.frames;
  const b = doc.addFrame();
  const c = doc.addLinkedFrame(a.id, 2);
  doc.linkCels(layer, [a.id, b.id]);
  assert.equal(doc.cell(a.id, layer), doc.cell(b.id, layer));
  assert.equal(doc.cell(a.id, layer), doc.cell(c.id, layer));
  doc.cell(b.id, layer)[0] = RED;
  assert.equal(doc.cell(c.id, layer)[0], RED, 'editing one edits all');
  assert.ok(doc.isLinked(c.id, layer));
  const state = doc.snapshot();
  doc.restore(state);
  assert.equal(doc.cell(a.id, layer), doc.cell(c.id, layer), 'restore keeps the sharing');
  assert.ok(doc.unlinkCel(c.id, layer));
  doc.cell(c.id, layer)[1] = BLUE;
  assert.equal(doc.cell(a.id, layer)[1], 0);
  assert.ok(doc.removeFrame(a.id), 'removing the source promotes another linked cel');
  assert.equal(doc.cell(b.id, layer)[0], RED);
  assert.equal(doc.isLinked(b.id, layer), false);
  doc.resize(4, 4);
  const d = doc.addLinkedFrame(b.id);
  doc.scale(2, 2);
  assert.equal(doc.cell(b.id, layer), doc.cell(d.id, layer), 'geometry keeps linked cels shared');
});

// ---- tags and playback -------------------------------------------------------------------------------------

test('tags: playback order for forward, reverse and ping-pong', () => {
  assert.deepEqual(tagSequence(1, 3, 'forward'), { frames: [1, 2, 3], loop: true });
  assert.deepEqual(tagSequence(1, 3, 'reverse'), { frames: [3, 2, 1], loop: true });
  assert.deepEqual(tagSequence(1, 3, 'pingpong'), { frames: [1, 2, 3, 2], loop: true });
  assert.deepEqual(tagSequence(0, 2, 'forward', 2), { frames: [0, 1, 2, 0, 1, 2], loop: false });
  assert.deepEqual(tagSequence(0, 2, 'pingpong', 3), { frames: [0, 1, 2, 1, 0, 1, 2], loop: false });
  assert.deepEqual(tagSequence(0, 1, 'reverse', 1), { frames: [1, 0], loop: false });
});

test('tags: playback loops inside the tag of the current frame', () => {
  const doc = new PixelDocument(2, 2);
  for (let i = 0; i < 4; i++) doc.addFrame();
  const tag = doc.addTag({ name: 'Andar', from: doc.frames[3].id, to: doc.frames[1].id, direction: 'pingpong' });
  assert.equal(tag.from, doc.frames[1].id, 'range is normalized');
  const p = new Playback(doc, 2);
  assert.deepEqual([p.next(), p.next(), p.next(), p.next(), p.next()], [3, 2, 1, 2, 3]);
  const all = new Playback(doc, 4);
  assert.deepEqual([all.next(), all.next()], [0, 1], 'outside a tag every frame plays in a loop');
  tag.repeat = 1;
  tag.direction = 'forward';
  const once = new Playback(doc, 1);
  assert.deepEqual([once.next(), once.next(), once.next()], [2, 3, -1]);
  assert.ok(doc.removeFrame(doc.frames[1].id));
  assert.equal(doc.frameIndex(tag.from), 1, 'removing the first frame of a tag moves its start');
});

// ---- tilemaps ------------------------------------------------------------------------------------------------

function tilemapDoc() {
  const doc = new PixelDocument(4, 2);
  const tileset = createTileset(doc, 2, 2);
  const t1 = addTile(tileset, [RED, RED, RED, RED]);
  const layer = doc.addLayer('Tiles');
  layer.kind = 'tilemap';
  layer.tileset = tileset.id;
  return { doc, tileset, layer, t1, q: doc.frames[0].id };
}

test('tilemaps: placing tiles renders pixels and pixel edits update every instance', () => {
  const { doc, tileset, layer, t1, q } = tilemapDoc();
  assert.ok(placeTile(doc, q, layer.id, 0, 0, t1));
  assert.ok(placeTile(doc, q, layer.id, 3, 1, t1));
  assert.equal(placeTile(doc, q, layer.id, 3, 1, t1), false);
  assert.deepEqual([...doc.cell(q, layer.id)], [RED, RED, RED, RED, RED, RED, RED, RED]);
  assert.equal(tileIndexAt(doc, q, layer.id, 2, 0), t1);
  applyPixelsToTiles(doc, q, layer.id, [[1, BLUE]]);
  assert.equal(tileset.tiles[t1][1], BLUE);
  assert.equal(doc.cell(q, layer.id)[3], BLUE, 'the other instance changed too');
  placeTile(doc, q, layer.id, 0, 0, 0);
  assert.equal(doc.cell(q, layer.id)[0], 0, 'tile 0 is the empty tile');
  applyPixelsToTiles(doc, q, layer.id, [[0, GREEN]]);
  assert.equal(tileset.tiles.length, 3, 'painting over the empty tile creates a tile');
  assert.equal(doc.composite(0)[0], GREEN);
  doc.resize(6, 2, 0, 0);
  assert.equal(tileGrid(doc, q, layer.id).length, 3);
  assert.equal(doc.cell(q, layer.id)[0], GREEN, 'pixels re-rendered after resize');
});

// ---- .crivo round trip ----------------------------------------------------------------------------------------

test('.crivo: every 2.1.0 field survives a round trip and history snapshots', () => {
  const { doc, layer, t1, q } = tilemapDoc();
  placeTile(doc, q, layer.id, 2, 0, t1);
  const group = doc.groupLayer(doc.layers[0].id, 'Fundo');
  group.blendMode = 'screen';
  group.collapsed = true;
  layer.reference = true;
  doc.colorMode = 'indexed';
  const b = doc.addLinkedFrame(q);
  doc.cell(q, doc.layers[0].id)[0] = RED;
  doc.addTag({ name: 'Idle', from: q, to: b.id, direction: 'reverse', repeat: 2, color: '#123456' });
  doc.addSlice({ name: 'Botão', color: '#abcdef', x: 1, y: 0, width: 3, height: 2, center: { x: 1, y: 0, width: 1, height: 1 }, pivot: { x: 1, y: 1 } });
  const data = serialize(doc);
  const json = JSON.stringify(data);
  const back = deserialize(json);
  assert.equal(JSON.stringify(serialize(back)), json, 'serialize(deserialize(x)) is stable');
  assert.equal(back.colorMode, 'indexed');
  assert.deepEqual(back.layers.map((c) => [c.kind, c.blendMode, c.parent === null ? null : back.layer(c.parent).name, c.collapsed, c.reference]), [
    ['image', 'normal', 'Fundo', false, false],
    ['group', 'screen', null, true, false],
    ['tilemap', 'normal', null, false, true],
  ]);
  assert.equal(back.tags[0].direction, 'reverse');
  assert.equal(back.tags[0].repeat, 2);
  assert.deepEqual(back.slices[0].center, { x: 1, y: 0, width: 1, height: 1 });
  assert.deepEqual(back.slices[0].pivot, { x: 1, y: 1 });
  assert.equal(back.tilesets[0].tiles.length, 2);
  const [q0, q1] = back.frames.map((f) => f.id);
  assert.equal(back.cell(q0, back.layers[0].id), back.cell(q1, back.layers[0].id), 'linked cels are shared after loading');
  assert.equal(back.cell(q1, back.layers[0].id)[0], RED);
  assert.equal(back.cell(q1, back.layers[2].id)[2], RED, 'tilemap pixels rendered');
  const cel = data.cells.find((c) => c.frame === q1 && c.layer === doc.layers[0].id);
  assert.equal(cel.link, q0);
  assert.ok(cel.rle, 'linked cels still carry their own pixels for 2.0.0 readers');
  assert.ok(data.cells.some((c) => c.tiles));
  // History: undo/redo of a structural change brings every new field back.
  const h = new History();
  const before = back.snapshot();
  back.tags = [];
  back.slices = [];
  back.unlinkCel(q1, back.layers[0].id);
  back.layers[1].blendMode = 'normal';
  h.recordState('Mudança', before, back.snapshot());
  h.undo(back);
  assert.equal(JSON.stringify(serialize(back)), json);
  h.redo(back);
  assert.equal(back.tags.length, 0);
});

test('.crivo: a 2.0.0 file serializes byte-identically', () => {
  const doc = new PixelDocument(4, 3, { name: 'Antigo', fps: 12 });
  doc.palette = [RED, BLUE];
  const top = doc.addLayer('Topo');
  top.opacity = 40;
  top.locked = true;
  const f2 = doc.addFrame(1, 120);
  doc.cell(doc.frames[0].id, doc.layers[0].id)[3] = RED;
  doc.cell(f2.id, top.id)[5] = BLUE;
  const expected = {
    format: 'crivo',
    version: 2,
    name: 'Antigo',
    width: 4,
    height: 3,
    fps: 12,
    palette: ['#ff0000', '#0000ff'],
    layers: doc.layers.map((c) => ({ id: c.id, name: c.name, visible: c.visible, opacity: c.opacity, locked: c.locked })),
    frames: doc.frames.map((q) => ({ id: q.id, duration: q.duration })),
    cells: [
      { frame: doc.frames[0].id, layer: doc.layers[0].id, rle: toBase64(encodeRLE(doc.cell(doc.frames[0].id, doc.layers[0].id))) },
      { frame: f2.id, layer: top.id, rle: toBase64(encodeRLE(doc.cell(f2.id, top.id))) },
    ],
  };
  const text = JSON.stringify(serialize(doc));
  assert.equal(text, JSON.stringify(expected));
  assert.equal(JSON.stringify(serialize(deserialize(text))), text, 'opening and saving a 2.0.0 file changes nothing');
});

test('.crivo: invalid 2.1.0 data is dropped, not fatal', () => {
  const doc = new PixelDocument(2, 2);
  const data = serialize(doc);
  data.layers[0].parent = 'nope';
  data.layers[0].kind = 'tilemap';
  data.layers[0].blendMode = 'weird';
  data.tags = [{ id: 'x', name: 'Ruim', from: 'missing', to: 'missing' }];
  data.tilesets = [{ id: 't', tileWidth: 0, tileHeight: 2, tiles: [] }];
  data.colorMode = 'cmyk';
  const back = deserialize(data);
  assert.deepEqual([back.layers[0].parent, back.layers[0].kind, back.layers[0].blendMode], [null, 'image', 'normal']);
  assert.equal(back.tags.length, 0);
  assert.equal(back.tilesets.length, 0);
  assert.equal(back.colorMode, 'rgba');
});
