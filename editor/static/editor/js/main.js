import { serialize, deserialize, fileNameFor } from './core/format.js';
import { colorToHex } from './core/colors.js';
import { extractRegion, pasteRegion, contentBounds, shiftWrapped, indicesOf, contains } from './core/selection.js';
import { outline, convertToPalette, invert, toGrayscale } from './core/filters.js';
import { Editor } from './ui/editor.js';
import { Viewport } from './ui/viewport.js';
import { Controller, TOOLS } from './ui/tools.js';
import { ColorPanel, PalettePanel, RampPanel, LayersPanel, Timeline } from './ui/panels.js';
import { ServerStorage, BrowserStorage, saveDraft, readDraft } from './ui/storage.js';
import {
  newDialog,
  resizeDialog,
  exportImageDialog,
  spriteSheetDialog,
  exportDataDialog,
  importImageDialog,
  projectsDialog,
  shortcutsDialog,
  aboutDialog,
} from './ui/dialogs.js';
import { confirm } from './ui/dialog.js';
import { icon } from './ui/icons.js';
import { thumbnail } from './ui/image.js';
import { el, $, notify, downloadText, pickFile, formatBytes, delay, readPreference, writePreference } from './ui/util.js';

const VERSION = '2.0.0';

// In the desktop app (Crivo.exe), the Windows program creates window.crivoDesktop before this page loads.
// In the browser and in Crivo.html it does not exist, and nothing that depends on it is shown.
const DESKTOP = typeof window.crivoDesktop?.toggleFullscreen === 'function' ? window.crivoDesktop : null;

const editor = new Editor();
let storage = new BrowserStorage(DESKTOP ? 'este computador' : 'este navegador');
const viewport = new Viewport($('#viewport'), editor);
const controller = new Controller(editor, viewport);
controller.palette = () => palette.current.colors;

function applyTheme(theme) {
  const effective = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = effective;
  const button = $('#theme');
  if (button) {
    button.innerHTML = icon(effective === 'dark' ? 'sun' : 'moon', 18);
    button.setAttribute('aria-label', effective === 'dark' ? 'Usar tema claro' : 'Usar tema escuro');
    button.title = button.getAttribute('aria-label');
  }
  viewport.readColors();
}

