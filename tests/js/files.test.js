import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { pack } from '../../editor/static/editor/js/core/colors.js';
import { readAseprite, writeAseprite, parseAseprite, layerFileOrder, BLEND_MODES } from '../../editor/static/editor/js/core/ase-file.js';
import { encodeAPNG, encodePNG, readPNGChunks } from '../../editor/static/editor/js/core/apng.js';
import { createZip } from '../../editor/static/editor/js/core/zip.js';
import { crc32, deflate, inflate, deflateStored } from '../../editor/static/editor/js/core/zlib.js';
import { sheetLayout, asepriteSheetMetadata } from '../../editor/static/editor/js/core/export.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const RED = pack(255, 0, 0);
const GREEN = pack(0, 255, 0);
const BLUE = pack(0, 0, 255);
const HALF = pack(10, 20, 30, 128);

function sampleDocument() {
  const doc = new PixelDocument(6, 4, { name: 'Herói', fps: 8, empty: true });
  doc.palette = [RED, GREEN, BLUE];
  const bottom = doc.addLayer('Fundo');
  const group = doc.addLayer('Grupo');
  const child = doc.addLayer('Filho', doc.layerIndex(group.id));
  Object.assign(group, { kind: 'group', blendMode: 'normal', opacity: 60, collapsed: true });
  Object.assign(child, { parent: group.id, blendMode: 'multiply', opacity: 50, locked: true });
  Object.assign(bottom, { blendMode: 'screen', visible: false });
  const top = doc.addLayer('Referência');
  top.reference = true;
  const f1 = doc.addFrame();
  const f2 = doc.addFrame(1, 250);
  const f3 = doc.addFrame();
  doc.cell(f1.id, bottom.id).fill(BLUE);
  const px = doc.cell(f1.id, child.id);
  px[0] = RED;
  px[7] = HALF;
  px[23] = GREEN;
  doc.cell(f2.id, child.id)[3] = GREEN;
  doc.cell(f1.id, top.id)[5] = RED;
  // Linked cel: frame 3 shares frame 1's buffer (the document API when available, the same array otherwise).
  if (typeof doc.linkCels === 'function') doc.linkCels(child.id, [f1.id, f3.id]);
  else doc.cells.set(doc.key(f3.id, child.id), px);
  doc.tags = [{ id: 't1', name: 'andar', from: f1.id, to: f2.id, direction: 'pingpong', repeat: 2, color: '#ff8000' }];
  doc.slices = [{ id: 's1', name: 'colisão', color: '#00ff00', x: 1, y: 1, width: 3, height: 2, center: { x: 1, y: 0, width: 1, height: 1 }, pivot: { x: 2, y: 1 } }];
  return { doc, bottom, group, child, top, f1, f2, f3 };
}

