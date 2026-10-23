// Feature module: files and workspace. See main.js (app) for the extension points.
// - .aseprite/.ase import and export (core/aseprite.js);
// - APNG and PNG-sequence (.zip) export, Aseprite sprite-sheet JSON (ui/dialogs.js export dialogs);
// - several documents in tabs (ui/tabs.js), drag and drop of files onto the canvas;
// - preview window with the viewport rectangle (ui/minimap.js).
import { readAseprite, writeAseprite, isAsepriteName } from '../core/aseprite.js';
import { deserialize, fileNameFor } from '../core/format.js';
import { Tabs } from '../ui/tabs.js';
import { Minimap } from '../ui/minimap.js';
import { newDialog, importImageDialog, projectsDialog, exportImageDialog } from '../ui/dialogs.js';
import { confirm } from '../ui/dialog.js';
import { $, notify, pickFile, downloadBlob } from '../ui/util.js';

const OPEN_TYPES = '.crivo,.json,.aseprite,.ase,application/json';
const IMAGE_RE = /\.(png|gif|jpe?g|webp|bmp)$/i;
const isAsepriteBytes = (b) => b.length >= 128 && b[4] === 0xe0 && b[5] === 0xa5;
// PNG, GIF, JPEG, BMP and WebP signatures.
const isImageBytes = (b) =>
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
  (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) ||
  (b[0] === 0xff && b[1] === 0xd8) ||
  (b[0] === 0x42 && b[1] === 0x4d) ||
  (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45);

export function install(app) {
  const { editor, viewport, commands } = app;
  const tabs = new Tabs($('#doc-tabs'), editor, viewport);
  const minimap = new Minimap($('#minimap'), editor, viewport);
  const openInTab = (doc, project) => tabs.open(doc, project);

  // Reads a file chosen in the dialog or dropped on the canvas and opens it in a new tab.
  async function openFileObject(file) {
    const name = file.name.replace(/\.[^.]+$/, '') || 'Sem título';
    try {
      // The content decides (a file may come without its extension); the name is only a fallback.
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isAsepriteBytes(bytes) || (isAsepriteName(file.name) && bytes.length >= 128)) {
        const doc = await readAseprite(bytes, { name });
        openInTab(doc);
        notify(`"${doc.name}" aberto (${doc.layers.length} camada(s), ${doc.frames.length} quadro(s)).`, 'success');
        return doc;
      }
      if (isImageBytes(bytes) || IMAGE_RE.test(file.name) || file.type.startsWith('image/')) {
        await importImageDialog(editor, { file, open: openInTab });
        return null;
      }
      const doc = deserialize(new TextDecoder().decode(bytes));
      openInTab(doc);
      notify(`"${doc.name}" aberto.`, 'success');
      return doc;
    } catch (error) {
      notify('Arquivo inválido: ' + error.message, 'error', 6000);
      return null;
    }
  }

  async function openFile() {
    const file = await pickFile(OPEN_TYPES);
    if (file) await openFileObject(file);
  }

  // Saved projects: a project already open in a tab is reloaded there; any other opens in a new tab.
  async function openProject(id) {
    const storage = app.storage;
    try {
      const p = await storage.openProject(id);
      const doc = deserialize(p.data);
      const project = storage.type === 'server' ? { id: p.id, revision: p.revision, local: null } : { id: null, revision: null, local: p.id };
      const existing = tabs.find(project);
      if (existing >= 0) {
        tabs.activate(existing);
        if (editor.modified && !(await confirm('Abrir outro projeto', 'As mudanças não salvas deste projeto serão perdidas.', 'Abrir mesmo assim', true))) return;
        editor.load(doc, project);
      } else {
        openInTab(doc, project);
      }
      notify(`"${doc.name}" aberto.`, 'success');
    } catch (error) {
      notify('Não foi possível abrir: ' + error.message, 'error', 6000);
    }
  }

  async function exportAseprite() {
    const doc = editor.doc;
    const bytes = await writeAseprite(doc, { palette: doc.palette?.length ? null : app.palette?.current?.colors });
    downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), fileNameFor(doc.name, 'aseprite'));
    notify(`"${doc.name}" exportado como .aseprite.`, 'success');
  }

  Object.assign(commands, {
    newProject: { ...commands.newProject, fn: () => newDialog(editor, (doc) => openInTab(doc)) },
    openSaved: { ...commands.openSaved, fn: () => projectsDialog(editor, app.storage, openProject) },
    openFile: { label: 'Abrir arquivo…', shortcut: 'Ctrl+O', fn: openFile },
    importImage: { ...commands.importImage, fn: () => importImageDialog(editor, { open: openInTab }) },
    closeTab: { label: 'Fechar projeto (aba)', shortcut: '', fn: () => tabs.close() },
    exportAseprite: { label: 'Exportar como .aseprite', shortcut: '', fn: exportAseprite },
    exportApng: { label: 'Exportar PNG animado (APNG)…', shortcut: '', fn: () => exportImageDialog(editor, 'apng') },
    exportPngZip: { label: 'Exportar quadros em PNG (.zip)…', shortcut: '', fn: () => exportImageDialog(editor, 'zip') },
    nextTab: { label: 'Próxima aba', shortcut: 'Ctrl+Tab', fn: () => tabs.next(1) },
    previousTab: { label: 'Aba anterior', shortcut: 'Ctrl+Shift+Tab', fn: () => tabs.next(-1) },
    preview: { label: 'Pré-visualização', shortcut: 'F7', checked: () => minimap.visible, fn: () => minimap.toggle() },
  });
  app.addMenuItems('Arquivo', ['closeTab'], 'importImage');
  app.addMenuItems('Arquivo', ['exportAseprite'], 'downloadCrivo');
  app.addMenuItems('Arquivo', ['exportApng', 'exportPngZip'], 'exportGif');
  app.addMenuItems('Exibir', ['-', 'preview', 'nextTab', 'previousTab']);
  app.addShortcut({ key: 'tab', ctrl: true, run: () => tabs.next(1) });
  app.addShortcut({ key: 'tab', ctrl: true, shift: true, run: () => tabs.next(-1) });
  app.addShortcut({ key: 'f7', run: () => minimap.toggle() });

  // Drag and drop: .crivo, .aseprite and .ase open in a new tab; images go through the import dialog.
  const area = document.querySelector('.area');
  if (area) {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    area.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      area.classList.add('dropping');
    });
    area.addEventListener('dragleave', (e) => {
      if (!area.contains(e.relatedTarget)) area.classList.remove('dropping');
    });
    area.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      area.classList.remove('dropping');
      for (const file of e.dataTransfer.files) await openFileObject(file);
    });
  }

  app.tabs = tabs;
  app.minimap = minimap;
  app.openFileObject = openFileObject;
  return app;
}
