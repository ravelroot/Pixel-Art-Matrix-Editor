// Feature module: layers and animation (groups, blend modes, reference layers, linked cels, tags, onion skin
// settings, tilemaps and slices). See main.js (app) for the extension points.
import { tilesetOf, placeTile, tileIndexAt } from '../core/tilemap.js';
import {
  layerPropertiesDialog,
  framePropertiesDialog,
  tagDialog,
  onionSkinDialog,
  newTilemapDialog,
  linkCelsDialog,
  slicesDialog,
} from '../ui/layer-dialogs.js';
import { LayersPanel } from '../ui/panels.js';
import { confirm } from '../ui/dialog.js';

function structural(app, label, fn) {
  try {
    return app.editor.editStructure(label, fn);
  } catch (error) {
    app.notify(error.message, 'error');
    return false;
  }
}

function commands(app) {
  const { editor } = app;
  const current = () => editor.currentLayer;
  const frame = () => editor.currentFrame;
  return {
    layerNew: {
      label: 'Nova camada',
      shortcut: 'Shift+N',
      fn: () => structural(app, 'Nova camada', (d) => editor.selectLayer(d.addLayer(null, d.layerIndex(current().id) + 1).id)),
    },
    layerNewGroup: {
      label: 'Novo grupo',
      shortcut: '',
      fn: () => structural(app, 'Novo grupo', (d) => editor.selectLayer(d.addGroup(null, d.layerIndex(current().id) + 1).id)),
    },
    layerNewTilemap: { label: 'Nova camada de tiles…', shortcut: '', fn: () => newTilemapDialog(editor) },
    layerGroup: {
      label: 'Agrupar a camada atual',
      shortcut: '',
      fn: () => structural(app, 'Agrupar camada', (d) => editor.selectLayer(d.groupLayer(current().id).id)),
    },
    layerUngroup: {
      label: 'Desfazer o grupo',
      shortcut: '',
      fn: () => {
        const c = current();
        const group = c.kind === 'group' ? c : c.parent ? editor.doc.layer(c.parent) : null;
        if (!group) return app.notify('A camada atual não está em um grupo.', 'info');
        structural(app, 'Desfazer grupo', (d) => d.ungroup(group.id));
      },
    },
    layerDuplicate: {
      label: 'Duplicar camada',
      shortcut: '',
      fn: () => structural(app, 'Duplicar camada', (d) => editor.selectLayer(d.duplicateLayer(current().id).id)),
    },
    layerDelete: { label: 'Excluir camada', shortcut: '', fn: () => LayersPanel.instance?.remove() },
    layerUp: { label: 'Subir camada', shortcut: '', fn: () => structural(app, 'Subir camada', (d) => d.moveLayer(current().id, 1)) },
    layerDown: { label: 'Descer camada', shortcut: '', fn: () => structural(app, 'Descer camada', (d) => d.moveLayer(current().id, -1)) },
    layerMerge: { label: 'Mesclar com a de baixo', shortcut: '', fn: () => structural(app, 'Mesclar camadas', (d) => d.mergeDown(current().id)) },
    layerProperties: { label: 'Propriedades da camada…', shortcut: 'F2', fn: () => layerPropertiesDialog(editor) },
    layerReference: {
      label: 'Camada de referência',
      shortcut: '',
      checked: () => Boolean(current().reference),
      fn: () => {
        const c = current();
        if (c.kind === 'group') return app.notify('Grupos não podem ser camadas de referência.', 'info');
        structural(app, c.reference ? 'Deixar de ser referência' : 'Camada de referência', (d) => {
          d.layer(c.id).reference = !c.reference;
        });
      },
    },
    tileMode: {
      label: 'Modo tile (camadas de tiles)',
      shortcut: '',
      checked: () => Boolean(editor.state.tileMode),
      fn: () => editor.setState('tileMode', !editor.state.tileMode),
    },
    frameNew: {
      label: 'Novo quadro',
      shortcut: 'Alt+N',
      fn: () =>
        structural(app, 'Novo quadro', (d) => {
          d.addFrame(editor.state.frame + 1);
          editor.state.frame += 1;
        }),
    },
    frameNewLinked: {
      label: 'Novo quadro vinculado',
      shortcut: '',
      fn: () =>
        structural(app, 'Novo quadro vinculado', (d) => {
          d.addLinkedFrame(frame().id);
          editor.state.frame += 1;
        }),
    },
    frameDuplicate: {
      label: 'Duplicar quadro',
      shortcut: '',
      fn: () =>
        structural(app, 'Duplicar quadro', (d) => {
          d.duplicateFrame(frame().id);
          editor.state.frame += 1;
        }),
    },
    frameDelete: {
      label: 'Excluir quadro',
      shortcut: '',
      fn: () => {
        if (editor.doc.frames.length <= 1) return app.notify('A animação precisa de pelo menos um quadro.', 'warning');
        structural(app, 'Excluir quadro', (d) => d.removeFrame(frame().id));
      },
    },
    frameProperties: { label: 'Propriedades do quadro…', shortcut: '', fn: () => framePropertiesDialog(editor) },
    celLink: { label: 'Vincular célula a quadros…', shortcut: '', fn: () => linkCelsDialog(editor) },
    celUnlink: {
      label: 'Desvincular célula',
      shortcut: '',
      fn: () => {
        if (!editor.doc.isLinked(frame().id, current().id)) return app.notify('A célula atual não está vinculada.', 'info');
        structural(app, 'Desvincular célula', (d) => d.unlinkCel(frame().id, current().id));
      },
    },
    tagNew: { label: 'Nova tag…', shortcut: '', fn: () => tagDialog(editor) },
    tagEdit: {
      label: 'Editar a tag do quadro…',
      shortcut: '',
      fn: () => {
        const tag = editor.doc.tagAt(editor.state.frame);
        if (!tag) return app.notify('O quadro atual não está em nenhuma tag.', 'info');
        return tagDialog(editor, tag.id);
      },
    },
    tagDelete: {
      label: 'Excluir a tag do quadro',
      shortcut: '',
      fn: async () => {
        const tag = editor.doc.tagAt(editor.state.frame);
        if (!tag) return app.notify('O quadro atual não está em nenhuma tag.', 'info');
        if (!(await confirm('Excluir tag', `A tag "${tag.name}" será apagada (os quadros continuam).`, 'Excluir', true))) return;
        structural(app, 'Excluir tag', (d) => {
          d.tags = d.tags.filter((t) => t.id !== tag.id);
        });
      },
    },
    playAnimation: { label: 'Tocar ou pausar a animação', shortcut: 'Enter', fn: () => (editor.state.playing ? editor.stop() : editor.play()) },
    onionSettings: { label: 'Configurar papel cebola…', shortcut: '', fn: () => onionSkinDialog(editor) },
    showSlices: {
      label: 'Slices',
      shortcut: '',
      checked: () => Boolean(editor.state.showSlices),
      fn: () => editor.setState('showSlices', !editor.state.showSlices),
    },
    editSlices: { label: 'Editar slices…', shortcut: '', fn: () => slicesDialog(editor) },
  };
}

