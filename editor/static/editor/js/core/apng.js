// PNG and animated PNG (APNG) encoder with no dependencies. Pixels are packed RGBA (R in the low byte),
// written as 8-bit truecolor + alpha. Async because the zlib step uses CompressionStream (see zlib.js).
import { crc32, deflate, ByteWriter } from './zlib.js';

export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type, data = new Uint8Array(0)) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function ihdr(width, height) {
  const w = new ByteWriter(13);
  w.u32be(width);
  w.u32be(height);
  w.u8(8); // bit depth
  w.u8(6); // color type: truecolor + alpha
  w.u8(0);
  w.u8(0);
  w.u8(0);
  return w.result();
}

// Scanlines with filter type 0 (none): pixel art compresses well enough without filters.
function scanlines(pixels, width, height) {
  const row = width * 4;
  const out = new Uint8Array((row + 1) * height);
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, width * height * 4);
  for (let y = 0; y < height; y++) out.set(bytes.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  return out;
}

function join(parts) {
  const total = parts.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function encodePNG(pixels, width, height, options = {}) {
  const data = await deflate(scanlines(pixels, width, height), options);
  return join([PNG_SIGNATURE, pngChunk('IHDR', ihdr(width, height)), pngChunk('IDAT', data), pngChunk('IEND')]);
}

// frames: Uint32Array list of the same size; delays in milliseconds; loop: 0 = forever.
export async function encodeAPNG(frames, width, height, { delays = [], loop = 0, compress = true } = {}) {
  if (!frames.length) throw new Error('Nenhum quadro para exportar.');
  const parts = [PNG_SIGNATURE, pngChunk('IHDR', ihdr(width, height))];
  const actl = new ByteWriter(8);
  actl.u32be(frames.length);
  actl.u32be(loop);
  parts.push(pngChunk('acTL', actl.result()));
  let sequence = 0;
  for (let i = 0; i < frames.length; i++) {
    const delay = Math.max(1, Math.min(65535, Math.round(delays[i] ?? 100)));
    const fctl = new ByteWriter(26);
    fctl.u32be(sequence++);
    fctl.u32be(width);
    fctl.u32be(height);
    fctl.u32be(0); // x offset
    fctl.u32be(0); // y offset
    fctl.u16be(delay); // delay numerator
    fctl.u16be(1000); // delay denominator: milliseconds
    fctl.u8(0); // dispose: none
    fctl.u8(0); // blend: source (the frame replaces the whole canvas)
    parts.push(pngChunk('fcTL', fctl.result()));
    const data = await deflate(scanlines(frames[i], width, height), { compress });
    if (i === 0) parts.push(pngChunk('IDAT', data));
    else {
      const fdat = new Uint8Array(4 + data.length);
      new DataView(fdat.buffer).setUint32(0, sequence++);
      fdat.set(data, 4);
      parts.push(pngChunk('fdAT', fdat));
    }
  }
  parts.push(pngChunk('IEND'));
  return join(parts);
}

// Lists the chunks of a PNG file: [{ type, data, crc, valid }]. Used by the tests and by the importers.
export function readPNGChunks(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Não é um arquivo PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let p = 8;
  while (p + 12 <= bytes.length) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + length);
    const crc = view.getUint32(p + 8 + length);
    chunks.push({ type, data, crc, valid: crc === crc32(bytes.subarray(p + 4, p + 8 + length)) });
    p += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}
