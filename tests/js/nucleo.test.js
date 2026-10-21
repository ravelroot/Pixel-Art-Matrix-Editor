import test from 'node:test';
import assert from 'node:assert/strict';
import { empacotar, hexParaCor, corParaHex, gerarTons, rgbParaOklch, oklchParaRgb, sobrepor, desempacotar } from '../../editor/static/editor/js/nucleo/cores.js';
import { linha, retangulo, elipse, pincel, espelhos, restringir, deteccaoDeEscala } from '../../editor/static/editor/js/nucleo/geometria.js';
import { preencher, regiao } from '../../editor/static/editor/js/nucleo/preenchimento.js';
import { codificarRLE, decodificarRLE, paraBase64, deBase64 } from '../../editor/static/editor/js/nucleo/rle.js';
import { Documento } from '../../editor/static/editor/js/nucleo/documento.js';
import { Historico, Traco, LIMIAR_CELULA } from '../../editor/static/editor/js/nucleo/historico.js';
import { serializar, desserializar, nomeDeArquivo } from '../../editor/static/editor/js/nucleo/formato.js';

const PRETO = empacotar(0, 0, 0);
const VERMELHO = empacotar(255, 0, 0);
const AZUL = empacotar(0, 0, 255);

const coletar = (fn) => {
  const pontos = new Set();
  fn((x, y) => pontos.add(`${x},${y}`));
  return pontos;
};

test('cores: hex de ida e volta, com e sem alfa', () => {
  assert.equal(corParaHex(hexParaCor('#5D1C16')), '#5d1c16');
  assert.equal(corParaHex(hexParaCor('#5d1c1680')), '#5d1c1680');
  assert.equal(corParaHex(hexParaCor('abc')), '#aabbcc');
  assert.equal(hexParaCor('xyz'), null);
  assert.deepEqual(desempacotar(VERMELHO), [255, 0, 0, 255]);
});

test('cores: OKLCH volta para o mesmo RGB', () => {
  for (const hex of ['#5d1c16', '#a3b4be', '#f6e4a6', '#7a6e46', '#000000', '#ffffff']) {
    const [r, g, b] = desempacotar(hexParaCor(hex));
    const volta = oklchParaRgb(...rgbParaOklch(r, g, b));
    volta.forEach((v, i) => assert.ok(Math.abs(v - [r, g, b][i]) <= 1, `${hex} canal ${i}`));
  }
});

test('cores: tons ficam ordenados do mais escuro ao mais claro', () => {
  const { rampa, escuros, claros } = gerarTons(hexParaCor('#7a6e46'), { passos: 4 });
  assert.equal(rampa.length, 9);
  assert.equal(escuros.length, 4);
  assert.equal(claros.length, 4);
  const L = rampa.map((c) => rgbParaOklch(...desempacotar(c).slice(0, 3))[0]);
  for (let i = 1; i < L.length; i++) assert.ok(L[i] > L[i - 1], `luminosidade ${i}`);
});

test('cores: sobreposição respeita a opacidade', () => {
  const meio = sobrepor(AZUL, VERMELHO, 0.5);
  const [r, , b, a] = desempacotar(meio);
  assert.ok(Math.abs(r - 128) <= 1 && Math.abs(b - 127) <= 1 && a === 255);
  assert.equal(sobrepor(0, VERMELHO, 1), VERMELHO);
});

test('geometria: linha de Bresenham liga as pontas sem buracos', () => {
  const pontos = [];
  linha(0, 0, 7, 3, (x, y) => pontos.push([x, y]));
  assert.deepEqual(pontos[0], [0, 0]);
  assert.deepEqual(pontos.at(-1), [7, 3]);
  assert.equal(pontos.length, 8);
  for (let i = 1; i < pontos.length; i++) {
    assert.ok(Math.abs(pontos[i][0] - pontos[i - 1][0]) <= 1 && Math.abs(pontos[i][1] - pontos[i - 1][1]) <= 1);
  }
});

test('geometria: retângulo vazado e preenchido', () => {
  assert.equal(coletar((p) => retangulo(0, 0, 4, 3, false, p)).size, 14);
  assert.equal(coletar((p) => retangulo(4, 3, 0, 0, true, p)).size, 20);
  assert.equal(coletar((p) => retangulo(2, 2, 2, 2, false, p)).size, 1);
});

