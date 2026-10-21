import { escalarVizinho } from '../nucleo/exportar.js';

export function criarCanvas(largura, altura) {
  const c = document.createElement('canvas');
  c.width = largura;
  c.height = altura;
  return c;
}

export function pixelsParaCanvas(pixels, largura, altura, escala = 1) {
  const px = escala > 1 ? escalarVizinho(pixels, largura, altura, escala) : pixels;
  const L = largura * escala;
  const A = altura * escala;
  const canvas = criarCanvas(L, A);
  const ctx = canvas.getContext('2d');
  const dados = new ImageData(new Uint8ClampedArray(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)), L, A);
  ctx.putImageData(dados, 0, 0);
  return canvas;
}

export function canvasParaBlob(canvas, tipo = 'image/png', qualidade = 0.92) {
  return new Promise((resolver, rejeitar) => {
    canvas.toBlob((blob) => (blob ? resolver(blob) : rejeitar(new Error('Não foi possível gerar a imagem.'))), tipo, qualidade);
  });
}

export async function arquivoParaPixels(arquivo, limite = 4096) {
  const bitmap = await createImageBitmap(arquivo);
  if (bitmap.width > limite || bitmap.height > limite) {
    bitmap.close?.();
    throw new Error(`A imagem passa de ${limite} pixels de lado.`);
  }
  const canvas = criarCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const dados = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { largura: dados.width, altura: dados.height, pixels: new Uint32Array(dados.data.buffer.slice(0)) };
}

export function reduzir(pixels, largura, altura, fator) {
  if (fator <= 1) return { pixels, largura, altura };
  const L = Math.max(1, Math.floor(largura / fator));
  const A = Math.max(1, Math.floor(altura / fator));
  const saida = new Uint32Array(L * A);
  const meio = Math.floor(fator / 2);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) saida[y * L + x] = pixels[(y * fator + meio) * largura + x * fator + meio];
  }
  return { pixels: saida, largura: L, altura: A };
}

export function recortar(pixels, largura, x0, y0, l, a) {
  const saida = new Uint32Array(l * a);
  for (let y = 0; y < a; y++) {
    saida.set(pixels.subarray((y0 + y) * largura + x0, (y0 + y) * largura + x0 + l), y * l);
  }
  return saida;
}

export function miniatura(pixels, largura, altura, lado = 128) {
  const escala = Math.max(1, Math.floor(lado / Math.max(largura, altura)));
  return pixelsParaCanvas(pixels, largura, altura, escala).toDataURL('image/png');
}
