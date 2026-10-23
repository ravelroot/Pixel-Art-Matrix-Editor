// Filtros de cor e de forma aplicados a uma matriz de pixels. Todos devolvem pares [índice, novaCor]
// só para os pixels que mudam, para que a interface registre tudo num único passo do histórico.
import { desempacotar, empacotar, rgbParaOklab, oklabParaRgb, rgbParaOklch, oklchParaRgb, hexParaCor, limitar } from './cores.js';

const VIZINHOS_4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const VIZINHOS_8 = [...VIZINHOS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

const permitido = (filtro, i) => !filtro || filtro(i);

// Contorno externo de 1 px: pixels transparentes que encostam (4 ou 8 vizinhos) num pixel opaco.
export function contorno(pixels, largura, altura, cor, { vizinhos = 4, filtro = null } = {}) {
  const lista = vizinhos === 8 ? VIZINHOS_8 : VIZINHOS_4;
  const mudancas = [];
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = y * largura + x;
      if (pixels[i] >>> 24 || !permitido(filtro, i)) continue;
      for (const [dx, dy] of lista) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= largura || ny >= altura) continue;
        if (pixels[ny * largura + nx] >>> 24) {
          mudancas.push([i, cor >>> 0]);
          break;
        }
      }
    }
  }
  return mudancas;
}

function aplicarPorPixel(pixels, filtro, fn) {
  const mudancas = [];
  const cache = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    if (!(c >>> 24) || !permitido(filtro, i)) continue;
    let nova = cache.get(c);
    if (nova === undefined) {
      nova = fn(c) >>> 0;
      cache.set(c, nova);
    }
    if (nova !== c) mudancas.push([i, nova]);
  }
  return mudancas;
}

export function inverter(pixels, { filtro = null } = {}) {
  return aplicarPorPixel(pixels, filtro, (c) => {
    const [r, g, b, a] = desempacotar(c);
    return empacotar(255 - r, 255 - g, 255 - b, a);
  });
}

export function tonsDeCinza(pixels, { filtro = null } = {}) {
  return aplicarPorPixel(pixels, filtro, (c) => {
    const [r, g, b, a] = desempacotar(c);
    const [L] = rgbParaOklab(r, g, b);
    const [v] = oklabParaRgb(L, 0, 0);
    return empacotar(v, v, v, a);
  });
}

function prepararPaleta(paleta) {
  return paleta
    .map((p) => (typeof p === 'string' ? hexParaCor(p) : p))
    .filter((c) => c !== null && c >>> 24)
    .map((c) => {
      const [r, g, b] = desempacotar(c);
      return { cor: c >>> 0, lab: rgbParaOklab(r, g, b) };
    });
}

export function maisProxima(cor, paletaPreparada) {
  const [r, g, b] = desempacotar(cor);
  const [L, A, B] = rgbParaOklab(r, g, b);
  let melhor = null;
  let menor = Infinity;
  for (const p of paletaPreparada) {
    const d = (L - p.lab[0]) ** 2 + (A - p.lab[1]) ** 2 + (B - p.lab[2]) ** 2;
    if (d < menor) {
      menor = d;
      melhor = p;
    }
  }
  return melhor;
}

// Troca cada pixel opaco pela cor mais próxima da paleta (distância euclidiana no OKLab). Mantém o alfa.
export function converterParaPaleta(pixels, paleta, { filtro = null } = {}) {
  const preparada = prepararPaleta(paleta);
  if (!preparada.length) return [];
  return aplicarPorPixel(pixels, filtro, (c) => {
    const alvo = maisProxima(c, preparada).cor;
    return ((alvo & 0x00ffffff) | (c & 0xff000000)) >>> 0;
  });
}

// Clareia (passo > 0) ou escurece (passo < 0) uma cor somando o passo ao L do OKLCH.
export function passoDeLuz(cor, passo) {
  const [r, g, b, a] = desempacotar(cor);
  if (!a) return cor >>> 0;
  const [L, C, H] = rgbParaOklch(r, g, b);
  return empacotar(...oklchParaRgb(limitar(L + passo, 0, 1), C, H), a);
}

// Rampa: paleta ordenada da cor mais escura para a mais clara (L do OKLab).
export function rampaDaPaleta(paleta) {
  const preparada = prepararPaleta(paleta);
  const unicas = new Map();
  for (const p of preparada) unicas.set(p.cor & 0x00ffffff, p);
  return [...unicas.values()].sort((a, b) => a.lab[0] - b.lab[0]);
}

// Move a cor um degrau na rampa da paleta (para cima clareia, para baixo escurece).
// Uma cor fora da paleta vai primeiro para a cor mais próxima.
export function passoNaPaleta(cor, rampa, direcao) {
  if (!(cor >>> 24) || !rampa.length) return cor >>> 0;
  const rgb = cor & 0x00ffffff;
  let i = rampa.findIndex((p) => (p.cor & 0x00ffffff) === rgb);
  if (i < 0) i = rampa.indexOf(maisProxima(cor, rampa));
  else i = limitar(i + Math.sign(direcao), 0, rampa.length - 1);
  return ((rampa[i].cor & 0x00ffffff) | (cor & 0xff000000)) >>> 0;
}
