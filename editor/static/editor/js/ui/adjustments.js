// Adjustment dialogs (Cor → Ajustes) with live preview on the canvas: Cancel restores the cel, OK records one
// undo step. They act on the current cel or on every frame of the current layer, only inside the selection.
import { applyAdjustment, changesBetween, CONVOLUTION_PRESETS, curveTable } from '../core/adjust.js';
import { colorModeOf, constrainPixels } from '../core/colormode.js';
import { indicesOf, contains } from '../core/selection.js';
import { el, notify, readPreference, writePreference } from './util.js';
import { openDialog } from './dialog.js';

const range = (key, label, min, max, value, unit = '') => ({ type: 'range', key, label, min, max, value, unit });

export const ADJUSTMENT_DIALOGS = {
  brightnessContrast: { title: 'Brilho e contraste', fields: [range('brightness', 'Brilho', -100, 100, 0), range('contrast', 'Contraste', -100, 100, 0)] },
  hueSaturation: {
    title: 'Matiz/Saturação/Luminosidade',
    fields: [range('hue', 'Matiz', -180, 180, 0, '°'), range('saturation', 'Saturação', -100, 100, 0), range('lightness', 'Luminosidade', -100, 100, 0), { type: 'checkbox', key: 'colorize', label: 'Colorir (aplica um só matiz)', value: false }],
  },
  colorCurve: { title: 'Curva de cores', fields: [{ type: 'curve', key: 'curves' }] },
  posterize: { title: 'Posterizar', fields: [range('levels', 'Níveis', 2, 32, 4)] },
  despeckle: { title: 'Remover ruído', fields: [], note: 'Troca cada pixel pela mediana dos vizinhos 3×3 (pixels transparentes ficam de fora).' },
  convolve: {
    title: 'Matriz de convolução',
    fields: [
      { type: 'select', key: 'preset', label: 'Matriz', options: Object.entries(CONVOLUTION_PRESETS).map(([v, p]) => [v, p.label]), value: 'smooth' },
      { type: 'checkbox', key: 'skipTransparent', label: 'Ignorar pixels transparentes nas bordas', value: true },
    ],
  },
};

// Indices of the selected pixels (null = no selection, the whole cel). The selection is clipped to the matrix
// (clipToDocument keeps and crops its mask) and indicesOf / contains honor the mask of non-rectangular selections.
export function selectionIndices(editor) {
  if (!editor.selection) return null;
  const d = editor.doc;
  const clipped = editor.clippedSelection;
  if (!clipped) return new Uint32Array(0);
  return Uint32Array.from(indicesOf(clipped, d.width, d.height)).filter((i) => i < d.width * d.height && contains(clipped, i % d.width, (i / d.width) | 0));
}

const CHANNELS = [['rgb', 'RGB'], ['r', 'Vermelho'], ['g', 'Verde'], ['b', 'Azul']];
const identityCurve = () => [[0, 0], [255, 255]];

// Point curve editor: click adds a point, drag moves it, double click removes it.
function curveField(onChange) {
  const curves = { rgb: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() };
  let channel = 'rgb';
  const size = 256;
  const canvas = el('canvas', { class: 'curve-canvas', width: size, height: size, 'aria-label': 'Curva: clique adiciona um ponto, arraste move, clique duplo remove' });
  const select = el('select', { 'aria-label': 'Canal' }, CHANNELS.map(([v, t]) => el('option', { value: v }, t)));
  const reset = el('button', { type: 'button', class: 'button small' }, 'Redefinir canal');
  const color = { r: '#d0342c', g: '#3f9a2f', b: '#3a6fd8' };
  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The RGB curve uses the text color of the theme (light or dark).
    color.rgb = canvas.isConnected ? getComputedStyle(canvas).color : '#2b1d17';
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(128,128,128,0.25)';
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo((k * size) / 4, 0);
      ctx.lineTo((k * size) / 4, size);
      ctx.moveTo(0, (k * size) / 4);
      ctx.lineTo(size, (k * size) / 4);
      ctx.stroke();
    }
    const table = curveTable(curves[channel]);
    ctx.strokeStyle = color[channel];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let v = 0; v < 256; v++) ctx.lineTo(v, size - 1 - table[v]);
    ctx.stroke();
    ctx.fillStyle = color[channel];
    for (const [x, y] of curves[channel]) ctx.fillRect(x - 3, size - 1 - y - 3, 7, 7);
  };
  const toCurve = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round(255 - ((e.clientY - r.top) / r.height) * 255)].map((v) => Math.max(0, Math.min(255, v)));
  };
  const find = ([x, y]) => curves[channel].findIndex(([px, py]) => Math.abs(px - x) <= 8 && Math.abs(py - y) <= 8);
  let dragging = -1;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toCurve(e);
    dragging = find(p);
    if (dragging < 0) {
      curves[channel].push(p);
      dragging = curves[channel].length - 1;
    }
    canvas.setPointerCapture?.(e.pointerId);
    draw();
    onChange();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging < 0) return;
    curves[channel][dragging] = toCurve(e);
    draw();
    onChange();
  });
  canvas.addEventListener('pointerup', () => (dragging = -1));
  canvas.addEventListener('dblclick', (e) => {
    const i = find(toCurve(e));
    if (i < 0 || curves[channel].length <= 2) return;
    curves[channel].splice(i, 1);
    draw();
    onChange();
  });
  select.addEventListener('change', () => {
    channel = select.value;
    draw();
  });
  requestAnimationFrame(draw);
  reset.addEventListener('click', () => {
    curves[channel] = identityCurve();
    draw();
    onChange();
  });
  draw();
  return {
    node: el('div', { class: 'curve-field' }, el('div', { class: 'row-actions' }, select, reset), canvas),
    value: () => Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, v.map((p) => [...p])])),
  };
}

