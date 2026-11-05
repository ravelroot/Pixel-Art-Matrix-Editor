import { upscalePixelArt, innerOutline, selectiveOutline, dropShadow, cleanOrphans, reduceColors, countColors, gradientMap, autoShade, hueShiftRamp } from '../core/pixelart.js';
import { contains } from '../core/selection.js';
import { MAX_SIDE } from '../core/document.js';
import { promptText } from '../ui/dialog.js';
import { notify } from '../ui/util.js';

export function install(app) {
  const { editor } = app;
  const filtered = (label, fn, done = null) => {
    if (!editor.canEditLayer()) return;
    const d = editor.doc;
    const sel = editor.selection;
    const filter = sel ? (i) => contains(sel, i % d.width, (i / d.width) | 0) : null;
    const result = fn(editor.activeCell(), d, filter);
    const changes = Array.isArray(result) ? result : result.changes;
    if (!changes.length) {
      notify('Nada mudou nesta camada.', 'info');
      return;
    }
    editor.applyChanges(label, changes);
    if (done) done(result, changes);
  };
  const upscale = (factor, name) => {
    const d = editor.doc;
    if (d.width * factor > MAX_SIDE || d.height * factor > MAX_SIDE) {
      notify(`Com ${name}, o desenho passaria de ${MAX_SIDE} px. O máximo aqui é ${Math.floor(MAX_SIDE / factor)} × ${Math.floor(MAX_SIDE / factor)}.`, 'warning', 5000);
      return;
    }
    editor.editStructure(`Ampliar com ${name}`, (doc) => doc.scaleWith(doc.width * factor, doc.height * factor, (px, w, h) => upscalePixelArt(px, w, h, factor).pixels));
    editor.setSelection(null);
    app.viewport.fit();
    notify(`${name}: ${d.width} × ${d.height} px, com as diagonais suavizadas sem criar cores novas.`, 'success');
  };
  Object.assign(app.commands, {
    scale2x: { label: 'Ampliar 2× (Scale2x)', shortcut: '', fn: () => upscale(2, 'Scale2x') },
    scale3x: { label: 'Ampliar 3× (Scale3x)', shortcut: '', fn: () => upscale(3, 'Scale3x') },
    scale4x: { label: 'Ampliar 4× (Scale4x)', shortcut: '', fn: () => upscale(4, 'Scale4x') },
    reduceColors: {
      label: 'Reduzir cores…',
      shortcut: '',
      fn: async () => {
        if (!editor.canEditLayer()) return;
        const now = countColors(editor.activeCell());
        const answer = await promptText('Reduzir cores', `Quantas cores deixar? A camada tem ${now} cor(es).`, String(Math.max(2, Math.min(16, now - 1))));
        if (!answer) return;
        const n = Math.round(Number(answer));
        if (!Number.isFinite(n) || n < 1 || n > 256) {
          notify('Use um número de 1 a 256.', 'warning');
          return;
        }
        filtered('Reduzir cores', (px, d, f) => reduceColors(px, n, { filter: f }), (r) => notify(`Agora com ${r.palette.length} cor(es), escolhidas por corte mediano e k-médias no OKLab.`, 'success'));
      },
    },
    dropShadow: { label: 'Sombra projetada (cor secundária)', shortcut: '', fn: () => filtered('Sombra projetada', (px, d, f) => dropShadow(px, d.width, d.height, editor.state.secondaryColor, { filter: f })) },
    innerOutline: { label: 'Contorno interno (cor primária)', shortcut: '', fn: () => filtered('Contorno interno', (px, d, f) => innerOutline(px, d.width, d.height, editor.state.primaryColor, { filter: f })) },
    selOut: { label: 'Contorno seletivo (sel-out)', shortcut: '', fn: () => filtered('Contorno seletivo', (px, d, f) => selectiveOutline(px, d.width, d.height, { filter: f })) },
    gradientMap: {
      label: 'Mapa de degradê (paleta atual)',
      shortcut: '',
      fn: () => {
        const colors = app.palette?.current?.colors || [];
        if (colors.length < 2) {
          notify('A paleta atual precisa de pelo menos duas cores.', 'warning');
          return;
        }
        filtered('Mapa de degradê', (px, d, f) => gradientMap(px, colors, { filter: f }));
      },
    },
    autoShade: { label: 'Sombrear automaticamente', shortcut: '', fn: () => filtered('Sombrear automaticamente', (px, d, f) => autoShade(px, d.width, d.height, { filter: f })) },
    hueRamp: {
      label: 'Rampa com desvio de matiz…',
      shortcut: '',
      fn: async () => {
        if (!app.palette?.addColors) return;
        const answer = await promptText('Rampa com desvio de matiz', 'Quantas cores na rampa? A cor principal fica no meio: as sombras puxam para o azul e as luzes para o amarelo.', '5');
        if (!answer) return;
        const n = Math.round(Number(answer));
        if (!Number.isFinite(n) || n < 3 || n > 16) {
          notify('Use um número de 3 a 16.', 'warning');
          return;
        }
        await app.palette.addColors(hueShiftRamp(editor.state.primaryColor, n));
      },
    },
    cleanOrphans: { label: 'Limpar pixels soltos', shortcut: '', fn: () => filtered('Limpar pixels soltos', (px, d, f) => cleanOrphans(px, d.width, d.height, { filter: f }), (r, changes) => notify(`${changes.length} pixel(s) soltos corrigidos.`, 'success')) },
  });
  app.addMenuItems('Cor', ['hueRamp'], 'editPalette');
  app.addMenuItems('Imagem', ['innerOutline', 'selOut', 'dropShadow', 'autoShade', '-', 'cleanOrphans', 'reduceColors', 'gradientMap', '-', 'scale2x', 'scale3x', 'scale4x'], 'outline8');
}
