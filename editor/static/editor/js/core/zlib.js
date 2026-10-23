// Small binary helpers shared by the PNG/APNG, ZIP and .aseprite encoders: CRC-32 and zlib streams.
// zlib uses the browser's CompressionStream / DecompressionStream ('deflate' = RFC 1950, with header
// and Adler-32), also present in WebView2 and Node 18+, so these functions are async. Without
// CompressionStream, deflate() writes "stored" (uncompressed) deflate blocks, which every reader accepts.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 5552) {
    const end = Math.min(bytes.length, i + 5552);
    for (let j = i; j < end; j++) {
      a += bytes[j];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export const hasCompression = () => typeof CompressionStream === 'function';

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// zlib stream with stored blocks (no compression): valid input for any inflater.
export function deflateStored(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const size = Math.min(65535, bytes.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = size & 255;
    out[o++] = size >>> 8;
    out[o++] = ~size & 255;
    out[o++] = (~size >>> 8) & 255;
    out.set(bytes.subarray(start, start + size), o);
    o += size;
  }
  const a = adler32(bytes);
  out[o++] = a >>> 24;
  out[o++] = (a >>> 16) & 255;
  out[o++] = (a >>> 8) & 255;
  out[o++] = a & 255;
  return out;
}

export async function deflate(bytes, { compress = true } = {}) {
  if (!compress || !hasCompression()) return deflateStored(bytes);
  return pipe(bytes, new CompressionStream('deflate'));
}

export async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('Este navegador não consegue descompactar o arquivo (falta DecompressionStream).');
  try {
    return await pipe(bytes, new DecompressionStream('deflate'));
  } catch {
    throw new Error('Dados compactados corrompidos.');
  }
}

// Little helpers to write binary files piece by piece.
export class ByteWriter {
  constructor(size = 1024) {
    this.buffer = new Uint8Array(size);
    this.length = 0;
  }

  reserve(n) {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buffer.subarray(0, this.length));
    this.buffer = b;
  }

  u8(v) {
    this.reserve(1);
    this.buffer[this.length++] = v & 255;
  }

  u16(v) {
    this.reserve(2);
    this.buffer[this.length++] = v & 255;
    this.buffer[this.length++] = (v >>> 8) & 255;
  }

  u32(v) {
    this.reserve(4);
    for (let k = 0; k < 4; k++) this.buffer[this.length++] = (v >>> (8 * k)) & 255;
  }

  u32be(v) {
    this.reserve(4);
    for (let k = 3; k >= 0; k--) this.buffer[this.length++] = (v >>> (8 * k)) & 255;
  }

  u16be(v) {
    this.reserve(2);
    this.buffer[this.length++] = (v >>> 8) & 255;
    this.buffer[this.length++] = v & 255;
  }

  bytes(b) {
    this.reserve(b.length);
    this.buffer.set(b, this.length);
    this.length += b.length;
  }

  zeros(n) {
    this.reserve(n);
    this.buffer.fill(0, this.length, this.length + n);
    this.length += n;
  }

  // Patches a little-endian value written earlier (sizes known only at the end).
  setU32(at, v) {
    for (let k = 0; k < 4; k++) this.buffer[at + k] = (v >>> (8 * k)) & 255;
  }

  result() {
    return this.buffer.slice(0, this.length);
  }
}
