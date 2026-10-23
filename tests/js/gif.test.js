import test from 'node:test';
import assert from 'node:assert/strict';
import { codificarGIF, lzw } from '../../editor/static/editor/js/nucleo/gif.js';
import { empacotar } from '../../editor/static/editor/js/nucleo/cores.js';

// Decodificador mínimo (LZW + blocos) só para conferir o que o codificador gera.
function deslzw(dados, tamanhoMinimo) {
  const limpar = 1 << tamanhoMinimo;
  const fim = limpar + 1;
  let tamanho = tamanhoMinimo + 1;
  let tabela = [];
  const reiniciar = () => {
    tabela = Array.from({ length: limpar + 2 }, (_, i) => (i < limpar ? [i] : []));
    tamanho = tamanhoMinimo + 1;
  };
  reiniciar();
  const saida = [];
  let pos = 0;
  let anterior = null;
  const ler = () => {
    let v = 0;
    for (let i = 0; i < tamanho; i++, pos++) v |= ((dados[pos >> 3] >> (pos & 7)) & 1) << i;
    return v;
  };
  while (pos + tamanho <= dados.length * 8) {
    const codigo = ler();
    if (codigo === limpar) {
      reiniciar();
      anterior = null;
      continue;
    }
    if (codigo === fim) break;
    let seq;
    if (codigo < tabela.length) seq = tabela[codigo];
    else seq = [...tabela[anterior], tabela[anterior][0]];
    saida.push(...seq);
    if (anterior !== null && tabela.length < 4096) tabela.push([...tabela[anterior], seq[0]]);
    if (tabela.length === 1 << tamanho && tamanho < 12) tamanho++;
    anterior = codigo;
  }
  return saida;
}

function lerGIF(bytes) {
  const u16 = (i) => bytes[i] | (bytes[i + 1] << 8);
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), 'GIF89a');
  const largura = u16(6);
  const altura = u16(8);
  const bitsPaleta = (bytes[10] & 7) + 1;
  let pos = 13 + 3 * (1 << bitsPaleta);
  const quadros = [];
  const atrasos = [];
  let repete = false;
  while (bytes[pos] !== 0x3b) {
    if (bytes[pos] === 0x21) {
      if (bytes[pos + 1] === 0xf9) atrasos.push(u16(pos + 4) * 10);
      if (bytes[pos + 1] === 0xff) repete = true;
      pos += 2;
      while (bytes[pos]) pos += bytes[pos] + 1;
      pos++;
    } else if (bytes[pos] === 0x2c) {
      pos += 10;
      const minimo = bytes[pos++];
      const dados = [];
      while (bytes[pos]) {
        dados.push(...bytes.slice(pos + 1, pos + 1 + bytes[pos]));
        pos += bytes[pos] + 1;
      }
      pos++;
      quadros.push(deslzw(Uint8Array.from(dados), minimo));
    } else throw new Error('Bloco inesperado ' + bytes[pos]);
  }
  return { largura, altura, quadros, atrasos, repete, paleta: (i) => [bytes[13 + i * 3], bytes[14 + i * 3], bytes[15 + i * 3]] };
}

test('gif: LZW de ida e volta, inclusive passando de 4096 códigos', () => {
  const curtos = [0, 1, 1, 1, 0, 2, 3, 3, 3, 3];
  assert.deepEqual(deslzw(lzw(Uint8Array.from(curtos), 2), 2), curtos);
  const longos = Uint8Array.from({ length: 50000 }, (_, i) => (i * 7919 + (i >> 5)) % 256);
  assert.deepEqual(deslzw(lzw(longos, 8), 8), [...longos]);
});

test('gif: animação com transparência, paleta exata, atrasos e repetição', () => {
  const V = empacotar(93, 28, 22);
  const P = empacotar(246, 228, 166);
  const q1 = Uint32Array.from([V, 0, P, V]);
  const q2 = Uint32Array.from([0, P, P, empacotar(1, 2, 3, 40)]);
  const gif = lerGIF(codificarGIF([q1, q2], 2, 2, { atrasos: [100, 250] }));
  assert.equal(gif.largura, 2);
  assert.equal(gif.altura, 2);
  assert.equal(gif.quadros.length, 2);
  assert.deepEqual(gif.atrasos, [100, 250]);
  assert.equal(gif.repete, true);
  const [i1, i2] = gif.quadros;
  assert.equal(i1[1], 0, 'transparente usa o índice 0');
  assert.equal(i2[3], 0, 'alfa abaixo de 50% vira transparente');
  assert.deepEqual(gif.paleta(i1[0]), [93, 28, 22]);
  assert.deepEqual(gif.paleta(i1[2]), [246, 228, 166]);
  assert.equal(i1[0], i1[3]);
});

test('gif: mais de 255 cores cai no cubo de cores sem quebrar', () => {
  const px = Uint32Array.from({ length: 32 * 32 }, (_, i) => empacotar(i % 256, (i * 3) % 256, (i * 7) % 256));
  const gif = lerGIF(codificarGIF([px], 32, 32));
  assert.equal(gif.quadros[0].length, 1024);
  assert.equal(gif.repete, false, 'um quadro só não precisa do bloco de repetição');
  assert.throws(() => codificarGIF([], 1, 1));
});
