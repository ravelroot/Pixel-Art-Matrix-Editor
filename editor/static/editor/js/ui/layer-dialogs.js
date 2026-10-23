// Dialogs of the layers worker: layer and frame properties, tags, onion skin, slices, tilemap layers, linked cels.
import { BLEND_MODES, BLEND_LABELS } from '../core/blend.js';
import { createTileset } from '../core/tilemap.js';
import { el, notify } from './util.js';
import { openDialog, confirm } from './dialog.js';

const TAG_COLORS = ['#5d1c16', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#219653', '#828282'];
const DIRECTION_LABELS = { forward: 'Para frente', reverse: 'De trás para frente', pingpong: 'Pingue-pongue' };

function field(label, input, extra = {}) {
  return el('label', { class: 'field', ...extra }, el('span', {}, label), input);
}

function numberInput(value, min, max, label, extra = {}) {
  return el('input', { type: 'number', value: String(value), min, max, step: 1, 'aria-label': label, ...extra });
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function run(editor, label, fn) {
  try {
    return editor.editStructure(label, fn);
  } catch (error) {
    notify(error.message, 'error');
    return false;
  }
}

export function blendSelect(value) {
  return el(
    'select',
    { 'aria-label': 'Modo de mesclagem', name: 'blendMode' },
    BLEND_MODES.map((m) => el('option', { value: m, selected: m === value }, BLEND_LABELS[m])),
  );
}

export async function layerPropertiesDialog(editor, layerId = editor.currentLayer.id) {
  const layer = editor.doc.layer(layerId);
  if (!layer) return false;
  const name = el('input', { type: 'text', value: layer.name, maxlength: 80, required: true, 'aria-label': 'Nome da camada' });
  const opacity = el('input', { type: 'range', min: 0, max: 100, value: layer.opacity, 'aria-label': 'Opacidade' });
  const opacityValue = el('output', { class: 'mono' }, layer.opacity + '%');
  opacity.addEventListener('input', () => (opacityValue.textContent = opacity.value + '%'));
  const blend = blendSelect(layer.blendMode || 'normal');
  const reference = el('input', { type: 'checkbox', checked: Boolean(layer.reference), 'aria-label': 'Camada de referência' });
  const kind = { group: 'Grupo', tilemap: 'Camada de tiles', image: 'Camada de imagem' }[layer.kind || 'image'];
  const body = el(
    'div',
    { class: 'layer-properties' },
    el('p', { class: 'small-label' }, kind),
    field('Nome', name),
    el('label', { class: 'field compact' }, el('span', {}, 'Opacidade'), opacity, opacityValue),
    field('Mesclagem', blend),
    layer.kind === 'group'
      ? null
      : el('label', { class: 'option', title: 'Aparece na tela com a opacidade dela, mas fica fora das exportações e miniaturas' }, reference, el('span', {}, 'Camada de referência (não é exportada)')),
  );
  const result = await openDialog({
    title: 'Propriedades da camada',
    body,
    className: 'layer-properties-dialog',
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', primary: true, send: true, action: () => (name.value.trim() ? true : false) },
    ],
  });
  if (!result) return false;
  const values = { name: name.value.trim().slice(0, 80), opacity: +opacity.value, blendMode: blend.value, reference: layer.kind === 'group' ? false : reference.checked };
  const same = Object.entries(values).every(([k, v]) => (layer[k] ?? (k === 'blendMode' ? 'normal' : false)) === v);
  if (same) return false;
  return run(editor, 'Propriedades da camada', (d) => {
    Object.assign(d.layer(layerId), values);
  });
}

export async function framePropertiesDialog(editor, frameIndex = editor.state.frame) {
  const frame = editor.doc.frames[frameIndex];
  if (!frame) return false;
  const fallback = Math.round(1000 / editor.doc.fps);
  const duration = numberInput(frame.duration ?? '', 1, 60000, 'Duração em milissegundos', { placeholder: `${fallback} (FPS)` });
  const body = el(
    'div',
    {},
    field('Duração (ms)', duration),
    el('p', { class: 'small-label' }, `Deixe em branco para usar o FPS do projeto (${editor.doc.fps} FPS = ${fallback} ms).`),
  );
  const r = await openDialog({
    title: `Propriedades do quadro ${frameIndex + 1}`,
    body,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', primary: true, send: true, action: () => ({ value: duration.value.trim() }) },
    ],
  });
  if (!r) return false;
  const value = r.value === '' ? null : clampInt(r.value, 1, 60000, null);
  if (value === (frame.duration ?? null)) return false;
  return run(editor, 'Duração do quadro', (d) => {
    d.frames[frameIndex].duration = value;
  });
}

