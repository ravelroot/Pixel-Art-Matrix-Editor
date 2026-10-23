import { scaleNearest } from '../core/export.js';

export function createCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function pixelsToCanvas(pixels, width, height, scale = 1) {
  const px = scale > 1 ? scaleNearest(pixels, width, height, scale) : pixels;
  const L = width * scale;
  const A = height * scale;
  const canvas = createCanvas(L, A);
  const ctx = canvas.getContext('2d');
  const data = new ImageData(new Uint8ClampedArray(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)), L, A);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.'))), type, quality);
  });
}

export async function fileToPixels(file, limit = 4096) {
  const bitmap = await createImageBitmap(file);
  if (bitmap.width > limit || bitmap.height > limit) {
    bitmap.close?.();
    throw new Error(`A imagem passa de ${limit} pixels de lado.`);
  }
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { width: data.width, height: data.height, pixels: new Uint32Array(data.data.buffer.slice(0)) };
}

export function downscale(pixels, width, height, factor) {
  if (factor <= 1) return { pixels, width, height };
  const L = Math.max(1, Math.floor(width / factor));
  const A = Math.max(1, Math.floor(height / factor));
  const output = new Uint32Array(L * A);
  const mid = Math.floor(factor / 2);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) output[y * L + x] = pixels[(y * factor + mid) * width + x * factor + mid];
  }
  return { pixels: output, width: L, height: A };
}

export function crop(pixels, width, x0, y0, l, a) {
  const output = new Uint32Array(l * a);
  for (let y = 0; y < a; y++) {
    output.set(pixels.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + l), y * l);
  }
  return output;
}

export function thumbnail(pixels, width, height, side = 128) {
  const scale = Math.max(1, Math.floor(side / Math.max(width, height)));
  return pixelsToCanvas(pixels, width, height, scale).toDataURL('image/png');
}
