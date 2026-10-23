// Gera o Crivo.html: o editor inteiro num único arquivo que abre com dois cliques,
// direto de uma pasta (file://), sem servidor local e sem backend.
//
//   npm run portatil               gera ou atualiza o Crivo.html na raiz do repositório
//   npm run portatil -- --verificar  só confere se o Crivo.html está em dia com o código (usado no CI)
//
// Por que precisa disso: o editor é escrito em módulos ES, e o navegador recusa carregar
// módulos de arquivos abertos do disco. Este script junta os módulos num script comum, embute
// o CSS e o ícone e protege o resultado com uma Content-Security-Policy por hash.
// Não usa bibliotecas: os módulos do Crivo só usam `import { ... } from './arquivo.js'` e
// `export function|class|const`, e qualquer outra forma faz o script parar com erro.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EDITOR = join(RAIZ, 'editor', 'static', 'editor');
const DESTINO = join(RAIZ, 'Crivo.html');
const ENTRADA = 'js/main.js';

const IMPORTACAO = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2[ \t]*;?[ \t]*$/gm;
const EXPORTACAO = /^([ \t]*)export\s+(?=(?:async\s+)?(?:function\b|class\b|const\b|let\b|var\b))/gm;
const NOME_EXPORTADO = /^[ \t]*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const NAO_SUPORTADO = /^[ \t]*(?:import\b(?!\s*\()|export\b)|\bimport\s*\(|\bimport\.meta\b/m;

const lf = (texto) => texto.replace(/\r\n?/g, '\n');
const ler = async (caminho, codificacao = 'utf8') => readFile(join(EDITOR, caminho), codificacao);

function resolverImportacao(origem, especificador) {
  if (!especificador.startsWith('./') && !especificador.startsWith('../')) {
    throw new Error(`${origem}: só importações relativas são aceitas (encontrado "${especificador}").`);
  }
  const alvo = posix.normalize(posix.join(posix.dirname(origem), especificador));
  if (alvo.startsWith('..')) throw new Error(`${origem}: "${especificador}" sai da pasta do editor.`);
  return alvo;
}

function transformar(id, codigo) {
  const dependencias = [];
  const nomes = [...codigo.matchAll(NOME_EXPORTADO)].map((m) => m[1]);
  let corpo = codigo.replace(IMPORTACAO, (_, lista, _aspas, especificador) => {
    const alvo = resolverImportacao(id, especificador);
    dependencias.push(alvo);
    const campos = lista
      .split(',')
      .map((parte) => parte.trim())
      .filter(Boolean)
      .map((parte) => {
        const [original, apelido] = parte.split(/\s+as\s+/);
        return apelido ? `${original}: ${apelido}` : original;
      });
    return `const { ${campos.join(', ')} } = modulos[${JSON.stringify(alvo)}];`;
  });
  corpo = corpo.replace(EXPORTACAO, '$1');
  const sobra = corpo.match(NAO_SUPORTADO);
  if (sobra) throw new Error(`${id}: forma de import/export não suportada: "${sobra[0].trim()}".`);
  const fonte = `modulos[${JSON.stringify(id)}] = (() => {\n${corpo.trimEnd()}\nreturn { ${nomes.join(', ')} };\n})();\n`;
  return { dependencias, fonte };
}

async function empacotar() {
  const modulos = new Map();
  const ordem = [];
  const visitando = [];

  async function visitar(id) {
    if (modulos.has(id)) return;
    if (visitando.includes(id)) {
      throw new Error(`Importação circular: ${[...visitando.slice(visitando.indexOf(id)), id].join(' -> ')}`);
    }
    visitando.push(id);
    const { dependencias, fonte } = transformar(id, lf(await ler(id)));
    for (const dependencia of dependencias) await visitar(dependencia);
    visitando.pop();
    modulos.set(id, fonte);
    ordem.push(id);
  }

  await visitar(ENTRADA);
  const partes = ordem.map((id) => `// ${id}\n${modulos.get(id)}`);
  const script = `\n(() => {\n'use strict';\nconst modulos = Object.create(null);\n\n${partes.join('\n')}})();\n`;
  // Dentro de um <script> embutido, "</script" encerraria o bloco antes da hora.
  return { script: script.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'), quantidade: ordem.length };
}

export async function gerar() {
  const [html, css, icone, versao] = await Promise.all([
    ler('index.html').then(lf),
    ler('css/crivo.css').then(lf),
    ler('img/favicon.svg', null),
    readFile(join(RAIZ, 'VERSION'), 'utf8').then((v) => v.trim()),
  ]);
  const { script, quantidade } = await empacotar();
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  const politica = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const trocas = [
    [/[ \t]*<base href="\.\/">\n/, ''],
    [
      /<link rel="icon" href="img\/favicon\.svg" type="image\/svg\+xml">/,
      `<link rel="icon" href="data:image/svg+xml;base64,${icone.toString('base64')}" type="image/svg+xml">`,
    ],
    [/<link rel="stylesheet" href="css\/crivo\.css">/, () => `<style>\n${css.trimEnd()}\n    </style>`],
    [/[ \t]*<script type="module" src="js\/main\.js"><\/script>\n/, ''],
    [
      /<meta charset="utf-8">/,
      `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${politica}">`,
    ],
    [/<\/body>/, () => `  <script>${script}</script>\n  </body>`],
  ];
  let saida = html;
  for (const [padrao, troca] of trocas) {
    if (!padrao.test(saida)) throw new Error(`index.html mudou e o gerador não encontrou: ${padrao}`);
    saida = saida.replace(padrao, troca);
  }
  const aviso =
    `<!--\n  Crivo ${versao}, versão em arquivo único: abra com dois cliques, sem servidor e sem backend.\n` +
    `  Arquivo gerado por scripts/gerar-portatil.js a partir de editor/static/editor/ (${quantidade} módulos).\n` +
    `  Não edite à mão: altere o código do editor e rode "npm run portatil".\n-->\n`;
  saida = saida.replace(/^<!doctype html>\n/i, (inicio) => inicio + aviso);
  return saida;
}

async function principal() {
  const verificar = process.argv.includes('--verificar');
  const novo = await gerar();
  if (verificar) {
    const atual = await readFile(DESTINO, 'utf8').catch(() => '');
    if (lf(atual) !== novo) {
      console.error('O Crivo.html está desatualizado em relação ao código do editor. Rode "npm run portatil" e faça o commit.');
      process.exit(1);
    }
    console.log('Crivo.html em dia com o código do editor.');
    return;
  }
  await writeFile(DESTINO, novo, 'utf8');
  console.log(`Crivo.html gerado (${(Buffer.byteLength(novo) / 1024).toFixed(0)} KB). Abra com dois cliques, sem servidor.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}