export async function tagDialog(editor, tagId = null) {
  const doc = editor.doc;
  const tag = tagId ? doc.tags.find((t) => t.id === tagId) : null;
  const n = doc.frames.length;
  const current = editor.state.frame + 1;
  const name = el('input', { type: 'text', value: tag?.name ?? `Tag ${doc.tags.length + 1}`, maxlength: 80, required: true, 'aria-label': 'Nome da tag' });
  const from = numberInput(tag ? doc.frameIndex(tag.from) + 1 : current, 1, n, 'Do quadro');
  const to = numberInput(tag ? doc.frameIndex(tag.to) + 1 : current, 1, n, 'Até o quadro');
  const color = el('input', { type: 'color', value: tag?.color ?? TAG_COLORS[doc.tags.length % TAG_COLORS.length], 'aria-label': 'Cor da tag' });
  const direction = el(
    'select',
    { 'aria-label': 'Direção' },
    Object.entries(DIRECTION_LABELS).map(([v, t]) => el('option', { value: v, selected: (tag?.direction ?? 'forward') === v }, t)),
  );
  const repeat = numberInput(tag?.repeat ?? 0, 0, 9999, 'Repetições');
  const body = el(
    'div',
    { class: 'tag-dialog' },
    field('Nome', name),
    el('div', { class: 'field-row' }, field('Do quadro', from), field('Até o quadro', to)),
    field('Cor', color),
    field('Direção', direction),
    field('Repetições (0 = sem fim)', repeat),
  );
  const actions = [{ label: 'Cancelar', value: null }];
  if (tag) actions.push({ label: 'Excluir tag', danger: true, value: 'delete' });
  actions.push({ label: tag ? 'Aplicar' : 'Criar tag', primary: true, send: true, action: () => (name.value.trim() ? 'save' : false) });
  const r = await openDialog({ title: tag ? 'Editar tag' : 'Nova tag', body, actions });
  if (!r) return false;
  if (r === 'delete') {
    return run(editor, 'Excluir tag', (d) => {
      d.tags = d.tags.filter((t) => t.id !== tagId);
    });
  }
  let a = clampInt(from.value, 1, n, current) - 1;
  let b = clampInt(to.value, 1, n, current) - 1;
  if (a > b) [a, b] = [b, a];
  const values = { name: name.value.trim().slice(0, 80), from: doc.frames[a].id, to: doc.frames[b].id, color: color.value, direction: direction.value, repeat: clampInt(repeat.value, 0, 9999, 0) };
  if (tag) {
    return run(editor, 'Editar tag', (d) => {
      Object.assign(
        d.tags.find((t) => t.id === tagId),
        values,
      );
    });
  }
  return run(editor, 'Nova tag', (d) => d.addTag(values));
}

export async function onionSkinDialog(editor) {
  const s = editor.state;
  const prev = el('select', { 'aria-label': 'Quadros anteriores' }, [0, 1, 2, 3].map((v) => el('option', { value: v, selected: s.onionPrev === v }, String(v))));
  const next = el('select', { 'aria-label': 'Quadros seguintes' }, [0, 1, 2, 3].map((v) => el('option', { value: v, selected: s.onionNext === v }, String(v))));
  const mode = el(
    'select',
    { 'aria-label': 'Modo do papel cebola' },
    el('option', { value: 'normal', selected: s.onionMode === 'normal' }, 'Normal (transparente)'),
    el('option', { value: 'tint', selected: s.onionMode === 'tint' }, 'Tingido (anteriores em vermelho, seguintes em azul)'),
  );
  const r = await openDialog({
    title: 'Papel cebola',
    body: el('div', {}, field('Quadros anteriores', prev), field('Quadros seguintes', next), field('Modo', mode)),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Aplicar', primary: true, send: true, action: () => true },
    ],
  });
  if (!r) return false;
  editor.setState('onionPrev', +prev.value);
  editor.setState('onionNext', +next.value);
  editor.setState('onionMode', mode.value);
  if (!editor.state.onionSkin) editor.setState('onionSkin', true);
  return true;
}

