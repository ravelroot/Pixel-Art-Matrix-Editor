import { hexToColor, colorToHex, colorToHex6, unpack } from './colors.js';

const list = (text) => text.trim().split(/\s+/).map((h) => '#' + h.toLowerCase());

export const PRESET_PALETTES = [
  {
    slug: 'crivo',
    name: 'Crivo',
    description: 'A paleta do projeto: vinho, ardósia, café, linho, oliva, rosé e palha.',
    colors: list('5d1c16 a3b4be 5c4034 e6ddce 7a6e46 d6bdb8 f6e4a6 000000 ffffff'),
  },
  {
    slug: 'game-boy',
    name: 'Game Boy',
    description: 'Os quatro verdes da tela do Game Boy original (DMG-01).',
    colors: list('0f380f 306230 8bac0f 9bbc0f'),
  },
  {
    slug: 'nes',
    name: 'NES',
    description: 'As cores únicas da paleta do NES (PPU 2C02), sem as repetições de preto.',
    colors: list(`
      7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000
      bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888
      f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878
      fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8`),
  },
  {
    slug: 'pico-8',
    name: 'Pico-8',
    description: 'As 16 cores do console de fantasia Pico-8.',
    colors: list('000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'),
  },
  {
    slug: 'cga',
    name: 'CGA',
    description: 'As 16 cores do adaptador gráfico CGA da IBM.',
    colors: list('000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff'),
  },
  {
    slug: 'cga-modo-4',
    name: 'CGA (modo 4, alta intensidade)',
    description: 'A paleta de quatro cores mais famosa dos jogos CGA: preto, ciano, magenta e branco.',
    colors: list('000000 55ffff ff55ff ffffff'),
  },
  {
    slug: 'commodore-64',
    name: 'Commodore 64',
    description: 'As 16 cores do VIC-II do Commodore 64.',
    colors: list('000000 ffffff 880000 aaffee cc44cc 00cc55 0000aa eeee77 dd8855 664400 ff7777 333333 777777 aaff66 0088ff bbbbbb'),
  },
  {
    slug: '1-bit',
    name: '1 bit',
    description: 'Preto e branco puros, para ícones e telas monocromáticas.',
    colors: list('000000 ffffff'),
  },
];

export function normalizePalette(p) {
  const colors = [];
  for (const c of p.colors || []) {
    const v = typeof c === 'number' ? c : hexToColor(c);
    if (v !== null && v !== undefined) colors.push(v >>> 0);
  }
  return { ...p, name: String(p.name || 'Paleta').slice(0, 80), colors };
}

export function importPalette(text, fileName = 'paleta.txt') {
  const extension = fileName.toLowerCase().split('.').pop();
  const base = fileName.replace(/\.[^.]+$/, '');
  let name = base;
  const colors = [];
  const add = (c) => {
    if (c !== null && !colors.includes(c)) colors.push(c);
  };
  const content = text.replace(/^﻿/, '');
  if (extension === 'json' || /^\s*[[{]/.test(content)) {
    const data = JSON.parse(content);
    // Crivo 1.x exported palettes as { nome, cores }; both spellings are accepted.
    const list = Array.isArray(data) ? data : data.colors || data.cores || data.palette || data.paleta || [];
    if (!Array.isArray(data) && (data.name || data.nome)) name = data.name || data.nome;
    for (const c of list) add(typeof c === 'string' ? hexToColor(c) : null);
  } else if (/^GIMP Palette/i.test(content.trim())) {
    for (const line of content.split(/\r?\n/)) {
      const nameMatch = line.match(/^Name:\s*(.+)$/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
        continue;
      }
      const m = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (m) add(hexToColor('#' + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('')));
    }
  } else {
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith(';') || t.startsWith('//')) continue;
      for (const chunk of t.split(/[\s,;]+/)) {
        if (/^(#|0x)?[0-9a-f]{8}$/i.test(chunk) && extension === 'txt' && !chunk.startsWith('#')) {
          const h = chunk.replace(/^0x/i, '');
          add(hexToColor(h.slice(2) + h.slice(0, 2)));
        } else if (/^(#|0x)?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(chunk)) {
          add(hexToColor(chunk));
        }
      }
    }
  }
  if (!colors.length) throw new Error('Nenhuma cor encontrada no arquivo.');
  return { name: String(name).slice(0, 80), colors };
}

export function exportPalette(palette, format = 'hex') {
  if (format === 'gpl') {
    const lines = ['GIMP Palette', `Name: ${palette.name}`, 'Columns: 8', '#'];
    for (const c of palette.colors) {
      const [r, g, b] = unpack(c);
      lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${colorToHex6(c).slice(1)}`);
    }
    return lines.join('\n') + '\n';
  }
  if (format === 'json') {
    return JSON.stringify({ name: palette.name, colors: palette.colors.map((c) => colorToHex(c)) }, null, 2) + '\n';
  }
  return palette.colors.map((c) => colorToHex(c).slice(1)).join('\n') + '\n';
}

export function extractPalette(pixels, limit = 256) {
  const counts = new Map();
  for (const c of pixels) if (c >>> 24) counts.set(c, (counts.get(c) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([c]) => c);
}
