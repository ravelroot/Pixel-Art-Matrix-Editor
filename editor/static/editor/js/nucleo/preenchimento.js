import { distancia } from './cores.js';

function comparador(alvo, tolerancia) {
  if (tolerancia <= 0) {
    if (((alvo >>> 24) & 255) === 0) return (c) => ((c >>> 24) & 255) === 0;
    return (c) => c === alvo;
  }
  return (c) => distancia(c, alvo) <= tolerancia;
}

export function regiao(pixels, largura, altura, x, y, { conectividade = 4, tolerancia = 0, contiguo = true } = {}) {
  if (x < 0 || y < 0 || x >= largura || y >= altura) return new Uint32Array(0);
  const igual = comparador(pixels[y * largura + x], tolerancia);
  if (!contiguo) {
    const todos = [];
    for (let i = 0; i < pixels.length; i++) if (igual(pixels[i])) todos.push(i);
    return Uint32Array.from(todos);
  }
  const visitado = new Uint8Array(largura * altura);
  const encontrados = [];
  const pilha = [x, y];
  const diagonal = conectividade === 8;
  while (pilha.length) {
    const cy = pilha.pop();
    const cx = pilha.pop();
    const base = cy * largura;
    if (visitado[base + cx] || !igual(pixels[base + cx])) continue;
    let xi = cx;
    while (xi > 0 && !visitado[base + xi - 1] && igual(pixels[base + xi - 1])) xi--;
    let xf = cx;
    while (xf < largura - 1 && !visitado[base + xf + 1] && igual(pixels[base + xf + 1])) xf++;
    for (let i = xi; i <= xf; i++) {
      visitado[base + i] = 1;
      encontrados.push(base + i);
    }
    const de = diagonal ? Math.max(0, xi - 1) : xi;
    const ate = diagonal ? Math.min(largura - 1, xf + 1) : xf;
    for (let ny = cy - 1; ny <= cy + 1; ny += 2) {
      if (ny < 0 || ny >= altura) continue;
      const nb = ny * largura;
      let emFaixa = false;
      for (let i = de; i <= ate; i++) {
        const livre = !visitado[nb + i] && igual(pixels[nb + i]);
        if (livre && !emFaixa) {
          pilha.push(i, ny);
          emFaixa = true;
        } else if (!livre) {
          emFaixa = false;
        }
      }
    }
  }
  return Uint32Array.from(encontrados);
}

export function preencher(pixels, largura, altura, x, y, cor, opcoes = {}) {
  const indices = regiao(pixels, largura, altura, x, y, opcoes);
  const alterados = [];
  for (const i of indices) {
    if (pixels[i] !== cor) {
      pixels[i] = cor;
      alterados.push(i);
    }
  }
  return Uint32Array.from(alterados);
}