test('geometria: elipse é simétrica e cabe na caixa', () => {
  for (const [w, h] of [[8, 8], [9, 5], [16, 7], [2, 2]]) {
    const pontos = coletar((p) => elipse(0, 0, w - 1, h - 1, false, p));
    for (const k of pontos) {
      const [x, y] = k.split(',').map(Number);
      assert.ok(x >= 0 && x < w && y >= 0 && y < h, `${w}x${h} fora: ${k}`);
      assert.ok(pontos.has(`${w - 1 - x},${y}`), `${w}x${h} sem espelho horizontal de ${k}`);
      assert.ok(pontos.has(`${x},${h - 1 - y}`), `${w}x${h} sem espelho vertical de ${k}`);
    }
    const cheia = coletar((p) => elipse(0, 0, w - 1, h - 1, true, p));
    assert.ok(cheia.size >= pontos.size);
  }
});

test('geometria: pincel, espelhos e restrição de ângulo', () => {
  assert.equal(pincel(1).length, 1);
  assert.equal(pincel(3).length, 9);
  assert.ok(pincel(5, 'circulo').length < 25);
  assert.deepEqual(espelhos(1, 2, 8, 8, 'ambas'), [[1, 2], [6, 2], [1, 5], [6, 5]]);
  assert.deepEqual(restringir(0, 0, 10, 1, 'linha'), [10, 0]);
  assert.deepEqual(restringir(0, 0, 9, 10, 'linha'), [10, 10]);
  assert.deepEqual(restringir(0, 0, 3, 7, 'quadrado'), [7, 7]);
});

test('geometria: detecta o tamanho do pixel numa imagem ampliada', () => {
  const base = Uint32Array.from([PRETO, VERMELHO, AZUL, PRETO]);
  const ampliada = new Uint32Array(8 * 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) ampliada[y * 8 + x] = base[Math.floor(y / 4) * 2 + Math.floor(x / 4)];
  assert.equal(deteccaoDeEscala(ampliada, 8, 8), 4);
});

test('preenchimento: balde respeita bordas e conectividade', () => {
  const L = 5;
  const px = new Uint32Array(25);
  for (let i = 0; i < 5; i++) px[i * L + 2] = PRETO;
  const alterados = preencher(px, L, 5, 0, 0, VERMELHO);
  assert.equal(alterados.length, 10);
  assert.equal(px[4], 0);
  const diag = new Uint32Array(9);
  diag[0] = PRETO;
  diag[4] = PRETO;
  diag[8] = PRETO;
  assert.equal(regiao(diag, 3, 3, 0, 0, { conectividade: 4 }).length, 1);
  assert.equal(regiao(diag, 3, 3, 0, 0, { conectividade: 8 }).length, 3);
  assert.equal(regiao(px, L, 5, 3, 0, { contiguo: false }).length, 10);
});

test('preenchimento: tolerância junta cores parecidas', () => {
  const px = Uint32Array.from([empacotar(100, 0, 0), empacotar(110, 0, 0), empacotar(200, 0, 0)]);
  assert.equal(regiao(px, 3, 1, 0, 0, { tolerancia: 0 }).length, 1);
  assert.equal(regiao(px, 3, 1, 0, 0, { tolerancia: 20 }).length, 2);
});

test('rle e base64: ida e volta sem perdas', () => {
  const px = new Uint32Array(4096);
  px.fill(VERMELHO, 100, 3000);
  px[3500] = hexParaCor('#12345678');
  const bytes = codificarRLE(px);
  assert.ok(bytes.length < 40);
  assert.deepEqual(decodificarRLE(bytes, px.length), px);
  for (const n of [0, 1, 2, 3, 4, 5, 255]) {
    const dados = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
    assert.deepEqual(deBase64(paraBase64(dados)), dados);
  }
  assert.equal(paraBase64(Uint8Array.from([77, 97, 110])), 'TWFu');
  assert.throws(() => decodificarRLE(bytes, 10));
});

test('documento: camadas, composição e opacidade', () => {
  const doc = new Documento(4, 4);
  const q = doc.quadros[0].id;
  const c1 = doc.camadas[0];
  const c2 = doc.adicionarCamada('Topo');
  doc.celula(q, c1.id)[0] = AZUL;
  doc.celula(q, c2.id)[0] = VERMELHO;
  assert.equal(doc.compor(0)[0], VERMELHO);
  c2.visivel = false;
  assert.equal(doc.compor(0)[0], AZUL);
  c2.visivel = true;
  c2.opacidade = 50;
  doc.mesclarAbaixo(c2.id);
  assert.equal(doc.camadas.length, 1);
  assert.notEqual(doc.compor(0)[0], AZUL);
});

