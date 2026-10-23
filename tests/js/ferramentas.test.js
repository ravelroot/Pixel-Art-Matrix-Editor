import test from 'node:test';
import assert from 'node:assert/strict';
import { empacotar, desempacotar, rgbParaOklch } from '../../editor/static/editor/js/nucleo/cores.js';
import { cantoEmL, pixelPerfect, linha } from '../../editor/static/editor/js/nucleo/geometria.js';
import { BAYER, limiarBayer, pixelDoPadrao, degradeLinear, degradeRadial, degrade } from '../../editor/static/editor/js/nucleo/pontilhado.js';
import {
  retanguloDe,
  recortarAoDocumento,
  contem,
  extrairRegiao,
  colarRegiao,
  indicesDe,
  limitesDoConteudo,
  deslocarComRepeticao,
} from '../../editor/static/editor/js/nucleo/selecao.js';
import { contorno, inverter, tonsDeCinza, converterParaPaleta, passoDeLuz, rampaDaPaleta, passoNaPaleta } from '../../editor/static/editor/js/nucleo/filtros.js';
import { Documento } from '../../editor/static/editor/js/nucleo/documento.js';
import { Traco, Historico } from '../../editor/static/editor/js/nucleo/historico.js';

const PRETO = empacotar(0, 0, 0);
const BRANCO = empacotar(255, 255, 255);
const VERMELHO = empacotar(255, 0, 0);
const AZUL = empacotar(0, 0, 255);

const matriz = (largura, altura, pontos, cor = PRETO) => {
  const px = new Uint32Array(largura * altura);
  for (const [x, y] of pontos) px[y * largura + x] = cor;
  return px;
};

test('bayer: matrizes 2, 4 e 8 são permutações de 0..n²-1', () => {
  for (const n of [2, 4, 8]) {
    const valores = BAYER[n].flat().sort((a, b) => a - b);
    assert.deepEqual(valores, Array.from({ length: n * n }, (_, i) => i));
  }
  assert.deepEqual(BAYER[4][0], [0, 8, 2, 10]);
  assert.ok(limiarBayer(0, 0, 4) > 0 && limiarBayer(0, 0, 4) < 1);
  assert.equal(limiarBayer(-1, -1, 4), limiarBayer(3, 3, 4), 'o padrão se repete também em coordenadas negativas');
});

test('pontilhado: a densidade controla a fração exata de pixels pintados', () => {
  for (const densidade of [0.125, 0.25, 0.5, 0.75, 0.875]) {
    let pintados = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (pixelDoPadrao(x, y, densidade, 4)) pintados++;
    assert.equal(pintados, Math.round(64 * densidade));
  }
  // 50% em Bayer 4×4 é um xadrez perfeito.
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.equal(pixelDoPadrao(x, y, 0.5, 4), (x + y) % 2 === 0);
});

test('degradê: projeção linear e distância radial ficam entre 0 e 1', () => {
  assert.equal(degradeLinear(0, 0, 0, 0, 10, 0), 0);
  assert.equal(degradeLinear(5, 3, 0, 0, 10, 0), 0.5);
  assert.equal(degradeLinear(20, 0, 0, 0, 10, 0), 1);
  assert.equal(degradeLinear(-4, 0, 0, 0, 10, 0), 0);
  assert.equal(degradeLinear(3, 3, 2, 2, 2, 2), 0);
  assert.equal(degradeRadial(5, 5, 5, 5, 9, 5), 0);
  assert.equal(degradeRadial(7, 5, 5, 5, 9, 5), 0.5);
  assert.equal(degradeRadial(50, 5, 5, 5, 9, 5), 1);
});

test('degradê: vai da cor inicial à final, só nos índices pedidos', () => {
  const pares = new Map(degrade(16, 1, { ax: 0, ay: 0, bx: 15, by: 0, inicio: PRETO, fim: BRANCO, matriz: 4 }));
  assert.equal(pares.get(0), PRETO);
  assert.equal(pares.get(15), BRANCO);
  const brancos = [...pares.values()].filter((c) => c === BRANCO).length;
  assert.ok(brancos > 4 && brancos < 12, 'metade do caminho fica pontilhada');
  const parcial = degrade(8, 8, { ax: 0, ay: 0, bx: 7, by: 7, inicio: PRETO, fim: BRANCO, indices: [0, 9, 63] });
  assert.deepEqual(parcial.map(([i]) => i), [0, 9, 63]);
});

