// Seleção retangular e operações de região sobre matrizes Uint32Array (RGBA empacotado).

// Normaliza dois cantos (em qualquer ordem) num retângulo { x, y, largura, altura } recortado à matriz.
export function retanguloDe(x0, y0, x1, y1, larguraDoc, alturaDoc) {
  let xa = Math.max(0, Math.min(x0, x1));
  let ya = Math.max(0, Math.min(y0, y1));
  let xb = Math.min(larguraDoc - 1, Math.max(x0, x1));
  let yb = Math.min(alturaDoc - 1, Math.max(y0, y1));
  if (xb < xa || yb < ya) return null;
  return { x: xa, y: ya, largura: xb - xa + 1, altura: yb - ya + 1 };
}

// Recorta um retângulo qualquer (pode estar fora da matriz) aos limites do documento.
export function recortarAoDocumento(r, larguraDoc, alturaDoc) {
  if (!r) return null;
  return retanguloDe(r.x, r.y, r.x + r.largura - 1, r.y + r.altura - 1, larguraDoc, alturaDoc);
}

export function contem(r, x, y) {
  return !r || (x >= r.x && y >= r.y && x < r.x + r.largura && y < r.y + r.altura);
}

// Copia os pixels de um retângulo para uma nova matriz { largura, altura, pixels }.
export function extrairRegiao(pixels, larguraDoc, r) {
  const saida = new Uint32Array(r.largura * r.altura);
  for (let y = 0; y < r.altura; y++) {
    const inicio = (r.y + y) * larguraDoc + r.x;
    saida.set(pixels.subarray(inicio, inicio + r.largura), y * r.largura);
  }
  return { largura: r.largura, altura: r.altura, pixels: saida };
}

// Chama pintar(indice, cor) para cada pixel da região colada em (x0, y0), recortando ao documento.
// Com somenteOpacos, pixels transparentes da região não apagam o que está embaixo.
export function colarRegiao(regiao, larguraDoc, alturaDoc, x0, y0, pintar, { somenteOpacos = false } = {}) {
  for (let y = 0; y < regiao.altura; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= alturaDoc) continue;
    for (let x = 0; x < regiao.largura; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= larguraDoc) continue;
      const cor = regiao.pixels[y * regiao.largura + x];
      if (somenteOpacos && !(cor >>> 24)) continue;
      pintar(ty * larguraDoc + tx, cor);
    }
  }
}

// Índices de todos os pixels de um retângulo (ou da matriz toda, se r for nulo).
export function indicesDe(r, larguraDoc, alturaDoc) {
  const area = r ?? { x: 0, y: 0, largura: larguraDoc, altura: alturaDoc };
  const saida = new Uint32Array(area.largura * area.altura);
  let k = 0;
  for (let y = area.y; y < area.y + area.altura; y++) for (let x = area.x; x < area.x + area.largura; x++) saida[k++] = y * larguraDoc + x;
  return saida;
}

// Menor retângulo que contém todos os pixels não transparentes de várias matrizes do mesmo tamanho.
export function limitesDoConteudo(matrizes, largura, altura) {
  let xa = largura;
  let ya = altura;
  let xb = -1;
  let yb = -1;
  for (const px of matrizes) {
    for (let y = 0; y < altura; y++) {
      const base = y * largura;
      for (let x = 0; x < largura; x++) {
        if (!(px[base + x] >>> 24)) continue;
        if (x < xa) xa = x;
        if (x > xb) xb = x;
        if (y < ya) ya = y;
        if (y > yb) yb = y;
      }
    }
  }
  if (xb < 0) return null;
  return { x: xa, y: ya, largura: xb - xa + 1, altura: yb - ya + 1 };
}

// Desloca a matriz com repetição (wrap): o que sai por um lado entra pelo outro.
export function deslocarComRepeticao(pixels, largura, altura, dx, dy) {
  const saida = new Uint32Array(pixels.length);
  const mx = ((dx % largura) + largura) % largura;
  const my = ((dy % altura) + altura) % altura;
  for (let y = 0; y < altura; y++) {
    const ny = (y + my) % altura;
    for (let x = 0; x < largura; x++) saida[ny * largura + ((x + mx) % largura)] = pixels[y * largura + x];
  }
  return saida;
}