function buildTools() {
  const bar = $('#tools');
  bar.replaceChildren(
    ...TOOLS.map((f) =>
      el('button', {
        type: 'button',
        class: 'tool',
        data: { tool: f.id },
        title: `${f.name} (${f.shortcut})`,
        'aria-label': `${f.name} (${f.shortcut})`,
        html: icon(f.icon, 22),
        onclick: () => editor.setState('tool', f.id),
      }),
    ),
  );
  const mark = () => {
    for (const b of bar.children) {
      const active = b.dataset.tool === editor.state.tool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    $('#viewport').dataset.tool = editor.state.tool;
  };
  editor.on('state', ({ key }) => {
    if (key === 'tool') {
      mark();
      buildOptions();
    } else if (key === 'shadeMode') {
      buildOptions();
    } else if (TOOLS.find((f) => f.id === editor.state.tool)?.options.includes(key) && !$('#options').contains(document.activeElement)) {
      // Change made by a shortcut or by code: redraws the bar to show the current value.
      buildOptions();
    }
  });
  mark();
}

function optionGroup(label, ...content) {
  return el('label', { class: 'option' }, el('span', {}, label), ...content);
}

function stateSelect(key, options, label) {
  const s = el('select', { 'aria-label': label }, options.map(([v, t]) => el('option', { value: v, selected: String(editor.state[key]) === String(v) }, t)));
  s.addEventListener('change', () => editor.setState(key, typeof editor.state[key] === 'number' ? +s.value : s.value));
  return s;
}

function buildOptions() {
  const bar = $('#options');
  const f = TOOLS.find((x) => x.id === editor.state.tool);
  const items = [el('strong', { class: 'tool-name' }, f.name)];
  for (const op of f.options) {
    if (op === 'size') {
      const r = el('input', { type: 'range', min: 1, max: 32, value: editor.state.size, 'aria-label': 'Tamanho do pincel' });
      const o = el('output', { class: 'mono' }, `${editor.state.size}px`);
      r.addEventListener('input', () => {
        editor.setState('size', +r.value);
        o.textContent = `${r.value}px`;
      });
      items.push(optionGroup('Tamanho', r, o));
    } else if (op === 'shape') {
      items.push(optionGroup('Ponta', stateSelect('shape', [['square', 'Quadrada'], ['circle', 'Redonda']], 'Formato da ponta')));
    } else if (op === 'eraserMode') {
      items.push(optionGroup('Apaga para', stateSelect('eraserMode', [['transparent', 'Transparente'], ['background', 'Cor secundária']], 'Modo da borracha')));
    } else if (op === 'connectivity') {
      items.push(optionGroup('Vizinhos', stateSelect('connectivity', [[4, '4 (lados)'], [8, '8 (com diagonais)']], 'Conectividade')));
    } else if (op === 'tolerance') {
      const r = el('input', { type: 'range', min: 0, max: 100, value: editor.state.tolerance, 'aria-label': 'Tolerância' });
      const o = el('output', { class: 'mono' }, `${editor.state.tolerance}%`);
      r.addEventListener('input', () => {
        editor.setState('tolerance', +r.value);
        o.textContent = `${r.value}%`;
      });
      items.push(optionGroup('Tolerância', r, o));
    } else if (op === 'contiguous') {
      const c = el('input', { type: 'checkbox', checked: editor.state.contiguous });
      c.addEventListener('change', () => editor.setState('contiguous', c.checked));
      items.push(el('label', { class: 'option' }, c, el('span', {}, 'Só a área contígua')));
    } else if (op === 'sample') {
      items.push(optionGroup('Ler de', stateSelect('sample', [['layer', 'Camada atual'], ['all', 'Todas as camadas']], 'Amostragem')));
    } else if (op === 'pixelPerfect') {
      const c = el('input', { type: 'checkbox', checked: editor.state.pixelPerfect });
      c.addEventListener('change', () => editor.setState('pixelPerfect', c.checked));
      items.push(el('label', { class: 'option', title: 'Remove os cantos em L dos traços de 1 px' }, c, el('span', {}, 'Pixel perfect')));
    } else if (op === 'density') {
      items.push(optionGroup('Densidade', stateSelect('density', [[12.5, '12,5%'], [25, '25%'], [37.5, '37,5%'], [50, '50% (xadrez)'], [62.5, '62,5%'], [75, '75%'], [87.5, '87,5%']], 'Densidade do pontilhado')));
    } else if (op === 'ditherBackground') {
      items.push(optionGroup('Fundo', stateSelect('ditherBackground', [['secondary', 'Cor secundária'], ['keep', 'Manter o que há']], 'Fundo do pontilhado')));
    } else if (op === 'gradientType') {
      items.push(optionGroup('Tipo', stateSelect('gradientType', [['linear', 'Linear'], ['radial', 'Radial']], 'Tipo de degradê')));
    } else if (op === 'gradientMatrix') {
      items.push(optionGroup('Padrão', stateSelect('gradientMatrix', [[2, 'Bayer 2×2'], [4, 'Bayer 4×4'], [8, 'Bayer 8×8']], 'Matriz de Bayer')));
    } else if (op === 'shadeMode') {
      items.push(optionGroup('Modo', stateSelect('shadeMode', [['palette', 'Rampa da paleta'], ['light', 'Luminosidade (OKLCH)']], 'Modo de clarear e escurecer')));
    } else if (op === 'shadeIntensity' && editor.state.shadeMode === 'light') {
      const r = el('input', { type: 'range', min: 2, max: 30, value: editor.state.shadeIntensity, 'aria-label': 'Intensidade' });
      const o = el('output', { class: 'mono' }, `${editor.state.shadeIntensity}%`);
      r.addEventListener('input', () => {
        editor.setState('shadeIntensity', +r.value);
        o.textContent = `${r.value}%`;
      });
      items.push(optionGroup('Intensidade', r, o));
    } else if (op === 'filled') {
      const c = el('input', { type: 'checkbox', checked: editor.state.filled });
      c.addEventListener('change', () => editor.setState('filled', c.checked));
      items.push(el('label', { class: 'option' }, c, el('span', {}, 'Preenchido')));
    }
  }
  const HINTS = {
    line: 'Shift: 45°',
    rectangle: 'Shift: proporção 1:1 · Alt: do centro',
    ellipse: 'Shift: proporção 1:1 · Alt: do centro',
    dither: 'Botão direito troca as cores',
    gradient: 'Arraste de onde começa até onde termina · botão direito inverte · Shift: 45°',
    shade: 'Esquerdo clareia · direito escurece',
    selection: 'Shift: quadrada · clique para desmarcar · Ctrl+C/X/V',
    movePixels: 'Arraste ou use as setas (Shift: 8 px) · sem seleção move a camada toda',
  };
  if (HINTS[f.id]) items.push(el('span', { class: 'option-hint' }, HINTS[f.id]));
  bar.replaceChildren(...items);
}

function buildView() {
  const bar = $('#view');
  const symmetry = el(
    'select',
    { 'aria-label': 'Simetria' },
    [['none', 'Sem simetria'], ['horizontal', 'Espelho horizontal'], ['vertical', 'Espelho vertical'], ['both', 'Horizontal e vertical']].map(([v, t]) => el('option', { value: v, selected: editor.state.symmetry === v }, t)),
  );
  symmetry.addEventListener('change', () => editor.setState('symmetry', symmetry.value));
  const grid = el('button', { type: 'button', class: 'icon-button', title: 'Grade (G)', 'aria-label': 'Grade', html: icon('grid', 18), onclick: () => editor.setState('grid', !editor.state.grid) });
  const majorGrid = el(
    'select',
    { 'aria-label': 'Linha forte da grade a cada', title: 'Linha forte da grade a cada N pixels' },
    [[0, 'Sem linha forte'], [4, 'Forte a cada 4'], [8, 'Forte a cada 8'], [16, 'Forte a cada 16'], [32, 'Forte a cada 32']].map(([v, t]) => el('option', { value: v, selected: editor.state.majorGrid === v }, t)),
  );
  majorGrid.addEventListener('change', () => editor.setState('majorGrid', +majorGrid.value));
  const tile = el('button', { type: 'button', class: 'icon-button', title: 'Modo ladrilho (T)', 'aria-label': 'Modo ladrilho', html: icon('frames', 18), onclick: () => editor.setState('tile', !editor.state.tile) });
  const zoom = el('output', { class: 'mono zoom' });
  bar.replaceChildren(
    el('span', { class: 'icon-label', html: icon('symmetry', 18), title: 'Simetria (M)' }),
    symmetry,
    grid,
    majorGrid,
    tile,
    el('span', { class: 'separator' }),
    el('button', { type: 'button', class: 'icon-button', title: 'Afastar (-)', 'aria-label': 'Afastar', html: icon('minus', 16), onclick: () => viewport.zoomStep(-1) }),
    zoom,
    el('button', { type: 'button', class: 'icon-button', title: 'Aproximar (+)', 'aria-label': 'Aproximar', html: icon('plus', 16), onclick: () => viewport.zoomStep(1) }),
    el('button', { type: 'button', class: 'icon-button', title: 'Ajustar à tela (0)', 'aria-label': 'Ajustar à tela', html: icon('fit', 16), onclick: () => viewport.fit() }),
  );
  const update = () => {
    symmetry.value = editor.state.symmetry;
    grid.classList.toggle('on', editor.state.grid);
    grid.setAttribute('aria-pressed', String(editor.state.grid));
    majorGrid.value = String(editor.state.majorGrid);
    tile.classList.toggle('on', editor.state.tile);
    tile.setAttribute('aria-pressed', String(editor.state.tile));
    zoom.textContent = `${viewport.zoom * 100}%`;
  };
  editor.on('state', update);
  editor.on('zoom', update);
  update();
}

const COMMANDS = {
  newProject: { label: 'Novo projeto…', shortcut: '', fn: () => newDialog(editor) },
  openSaved: { label: 'Projetos salvos…', shortcut: '', fn: () => projectsDialog(editor, storage, openProject) },
  openFile: { label: 'Abrir arquivo .crivo…', shortcut: 'Ctrl+O', fn: openFile },
  importImage: { label: 'Importar imagem ou sprite sheet…', shortcut: '', fn: () => importImageDialog(editor) },
  save: { label: 'Salvar', shortcut: 'Ctrl+S', fn: () => save() },
  saveAs: { label: 'Salvar como cópia', shortcut: '', fn: () => save(true) },
  downloadCrivo: { label: 'Baixar arquivo .crivo', shortcut: '', fn: downloadCrivo },
  exportImage: { label: 'Exportar imagem (PNG, JPEG ou GIF)…', shortcut: 'Ctrl+E', fn: () => exportImageDialog(editor) },
  exportGif: { label: 'Exportar GIF animado…', shortcut: 'Ctrl+Shift+G', fn: () => exportImageDialog(editor, 'gif') },
  exportSheet: { label: 'Exportar sprite sheet…', shortcut: '', fn: () => spriteSheetDialog(editor) },
  exportData: { label: 'Exportar dados (JSON, CSV, código)…', shortcut: 'Ctrl+Shift+E', fn: () => exportDataDialog(editor, palette.current) },
  undo: { label: 'Desfazer', shortcut: 'Ctrl+Z', fn: () => editor.undo() },
  redo: { label: 'Refazer', shortcut: 'Ctrl+Y', fn: () => editor.redo() },
  selectAll: { label: 'Selecionar tudo', shortcut: 'Ctrl+A', fn: () => editor.setSelection({ x: 0, y: 0, width: editor.doc.width, height: editor.doc.height }) },
  deselect: { label: 'Desmarcar', shortcut: 'Ctrl+D', fn: () => editor.setSelection(null) },
  copy: { label: 'Copiar', shortcut: 'Ctrl+C', fn: () => copy(false) },
  cut: { label: 'Recortar', shortcut: 'Ctrl+X', fn: () => copy(true) },
  paste: { label: 'Colar', shortcut: 'Ctrl+V', fn: paste },
  clearLayer: {
    label: 'Apagar (seleção ou camada)',
    shortcut: 'Delete',
    fn: () => {
      if (!editor.canEditLayer()) return;
      const sel = editor.clippedSelection;
      if (sel) {
        const d = editor.doc;
        editor.applyChanges('Apagar seleção', [...indicesOf(sel, d.width, d.height)].map((i) => [i, 0]));
        return;
      }
      editor.editStructure('Limpar camada', () => editor.activeCell().fill(0));
    },
  },
  flipH: { label: 'Espelhar na horizontal (seleção ou camada)', shortcut: 'Shift+H', fn: () => flipLayer('horizontal') },
  flipV: { label: 'Espelhar na vertical (seleção ou camada)', shortcut: 'Shift+V', fn: () => flipLayer('vertical') },
  replaceColor: { label: 'Substituir a cor primária pela secundária (todos os quadros)', shortcut: '', fn: replaceColor },
  size: { label: 'Tamanho da matriz…', shortcut: 'Ctrl+Alt+C', fn: () => resizeDialog(editor) },
  rotateRight: { label: 'Girar 90° à direita', shortcut: '', fn: () => rotate(1) },
  rotateLeft: { label: 'Girar 90° à esquerda', shortcut: '', fn: () => rotate(-1) },
  cropSelection: { label: 'Recortar para a seleção', shortcut: '', fn: cropToSelection },
  trim: { label: 'Aparar bordas transparentes', shortcut: '', fn: trim },
  shiftHalf: { label: 'Deslocar meia matriz (ladrilho)', shortcut: 'Shift+T', fn: shiftHalf },
  outline4: { label: 'Adicionar contorno (4 vizinhos)', shortcut: '', fn: () => applyFilter('Contorno', (px, d, f) => outline(px, d.width, d.height, editor.state.primaryColor, { neighbors: 4, filter: f })) },
  outline8: { label: 'Adicionar contorno (8 vizinhos)', shortcut: '', fn: () => applyFilter('Contorno', (px, d, f) => outline(px, d.width, d.height, editor.state.primaryColor, { neighbors: 8, filter: f })) },
  toPalette: { label: 'Converter para a paleta atual', shortcut: '', fn: () => applyFilter('Converter para a paleta', (px, d, f) => convertToPalette(px, palette.current.colors, { filter: f })) },
  invert: { label: 'Inverter cores', shortcut: '', fn: () => applyFilter('Inverter cores', (px, d, f) => invert(px, { filter: f })) },
  grayscale: { label: 'Tons de cinza', shortcut: '', fn: () => applyFilter('Tons de cinza', (px, d, f) => toGrayscale(px, { filter: f })) },
  grid: { label: 'Mostrar grade', shortcut: 'G', checked: () => editor.state.grid, fn: () => editor.setState('grid', !editor.state.grid) },
  onionSkin: { label: 'Papel cebola', shortcut: 'K', checked: () => editor.state.onionSkin, fn: () => editor.setState('onionSkin', !editor.state.onionSkin) },
  tile: { label: 'Modo ladrilho', shortcut: 'T', checked: () => editor.state.tile, fn: () => editor.setState('tile', !editor.state.tile) },
  zoomIn: { label: 'Aproximar', shortcut: '+', fn: () => viewport.zoomStep(1) },
  zoomOut: { label: 'Afastar', shortcut: '-', fn: () => viewport.zoomStep(-1) },
  fit: { label: 'Ajustar à tela', shortcut: '0', fn: () => viewport.fit() },
  zoom100: { label: 'Tamanho real (100%)', shortcut: '1', fn: () => (viewport.setZoom(1), viewport.centerView()) },
  theme: { label: 'Alternar tema claro/escuro', shortcut: '', fn: toggleTheme },
  shortcuts: { label: 'Atalhos do teclado', shortcut: '?', fn: () => shortcutsDialog() },
  about: { label: 'Sobre o Crivo', shortcut: '', fn: () => aboutDialog(VERSION, storage) },
  fullscreen: { label: 'Tela cheia', shortcut: 'F11', fn: () => DESKTOP?.toggleFullscreen() },
  quit: {
    label: 'Sair do Crivo',
    shortcut: 'Alt+F4',
    fn: async () => {
      await saveDraftNow();
      DESKTOP?.quit();
    },
  },
};

const MENUS = [
  ['Arquivo', ['newProject', 'openSaved', 'openFile', 'importImage', '-', 'save', 'saveAs', 'downloadCrivo', '-', 'exportImage', 'exportGif', 'exportSheet', 'exportData', ...(DESKTOP ? ['-', 'quit'] : [])]],
  ['Editar', ['undo', 'redo', '-', 'copy', 'cut', 'paste', 'clearLayer', '-', 'selectAll', 'deselect', '-', 'flipH', 'flipV']],
  ['Imagem', ['size', 'cropSelection', 'trim', '-', 'rotateRight', 'rotateLeft', 'shiftHalf', '-', 'outline4', 'outline8', '-', 'toPalette', 'replaceColor', 'invert', 'grayscale']],
  ['Exibir', ['grid', 'onionSkin', 'tile', '-', 'zoomIn', 'zoomOut', 'fit', 'zoom100', '-', 'theme', ...(DESKTOP ? ['fullscreen'] : [])]],
  ['Ajuda', ['shortcuts', 'about']],
];

function execute(id) {
  const c = COMMANDS[id];
  if (!c) return;
  Promise.resolve()
    .then(() => c.fn())
    .catch((error) => notify(error.message || String(error), 'error', 5000));
}

function buildMenus() {
  const bar = $('#menus');
  let openMenu = null;
  const close = () => {
    if (!openMenu) return;
    // Takes focus away from an item that is about to disappear, so keyboard shortcuts work again.
    if (openMenu.menu.contains(document.activeElement)) document.activeElement.blur();
    openMenu.menu.hidden = true;
    openMenu.button.setAttribute('aria-expanded', 'false');
    openMenu = null;
  };
  for (const [title, items] of MENUS) {
    const menu = el('div', { class: 'menu', role: 'menu', hidden: true });
    const button = el('button', { type: 'button', class: 'menu-button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, title);
    const fill = () =>
      menu.replaceChildren(
        ...items.map((id) => {
          if (id === '-') return el('hr');
          const c = COMMANDS[id];
          const checked = c.checked ? c.checked() : null;
          return el(
            'button',
            {
              type: 'button',
              role: checked === null ? 'menuitem' : 'menuitemcheckbox',
              'aria-checked': checked === null ? null : String(checked),
              class: 'menu-item',
              onclick: () => {
                close();
                execute(id);
              },
            },
            el('span', { class: 'check' }, checked ? '✓' : ''),
            el('span', {}, c.label),
            el('kbd', {}, c.shortcut),
          );
        }),
      );
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const same = openMenu?.menu === menu;
      close();
      if (same) return;
      fill();
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      openMenu = { menu, button };
      menu.querySelector('.menu-item')?.focus();
    });
    button.addEventListener('mouseenter', () => {
      if (openMenu && openMenu.menu !== menu) button.click();
    });
    menu.addEventListener('keydown', (e) => {
      const focusItems = [...menu.querySelectorAll('.menu-item')];
      const i = focusItems.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') focusItems[(i + 1) % focusItems.length].focus();
      else if (e.key === 'ArrowUp') focusItems[(i - 1 + focusItems.length) % focusItems.length].focus();
      else if (e.key === 'Escape') {
        close();
        button.focus();
      } else return;
      e.preventDefault();
    });
    bar.append(el('div', { class: 'menu-group' }, button, menu));
  }
  document.addEventListener('click', close);
}

function flipLayer(axis) {
  if (!editor.canEditLayer()) return;
  const label = axis === 'horizontal' ? 'Espelhar na horizontal' : 'Espelhar na vertical';
  const r = editor.clippedSelection;
  if (r) {
    const d = editor.doc;
    const px = editor.activeCell();
    const changes = [];
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const sx = axis === 'horizontal' ? r.width - 1 - x : x;
        const sy = axis === 'vertical' ? r.height - 1 - y : y;
        changes.push([(r.y + y) * d.width + r.x + x, px[(r.y + sy) * d.width + r.x + sx]]);
      }
    }
    editor.applyChanges(label, changes);
    return;
  }
  editor.editStructure(label, (d) => d.flipCell(editor.activeCell(), axis));
}

