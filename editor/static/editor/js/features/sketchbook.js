import { Sketchbook } from '../ui/sketchbook.js';

export function install(app) {
  const sketchbook = new Sketchbook(app);
  app.commands.sketchbook = { label: 'Caderno…', shortcut: 'F8', fn: () => sketchbook.show() };
  app.addMenuItems('Exibir', ['sketchbook'], 'preview');
  app.addShortcut({ key: 'f8', run: () => sketchbook.show() });
  app.sketchbook = sketchbook;
}
