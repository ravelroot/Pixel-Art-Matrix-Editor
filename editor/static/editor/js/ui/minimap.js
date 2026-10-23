// Preview window (Exibir → Pré-visualização, F7): the whole current frame, fitted or at 1:1, with the part
// the main viewport shows outlined. Clicking or dragging on it moves the main view there, and it can play
// the animation on its own while you keep drawing on the current frame.
import { el, readPreference, writePreference } from './util.js';
import { icon } from './icons.js';

const SIDE = 200;

export class Minimap {
  constructor(container, editor, viewport) {
    this.container = container;
    this.editor = editor;
    this.viewport = viewport;
    this.mode = readPreference('minimapMode', 'fit') === 'actual' ? 'actual' : 'fit';
    this.playing = false;
    this.playFrame = 0;
    this.timer = null;
    this.dirty = true;
    this.last = '';
    this.image = document.createElement('canvas');
    this.canvas = el('canvas', { class: 'minimap-canvas', 'aria-label': 'Pré-visualização do quadro. Clique para mover a visão.' });
    this.playButton = el('button', { type: 'button', class: 'icon-button small', title: 'Tocar a animação na pré-visualização', 'aria-label': 'Tocar a animação na pré-visualização', onclick: () => this.togglePlay() });
    const mode = el(
      'select',
      { 'aria-label': 'Tamanho da pré-visualização' },
      el('option', { value: 'fit', selected: this.mode === 'fit' }, 'Ajustar'),
      el('option', { value: 'actual', selected: this.mode === 'actual' }, '1:1'),
    );
    mode.addEventListener('change', () => {
      this.mode = mode.value;
      writePreference('minimapMode', this.mode);
      this.invalidate();
    });
    const close = el('button', { type: 'button', class: 'icon-button small', title: 'Fechar a pré-visualização (F7)', 'aria-label': 'Fechar a pré-visualização', onclick: () => this.show(false) }, '×');
    this.body = el('div', { class: 'minimap-body' }, this.canvas);
    container.replaceChildren(el('div', { class: 'minimap-head' }, el('strong', {}, 'Pré-visualização'), this.playButton, mode, close), this.body);
    this.updatePlayButton();
    for (const type of ['pixels', 'document', 'frame', 'tab']) editor.on(type, () => this.invalidate());
    editor.on('document', ({ isNew } = {}) => {
      if (isNew) this.stopPlay();
    });
    let dragging = false;
    const pan = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const doc = this.editor.doc;
      const x = ((e.clientX - r.left) / r.width) * doc.width;
      const y = ((e.clientY - r.top) / r.height) * doc.height;
      const v = this.viewport;
      v.panX = Math.round(v.width / 2 - x * v.zoom);
      v.panY = Math.round(v.height / 2 - y * v.zoom);
      v.request();
      this.frameLoop();
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      pan(e);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && pan(e));
    const stop = () => (dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.show(readPreference('minimap', false) === true, false);
  }

  get visible() {
    return !this.container.hidden;
  }

  show(on = !this.visible, remember = true) {
    this.container.hidden = !on;
    if (remember) writePreference('minimap', on);
    if (!on) this.stopPlay();
    this.invalidate();
  }

  toggle() {
    this.show(!this.visible);
  }

  invalidate() {
    this.dirty = true;
    this.frameLoop();
  }

  // Redraws on the next animation frame, and keeps watching the main view (zoom and scroll) while visible.
  frameLoop() {
    if (this.pending || !this.visible) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (!this.visible) return;
      const v = this.viewport;
      const key = [v.zoom, v.panX, v.panY, v.width, v.height].join(',');
      if (this.dirty || key !== this.last) this.draw();
      this.last = key;
      this.frameLoop();
    });
  }

  frameIndex() {
    const n = this.editor.doc.frames.length;
    return Math.min(this.playing ? this.playFrame : this.editor.state.frame, n - 1);
  }

  draw() {
    const doc = this.editor.doc;
    const { width: W, height: H } = doc;
    if (this.image.width !== W || this.image.height !== H) {
      this.image.width = W;
      this.image.height = H;
      this.data = new ImageData(W, H);
      this.buffer = new Uint32Array(this.data.data.buffer);
    }
    doc.composite(this.frameIndex(), this.buffer);
    this.image.getContext('2d').putImageData(this.data, 0, 0);
    const scale = this.mode === 'actual' ? 1 : Math.min(SIDE / W, SIDE / H) >= 1 ? Math.floor(Math.min(SIDE / W, SIDE / H)) : Math.min(SIDE / W, SIDE / H);
    const cw = Math.max(1, Math.round(W * scale));
    const ch = Math.max(1, Math.round(H * scale));
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
      c.style.width = cw + 'px';
      c.style.height = ch + 'px';
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, 0, 0, cw, ch);
    const v = this.viewport;
    const x = (-v.panX / v.zoom) * scale;
    const y = (-v.panY / v.zoom) * scale;
    const w = (v.width / v.zoom) * scale;
    const h = (v.height / v.zoom) * scale;
    if (x > 0 || y > 0 || x + w < cw || y + h < ch) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeRect(Math.round(x) + 1.5, Math.round(y) + 1.5, Math.round(w) - 1, Math.round(h) - 1);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    }
    this.dirty = false;
  }

  togglePlay() {
    if (this.playing) this.stopPlay();
    else this.startPlay();
  }

  startPlay() {
    const doc = this.editor.doc;
    if (doc.frames.length < 2) return;
    this.playing = true;
    this.playFrame = this.editor.state.frame;
    const step = () => {
      if (!this.playing) return;
      const d = this.editor.doc;
      this.playFrame = (this.playFrame + 1) % d.frames.length;
      this.invalidate();
      this.timer = setTimeout(step, d.frames[this.playFrame]?.duration || 1000 / d.fps);
    };
    this.timer = setTimeout(step, doc.frames[this.playFrame]?.duration || 1000 / doc.fps);
    this.updatePlayButton();
  }

  stopPlay() {
    if (!this.playing) return;
    clearTimeout(this.timer);
    this.playing = false;
    this.updatePlayButton();
    this.invalidate();
  }

  updatePlayButton() {
    this.playButton.innerHTML = icon(this.playing ? 'pause' : 'play', 14);
    const label = this.playing ? 'Pausar a pré-visualização' : 'Tocar a animação na pré-visualização';
    this.playButton.title = label;
    this.playButton.setAttribute('aria-label', label);
    this.playButton.setAttribute('aria-pressed', String(this.playing));
  }
}
