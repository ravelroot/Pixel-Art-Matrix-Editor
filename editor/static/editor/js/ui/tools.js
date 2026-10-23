import { line, rectangle, ellipse, brush, mirrors, constrain, lCorner } from '../core/geometry.js';
import { region } from '../core/fill.js';
import { colorToHex } from '../core/colors.js';
import { patternPixel, gradient } from '../core/dither.js';
import { rectFrom, clipToDocument, contains, extractRegion, pasteRegion, indicesOf } from '../core/selection.js';
import { lightnessStep, paletteStep, paletteRamp } from '../core/filters.js';
import { notify } from './util.js';

export const TOOLS = [
  { id: 'pencil', name: 'Lápis', shortcut: 'B', icon: 'pencil', options: ['size', 'shape', 'pixelPerfect'] },
  { id: 'eraser', name: 'Borracha', shortcut: 'E', icon: 'eraser', options: ['size', 'shape', 'eraserMode'] },
  { id: 'bucket', name: 'Balde de tinta', shortcut: 'F', icon: 'bucket', options: ['connectivity', 'tolerance', 'contiguous', 'sample'] },
  { id: 'line', name: 'Linha', shortcut: 'L', icon: 'line', options: ['size'] },
  { id: 'rectangle', name: 'Retângulo', shortcut: 'R', icon: 'rectangle', options: ['filled'] },
  { id: 'ellipse', name: 'Elipse e círculo', shortcut: 'O', icon: 'ellipse', options: ['filled'] },
  { id: 'dither', name: 'Pontilhado', shortcut: 'D', icon: 'dither', options: ['size', 'shape', 'density', 'ditherBackground'] },
  { id: 'gradient', name: 'Degradê pontilhado', shortcut: 'U', icon: 'gradient', options: ['gradientType', 'gradientMatrix'] },
  { id: 'shade', name: 'Clarear e escurecer', shortcut: 'Q', icon: 'shade', options: ['size', 'shape', 'shadeMode', 'shadeIntensity'] },
  { id: 'eyedropper', name: 'Conta-gotas', shortcut: 'I', icon: 'eyedropper', options: ['sample'] },
  { id: 'selection', name: 'Seleção retangular', shortcut: 'S', icon: 'selection', options: [] },
  { id: 'movePixels', name: 'Mover pixels', shortcut: 'V', icon: 'movePixels', options: [] },
  { id: 'move', name: 'Mover a visão', shortcut: 'H', icon: 'move', options: [] },
];

const BRUSHES = ['pencil', 'eraser', 'dither', 'shade'];
const LABELS = { pencil: 'Lápis', eraser: 'Borracha', dither: 'Pontilhado', shade: 'Clarear e escurecer' };

