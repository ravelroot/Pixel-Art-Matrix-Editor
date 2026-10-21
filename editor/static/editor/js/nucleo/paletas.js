import { hexParaCor, corParaHex, corParaHex6, desempacotar } from './cores.js';

const lista = (texto) => texto.trim().split(/\s+/).map((h) => '#' + h.toLowerCase());

export const PALETAS_PREDEFINIDAS = [
  {
    slug: 'crivo',
    nome: 'Crivo',
    descricao: 'A paleta do projeto: vinho, ardósia, café, linho, oliva, rosé e palha.',
    cores: lista('5d1c16 a3b4be 5c4034 e6ddce 7a6e46 d6bdb8 f6e4a6 000000 ffffff'),
  },
  {
    slug: 'game-boy',
    nome: 'Game Boy',
    descricao: 'Os quatro verdes da tela do Game Boy original (DMG-01).',
    cores: lista('0f380f 306230 8bac0f 9bbc0f'),
  },
  {
    slug: 'nes',
    nome: 'NES',
    descricao: 'As cores únicas da paleta do NES (PPU 2C02), sem as repetições de preto.',
    cores: lista(`
      7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000
      bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888
      f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878
      fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8`),
  },
  {
    slug: 'pico-8',
    nome: 'Pico-8',
    descricao: 'As 16 cores do console de fantasia Pico-8.',
    cores: lista('000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'),
  },
  {
    slug: 'cga',
    nome: 'CGA',
    descricao: 'As 16 cores do adaptador gráfico CGA da IBM.',
    cores: lista('000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff'),
  },
  {
    slug: 'cga-modo-4',
    nome: 'CGA (modo 4, alta intensidade)',
    descricao: 'A paleta de quatro cores mais famosa dos jogos CGA: preto, ciano, magenta e branco.',
    cores: lista('000000 55ffff ff55ff ffffff'),
  },
  {
    slug: 'commodore-64',
    nome: 'Commodore 64',
    descricao: 'As 16 cores do VIC-II do Commodore 64.',
    cores: lista('000000 ffffff 880000 aaffee cc44cc 00cc55 0000aa eeee77 dd8855 664400 ff7777 333333 777777 aaff66 0088ff bbbbbb'),
  },
  {
    slug: '1-bit',
    nome: '1 bit',
    descricao: 'Preto e branco puros, para ícones e telas monocromáticas.',
    cores: lista('000000 ffffff'),
  },
];

export function normalizarPaleta(p) {
  const cores = [];
  for (const c of p.cores || []) {
    const v = typeof c === 'number' ? c : hexParaCor(c);
    if (v !== null && v !== undefined) cores.push(v >>> 0);
  }
  return { ...p, nome: String(p.nome || 'Paleta').slice(0, 80), cores };
}

export function importarPaleta(texto, nomeArquivo = 'paleta.txt') {
  const extensao = nomeArquivo.toLowerCase().split('.').pop();
  const base = nomeArquivo.replace(/\.[^.]+$/, '');
  let nome = base;
  const cores = [];
  const adicionar = (c) => {
    if (c !== null && !cores.includes(c)) cores.push(c);
  };
  const conteudo = texto.replace(/^﻿/, '');
  if (extensao === 'json' || /^\s*[[{]/.test(conteudo)) {
    const dados = JSON.parse(conteudo);
    const lista = Array.isArray(dados) ? dados : dados.cores || dados.colors || dados.paleta || [];
    if (!Array.isArray(dados) && (dados.nome || dados.name)) nome = dados.nome || dados.name;
    for (const c of lista) adicionar(typeof c === 'string' ? hexParaCor(c) : null);
  } else if (/^GIMP Palette/i.test(conteudo.trim())) {
    for (const linha of conteudo.split(/\r?\n/)) {
      const nomeMatch = linha.match(/^Name:\s*(.+)$/i);
      if (nomeMatch) {
        nome = nomeMatch[1].trim();
        continue;
      }
      const m = linha.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (m) adicionar(hexParaCor('#' + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('')));
    }
  } else {
    for (const linha of conteudo.split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith(';') || t.startsWith('//')) continue;
      for (const pedaco of t.split(/[\s,;]+/)) {
        if (/^(#|0x)?[0-9a-f]{8}$/i.test(pedaco) && extensao === 'txt' && !pedaco.startsWith('#')) {
          const h = pedaco.replace(/^0x/i, '');
          adicionar(hexParaCor(h.slice(2) + h.slice(0, 2)));
        } else if (/^(#|0x)?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(pedaco)) {
          adicionar(hexParaCor(pedaco));
        }
      }
    }
  }
  if (!cores.length) throw new Error('Nenhuma cor encontrada no arquivo.');
  return { nome: String(nome).slice(0, 80), cores };
}

export function exportarPaleta(paleta, formato = 'hex') {
  if (formato === 'gpl') {
    const linhas = ['GIMP Palette', `Name: ${paleta.nome}`, 'Columns: 8', '#'];
    for (const c of paleta.cores) {
      const [r, g, b] = desempacotar(c);
      linhas.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${corParaHex6(c).slice(1)}`);
    }
    return linhas.join('\n') + '\n';
  }
  if (formato === 'json') {
    return JSON.stringify({ nome: paleta.nome, cores: paleta.cores.map((c) => corParaHex(c)) }, null, 2) + '\n';
  }
  return paleta.cores.map((c) => corParaHex(c).slice(1)).join('\n') + '\n';
}

export function extrairPaleta(pixels, limite = 256) {
  const contagem = new Map();
  for (const c of pixels) if (c >>> 24) contagem.set(c, (contagem.get(c) || 0) + 1);
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([c]) => c);
}
