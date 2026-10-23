export function linha(x0, y0, x1, y1, ponto) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let erro = dx + dy;
  for (;;) {
    ponto(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * erro;
    if (e2 >= dy) {
      erro += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      erro += dx;
      y0 += sy;
    }
  }
}

export function retangulo(x0, y0, x1, y1, preenchido, ponto) {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  if (preenchido) {
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) ponto(x, y);
    return;
  }
  for (let x = xa; x <= xb; x++) {
    ponto(x, ya);
    if (yb !== ya) ponto(x, yb);
  }
  for (let y = ya + 1; y < yb; y++) {
    ponto(xa, y);
    if (xb !== xa) ponto(xb, y);
  }
}

export function elipse(x0, y0, x1, y1, preenchido, ponto) {
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let erro = dx + dy + b1 * a * a;
  if (x0 > x1) {
    x0 = x1;
    x1 += a;
  }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  const faixa = (xa, xb, y) => {
    for (let x = xa; x <= xb; x++) ponto(x, y);
  };
  do {
    if (preenchido) {
      faixa(x0, x1, y0);
      faixa(x0, x1, y1);
    } else {
      ponto(x1, y0);
      ponto(x0, y0);
      ponto(x0, y1);
      ponto(x1, y1);
    }
    const e2 = 2 * erro;
    if (e2 <= dy) {
      y0++;
      y1--;
      dy += a;
      erro += dy;
    }
    if (e2 >= dx || 2 * erro > dy) {
      x0++;
      x1--;
      dx += b1;
      erro += dx;
    }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    if (preenchido) {
      faixa(x0 - 1, x1 + 1, y0++);
      faixa(x0 - 1, x1 + 1, y1--);
    } else {
      ponto(x0 - 1, y0);
      ponto(x1 + 1, y0++);
      ponto(x0 - 1, y1);
      ponto(x1 + 1, y1--);
    }
  }
}

export function restringir(x0, y0, x1, y1, modo) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (modo === 'quadrado') {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return [x0 + Math.sign(dx || 1) * m, y0 + Math.sign(dy || 1) * m];
  }
  const angulo = Math.atan2(dy, dx);
  const oitavo = Math.round(angulo / (Math.PI / 4));
  const comprimento = Math.max(Math.abs(dx), Math.abs(dy));
  if (oitavo % 2 === 0) {
    return Math.abs(oitavo) === 2 ? [x0, y1] : [x1, y0];
  }
  return [x0 + Math.sign(dx || 1) * comprimento, y0 + Math.sign(dy || 1) * comprimento];
}

export function pincel(tamanho, forma = 'quadrado') {
  const pontos = [];
  const inicio = -Math.floor((tamanho - 1) / 2);
  const fim = inicio + tamanho - 1;
  const centro = (inicio + fim) / 2;
  const raio = tamanho / 2;
  for (let y = inicio; y <= fim; y++) {
    for (let x = inicio; x <= fim; x++) {
      if (forma === 'circulo' && tamanho > 2) {
        const d = Math.hypot(x - centro, y - centro);
        if (d > raio - 0.25) continue;
      }
      pontos.push([x, y]);
    }
  }
  return pontos;
}

export function espelhos(x, y, largura, altura, simetria) {
  const pontos = [[x, y]];
  const mx = largura - 1 - x;
  const my = altura - 1 - y;
  if (simetria === 'horizontal' || simetria === 'ambas') pontos.push([mx, y]);
  if (simetria === 'vertical' || simetria === 'ambas') pontos.push([x, my]);
  if (simetria === 'ambas') pontos.push([mx, my]);
  return pontos;
}

export function deteccaoDeEscala(pixels, largura, altura) {
  const mdc = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  };
  let g = 0;
  for (let y = 0; y < altura; y++) {
    let corrida = 1;
    const base = y * largura;
    for (let x = 1; x <= largura; x++) {
      if (x < largura && pixels[base + x] === pixels[base + x - 1]) corrida++;
      else {
        g = mdc(g, corrida);
        if (g === 1) return 1;
        corrida = 1;
      }
    }
  }
  for (let x = 0; x < largura; x++) {
    let corrida = 1;
    for (let y = 1; y <= altura; y++) {
      if (y < altura && pixels[y * largura + x] === pixels[(y - 1) * largura + x]) corrida++;
      else {
        g = mdc(g, corrida);
        if (g === 1) return 1;
        corrida = 1;
      }
    }
  }
  return Math.max(1, g);
}

// Pixel perfect: três pontos seguidos de um traço formam um "canto em L" quando o primeiro e o
// terceiro são vizinhos na diagonal e o do meio encosta nos dois pelos lados. Tirar o do meio deixa
// a linha com 1 pixel de espessura, sem degraus dobrados.
export function cantoEmL(a, b, c) {
  if (Math.abs(a[0] - c[0]) !== 1 || Math.abs(a[1] - c[1]) !== 1) return false;
  const encostaA = (b[0] === a[0] && Math.abs(b[1] - a[1]) === 1) || (b[1] === a[1] && Math.abs(b[0] - a[0]) === 1);
  const encostaC = (b[0] === c[0] && Math.abs(b[1] - c[1]) === 1) || (b[1] === c[1] && Math.abs(b[0] - c[0]) === 1);
  return encostaA && encostaC;
}

export function pixelPerfect(pontos) {
  const saida = [];
  for (const p of pontos) {
    const ultimo = saida.at(-1);
    if (ultimo && ultimo[0] === p[0] && ultimo[1] === p[1]) continue;
    saida.push(p);
    while (saida.length >= 3 && cantoEmL(saida.at(-3), saida.at(-2), saida.at(-1))) saida.splice(-2, 1);
  }
  return saida;
}