test('pixel perfect: remove o pixel do meio dos cantos em L', () => {
  assert.equal(cantoEmL([0, 0], [1, 0], [1, 1]), true);
  assert.equal(cantoEmL([0, 0], [1, 0], [2, 0]), false);
  assert.equal(cantoEmL([0, 0], [1, 1], [2, 2]), false);
  const escada = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]];
  assert.deepEqual(pixelPerfect(escada), [[0, 0], [1, 1], [2, 2], [3, 2]]);
  const reta = [];
  linha(0, 0, 6, 0, (x, y) => reta.push([x, y]));
  assert.deepEqual(pixelPerfect(reta), reta, 'linha reta não muda');
  assert.deepEqual(pixelPerfect([[1, 1], [1, 1], [2, 1]]), [[1, 1], [2, 1]], 'pontos repetidos são ignorados');
});

test('seleção: retângulo normalizado, recortado e testado', () => {
  assert.deepEqual(retanguloDe(5, 6, 2, 1, 16, 16), { x: 2, y: 1, largura: 4, altura: 6 });
  assert.deepEqual(retanguloDe(-3, -3, 40, 2, 16, 16), { x: 0, y: 0, largura: 16, altura: 3 });
  assert.equal(retanguloDe(20, 20, 30, 30, 16, 16), null);
  assert.deepEqual(recortarAoDocumento({ x: 14, y: 14, largura: 5, altura: 5 }, 16, 16), { x: 14, y: 14, largura: 2, altura: 2 });
  const r = { x: 2, y: 2, largura: 3, altura: 3 };
  assert.equal(contem(r, 2, 2), true);
  assert.equal(contem(r, 5, 2), false);
  assert.equal(contem(null, 99, 99), true, 'sem seleção vale a matriz toda');
  assert.deepEqual([...indicesDe({ x: 1, y: 1, largura: 2, altura: 2 }, 4, 4)], [5, 6, 9, 10]);
});

test('seleção: copiar e colar uma região, recortando nas bordas', () => {
  const px = matriz(4, 4, [[1, 1], [2, 2]], VERMELHO);
  const regiao = extrairRegiao(px, 4, { x: 1, y: 1, largura: 2, altura: 2 });
  assert.deepEqual([...regiao.pixels], [VERMELHO, 0, 0, VERMELHO]);
  const destino = new Uint32Array(16).fill(AZUL);
  colarRegiao(regiao, 4, 4, 3, 3, (i, c) => (destino[i] = c));
  assert.equal(destino[15], VERMELHO, 'só o canto que cabe é colado');
  assert.equal(destino.filter((c) => c === VERMELHO).length, 1);
  const opacos = new Uint32Array(16).fill(AZUL);
  colarRegiao(regiao, 4, 4, 0, 0, (i, c) => (opacos[i] = c), { somenteOpacos: true });
  assert.equal(opacos[1], AZUL, 'transparente não apaga o que está embaixo');
  assert.equal(opacos[0], VERMELHO);
});

test('aparar: limites do conteúdo em várias células', () => {
  const a = matriz(8, 8, [[2, 3]]);
  const b = matriz(8, 8, [[5, 1]]);
  assert.deepEqual(limitesDoConteudo([a, b], 8, 8), { x: 2, y: 1, largura: 4, altura: 3 });
  assert.equal(limitesDoConteudo([new Uint32Array(64)], 8, 8), null);
});

test('documento: recortar mantém os pixels de todas as camadas e quadros', () => {
  const doc = new Documento(8, 8);
  doc.adicionarCamada('Cima');
  doc.adicionarQuadro();
  const [q1, q2] = doc.quadros;
  const [c1, c2] = doc.camadas;
  doc.celula(q1.id, c1.id)[3 * 8 + 4] = VERMELHO;
  doc.celula(q2.id, c2.id)[5 * 8 + 6] = AZUL;
  doc.recortar(4, 3, 3, 3);
  assert.equal(doc.largura, 3);
  assert.equal(doc.altura, 3);
  assert.equal(doc.celula(q1.id, c1.id)[0], VERMELHO);
  assert.equal(doc.celula(q2.id, c2.id)[2 * 3 + 2], AZUL);
  assert.throws(() => doc.recortar(0, 0, 0, 3));
});

