import { Sketchbook } from '../ui/sketchbook.js';

export function install(app) {
  const sketchbook = new Sketchbook(app);
  const notebook = (kind) => ({
    get label() {
      return sketchbook.nameOf(kind);
    },
    shortcut: '',
    fn: () => sketchbook.show(kind, true),
  });
  Object.assign(app.commands, {
    sketchbook: { label: 'Abrir a estante…', shortcut: 'F8', fn: () => sketchbook.show() },
    sketchbookOpen: notebook('open'),
    sketchbookSaved: notebook('saved'),
    sketchbookBlank: notebook('blank'),
    sketchbookCustomize: { label: 'Personalizar caderno…', shortcut: '', fn: () => sketchbook.show().then(() => sketchbook.customize()) },
  });
  app.addMenu('Caderno', ['sketchbook', '-', 'sketchbookOpen', 'sketchbookSaved', 'sketchbookBlank', '-', 'sketchbookCustomize'], 'Ajuda');
  app.addShortcut({ key: 'f8', run: () => sketchbook.show() });
  app.sketchbook = sketchbook;
}
