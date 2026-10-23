import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGIF, lzw } from '../../editor/static/editor/js/core/gif.js';
import { pack } from '../../editor/static/editor/js/core/colors.js';

// Minimal decoder (LZW + blocks) only to check what the encoder produces.
function unlzw(data, minSize) {
  const clear = 1 << minSize;
  const end = clear + 1;
  let size = minSize + 1;
  let table = [];
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []));
    size = minSize + 1;
  };
  reset();
  const output = [];
  let pos = 0;
  let previous = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, pos++) v |= ((data[pos >> 3] >> (pos & 7)) & 1) << i;
    return v;
  };
  while (pos + size <= data.length * 8) {
    const code = read();
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === end) break;
    let seq;
    if (code < table.length) seq = table[code];
    else seq = [...table[previous], table[previous][0]];
    output.push(...seq);
    if (previous !== null && table.length < 4096) table.push([...table[previous], seq[0]]);
    if (table.length === 1 << size && size < 12) size++;
    previous = code;
  }
  return output;
}

function readGIF(bytes) {
  const u16 = (i) => bytes[i] | (bytes[i + 1] << 8);
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), 'GIF89a');
  const width = u16(6);
  const height = u16(8);
  const paletteBits = (bytes[10] & 7) + 1;
  let pos = 13 + 3 * (1 << paletteBits);
  const frames = [];
  const delays = [];
  let repeats = false;
  while (bytes[pos] !== 0x3b) {
    if (bytes[pos] === 0x21) {
      if (bytes[pos + 1] === 0xf9) delays.push(u16(pos + 4) * 10);
      if (bytes[pos + 1] === 0xff) repeats = true;
      pos += 2;
      while (bytes[pos]) pos += bytes[pos] + 1;
      pos++;
    } else if (bytes[pos] === 0x2c) {
      pos += 10;
      const minimum = bytes[pos++];
      const data = [];
      while (bytes[pos]) {
        data.push(...bytes.slice(pos + 1, pos + 1 + bytes[pos]));
        pos += bytes[pos] + 1;
      }
      pos++;
      frames.push(unlzw(Uint8Array.from(data), minimum));
    } else throw new Error('Unexpected block ' + bytes[pos]);
  }
  return { width, height, frames, delays, repeats, palette: (i) => [bytes[13 + i * 3], bytes[14 + i * 3], bytes[15 + i * 3]] };
}

test('gif: LZW round trip, including past 4096 codes', () => {
  const shortCodes = [0, 1, 1, 1, 0, 2, 3, 3, 3, 3];
  assert.deepEqual(unlzw(lzw(Uint8Array.from(shortCodes), 2), 2), shortCodes);
  const longCodes = Uint8Array.from({ length: 50000 }, (_, i) => (i * 7919 + (i >> 5)) % 256);
  assert.deepEqual(unlzw(lzw(longCodes, 8), 8), [...longCodes]);
});

test('gif: animation with transparency, exact palette, delays and looping', () => {
  const V = pack(93, 28, 22);
  const P = pack(246, 228, 166);
  const q1 = Uint32Array.from([V, 0, P, V]);
  const q2 = Uint32Array.from([0, P, P, pack(1, 2, 3, 40)]);
  const gif = readGIF(encodeGIF([q1, q2], 2, 2, { delays: [100, 250] }));
  assert.equal(gif.width, 2);
  assert.equal(gif.height, 2);
  assert.equal(gif.frames.length, 2);
  assert.deepEqual(gif.delays, [100, 250]);
  assert.equal(gif.repeats, true);
  const [i1, i2] = gif.frames;
  assert.equal(i1[1], 0, 'transparent uses index 0');
  assert.equal(i2[3], 0, 'alpha below 50% becomes transparent');
  assert.deepEqual(gif.palette(i1[0]), [93, 28, 22]);
  assert.deepEqual(gif.palette(i1[2]), [246, 228, 166]);
  assert.equal(i1[0], i1[3]);
});

test('gif: more than 255 colors falls back to the color cube without breaking', () => {
  const px = Uint32Array.from({ length: 32 * 32 }, (_, i) => pack(i % 256, (i * 3) % 256, (i * 7) % 256));
  const gif = readGIF(encodeGIF([px], 32, 32));
  assert.equal(gif.frames[0].length, 1024);
  assert.equal(gif.repeats, false, 'a single frame does not need the loop block');
  assert.throws(() => encodeGIF([], 1, 1));
});
