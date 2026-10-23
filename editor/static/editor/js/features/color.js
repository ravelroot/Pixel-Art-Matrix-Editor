// Feature module: color. Color modes (RGBA, indexed, grayscale), palette editor, color picker and adjustments,
// all under the "Cor" menu. See main.js (app) for the extension points.
import { colorModeOf, convertDocument, snapColor, paletteRemap, remapDocument, preparePalette, nearestColor, grayOf } from '../core/colormode.js';
import { paletteEditorDialog } from '../ui/palette-editor.js';
import { adjustmentDialog } from '../ui/adjustments.js';
import { colorPickerDialog } from '../ui/color-picker.js';
import { el, notify } from '../ui/util.js';
import { openDialog } from '../ui/dialog.js';

const MODE_LABELS = { rgba: 'RGBA', indexed: 'indexado', grayscale: 'tons de cinza' };

export function install(app) {
  const { editor } = app;
  const paletteColors = () => app.palette?.current?.colors ?? [];
  const mode = () => colorModeOf(editor.doc);

  // Drawing colors follow the mode: nearest palette color (indexed) or gray (grayscale).
  let snapping = false;
  const snapColors = (which = 'both') => {
    const m = mode();
    if (m === 'rgba' || snapping) return;
    snapping = true;
    try {
      for (const w of which === 'both' ? ['primary', 'secondary'] : [which === 'secondary' ? 'secondary' : 'primary']) {
        const c = editor.state[w === 'secondary' ? 'secondaryColor' : 'primaryColor'];
        const s = snapColor(c, m, paletteColors());
        if (s !== c) editor.setColor(w, s);
      }
    } finally {
      snapping = false;
    }
  };
  editor.on('color', ({ which }) => snapColors(which));
  editor.on('document', () => snapColors());

  // Every finished stroke (tools, paste, moves, filters) stays inside the mode: the pixels it changed are snapped
  // to the palette (indexed) or to gray (grayscale) before the history step is recorded.
  const finishStroke = editor.finishStroke.bind(editor);
  editor.finishStroke = (stroke, label) => {
    const m = mode();
    if (m !== 'rgba' && stroke?.originals instanceof Map && stroke.pixels) {
      const prepared = m === 'indexed' ? preparePalette(paletteColors()) : null;
      if (!prepared || prepared.length) {
        const cache = new Map();
        for (const i of stroke.originals.keys()) {
          const c = stroke.pixels[i];
          if (!(c >>> 24)) continue;
          let s = cache.get(c);
          if (s === undefined) cache.set(c, (s = prepared ? nearestColor(c, prepared) : grayOf(c)));
          stroke.pixels[i] = s;
        }
      }
    }
    return finishStroke(stroke, label);
  };

  async function setMode(target) {
    const current = mode();
    if (current === target) {
      notify(`O projeto já está no modo ${MODE_LABELS[target]}.`, 'info');
      return;
    }
    if (editor.state.playing) editor.stop();
    let options = {};
    if (target === 'indexed') {
      const colors = paletteColors();
      if (!colors.some((c) => c >>> 24)) {
        notify('A paleta atual não tem cores.', 'warning');
        return;
      }
      const dither = el('input', { type: 'checkbox' });
      const amount = el('input', { type: 'range', min: 10, max: 100, value: 50, 'aria-label': 'Intensidade do pontilhado' });
      const r = await openDialog({
        title: 'Converter para modo indexado',
        body: el(
          'div',
          { class: 'adjust-body' },
          el('p', {}, `Cada pixel de todos os quadros e camadas vira a cor mais próxima da paleta "${app.palette.current.name}" (${colors.length} cores). Depois disso, as cores de desenho ficam presas à paleta.`),
          el('label', { class: 'field check-field' }, dither, el('span', {}, 'Pontilhado ordenado (Bayer 4×4)')),
          el('label', { class: 'field compact' }, el('span', {}, 'Intensidade'), amount),
        ),
        actions: [
          { label: 'Cancelar', value: null },
          { label: 'Converter', primary: true, send: true, action: () => ({ dither: dither.checked, amount: +amount.value / 100 }) },
        ],
      });
      if (!r) return;
      options = r;
    }
    const label = `Modo de cor: ${MODE_LABELS[target]}`;
    editor.editStructure(label, (d) => {
      if (target !== 'rgba') convertDocument(d, target, paletteColors(), options);
      d.colorMode = target;
    });
    snapColors();
    notify(`${label}.`, 'success', 1600);
  }

  async function editPalette() {
    const panel = app.palette;
    const current = panel.current;
    const r = await paletteEditorDialog({ palette: current, newColor: editor.state.primaryColor, gray: mode() === 'grayscale' });
    if (!r) return;
    await panel.save(current.preset ? { name: r.name, colors: r.colors, preset: true } : { ...current, name: r.name, colors: r.colors });
    // In indexed mode the pixels follow their palette entries: edited entries change color everywhere,
    // removed ones go to the nearest color left. One undo step for the whole document.
    if (mode() === 'indexed') {
      const map = paletteRemap(current.colors, r.colors, r.origins);
      if (map.size) editor.editStructure('Editar paleta', (d) => remapDocument(d, map) > 0);
      snapColors();
    }
    notify(current.preset ? `Cópia "${r.name}" salva.` : 'Paleta salva.', 'success');
  }

  async function pickColor(which) {
    const key = which === 'secondary' ? 'secondaryColor' : 'primaryColor';
    const before = editor.state[key];
    const c = await colorPickerDialog({ color: before, title: which === 'secondary' ? 'Cor secundária' : 'Cor principal', gray: mode() === 'grayscale', onInput: (v) => editor.setColor(which, v) });
    if (c === null || c === undefined) return editor.setColor(which, before);
    editor.setColor(which, c);
    editor.rememberColor(editor.state[key]);
  }

  const adjust = (id) => () => adjustmentDialog(editor, id, paletteColors);
  Object.assign(app.commands, {
    colorModeRgba: { label: 'Modo de cor: RGBA', shortcut: '', checked: () => mode() === 'rgba', fn: () => setMode('rgba') },
    colorModeIndexed: { label: 'Modo de cor: Indexado…', shortcut: '', checked: () => mode() === 'indexed', fn: () => setMode('indexed') },
    colorModeGrayscale: { label: 'Modo de cor: Tons de cinza', shortcut: '', checked: () => mode() === 'grayscale', fn: () => setMode('grayscale') },
    editPalette: { label: 'Editar paleta…', shortcut: '', fn: editPalette },
    pickPrimary: { label: 'Escolher cor principal…', shortcut: '', fn: () => pickColor('primary') },
    pickSecondary: { label: 'Escolher cor secundária…', shortcut: '', fn: () => pickColor('secondary') },
    adjustBrightness: { label: 'Brilho e contraste…', shortcut: '', fn: adjust('brightnessContrast') },
    adjustHue: { label: 'Matiz/Saturação/Luminosidade…', shortcut: 'Ctrl+U', fn: adjust('hueSaturation') },
    adjustCurves: { label: 'Curva de cores…', shortcut: 'Ctrl+M', fn: adjust('colorCurve') },
    adjustPosterize: { label: 'Posterizar…', shortcut: '', fn: adjust('posterize') },
    adjustDespeckle: { label: 'Remover ruído…', shortcut: '', fn: adjust('despeckle') },
    adjustConvolution: { label: 'Matriz de convolução…', shortcut: '', fn: adjust('convolve') },
  });
  // Right after "Imagem": the color commands sit next to the image ones.
  const image = app.menus.findIndex(([t]) => t === 'Imagem');
  const afterImage = (image >= 0 && app.menus[image + 1]?.[0]) || 'Ajuda';
  app.addMenu('Cor', [
    'colorModeRgba', 'colorModeIndexed', 'colorModeGrayscale', '-',
    'editPalette', 'pickPrimary', 'pickSecondary', '-',
    'adjustBrightness', 'adjustHue', 'adjustCurves', 'adjustPosterize', 'adjustDespeckle', 'adjustConvolution', '-',
    'toPalette', 'replaceColor', 'invert', 'grayscale',
  ], afterImage);
  app.addShortcut({ key: 'u', ctrl: true, run: () => app.execute('adjustHue') });
  app.addShortcut({ key: 'm', ctrl: true, run: () => app.execute('adjustCurves') });

  // "Editar" button in the palette panel, next to "+ Cor".
  const actions = app.palette?.actions;
  if (actions) {
    const edit = el('button', { type: 'button', class: 'button small', title: 'Editar as cores da paleta (Cor → Editar paleta…)', 'aria-label': 'Editar paleta', onclick: () => app.execute('editPalette') }, 'Editar');
    actions.insertBefore(edit, actions.children[1] ?? null);
  }
  return app;
}
