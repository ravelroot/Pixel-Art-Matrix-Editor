// Feature module: selection (Seleção menu, mask-aware commands, selection and drawing tool options,
// custom brush and Transformar seleção). See main.js (app) for the extension points.
import {
  extractRegion,
  pasteRegion,
  indicesOf,
  invertSelection,
  expandSelection,
  selectionFromIndices,
  clipToDocument,
  trimMask,
} from '../core/selection.js';
import { brushFromRegion } from '../core/brush.js';
import { flipRegion, transformRegion } from '../core/transform.js';
import { TOOLS } from '../ui/tools.js';
import { openDialog } from '../ui/dialog.js';
import { el, numberField, checkboxField } from '../ui/util.js';

export const SELECTION_MENU = [
  'selectAll',
  'deselect',
  'reselect',
  'invertSelection',
  '-',
  'expandSelection',
  'contractSelection',
  'selectByColor',
  '-',
  'transformSelection',
  '-',
  'brushFromSelection',
  'defaultBrush',
];

export function install(app) {
  const { editor } = app;
  const notify = (...args) => app.notify(...args);
  const docSize = () => [editor.doc.width, editor.doc.height];

  // --- selection commands -------------------------------------------------------------------------------
  const commands = {
    reselect: {
      label: 'Reselecionar',
      shortcut: 'Ctrl+Shift+D',
      fn: () => {
        const r = clipToDocument(editor.lastSelection, ...docSize());
        if (!r) {
          notify('Não há seleção anterior para recuperar.', 'info');
          return;
        }
        editor.setSelection(r);
      },
    },
    invertSelection: { label: 'Inverter seleção', shortcut: 'Ctrl+Shift+I', fn: () => editor.setSelection(invertSelection(editor.selection, ...docSize())) },
    expandSelection: { label: 'Expandir seleção…', shortcut: '', fn: () => modifySelection(1) },
    contractSelection: { label: 'Contrair seleção…', shortcut: '', fn: () => modifySelection(-1) },
    selectByColor: { label: 'Selecionar por cor (cor primária)', shortcut: '', fn: selectByColor },
    transformSelection: { label: 'Transformar seleção…', shortcut: '', fn: transformDialog },
    brushFromSelection: { label: 'Usar seleção como pincel', shortcut: 'Ctrl+B', fn: brushFromSelection },
    defaultBrush: { label: 'Pincel padrão', shortcut: '', checked: () => !editor.brush, fn: () => setBrush(null) },
  };
  Object.assign(app.commands, commands);
  app.addMenu('Seleção', SELECTION_MENU, app.menus.some(([t]) => t === 'Exibir') ? 'Exibir' : 'Ajuda');

  app.addShortcut({ key: 'd', ctrl: true, shift: true, run: () => app.execute('reselect') });
  app.addShortcut({ key: 'i', ctrl: true, shift: true, run: () => app.execute('invertSelection') });
  app.addShortcut({ key: 'b', ctrl: true, run: () => app.execute('brushFromSelection') });
  // Second tools of each group (Aseprite style): Shift + letter.
  for (const t of TOOLS) {
    const m = /^Shift\+([A-Z])$/.exec(t.shortcut);
    if (m) app.addShortcut({ key: m[1].toLowerCase(), shift: true, run: () => editor.setState('tool', t.id) });
  }

  // Masks reach copy, cut, Delete, filters, gradient and bucket through core/selection.js; paste and flip of a
  // non-rectangular selection need their own versions (rectangles keep the 2.0.0 commands).
  const originalPaste = app.commands.paste.fn;
  app.commands.paste.fn = () => (editor.clipboard?.mask ? pasteMasked() : originalPaste());
  for (const [id, axis] of [['flipH', 'horizontal'], ['flipV', 'vertical']]) {
    const original = app.commands[id].fn;
    app.commands[id].fn = () => (editor.selection?.mask ? flipMasked(axis) : original());
  }

  function pasteMasked() {
    const region = editor.clipboard;
    if (!editor.canEditLayer()) return;
    const d = editor.doc;
    const dest = editor.selection ?? region.origin ?? { x: 0, y: 0 };
    const x = Math.min(Math.max(0, dest.x), Math.max(0, d.width - region.width));
    const y = Math.min(Math.max(0, dest.y), Math.max(0, d.height - region.height));
    const changes = [];
    pasteRegion(region, d.width, d.height, x, y, (i, c) => changes.push([i, c]), { opaqueOnly: true });
    const background = editor.activeCell().slice();
    editor.applyChanges('Colar', changes, { silent: true });
    editor.setSelection({ x, y, width: region.width, height: region.height, mask: region.mask });
    editor.floating = { key: editor.activeKey, region, background, x, y, version: editor.history.version };
    editor.setState('tool', 'movePixels');
  }

  function flipMasked(axis) {
    if (!editor.canEditLayer()) return;
    const d = editor.doc;
    const sel = editor.clippedSelection;
    if (!sel) return;
    const flipped = flipRegion(extractRegion(editor.activeCell(), d.width, sel), axis);
    const changes = new Map();
    for (const i of indicesOf(sel, d.width, d.height)) changes.set(i, 0);
    pasteRegion(flipped, d.width, d.height, sel.x, sel.y, (i, c) => changes.set(i, c));
    editor.applyChanges(axis === 'horizontal' ? 'Espelhar na horizontal' : 'Espelhar na vertical', [...changes]);
    editor.setSelection(trimMask({ x: sel.x, y: sel.y, width: sel.width, height: sel.height, mask: flipped.mask }));
  }

  async function modifySelection(direction) {
    if (!editor.selection) {
      notify('Faça uma seleção primeiro.', 'info');
      return;
    }
    const field = numberField('Pixels (1 a 10)', 1, { min: 1, max: 10 });
    const title = direction > 0 ? 'Expandir seleção' : 'Contrair seleção';
    const amount = await openDialog({
      title,
      body: el('div', { class: 'form-grid' }, field.label),
      actions: [
        { label: 'Cancelar', value: null },
        {
          label: direction > 0 ? 'Expandir' : 'Contrair',
          primary: true,
          send: true,
          action: () => {
            const n = Math.round(Number(field.input.value));
            if (!(n >= 1 && n <= 10)) {
              notify('Use um valor de 1 a 10 pixels.', 'warning');
              return false;
            }
            return n;
          },
        },
      ],
    });
    if (!amount) return;
    const r = expandSelection(editor.selection, direction * amount, ...docSize());
    editor.setSelection(r);
    if (!r) notify('A seleção sumiu ao contrair.', 'info');
  }

  function selectByColor() {
    const d = editor.doc;
    const px = editor.activeCell();
    const color = editor.state.primaryColor >>> 0;
    const transparent = !(color >>> 24);
    const indices = [];
    for (let i = 0; i < px.length; i++) {
      const c = px[i] >>> 0;
      if (c === color || (transparent && !(c >>> 24))) indices.push(i);
    }
    const r = selectionFromIndices(indices, d.width, d.height);
    editor.setSelection(r);
    if (!r) notify('A cor primária não aparece nesta camada.', 'info');
  }

  // --- custom brush ---------------------------------------------------------------------------------------
  function setBrush(b) {
    editor.brush = b;
    editor.emit('state', { key: 'brush', value: Boolean(b) });
    app.rebuildOptions();
  }

  function brushFromSelection() {
    const d = editor.doc;
    const sel = editor.clippedSelection;
    if (!sel) {
      notify('Selecione os pixels que vão virar o pincel.', 'info');
      return;
    }
    const b = brushFromRegion(extractRegion(editor.activeCell(), d.width, sel));
    if (!b) {
      notify('A seleção está vazia: não há pixels para o pincel.', 'warning');
      return;
    }
    setBrush(b);
    if (!['pencil', 'eraser', 'spray'].includes(editor.state.tool)) editor.setState('tool', 'pencil');
    notify(`Pincel personalizado: ${b.width} × ${b.height} px. Use "Pincel padrão" para voltar.`, 'success');
  }

  // --- transform dialog -----------------------------------------------------------------------------------
  async function transformDialog() {
    if (!editor.canEditLayer()) return;
    const d = editor.doc;
    const sel = editor.clippedSelection ?? { x: 0, y: 0, width: d.width, height: d.height };
    const source = extractRegion(editor.activeCell(), d.width, sel);
    const angle = numberField('Rotação (graus)', 0, { min: -360, max: 360 });
    const scale = numberField('Escala (%)', 100, { min: 10, max: 800, step: 5 });
    const flipH = checkboxField('Espelhar na horizontal', false);
    const flipV = checkboxField('Espelhar na vertical', false);
    const canvas = el('canvas', { class: 'transform-preview', width: 192, height: 192, 'aria-label': 'Prévia da transformação' });
    const info = el('p', { class: 'hint wide' });
    const read = () => ({
      angle: Math.max(-360, Math.min(360, Number(angle.input.value) || 0)),
      scale: Math.max(10, Math.min(800, Number(scale.input.value) || 100)),
      flipH: flipH.input.checked,
      flipV: flipV.input.checked,
    });
    const draw = () => {
      const t = transformRegion(source, read());
      drawPreview(canvas, t);
      info.textContent = `Resultado: ${t.width} × ${t.height} px (rotação RotSprite, sem cores novas).`;
    };
    for (const input of [angle.input, scale.input, flipH.input, flipV.input]) input.addEventListener('input', draw);
    const options = await openDialog({
      title: 'Transformar seleção',
      body: el('div', { class: 'form-grid' }, angle.label, scale.label, flipH.label, flipV.label, el('div', { class: 'field wide' }, el('span', {}, 'Prévia'), canvas), info),
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Aplicar', primary: true, send: true, action: () => read() },
      ],
      onOpen: draw,
    });
    if (!options) return;
    const t = transformRegion(source, options);
    const x = Math.round(sel.x + sel.width / 2 - t.width / 2);
    const y = Math.round(sel.y + sel.height / 2 - t.height / 2);
    const changes = new Map();
    for (const i of indicesOf(sel, d.width, d.height)) changes.set(i, 0);
    pasteRegion(t, d.width, d.height, x, y, (i, c) => changes.set(i, c), { opaqueOnly: true });
    editor.applyChanges('Transformar seleção', [...changes]);
    if (editor.selection) editor.setSelection(clipToDocument({ x, y, width: t.width, height: t.height, mask: t.mask }, d.width, d.height));
  }

  function drawPreview(canvas, t) {
    const g = canvas.getContext('2d');
    const side = canvas.width;
    g.clearRect(0, 0, side, side);
    const z = Math.max(1, Math.floor(side / Math.max(t.width, t.height)));
    const ox = Math.floor((side - t.width * z) / 2);
    const oy = Math.floor((side - t.height * z) / 2);
    const data = new ImageData(t.width, t.height);
    new Uint32Array(data.data.buffer).set(t.pixels);
    const tmp = document.createElement('canvas');
    tmp.width = t.width;
    tmp.height = t.height;
    tmp.getContext('2d').putImageData(data, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, ox, oy, t.width * z, t.height * z);
  }

  // --- options bar ----------------------------------------------------------------------------------------
  const range = (key, min, max, label, unit) => {
    const r = el('input', { type: 'range', min, max, value: editor.state[key], 'aria-label': label });
    const o = el('output', { class: 'mono' }, `${editor.state[key]}${unit}`);
    r.addEventListener('input', () => {
      editor.setState(key, +r.value);
      o.textContent = `${r.value}${unit}`;
    });
    return app.optionGroup(label, r, o);
  };
  app.addToolOptions((op, items) => {
    if (op === 'selectionMode') {
      items.push(
        app.optionGroup(
          'Modo',
          app.stateSelect('selectionMode', [['replace', 'Substituir'], ['add', 'Adicionar (Shift)'], ['subtract', 'Subtrair (Alt)'], ['intersect', 'Interseção (Shift+Alt)']], 'Modo de seleção'),
        ),
      );
    } else if (op === 'inkMode') {
      items.push(app.optionGroup('Tinta', app.stateSelect('inkMode', [['simple', 'Simples'], ['composite', 'Composição alfa'], ['lockAlpha', 'Travar alfa'], ['behind', 'Atrás']], 'Modo de tinta')));
    } else if (op === 'sprayRadius') {
      items.push(range('sprayRadius', 1, 32, 'Raio', 'px'));
    } else if (op === 'sprayDensity') {
      items.push(range('sprayDensity', 1, 100, 'Densidade', '%'));
    } else if (op === 'brush') {
      if (editor.brush) {
        items.push(
          el(
            'span',
            { class: 'option' },
            el('span', {}, `Pincel personalizado ${editor.brush.width} × ${editor.brush.height}`),
            el('button', { type: 'button', class: 'button', onclick: () => setBrush(null) }, 'Pincel padrão'),
          ),
        );
      }
    } else {
      return false;
    }
    return true;
  });
  return app;
}
