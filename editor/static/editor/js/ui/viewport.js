import { overlay } from '../core/colors.js';
import { brush, mirrors } from '../core/geometry.js';

export const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

export class Viewport {
  constructor(canvas, editor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.editor = editor;
    this.zoom = 16;
    this.panX = 0;
    this.panY = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cursor = null;
    this.preview = null;
    this.dirty = true;
    this.pending = false;
    this.adjusted = false;
    this.offscreen = document.createElement('canvas');
    this.onionCanvas = document.createElement('canvas');
    this.colors = {};
    this.readColors();
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement);
    editor.on('pixels', () => this.invalidate());
    editor.on('document', ({ isNew }) => {
      this.dirty = true;
      if (isNew && this.width > 0) this.fit();
      else if (isNew) this.adjusted = false;
      this.invalidate();
    });
    editor.on('frame', () => this.invalidate());
    editor.on('selection', () => this.request());
    editor.on('state', ({ key }) => {
      if (['grid', 'symmetry', 'onionSkin', 'tool', 'size', 'shape', 'majorGrid', 'tile'].includes(key)) this.request();
    });
    this.phase = 0;
    setInterval(() => {
      if (!this.editor.selection || document.hidden) return;
      this.phase = (this.phase + 1) % 8;
      this.request();
    }, 120);
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    this.colors = {
      area: v('--area'),
      checkerA: v('--checker-a'),
      checkerB: v('--checker-b'),
      grid: v('--grid'),
      majorGrid: v('--grid-major'),
      border: v('--matrix-border'),
      axis: v('--axis'),
      cursor: v('--cursor-light'),
      darkCursor: v('--cursor-dark'),
    };
    this.fallback = null;
    this.request();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (!this.adjusted && r.width > 0) this.fit();
    this.request();
  }

  fit() {
    const doc = this.editor.doc;
    const margin = 48;
    const z = Math.max(1, Math.floor(Math.min((this.width - margin) / doc.width, (this.height - margin) / doc.height)));
    this.zoom = Math.min(128, z);
    this.centerView();
    this.adjusted = true;
    this.emitZoom();
  }

  centerView() {
    const doc = this.editor.doc;
    this.panX = Math.round((this.width - doc.width * this.zoom) / 2);
    this.panY = Math.round((this.height - doc.height * this.zoom) / 2);
    this.request();
  }

  setZoom(z, cx = this.width / 2, cy = this.height / 2) {
    z = Math.max(1, Math.min(128, Math.round(z)));
    if (z === this.zoom) return;
    const mx = (cx - this.panX) / this.zoom;
    const my = (cy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = Math.round(cx - mx * z);
    this.panY = Math.round(cy - my * z);
    this.emitZoom();
    this.request();
  }

  zoomStep(direction, cx, cy) {
    const current = this.zoom;
    let target;
    if (direction > 0) target = ZOOM_LEVELS.find((n) => n > current) ?? 128;
    else target = [...ZOOM_LEVELS].reverse().find((n) => n < current) ?? 1;
    this.setZoom(target, cx, cy);
  }

  emitZoom() {
    this.editor.emit('zoom', { zoom: this.zoom });
  }

  move(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.request();
  }

  screenToMatrix(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const x = Math.floor((sx - this.panX) / this.zoom);
    const y = Math.floor((sy - this.panY) / this.zoom);
    const doc = this.editor.doc;
    return { x, y, sx, sy, inside: x >= 0 && y >= 0 && x < doc.width && y < doc.height };
  }

  setPreview(indices, color) {
    this.preview = indices ? { indices, color } : null;
    this.invalidate();
  }

  setCursor(p) {
    const before = this.cursor;
    this.cursor = p && p.inside ? { x: p.x, y: p.y } : null;
    if (before?.x !== this.cursor?.x || before?.y !== this.cursor?.y) this.request();
  }

  invalidate() {
    this.dirty = true;
    this.request();
  }

  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  composite() {
    const doc = this.editor.doc;
    const { width: L, height: A } = doc;
    if (this.offscreen.width !== L || this.offscreen.height !== A) {
      this.offscreen.width = L;
      this.offscreen.height = A;
      this.onionCanvas.width = L;
      this.onionCanvas.height = A;
      this.data = new ImageData(L, A);
      this.buffer = new Uint32Array(this.data.data.buffer);
      this.onionData = new ImageData(L, A);
      this.onionBuffer = new Uint32Array(this.onionData.data.buffer);
    }
    const q = Math.min(this.editor.state.frame, doc.frames.length - 1);
    doc.composite(q, this.buffer);
    if (this.preview) {
      const { indices, color } = this.preview;
      for (const i of indices) this.buffer[i] = color >>> 24 ? overlay(this.buffer[i], color) : 0;
    }
    this.offscreen.getContext('2d').putImageData(this.data, 0, 0);
    this.hasOnionSkin = false;
    if (this.editor.state.onionSkin && !this.editor.state.playing && q > 0) {
      doc.composite(q - 1, this.onionBuffer);
      this.onionCanvas.getContext('2d').putImageData(this.onionData, 0, 0);
      this.hasOnionSkin = true;
    }
    this.dirty = false;
  }

  checker() {
    if (this.fallback) return this.fallback;
    const t = 8;
    const c = document.createElement('canvas');
    c.width = t * 2;
    c.height = t * 2;
    const g = c.getContext('2d');
    g.fillStyle = this.colors.checkerA;
    g.fillRect(0, 0, t * 2, t * 2);
    g.fillStyle = this.colors.checkerB;
    g.fillRect(0, 0, t, t);
    g.fillRect(t, t, t, t);
    this.fallback = this.ctx.createPattern(c, 'repeat');
    return this.fallback;
  }

  draw() {
    if (this.dirty) this.composite();
    const { ctx, dpr, zoom: z } = this;
    const doc = this.editor.doc;
    const state = this.editor.state;
    const L = doc.width * z;
    const A = doc.height * z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colors.area;
    ctx.fillRect(0, 0, this.width, this.height);
    const fallback = this.checker();
    fallback.setTransform?.(new DOMMatrix().translate(this.panX, this.panY));
    ctx.fillStyle = fallback;
    ctx.fillRect(this.panX, this.panY, L, A);
    ctx.imageSmoothingEnabled = false;
    if (state.tile) {
      // Tile mode: repeats the frame 3×3 around the matrix, faded, to check the seams.
      ctx.globalAlpha = 0.55;
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          if (!tx && !ty) continue;
          const ox = this.panX + tx * L;
          const oy = this.panY + ty * A;
          ctx.fillStyle = fallback;
          ctx.fillRect(ox, oy, L, A);
          ctx.drawImage(this.offscreen, ox, oy, L, A);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (this.hasOnionSkin) {
      ctx.globalAlpha = 0.32;
      ctx.drawImage(this.onionCanvas, this.panX, this.panY, L, A);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.offscreen, this.panX, this.panY, L, A);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const X = (v) => Math.round((this.panX + v * z) * dpr);
    const Y = (v) => Math.round((this.panY + v * z) * dpr);
    const majorStep = Number(state.majorGrid) || 0;
    const isMajor = (v) => majorStep > 0 && v % majorStep === 0;
    if (state.grid && z >= 4) {
      const lines = (major) => {
        ctx.beginPath();
        for (let x = 1; x < doc.width; x++) {
          if (isMajor(x) !== major) continue;
          ctx.moveTo(X(x) + 0.5, Y(0));
          ctx.lineTo(X(x) + 0.5, Y(doc.height));
        }
        for (let y = 1; y < doc.height; y++) {
          if (isMajor(y) !== major) continue;
          ctx.moveTo(X(0), Y(y) + 0.5);
          ctx.lineTo(X(doc.width), Y(y) + 0.5);
        }
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.colors.grid;
      lines(false);
      if (majorStep > 0 && (doc.width > majorStep || doc.height > majorStep)) {
        ctx.strokeStyle = this.colors.majorGrid;
        lines(true);
      }
    }
    if (state.symmetry !== 'none') {
      ctx.save();
      ctx.strokeStyle = this.colors.axis;
      ctx.lineWidth = Math.max(1, Math.round(dpr * 1.5));
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      if (state.symmetry === 'horizontal' || state.symmetry === 'both') {
        const cx = Math.round((this.panX + (doc.width / 2) * z) * dpr);
        ctx.moveTo(cx, Y(0) - 10 * dpr);
        ctx.lineTo(cx, Y(doc.height) + 10 * dpr);
      }
      if (state.symmetry === 'vertical' || state.symmetry === 'both') {
        const cy = Math.round((this.panY + (doc.height / 2) * z) * dpr);
        ctx.moveTo(X(0) - 10 * dpr, cy);
        ctx.lineTo(X(doc.width) + 10 * dpr, cy);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.strokeRect(X(0) - 0.5, Y(0) - 0.5, X(doc.width) - X(0) + 1, Y(doc.height) - Y(0) + 1);
    if (this.editor.selection) this.drawSelection(X, Y);
    if (this.cursor && !state.playing && !['move', 'movePixels'].includes(state.tool)) this.drawCursor(X, Y);
  }

  // Selection: dashed two-color rectangle that "walks" (marching ants), visible over any background.
  drawSelection(X, Y) {
    const { ctx, dpr } = this;
    const r = this.editor.selection;
    const x = X(r.x) + 0.5;
    const y = Y(r.y) + 0.5;
    const l = X(r.x + r.width) - X(r.x) - 1;
    const a = Y(r.y + r.height) - Y(r.y) - 1;
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.setLineDash([]);
    ctx.strokeStyle = this.colors.darkCursor || '#000';
    ctx.strokeRect(x, y, l, a);
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineDashOffset = -this.phase * dpr;
    ctx.strokeStyle = this.colors.cursor || '#fff';
    ctx.strokeRect(x, y, l, a);
    ctx.restore();
  }

  drawCursor(X, Y) {
    const { ctx, dpr } = this;
    const state = this.editor.state;
    const usesBrush = ['pencil', 'eraser', 'line', 'dither', 'shade'].includes(state.tool);
    const doc = this.editor.doc;
    const points = usesBrush ? brush(state.size, state.shape) : [[0, 0]];
    const cells = new Map();
    for (const [dx, dy] of points) {
      for (const [x, y] of mirrors(this.cursor.x + dx, this.cursor.y + dy, doc.width, doc.height, state.symmetry)) cells.set(`${x},${y}`, [x, y]);
    }
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    for (const [color, offset] of [[this.colors.darkCursor, 1], [this.colors.cursor, 0]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [x, y] of cells.values()) {
        ctx.rect(X(x) + 0.5 + offset, Y(y) + 0.5 + offset, X(x + 1) - X(x) - 1, Y(y + 1) - Y(y) - 1);
      }
      ctx.stroke();
    }
  }
}