// Slices as outlines (9-slice center dashed, pivot as a cross) and the tile grid of the current tilemap layer.
function drawOverlays(app) {
  const { editor } = app;
  return (ctx, X, Y, z, dpr) => {
    const doc = editor.doc;
    const tileset = tilesetOf(doc, editor.currentLayer);
    if (tileset && z >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(47, 128, 237, 0.55)';
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      ctx.beginPath();
      for (let x = tileset.tileWidth; x < doc.width; x += tileset.tileWidth) {
        ctx.moveTo(X(x) + 0.5, Y(0));
        ctx.lineTo(X(x) + 0.5, Y(doc.height));
      }
      for (let y = tileset.tileHeight; y < doc.height; y += tileset.tileHeight) {
        ctx.moveTo(X(0), Y(y) + 0.5);
        ctx.lineTo(X(doc.width), Y(y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (!editor.state.showSlices || !doc.slices.length) return;
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.round(dpr * 1.5));
    ctx.font = `${Math.round(11 * dpr)}px sans-serif`;
    ctx.textBaseline = 'bottom';
    for (const s of doc.slices) {
      ctx.strokeStyle = s.color;
      ctx.setLineDash([]);
      ctx.strokeRect(X(s.x) + 0.5, Y(s.y) + 0.5, X(s.x + s.width) - X(s.x) - 1, Y(s.y + s.height) - Y(s.y) - 1);
      ctx.fillStyle = s.color;
      ctx.fillText(s.name, X(s.x) + 2 * dpr, Y(s.y) - 2 * dpr);
      if (s.center) {
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        const cx = s.x + s.center.x;
        const cy = s.y + s.center.y;
        ctx.strokeRect(X(cx) + 0.5, Y(cy) + 0.5, X(cx + s.center.width) - X(cx) - 1, Y(cy + s.center.height) - Y(cy) - 1);
      }
      if (s.pivot) {
        ctx.setLineDash([]);
        const px = X(s.x + s.pivot.x + 0.5);
        const py = Y(s.y + s.pivot.y + 0.5);
        const r = 5 * dpr;
        ctx.beginPath();
        ctx.moveTo(px - r, py);
        ctx.lineTo(px + r, py);
        ctx.moveTo(px, py - r);
        ctx.lineTo(px, py + r);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
}

// Tile mode on a tilemap layer: pencil places the selected tile, eraser (or the right button) places tile 0
// and the eyedropper picks the tile under the pointer. The gesture is one history step.
function installTileMode(app) {
  const { editor, viewport } = app;
  const canvas = viewport.canvas;
  let gesture = null;
  const at = (e) => viewport.screenToMatrix(e.clientX, e.clientY);
  const place = (e) => {
    const p = at(e);
    if (!p.inside) return;
    if (placeTile(editor.doc, gesture.frameId, gesture.layerId, p.x, p.y, gesture.index)) {
      gesture.changed = true;
      editor.emit('pixels');
    }
  };
  const finish = () => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    if (!g.changed) return;
    editor.history.recordState(g.index === 0 ? 'Apagar tiles' : 'Colocar tiles', g.before, editor.doc.snapshot(), { frame: editor.state.frame, layerId: g.layerId });
    editor.markModified();
    editor.emit('pixels', { thumbnails: true });
  };
  const move = (e) => {
    if (!gesture) return;
    e.stopPropagation();
    place(e);
  };
  const up = (e) => {
    if (!gesture) return;
    e.stopPropagation();
    finish();
  };
  canvas.parentElement.addEventListener(
    'pointerdown',
    (e) => {
      const layer = editor.currentLayer;
      const tool = editor.state.tool;
      if (e.target !== canvas || layer.kind !== 'tilemap' || !editor.state.tileMode || !['pencil', 'eraser', 'eyedropper'].includes(tool)) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.stopPropagation();
      e.preventDefault();
      const p = at(e);
      if (!p.inside) return;
      if (tool === 'eyedropper') {
        const index = tileIndexAt(editor.doc, editor.currentFrame.id, layer.id, p.x, p.y);
        if (index >= 0) editor.setState('tileIndex', index);
        app.notify(`Tile ${index} escolhido.`, 'info', 1000);
        return;
      }
      if (editor.state.playing) editor.stop();
      if (!editor.canEditLayer()) return;
      const index = tool === 'eraser' || e.button === 2 ? 0 : editor.state.tileIndex;
      gesture = { before: editor.doc.snapshot(), frameId: editor.currentFrame.id, layerId: layer.id, index, changed: false };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      place(e);
    },
    true,
  );
}

export function install(app) {
  Object.assign(app.commands, commands(app));
  app.addMenu('Camada', [
    'layerNew', 'layerNewGroup', 'layerNewTilemap', '-',
    'layerDuplicate', 'layerDelete', 'layerUp', 'layerDown', 'layerMerge', '-',
    'layerGroup', 'layerUngroup', '-',
    'layerProperties', 'layerReference', 'tileMode',
  ]);
  app.addMenu('Quadro', [
    'frameNew', 'frameNewLinked', 'frameDuplicate', 'frameDelete', 'frameProperties', '-',
    'celLink', 'celUnlink', '-',
    'tagNew', 'tagEdit', 'tagDelete', '-',
    'playAnimation',
  ]);
  app.addMenuItems('Exibir', ['onionSettings'], 'onionSkin');
  app.addMenuItems('Exibir', ['showSlices', 'editSlices'], 'tile');
  app.addShortcut({ key: 'n', shift: true, run: () => app.execute('layerNew') });
  app.addShortcut({ key: 'n', alt: true, run: () => app.execute('frameNew') });
  app.addShortcut({ key: 'f2', run: () => app.execute('layerProperties') });
  app.viewport.overlays.push(drawOverlays(app));
  installTileMode(app);
  app.editor.on('layer', () => app.viewport.request());
  return app;
}