// Replaces the exact primary color with the secondary one on the current layer, in every frame (respects the selection).
function replaceColor() {
  if (!editor.canEditLayer()) return;
  const { primaryColor: from, secondaryColor: to } = editor.state;
  if (from === to) {
    notify('A cor primária e a secundária são iguais.', 'info');
    return;
  }
  const layer = editor.currentLayer;
  const sel = editor.selection;
  let total = 0;
  editor.editStructure('Substituir cor', (d) => {
    for (const q of d.frames) {
      if (!d.hasCell(q.id, layer.id)) continue;
      const px = d.cell(q.id, layer.id);
      for (let i = 0; i < px.length; i++) {
        if (px[i] !== from) continue;
        if (sel && !contains(sel, i % d.width, (i / d.width) | 0)) continue;
        px[i] = to;
        total++;
      }
    }
    return total > 0;
  });
  notify(total ? `${total} pixel(s) trocados em ${layer.name}.` : 'A cor primária não aparece nesta camada.', total ? 'success' : 'info');
}

function rotate(dir) {
  editor.editStructure(dir > 0 ? 'Girar à direita' : 'Girar à esquerda', (d) => d.rotate(dir));
  viewport.fit();
}

// Color and outline filters: act on the current cell and, if there is a selection, only inside it.
function applyFilter(label, fn) {
  if (!editor.canEditLayer()) return;
  const d = editor.doc;
  const sel = editor.selection;
  const filter = sel ? (i) => contains(sel, i % d.width, (i / d.width) | 0) : null;
  editor.applyChanges(label, fn(editor.activeCell(), d, filter));
}

