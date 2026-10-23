// Builds Crivo.exe: the Crivo desktop app for Windows, which opens maximized,
// with no server and no backend. It embeds Crivo.html (the same editor as the single-file version).
//
//   npm run desktop              updates Crivo.html and builds Crivo.exe at the repository root
//   npm run desktop -- --check   builds again in a temporary folder and checks that the repository's
//                                Crivo.exe is identical, byte for byte (used in CI)
//
// Needs Node 20+ and Go (the exact version is in desktop/go.mod; Go downloads it by itself if missing).
// The build is reproducible: the same code always produces the same .exe, on any system.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './build-portable.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DESKTOP = join(ROOT, 'desktop');
const EXE = join(ROOT, 'Crivo.exe');
const GO_TOOLCHAIN = 'go1.24.7';
const GOVERSIONINFO = 'github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.5.0';
const lf = (text) => text.replace(/\r\n?/g, '\n');

// --- Icon ----------------------------------------------------------------------------------------
// The icon is the project logo (docs/images/logo.svg): the pixel-art pointer in the center of a white
// 25×25 grid, the same drawing as the top of the README. Each Windows size is drawn with whole pixels,
// without blurring, keeping the pointer near half the height of the square. Everything in uncompressed
// formats, so the result is identical on any machine.

const LOGO_GRID = 25;

async function pointerPixels() {
  const svg = await readFile(join(ROOT, 'docs/images/logo.svg'), 'utf8');
  if (!svg.includes(`viewBox="0 0 ${LOGO_GRID} ${LOGO_GRID}"`)) throw new Error('logo.svg changed: the grid is no longer 25×25.');
  const path = svg.match(/<path[^>]*\sd="([^"]+)"/);
  if (!path) throw new Error('logo.svg changed: the generator did not find the pointer drawing.');
  const pixels = [];
  for (const [, x, y, width] of path[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(width); i++) pixels.push([Number(x) + i, Number(y)]);
  }
  const width = Math.max(...pixels.map(([x]) => x)) + 1;
  const height = Math.max(...pixels.map(([, y]) => y)) + 1;
  return { pixels, width, height };
}

function draw(pointer, side) {
  const scale = Math.max(1, Math.round(side / LOGO_GRID));
  const x0 = Math.floor((side - pointer.width * scale) / 2);
  const y0 = Math.floor((side - pointer.height * scale) / 2);
  const rgba = Buffer.alloc(side * side * 4, 0xff); // opaque white background
  for (const [px, py] of pointer.pixels) {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y0 + py * scale + dy) * side + x0 + px * scale + dx) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return rgba;
}

function iconBmp(rgba, side) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(side, 4);
  header.writeInt32LE(side * 2, 8); // the height counts the AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const colors = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const from = (y * side + x) * 4;
      const to = ((side - 1 - y) * side + x) * 4; // BMP stores the rows bottom-up
      colors[to] = rgba[from + 2];
      colors[to + 1] = rgba[from + 1];
      colors[to + 2] = rgba[from];
      colors[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc((Math.ceil(side / 32) * 4) * side); // fully opaque
  return Buffer.concat([header, colors, mask]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngBlock(type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

// zlib with "stored" blocks (no compression), assembled by hand: the result does not depend on the zlib version.
function zlibStored(data) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let i = 0; i < data.length || i === 0; i += 0xffff) {
    const chunk = data.subarray(i, i + 0xffff);
    const header = Buffer.alloc(5);
    header[0] = i + 0xffff >= data.length ? 1 : 0;
    header.writeUInt16LE(chunk.length, 1);
    header.writeUInt16LE(~chunk.length & 0xffff, 3);
    parts.push(header, chunk);
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  parts.push(adler);
  return Buffer.concat(parts);
}

function iconPng(rgba, side) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  const lines = Buffer.alloc((side * 4 + 1) * side);
  for (let y = 0; y < side; y++) rgba.copy(lines, y * (side * 4 + 1) + 1, y * side * 4, (y + 1) * side * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngBlock('IHDR', ihdr),
    pngBlock('IDAT', zlibStored(lines)),
    pngBlock('IEND', Buffer.alloc(0)),
  ]);
}