function buildFields(def, onChange) {
  const readers = {};
  const nodes = [];
  for (const f of def.fields) {
    if (f.type === 'range') {
      const input = el('input', { type: 'range', min: f.min, max: f.max, step: 1, value: f.value, 'aria-label': f.label });
      const out = el('output', { class: 'mono' }, `${f.value}${f.unit}`);
      input.addEventListener('input', () => {
        out.textContent = `${input.value}${f.unit}`;
        onChange();
      });
      readers[f.key] = () => +input.value;
      nodes.push(el('label', { class: 'field compact adjust-field' }, el('span', {}, f.label), input, out));
    } else if (f.type === 'checkbox') {
      const input = el('input', { type: 'checkbox', checked: f.value });
      input.addEventListener('change', onChange);
      readers[f.key] = () => input.checked;
      nodes.push(el('label', { class: 'field check-field' }, input, el('span', {}, f.label)));
    } else if (f.type === 'select') {
      const select = el('select', { 'aria-label': f.label }, f.options.map(([v, t]) => el('option', { value: v, selected: v === f.value }, t)));
      select.addEventListener('change', onChange);
      readers[f.key] = () => select.value;
      nodes.push(el('label', { class: 'field' }, el('span', {}, f.label), select));
    } else if (f.type === 'curve') {
      const c = curveField(onChange);
      readers[f.key] = c.value;
      nodes.push(c.node);
    }
  }
  return { nodes, read: () => Object.fromEntries(Object.entries(readers).map(([k, r]) => [k, r()])) };
}

// Opens the dialog of an adjustment (a key of ADJUSTMENT_DIALOGS). getPalette() returns the current palette colors
// (indexed mode keeps the result inside the palette).
export async function adjustmentDialog(editor, id, getPalette = () => []) {
  const def = ADJUSTMENT_DIALOGS[id];
  if (!def) throw new Error(`Unknown adjustment: ${id}`);
  if (editor.state.playing) editor.stop();
  if (!editor.canEditLayer()) return false;
  const d = editor.doc;
  const layer = editor.currentLayer;
  const cell = editor.activeCell();
  const original = cell.slice();
  const indices = selectionIndices(editor);
  const context = { width: d.width, height: d.height, indices };
  const mode = colorModeOf(d);
  const colors = getPalette();
  const compute = (px, options) => constrainPixels(px, applyAdjustment(id, px, options, context), mode, colors);

  let pending = 0;
  let closed = false;
  const previewBox = el('input', { type: 'checkbox', checked: true });
  const preview = () => {
    if (pending || closed) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (closed) return;
      cell.set(previewBox.checked ? compute(original, fields.read()) : original);
      editor.emit('pixels');
    });
  };
  const fields = buildFields(def, preview);
  previewBox.addEventListener('change', preview);
  const allFrames = el('input', { type: 'checkbox', checked: Boolean(readPreference('adjustAllFrames', false)) });
  const multiple = d.frames.length > 1;
  const body = el(
    'div',
    { class: 'adjust-body' },
    def.note ? el('p', { class: 'hint' }, def.note) : null,
    ...fields.nodes,
    indices ? el('p', { class: 'hint' }, 'Só os pixels da seleção mudam.') : null,
    el('label', { class: 'field check-field' }, previewBox, el('span', {}, 'Prévia na tela')),
    multiple ? el('label', { class: 'field check-field' }, allFrames, el('span', {}, `Todos os quadros da camada "${layer.name}"`)) : null,
  );
  const options = await openDialog({
    title: def.title,
    className: 'adjust-dialog',
    body,
    onOpen: () => preview(),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'OK', primary: true, send: true, action: () => fields.read() },
    ],
  });
  closed = true;
  if (pending) cancelAnimationFrame(pending);
  pending = 0;
  cell.set(original);
  editor.emit('pixels');
  if (!options) return false;
  if (multiple) writePreference('adjustAllFrames', allFrames.checked);
  if (!multiple || !allFrames.checked) return editor.applyChanges(def.title, changesBetween(original, compute(original, options)));
  const done = editor.editStructure(def.title, (doc) => {
    let changed = 0;
    const seen = new Set();
    for (const f of doc.frames) {
      if (!doc.hasCell(f.id, layer.id)) continue;
      const px = doc.cell(f.id, layer.id);
      if (seen.has(px)) continue;
      seen.add(px);
      const out = compute(px, options);
      for (let i = 0; i < px.length; i++) if (px[i] !== out[i]) changed++;
      px.set(out);
    }
    return changed > 0;
  });
  if (!done) notify('Nada mudou.', 'info', 1200);
  return done;
}