test('zlib: deflate/inflate round trip, stored fallback and CRC-32', async () => {
  const data = new TextEncoder().encode('crivo '.repeat(5000));
  assert.deepEqual(await inflate(await deflate(data)), data);
  assert.deepEqual(await inflate(deflateStored(data)), data);
  assert.deepEqual(await inflate(deflateStored(new Uint8Array(0))), new Uint8Array(0));
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('aseprite: layer file order is pre-order with groups before their children', () => {
  const { doc, group, child } = sampleDocument();
  const order = layerFileOrder(doc.layers);
  assert.deepEqual(order.map((o) => [o.layer.name, o.level]), [['Fundo', 0], ['Grupo', 0], ['Filho', 1], ['Referência', 0]]);
  assert.equal(doc.layerIndex(child.id) + 1, doc.layerIndex(group.id));
});

for (const compress of [true, false]) {
  test(`aseprite: export → import round trip (${compress ? 'zlib' : 'raw'} cels)`, async () => {
    const { doc, child, f1, f2, f3 } = sampleDocument();
    const bytes = await writeAseprite(doc, { compress });
    assert.equal(new DataView(bytes.buffer).getUint32(0, true), bytes.length, 'file size in the header');
    assert.equal(new DataView(bytes.buffer).getUint16(4, true), 0xa5e0);
    const parsed = parseAseprite(bytes);
    assert.deepEqual([...new Set(parsed.cels.map((c) => c.type))].sort(), compress ? [1, 2] : [0, 1]);
    const back = await readAseprite(bytes, { name: 'Herói' });
    assert.equal(back.width, 6);
    assert.equal(back.height, 4);
    assert.equal(back.fps, 8);
    assert.equal(back.colorMode, 'rgba');
    assert.deepEqual(back.frames.map((q) => q.duration), [null, 250, null]);
    assert.deepEqual(back.palette, [RED, GREEN, BLUE]);
    assert.deepEqual(
      back.layers.map((l) => [l.name, l.kind, l.blendMode, l.opacity, l.visible, l.locked, Boolean(l.collapsed), Boolean(l.reference)]),
      [
        ['Fundo', 'image', 'screen', 100, false, false, false, false],
        ['Filho', 'image', 'multiply', 50, true, true, false, false],
        ['Grupo', 'group', 'normal', 60, true, false, true, false],
        ['Referência', 'image', 'normal', 100, true, false, false, true],
      ],
    );
    const [bottom, kid, grp] = back.layers;
    assert.equal(kid.parent, grp.id);
    assert.equal(grp.parent, null);
    assert.equal(bottom.parent, null);
    for (const [frame, i] of [[f1, 0], [f2, 1], [f3, 2]]) {
      assert.deepEqual([...back.cell(back.frames[i].id, kid.id)], [...doc.cell(frame.id, child.id)], `frame ${i + 1}`);
    }
    assert.ok(back.cell(back.frames[0].id, bottom.id).every((c) => c === BLUE));
    if (typeof back.linkCels === 'function') {
      assert.equal(back.cell(back.frames[2].id, kid.id), back.cell(back.frames[0].id, kid.id), 'linked cel shares the buffer');
    }
    assert.deepEqual(
      back.tags.map((t) => [t.name, back.frameIndex(t.from), back.frameIndex(t.to), t.direction, t.repeat, t.color]),
      [['andar', 0, 1, 'pingpong', 2, '#ff8000']],
    );
    assert.deepEqual(
      back.slices.map(({ name, color, x, y, width, height, center, pivot }) => ({ name, color, x, y, width, height, center, pivot })),
      [{ name: 'colisão', color: '#00ff00', x: 1, y: 1, width: 3, height: 2, center: { x: 1, y: 0, width: 1, height: 1 }, pivot: { x: 2, y: 1 } }],
    );
  });
}

test('aseprite: every blend mode survives the round trip', async () => {
  const doc = new PixelDocument(2, 2, { name: 'b', empty: true });
  doc.addFrame();
  for (const mode of BLEND_MODES) {
    const l = doc.addLayer(mode);
    l.blendMode = mode;
    doc.cell(doc.frames[0].id, l.id)[0] = RED;
  }
  const back = await readAseprite(await writeAseprite(doc));
  assert.deepEqual(back.layers.map((l) => l.blendMode), BLEND_MODES);
});

test('aseprite: hand-built indexed fixture (palette, transparent index, linked cel, tag, slice)', async () => {
  const doc = await readAseprite(fixture('indexed.aseprite'), { name: 'indexed' });
  assert.equal(doc.colorMode, 'indexed');
  assert.deepEqual([doc.width, doc.height, doc.fps], [4, 3, 10]);
  assert.deepEqual(doc.frames.map((q) => q.duration), [null, 200]);
  assert.deepEqual(doc.palette, [pack(0, 0, 0), RED, GREEN, BLUE]);
  const [layer] = doc.layers;
  assert.deepEqual([layer.name, layer.opacity, layer.visible, layer.locked], ['Fundo', 50, true, false]);
  const px = [...doc.cell(doc.frames[0].id, layer.id)];
  assert.deepEqual(px, [0, 0, 0, 0, 0, RED, GREEN, 0, 0, BLUE, 0, RED]);
  assert.deepEqual([...doc.cell(doc.frames[1].id, layer.id)], px, 'linked cel copies frame 1');
  assert.deepEqual(doc.tags.map((t) => [t.name, t.direction, t.repeat, t.color]), [['idle', 'pingpong', 2, '#ff8000']]);
  assert.deepEqual(doc.slices[0].center, { x: 0, y: 1, width: 1, height: 1 });
  assert.deepEqual(doc.slices[0].pivot, { x: 1, y: 2 });
  assert.deepEqual([doc.slices[0].name, doc.slices[0].width, doc.slices[0].height], ['hitbox', 2, 3]);
});

test('aseprite: hand-built grayscale fixture (group, child level, cel opacity, old palette chunk)', async () => {
  const doc = await readAseprite(fixture('grayscale.ase'));
  assert.equal(doc.colorMode, 'grayscale');
  assert.deepEqual(doc.palette, [pack(10, 20, 30), pack(40, 50, 60)]);
  assert.deepEqual(doc.layers.map((l) => [l.name, l.kind, l.blendMode, l.opacity]), [['Filho', 'image', 'multiply', 100], ['Grupo', 'group', 'normal', 100]]);
  assert.equal(doc.layers[0].parent, doc.layers[1].id);
  assert.equal(doc.layers[1].collapsed, true);
  assert.equal(doc.layers[1].locked, true);
  assert.deepEqual([...doc.cell(doc.frames[0].id, doc.layers[0].id)], [pack(200, 200, 200, 128), pack(100, 100, 100, 128), 0, pack(50, 50, 50, 64)]);
});

test('aseprite: hand-built tilemap fixture (tileset, compressed tilemap, X flip)', async () => {
  const doc = await readAseprite(fixture('tilemap.aseprite'));
  const [layer] = doc.layers;
  assert.equal(layer.kind, 'tilemap');
  assert.equal(doc.tilesets.length, 1);
  assert.equal(layer.tileset, doc.tilesets[0].id);
  assert.deepEqual([doc.tilesets[0].tileWidth, doc.tilesets[0].tiles.length], [2, 2]);
  const R = 0xff0000ff;
  const G = 0xff00ff00;
  const B = 0xffff0000;
  const Wh = 0xffffffff;
  assert.deepEqual([...doc.cell(doc.frames[0].id, layer.id)], [R, G, G, R, B, Wh, Wh, B]);
  assert.deepEqual([...doc.tileCells.get(doc.key(doc.frames[0].id, layer.id))], [1, 1]);
});

test('aseprite: invalid files are rejected with a message', async () => {
  await assert.rejects(readAseprite(new Uint8Array(200)), /não é um \.ase válido/);
  await assert.rejects(readAseprite(new Uint8Array(10)), /incompleto/);
});

test('apng: chunk structure, sequence numbers, delays and CRCs', async () => {
  const frames = [Uint32Array.from([RED, 0, GREEN, BLUE]), Uint32Array.from([BLUE, BLUE, 0, RED]), Uint32Array.from([0, 0, 0, HALF])];
  const bytes = await encodeAPNG(frames, 2, 2, { delays: [100, 250, 40] });
  const chunks = readPNGChunks(bytes);
  assert.ok(chunks.every((c) => c.valid), 'every CRC matches');
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
  const be = (d, at) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at);
  const actl = chunks[1].data;
  assert.deepEqual([be(actl, 0), be(actl, 4)], [3, 0]);
  const seq = chunks.filter((c) => c.type === 'fcTL' || c.type === 'fdAT').map((c) => be(c.data, 0));
  assert.deepEqual(seq, [0, 1, 2, 3, 4]);
  const delays = chunks.filter((c) => c.type === 'fcTL').map((c) => [(c.data[20] << 8) | c.data[21], (c.data[22] << 8) | c.data[23]]);
  assert.deepEqual(delays, [[100, 1000], [250, 1000], [40, 1000]]);
  const raw = await inflate(chunks[5].data.subarray(4));
  assert.deepEqual([...raw], [0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 255, 0, 0, 255], 'frame 2 scanlines (filter 0 + RGBA)');
  const png = readPNGChunks(await encodePNG(frames[0], 2, 2));
  assert.deepEqual(png.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
});

test('zip: store-only archive opens in Python zipfile with matching CRCs', async () => {
  const frames = [Uint32Array.from([RED, GREEN]), Uint32Array.from([BLUE, 0])];
  const files = [];
  for (let i = 0; i < frames.length; i++) files.push({ name: `herói-${i + 1}.png`, data: await encodePNG(frames[i], 2, 1) });
  const zip = createZip(files, { date: new Date(2026, 9, 23, 12, 30, 10) });
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  assert.equal(view.getUint32(central + 16, true), crc32(files[0].data));
  const dir = mkdtempSync(join(tmpdir(), 'crivo-zip-'));
  const path = join(dir, 'frames.zip');
  writeFileSync(path, zip);
  const script = 'import sys, zipfile, json\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps([[i.filename, i.file_size, z.read(i)[:8].hex()] for i in z.infolist()]))';
  let listing;
  try {
    listing = JSON.parse(execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }));
  } catch (error) {
    if (error.code === 'ENOENT') return; // no Python on this machine: the structural checks above still ran
    throw error;
  }
  assert.deepEqual(listing, files.map((f) => [f.name, f.data.length, '89504e470d0a1a0a']));
});

