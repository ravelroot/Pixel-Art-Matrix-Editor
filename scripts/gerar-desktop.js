// Gera o Crivo.exe: o app desktop do Crivo para Windows, que abre maximizado,
// sem servidor e sem backend. Ele embute o Crivo.html (o mesmo editor do arquivo único).
//
//   npm run desktop                  atualiza o Crivo.html e gera o Crivo.exe na raiz do repositório
//   npm run desktop -- --verificar   gera de novo numa pasta temporária e confere se o Crivo.exe
//                                    do repositório é idêntico, byte a byte (usado no CI)
//
// Precisa do Node 20+ e do Go (a versão exata fica no desktop/go.mod; o Go baixa sozinho se faltar).
// O build é reproduzível: o mesmo código gera sempre o mesmo .exe, em qualquer sistema.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerar } from './gerar-portatil.js';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DESKTOP = join(RAIZ, 'desktop');
const EXE = join(RAIZ, 'Crivo.exe');
const GO_TOOLCHAIN = 'go1.24.7';
const GOVERSIONINFO = 'github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.5.0';
const lf = (texto) => texto.replace(/\r\n?/g, '\n');

// --- Ícone ---------------------------------------------------------------------------------------
// O ícone é o logo do projeto (docs/images/logo.svg): o ponteiro em pixel art no centro de uma grade
// branca de 25×25, o mesmo desenho do topo do README. Cada tamanho do Windows é desenhado com pixels
// inteiros, sem borrar, mantendo o ponteiro perto de metade da altura do quadrado. Tudo em formato sem
// compressão, para o resultado ser idêntico em qualquer máquina.

const GRADE_DO_LOGO = 25;

async function pixelsDoPonteiro() {
  const svg = await readFile(join(RAIZ, 'docs/images/logo.svg'), 'utf8');
  if (!svg.includes(`viewBox="0 0 ${GRADE_DO_LOGO} ${GRADE_DO_LOGO}"`)) throw new Error('logo.svg mudou: a grade não é mais 25×25.');
  const caminho = svg.match(/<path[^>]*\sd="([^"]+)"/);
  if (!caminho) throw new Error('logo.svg mudou: o gerador não encontrou o desenho do ponteiro.');
  const pixels = [];
  for (const [, x, y, largura] of caminho[1].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(largura); i++) pixels.push([Number(x) + i, Number(y)]);
  }
  const largura = Math.max(...pixels.map(([x]) => x)) + 1;
  const altura = Math.max(...pixels.map(([, y]) => y)) + 1;
  return { pixels, largura, altura };
}

function desenhar(ponteiro, lado) {
  const escala = Math.max(1, Math.round(lado / GRADE_DO_LOGO));
  const x0 = Math.floor((lado - ponteiro.largura * escala) / 2);
  const y0 = Math.floor((lado - ponteiro.altura * escala) / 2);
  const rgba = Buffer.alloc(lado * lado * 4, 0xff); // fundo branco opaco
  for (const [px, py] of ponteiro.pixels) {
    for (let dy = 0; dy < escala; dy++) {
      for (let dx = 0; dx < escala; dx++) {
        const i = ((y0 + py * escala + dy) * lado + x0 + px * escala + dx) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
  }
  return rgba;
}

function bmpDoIcone(rgba, lado) {
  const cabecalho = Buffer.alloc(40);
  cabecalho.writeUInt32LE(40, 0);
  cabecalho.writeInt32LE(lado, 4);
  cabecalho.writeInt32LE(lado * 2, 8); // a altura conta a máscara AND
  cabecalho.writeUInt16LE(1, 12);
  cabecalho.writeUInt16LE(32, 14);
  const cores = Buffer.alloc(lado * lado * 4);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const de = (y * lado + x) * 4;
      const para = ((lado - 1 - y) * lado + x) * 4; // BMP guarda as linhas de baixo para cima
      cores[para] = rgba[de + 2];
      cores[para + 1] = rgba[de + 1];
      cores[para + 2] = rgba[de];
      cores[para + 3] = rgba[de + 3];
    }
  }
  const mascara = Buffer.alloc((Math.ceil(lado / 32) * 4) * lado); // tudo opaco
  return Buffer.concat([cabecalho, cores, mascara]);
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados) {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function blocoPng(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

// zlib com blocos "stored" (sem compressão), montado à mão: o resultado não depende da versão do zlib.
function zlibSemCompressao(dados) {
  const partes = [Buffer.from([0x78, 0x01])];
  for (let i = 0; i < dados.length || i === 0; i += 0xffff) {
    const pedaco = dados.subarray(i, i + 0xffff);
    const cabecalho = Buffer.alloc(5);
    cabecalho[0] = i + 0xffff >= dados.length ? 1 : 0;
    cabecalho.writeUInt16LE(pedaco.length, 1);
    cabecalho.writeUInt16LE(~pedaco.length & 0xffff, 3);
    partes.push(cabecalho, pedaco);
  }
  let a = 1;
  let b = 0;
  for (const byte of dados) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  partes.push(adler);
  return Buffer.concat(partes);
}

function pngDoIcone(rgba, lado) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const linhas = Buffer.alloc((lado * 4 + 1) * lado);
  for (let y = 0; y < lado; y++) rgba.copy(linhas, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocoPng('IHDR', ihdr),
    blocoPng('IDAT', zlibSemCompressao(linhas)),
    blocoPng('IEND', Buffer.alloc(0)),
  ]);
}