function copy(cut) {
  const d = editor.doc;
  const area = editor.clippedSelection ?? { x: 0, y: 0, width: d.width, height: d.height };
  editor.clipboard = extractRegion(editor.activeCell(), d.width, area);
  editor.clipboard.origin = { x: area.x, y: area.y };
  if (cut) {
    if (!editor.canEditLayer()) return;
    editor.applyChanges('Recortar', [...indicesOf(area, d.width, d.height)].map((i) => [i, 0]));
  } else {
    notify(`Copiado: ${area.width} × ${area.height} px`, 'info', 1200);
  }
}

function paste() {
  const region = editor.clipboard;
  if (!region) {
    notify('Nada para colar. Selecione uma área e use Ctrl+C.', 'info');
    return;
  }
  if (!editor.canEditLayer()) return;
  const d = editor.doc;
  const dest = editor.selection ?? region.origin ?? { x: 0, y: 0 };
  const x = Math.min(Math.max(0, dest.x), Math.max(0, d.width - region.width));
  const y = Math.min(Math.max(0, dest.y), Math.max(0, d.height - region.height));
  const changes = [];
  pasteRegion(region, d.width, d.height, x, y, (i, c) => changes.push([i, c]), { opaqueOnly: true });
  const background = editor.activeCell().slice();
  editor.applyChanges('Colar', changes, { silent: true });
  editor.setSelection({ x, y, width: region.width, height: region.height });
  // The pasted content "floats" over the background: Move pixels (V) carries only it, without dragging or punching holes in what is below.
  editor.floating = { key: editor.activeKey, region, background, x, y, version: editor.history.version };
  editor.setState('tool', 'movePixels');
}