test('sprite sheet: Aseprite-compatible JSON (hash and array)', () => {
  const { doc } = sampleDocument();
  const layout = sheetLayout(doc.frames.length, doc.width * 2, doc.height * 2, { layout: 'horizontal', spacing: 1 });
  const hash = asepriteSheetMetadata(doc, layout, { image: 'heroi.png', scale: 2, format: 'hash' });
  const names = Object.keys(hash.frames);
  assert.equal(names.length, 3);
  const first = hash.frames[names[0]];
  assert.deepEqual(first, { frame: { x: 0, y: 0, w: 12, h: 8 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 12, h: 8 }, sourceSize: { w: 12, h: 8 }, duration: 125 });
  assert.equal(hash.frames[names[1]].duration, 250);
  assert.deepEqual(hash.frames[names[1]].frame, { x: 13, y: 0, w: 12, h: 8 });
  assert.deepEqual(Object.keys(hash.meta), ['app', 'version', 'image', 'format', 'size', 'scale', 'frameTags', 'layers', 'slices']);
  assert.deepEqual(hash.meta.size, { w: layout.width, h: layout.height });
  assert.equal(hash.meta.scale, '2');
  assert.equal(hash.meta.format, 'RGBA8888');
  assert.deepEqual(hash.meta.frameTags, [{ name: 'andar', from: 0, to: 1, direction: 'pingpong', color: '#ff8000ff' }]);
  assert.deepEqual(hash.meta.layers.find((l) => l.name === 'Filho'), { name: 'Filho', group: 'Grupo', opacity: 128, blendMode: 'multiply' });
  assert.deepEqual(hash.meta.slices[0].keys[0], { frame: 0, bounds: { x: 1, y: 1, w: 3, h: 2 }, center: { x: 1, y: 0, w: 1, h: 1 }, pivot: { x: 2, y: 1 } });
  const array = asepriteSheetMetadata(doc, layout, { image: 'heroi.png', scale: 2, format: 'array' });
  assert.ok(Array.isArray(array.frames));
  assert.equal(array.frames[0].filename, names[0]);
  assert.deepEqual(array.frames[2].frame, { x: 26, y: 0, w: 12, h: 8 });
});

