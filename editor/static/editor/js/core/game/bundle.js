import { gameEngine } from './engine.js';
import { gameAudio } from './audio.js';
import { gameScript } from './script.js';

const STYLE = [
  'html,body{margin:0;height:100%;background:#1d1613;color:#efe6d8;font:14px system-ui,sans-serif}',
  'body{display:grid;place-items:center;overflow:hidden}',
  '#palco{position:fixed;inset:0;display:grid;place-items:center}',
  'canvas{image-rendering:pixelated;image-rendering:crisp-edges;box-shadow:0 10px 40px rgba(0,0,0,.5)}',
  '.toque{position:fixed;inset:auto 0 0 0;height:42vh;pointer-events:none;user-select:none;-webkit-user-select:none}',
  '.toque button{position:absolute;pointer-events:auto;width:64px;height:64px;border-radius:50%;border:2px solid rgba(250,246,239,.5);background:rgba(43,29,23,.45);color:#faf6ef;font:700 22px system-ui;touch-action:none}',
  '.toque-esq{left:16px;bottom:56px}.toque-dir{left:96px;bottom:56px}.toque-cima{left:56px;bottom:124px;width:56px!important;height:56px!important}.toque-baixo{left:56px;bottom:0;width:56px!important;height:48px!important}',
  '.toque-a{right:16px;bottom:72px}.toque-b{right:96px;bottom:40px}.toque-c{right:176px;bottom:24px;width:52px!important;height:52px!important}.toque-start{right:16px;top:-24px;width:44px!important;height:44px!important;font-size:18px!important}',
  '@media (pointer:fine){.toque{display:none}}',
].join('');

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function runtimeScript(compiled, player) {
  const source = [
    "'use strict';",
    `const gameEngine = ${gameEngine.toString()};`,
    `const gameAudio = ${gameAudio.toString()};`,
    `const gameScript = ${gameScript.toString()};`,
    `const gamePlayer = ${player.toString()};`,
    `const data = ${safeJson(compiled)};`,
    "const canvas = document.getElementById('tela');",
    "const onLog = (entry) => (entry.kind === 'error' ? console.warn : console.info)(entry.text);",
    "gamePlayer().play({ engine: gameEngine(), audio: gameAudio(), script: gameScript(), onLog, data, canvas, host: document.getElementById('palco'), touch: true });",
  ].join('\n');
  return `\n(() => {\n${source}\n})();\n`.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

export async function gameHtml(compiled, player) {
  const script = runtimeScript(compiled, player);
  const hash = await sha256(script);
  const policy = ["default-src 'none'", `script-src 'sha256-${hash}'`, "style-src 'unsafe-inline'", 'img-src data: blob:', "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '  <head>',
    '    <meta charset="utf-8">',
    `    <meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">',
    `    <title>${escapeHtml(compiled.name || 'Jogo')}</title>`,
    `    <meta name="generator" content="Crivo">`,
    `    <style>${STYLE}</style>`,
    '  </head>',
    '  <body>',
    '    <div id="palco"><canvas id="tela" aria-label="Jogo"></canvas></div>',
    `    <script>${script}</script>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}