function cropToSelection() {
  const r = editor.clippedSelection;
  if (!r) {
    notify('Faça uma seleção primeiro (ferramenta S).', 'info');
    return;
  }
  editor.editStructure('Recortar para a seleção', (d) => d.crop(r.x, r.y, r.width, r.height));
  editor.setSelection(null);
  viewport.fit();
}

function trim() {
  const d = editor.doc;
  const r = contentBounds(d.cells.values(), d.width, d.height);
  if (!r) {
    notify('O projeto está vazio: nada para aparar.', 'info');
    return;
  }
  if (r.width === d.width && r.height === d.height) {
    notify('Não há bordas transparentes para aparar.', 'info');
    return;
  }
  editor.editStructure('Aparar bordas', (doc) => doc.crop(r.x, r.y, r.width, r.height));
  editor.setSelection(null);
  viewport.fit();
  notify(`Aparado para ${r.width} × ${r.height}.`, 'success');
}

function shiftHalf() {
  if (!editor.canEditLayer()) return;
  const d = editor.doc;
  const shifted = shiftWrapped(editor.activeCell(), d.width, d.height, Math.floor(d.width / 2), Math.floor(d.height / 2));
  editor.applyChanges('Deslocar meia matriz', [...shifted].map((c, i) => [i, c]));
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  writePreference('theme', next);
  applyTheme(next);
}

