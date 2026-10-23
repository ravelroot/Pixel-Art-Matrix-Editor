import { PixelDocument } from './document.js';
import { encodeRLE, decodeRLE } from './rle.js';

export const CELL_THRESHOLD = 2048;

export class Stroke {
  constructor(key, pixels) {
    this.key = key;
    this.pixels = pixels;
    this.originals = new Map();
  }

  paint(index, color) {
    const current = this.pixels[index];
    if (current === color) return false;
    if (!this.originals.has(index)) this.originals.set(index, current);
    this.pixels[index] = color;
    return true;
  }

  get empty() {
    for (const [i, before] of this.originals) if (this.pixels[i] !== before) return false;
    return true;
  }

  revertVisual() {
    for (const [i, before] of this.originals) this.pixels[i] = before;
    this.originals.clear();
  }

  finish(label) {
    const changes = [];
    for (const [i, before] of this.originals) if (this.pixels[i] !== before) changes.push(i);
    if (!changes.length) return null;
    changes.sort((a, b) => a - b);
    if (changes.length > CELL_THRESHOLD) {
      const before = this.pixels.slice();
      for (const i of changes) before[i] = this.originals.get(i);
      return { type: 'cell', label, key: this.key, before: encodeRLE(before), after: encodeRLE(this.pixels) };
    }
    const indices = Uint32Array.from(changes);
    const before = new Uint32Array(indices.length);
    const after = new Uint32Array(indices.length);
    for (let k = 0; k < indices.length; k++) {
      before[k] = this.originals.get(indices[k]);
      after[k] = this.pixels[indices[k]];
    }
    return { type: 'pixels', label, key: this.key, indices, before, after };
  }
}

export function entrySize(e) {
  if (e.type === 'pixels') return e.indices.byteLength + e.before.byteLength + e.after.byteLength + 96;
  if (e.type === 'cell') return e.before.byteLength + e.after.byteLength + 96;
  if (e.type === 'state') return PixelDocument.snapshotBytes(e.before) + PixelDocument.snapshotBytes(e.after);
  if (e.type === 'group') return e.entries.reduce((s, x) => s + entrySize(x), 32);
  return 64;
}

function applyEntry(doc, e, side) {
  if (e.type === 'pixels') {
    const px = doc.cellByKey(e.key);
    const values = e[side];
    for (let k = 0; k < e.indices.length; k++) px[e.indices[k]] = values[k];
  } else if (e.type === 'cell') {
    const px = doc.cellByKey(e.key);
    px.set(decodeRLE(e[side], px.length));
  } else if (e.type === 'state') {
    doc.restore(e[side]);
  } else if (e.type === 'group') {
    const order = side === 'before' ? [...e.entries].reverse() : e.entries;
    for (const x of order) applyEntry(doc, x, side);
  }
}

export class History {
  constructor() {
    this.clear();
  }

  clear() {
    this.past = [];
    this.future = [];
    this.bytes = 0;
    this.version = 0;
  }

  record(entry, context = null) {
    if (!entry) return;
    entry.bytes = entrySize(entry);
    entry.context = context;
    for (const e of this.future) this.bytes -= e.bytes;
    this.future = [];
    this.past.push(entry);
    this.bytes += entry.bytes;
    this.version++;
  }

  recordState(label, before, after, context = null) {
    this.record({ type: 'state', label, before, after }, context);
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get nextUndo() {
    return this.past.at(-1)?.label ?? null;
  }

  get nextRedo() {
    return this.future.at(-1)?.label ?? null;
  }

  undo(doc) {
    const e = this.past.pop();
    if (!e) return null;
    applyEntry(doc, e, 'before');
    this.future.push(e);
    this.version++;
    return e;
  }

  redo(doc) {
    const e = this.future.pop();
    if (!e) return null;
    applyEntry(doc, e, 'after');
    this.past.push(e);
    this.version++;
    return e;
  }
}
