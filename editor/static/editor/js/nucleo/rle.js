const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REVERSO = new Int16Array(128).fill(-1);
for (let i = 0; i < ALFABETO.length; i++) REVERSO[ALFABETO.charCodeAt(i)] = i;

function tamanhoVarint(n) {
  let t = 1;
  while (n >= 128) {
    n = Math.floor(n / 128);
    t++;
  }
  return t;
}

export function codificarRLE(pixels) {
  const n = pixels.length;
  let bytes = 0;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && pixels[j] === pixels[i]) j++;
    bytes += tamanhoVarint(j - i) + 4;
    i = j;
  }
  const saida = new Uint8Array(bytes);
  let p = 0;
  i = 0;
  while (i < n) {
    const cor = pixels[i];
    let j = i + 1;
    while (j < n && pixels[j] === cor) j++;
    let corrida = j - i;
    while (corrida >= 128) {
      saida[p++] = (corrida & 127) | 128;
      corrida = Math.floor(corrida / 128);
    }
    saida[p++] = corrida;
    saida[p++] = cor & 255;
    saida[p++] = (cor >>> 8) & 255;
    saida[p++] = (cor >>> 16) & 255;
    saida[p++] = (cor >>> 24) & 255;
    i = j;
  }
  return saida;
}

export function decodificarRLE(bytes, total) {
  const pixels = new Uint32Array(total);
  let p = 0;
  let i = 0;
  while (p < bytes.length) {
    let corrida = 0;
    let escala = 1;
    for (;;) {
      if (p >= bytes.length) throw new Error('RLE truncado');
      const b = bytes[p++];
      corrida += (b & 127) * escala;
      if (b < 128) break;
      escala *= 128;
    }
    if (p + 4 > bytes.length) throw new Error('RLE truncado');
    const cor = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
    p += 4;
    if (i + corrida > total) throw new Error('RLE maior que a matriz');
    pixels.fill(cor, i, i + corrida);
    i += corrida;
  }
  if (i !== total) throw new Error('RLE menor que a matriz');
  return pixels;
}

export function paraBase64(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63] + ALFABETO[(n >> 6) & 63] + ALFABETO[n & 63];
  }
  const resto = bytes.length - i;
  if (resto === 1) {
    const n = bytes[i] << 16;
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63] + '==';
  } else if (resto === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63] + ALFABETO[(n >> 6) & 63] + '=';
  }
  return s;
}

export function deBase64(texto) {
  const limpo = texto.replace(/[^A-Za-z0-9+/]/g, '');
  const saida = new Uint8Array(Math.floor((limpo.length * 3) / 4));
  let p = 0;
  let acumulado = 0;
  let bits = 0;
  for (let i = 0; i < limpo.length; i++) {
    const v = REVERSO[limpo.charCodeAt(i)];
    if (v < 0) throw new Error('Base64 inválido');
    acumulado = ((acumulado << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      saida[p++] = (acumulado >> bits) & 255;
    }
  }
  return saida.subarray(0, p);
}
