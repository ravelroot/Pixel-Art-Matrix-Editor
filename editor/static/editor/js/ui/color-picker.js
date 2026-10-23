// Color picker: saturation/value square, hue strip, alpha slider, hex field and optional HSV/RGB sliders.
// Used by the color panel (primary/secondary colors) and by the palette editor.
import { pack, unpack, colorToHex, hexToColor, rgbToHsv, hsvToRgb, alpha as alphaOf } from '../core/colors.js';
import { grayOf } from '../core/colormode.js';
import { el, notify } from './util.js';
import { openDialog } from './dialog.js';

const SQUARE = 160;

export class HsvPicker {
  // gray: the picker only produces grays (grayscale color mode). sliders: shows the HSV and RGB sliders.
  constructor({ color = 0xff000000, gray = false, sliders = false, onInput = null } = {}) {
    this.gray = gray;
    this.onInput = onInput;
    this.square = el('canvas', { class: 'hsv-square', width: SQUARE, height: SQUARE, tabindex: 0, role: 'slider', 'aria-label': 'Saturação e brilho (setas ajustam)' });
    this.hue = el('input', { type: 'range', class: 'hue-strip', min: 0, max: 359, step: 1, 'aria-label': 'Matiz' });
    this.alpha = el('input', { type: 'range', min: 0, max: 255, step: 1, 'aria-label': 'Opacidade' });
    this.alphaValue = el('output', { class: 'mono' });
    this.hex = el('input', { type: 'text', class: 'hex', maxlength: 9, spellcheck: 'false', 'aria-label': 'Código hexadecimal' });
    this.preview = el('span', { class: 'picker-preview', 'aria-hidden': 'true' });
    this.sliders = {};
    const rows = [];
    if (sliders) {
      for (const [key, label, max] of [['h', 'H', 359], ['s', 'S', 100], ['v', 'V', 100], ['r', 'R', 255], ['g', 'G', 255], ['b', 'B', 255]]) {
        const input = el('input', { type: 'range', min: 0, max, step: 1, 'aria-label': { h: 'Matiz', s: 'Saturação', v: 'Brilho', r: 'Vermelho', g: 'Verde', b: 'Azul' }[key] });
        const out = el('output', { class: 'mono' });
        this.sliders[key] = { input, out };
        rows.push(el('label', { class: 'field compact' }, el('span', {}, label), input, out));
        input.addEventListener('input', () => this.fromSliders(key));
      }
    }
    this.root = el(
      'div',
      { class: `hsv-picker ${gray ? 'gray' : ''}` },
      el('div', { class: 'hsv-main' }, this.square, el('div', { class: 'hsv-side' }, this.preview, el('label', { class: 'field' }, el('span', {}, 'Hex'), this.hex))),
      gray ? null : el('label', { class: 'field compact' }, el('span', {}, 'Matiz'), this.hue, el('output', { class: 'mono' })),
      el('label', { class: 'field compact' }, el('span', {}, 'Alfa'), this.alpha, this.alphaValue),
      rows.length ? el('div', { class: 'hsv-sliders' }, rows) : null,
    );
    this.hue.addEventListener('input', () => {
      this.h = +this.hue.value;
      this.commit();
    });
    this.alpha.addEventListener('input', () => {
      this.a = +this.alpha.value;
      this.commit(false);
    });
    this.hex.addEventListener('change', () => {
      const c = hexToColor(this.hex.value);
      if (c === null) {
        notify('Use um código como #5d1c16 ou #5d1c16cc.', 'warning');
        this.render();
        return;
      }
      this.setColor(c);
      this.emit();
    });
    const pick = (e) => {
      const r = this.square.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      if (!this.gray) this.s = x;
      this.v = 1 - y;
      this.commit(false);
    };
    this.square.addEventListener('pointerdown', (e) => {
      this.square.setPointerCapture?.(e.pointerId);
      this.dragging = true;
      pick(e);
    });
    this.square.addEventListener('pointermove', (e) => {
      if (this.dragging) pick(e);
    });
    this.square.addEventListener('pointerup', () => (this.dragging = false));
    this.square.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.gray) this.s = Math.min(1, Math.max(0, this.s + m[0]));
      this.v = Math.min(1, Math.max(0, this.v + m[1]));
      this.commit(false);
    });
    this.setColor(color);
  }

  get color() {
    const c = pack(...hsvToRgb(this.h, this.gray ? 0 : this.s, this.v), this.a);
    return this.gray ? grayOf(c) : c;
  }

  setColor(c) {
    const [r, g, b] = unpack(c);
    const [h, s, v] = rgbToHsv(r, g, b);
    // Grays and black have no hue of their own: keep the current one so the square does not jump to red.
    if (s > 0 || this.h === undefined) this.h = Math.round(h);
    this.s = this.gray ? 0 : s;
    this.v = v;
    this.a = alphaOf(c);
    this.render();
  }

  fromSliders(key) {
    const val = (k) => +this.sliders[k].input.value;
    if ('hsv'.includes(key)) {
      this.h = val('h');
      this.s = this.gray ? 0 : val('s') / 100;
      this.v = val('v') / 100;
    } else {
      const [h, s, v] = rgbToHsv(val('r'), val('g'), val('b'));
      if (s > 0) this.h = Math.round(h);
      this.s = this.gray ? 0 : s;
      this.v = v;
    }
    this.commit(true);
  }

  commit(redrawSquare = true) {
    this.render(redrawSquare);
    this.emit();
  }

  emit() {
    this.onInput?.(this.color);
  }

  render(redrawSquare = true) {
    const c = this.color;
    if (redrawSquare || this.drawnHue !== this.h) this.drawSquare();
    this.hue.value = Math.round(this.h);
    if (this.hue.nextElementSibling) this.hue.nextElementSibling.textContent = Math.round(this.h) + '°';
    this.alpha.value = this.a;
    this.alphaValue.textContent = Math.round((this.a / 255) * 100) + '%';
    if (document.activeElement !== this.hex) this.hex.value = colorToHex(c);
    this.preview.style.setProperty('--color', colorToHex(c, true));
    this.square.setAttribute('aria-valuetext', `Saturação ${Math.round(this.s * 100)}%, brilho ${Math.round(this.v * 100)}%`);
    const [r, g, b] = unpack(c);
    const values = { h: Math.round(this.h), s: Math.round(this.s * 100), v: Math.round(this.v * 100), r, g, b };
    for (const [k, { input, out }] of Object.entries(this.sliders)) {
      if (document.activeElement !== input) input.value = values[k];
      out.textContent = String(values[k]);
    }
    this.drawMarker();
  }

  drawSquare() {
    const ctx = this.square.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(SQUARE, SQUARE);
    const data = image.data;
    for (let y = 0; y < SQUARE; y++) {
      const v = 1 - y / (SQUARE - 1);
      for (let x = 0; x < SQUARE; x++) {
        const [r, g, b] = hsvToRgb(this.h, this.gray ? 0 : x / (SQUARE - 1), v);
        const k = (y * SQUARE + x) * 4;
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
      }
    }
    this.base = image;
    this.drawnHue = this.h;
  }

  drawMarker() {
    const ctx = this.square.getContext('2d');
    if (!ctx || !this.base) return;
    ctx.putImageData(this.base, 0, 0);
    const x = (this.gray ? 0.5 : this.s) * (SQUARE - 1);
    const y = (1 - this.v) * (SQUARE - 1);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.v > 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Modal picker. onInput receives every change (live preview); resolves with the color or null (canceled).
export function colorPickerDialog({ color, title = 'Escolher cor', gray = false, onInput = null } = {}) {
  const picker = new HsvPicker({ color, gray, sliders: true, onInput });
  return openDialog({
    title,
    className: 'color-picker-dialog',
    body: picker.root,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'OK', primary: true, send: true, action: () => picker.color },
    ],
  });
}