function projectData() {
  const doc = editor.doc;
  doc.palette = palette.current.colors.slice(0, 256);
  return {
    name: doc.name,
    data: serialize(doc),
    thumbnail: thumbnail(doc.composite(0), doc.width, doc.height, 128),
  };
}

async function save(copy = false) {
  const base = projectData();
  try {
    if (storage.type === 'server') {
      let r;
      const id = copy ? null : editor.project.id;
      try {
        r = await storage.saveProject({ ...base, id, revision: editor.project.revision });
      } catch (error) {
        if (error.status !== 409) throw error;
        const overwrite = await confirm('Projeto alterado em outro lugar', 'Este projeto foi salvo por outra aba ou pessoa depois que você o abriu. Salvar por cima mesmo assim? A outra versão continua no histórico de versões.', 'Salvar por cima');
        if (!overwrite) return;
        r = await storage.saveProject({ ...base, id, revision: null });
      }
      editor.markSaved({ id: r.id, revision: r.revision, local: null });
    } else {
      const r = await storage.saveProject({ ...base, id: copy ? null : editor.project.local });
      editor.markSaved({ local: r.id, id: null, revision: null });
    }
    notify(`"${editor.doc.name}" salvo em ${storage.name}.`, 'success');
  } catch (error) {
    notify('Não foi possível salvar: ' + error.message, 'error', 6000);
  }
}

async function openProject(id) {
  if (editor.modified && !(await confirm('Abrir outro projeto', 'As mudanças não salvas deste projeto serão perdidas.', 'Abrir mesmo assim', true))) return;
  try {
    const p = await storage.openProject(id);
    const doc = deserialize(p.data);
    editor.load(doc, storage.type === 'server' ? { id: p.id, revision: p.revision, local: null } : { id: null, revision: null, local: p.id });
    notify(`"${doc.name}" aberto.`, 'success');
  } catch (error) {
    notify('Não foi possível abrir: ' + error.message, 'error', 6000);
  }
}

async function openFile() {
  const file = await pickFile('.crivo,.json,application/json');
  if (!file) return;
  if (editor.modified && !(await confirm('Abrir arquivo', 'As mudanças não salvas deste projeto serão perdidas.', 'Abrir mesmo assim', true))) return;
  try {
    const doc = deserialize(await file.text());
    editor.load(doc);
    notify(`"${doc.name}" aberto.`, 'success');
  } catch (error) {
    notify('Arquivo inválido: ' + error.message, 'error', 6000);
  }
}

