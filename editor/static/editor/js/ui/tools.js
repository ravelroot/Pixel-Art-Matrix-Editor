import { line, rectangle, ellipse, brush, mirrors, constrain, lCorner, polygon, bezier } from '../core/geometry.js';
import { region } from '../core/fill.js';
import { colorToHex } from '../core/colors.js';
import { patternPixel, gradient } from '../core/dither.js';
import {
  rectFrom,
  clipToDocument,
  contains,
  extractRegion,
  pasteRegion,
  indicesOf,
  combineSelections,
  selectionFromIndices,
  selectionFromPoints,
} from '../core/selection.js';
import { applyInk, seededRandom, sprayPoints, sprayCount, blurPixel, jumbleTarget } from '../core/brush.js';
import { lightnessStep, paletteStep, paletteRamp } from '../core/filters.js';
import { notify } from './util.js';

// The toolbar shows two tools per row, so related tools sit side by side (like Aseprite's tool groups).
// Shortcuts with "Shift+" are registered by features/selection.js (the plain letters are handled by main.js).
export const TOOLS = [
  { id: 'pencil', name: 'Lápis', shortcut: 'B', icon: 'pencil', options: ['size', 'shape', 'pixelPerfect', 'inkMode', 'brush'] },
  { id: 'spray', name: 'Spray', shortcut: 'Shift+B', icon: 'spray', options: ['sprayRadius', 'sprayDensity', 'inkMode', 'brush'] },
  { id: 'eraser', name: 'Borracha', shortcut: 'E', icon: 'eraser', options: ['size', 'shape', 'eraserMode', 'brush'] },
  { id: 'bucket', name: 'Balde de tinta', shortcut: 'F', icon: 'bucket', options: ['connectivity', 'tolerance', 'contiguous', 'sample'] },
  { id: 'line', name: 'Linha', shortcut: 'L', icon: 'line', options: ['size', 'inkMode'] },
  { id: 'curve', name: 'Curva', shortcut: 'Shift+L', icon: 'curve', options: ['size', 'inkMode'] },
  { id: 'rectangle', name: 'Retângulo', shortcut: 'R', icon: 'rectangle', options: ['filled', 'inkMode'] },
  { id: 'ellipse', name: 'Elipse e círculo', shortcut: 'O', icon: 'ellipse', options: ['filled', 'inkMode'] },
  { id: 'contour', name: 'Contorno livre', shortcut: 'Shift+D', icon: 'contour', options: ['inkMode'] },
  { id: 'polygon', name: 'Polígono', shortcut: 'Shift+O', icon: 'polygon', options: ['filled', 'inkMode'] },
  { id: 'dither', name: 'Pontilhado', shortcut: 'D', icon: 'dither', options: ['size', 'shape', 'density', 'ditherBackground'] },
  { id: 'gradient', name: 'Degradê pontilhado', shortcut: 'U', icon: 'gradient', options: ['gradientType', 'gradientMatrix'] },
  { id: 'shade', name: 'Clarear e escurecer', shortcut: 'Q', icon: 'shade', options: ['size', 'shape', 'shadeMode', 'shadeIntensity'] },
  { id: 'blur', name: 'Desfocar', shortcut: 'Shift+Q', icon: 'blur', options: ['size', 'shape'] },
  { id: 'jumble', name: 'Embaralhar', shortcut: 'Shift+J', icon: 'jumble', options: ['size', 'shape'] },
  { id: 'eyedropper', name: 'Conta-gotas', shortcut: 'I', icon: 'eyedropper', options: ['sample'] },
  { id: 'selection', name: 'Seleção retangular', shortcut: 'S', icon: 'selection', options: ['selectionMode'] },
  { id: 'ellipseSelection', name: 'Seleção elíptica', shortcut: 'Shift+S', icon: 'ellipseSelection', options: ['selectionMode'] },
  { id: 'lasso', name: 'Laço', shortcut: 'A', icon: 'lasso', options: ['selectionMode'] },
  { id: 'polygonLasso', name: 'Laço poligonal', shortcut: 'Shift+A', icon: 'polygonLasso', options: ['selectionMode'] },
  { id: 'magicWand', name: 'Varinha mágica', shortcut: 'W', icon: 'magicWand', options: ['selectionMode', 'tolerance', 'contiguous', 'connectivity', 'sample'] },
  { id: 'movePixels', name: 'Mover pixels', shortcut: 'V', icon: 'movePixels', options: [] },
  { id: 'move', name: 'Mover a visão', shortcut: 'H', icon: 'move', options: [] },
];