test('ladrilho: deslocar com repetição é reversível', () => {
  const px = matriz(5, 3, [[0, 0], [4, 2]]);
  const meio = deslocarComRepeticao(px, 5, 3, 2, 1);
  assert.equal(meio[1 * 5 + 2], PRETO);
  assert.equal(meio[0 * 5 + 1], PRETO, 'o que sai pela direita/baixo entra pela esquerda/cima');
  assert.deepEqual([...deslocarComRepeticao(meio, 5, 3, -2, -1)], [...px]);
});

test('contorno: 4 e 8 vizinhos em volta de um pixel', () => {
  const px = matriz(5, 5, [[2, 2]]);
  assert.equal(contorno(px, 5, 5, VERMELHO, { vizinhos: 4 }).length, 4);
  assert.equal(contorno(px, 5, 5, VERMELHO, { vizinhos: 8 }).length, 8);
  const soDireita = contorno(px, 5, 5, VERMELHO, { vizinhos: 8, filtro: (i) => i % 5 === 3 });
  assert.equal(soDireita.length, 3);
  assert.ok(soDireita.every(([, c]) => c === VERMELHO));
});

test('filtros: inverter, tons de cinza e conversão para a paleta preservam o alfa', () => {
  const semi = empacotar(255, 0, 0, 128);
  const px = Uint32Array.from([semi, 0, BRANCO]);
  const invertidos = new Map(inverter(px));
  assert.deepEqual(desempacotar(invertidos.get(0)), [0, 255, 255, 128]);
  assert.equal(invertidos.has(1), false, 'transparente fica como está');
  assert.equal(invertidos.get(2), PRETO);
  const cinza = new Map(tonsDeCinza(px));
  const [r, g, b, a] = desempacotar(cinza.get(0));
  assert.ok(r === g && g === b && a === 128);
  const convertidos = new Map(converterParaPaleta(Uint32Array.from([empacotar(250, 10, 10), empacotar(20, 20, 240, 77)]), ['#ff0000', '#0000ff', '#ffffff']));
  assert.equal(convertidos.get(0), VERMELHO);
  assert.deepEqual(desempacotar(convertidos.get(1)), [0, 0, 255, 77]);
  assert.deepEqual(converterParaPaleta(Uint32Array.from([VERMELHO]), []), []);
});

test('clarear e escurecer: luminosidade OKLCH e rampa da paleta', () => {
  const base = empacotar(120, 60, 40);
  const [r, g, b] = desempacotar(base);
  const L = rgbParaOklch(r, g, b)[0];
  const clara = desempacotar(passoDeLuz(base, 0.1));
  const escura = desempacotar(passoDeLuz(base, -0.1));
  assert.ok(rgbParaOklch(...clara.slice(0, 3))[0] > L);
  assert.ok(rgbParaOklch(...escura.slice(0, 3))[0] < L);
  assert.equal(passoDeLuz(0, 0.2), 0, 'transparente não muda');
  const rampa = rampaDaPaleta(['#ffffff', '#000000', '#808080', '#808080']);
  assert.equal(rampa.length, 3, 'cores repetidas entram uma vez');
  assert.equal(passoNaPaleta(PRETO, rampa, 1), empacotar(128, 128, 128));
  assert.equal(passoNaPaleta(BRANCO, rampa, 1), BRANCO, 'no topo da rampa não passa do limite');
  assert.equal(passoNaPaleta(empacotar(10, 10, 10), rampa, 1), PRETO, 'cor fora da paleta vai para a mais próxima');
});

test('histórico: mover pixels com o traço vira um único passo desfazível', () => {
  const doc = new Documento(4, 4);
  const [q] = doc.quadros;
  const [c] = doc.camadas;
  const px = doc.celula(q.id, c.id);
  px[0] = VERMELHO;
  const h = new Historico();
  const traco = new Traco(doc.chave(q.id, c.id), px);
  const regiao = extrairRegiao(px, 4, { x: 0, y: 0, largura: 1, altura: 1 });
  for (const dx of [1, 2, 3]) {
    traco.desfazerVisual();
    traco.pintar(0, 0);
    colarRegiao(regiao, 4, 4, dx, 0, (i, cor) => traco.pintar(i, cor), { somenteOpacos: true });
  }
  h.registrar(traco.concluir('Mover pixels'));
  assert.equal(px[3], VERMELHO);
  assert.equal(px[0], 0);
  assert.equal(px[1], 0, 'posições intermediárias não deixam rastro');
  h.desfazer(doc);
  assert.equal(px[0], VERMELHO);
  assert.equal(px[3], 0);
});
