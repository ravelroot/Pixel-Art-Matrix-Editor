import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { empacotar, hexParaCor } from '../../editor/static/editor/js/nucleo/cores.js';
import { montarMatrizes, gerarDados, layoutFolha, escalarVizinho, identificador, achatarFundo, metadadosFolha } from '../../editor/static/editor/js/nucleo/exportar.js';
import { importarPaleta, exportarPaleta, PALETAS_PREDEFINIDAS, extrairPaleta } from '../../editor/static/editor/js/nucleo/paletas.js';
import { desserializar } from '../../editor/static/editor/js/nucleo/formato.js';

const V = empacotar(255, 0, 0);
const A = empacotar(0, 0, 255);
const quadro = Uint32Array.from([V, 0, A, V]);

test('exportar: matriz de índices e de cores', () => {
  const i = montarMatrizes([quadro], 2, 2);
  assert.deepEqual(i.paleta, ['#ff0000', '#0000ff']);
  assert.deepEqual(i.quadros[0], [[0, -1], [1, 0]]);
  const h = montarMatrizes([quadro], 2, 2, { modo: 'hex' });
  assert.deepEqual(h.quadros[0], [['#ff0000', null], ['#0000ff', '#ff0000']]);
  const p = montarMatrizes([quadro], 2, 2, { paleta: [A, V] });
  assert.deepEqual(p.quadros[0], [[1, -1], [0, 1]]);
});

test('exportar: cada formato gera código válido', () => {
  const dados = montarMatrizes([quadro, quadro], 2, 2);
  const json = JSON.parse(gerarDados('json', dados, 'Poção Azul'));
  assert.equal(json.quadros.length, 2);
  assert.equal(json.transparente, -1);
  assert.equal(gerarDados('csv', dados, 'x').split('\n')[0], '0,-1');
  const js = gerarDados('js', dados, 'Poção Azul');
  assert.match(js, /^export const pocaoAzul = \{/);
  const modulo = new Function(js.replace('export const', 'return'))();
  assert.deepEqual(modulo.quadros[1][1], [1, 0]);
  assert.match(gerarDados('py', dados, 'Poção Azul'), /^POCAO_AZUL = \{/);
  const c = gerarDados('c', dados, 'Poção Azul');
  assert.match(c, /static const int16_t pocao_azul_pixels\[POCAO_AZUL_QUADROS\]\[POCAO_AZUL_ALTURA\]\[POCAO_AZUL_LARGURA\]/);
  assert.match(c, /0xFF0000FF/);
  const java = gerarDados('java', montarMatrizes([quadro], 2, 2, { modo: 'hex' }), '1 espada');
  assert.match(java, /public final class Sprite1Espada/);
  assert.match(java, /0xFFFF0000/);
  assert.equal(identificador('ação rápida', 'cobra'), 'acao_rapida');
});

test('exportar: sprite sheet e escala', () => {
  const h = layoutFolha(5, 16, 16, { disposicao: 'horizontal', espacamento: 2 });
  assert.equal(h.largura, 5 * 16 + 4 * 2);
  assert.equal(h.altura, 16);
  const g = layoutFolha(5, 8, 8, { disposicao: 'grade', colunas: 2, margem: 1 });
  assert.deepEqual([g.colunas, g.linhas, g.largura, g.altura], [2, 3, 18, 26]);
  assert.deepEqual(g.posicoes[3], { x: 9, y: 9, largura: 8, altura: 8 });
  const v = layoutFolha(3, 4, 4, { disposicao: 'vertical' });
  assert.deepEqual([v.largura, v.altura], [4, 12]);
  const e = escalarVizinho(quadro, 2, 2, 3);
  assert.equal(e.length, 36);
  assert.equal(e[0], V);
  assert.equal(e[3], 0);
  assert.equal(e[6 * 3 + 2], A);
  assert.equal(e[6 * 3 + 4], V);
  assert.equal(achatarFundo(Uint32Array.from([0]), hexParaCor('#ffffff'))[0], hexParaCor('#ffffff'));
  assert.equal(metadadosFolha('x', v, [{ duracao: 50 }], 10).quadros[1].duracao, 100);
});

test('paletas: predefinidas, importação e exportação', () => {
  const nomes = PALETAS_PREDEFINIDAS.map((p) => p.slug);
  for (const s of ['crivo', 'game-boy', 'nes', 'pico-8', 'cga']) assert.ok(nomes.includes(s));
  assert.equal(PALETAS_PREDEFINIDAS.find((p) => p.slug === 'pico-8').cores.length, 16);
  assert.equal(new Set(PALETAS_PREDEFINIDAS.find((p) => p.slug === 'nes').cores).size, 55);
  const gpl = 'GIMP Palette\nName: Teste\nColumns: 4\n#\n255   0   0\tVermelho\n  0   0 255\tAzul\n';
  assert.deepEqual(importarPaleta(gpl, 'teste.gpl'), { nome: 'Teste', cores: [V, A] });
  assert.deepEqual(importarPaleta('ff0000\n0000ff\n', 'lospec.hex').cores, [V, A]);
  assert.deepEqual(importarPaleta('; paint.net\nFFFF0000\n', 'pdn.txt').cores, [V]);
  assert.equal(importarPaleta('{"nome":"J","cores":["#f00"]}', 'p.json').nome, 'J');
  assert.throws(() => importarPaleta('nada aqui', 'x.txt'));
  const ida = exportarPaleta({ nome: 'Ida', cores: [V, A] }, 'gpl');
  assert.deepEqual(importarPaleta(ida, 'ida.gpl').cores, [V, A]);
  assert.equal(exportarPaleta({ nome: 'x', cores: [V] }, 'hex'), 'ff0000\n');
  assert.deepEqual(extrairPaleta(Uint32Array.from([A, V, V, 0])), [V, A]);
});

test('exemplos: os arquivos .crivo abrem sem erro', () => {
  for (const nome of ['pocao.crivo', 'coracao.crivo', 'gosma-game-boy.crivo']) {
    const doc = desserializar(readFileSync(new URL(`../../exemplos/${nome}`, import.meta.url), 'utf8'));
    assert.equal(doc.largura, 16);
    assert.ok(doc.quadros.length >= 2);
    assert.ok(doc.compor(0).some((c) => c !== 0));
  }
});
