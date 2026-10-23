// Pontilhado ordenado (dithering) com matrizes de Bayer.
// Cada célula da matriz guarda um limiar entre 0 e 1; um pixel recebe a cor "de cima"
// quando o valor (densidade ou t do degradê) passa do limiar da sua posição.

function bayer(n) {
  if (n === 1) return [[0]];
  const m = bayer(n / 2);
  const t = n / 2;
  const r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < t; x++) {
      const v = 4 * m[y][x];
      r[y][x] = v;
      r[y][x + t] = v + 2;
      r[y + t][x] = v + 3;
      r[y + t][x + t] = v + 1;
    }
  }
  return r;
}

export const BAYER = {
  2: bayer(2),
  4: bayer(4),
  8: bayer(8),
};

// Limiar normalizado no centro de cada degrau: (v + 0.5) / n².
export function limiarBayer(x, y, n = 4) {
  const m = BAYER[n] ?? BAYER[4];
  const yy = ((y % n) + n) % n;
  const xx = ((x % n) + n) % n;
  return (m[yy][xx] + 0.5) / (n * n);
}

// Pincel de pontilhado: true quando o pixel (x, y) recebe a cor primária para a densidade dada (0 a 1).
export function pixelDoPadrao(x, y, densidade, n = 4) {
  return limiarBayer(x, y, n) < densidade;
}

// Valor t (0 a 1) de um degradê linear de A até B no pixel (x, y): projeção do vetor AP sobre AB.
export function degradeLinear(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const comprimento2 = dx * dx + dy * dy;
  if (comprimento2 === 0) return 0;
  const t = ((x - ax) * dx + (y - ay) * dy) / comprimento2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Valor t (0 a 1) de um degradê radial com centro A e raio |AB|.
export function degradeRadial(x, y, ax, ay, bx, by) {
  const raio = Math.hypot(bx - ax, by - ay);
  if (raio === 0) return 0;
  const t = Math.hypot(x - ax, y - ay) / raio;
  return t > 1 ? 1 : t;
}

// Escolhe entre as cores de início e fim para o pixel (x, y) com o valor t, usando o pontilhado ordenado.
export function corDoDegrade(x, y, t, inicio, fim, n = 4) {
  return t > limiarBayer(x, y, n) ? fim : inicio;
}

// Calcula o degradê inteiro numa lista de índices (ou na matriz toda) e devolve pares [índice, cor].
export function degrade(largura, altura, { ax, ay, bx, by, tipo = 'linear', matriz = 4, inicio, fim, indices = null }) {
  const valor = tipo === 'radial' ? degradeRadial : degradeLinear;
  const resultado = [];
  const visitar = (i) => {
    const x = i % largura;
    const y = (i / largura) | 0;
    resultado.push([i, corDoDegrade(x, y, valor(x + 0.5, y + 0.5, ax + 0.5, ay + 0.5, bx + 0.5, by + 0.5), inicio, fim, matriz)]);
  };
  if (indices) for (const i of indices) visitar(i);
  else for (let i = 0; i < largura * altura; i++) visitar(i);
  return resultado;
}
