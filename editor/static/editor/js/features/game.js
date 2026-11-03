import { GameStudio } from '../ui/game-studio.js';

export function install(app) {
  const studio = new GameStudio(app);
  const open = (tab = null) => studio.show(tab);
  Object.assign(app.commands, {
    gameStudio: { label: 'Abrir o estúdio de jogo…', shortcut: 'F9', fn: () => open() },
    gameTest: { label: 'Testar o jogo', shortcut: 'Shift+F9', fn: () => open().then(() => studio.test()) },
    gameUseDrawing: {
      label: 'Usar o desenho atual como sprite',
      shortcut: '',
      fn: () => open('sprites').then(() => studio.importDoc(app.editor.doc, true)),
    },
    gameSample: { label: 'Abrir o jogo de exemplo…', shortcut: '', fn: () => open().then(() => studio.loadSample()) },
    gameOpen: { label: 'Abrir arquivo .crivojogo…', shortcut: '', fn: () => open().then(() => studio.openFile()) },
    gameSave: { label: 'Salvar arquivo .crivojogo…', shortcut: '', fn: () => studio.saveFile() },
    gameExport: { label: 'Exportar jogo (HTML)…', shortcut: '', fn: () => studio.exportHtml() },
  });
  app.addMenu('Jogo', ['gameStudio', 'gameTest', '-', 'gameUseDrawing', '-', 'gameSample', 'gameOpen', 'gameSave', '-', 'gameExport'], 'Ajuda');
  app.addShortcut({ key: 'f9', run: () => open() });
  app.addShortcut({ key: 'f9', shift: true, run: () => open().then(() => studio.test()) });
  app.gameStudio = studio;
}
