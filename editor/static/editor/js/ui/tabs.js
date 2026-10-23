// Several documents open at once, one per tab above the canvas. The active document lives in the editor
// (editor.doc, editor.history...); the others are parked as sessions (Editor.captureSession) together with
// their zoom and scroll, and come back exactly as they were.
import { PixelDocument } from '../core/document.js';
import { History } from '../core/history.js';
import { el, notify } from './util.js';
import { confirm } from './dialog.js';

let sequence = 0;

export class Tabs {
  constructor(container, editor, viewport) {
    this.container = container;
    this.editor = editor;
    this.viewport = viewport;
    this.tabs = [{ id: ++sequence, session: null, view: null }];
    this.active = 0;
    editor.on('history', () => this.render());
    editor.on('document', () => this.render());
    this.render();
  }

  get count() {
    return this.tabs.length;
  }

  // Name and modified flag of tab i (the active one reads from the editor).
  info(i) {
    const s = i === this.active ? this.editor : this.tabs[i].session;
    return { name: s.doc.name, modified: Boolean(s.modified) };
  }

  park() {
    const tab = this.tabs[this.active];
    tab.session = this.editor.captureSession();
    tab.view = { zoom: this.viewport.zoom, panX: this.viewport.panX, panY: this.viewport.panY };
  }

  bring(i) {
    const tab = this.tabs[i];
    this.active = i;
    this.editor.restoreSession(tab.session);
    tab.session = null;
    if (tab.view) {
      Object.assign(this.viewport, tab.view);
      this.viewport.emitZoom();
      this.viewport.request();
    }
    this.render();
    this.editor.emit('tab', { index: i });
  }

  activate(i) {
    if (i === this.active || i < 0 || i >= this.tabs.length) return;
    if (this.editor.state.playing) this.editor.stop();
    this.park();
    this.bring(i);
  }

  next(delta = 1) {
    if (this.tabs.length < 2) return;
    this.activate((this.active + delta + this.tabs.length) % this.tabs.length);
  }

  // A blank, untouched "Sem título" is replaced instead of piling up an empty tab.
  pristine() {
    const e = this.editor;
    if (e.modified || e.history.canUndo || e.history.canRedo || e.project.id || e.project.local) return false;
    for (const px of e.doc.cells.values()) if (px.some((v) => v !== 0)) return false;
    return true;
  }

  // Opens a document in a new tab (or in the current one, when it is a blank untitled document).
  open(doc, project = { id: null, local: null, revision: null }) {
    if (this.editor.state.playing) this.editor.stop();
    if (!this.pristine()) {
      this.park();
      this.tabs.splice(this.active + 1, 0, { id: ++sequence, session: null, view: null });
      this.active++;
      this.editor.history = new History();
    }
    this.editor.load(doc, project);
    this.render();
    this.editor.emit('tab', { index: this.active });
  }

  // Index of the tab that holds a saved project (server id or browser id), or -1.
  find(project) {
    return this.tabs.findIndex((t, i) => {
      const p = i === this.active ? this.editor.project : t.session.project;
      return (project.id && p.id === project.id) || (project.local && p.local === project.local);
    });
  }

  async close(i = this.active) {
    const { name, modified } = this.info(i);
    if (modified && !(await confirm('Fechar projeto', `"${name}" tem mudanças não salvas, que serão perdidas.`, 'Fechar sem salvar', true))) return false;
    if (this.tabs.length === 1) {
      this.editor.history = new History();
      this.editor.load(new PixelDocument(32, 32, { name: 'Sem título' }));
      this.render();
      return true;
    }
    if (i === this.active) {
      this.tabs.splice(i, 1);
      this.bring(Math.min(i, this.tabs.length - 1));
    } else {
      this.tabs.splice(i, 1);
      if (i < this.active) this.active--;
      this.render();
    }
    notify(`"${name}" fechado.`, 'info', 1400);
    return true;
  }

  render() {
    if (!this.container) return;
    const items = this.tabs.map((tab, i) => {
      const { name, modified } = this.info(i);
      const selected = i === this.active;
      return el(
        'div',
        { class: 'doc-tab' + (selected ? ' active' : ''), data: { index: i } },
        el(
          'button',
          {
            type: 'button',
            class: 'doc-tab-name',
            role: 'tab',
            'aria-selected': String(selected),
            title: name,
            onclick: () => this.activate(i),
            onauxclick: (e) => {
              if (e.button === 1) this.close(i);
            },
          },
          modified ? '• ' : '',
          name,
        ),
        el('button', { type: 'button', class: 'doc-tab-close', title: `Fechar "${name}"`, 'aria-label': `Fechar "${name}"`, onclick: () => this.close(i) }, '×'),
      );
    });
    this.container.replaceChildren(...items);
  }
}
