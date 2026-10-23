import { colorToHex, unpack } from './colors.js';

export const DATA_FORMATS = {
  json: { name: 'JSON', extension: 'json' },
  csv: { name: 'CSV', extension: 'csv' },
  js: { name: 'JavaScript', extension: 'js' },
  py: { name: 'Python', extension: 'py' },
  c: { name: 'C', extension: 'h' },
  java: { name: 'Java', extension: 'java' },
};

export function identifier(name, style = 'camel') {
  const parts = String(name || 'sprite')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  if (!parts.length) parts.push('sprite');
  if (/^[0-9]/.test(parts[0])) parts.unshift('sprite');
  if (style === 'snake') return parts.join('_');
  if (style === 'constant') return parts.join('_').toUpperCase();
  const cap = parts.map((p) => p[0].toUpperCase() + p.slice(1));
  if (style === 'pascal') return cap.join('');
  return parts[0] + cap.slice(1).join('');
}

export function buildMatrices(frames, width, height, { mode = 'indices', palette = null } = {}) {
  const order = new Map();
  if (palette) for (const c of palette) if (c >>> 24 && !order.has(c)) order.set(c, order.size);
  if (mode === 'indices') {
    for (const px of frames) for (const c of px) if (c >>> 24 && !order.has(c)) order.set(c, order.size);
  }
  const matrices = frames.map((px) => {
    const rows = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const c = px[y * width + x];
        if (mode === 'indices') row.push(c >>> 24 ? order.get(c) : -1);
        else row.push(c >>> 24 ? colorToHex(c) : null);
      }
      rows.push(row);
    }
    return rows;
  });
  return { width, height, mode, palette: [...order.keys()].map((c) => colorToHex(c)), frames: matrices };
}

const valueText = (v, quotes = '"', nullText = 'null') => (v === null ? nullText : typeof v === 'string' ? quotes + v + quotes : String(v));

function rowsBlock(matrix, indent, openBracket, closeBracket, quotes, nullText, width = 0) {
  return matrix
    .map((row) => indent + openBracket + row.map((v) => valueText(v, quotes, nullText).padStart(width)).join(', ') + closeBracket)
    .join(',\n');
}

function valueWidth(data) {
  if (data.mode !== 'indices') return 0;
  let m = 1;
  for (const q of data.frames) for (const l of q) for (const v of l) m = Math.max(m, String(v).length);
  return m;
}

export function generateJSON(data, name) {
  const w = valueWidth(data);
  const frames = data.frames
    .map((q) => '    [\n' + rowsBlock(q, '      ', '[', ']', '"', 'null', w) + '\n    ]')
    .join(',\n');
  return (
    '{\n' +
    `  "name": ${JSON.stringify(name)},\n` +
    `  "width": ${data.width},\n` +
    `  "height": ${data.height},\n` +
    `  "mode": ${JSON.stringify(data.mode)},\n` +
    (data.mode === 'indices' ? '  "transparent": -1,\n' : '') +
    `  "palette": ${JSON.stringify(data.palette)},\n` +
    '  "frames": [\n' +
    frames +
    '\n  ]\n}\n'
  );
}

export function generateCSV(data) {
  return (
    data.frames
      .map((q) => q.map((row) => row.map((v) => (v === null ? '' : String(v))).join(',')).join('\n'))
      .join('\n\n') + '\n'
  );
}

export function generateJS(data, name) {
  const id = identifier(name);
  const w = valueWidth(data);
  const frames = data.frames.map((q) => '    [\n' + rowsBlock(q, '      ', '[', ']', "'", 'null', w) + ',\n    ]').join(',\n');
  return (
    `export const ${id} = {\n` +
    `  width: ${data.width},\n` +
    `  height: ${data.height},\n` +
    (data.mode === 'indices' ? '  transparent: -1,\n' : '') +
    `  palette: [${data.palette.map((c) => `'${c}'`).join(', ')}],\n` +
    '  frames: [\n' +
    frames +
    ',\n  ],\n};\n'
  );
}

export function generatePython(data, name) {
  const id = identifier(name, 'constant');
  const w = valueWidth(data);
  const frames = data.frames.map((q) => '        [\n' + rowsBlock(q, '            ', '[', ']', '"', 'None', w) + ',\n        ]').join(',\n');
  return (
    `${id} = {\n` +
    `    "width": ${data.width},\n` +
    `    "height": ${data.height},\n` +
    (data.mode === 'indices' ? '    "transparent": -1,\n' : '') +
    `    "palette": [${data.palette.map((c) => `"${c}"`).join(', ')}],\n` +
    '    "frames": [\n' +
    frames +
    ',\n    ],\n}\n'
  );
}

function hexToInt(hex, order) {
  const h = hex.replace('#', '');
  const rgb = h.slice(0, 6).toUpperCase();
  const a = (h.length === 8 ? h.slice(6, 8) : 'FF').toUpperCase();
  return order === 'argb' ? '0x' + a + rgb : '0x' + rgb + a;
}