async function gerarIcone() {
  const ponteiro = await pixelsDoPonteiro();
  const lados = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256];
  const imagens = lados.map((lado) => {
    const rgba = desenhar(ponteiro, lado);
    return lado === 256 ? pngDoIcone(rgba, lado) : bmpDoIcone(rgba, lado);
  });
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(lados.length, 4);
  let deslocamento = 6 + 16 * lados.length;
  const entradas = lados.map((lado, i) => {
    const e = Buffer.alloc(16);
    e[0] = lado === 256 ? 0 : lado;
    e[1] = lado === 256 ? 0 : lado;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imagens[i].length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += imagens[i].length;
    return e;
  });
  return Buffer.concat([cabecalho, ...entradas, ...imagens]);
}

// --- Build ---------------------------------------------------------------------------------------

function go(argumentos, ambiente = {}) {
  return execFileSync('go', argumentos, {
    cwd: DESKTOP,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, GOTOOLCHAIN: GO_TOOLCHAIN, GOFLAGS: '-mod=readonly', ...ambiente },
  });
}

function infoDaVersao(versao) {
  const [maior, menor, correcao] = versao.split('.').map(Number);
  const numero = { Major: maior, Minor: menor, Patch: correcao, Build: 0 };
  const copyright = 'Copyright (©) 2026 Erik Pimenta';
  return {
    FixedFileInfo: { FileVersion: numero, ProductVersion: numero, FileFlagsMask: '3f', FileFlags: '00', FileOS: '040004', FileType: '01', FileSubType: '00' },
    StringFileInfo: {
      Comments: 'Editor de pixel art baseado em matrizes. Abre maximizado; F11 alterna a tela cheia.',
      CompanyName: 'Erik Pimenta',
      FileDescription: 'Crivo, editor de pixel art',
      FileVersion: versao,
      InternalName: 'Crivo',
      LegalCopyright: copyright,
      OriginalFilename: 'Crivo.exe',
      ProductName: 'Crivo',
      ProductVersion: versao,
    },
    VarFileInfo: { Translation: { LangID: '0416', CharsetID: '04B0' } },
    IconPath: 'crivo.ico',
    ManifestPath: 'crivo.manifest',
  };
}

async function construir(destino, versao) {
  await writeFile(join(DESKTOP, 'crivo.ico'), await gerarIcone());
  await writeFile(join(DESKTOP, 'versioninfo.json'), JSON.stringify(infoDaVersao(versao), null, 2) + '\n');
  go(['run', GOVERSIONINFO, '-64', '-o', 'resource_windows_amd64.syso', 'versioninfo.json']);
  go(
    ['build', '-trimpath', '-buildvcs=false', '-ldflags', `-s -w -buildid= -H=windowsgui -X main.versao=${versao}`, '-o', destino, '.'],
    { GOOS: 'windows', GOARCH: 'amd64', GOAMD64: 'v1', CGO_ENABLED: '0' },
  );
}

const sha256 = (dados) => createHash('sha256').update(dados).digest('hex');

async function principal() {
  const verificar = process.argv.includes('--verificar');
  const versao = (await readFile(join(RAIZ, 'VERSION'), 'utf8')).trim();
  const html = await gerar();
  const htmlAtual = lf(await readFile(join(RAIZ, 'Crivo.html'), 'utf8').catch(() => ''));
  if (htmlAtual !== html) {
    if (verificar) throw new Error('O Crivo.html está desatualizado. Rode "npm run desktop" e faça o commit.');
    await writeFile(join(RAIZ, 'Crivo.html'), html, 'utf8');
  }
  await writeFile(join(DESKTOP, 'Crivo.html'), html, 'utf8');

  if (!verificar) {
    await construir(EXE, versao);
    const exe = await readFile(EXE);
    console.log(`Crivo.exe ${versao} gerado (${(exe.length / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256(exe).slice(0, 16)}…).`);
    return;
  }
  const pasta = await mkdtemp(join(tmpdir(), 'crivo-'));
  try {
    const novo = join(pasta, 'Crivo.exe');
    await construir(novo, versao);
    const [a, b] = await Promise.all([readFile(EXE).catch(() => Buffer.alloc(0)), readFile(novo)]);
    if (sha256(a) !== sha256(b)) {
      throw new Error('O Crivo.exe está desatualizado em relação ao código. Rode "npm run desktop" e faça o commit.');
    }
    console.log(`Crivo.exe em dia com o código (sha256 ${sha256(b).slice(0, 16)}…).`);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

principal().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