function downloadCrivo() {
  const { data } = projectData();
  downloadText(JSON.stringify(data), fileNameFor(editor.doc.name, 'crivo'), 'application/json');
}

function buildName() {
  const input = $('#project-name');
  const update = () => {
    if (document.activeElement !== input) input.value = editor.doc.name;
    document.title = `${editor.modified ? '• ' : ''}${editor.doc.name} · Crivo`;
  };
  input.addEventListener('change', () => {
    const v = input.value.trim().slice(0, 120) || 'Sem título';
    if (v === editor.doc.name) return;
    editor.editStructure('Renomear projeto', (d) => {
      d.name = v;
    });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  editor.on('document', update);
  editor.on('history', update);
  update();
}

function buildHistory() {
  const undo = $('#undo');
  const redo = $('#redo');
  undo.innerHTML = icon('undo', 18);
  redo.innerHTML = icon('redo', 18);
  undo.addEventListener('click', () => editor.undo());
  redo.addEventListener('click', () => editor.redo());
  const update = () => {
    const h = editor.history;
    undo.disabled = !h.canUndo;
    redo.disabled = !h.canRedo;
    undo.title = h.canUndo ? `Desfazer: ${h.nextUndo} (Ctrl+Z)` : 'Nada para desfazer';
    redo.title = h.canRedo ? `Refazer: ${h.nextRedo} (Ctrl+Y)` : 'Nada para refazer';
    undo.setAttribute('aria-label', undo.title);
    redo.setAttribute('aria-label', redo.title);
    $('#status-history').textContent = `Histórico: ${h.past.length} ${h.past.length === 1 ? 'ação' : 'ações'} · ${formatBytes(h.bytes)}`;
  };
  editor.on('history', update);
  update();
  $('#save').innerHTML = icon('disk', 18);
  $('#save').addEventListener('click', () => save());
}

function buildStatus() {
  const pos = $('#status-position');
  const color = $('#status-color');
  const sizeLabel = $('#status-size');
  const zoom = $('#status-zoom');
  const sel = $('#status-selection');
  editor.on('pointer', (p) => {
    if (!p) {
      pos.textContent = '–';
      color.textContent = '';
      color.style.removeProperty('--color');
      return;
    }
    pos.textContent = `${p.x}, ${p.y}`;
    const c = editor.doc.composite(editor.state.frame)[p.y * editor.doc.width + p.x];
    color.textContent = c >>> 24 ? colorToHex(c) : 'transparent';
    color.style.setProperty('--color', colorToHex(c, true));
  });
  editor.on('shape', ({ width, height }) => (pos.textContent = `${width} × ${height}`));
  editor.on('offset', ({ dx, dy }) => (pos.textContent = `Δ ${dx}, ${dy}`));
  editor.on('selection', (r) => {
    sel.textContent = r?.width ? `Seleção: ${r.width} × ${r.height} em ${r.x}, ${r.y}` : '';
  });
  const size = () => (sizeLabel.textContent = `${editor.doc.width} × ${editor.doc.height} · ${editor.doc.frames.length} quadro(s) · ${editor.doc.layers.length} camada(s)`);
  editor.on('document', size);
  editor.on('zoom', ({ zoom: z }) => (zoom.textContent = `${z * 100}%`));
  editor.on('sample', ({ color: c }) => {
    if (!c) notify('Esse pixel está transparente.', 'info', 1200);
  });
  size();
}

function updateStorage() {
  const s = $('#status-storage');
  const server = storage.type === 'server';
  s.replaceChildren(el('span', { class: 'icon-label', html: icon(server ? 'cloud' : 'folder', 14) }), server ? ' Servidor Django' : DESKTOP ? ' Desktop (este computador)' : ' Modo local (navegador)');
  s.title = server
    ? 'Projetos e paletas salvos no banco de dados do servidor'
    : DESKTOP
      ? 'App desktop: projetos e paletas guardados neste computador, na pasta do Crivo em AppData'
      : 'Sem servidor: projetos ficam no IndexedDB deste navegador';
}

function shortcuts(e) {
  const target = e.target;
  if (e.defaultPrevented) return;
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('.menu'))) return;
  if (document.querySelector('dialog[open]')) return;
  // While the mouse button is still pressed (stroke, shape, selection or drag in progress), only Esc works:
  // any other command would change the document in the middle of the gesture and scramble the history.
  if (controller.active) {
    if (e.key === 'Escape') {
      controller.cancel();
      e.preventDefault();
    }
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) execute('undo');
    else if (k === 'y' || (k === 'z' && e.shiftKey)) execute('redo');
    else if (k === 's') execute('save');
    else if (k === 'o') execute('openFile');
    else if (k === 'e') execute(e.shiftKey ? 'exportData' : 'exportImage');
    else if (k === 'c' && e.altKey) execute('size');
    else if (k === 'g' && e.shiftKey) execute('exportGif');
    else if (k === 'a') execute('selectAll');
    else if (k === 'd') execute('deselect');
    else if (k === 'c') execute('copy');
    else if (k === 'x') execute('cut');
    else if (k === 'v') execute('paste');
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (k.startsWith('arrow') && editor.state.tool === 'movePixels') {
    const step = e.shiftKey ? 8 : 1;
    const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
    controller.push(dx, dy);
    e.preventDefault();
    return;
  }
  if (k === 't') {
    execute(e.shiftKey ? 'shiftHalf' : 'tile');
    e.preventDefault();
    return;
  }
  if (e.shiftKey && (k === 'h' || k === 'v')) {
    execute(k === 'h' ? 'flipH' : 'flipV');
    e.preventDefault();
    return;
  }
  const tool = TOOLS.find((f) => f.shortcut.toLowerCase() === k);
  if (tool) editor.setState('tool', tool.id);
  else if (k === 'x') editor.swapColors();
  else if (k === 'g') execute('grid');
  else if (k === 'k') execute('onionSkin');
  else if (k === 'm') {
    const modes = ['none', 'horizontal', 'vertical', 'both'];
    const next = modes[(modes.indexOf(editor.state.symmetry) + 1) % modes.length];
    editor.setState('symmetry', next);
    notify(`Simetria: ${{ none: 'desligada', horizontal: 'horizontal', vertical: 'vertical', both: 'horizontal e vertical' }[next]}`, 'info', 1000);
  } else if (k === '[' || k === ']') {
    editor.setState('size', Math.max(1, Math.min(32, editor.state.size + (k === ']' ? 1 : -1))));
    if (['pencil', 'eraser', 'line', 'dither', 'shade'].includes(editor.state.tool)) buildOptions();
  } else if (k === '+' || k === '=') viewport.zoomStep(1);
  else if (k === '-' || k === '_') viewport.zoomStep(-1);
  else if (k === '0') viewport.fit();
  else if (k === '1') execute('zoom100');
  else if (k === ',') editor.selectFrame(editor.state.frame - 1);
  else if (k === '.') editor.selectFrame(editor.state.frame + 1);
  else if (k === 'enter') editor.state.playing ? editor.stop() : editor.play();
  else if (k === 'delete' || k === 'backspace') execute('clearLayer');
  else if (k === '?') execute('shortcuts');
  else if (k === 'escape') editor.setSelection(null);
  else return;
  e.preventDefault();
}