export async function newTilemapDialog(editor) {
  const width = numberInput(16, 1, 256, 'Largura do tile');
  const height = numberInput(16, 1, 256, 'Altura do tile');
  const name = el('input', { type: 'text', value: 'Tiles', maxlength: 80, 'aria-label': 'Nome da camada' });
  const r = await openDialog({
    title: 'Nova camada de tiles',
    body: el(
      'div',
      {},
      field('Nome', name),
      el('div', { class: 'field-row' }, field('Largura do tile', width), field('Altura do tile', height)),
      el('p', { class: 'small-label' }, 'Cada célula da grade guarda um tile do tileset. No modo tile o lápis coloca o tile escolhido, a borracha põe o tile vazio e o conta-gotas pega o tile; no modo pixel, desenhar edita o tile em todos os lugares onde ele aparece.'),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Criar', primary: true, send: true, action: () => true },
    ],
  });
  if (!r) return null;
  const tw = clampInt(width.value, 1, 256, 16);
  const th = clampInt(height.value, 1, 256, 16);
  let created = null;
  run(editor, 'Nova camada de tiles', (d) => {
    const tileset = createTileset(d, tw, th);
    const layer = d.addLayer(name.value.trim().slice(0, 80) || 'Tiles', d.layerIndex(editor.currentLayer.id) + 1);
    layer.kind = 'tilemap';
    layer.tileset = tileset.id;
    created = layer;
  });
  if (created) {
    editor.selectLayer(created.id);
    editor.setState('tileIndex', 1);
  }
  return created;
}

export async function linkCelsDialog(editor) {
  const doc = editor.doc;
  const n = doc.frames.length;
  const current = editor.state.frame + 1;
  const from = numberInput(current, 1, n, 'Do quadro');
  const to = numberInput(n, 1, n, 'Até o quadro');
  const r = await openDialog({
    title: 'Vincular célula',
    body: el(
      'div',
      {},
      el('p', {}, `A célula da camada "${editor.currentLayer.name}" no quadro ${current} passa a ser a mesma nos quadros escolhidos: editar uma edita todas.`),
      el('div', { class: 'field-row' }, field('Do quadro', from), field('Até o quadro', to)),
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Vincular', primary: true, send: true, action: () => true },
    ],
  });
  if (!r) return false;
  let a = clampInt(from.value, 1, n, current) - 1;
  let b = clampInt(to.value, 1, n, current) - 1;
  if (a > b) [a, b] = [b, a];
  const layerId = editor.currentLayer.id;
  const source = editor.currentFrame.id;
  const ids = doc.frames.slice(a, b + 1).map((q) => q.id);
  return run(editor, 'Vincular células', (d) => d.linkCels(layerId, [source, ...ids], source));
}

function sliceForm(doc, slice) {
  const s = slice ?? { name: `Slice ${doc.slices.length + 1}`, color: '#2f80ed', x: 0, y: 0, width: doc.width, height: doc.height, center: null, pivot: null };
  const max = 4096;
  const inputs = {
    name: el('input', { type: 'text', value: s.name, maxlength: 80, required: true, 'aria-label': 'Nome do slice' }),
    color: el('input', { type: 'color', value: s.color, 'aria-label': 'Cor do slice' }),
    x: numberInput(s.x, -max, max, 'X'),
    y: numberInput(s.y, -max, max, 'Y'),
    width: numberInput(s.width, 1, max, 'Largura'),
    height: numberInput(s.height, 1, max, 'Altura'),
    nine: el('input', { type: 'checkbox', checked: Boolean(s.center), 'aria-label': 'Nove partes (9-slice)' }),
    cx: numberInput(s.center?.x ?? 1, 0, max, 'Centro X'),
    cy: numberInput(s.center?.y ?? 1, 0, max, 'Centro Y'),
    cw: numberInput(s.center?.width ?? Math.max(1, s.width - 2), 1, max, 'Centro largura'),
    ch: numberInput(s.center?.height ?? Math.max(1, s.height - 2), 1, max, 'Centro altura'),
    hasPivot: el('input', { type: 'checkbox', checked: Boolean(s.pivot), 'aria-label': 'Ponto de pivô' }),
    px: numberInput(s.pivot?.x ?? 0, -max, max, 'Pivô X'),
    py: numberInput(s.pivot?.y ?? 0, -max, max, 'Pivô Y'),
  };
  const body = el(
    'div',
    { class: 'slice-form' },
    el('div', { class: 'field-row' }, field('Nome', inputs.name), field('Cor', inputs.color)),
    el('div', { class: 'field-row' }, field('X', inputs.x), field('Y', inputs.y), field('Largura', inputs.width), field('Altura', inputs.height)),
    el('label', { class: 'option' }, inputs.nine, el('span', {}, '9-slice (centro, relativo ao slice)')),
    el('div', { class: 'field-row' }, field('Centro X', inputs.cx), field('Centro Y', inputs.cy), field('Largura', inputs.cw), field('Altura', inputs.ch)),
    el('label', { class: 'option' }, inputs.hasPivot, el('span', {}, 'Pivô (relativo ao slice)')),
    el('div', { class: 'field-row' }, field('Pivô X', inputs.px), field('Pivô Y', inputs.py)),
  );
  const read = () => ({
    name: inputs.name.value.trim().slice(0, 80) || 'Slice',
    color: inputs.color.value,
    x: clampInt(inputs.x.value, -max, max, 0),
    y: clampInt(inputs.y.value, -max, max, 0),
    width: clampInt(inputs.width.value, 1, max, 1),
    height: clampInt(inputs.height.value, 1, max, 1),
    center: inputs.nine.checked ? { x: clampInt(inputs.cx.value, 0, max, 0), y: clampInt(inputs.cy.value, 0, max, 0), width: clampInt(inputs.cw.value, 1, max, 1), height: clampInt(inputs.ch.value, 1, max, 1) } : null,
    pivot: inputs.hasPivot.checked ? { x: clampInt(inputs.px.value, -max, max, 0), y: clampInt(inputs.py.value, -max, max, 0) } : null,
  });
  return { body, read };
}

