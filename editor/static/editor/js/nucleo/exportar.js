import { corParaHex, desempacotar } from './cores.js';

export const FORMATOS_DADOS = {
  json: { nome: 'JSON', extensao: 'json' },
  csv: { nome: 'CSV', extensao: 'csv' },
  js: { nome: 'JavaScript', extensao: 'js' },
  py: { nome: 'Python', extensao: 'py' },
  c: { nome: 'C', extensao: 'h' },
  java: { nome: 'Java', extensao: 'java' },
};

export function identificador(nome, estilo = 'camelo') {
  const partes = String(nome || 'sprite')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  if (!partes.length) partes.push('sprite');
  if (/^[0-9]/.test(partes[0])) partes.unshift('sprite');
  if (estilo === 'cobra') return partes.join('_');
  if (estilo === 'constante') return partes.join('_').toUpperCase();
  const cap = partes.map((p) => p[0].toUpperCase() + p.slice(1));
  if (estilo === 'pascal') return cap.join('');
  return partes[0] + cap.slice(1).join('');
}

export function montarMatrizes(quadros, largura, altura, { modo = 'indices', paleta = null } = {}) {
  const ordem = new Map();
  if (paleta) for (const c of paleta) if (c >>> 24 && !ordem.has(c)) ordem.set(c, ordem.size);
  if (modo === 'indices') {
    for (const px of quadros) for (const c of px) if (c >>> 24 && !ordem.has(c)) ordem.set(c, ordem.size);
  }
  const matrizes = quadros.map((px) => {
    const linhas = [];
    for (let y = 0; y < altura; y++) {
      const linha = [];
      for (let x = 0; x < largura; x++) {
        const c = px[y * largura + x];
        if (modo === 'indices') linha.push(c >>> 24 ? ordem.get(c) : -1);
        else linha.push(c >>> 24 ? corParaHex(c) : null);
      }
      linhas.push(linha);
    }
    return linhas;
  });
  return { largura, altura, modo, paleta: [...ordem.keys()].map((c) => corParaHex(c)), quadros: matrizes };
}

const valorTexto = (v, aspas = '"', nulo = 'null') => (v === null ? nulo : typeof v === 'string' ? aspas + v + aspas : String(v));

function blocoLinhas(matriz, recuo, abre, fecha, aspas, nulo, largura = 0) {
  return matriz
    .map((linha) => recuo + abre + linha.map((v) => valorTexto(v, aspas, nulo).padStart(largura)).join(', ') + fecha)
    .join(',\n');
}

function larguraValores(dados) {
  if (dados.modo !== 'indices') return 0;
  let m = 1;
  for (const q of dados.quadros) for (const l of q) for (const v of l) m = Math.max(m, String(v).length);
  return m;
}

export function gerarJSON(dados, nome) {
  const w = larguraValores(dados);
  const quadros = dados.quadros
    .map((q) => '    [\n' + blocoLinhas(q, '      ', '[', ']', '"', 'null', w) + '\n    ]')
    .join(',\n');
  return (
    '{\n' +
    `  "nome": ${JSON.stringify(nome)},\n` +
    `  "largura": ${dados.largura},\n` +
    `  "altura": ${dados.altura},\n` +
    `  "modo": ${JSON.stringify(dados.modo)},\n` +
    (dados.modo === 'indices' ? '  "transparente": -1,\n' : '') +
    `  "paleta": ${JSON.stringify(dados.paleta)},\n` +
    '  "quadros": [\n' +
    quadros +
    '\n  ]\n}\n'
  );
}

export function gerarCSV(dados) {
  return (
    dados.quadros
      .map((q) => q.map((linha) => linha.map((v) => (v === null ? '' : String(v))).join(',')).join('\n'))
      .join('\n\n') + '\n'
  );
}

export function gerarJS(dados, nome) {
  const id = identificador(nome);
  const w = larguraValores(dados);
  const quadros = dados.quadros.map((q) => '    [\n' + blocoLinhas(q, '      ', '[', ']', "'", 'null', w) + ',\n    ]').join(',\n');
  return (
    `export const ${id} = {\n` +
    `  largura: ${dados.largura},\n` +
    `  altura: ${dados.altura},\n` +
    (dados.modo === 'indices' ? '  transparente: -1,\n' : '') +
    `  paleta: [${dados.paleta.map((c) => `'${c}'`).join(', ')}],\n` +
    '  quadros: [\n' +
    quadros +
    ',\n  ],\n};\n'
  );
}

export function gerarPython(dados, nome) {
  const id = identificador(nome, 'constante');
  const w = larguraValores(dados);
  const quadros = dados.quadros.map((q) => '        [\n' + blocoLinhas(q, '            ', '[', ']', '"', 'None', w) + ',\n        ]').join(',\n');
  return (
    `${id} = {\n` +
    `    "largura": ${dados.largura},\n` +
    `    "altura": ${dados.altura},\n` +
    (dados.modo === 'indices' ? '    "transparente": -1,\n' : '') +
    `    "paleta": [${dados.paleta.map((c) => `"${c}"`).join(', ')}],\n` +
    '    "quadros": [\n' +
    quadros +
    ',\n    ],\n}\n'
  );
}

function hexParaInteiro(hex, ordem) {
  const h = hex.replace('#', '');
  const rgb = h.slice(0, 6).toUpperCase();
  const a = (h.length === 8 ? h.slice(6, 8) : 'FF').toUpperCase();
  return ordem === 'argb' ? '0x' + a + rgb : '0x' + rgb + a;
}