export class Controller {
  constructor(editor, viewport) {
    this.editor = editor;
    this.viewport = viewport;
    this.active = null;
    this.spaceHeld = false;
    this.lastPoint = null;
    this.palette = () => [];
    const c = viewport.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    c.addEventListener('pointerleave', () => {
      if (!this.active) {
        this.viewport.setCursor(null);
        this.editor.emit('pointer', null);
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          if (e.shiftKey && !e.ctrlKey) this.viewport.move(-e.deltaY, 0);
          else this.viewport.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
        } else {
          this.viewport.move(-e.deltaX, -e.deltaY);
        }
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !this.fieldHasFocus(e)) {
        this.spaceHeld = true;
        c.classList.add('dragging');
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        c.classList.remove('dragging');
      }
    });
  }

  fieldHasFocus(e) {
    const t = e.target;
    return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  }

  get state() {
    return this.editor.state;
  }

  color(button) {
    return button === 2 ? this.state.secondaryColor : this.state.primaryColor;
  }

  pointerDown(e) {
    if (this.active) return;
    const p = this.viewport.screenToMatrix(e.clientX, e.clientY);
    this.viewport.canvas.setPointerCapture(e.pointerId);
    const tool = this.state.tool;
    if (e.button === 1 || this.spaceHeld || tool === 'move') {
      this.active = { type: 'pan', x: e.clientX, y: e.clientY };
      this.viewport.canvas.classList.add('dragging');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (e.altKey && ['pencil', 'eraser', 'bucket', 'line', 'rectangle', 'ellipse', 'dither', 'gradient'].includes(tool)) {
      this.pickColor(p, e.button);
      this.active = { type: 'sample', button: e.button };
      return;
    }
    const button = e.button;
    if (tool === 'eyedropper') {
      this.pickColor(p, button);
      this.active = { type: 'sample', button };
      return;
    }
    if (tool === 'bucket') {
      this.bucket(p, button);
      return;
    }
    if (tool === 'selection') {
      this.active = { type: 'selection', start: p, end: p, dragged: false, previous: this.editor.selection };
      return;
    }
    if (tool === 'movePixels') {
      this.startMove(p);
      return;
    }
    const stroke = this.editor.newStroke();
    if (!stroke) return;
    if (tool === 'gradient') {
      this.active = { type: 'gradient', stroke, button, start: p, end: p, pending: 0 };
      return;
    }
    if (BRUSHES.includes(tool)) {
      const color = this.brushColor(tool, button, stroke);
      const pixelPerfect = tool === 'pencil' && this.state.pixelPerfect && this.state.size === 1;
      this.active = { type: 'stroke', stroke, color, last: p, pixelPerfect, points: [[p.x, p.y]] };
      if (e.shiftKey && this.lastPoint) line(this.lastPoint.x, this.lastPoint.y, p.x, p.y, (x, y) => this.stamp(stroke, x, y, color));
      else this.stamp(stroke, p.x, p.y, color);
      this.editor.emit('pixels');
      return;
    }
    const color = this.color(button);
    this.active = { type: 'shape', stroke, color, start: p, end: p };
    this.updateShape(e);
  }

  // Fixed color (pencil, eraser) or a function (x, y, index) => color | null (dither, lighten and darken).
  brushColor(tool, button, stroke) {
    if (tool === 'eraser') return this.eraserColor(button);
    if (tool === 'pencil') return this.color(button);
    if (tool === 'dither') {
      const front = this.color(button);
      const background = this.color(button === 2 ? 0 : 2);
      const density = this.state.density / 100;
      const usesBackground = this.state.ditherBackground === 'secondary';
      return (x, y) => (patternPixel(x, y, density) ? front : usesBackground ? background : null);
    }
    const direction = button === 2 ? -1 : 1;
    const touched = new Set();
    const pixels = stroke.pixels;
    if (this.state.shadeMode === 'palette') {
      const ramp = paletteRamp(this.palette());
      if (ramp.length < 2) notify('A paleta atual precisa de pelo menos 2 cores para o modo rampa.', 'warning');
      return (x, y, i) => {
        if (touched.has(i)) return null;
        touched.add(i);
        return pixels[i] >>> 24 ? paletteStep(pixels[i], ramp, direction) : null;
      };
    }
    const step = (direction * this.state.shadeIntensity) / 100;
    return (x, y, i) => {
      if (touched.has(i)) return null;
      touched.add(i);
      return pixels[i] >>> 24 ? lightnessStep(pixels[i], step) : null;
    };
  }

  eraserColor(button) {
    if (this.state.eraserMode === 'background') return button === 2 ? this.state.primaryColor : this.state.secondaryColor;
    return 0;
  }

  pointerMove(e) {
    const p = this.viewport.screenToMatrix(e.clientX, e.clientY);
    this.viewport.setCursor(p);
    this.editor.emit('pointer', p.inside ? p : null);
    const a = this.active;
    if (!a) return;
    if (a.type === 'pan') {
      this.viewport.move(e.clientX - a.x, e.clientY - a.y);
      a.x = e.clientX;
      a.y = e.clientY;
    } else if (a.type === 'sample') {
      this.pickColor(p, a.button);
    } else if (a.type === 'stroke') {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events) {
        const q = this.viewport.screenToMatrix(ev.clientX, ev.clientY);
        if (q.x === a.last.x && q.y === a.last.y) continue;
        let first = true;
        line(a.last.x, a.last.y, q.x, q.y, (x, y) => {
          if (first) {
            first = false;
            return;
          }
          this.stamp(a.stroke, x, y, a.color);
          if (a.pixelPerfect) this.filterCorners(a, x, y);
        });
        a.last = q;
      }
      this.editor.emit('pixels');
    } else if (a.type === 'selection') {
      if (p.x !== a.start.x || p.y !== a.start.y) a.dragged = true;
      a.end = p;
      this.updateSelection(e);
    } else if (a.type === 'movePixels') {
      this.updateMove(p.x - a.start.x, p.y - a.start.y);
    } else if (a.type === 'gradient') {
      let { x, y } = p;
      if (e.shiftKey) [x, y] = constrain(a.start.x, a.start.y, x, y, 'line');
      if (x !== a.end.x || y !== a.end.y) {
        a.end = { x, y };
        if (!a.pending) {
          a.pending = requestAnimationFrame(() => {
            a.pending = 0;
            if (this.active === a) this.updateGradient();
          });
        }
      }
    } else if (a.type === 'shape') {
      a.end = p;
      this.updateShape(e);
    }
  }

  pointerUp(e, cancelled = false) {
    const a = this.active;
    this.active = null;
    this.viewport.canvas.classList.remove('dragging');
    if (!a) return;
    if (a.type === 'stroke' || a.type === 'gradient' || a.type === 'movePixels') {
      if (cancelled) {
        a.stroke.revertVisual();
        if (a.type === 'movePixels') this.editor.setSelection(a.originalSelection);
        this.editor.emit('pixels');
        return;
      }
      if (a.type === 'stroke') {
        this.lastPoint = a.last;
        this.editor.finishStroke(a.stroke, LABELS[this.state.tool] ?? 'Pincel');
        if (typeof a.color === 'number') this.editor.rememberColor(a.color);
      } else if (a.type === 'gradient') {
        if (a.pending) cancelAnimationFrame(a.pending);
        if (a.end.x === a.start.x && a.end.y === a.start.y) {
          // Click without dragging: there is no direction for the gradient, so nothing is painted.
          a.stroke.revertVisual();
          this.editor.emit('pixels');
          notify('Arraste de onde o degradê começa até onde ele termina.', 'info', 1600);
          return;
        }
        this.active = a;
        this.updateGradient();
        this.active = null;
        this.editor.finishStroke(a.stroke, 'Degradê pontilhado');
      } else {
        this.finishMove(a);
      }
    } else if (a.type === 'selection') {
      if (cancelled) {
        this.editor.setSelection(a.previous);
        return;
      }
      if (!a.dragged) this.editor.setSelection(null);
    } else if (a.type === 'shape') {
      this.viewport.setPreview(null);
      if (cancelled) return;
      for (const i of a.points ?? []) a.stroke.paint(i, a.color);
      const names = { line: 'Linha', rectangle: 'Retângulo', ellipse: 'Elipse' };
      this.lastPoint = a.end;
      this.editor.finishStroke(a.stroke, names[this.state.tool] ?? 'Forma');
      this.editor.rememberColor(a.color);
    }
  }

  cancel() {
    if (this.active) this.pointerUp(null, true);
  }

  // Inside the matrix and, if there is a selection, inside it: painting tools only touch that area.
  inside(x, y) {
    const d = this.editor.doc;
    return x >= 0 && y >= 0 && x < d.width && y < d.height && contains(this.editor.selection, x, y);
  }

  stamp(stroke, x, y, color) {
    const d = this.editor.doc;
    const points = brush(this.state.size, this.state.shape);
    const isFunction = typeof color === 'function';
    for (const [dx, dy] of points) {
      for (const [px, py] of mirrors(x + dx, y + dy, d.width, d.height, this.state.symmetry)) {
        if (!this.inside(px, py)) continue;
        const i = py * d.width + px;
        const c = isFunction ? color(px, py, i) : color;
        if (c !== null && c !== undefined) stroke.paint(i, c);
      }
    }
  }

  // Pixel perfect: undoes the middle pixel when the last three form an L corner.
  filterCorners(a, x, y) {
    a.points.push([x, y]);
    if (a.points.length < 3) return;
    const [p0, p1, p2] = a.points.slice(-3);
    if (lCorner(p0, p1, p2)) {
      const d = this.editor.doc;
      for (const [px, py] of mirrors(p1[0], p1[1], d.width, d.height, this.state.symmetry)) {
        const i = py * d.width + px;
        if (a.stroke.originals.has(i)) a.stroke.pixels[i] = a.stroke.originals.get(i);
      }
      a.points.splice(-2, 1);
    }
    if (a.points.length > 3) a.points.splice(0, a.points.length - 3);
  }

  updateSelection(e) {
    const a = this.active;
    const d = this.editor.doc;
    let [x1, y1] = [a.end.x, a.end.y];
    if (e?.shiftKey) [x1, y1] = constrain(a.start.x, a.start.y, x1, y1, 'square');
    const r = rectFrom(a.start.x, a.start.y, x1, y1, d.width, d.height);
    this.editor.setSelection(r);
    if (r) this.editor.emit('shape', { width: r.width, height: r.height });
  }

  // Move pixels works with "floating" content: the lifted (or pasted) region and the background left
  // below it. As long as nothing else changes in the document, consecutive drags and arrow keys reuse
  // both, so taking the content past the edge and bringing it back loses no pixels and the pasted content
  // never drags or punches holes in the background.
  startMove(p) {
    const stroke = this.editor.newStroke();
    if (!stroke) return null;
    const d = this.editor.doc;
    const f = this.editor.floatingValid();
    let area;
    let movedRegion;
    let background;
    if (f) {
      movedRegion = f.region;
      background = f.background;
      area = { x: f.x, y: f.y, width: f.region.width, height: f.region.height };
    } else {
      area = this.editor.clippedSelection ?? { x: 0, y: 0, width: d.width, height: d.height };
      movedRegion = extractRegion(stroke.pixels, d.width, area);
      background = stroke.pixels.slice();
      for (let y = area.y; y < area.y + area.height; y++) background.fill(0, y * d.width + area.x, y * d.width + area.x + area.width);
    }
    this.active = { type: 'movePixels', stroke, area, region: movedRegion, background, start: p, dx: 0, dy: 0, originalSelection: this.editor.selection };
    return this.active;
  }

  updateMove(dx, dy, a = this.active) {
    if (dx === a.dx && dy === a.dy) return;
    a.dx = dx;
    a.dy = dy;
    const d = this.editor.doc;
    const { stroke, area, background } = a;
    stroke.revertVisual();
    const r = clipToDocument(area, d.width, d.height);
    if (r) {
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          const i = y * d.width + x;
          stroke.paint(i, background[i]);
        }
      }
    }
    pasteRegion(a.region, d.width, d.height, area.x + dx, area.y + dy, (i, c) => stroke.paint(i, c), { opaqueOnly: true });
    if (a.originalSelection) this.editor.setSelection({ ...area, x: area.x + dx, y: area.y + dy }, { keepFloating: true });
    this.editor.emit('offset', { dx, dy });
    this.editor.emit('pixels');
  }

  finishMove(a) {
    this.editor.finishStroke(a.stroke, 'Mover pixels');
    this.editor.floating = {
      key: a.stroke.key,
      region: a.region,
      background: a.background,
      x: a.area.x + a.dx,
      y: a.area.y + a.dy,
      version: this.editor.history.version,
    };
  }

  // Arrow keys with the Move pixels tool: shift 1 px (or 8 px with Shift) as a single step.
  push(dx, dy) {
    if (this.active) return;
    const a = this.startMove({ x: 0, y: 0 });
    if (!a) return;
    this.active = null;
    this.updateMove(dx, dy, a);
    this.finishMove(a);
  }

  updateGradient() {
    const a = this.active;
    const d = this.editor.doc;
    a.stroke.revertVisual();
    const [start, end] = a.button === 2 ? [this.state.secondaryColor, this.state.primaryColor] : [this.state.primaryColor, this.state.secondaryColor];
    const sel = this.editor.clippedSelection;
    const indices = sel ? indicesOf(sel, d.width, d.height) : null;
    const pairs = gradient(d.width, d.height, {
      ax: a.start.x,
      ay: a.start.y,
      bx: a.end.x,
      by: a.end.y,
      type: this.state.gradientType,
      matrix: Number(this.state.gradientMatrix) || 4,
      start,
      end,
      indices,
    });
    for (const [i, color] of pairs) a.stroke.paint(i, color);
    this.editor.emit('shape', { width: Math.abs(a.end.x - a.start.x) + 1, height: Math.abs(a.end.y - a.start.y) + 1 });
    this.editor.emit('pixels');
  }

  updateShape(e) {
    const a = this.active;
    const d = this.editor.doc;
    const tool = this.state.tool;
    let { x: x0, y: y0 } = a.start;
    let [x1, y1] = [a.end.x, a.end.y];
    if (e?.shiftKey) [x1, y1] = constrain(x0, y0, x1, y1, tool === 'line' ? 'line' : 'square');
    if (e?.altKey && tool !== 'line') {
      x0 = 2 * a.start.x - x1;
      y0 = 2 * a.start.y - y1;
    }
    const points = new Set();
    const add = (x, y) => {
      for (const [ex, ey] of mirrors(x, y, d.width, d.height, this.state.symmetry)) {
        if (this.inside(ex, ey)) points.add(ey * d.width + ex);
      }
    };
    if (tool === 'line') {
      const brushPoints = brush(this.state.size, this.state.shape);
      line(x0, y0, x1, y1, (x, y) => {
        for (const [dx, dy] of brushPoints) add(x + dx, y + dy);
      });
    } else if (tool === 'rectangle') {
      rectangle(x0, y0, x1, y1, this.state.filled, add);
    } else {
      ellipse(x0, y0, x1, y1, this.state.filled, add);
    }
    a.points = points;
    this.viewport.setPreview(points, a.color);
    this.editor.emit('shape', { width: Math.abs(x1 - x0) + 1, height: Math.abs(y1 - y0) + 1 });
  }

  bucket(p, button) {
    if (!p.inside) return;
    const stroke = this.editor.newStroke();
    if (!stroke) return;
    const d = this.editor.doc;
    const color = this.color(button);
    const options = {
      connectivity: this.state.connectivity,
      tolerance: Math.round((this.state.tolerance / 100) * 255),
      contiguous: this.state.contiguous,
    };
    const sel = this.editor.selection;
    if (sel && !contains(sel, p.x, p.y)) {
      stroke.revertVisual();
      return;
    }
    for (const [x, y] of mirrors(p.x, p.y, d.width, d.height, this.state.symmetry)) {
      const source = this.state.sample === 'all' ? d.composite(this.editor.state.frame) : this.editor.activeCell();
      for (const i of region(source, d.width, d.height, x, y, options)) {
        if (sel && !contains(sel, i % d.width, (i / d.width) | 0)) continue;
        stroke.paint(i, color);
      }
    }
    if (this.editor.finishStroke(stroke, 'Balde de tinta')) this.editor.rememberColor(color);
  }

  pickColor(p, button) {
    if (!p.inside) return;
    const d = this.editor.doc;
    const i = p.y * d.width + p.x;
    const color = this.state.sample === 'all' ? d.composite(this.editor.state.frame)[i] : this.editor.activeCell()[i];
    if (!(color >>> 24)) {
      this.editor.emit('sample', { color: null });
      return;
    }
    this.editor.setColor(button === 2 ? 'secondary' : 'primary', color);
    this.editor.emit('sample', { color: colorToHex(color) });
  }
}

export function toolHint(id) {
  const f = TOOLS.find((x) => x.id === id);
  if (f) notify(`${f.name} (${f.shortcut})`, 'info', 900);
}