export async function sliceDialog(editor, sliceId = null) {
  const slice = sliceId ? editor.doc.slices.find((s) => s.id === sliceId) : null;
  const sel = editor.clippedSelection;
  const base = slice ?? (sel ? { name: `Slice ${editor.doc.slices.length + 1}`, color: '#2f80ed', x: sel.x, y: sel.y, width: sel.width, height: sel.height, center: null, pivot: null } : null);
  const { body, read } = sliceForm(editor.doc, base);
  const actions = [{ label: 'Cancelar', value: null }];
  if (slice) actions.push({ label: 'Excluir', danger: true, value: 'delete' });
  actions.push({ label: slice ? 'Aplicar' : 'Criar slice', primary: true, send: true, action: () => 'save' });
  const r = await openDialog({ title: slice ? `Editar slice "${slice.name}"` : 'Novo slice', body, actions });
  if (!r) return false;
  if (r === 'delete') {
    if (!(await confirm('Excluir slice', `O slice "${slice.name}" será apagado.`, 'Excluir', true))) return false;
    return run(editor, 'Excluir slice', (d) => {
      d.slices = d.slices.filter((s) => s.id !== sliceId);
    });
  }
  const values = read();
  if (slice) {
    return run(editor, 'Editar slice', (d) => {
      Object.assign(
        d.slices.find((s) => s.id === sliceId),
        values,
      );
    });
  }
  return run(editor, 'Novo slice', (d) => d.addSlice(values));
}

// List of slices with buttons to add, edit and delete.
export async function slicesDialog(editor) {
  for (;;) {
    const doc = editor.doc;
    const list = el(
      'ul',
      { class: 'slice-list' },
      doc.slices.length
        ? doc.slices.map((s) =>
            el(
              'li',
              {},
              el('span', { class: 'slice-color', style: { '--color': s.color } }),
              el('span', { class: 'name' }, `${s.name} · ${s.x}, ${s.y} · ${s.width} × ${s.height}${s.center ? ' · 9-slice' : ''}${s.pivot ? ' · pivô' : ''}`),
              el('button', { type: 'button', class: 'button small', data: { slice: s.id } }, 'Editar'),
            ),
          )
        : el('li', { class: 'empty' }, 'Nenhum slice. Use "Novo slice" (com uma seleção, ele nasce do tamanho dela).'),
    );
    let picked = null;
    const r = await openDialog({
      title: 'Slices',
      body: list,
      onOpen: (_dialog, close) => {
        for (const b of list.querySelectorAll('button[data-slice]')) {
          b.addEventListener('click', () => {
            picked = b.dataset.slice;
            close('edit');
          });
        }
      },
      actions: [
        { label: 'Fechar', value: null },
        { label: 'Novo slice', primary: true, send: true, action: () => 'new' },
      ],
    });
    if (r === 'new') await sliceDialog(editor);
    else if (r === 'edit' && picked) await sliceDialog(editor, picked);
    else return;
  }
}