async function generateIcon() {
  const pointer = await pointerPixels();
  const sides = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256];
  const images = sides.map((side) => {
    const rgba = draw(pointer, side);
    return side === 256 ? iconPng(rgba, side) : iconBmp(rgba, side);
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sides.length, 4);
  let offset = 6 + 16 * sides.length;
  const entries = sides.map((side, i) => {
    const e = Buffer.alloc(16);
    e[0] = side === 256 ? 0 : side;
    e[1] = side === 256 ? 0 : side;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

// --- Build ---------------------------------------------------------------------------------------

function go(args, extraEnv = {}) {
  return execFileSync('go', args, {
    cwd: DESKTOP,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, GOTOOLCHAIN: GO_TOOLCHAIN, GOFLAGS: '-mod=readonly', ...extraEnv },
  });
}

function versionInfo(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  const number = { Major: major, Minor: minor, Patch: patch, Build: 0 };
  const copyright = 'Copyright (©) 2026 Erik Pimenta';
  return {
    FixedFileInfo: { FileVersion: number, ProductVersion: number, FileFlagsMask: '3f', FileFlags: '00', FileOS: '040004', FileType: '01', FileSubType: '00' },
    StringFileInfo: {
      Comments: 'Editor de pixel art baseado em matrizes. Abre maximizado; F11 alterna a tela cheia.',
      CompanyName: 'Erik Pimenta',
      FileDescription: 'Crivo, editor de pixel art',
      FileVersion: version,
      InternalName: 'Crivo',
      LegalCopyright: copyright,
      OriginalFilename: 'Crivo.exe',
      ProductName: 'Crivo',
      ProductVersion: version,
    },
    VarFileInfo: { Translation: { LangID: '0416', CharsetID: '04B0' } },
    IconPath: 'crivo.ico',
    ManifestPath: 'crivo.manifest',
  };
}

async function build(dest, version) {
  await writeFile(join(DESKTOP, 'crivo.ico'), await generateIcon());
  await writeFile(join(DESKTOP, 'versioninfo.json'), JSON.stringify(versionInfo(version), null, 2) + '\n');
  go(['run', GOVERSIONINFO, '-64', '-o', 'resource_windows_amd64.syso', 'versioninfo.json']);
  go(
    ['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -buildid= -H=windowsgui -X main.version=${version}`, '-o', dest, '.'],
    { GOOS: 'windows', GOARCH: 'amd64', GOAMD64: 'v1', CGO_ENABLED: '0' },
  );
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

async function main() {
  const check = process.argv.includes('--check');
  const version = (await readFile(join(ROOT, 'VERSION'), 'utf8')).trim();
  const html = await generate();
  const currentHtml = lf(await readFile(join(ROOT, 'Crivo.html'), 'utf8').catch(() => ''));
  if (currentHtml !== html) {
    if (check) throw new Error('Crivo.html is out of date. Run "npm run desktop" and commit it.');
    await writeFile(join(ROOT, 'Crivo.html'), html, 'utf8');
  }
  await writeFile(join(DESKTOP, 'Crivo.html'), html, 'utf8');

  if (!check) {
    await build(EXE, version);
    const exe = await readFile(EXE);
    console.log(`Crivo.exe ${version} built (${(exe.length / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256(exe).slice(0, 16)}…).`);
    return;
  }
  const folder = await mkdtemp(join(tmpdir(), 'crivo-'));
  try {
    const newProject = join(folder, 'Crivo.exe');
    await build(newProject, version);
    const [a, b] = await Promise.all([readFile(EXE).catch(() => Buffer.alloc(0)), readFile(newProject)]);
    if (sha256(a) !== sha256(b)) {
      throw new Error('Crivo.exe is out of date with the code. Run "npm run desktop" and commit it.');
    }
    console.log(`Crivo.exe is up to date with the code (sha256 ${sha256(b).slice(0, 16)}…).`);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
