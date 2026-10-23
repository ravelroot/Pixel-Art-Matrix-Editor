const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REVERSE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET.charCodeAt(i)] = i;

function varintSize(n) {
  let t = 1;
  while (n >= 128) {
    n = Math.floor(n / 128);
    t++;
  }
  return t;
}

export function encodeRLE(pixels) {
  const n = pixels.length;
  let bytes = 0;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && pixels[j] === pixels[i]) j++;
    bytes += varintSize(j - i) + 4;
    i = j;
  }
  const output = new Uint8Array(bytes);
  let p = 0;
  i = 0;
  while (i < n) {
    const color = pixels[i];
    let j = i + 1;
    while (j < n && pixels[j] === color) j++;
    let run = j - i;
    while (run >= 128) {
      output[p++] = (run & 127) | 128;
      run = Math.floor(run / 128);
    }
    output[p++] = run;
    output[p++] = color & 255;
    output[p++] = (color >>> 8) & 255;
    output[p++] = (color >>> 16) & 255;
    output[p++] = (color >>> 24) & 255;
    i = j;
  }
  return output;
}

export function decodeRLE(bytes, total) {
  const pixels = new Uint32Array(total);
  let p = 0;
  let i = 0;
  while (p < bytes.length) {
    let run = 0;
    let scale = 1;
    for (;;) {
      if (p >= bytes.length) throw new Error('RLE truncado');
      const b = bytes[p++];
      run += (b & 127) * scale;
      if (b < 128) break;
      scale *= 128;
    }
    if (p + 4 > bytes.length) throw new Error('RLE truncado');
    const color = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
    p += 4;
    if (i + run > total) throw new Error('RLE maior que a matriz');
    pixels.fill(color, i, i + run);
    i += run;
  }
  if (i !== total) throw new Error('RLE menor que a matriz');
  return pixels;
}

export function toBase64(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }
  return s;
}

export function fromBase64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  let accumulated = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = REVERSE[clean.charCodeAt(i)];
    if (v < 0) throw new Error('Base64 inválido');
    accumulated = ((accumulated << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[p++] = (accumulated >> bits) & 255;
    }
  }
  return output.subarray(0, p);
}
