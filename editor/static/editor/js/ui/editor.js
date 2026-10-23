import { PixelDocument } from '../core/document.js';
import { History, Stroke } from '../core/history.js';
import { hexToColor, colorToHex } from '../core/colors.js';
import { clipToDocument } from '../core/selection.js';
import { notify, readPreference, writePreference } from './util.js';

const PREFERENCES = [
  'tool', 'size', 'shape', 'symmetry', 'grid', 'filled', 'connectivity', 'tolerance', 'contiguous', 'sample', 'eraserMode', 'onionSkin', 'palette',
  'pixelPerfect', 'density', 'ditherBackground', 'gradientType', 'gradientMatrix', 'shadeMode', 'shadeIntensity', 'majorGrid', 'tile',
];

// Accepted values for each preference read from localStorage (which may have been edited by hand).
const ALLOWED = {
  shape: ['square', 'circle'],
  symmetry: ['none', 'horizontal', 'vertical', 'both'],
  connectivity: [4, 8],
  sample: ['layer', 'all'],
  eraserMode: ['transparent', 'background'],
  density: [12.5, 25, 37.5, 50, 62.5, 75, 87.5],
  ditherBackground: ['secondary', 'keep'],
  gradientType: ['linear', 'radial'],
  gradientMatrix: [2, 4, 8],
  shadeMode: ['palette', 'light'],
  majorGrid: [0, 4, 8, 16, 32],
};
const RANGES = { size: [1, 32], tolerance: [0, 100], shadeIntensity: [2, 30] };
const BOOLEANS = ['grid', 'filled', 'contiguous', 'onionSkin', 'pixelPerfect', 'tile'];

function isValidPreference(key, value) {
  if (key === 'tool') return VALID_TOOLS.includes(value);
  if (key === 'palette') return typeof value === 'string' && value.length <= 80;
  if (ALLOWED[key]) return ALLOWED[key].includes(value);
  if (RANGES[key]) return Number.isInteger(value) && value >= RANGES[key][0] && value <= RANGES[key][1];
  if (BOOLEANS.includes(key)) return typeof value === 'boolean';
  return false;
}

export const VALID_TOOLS = ['pencil', 'eraser', 'bucket', 'line', 'rectangle', 'ellipse', 'eyedropper', 'move', 'selection', 'movePixels', 'dither', 'gradient', 'shade'];