const palette = new PalettePanel($('#palette-panel'), editor, () => storage);
new ColorPanel($('#color-panel'), editor);
new RampPanel($('#ramp-panel'), editor, palette);
new LayersPanel($('#layers-panel'), editor);
new Timeline($('#timeline'), editor);

const autosave = delay(() => {
  const doc = editor.doc;
  saveDraft({ data: serialize(doc), project: editor.project, modified: editor.modified, savedAt: new Date().toISOString() });
}, 1200);

// Saves the draft right away, without waiting for autosave. Used when closing the tab or the desktop app.
function saveDraftNow() {
  autosave.cancel();
  return saveDraft({ data: serialize(editor.doc), project: editor.project, modified: editor.modified, savedAt: new Date().toISOString() });
}
editor.on('history', autosave);
editor.on('saved', autosave);

async function init() {
  applyTheme(readPreference('theme', 'system'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readPreference('theme', 'system') === 'system') applyTheme('system');
  });
  $('#theme').addEventListener('click', toggleTheme);
  // Same proportion as the project logo (docs/images/logo.svg) and the app icon: pointer at about half the height.
  $('#logo').innerHTML = icon('logo', 18);
  buildTools();
  buildOptions();
  buildView();
  buildMenus();
  buildName();
  buildHistory();
  buildStatus();
  updateStorage();
  window.addEventListener('keydown', shortcuts);
  window.addEventListener('beforeunload', () => {
    saveDraftNow();
  });
  if (DESKTOP) {
    // F11 works anywhere in the app, even with a dialog open or while typing in a field.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'F11') return;
        e.preventDefault();
        execute('fullscreen');
      },
      true,
    );
    // The app calls this before closing the window (Alt+F4 or the X), so the draft does not lose the last strokes.
    window.__crivoBeforeClose = saveDraftNow;
  }
  const draft = await readDraft();
  if (draft?.data) {
    try {
      const doc = deserialize(draft.data);
      editor.load(doc, draft.project);
      editor.modified = Boolean(draft.modified);
      editor.emit('history');
    } catch {
      notify('O rascunho anterior não pôde ser recuperado.', 'warning');
    }
  }
  const server = await ServerStorage.detect();
  if (server) {
    storage = server;
    updateStorage();
    palette.load();
  }
  document.body.classList.add('ready');
}

init();

window.crivo = { editor, viewport, version: VERSION };