export function generateC(data, name) {
  const id = identifier(name, 'snake');
  const ID = id.toUpperCase();
  const type = data.mode === 'indices' ? (data.palette.length > 32767 ? 'int32_t' : 'int16_t') : 'uint32_t';
  const convert = (v) => (data.mode === 'indices' ? v : v === null ? '0x00000000' : hexToInt(v, 'rgba'));
  const w = data.mode === 'indices' ? valueWidth(data) : 10;
  const frames = data.frames
    .map((q) => '    {\n' + q.map((l) => '        {' + l.map((v) => String(convert(v)).padStart(w)).join(', ') + '}').join(',\n') + '\n    }')
    .join(',\n');
  const palette = data.palette.length ? data.palette.map((c) => hexToInt(c, 'rgba')).join(', ') : '0x00000000';
  return (
    `#ifndef ${ID}_H\n#define ${ID}_H\n\n#include <stdint.h>\n\n` +
    `#define ${ID}_WIDTH ${data.width}\n#define ${ID}_HEIGHT ${data.height}\n#define ${ID}_FRAMES ${data.frames.length}\n` +
    `#define ${ID}_COLORS ${data.palette.length}\n\n` +
    `static const uint32_t ${id}_palette[${Math.max(1, data.palette.length)}] = {${palette}};\n\n` +
    `static const ${type} ${id}_pixels[${ID}_FRAMES][${ID}_HEIGHT][${ID}_WIDTH] = {\n` +
    frames +
    `\n};\n\n#endif\n`
  );
}

// A Java initializer goes over 64 KB of bytecode with a few thousand numbers, and the class does not compile.
// Above this limit, the matrix and the palette are packed as text and decoded when the class loads.
export const JAVA_LITERAL_LIMIT = 4096;
const JAVA_CHUNK = 20000;

function javaText(codes) {
  let s = '';
  for (const c of codes) {
    if (c === 34) s += '\\"';
    else if (c === 92) s += '\\\\';
    else if (c >= 32 && c < 127) s += String.fromCharCode(c);
    else if (c < 128) s += '\\' + c.toString(8).padStart(3, '0');
    else s += '\\u' + c.toString(16).toUpperCase().padStart(4, '0');
  }
  return s;
}

function javaChunks(codes, indent) {
  const parts = [];
  for (let i = 0; i < codes.length; i += JAVA_CHUNK) parts.push(`${indent}"${javaText(codes.slice(i, i + JAVA_CHUNK))}"`);
  return parts.join(',\n');
}

function argb(hex) {
  const h = hex.replace('#', '');
  return ((parseInt(h.length === 8 ? h.slice(6, 8) : 'ff', 16) << 24) | parseInt(h.slice(0, 6), 16)) >>> 0;
}

function generateCompactJava(data, className) {
  const indices = data.mode === 'indices';
  const total = data.frames.length * data.height * data.width;
  const oneChar = indices && data.palette.length + 33 <= 0xffff;
  const base = indices ? (oneChar ? 33 : 1) : 0;
  const codes = [];
  for (const q of data.frames) {
    for (const l of q) {
      for (const v of l) {
        if (oneChar) codes.push(v + 33);
        else {
          const u = indices ? v + 1 : v === null ? 0 : argb(v);
          codes.push(u >>> 16, u & 0xffff);
        }
      }
    }
  }
  const colors = [];
  for (const c of data.palette) {
    const u = argb(c);
    colors.push(u >>> 16, u & 0xffff);
  }
  return (
    `public final class ${className} {\n\n` +
    `    public static final int WIDTH = ${data.width};\n` +
    `    public static final int HEIGHT = ${data.height};\n` +
    (indices ? '    public static final int TRANSPARENT = -1;\n' : '') +
    `\n    public static final int[] PALETTE;\n` +
    `    public static final int[][][] FRAMES;\n\n` +
    `    // Matrix too large for a Java literal (64 KB limit per method): the values are packed\n` +
    `    // as text, ${oneChar ? 'one character per pixel (value + 33)' : 'two characters per value (high and low 16 bits)'}, and are read when the class loads.\n` +
    `    private static final String[] PALETTE_DATA = {\n${javaChunks(colors, '        ')}${colors.length ? ',' : ''}\n    };\n\n` +
    `    private static final String[] DATA = {\n${javaChunks(codes, '        ')},\n    };\n\n` +
    `    static {\n` +
    `        PALETTE = read(PALETTE_DATA, 2, 0, ${data.palette.length});\n` +
    `        int[] v = read(DATA, ${oneChar ? 1 : 2}, ${base}, ${total});\n` +
    `        FRAMES = new int[${data.frames.length}][HEIGHT][WIDTH];\n` +
    `        for (int f = 0, i = 0; f < ${data.frames.length}; f++)\n` +
    `            for (int y = 0; y < HEIGHT; y++)\n` +
    `                for (int x = 0; x < WIDTH; x++) FRAMES[f][y][x] = v[i++];\n` +
    `    }\n\n` +
    `    private static int[] read(String[] parts, int width, int base, int total) {\n` +
    `        StringBuilder text = new StringBuilder();\n` +
    `        for (String part : parts) text.append(part);\n` +
    `        int[] values = new int[total];\n` +
    `        for (int i = 0, k = 0; i < total; i++) {\n` +
    `            if (width == 1) values[i] = text.charAt(k++) - base;\n` +
    `            else values[i] = ((text.charAt(k++) << 16) | text.charAt(k++)) - base;\n` +
    `        }\n` +
    `        return values;\n` +
    `    }\n\n` +
    `    private ${className}() {\n    }\n}\n`
  );
}