export class Editor extends EventTarget {
  constructor() {
    super();
    this.history = new History();
    this.state = {
      tool: 'pencil',
      primaryColor: hexToColor('#5d1c16'),
      secondaryColor: hexToColor('#e6ddce'),
      size: 1,
      shape: 'square',
      symmetry: 'none',
      grid: true,
      filled: false,
      connectivity: 4,
      tolerance: 0,
      contiguous: true,
      sample: 'layer',
      eraserMode: 'transparent',
      onionSkin: false,
      palette: 'crivo',
      pixelPerfect: false,
      density: 50,
      ditherBackground: 'secondary',
      gradientType: 'linear',
      gradientMatrix: 4,
      shadeMode: 'palette',
      shadeIntensity: 8,
      majorGrid: 8,
      tile: false,
      frame: 0,
      layerId: null,
      playing: false,
    };
    for (const k of PREFERENCES) {
      const fallback = this.state[k];
      const stored = readPreference(k, fallback);
      this.state[k] = isValidPreference(k, stored) ? stored : fallback;
    }
    if (!VALID_TOOLS.includes(this.state.tool)) this.state.tool = 'pencil';
    this.state.size = Math.max(1, Math.min(32, Math.round(this.state.size) || 1));
    this.selection = null;
    this.floating = null;
    this.clipboard = null;
    this.recent = readPreference('recent', []).map(hexToColor).filter((c) => c !== null);
    this.project = { id: null, local: null, revision: null };
    this.modified = false;
    this.savedVersion = 0;
    this.load(new PixelDocument(32, 32, { name: 'Sem título' }));
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail: detail }));
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }

  load(doc, project = { id: null, local: null, revision: null }) {
    this.doc = doc;
    this.project = { ...project };
    this.history.clear();
    this.state.frame = 0;
    this.state.layerId = doc.layers.at(-1).id;
    this.modified = false;
    this.savedVersion = this.history.version;
    this.selection = null;
    this.emit('selection', null);
    this.emit('document', { isNew: true });
    this.emit('history');
  }

  get currentFrame() {
    return this.doc.frames[Math.min(this.state.frame, this.doc.frames.length - 1)];
  }

  get currentLayer() {
    return this.doc.layer(this.state.layerId) ?? this.doc.layers.at(-1);
  }

  get activeKey() {
    return this.doc.key(this.currentFrame.id, this.currentLayer.id);
  }

  activeCell() {
    return this.doc.cell(this.currentFrame.id, this.currentLayer.id);
  }

  setState(key, value) {
    if (this.state[key] === value) return;
    this.state[key] = value;
    if (PREFERENCES.includes(key)) writePreference(key, value);
    this.emit('state', { key, value });
  }

  setColor(which, color) {
    const key = which === 'secondary' ? 'secondaryColor' : 'primaryColor';
    this.state[key] = color >>> 0;
    this.emit('color', { which });
  }

  swapColors() {
    [this.state.primaryColor, this.state.secondaryColor] = [this.state.secondaryColor, this.state.primaryColor];
    this.emit('color', { which: 'both' });
  }

  rememberColor(color) {
    if (!(color >>> 24)) return;
    this.recent = [color, ...this.recent.filter((c) => c !== color)].slice(0, 16);
    writePreference('recent', this.recent.map((c) => colorToHex(c, true)));
    this.emit('recent');
  }

  canEditLayer(warn = true) {
    const c = this.currentLayer;
    if (c.locked) {
      if (warn) notify(`A camada "${c.name}" está bloqueada.`, 'warning');
      return false;
    }
    if (!c.visible) {
      if (warn) notify(`A camada "${c.name}" está oculta. Mostre a camada para desenhar nela.`, 'warning');
      return false;
    }
    return true;
  }

  newStroke() {
    if (this.state.playing) this.stop();
    if (!this.canEditLayer()) return null;
    return new Stroke(this.activeKey, this.activeCell());
  }

  finishStroke(stroke, label) {
    const entry = stroke.finish(label);
    if (!entry) return false;
    this.history.record(entry, { frame: this.state.frame, layerId: this.state.layerId });
    this.markModified();
    this.emit('pixels', { thumbnails: true });
    return true;
  }

  editStructure(label, fn) {
    if (this.state.playing) this.stop();
    const before = this.doc.snapshot();
    let result;
    try {
      result = fn(this.doc);
    } catch (error) {
      this.doc.restore(before);
      throw error;
    }
    if (result === false) return false;
    this.history.recordState(label, before, this.doc.snapshot(), { frame: this.state.frame, layerId: this.state.layerId });
    this.fixSelection();
    this.markModified();
    this.emit('document');
    return result ?? true;
  }

  fixSelection() {
    if (this.state.frame >= this.doc.frames.length) this.state.frame = this.doc.frames.length - 1;
    if (!this.doc.layer(this.state.layerId)) this.state.layerId = this.doc.layers.at(-1).id;
    if (this.selection) {
      const r = clipToDocument(this.selection, this.doc.width, this.doc.height);
      if (r?.x !== this.selection.x || r?.y !== this.selection.y || r?.width !== this.selection.width || r?.height !== this.selection.height) this.setSelection(r);
    }
  }

  setSelection(r, { keepFloating = false } = {}) {
    this.selection = r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    if (!keepFloating) this.floating = null;
    this.emit('selection', this.selection);
  }

  // The selection may leave the matrix while the content floats; commands always use the part that fits in it.
  get clippedSelection() {
    return this.selection ? clipToDocument(this.selection, this.doc.width, this.doc.height) : null;
  }

  // Content lifted by Move pixels or by Paste, valid only if nothing changed in the document since then.
  floatingValid() {
    const f = this.floating;
    if (!f || f.version !== this.history.version || f.key !== this.activeKey) return null;
    return f;
  }

  // Applies a list of [index, color] pairs to the active cell as a single history step.
  applyChanges(label, changes, { silent = false } = {}) {
    const stroke = this.newStroke();
    if (!stroke) return false;
    for (const [i, color] of changes) stroke.paint(i, color);
    const ok = this.finishStroke(stroke, label);
    if (!ok && !silent) notify('Nada mudou.', 'info', 1200);
    return ok;
  }

  markModified() {
    this.modified = true;
    this.emit('history');
  }

  undo() {
    if (this.state.playing) this.stop();
    const e = this.history.undo(this.doc);
    if (!e) return;
    this.afterTimeTravel(e);
    notify(`Desfeito: ${e.label}`, 'info', 1400);
  }

  redo() {
    if (this.state.playing) this.stop();
    const e = this.history.redo(this.doc);
    if (!e) return;
    this.afterTimeTravel(e);
    notify(`Refeito: ${e.label}`, 'info', 1400);
  }

  afterTimeTravel(e) {
    if (e.context && e.type !== 'state') {
      this.state.frame = e.context.frame;
      if (this.doc.layer(e.context.layerId)) this.state.layerId = e.context.layerId;
    }
    this.fixSelection();
    this.modified = this.history.version !== this.savedVersion;
    this.emit(e.type === 'state' ? 'document' : 'pixels', { thumbnails: true });
    this.emit('history');
  }

  markSaved(project) {
    this.project = { ...this.project, ...project };
    this.modified = false;
    this.savedVersion = this.history.version;
    this.emit('history');
    this.emit('saved');
  }

  selectFrame(i) {
    this.state.frame = Math.max(0, Math.min(this.doc.frames.length - 1, i));
    this.emit('frame');
    this.emit('pixels');
  }

  selectLayer(id) {
    this.state.layerId = id;
    this.emit('layer');
  }

  play() {
    if (this.state.playing || this.doc.frames.length < 2) return;
    this.state.playing = true;
    this.frameBeforePlay = this.state.frame;
    const step = () => {
      if (!this.state.playing) return;
      this.state.frame = (this.state.frame + 1) % this.doc.frames.length;
      this.emit('frame');
      this.emit('pixels');
      const q = this.currentFrame;
      this.timer = setTimeout(step, q.duration || 1000 / this.doc.fps);
    };
    this.timer = setTimeout(step, this.currentFrame.duration || 1000 / this.doc.fps);
    this.emit('state', { key: 'playing', value: true });
  }

  stop() {
    if (!this.state.playing) return;
    clearTimeout(this.timer);
    this.state.playing = false;
    this.state.frame = this.frameBeforePlay ?? this.state.frame;
    this.emit('state', { key: 'playing', value: false });
    this.emit('frame');
    this.emit('pixels');
  }
}
