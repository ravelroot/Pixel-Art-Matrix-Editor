import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { pack } from '../../editor/static/editor/js/core/colors.js';
import { paginate, clampFlips, leafPose, spread, spreadLabel, frameDelays, framesToRender, isBlank, pageCount, pageNumber, FAN, readCovers, bookTitle, TITLES, PHOTO_LIMIT } from '../../editor/static/editor/js/core/sketchbook.js';

test('paginate keeps a minimum of leaves and reserves the last left page for the end', () => {
  const empty = paginate([]);
  assert.equal(empty.leaves, 3);
  assert.equal(empty.pages.length, 6);
  assert.equal(empty.total, 5);
  assert.ok(empty.pages.every((p) => p === null));
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const full = paginate(items);
  assert.equal(full.leaves, 4);
  assert.deepEqual(full.pages, ['a', 'b', 'c', 'd', 'e', 'f', null, null]);
  assert.equal(paginate(['a', 'b', 'c', 'd', 'e']).pages.at(-1), null);
  assert.equal(paginate([], 6).leaves, 6);
  assert.equal(pageCount(3), 5);
  assert.equal(pageNumber(0), '01');
  assert.equal(pageNumber(11), '12');
});

test('clampFlips stays between the closed book and the last spread', () => {
  assert.equal(clampFlips(-3, 5), 0);
  assert.equal(clampFlips(2, 5), 2);
  assert.equal(clampFlips(9, 5), 4);
});

test('leafPose fans the right stack, mirrors the left one and caps the fan', () => {
  const top = leafPose(1, 1, { gap: 10, depth: 20 });
  assert.deepEqual([top.flipped, top.level, top.x, top.z, top.rotate], [false, 0, 0, -0, 0]);
  const second = leafPose(2, 1, { gap: 10, depth: 20 });
  assert.deepEqual([second.x, second.z, second.rotate], [10, -20, 0]);
  const flipped = leafPose(0, 1, { gap: 10, depth: 20 });
  assert.deepEqual([flipped.flipped, flipped.level, flipped.x, flipped.rotate], [true, 0, -0, -180]);
  const deepLeft = leafPose(0, 4, { gap: 10, depth: 20 });
  assert.deepEqual([deepLeft.level, deepLeft.x, deepLeft.z], [3, -30, -60]);
  const far = leafPose(FAN + 3, 0, { gap: 10, depth: 20 });
  assert.equal(far.x, FAN * 10);
  assert.equal(far.z, -(FAN * 20 + 1.5));
  assert.ok(far.shade <= 0.3);
  assert.equal(leafPose(1, 0).shade > leafPose(0, 0).shade, true);
});

test('spread and spreadLabel describe what is on screen', () => {
  assert.deepEqual(spread(0, 3), { left: null, right: null, cover: true, end: false });
  assert.deepEqual(spread(1, 3), { left: null, right: 0, cover: false, end: false });
  assert.deepEqual(spread(2, 3), { left: 1, right: 2, cover: false, end: false });
  assert.deepEqual(spread(4, 3), { left: 5, right: null, cover: false, end: true });
  assert.equal(spreadLabel(0, 3), 'Capa');
  assert.equal(spreadLabel(1, 3), 'Página 1 de 5');
  assert.equal(spreadLabel(3, 3), 'Páginas 4–5 de 5');
  assert.equal(spreadLabel(4, 3), 'Fim · 5 páginas');
});

test('frame delays, render budget and blank detection follow the document', () => {
  const doc = new PixelDocument(4, 4, { name: 'Pisca', fps: 10, empty: true });
  const layer = doc.addLayer('Fundo');
  const a = doc.addFrame();
  doc.addFrame(1, 250);
  assert.deepEqual(frameDelays(doc), [100, 250]);
  assert.equal(framesToRender(doc), 2);
  assert.equal(framesToRender(doc, 20), 1);
  assert.equal(framesToRender(doc, 2000000, 1), 1);
  assert.equal(isBlank(doc.composite(0)), true);
  doc.cell(a.id, layer.id)[5] = pack(93, 28, 22);
  assert.equal(isBlank(doc.composite(0)), false);
  assert.equal(isBlank(doc.composite(1)), true);
});

test('readCovers keeps valid names and photos per notebook and bookTitle falls back to the default', () => {
  const photo = 'data:image/jpeg;base64,AAAA';
  const covers = readCovers({
    open: { name: '  Meus sprites  ', photo },
    saved: { name: 'x'.repeat(60), photo: 'javascript:alert(1)' },
    blank: { name: '', photo: 'data:image/png;base64,' + 'A'.repeat(PHOTO_LIMIT) },
    other: { name: 'Fora' },
  });
  assert.deepEqual(covers.open, { name: 'Meus sprites', photo });
  assert.deepEqual(covers.saved, { name: 'x'.repeat(40), photo: null });
  assert.equal(covers.blank, undefined);
  assert.equal(covers.other, undefined);
  assert.deepEqual(readCovers(null), {});
  assert.deepEqual(readCovers([1, 2]), {});
  assert.equal(bookTitle('open', covers), 'Meus sprites');
  assert.equal(bookTitle('blank', covers), TITLES.blank);
});