export function generateJava(data, name) {
  const className = identifier(name, 'pascal');
  if (data.frames.length * data.height * data.width > JAVA_LITERAL_LIMIT || data.palette.length > 2048) return generateCompactJava(data, className);
  const convert = (v) => (data.mode === 'indices' ? v : v === null ? '0x00000000' : hexToInt(v, 'argb'));
  const w = data.mode === 'indices' ? valueWidth(data) : 10;
  const frames = data.frames
    .map((q) => '        {\n' + q.map((l) => '            {' + l.map((v) => String(convert(v)).padStart(w)).join(', ') + '}').join(',\n') + '\n        }')
    .join(',\n');
  return (
    `public final class ${className} {\n\n` +
    `    public static final int WIDTH = ${data.width};\n` +
    `    public static final int HEIGHT = ${data.height};\n` +
    (data.mode === 'indices' ? '    public static final int TRANSPARENT = -1;\n' : '') +
    `\n    public static final int[] PALETTE = {${data.palette.map((c) => hexToInt(c, 'argb')).join(', ')}};\n\n` +
    `    public static final int[][][] FRAMES = {\n` +
    frames +
    `\n    };\n\n    private ${className}() {\n    }\n}\n`
  );
}

export function generateData(format, data, name) {
  switch (format) {
    case 'json':
      return generateJSON(data, name);
    case 'csv':
      return generateCSV(data);
    case 'js':
      return generateJS(data, name);
    case 'py':
      return generatePython(data, name);
    case 'c':
      return generateC(data, name);
    case 'java':
      return generateJava(data, name);
    default:
      throw new Error('Formato desconhecido: ' + format);
  }
}

export function sheetLayout(count, width, height, { layout = 'horizontal', columns = 4, spacing = 0, margin = 0 } = {}) {
  let cols;
  if (layout === 'horizontal') cols = count;
  else if (layout === 'vertical') cols = 1;
  else cols = Math.max(1, Math.min(count, Math.round(columns) || 1));
  const rows = Math.ceil(count / cols);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const l = Math.floor(i / cols);
    positions.push({ x: margin + c * (width + spacing), y: margin + l * (height + spacing), width, height });
  }
  return {
    columns: cols,
    rows,
    width: margin * 2 + cols * width + (cols - 1) * spacing,
    height: margin * 2 + rows * height + (rows - 1) * spacing,
    positions,
  };
}

export function scaleNearest(pixels, width, height, factor) {
  factor = Math.max(1, Math.floor(factor));
  if (factor === 1) return pixels.slice();
  const L = width * factor;
  const output = new Uint32Array(L * height * factor);
  for (let y = 0; y < height; y++) {
    const row = new Uint32Array(L);
    for (let x = 0; x < width; x++) row.fill(pixels[y * width + x], x * factor, (x + 1) * factor);
    for (let k = 0; k < factor; k++) output.set(row, (y * factor + k) * L);
  }
  return output;
}

export function paste(dest, destWidth, origin, sourceWidth, sourceHeight, x0, y0) {
  for (let y = 0; y < sourceHeight; y++) {
    dest.set(origin.subarray(y * sourceWidth, (y + 1) * sourceWidth), (y0 + y) * destWidth + x0);
  }
}

export function flattenBackground(pixels, background) {
  const [fr, fg, fb] = unpack(background);
  const output = new Uint32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    const a = (c >>> 24) / 255;
    const r = Math.round((c & 255) * a + fr * (1 - a));
    const g = Math.round(((c >>> 8) & 255) * a + fg * (1 - a));
    const b = Math.round(((c >>> 16) & 255) * a + fb * (1 - a));
    output[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return output;
}

export function sheetMetadata(name, layout, frames, fps) {
  return {
    name,
    image: name + '.png',
    width: layout.width,
    height: layout.height,
    fps,
    frames: layout.positions.map((p, i) => ({
      index: i,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      duration: frames[i]?.duration ?? Math.round(1000 / fps),
    })),
  };
}
