// Animated GIF encoder (GIF89a) with no dependencies: global palette, transparency and LZW compression.
// Pixel art usually has few colors, so the palette is exact; above 255 colors it falls back to a 6×7×6 cube.

const ALPHA_THRESHOLD = 128;

function globalPalette(frames) {
  const colors = new Map();
  for (const px of frames) {
    for (let i = 0; i < px.length; i++) {
      const c = px[i];
      if ((c >>> 24) < ALPHA_THRESHOLD) continue;
      const rgb = c & 0x00ffffff;
      if (!colors.has(rgb)) {
        colors.set(rgb, colors.size + 1);
        if (colors.size > 255) return null;
      }
    }
  }
  return colors;
}

function cube() {
  const colors = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) colors.push(Math.round((r * 255) / 5) | (Math.round((g * 255) / 6) << 8) | (Math.round((b * 255) / 5) << 16));
  return colors;
}

function cubeIndex(c) {
  const r = Math.round(((c & 255) * 5) / 255);
  const g = Math.round((((c >>> 8) & 255) * 6) / 255);
  const b = Math.round((((c >>> 16) & 255) * 5) / 255);
  return 1 + r * 42 + g * 6 + b;
}

export function lzw(indices, minSize) {
  const clear = 1 << minSize;
  const end = clear + 1;
  let size = minSize + 1;
  let next = end + 1;
  const dictionary = new Map();
  const output = [];
  let accumulated = 0;
  let bits = 0;
  const write = (code) => {
    accumulated |= code << bits;
    bits += size;
    while (bits >= 8) {
      output.push(accumulated & 255);
      accumulated >>>= 8;
      bits -= 8;
    }
  };
  write(clear);
  if (!indices.length) {
    write(end);
    if (bits > 0) output.push(accumulated & 255);
    return Uint8Array.from(output);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const existing = dictionary.get(key);
    if (existing !== undefined) {
      prefix = existing;
      continue;
    }
    write(prefix);
    if (next === 4096) {
      write(clear);
      dictionary.clear();
      size = minSize + 1;
      next = end + 1;
    } else {
      if (next >= 1 << size) size++;
      dictionary.set(key, next++);
    }
    prefix = k;
  }
  write(prefix);
  write(end);
  if (bits > 0) output.push(accumulated & 255);
  return Uint8Array.from(output);
}

// frames: list of Uint32Array (packed RGBA, R in the low byte) of the same size.
// delays: duration of each frame in milliseconds. loop: 0 = forever.
export function encodeGIF(frames, width, height, { delays = [], loop = 0 } = {}) {
  if (!frames.length) throw new Error('Nenhum quadro para exportar.');
  const exact = globalPalette(frames);
  const colors = exact ? [...exact.keys()] : cube();
  const total = colors.length + 1;
  let paletteBits = 1;
  while (1 << paletteBits < total) paletteBits++;
  const paletteSize = 1 << paletteBits;
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  const text = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  text('GIF89a');
  u16(width);
  u16(height);
  bytes.push(0x80 | ((paletteBits - 1) << 4) | (paletteBits - 1), 0, 0);
  bytes.push(0, 0, 0);
  for (const c of colors) bytes.push(c & 255, (c >>> 8) & 255, (c >>> 16) & 255);
  for (let i = total; i < paletteSize; i++) bytes.push(0, 0, 0);
  if (frames.length > 1) {
    bytes.push(0x21, 0xff, 0x0b);
    text('NETSCAPE2.0');
    bytes.push(0x03, 0x01);
    u16(loop);
    bytes.push(0x00);
  }
  const minSize = Math.max(2, paletteBits);
  frames.forEach((px, q) => {
    const hundredths = Math.max(2, Math.round((delays[q] ?? 100) / 10));
    bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1);
    u16(hundredths);
    bytes.push(0, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0);
    const indices = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i++) {
      const c = px[i];
      if ((c >>> 24) < ALPHA_THRESHOLD) continue;
      indices[i] = exact ? exact.get(c & 0x00ffffff) : cubeIndex(c);
    }
    bytes.push(minSize);
    const data = lzw(indices, minSize);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