test('aseprite: tilemap layers export as tileset + compressed tilemap and come back', async () => {
  const doc = new PixelDocument(4, 4, { name: 'mapa', empty: true });
  const frame = doc.addFrame();
  const layer = doc.addLayer('Chão');
  Object.assign(layer, { kind: 'tilemap', tileset: 'ts1' });
  doc.tilesets = [{ id: 'ts1', name: 'Blocos', tileWidth: 2, tileHeight: 2, tiles: [new Uint32Array(4), Uint32Array.from([RED, GREEN, BLUE, RED])] }];
  if (!(doc.tileCells instanceof Map)) doc.tileCells = new Map();
  doc.tileCells.set(doc.key(frame.id, layer.id), Uint32Array.from([1, 0, 0, 1]));
  const px = doc.cell(frame.id, layer.id);
  px.set([RED, GREEN, 0, 0, BLUE, RED, 0, 0, 0, 0, RED, GREEN, 0, 0, BLUE, RED]);
  const bytes = await writeAseprite(doc);
  const parsed = parseAseprite(bytes);
  assert.deepEqual([parsed.tilesets.length, parsed.layers[0].kind, parsed.cels[0].type], [1, 2, 3]);
  const back = await readAseprite(bytes);
  const [l] = back.layers;
  assert.equal(l.kind, 'tilemap');
  assert.equal(back.tilesets[0].name, 'Blocos');
  assert.equal(l.tileset, back.tilesets[0].id);
  assert.deepEqual([...back.tileCells.get(back.key(back.frames[0].id, l.id))], [1, 0, 0, 1]);
  assert.deepEqual([...back.cell(back.frames[0].id, l.id)], [...px]);
});