export function gerarC(dados, nome) {
  const id = identificador(nome, 'cobra');
  const ID = id.toUpperCase();
  const tipo = dados.modo === 'indices' ? 'int16_t' : 'uint32_t';
  const converter = (v) => (dados.modo === 'indices' ? v : v === null ? '0x00000000' : hexParaInteiro(v, 'rgba'));
  const w = dados.modo === 'indices' ? larguraValores(dados) : 10;
  const quadros = dados.quadros
    .map((q) => '    {\n' + q.map((l) => '        {' + l.map((v) => String(converter(v)).padStart(w)).join(', ') + '}').join(',\n') + '\n    }')
    .join(',\n');
  const paleta = dados.paleta.length ? dados.paleta.map((c) => hexParaInteiro(c, 'rgba')).join(', ') : '0x00000000';
  return (
    `#ifndef ${ID}_H\n#define ${ID}_H\n\n#include <stdint.h>\n\n` +
    `#define ${ID}_LARGURA ${dados.largura}\n#define ${ID}_ALTURA ${dados.altura}\n#define ${ID}_QUADROS ${dados.quadros.length}\n` +
    `#define ${ID}_CORES ${dados.paleta.length}\n\n` +
    `static const uint32_t ${id}_paleta[${Math.max(1, dados.paleta.length)}] = {${paleta}};\n\n` +
    `static const ${tipo} ${id}_pixels[${ID}_QUADROS][${ID}_ALTURA][${ID}_LARGURA] = {\n` +
    quadros +
    `\n};\n\n#endif\n`
  );
}

export function gerarJava(dados, nome) {
  const classe = identificador(nome, 'pascal');
  const converter = (v) => (dados.modo === 'indices' ? v : v === null ? '0x00000000' : hexParaInteiro(v, 'argb'));
  const w = dados.modo === 'indices' ? larguraValores(dados) : 10;
  const quadros = dados.quadros
    .map((q) => '        {\n' + q.map((l) => '            {' + l.map((v) => String(converter(v)).padStart(w)).join(', ') + '}').join(',\n') + '\n        }')
    .join(',\n');
  return (
    `public final class ${classe} {\n\n` +
    `    public static final int LARGURA = ${dados.largura};\n` +
    `    public static final int ALTURA = ${dados.altura};\n` +
    (dados.modo === 'indices' ? '    public static final int TRANSPARENTE = -1;\n' : '') +
    `\n    public static final int[] PALETA = {${dados.paleta.map((c) => hexParaInteiro(c, 'argb')).join(', ')}};\n\n` +
    `    public static final int[][][] QUADROS = {\n` +
    quadros +
    `\n    };\n\n    private ${classe}() {\n    }\n}\n`
  );
}

export function gerarDados(formato, dados, nome) {
  switch (formato) {
    case 'json':
      return gerarJSON(dados, nome);
    case 'csv':
      return gerarCSV(dados);
    case 'js':
      return gerarJS(dados, nome);
    case 'py':
      return gerarPython(dados, nome);
    case 'c':
      return gerarC(dados, nome);
    case 'java':
      return gerarJava(dados, nome);
    default:
      throw new Error('Formato desconhecido: ' + formato);
  }
}

export function layoutFolha(quantidade, largura, altura, { disposicao = 'horizontal', colunas = 4, espacamento = 0, margem = 0 } = {}) {
  let cols;
  if (disposicao === 'horizontal') cols = quantidade;
  else if (disposicao === 'vertical') cols = 1;
  else cols = Math.max(1, Math.min(quantidade, Math.round(colunas) || 1));
  const linhas = Math.ceil(quantidade / cols);
  const posicoes = [];
  for (let i = 0; i < quantidade; i++) {
    const c = i % cols;
    const l = Math.floor(i / cols);
    posicoes.push({ x: margem + c * (largura + espacamento), y: margem + l * (altura + espacamento), largura, altura });
  }
  return {
    colunas: cols,
    linhas,
    largura: margem * 2 + cols * largura + (cols - 1) * espacamento,
    altura: margem * 2 + linhas * altura + (linhas - 1) * espacamento,
    posicoes,
  };
}

export function escalarVizinho(pixels, largura, altura, fator) {
  fator = Math.max(1, Math.floor(fator));
  if (fator === 1) return pixels.slice();
  const L = largura * fator;
  const saida = new Uint32Array(L * altura * fator);
  for (let y = 0; y < altura; y++) {
    const linha = new Uint32Array(L);
    for (let x = 0; x < largura; x++) linha.fill(pixels[y * largura + x], x * fator, (x + 1) * fator);
    for (let k = 0; k < fator; k++) saida.set(linha, (y * fator + k) * L);
  }
  return saida;
}

export function colar(destino, larguraDestino, origem, larguraOrigem, alturaOrigem, x0, y0) {
  for (let y = 0; y < alturaOrigem; y++) {
    destino.set(origem.subarray(y * larguraOrigem, (y + 1) * larguraOrigem), (y0 + y) * larguraDestino + x0);
  }
}

export function achatarFundo(pixels, fundo) {
  const [fr, fg, fb] = desempacotar(fundo);
  const saida = new Uint32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    const a = (c >>> 24) / 255;
    const r = Math.round((c & 255) * a + fr * (1 - a));
    const g = Math.round(((c >>> 8) & 255) * a + fg * (1 - a));
    const b = Math.round(((c >>> 16) & 255) * a + fb * (1 - a));
    saida[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return saida;
}

export function metadadosFolha(nome, layout, quadros, fps) {
  return {
    nome,
    imagem: nome + '.png',
    largura: layout.largura,
    altura: layout.altura,
    fps,
    quadros: layout.posicoes.map((p, i) => ({
      indice: i,
      x: p.x,
      y: p.y,
      largura: p.largura,
      altura: p.altura,
      duracao: quadros[i]?.duracao ?? Math.round(1000 / fps),
    })),
  };
}
