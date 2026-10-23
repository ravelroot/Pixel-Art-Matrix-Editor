// Codificador de GIF animado (GIF89a) sem dependências: paleta global, transparência e compressão LZW.
// A pixel art costuma ter poucas cores, então a paleta é exata; acima de 255 cores, cai num cubo 6×7×6.

const LIMIAR_ALFA = 128;

function paletaGlobal(quadros) {
  const cores = new Map();
  for (const px of quadros) {
    for (let i = 0; i < px.length; i++) {
      const c = px[i];
      if ((c >>> 24) < LIMIAR_ALFA) continue;
      const rgb = c & 0x00ffffff;
      if (!cores.has(rgb)) {
        cores.set(rgb, cores.size + 1);
        if (cores.size > 255) return null;
      }
    }
  }
  return cores;
}

function cubo() {
  const cores = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) cores.push(Math.round((r * 255) / 5) | (Math.round((g * 255) / 6) << 8) | (Math.round((b * 255) / 5) << 16));
  return cores;
}

function indiceNoCubo(c) {
  const r = Math.round(((c & 255) * 5) / 255);
  const g = Math.round((((c >>> 8) & 255) * 6) / 255);
  const b = Math.round((((c >>> 16) & 255) * 5) / 255);
  return 1 + r * 42 + g * 6 + b;
}

export function lzw(indices, tamanhoMinimo) {
  const limpar = 1 << tamanhoMinimo;
  const fim = limpar + 1;
  let tamanho = tamanhoMinimo + 1;
  let proximo = fim + 1;
  const dicionario = new Map();
  const saida = [];
  let acumulado = 0;
  let bits = 0;
  const escrever = (codigo) => {
    acumulado |= codigo << bits;
    bits += tamanho;
    while (bits >= 8) {
      saida.push(acumulado & 255);
      acumulado >>>= 8;
      bits -= 8;
    }
  };
  escrever(limpar);
  if (!indices.length) {
    escrever(fim);
    if (bits > 0) saida.push(acumulado & 255);
    return Uint8Array.from(saida);
  }
  let prefixo = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const chave = (prefixo << 8) | k;
    const existente = dicionario.get(chave);
    if (existente !== undefined) {
      prefixo = existente;
      continue;
    }
    escrever(prefixo);
    if (proximo === 4096) {
      escrever(limpar);
      dicionario.clear();
      tamanho = tamanhoMinimo + 1;
      proximo = fim + 1;
    } else {
      if (proximo >= 1 << tamanho) tamanho++;
      dicionario.set(chave, proximo++);
    }
    prefixo = k;
  }
  escrever(prefixo);
  escrever(fim);
  if (bits > 0) saida.push(acumulado & 255);
  return Uint8Array.from(saida);
}

// quadros: lista de Uint32Array (RGBA empacotado, R no byte baixo) do mesmo tamanho.
// atrasos: duração de cada quadro em milissegundos. repetir: 0 = para sempre.
export function codificarGIF(quadros, largura, altura, { atrasos = [], repetir = 0 } = {}) {
  if (!quadros.length) throw new Error('Nenhum quadro para exportar.');
  const exata = paletaGlobal(quadros);
  const cores = exata ? [...exata.keys()] : cubo();
  const total = cores.length + 1;
  let bitsPaleta = 1;
  while (1 << bitsPaleta < total) bitsPaleta++;
  const tamanhoPaleta = 1 << bitsPaleta;
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  const texto = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  texto('GIF89a');
  u16(largura);
  u16(altura);
  bytes.push(0x80 | ((bitsPaleta - 1) << 4) | (bitsPaleta - 1), 0, 0);
  bytes.push(0, 0, 0);
  for (const c of cores) bytes.push(c & 255, (c >>> 8) & 255, (c >>> 16) & 255);
  for (let i = total; i < tamanhoPaleta; i++) bytes.push(0, 0, 0);
  if (quadros.length > 1) {
    bytes.push(0x21, 0xff, 0x0b);
    texto('NETSCAPE2.0');
    bytes.push(0x03, 0x01);
    u16(repetir);
    bytes.push(0x00);
  }
  const tamanhoMinimo = Math.max(2, bitsPaleta);
  quadros.forEach((px, q) => {
    const centesimos = Math.max(2, Math.round((atrasos[q] ?? 100) / 10));
    bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1);
    u16(centesimos);
    bytes.push(0, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(largura);
    u16(altura);
    bytes.push(0);
    const indices = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i++) {
      const c = px[i];
      if ((c >>> 24) < LIMIAR_ALFA) continue;
      indices[i] = exata ? exata.get(c & 0x00ffffff) : indiceNoCubo(c);
    }
    bytes.push(tamanhoMinimo);
    const dados = lzw(indices, tamanhoMinimo);
    for (let i = 0; i < dados.length; i += 255) {
      const bloco = dados.subarray(i, i + 255);
      bytes.push(bloco.length, ...bloco);
    }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