test('documento: redimensionar com âncora e escalar', () => {
  const doc = new Documento(2, 2);
  const px = doc.celula(doc.quadros[0].id, doc.camadas[0].id);
  px.set([1, 2, 3, 4].map((n) => empacotar(n, 0, 0)));
  doc.redimensionar(4, 4, 0.5, 0.5);
  const novo = doc.celula(doc.quadros[0].id, doc.camadas[0].id);
  assert.equal(novo[1 * 4 + 1], empacotar(1, 0, 0));
  assert.equal(novo[2 * 4 + 2], empacotar(4, 0, 0));
  doc.redimensionar(2, 2, 0.5, 0.5);
  doc.escalar(4, 4);
  assert.equal(doc.celula(doc.quadros[0].id, doc.camadas[0].id)[0], empacotar(1, 0, 0));
  doc.girar(1);
  assert.equal(doc.largura, 4);
});

test('histórico: desfaz e refaz pixels, células grandes e estrutura', () => {
  const doc = new Documento(64, 64);
  const h = new Historico();
  const chave = doc.chave(doc.quadros[0].id, doc.camadas[0].id);
  const traco = new Traco(chave, doc.celulaPorChave(chave));
  traco.pintar(5, VERMELHO);
  traco.pintar(6, VERMELHO);
  h.registrar(traco.concluir('Lápis'));
  assert.equal(h.passado[0].tipo, 'pixels');
  const grande = new Traco(chave, doc.celulaPorChave(chave));
  for (let i = 0; i < LIMIAR_CELULA + 10; i++) grande.pintar(i, AZUL);
  h.registrar(grande.concluir('Balde'));
  assert.equal(h.passado[1].tipo, 'celula');
  const antes = doc.instantaneo();
  doc.adicionarCamada('Nova');
  h.registrarEstado('Nova camada', antes, doc.instantaneo());
  assert.equal(doc.camadas.length, 2);
  h.desfazer(doc);
  assert.equal(doc.camadas.length, 1);
  h.desfazer(doc);
  assert.equal(doc.celulaPorChave(chave)[100], 0);
  assert.equal(doc.celulaPorChave(chave)[5], VERMELHO);
  h.desfazer(doc);
  assert.equal(doc.celulaPorChave(chave)[5], 0);
  h.refazer(doc);
  h.refazer(doc);
  h.refazer(doc);
  assert.equal(doc.camadas.length, 2);
  assert.equal(doc.celulaPorChave(chave)[100], AZUL);
  assert.ok(h.bytes > 0 && h.bytes < 64 * 1024);
});

test('histórico: nova ação apaga o futuro', () => {
  const doc = new Documento(8, 8);
  const h = new Historico();
  const chave = doc.chave(doc.quadros[0].id, doc.camadas[0].id);
  for (let i = 0; i < 3; i++) {
    const t = new Traco(chave, doc.celulaPorChave(chave));
    t.pintar(i, VERMELHO);
    h.registrar(t.concluir('Lápis'));
  }
  h.desfazer(doc);
  h.desfazer(doc);
  assert.equal(h.futuro.length, 2);
  const t = new Traco(chave, doc.celulaPorChave(chave));
  t.pintar(10, AZUL);
  h.registrar(t.concluir('Lápis'));
  assert.equal(h.futuro.length, 0);
  assert.equal(h.passado.length, 2);
});

test('formato: serializa e restaura o projeto inteiro', () => {
  const doc = new Documento(16, 8, { nome: 'Poção' });
  doc.adicionarCamada('Brilho');
  doc.duplicarQuadro(doc.quadros[0].id);
  doc.celula(doc.quadros[1].id, doc.camadas[1].id)[17] = VERMELHO;
  doc.camadas[1].opacidade = 40;
  doc.paleta = [VERMELHO, AZUL];
  const texto = JSON.stringify(serializar(doc));
  const volta = desserializar(texto);
  assert.equal(volta.nome, 'Poção');
  assert.equal(volta.largura, 16);
  assert.equal(volta.quadros.length, 2);
  assert.equal(volta.camadas[1].opacidade, 40);
  assert.equal(volta.celula(volta.quadros[1].id, volta.camadas[1].id)[17], VERMELHO);
  assert.deepEqual(volta.paleta, [VERMELHO, AZUL]);
  assert.throws(() => desserializar({ formato: 'outro' }));
  assert.equal(nomeDeArquivo('Poção de Vida!', 'png'), 'pocao-de-vida.png');
});
