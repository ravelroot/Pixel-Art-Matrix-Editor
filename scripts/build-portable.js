// Builds Crivo.html: the whole editor in a single file that opens with a double click,
// straight from a folder (file://), with no local server and no backend.
//
//   npm run portable               builds or updates Crivo.html at the repository root
//   npm run portable -- --check    only checks that Crivo.html is up to date with the code (used in CI)
//
// Why this is needed: the editor is written as ES modules, and browsers refuse to load
// modules from files opened from disk. This script joins the modules into a classic script, embeds
// the CSS and the icon, and protects the result with a hash-based Content-Security-Policy.
// No libraries: Crivo modules only use `import { ... } from './file.js'` and
// `export function|class|const`, and any other form makes the script stop with an error.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EDITOR = join(ROOT, 'editor', 'static', 'editor');
const DEST = join(ROOT, 'Crivo.html');
const ENTRY = 'js/main.js';

const IMPORT_RE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2[ \t]*;?[ \t]*$/gm;
const EXPORT_RE = /^([ \t]*)export\s+(?=(?:async\s+)?(?:function\b|class\b|const\b|let\b|var\b))/gm;
const EXPORTED_NAME = /^[ \t]*export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const UNSUPPORTED = /^[ \t]*(?:import\b(?!\s*\()|export\b)|\bimport\s*\(|\bimport\.meta\b/m;

const lf = (text) => text.replace(/\r\n?/g, '\n');
const read = async (path, encoding = 'utf8') => readFile(join(EDITOR, path), encoding);

function resolveImport(origin, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw new Error(`${origin}: only relative imports are accepted (found "${specifier}").`);
  }
  const target = posix.normalize(posix.join(posix.dirname(origin), specifier));
  if (target.startsWith('..')) throw new Error(`${origin}: "${specifier}" leaves the editor folder.`);
  return target;
}

function transform(id, code) {
  const dependencies = [];
  const names = [...code.matchAll(EXPORTED_NAME)].map((m) => m[1]);
  let body = code.replace(IMPORT_RE, (_, list, _quotes, specifier) => {
    const target = resolveImport(id, specifier);
    dependencies.push(target);
    const fields = list
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [original, alias] = part.split(/\s+as\s+/);
        return alias ? `${original}: ${alias}` : original;
      });
    return `const { ${fields.join(', ')} } = modules[${JSON.stringify(target)}];`;
  });
  body = body.replace(EXPORT_RE, '$1');
  const leftover = body.match(UNSUPPORTED);
  if (leftover) throw new Error(`${id}: unsupported import/export form: "${leftover[0].trim()}".`);
  const source = `modules[${JSON.stringify(id)}] = (() => {\n${body.trimEnd()}\nreturn { ${names.join(', ')} };\n})();\n`;
  return { dependencies, source };
}

async function pack() {
  const modules = new Map();
  const order = [];
  const visiting = [];

  async function visit(id) {
    if (modules.has(id)) return;
    if (visiting.includes(id)) {
      throw new Error(`Circular import: ${[...visiting.slice(visiting.indexOf(id)), id].join(' -> ')}`);
    }
    visiting.push(id);
    const { dependencies, source } = transform(id, lf(await read(id)));
    for (const dependency of dependencies) await visit(dependency);
    visiting.pop();
    modules.set(id, source);
    order.push(id);
  }

  await visit(ENTRY);
  const parts = order.map((id) => `// ${id}\n${modules.get(id)}`);
  const script = `\n(() => {\n'use strict';\nconst modules = Object.create(null);\n\n${parts.join('\n')}})();\n`;
  // Inside an inline <script>, "</script" would end the block too early.
  return { script: script.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'), count: order.length };
}

export async function generate() {
  const [html, css, icon, version] = await Promise.all([
    read('index.html').then(lf),
    read('css/crivo.css').then(lf),
    read('img/favicon.svg', null),
    readFile(join(ROOT, 'VERSION'), 'utf8').then((v) => v.trim()),
  ]);
  const { script, count } = await pack();
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const replacements = [
    [/[ \t]*<base href="\.\/">\n/, ''],
    [
      /<link rel="icon" href="img\/favicon\.svg" type="image\/svg\+xml">/,
      `<link rel="icon" href="data:image/svg+xml;base64,${icon.toString('base64')}" type="image/svg+xml">`,
    ],
    [/<link rel="stylesheet" href="css\/crivo\.css">/, () => `<style>\n${css.trimEnd()}\n    </style>`],
    [/[ \t]*<script type="module" src="js\/main\.js"><\/script>\n/, ''],
    [
      /<meta charset="utf-8">/,
      `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`,
    ],
    [/<\/body>/, () => `  <script>${script}</script>\n  </body>`],
  ];
  let output = html;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(output)) throw new Error(`index.html changed and the generator did not find: ${pattern}`);
    output = output.replace(pattern, replacement);
  }
  const header =
    `<!--\n  Crivo ${version}, single-file version: open it with a double click, no server and no backend.\n` +
    `  Generated by scripts/build-portable.js from editor/static/editor/ (${count} modules).\n` +
    `  Do not edit by hand: change the editor code and run "npm run portable".\n-->\n`;
  output = output.replace(/^<!doctype html>\n/i, (start) => start + header);
  return output;
}

async function main() {
  const check = process.argv.includes('--check');
  const html = await generate();
  if (check) {
    const current = await readFile(DEST, 'utf8').catch(() => '');
    if (lf(current) !== html) {
      console.error('Crivo.html is out of date with the editor code. Run "npm run portable" and commit it.');
      process.exit(1);
    }
    console.log('Crivo.html is up to date with the editor code.');
    return;
  }
  await writeFile(DEST, html, 'utf8');
  console.log(`Crivo.html generated (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB). Open it with a double click, no server needed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