const BRUSHES = ['pencil', 'eraser', 'dither', 'shade', 'blur', 'jumble'];
const LABELS = { pencil: 'Lápis', eraser: 'Borracha', dither: 'Pontilhado', shade: 'Clarear e escurecer', blur: 'Desfocar', jumble: 'Embaralhar' };
// Tools that honor the ink mode (Simples, Composição alfa, Travar alfa, Atrás).
export const INK_TOOLS = ['pencil', 'line', 'rectangle', 'ellipse', 'spray', 'curve', 'contour', 'polygon'];
export const SELECTION_TOOLS = ['selection', 'ellipseSelection', 'lasso', 'polygonLasso', 'magicWand'];
// Tools that stamp the custom brush (Ctrl+B) instead of the size/shape brush.
export const CUSTOM_BRUSH_TOOLS = ['pencil', 'eraser', 'spray'];
const SHAPE_NAMES = { line: 'Linha', rectangle: 'Retângulo', ellipse: 'Elipse', curve: 'Curva', contour: 'Contorno livre', polygon: 'Polígono' };

export class Controller {
  constructor(editor, viewport) {
    this.editor = editor;
    this.viewport = viewport;
    this.active = null;
    // Multi-click gesture in progress (polygonal lasso, polygon, curve): it lives between pointer events.
    this.pending = null;
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
    // Enter closes/applies and Esc cancels a multi-click gesture. Registered before main.js's shortcuts, which
    // ignore events that were already handled here.
    window.addEventListener('keydown', (e) => {
      if (!this.pending || this.active || this.fieldHasFocus(e) || document.querySelector('dialog[open]')) return;
      if (e.key === 'Enter') this.finishPending();
      else if (e.key === 'Escape') this.cancelPending();
      else if (e.key === 'Backspace' && this.pending.points?.length > 1) {
        // Backspace removes the last corner of a polygon or polygonal lasso.
        this.pending.points.pop();
        this.previewPending(this.viewport.cursor);
      } else return;
      e.preventDefault();
    });
    editor.on('state', ({ key }) => {
      if (key === 'tool') this.cancelPending();
    });
    editor.on('document', () => this.cancelPending());
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
    if (this.pending) {
      this.pendingDown(p);
      return;
    }
    if (e.altKey && ['pencil', 'eraser', 'bucket', 'line', 'rectangle', 'ellipse', 'dither', 'gradient', 'spray', 'curve', 'contour', 'polygon'].includes(tool)) {
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
    if (SELECTION_TOOLS.includes(tool)) {
      this.startSelection(p, e);
      return;
    }
    if (tool === 'movePixels') {
      this.startMove(p);
      return;
    }
    if (tool === 'polygon') {
      if (!this.editor.canEditLayer()) return;
      this.pending = { type: 'polygon', points: [[p.x, p.y]], color: this.color(button), time: performance.now() };
      this.previewPending(p);
      return;
    }
    const stroke = this.editor.newStroke();
    if (!stroke) return;
    if (tool === 'gradient') {
      this.active = { type: 'gradient', stroke, button, start: p, end: p, pending: 0 };
      return;
    }
    if (tool === 'spray') {
      this.startSpray(stroke, p, button);
      return;
    }
    if (tool === 'contour') {
      this.active = { type: 'contour', stroke, color: this.color(button), points: [[p.x, p.y]] };
      this.updateContour();
      return;
    }
    if (BRUSHES.includes(tool)) {
      const color = this.brushColor(tool, button, stroke);
      const pixelPerfect = tool === 'pencil' && this.state.pixelPerfect && this.state.size === 1 && !this.editor.brush;
      const points = this.brushPoints(tool, button);
      this.active = { type: 'stroke', stroke, color, last: p, pixelPerfect, points: [[p.x, p.y]], brush: points };
      if (e.shiftKey && this.lastPoint) line(this.lastPoint.x, this.lastPoint.y, p.x, p.y, (x, y) => this.stamp(stroke, x, y, color, points));
      else this.stamp(stroke, p.x, p.y, color, points);
      this.editor.emit('pixels');
      return;
    }
    const color = this.color(button);
    this.active = { type: 'shape', stroke, color, start: p, end: p };
    this.updateShape(e);
  }

  // Brush footprint as [dx, dy] offsets, or [dx, dy, color] for a custom brush painted with its own colors
  // (left button with the pencil or the spray; the right button and the eraser use only its shape).
  brushPoints(tool, button = 0) {
    const custom = this.editor.brush;
    if (custom && CUSTOM_BRUSH_TOOLS.includes(tool)) {
      if (tool !== 'eraser' && button !== 2) return custom.points;
      return custom.points.map(([dx, dy]) => [dx, dy]);
    }
    if (tool === 'spray') return [[0, 0]];
    return brush(this.state.size, this.state.shape);
  }

  inkMode() {
    return INK_TOOLS.includes(this.state.tool) ? this.state.inkMode : 'simple';
  }

  // Paints with the ink mode. The destination is the pixel as it was before the stroke, so going over the
  // same pixel twice in one stroke does not blend twice.
  paintInk(stroke, i, color, ink = this.inkMode()) {
    if (ink === 'simple') return stroke.paint(i, color);
    const dst = stroke.originals.has(i) ? stroke.originals.get(i) : stroke.pixels[i];
    const out = applyInk(dst, color, ink);
    return out === null ? false : stroke.paint(i, out);
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
    const touched = new Set();
    const pixels = stroke.pixels;
    const d = this.editor.doc;
    if (tool === 'blur') {
      const read = (x, y) => {
        const j = y * d.width + x;
        return stroke.originals.has(j) ? stroke.originals.get(j) : pixels[j];
      };
      return (x, y, i) => {
        if (touched.has(i)) return null;
        touched.add(i);
        return blurPixel(read, d.width, d.height, x, y);
      };
    }
    if (tool === 'jumble') {
      const rng = seededRandom((Math.random() * 4294967296) >>> 0);
      const allowed = (x, y) => this.inside(x, y);
      return (x, y, i) => {
        if (touched.has(i)) return null;
        touched.add(i);
        const j = jumbleTarget(x, y, d.width, d.height, rng, allowed);
        if (j < 0) return null;
        const a = pixels[i];
        stroke.paint(i, pixels[j]);
        stroke.paint(j, a);
        return null;
      };
    }
    const direction = button === 2 ? -1 : 1;
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
    if (!a) {
      if (this.pending) this.previewPending(p);
      return;
    }
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
          this.stamp(a.stroke, x, y, a.color, a.brush);
          if (a.pixelPerfect) this.filterCorners(a, x, y);
        });
        a.last = q;
      }
      this.editor.emit('pixels');
    } else if (a.type === 'selection') {
      if (p.x !== a.start.x || p.y !== a.start.y) a.dragged = true;
      a.end = p;
      this.updateSelection(e);
    } else if (a.type === 'lasso' || a.type === 'contour') {
      const last = a.points.at(-1);
      if (p.x !== last[0] || p.y !== last[1]) {
        a.points.push([p.x, p.y]);
        if (a.type === 'lasso') this.viewport.setGuide(a.points, false);
        else this.updateContour();
      }
    } else if (a.type === 'spray') {
      a.pos = p;
    } else if (a.type === 'curveBend') {
      if (p.x !== a.start.x || p.y !== a.start.y) a.dragged = true;
      const c = this.pending;
      if (a.dragged && c) {
        if (c.phase === 1) c.c1 = c.c2 = [p.x, p.y];
        else c.c2 = [p.x, p.y];
        this.previewCurve();
      }
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
    if (a.type === 'spray') {
      clearInterval(a.timer);
      if (cancelled) {
        a.stroke.revertVisual();
        this.editor.emit('pixels');
        return;
      }
      if (this.editor.finishStroke(a.stroke, 'Spray') && typeof a.color === 'number') this.editor.rememberColor(a.color);
      return;
    }
    if (a.type === 'lasso') {
      this.viewport.setGuide(null);
      if (cancelled) return;
      this.finishLasso(a.points, a.mode, a.previous);
      return;
    }
    if (a.type === 'contour') {
      this.viewport.setPreview(null);
      if (cancelled) {
        a.stroke.revertVisual();
        return;
      }
      for (const i of a.indices ?? []) this.paintInk(a.stroke, i, a.color);
      if (this.editor.finishStroke(a.stroke, SHAPE_NAMES.contour)) this.editor.rememberColor(a.color);
      return;
    }
    if (a.type === 'curveBend') {
      if (cancelled) this.cancelPending();
      else if (!a.dragged || this.pending?.phase === 2) this.finishPending();
      else this.pending.phase = 2;
      return;
    }
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
      if (!a.dragged && a.mode === 'replace') this.editor.setSelection(null);
    } else if (a.type === 'shape') {
      if (this.state.tool === 'curve' && !cancelled) {
        // Curve: the dragged line becomes a pending curve; the next drags bend it.
        if (a.end.x === a.start.x && a.end.y === a.start.y) {
          this.viewport.setPreview(null);
          return;
        }
        const p0 = [a.start.x, a.start.y];
        const p3 = [a.end.x, a.end.y];
        this.pending = { type: 'curve', color: a.color, p0, p3, c1: p0, c2: p3, phase: 1 };
        this.previewCurve();
        return;
      }
      this.viewport.setPreview(null);
      if (cancelled) return;
      for (const i of a.points ?? []) this.paintInk(a.stroke, i, a.color);
      this.lastPoint = a.end;
      this.editor.finishStroke(a.stroke, SHAPE_NAMES[this.state.tool] ?? 'Forma');
      this.editor.rememberColor(a.color);
    }
  }

  cancel() {
    if (this.active) this.pointerUp(null, true);
    else this.cancelPending();
  }

  // --- multi-click gestures -------------------------------------------------------------------------------

  pendingDown(p) {
    const g = this.pending;
    if (g.type === 'curve') {
      this.active = { type: 'curveBend', start: p, dragged: false };
      return;
    }
    const now = performance.now();
    const last = g.points.at(-1);
    const first = g.points[0];
    const same = (q) => q[0] === p.x && q[1] === p.y;
    if ((same(last) && now - g.time < 500) || (g.points.length >= 3 && same(first))) {
      this.finishPending();
      return;
    }
    if (!same(last)) g.points.push([p.x, p.y]);
    g.time = now;
    this.previewPending(p);
  }

  previewPending(p) {
    const g = this.pending;
    if (!g) return;
    if (g.type === 'curve') return;
    const points = p ? [...g.points, [p.x, p.y]] : g.points;
    if (g.type === 'polygonLasso') {
      this.viewport.setGuide(points, true);
      return;
    }
    this.viewport.setPreview(this.shapeIndices((pt) => polygon(points, false, pt)), g.color);
  }

  previewCurve() {
    const g = this.pending;
    this.viewport.setPreview(this.curveIndices(g), g.color);
  }

  curveIndices(g) {
    const brushPoints = brush(this.state.size, this.state.shape);
    return this.shapeIndices((pt) =>
      bezier(g.p0, g.c1, g.c2, g.p3, (x, y) => {
        for (const [dx, dy] of brushPoints) pt(x + dx, y + dy);
      }),
    );
  }

  // Closes the polygon/polygonal lasso or applies the curve.
  finishPending() {
    const g = this.pending;
    if (!g) return;
    this.pending = null;
    this.viewport.setGuide(null);
    this.viewport.setPreview(null);
    if (g.type === 'polygonLasso') {
      this.finishLasso(g.points, g.mode, g.previous);
      return;
    }
    const stroke = this.editor.newStroke();
    if (!stroke) return;
    let indices;
    let label;
    if (g.type === 'curve') {
      indices = this.curveIndices(g);
      label = SHAPE_NAMES.curve;
    } else {
      if (g.points.length < 2) return;
      indices = this.shapeIndices((pt) => polygon(g.points, this.state.filled, pt));
      label = SHAPE_NAMES.polygon;
    }
    for (const i of indices) this.paintInk(stroke, i, g.color);
    if (this.editor.finishStroke(stroke, label)) this.editor.rememberColor(g.color);
  }

  cancelPending() {
    if (!this.pending) return;
    this.pending = null;
    this.viewport.setGuide(null);
    this.viewport.setPreview(null);
  }

  // Pixel indices of a shape drawn by draw(point), with symmetry, inside the matrix and the selection.
  shapeIndices(draw) {
    const d = this.editor.doc;
    const points = new Set();
    draw((x, y) => {
      for (const [ex, ey] of mirrors(x, y, d.width, d.height, this.state.symmetry)) {
        if (this.inside(ex, ey)) points.add(ey * d.width + ex);
      }
    });
    return points;
  }

  updateContour() {
    const a = this.active;
    a.indices = this.shapeIndices((pt) => polygon(a.points, true, pt));
    this.viewport.setPreview(a.indices, a.color);
  }

  // --- spray ----------------------------------------------------------------------------------------------

  startSpray(stroke, p, button) {
    const a = {
      type: 'spray',
      stroke,
      color: this.color(button),
      brush: this.brushPoints('spray', button),
      pos: p,
      rng: seededRandom((Math.random() * 4294967296) >>> 0),
      timer: 0,
    };
    this.active = a;
    this.sprayTick(a);
    a.timer = setInterval(() => {
      if (this.active === a) this.sprayTick(a);
      else clearInterval(a.timer);
    }, 40);
  }

  sprayTick(a) {
    const radius = this.state.sprayRadius;
    for (const [x, y] of sprayPoints(a.pos.x, a.pos.y, radius, sprayCount(radius, this.state.sprayDensity), a.rng)) this.stamp(a.stroke, x, y, a.color, a.brush);
    this.editor.emit('pixels');
  }

  // --- selection tools ------------------------------------------------------------------------------------

  // Modifiers pick the selection mode (Shift adds, Alt subtracts, Shift+Alt intersects); otherwise the option bar's.
  selectionMode(e) {
    if (e?.shiftKey && e?.altKey) return 'intersect';
    if (e?.shiftKey) return 'add';
    if (e?.altKey) return 'subtract';
    return this.state.selectionMode;
  }

  startSelection(p, e) {
    const tool = this.state.tool;
    const mode = this.selectionMode(e);
    const previous = this.editor.selection;
    if (tool === 'magicWand') {
      this.magicWand(p, mode);
      return;
    }
    if (tool === 'polygonLasso') {
      this.pending = { type: 'polygonLasso', points: [[p.x, p.y]], mode, previous, time: performance.now() };
      this.previewPending(p);
      return;
    }
    if (tool === 'lasso') {
      this.active = { type: 'lasso', points: [[p.x, p.y]], mode, previous };
      this.viewport.setGuide(this.active.points, false);
      return;
    }
    this.active = { type: 'selection', start: p, end: p, dragged: false, previous, mode, modifiers: Boolean(e?.shiftKey || e?.altKey) };
  }

  finishLasso(points, mode, previous) {
    const d = this.editor.doc;
    const distinct = new Set(points.map(String)).size;
    if (distinct < 2) {
      if (mode === 'replace') this.editor.setSelection(null);
      return;
    }
    const shape = selectionFromPoints((pt) => polygon(points, true, pt), d.width, d.height);
    this.editor.setSelection(combineSelections(previous, shape, mode, d.width, d.height));
  }

  magicWand(p, mode) {
    const d = this.editor.doc;
    if (!p.inside) {
      if (mode === 'replace') this.editor.setSelection(null);
      return;
    }
    const source = this.state.sample === 'all' ? d.composite(this.editor.state.frame) : this.editor.activeCell();
    const indices = region(source, d.width, d.height, p.x, p.y, {
      connectivity: this.state.connectivity,
      tolerance: Math.round((this.state.tolerance / 100) * 255),
      contiguous: this.state.contiguous,
    });
    const shape = selectionFromIndices(indices, d.width, d.height);
    this.editor.setSelection(combineSelections(this.editor.selection, shape, mode, d.width, d.height));
  }

  // Inside the matrix and, if there is a selection, inside it: painting tools only touch that area.
  inside(x, y) {
    const d = this.editor.doc;
    return x >= 0 && y >= 0 && x < d.width && y < d.height && contains(this.editor.selection, x, y);
  }

  stamp(stroke, x, y, color, points = brush(this.state.size, this.state.shape)) {
    const d = this.editor.doc;
    const isFunction = typeof color === 'function';
    const ink = this.inkMode();
    for (const [dx, dy, own] of points) {
      for (const [px, py] of mirrors(x + dx, y + dy, d.width, d.height, this.state.symmetry)) {
        if (!this.inside(px, py)) continue;
        const i = py * d.width + px;
        const c = own !== undefined ? own : isFunction ? color(px, py, i) : color;
        if (c !== null && c !== undefined) this.paintInk(stroke, i, c, ink);
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
    // Shift held from the start means "add"; pressed during the drag it keeps the proportion 1:1.
    if (e?.shiftKey && !a.modifiers) [x1, y1] = constrain(a.start.x, a.start.y, x1, y1, 'square');
    let shape;
    if (this.state.tool === 'ellipseSelection') shape = selectionFromPoints((pt) => ellipse(a.start.x, a.start.y, x1, y1, true, pt), d.width, d.height);
    else shape = rectFrom(a.start.x, a.start.y, x1, y1, d.width, d.height);
    this.editor.setSelection(a.mode === 'replace' ? shape : combineSelections(a.previous, shape, a.mode, d.width, d.height));
    if (shape) this.editor.emit('shape', { width: Math.abs(x1 - a.start.x) + 1, height: Math.abs(y1 - a.start.y) + 1 });
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
      if (f.region.mask) area.mask = f.region.mask;
    } else {
      area = this.editor.clippedSelection ?? { x: 0, y: 0, width: d.width, height: d.height };
      movedRegion = extractRegion(stroke.pixels, d.width, area);
      background = stroke.pixels.slice();
      for (const i of indicesOf(area, d.width, d.height)) background[i] = 0;
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
    const r = clipToDocument({ x: area.x, y: area.y, width: area.width, height: area.height }, d.width, d.height);
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
    const isLine = tool === 'line' || tool === 'curve';
    if (e?.shiftKey) [x1, y1] = constrain(x0, y0, x1, y1, isLine ? 'line' : 'square');
    if (e?.altKey && !isLine) {
      x0 = 2 * a.start.x - x1;
      y0 = 2 * a.start.y - y1;
    }
    const points = new Set();
    const add = (x, y) => {
      for (const [ex, ey] of mirrors(x, y, d.width, d.height, this.state.symmetry)) {
        if (this.inside(ex, ey)) points.add(ey * d.width + ex);
      }
    };
    if (isLine) {
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
