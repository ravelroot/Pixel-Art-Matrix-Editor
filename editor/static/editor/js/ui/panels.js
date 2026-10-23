import { colorToHex, colorToHex6, hexToColor, withAlpha, alpha, generateRamp } from '../core/colors.js';
import { PRESET_PALETTES, normalizePalette, importPalette, exportPalette, extractPalette } from '../core/palettes.js';
import { fileNameFor } from '../core/format.js';
import { el, notify, pickFile, downloadText, delay, readPreference, writePreference } from './util.js';
import { icon } from './icons.js';
import { createCanvas, pixelsToCanvas } from './image.js';
import { promptText, confirm, openDialog } from './dialog.js';

function swatch(color, { title, onClick, onRightClick, active = false, className = '' } = {}) {
  const b = el('button', {
    type: 'button',
    class: `swatch ${className} ${active ? 'active' : ''}`,
    title: title ?? colorToHex(color),
    'aria-label': title ?? colorToHex(color),
    style: { '--color': colorToHex(color, true) },
  });
  if (onClick) b.addEventListener('click', onClick);
  if (onRightClick)
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onRightClick(e);
    });
  return b;
}

function iconButton(name, label, action, extra = {}) {
  return el('button', { type: 'button', class: 'icon-button', title: label, 'aria-label': label, html: icon(name, 16), onclick: action, ...extra });
}

export class ColorPanel {
  constructor(root, editor) {
    this.editor = editor;
    this.picker = el('input', { type: 'color', class: 'invisible', tabindex: -1, 'aria-hidden': 'true' });
    this.target = 'primary';
    this.primary = el('button', { type: 'button', class: 'color-large primary', title: 'Cor principal (clique esquerdo)', onclick: () => this.openPicker('primary') });
    this.secondary = el('button', { type: 'button', class: 'color-large secondary', title: 'Cor secundária (clique direito)', onclick: () => this.openPicker('secondary') });
    this.hex = el('input', { type: 'text', class: 'hex', maxlength: 9, spellcheck: 'false', 'aria-label': 'Código hexadecimal da cor principal' });
    this.alpha = el('input', { type: 'range', min: 0, max: 255, 'aria-label': 'Opacidade da cor principal' });
    this.alphaValue = el('output', { class: 'mono' });
    this.recent = el('div', { class: 'swatches recent', 'aria-label': 'Cores recentes' });
    root.append(
      el(
        'div',
        { class: 'color-row' },
        el('div', { class: 'color-pair' }, this.secondary, this.primary, el('button', { type: 'button', class: 'icon-button swap', title: 'Trocar cores (X)', 'aria-label': 'Trocar cores', html: icon('swap', 14), onclick: () => editor.swapColors() })),
        el('div', { class: 'color-fields' }, el('label', { class: 'field compact' }, el('span', {}, 'Hex'), this.hex), el('label', { class: 'field compact' }, el('span', {}, 'Alfa'), this.alpha, this.alphaValue)),
      ),
      el('div', { class: 'small-label' }, 'Recentes'),
      this.recent,
      this.picker,
    );
    this.picker.addEventListener('input', () => {
      const current = this.target === 'secondary' ? editor.state.secondaryColor : editor.state.primaryColor;
      editor.setColor(this.target, withAlpha(hexToColor(this.picker.value), alpha(current) || 255));
    });
    this.picker.addEventListener('change', () => editor.rememberColor(this.target === 'secondary' ? editor.state.secondaryColor : editor.state.primaryColor));
    this.hex.addEventListener('change', () => {
      const c = hexToColor(this.hex.value);
      if (c === null) {
        notify('Use um código como #5d1c16 ou #5d1c16cc.', 'warning');
        this.update();
        return;
      }
      editor.setColor('primary', c);
      editor.rememberColor(c);
    });
    this.alpha.addEventListener('input', () => editor.setColor('primary', withAlpha(editor.state.primaryColor, +this.alpha.value)));
    editor.on('color', () => this.update());
    editor.on('recent', () => this.updateRecent());
    this.update();
    this.updateRecent();
  }

  openPicker(which) {
    this.target = which;
    const c = which === 'secondary' ? this.editor.state.secondaryColor : this.editor.state.primaryColor;
    this.picker.value = colorToHex6(c);
    this.picker.click();
  }

  update() {
    const { primaryColor: p, secondaryColor: s } = this.editor.state;
    this.primary.style.setProperty('--color', colorToHex(p, true));
    this.secondary.style.setProperty('--color', colorToHex(s, true));
    this.primary.setAttribute('aria-label', `Cor principal ${colorToHex(p)}`);
    this.secondary.setAttribute('aria-label', `Cor secundária ${colorToHex(s)}`);
    if (document.activeElement !== this.hex) this.hex.value = colorToHex(p);
    this.alpha.value = alpha(p);
    this.alphaValue.textContent = Math.round((alpha(p) / 255) * 100) + '%';
  }

  updateRecent() {
    this.recent.replaceChildren(
      ...this.editor.recent.map((c) =>
        swatch(c, {
          onClick: () => this.editor.setColor('primary', c),
          onRightClick: () => this.editor.setColor('secondary', c),
        }),
      ),
    );
    if (!this.editor.recent.length) this.recent.append(el('span', { class: 'empty' }, 'As cores usadas aparecem aqui.'));
  }
}

export class PalettePanel {
  constructor(root, editor, getStorage) {
    this.editor = editor;
    this.getStorage = getStorage;
    this.mine = [];
    this.select = el('select', { 'aria-label': 'Paleta' });
    this.grid = el('div', { class: 'swatches palette' });
    this.info = el('div', { class: 'small-label palette-info' });
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', { type: 'button', class: 'button small', onclick: () => this.addCurrentColor(), title: 'Adicionar a cor principal à paleta' }, '+ Cor'),
      el('button', { type: 'button', class: 'button small', onclick: () => this.create() }, 'Nova'),
      el('button', { type: 'button', class: 'button small', onclick: () => this.fromDrawing(), title: 'Cria uma paleta com as cores usadas no projeto' }, 'Do desenho'),
      el('button', { type: 'button', class: 'button small', onclick: () => this.importFile() }, 'Importar'),
      el('button', { type: 'button', class: 'button small', onclick: () => this.exportFile() }, 'Exportar'),
      el('button', { type: 'button', class: 'button small', onclick: () => this.rename(), data: { mineOnly: '1' } }, 'Renomear'),
      el('button', { type: 'button', class: 'button small danger', onclick: () => this.remove(), data: { mineOnly: '1' } }, 'Excluir'),
    );
    this.actions = actions;
    root.append(this.select, this.grid, this.info, actions);
    this.select.addEventListener('change', () => {
      editor.setState('palette', this.select.value);
      this.draw();
    });
    editor.on('color', () => this.markActive());
    this.load();
  }

  get all() {
    return [...PRESET_PALETTES.map((p) => normalizePalette({ ...p, id: p.slug, preset: true })), ...this.mine];
  }

  get current() {
    return this.all.find((p) => p.id === this.editor.state.palette) ?? this.all[0];
  }

  async load() {
    try {
      const list = await this.getStorage().listPalettes();
      this.mine = list.map((p) => normalizePalette({ ...p, preset: false }));
    } catch (error) {
      notify('Não foi possível carregar as paletas salvas: ' + error.message, 'error');
    }
    this.buildSelect();
    this.draw();
  }

  buildSelect() {
    const group = (label, list) => el('optgroup', { label: label }, list.map((p) => el('option', { value: p.id, selected: p.id === this.current.id }, `${p.name} (${p.colors.length})`)));
    this.select.replaceChildren(group('Predefinidas', this.all.filter((p) => p.preset)));
    if (this.mine.length) this.select.append(group('Minhas paletas', this.mine));
    this.select.value = this.current.id;
  }

  draw() {
    const p = this.current;
    this.grid.replaceChildren(
      ...p.colors.map((c, i) =>
        swatch(c, {
          title: `${colorToHex(c)} (${i + 1})${p.preset ? '' : ' · Ctrl+clique remove'}`,
          onClick: (e) => {
            if ((e.ctrlKey || e.metaKey) && !p.preset) return this.removeColor(i);
            this.editor.setColor('primary', c);
          },
          onRightClick: () => this.editor.setColor('secondary', c),
        }),
      ),
    );
    this.info.textContent = p.description || (p.preset ? '' : 'Clique esquerdo escolhe a cor principal, direito a secundária. Ctrl+clique remove a cor.');
    for (const b of this.actions.querySelectorAll('[data-mine-only]')) b.disabled = p.preset;
    this.markActive();
  }

  markActive() {
    const p = this.current;
    const buttons = this.grid.children;
    p.colors.forEach((c, i) => buttons[i]?.classList.toggle('active', c === this.editor.state.primaryColor));
  }

  async save(p) {
    const saved = await this.getStorage().savePalette({ id: p.preset ? null : p.id, name: p.name, colors: p.colors.map((c) => colorToHex(c)) });
    const normal = normalizePalette({ ...saved, preset: false });
    const i = this.mine.findIndex((x) => x.id === normal.id || x.id === p.id);
    if (i >= 0) this.mine[i] = normal;
    else this.mine.push(normal);
    this.editor.setState('palette', normal.id);
    this.buildSelect();
    this.draw();
    return normal;
  }

  async ensureEditable() {
    const p = this.current;
    if (!p.preset) return p;
    const name = await promptText('Copiar paleta', 'As paletas predefinidas não mudam. Nome da sua cópia:', `${p.name} (minha)`);
    if (!name) return null;
    return this.save({ name, colors: [...p.colors], preset: false });
  }

  async addColors(colors) {
    const p = await this.ensureEditable();
    if (!p) return;
    const added = colors.filter((c) => !p.colors.includes(c));
    if (!added.length) {
      notify('Essas cores já estão na paleta.');
      return;
    }
    await this.save({ ...p, colors: [...p.colors, ...added] });
    notify(added.length === 1 ? 'Cor adicionada à paleta.' : `${added.length} cores adicionadas à paleta.`, 'success');
  }

  addCurrentColor() {
    return this.addColors([this.editor.state.primaryColor]);
  }

  async removeColor(i) {
    const p = this.current;
    await this.save({ ...p, colors: p.colors.filter((_, k) => k !== i) });
  }

  async create() {
    const name = await promptText('Nova paleta', 'Nome da paleta', 'Minha paleta');
    if (!name) return;
    await this.save({ name, colors: [this.editor.state.primaryColor, this.editor.state.secondaryColor].filter((c) => c >>> 24), preset: false });
    notify('Paleta criada. Use "+ Cor" ou o gerador de tons para preencher.', 'success');
  }

  async fromDrawing() {
    const colors = extractPalette(this.editor.doc.frames.flatMap((_, i) => [...this.editor.doc.composite(i)]), 256);
    if (!colors.length) {
      notify('O desenho ainda não tem cores.', 'warning');
      return;
    }
    const name = await promptText('Paleta do desenho', `${colors.length} cores encontradas. Nome da paleta:`, `Cores de ${this.editor.doc.name}`);
    if (!name) return;
    await this.save({ name, colors, preset: false });
  }

  async importFile() {
    const file = await pickFile('.hex,.gpl,.json,.txt,.csv');
    if (!file) return;
    try {
      const { name, colors } = importPalette(await file.text(), file.name);
      await this.save({ name, colors, preset: false });
      notify(`Paleta "${name}" importada com ${colors.length} cores.`, 'success');
    } catch (error) {
      notify('Não deu para importar: ' + error.message, 'error');
    }
  }

  async exportFile() {
    const p = this.current;
    const select = el('select', {}, el('option', { value: 'hex' }, '.hex (uma cor por linha, Lospec)'), el('option', { value: 'gpl' }, '.gpl (GIMP, Aseprite, Krita)'), el('option', { value: 'json' }, '.json'));
    const format = await openDialog({
      title: `Exportar "${p.name}"`,
      body: el('label', { class: 'field' }, el('span', {}, 'Formato'), select),
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Baixar', primary: true, send: true, action: () => select.value },
      ],
    });
    if (!format) return;
    downloadText(exportPalette(p, format), fileNameFor(p.name, format));
  }

  async rename() {
    const p = this.current;
    if (p.preset) return;
    const name = await promptText('Renomear paleta', 'Novo nome', p.name);
    if (name) await this.save({ ...p, name });
  }

  async remove() {
    const p = this.current;
    if (p.preset) return;
    if (!(await confirm('Excluir paleta', `A paleta "${p.name}" será apagada.`, 'Excluir', true))) return;
    await this.getStorage().deletePalette(p.id);
    this.mine = this.mine.filter((x) => x.id !== p.id);
    this.editor.setState('palette', 'crivo');
    this.buildSelect();
    this.draw();
  }
}

export class RampPanel {
  constructor(root, editor, palettePanel) {
    this.editor = editor;
    this.palettePanel = palettePanel;
    const prefs = readPreference('ramp', { steps: 3, intensity: 80, shift: 18 });
    this.steps = el('input', { type: 'range', min: 1, max: 6, value: prefs.steps, 'aria-label': 'Tons para cada lado' });
    this.intensity = el('input', { type: 'range', min: 10, max: 100, value: prefs.intensity, 'aria-label': 'Intensidade' });
    this.shift = el('input', { type: 'range', min: 0, max: 60, value: prefs.shift, 'aria-label': 'Desvio de matiz' });
    this.outputs = { steps: el('output', { class: 'mono' }), intensity: el('output', { class: 'mono' }), shift: el('output', { class: 'mono' }) };
    this.ramp = el('div', { class: 'swatches ramp' });
    root.append(
      this.ramp,
      el('label', { class: 'field compact' }, el('span', {}, 'Passos'), this.steps, this.outputs.steps),
      el('label', { class: 'field compact' }, el('span', {}, 'Alcance'), this.intensity, this.outputs.intensity),
      el('label', { class: 'field compact', title: 'Sombras puxam para o azul e luzes para o amarelo, como na pintura de pixel art' }, el('span', {}, 'Matiz'), this.shift, this.outputs.shift),
      el('div', { class: 'row-actions' }, el('button', { type: 'button', class: 'button small', onclick: () => this.palettePanel.addColors(this.colors) }, 'Adicionar à paleta')),
    );
    for (const i of [this.steps, this.intensity, this.shift]) {
      i.addEventListener('input', () => {
        writePreference('ramp', { steps: +this.steps.value, intensity: +this.intensity.value, shift: +this.shift.value });
        this.update();
      });
    }
    editor.on('color', ({ which }) => {
      if (which !== 'secondary' && !this.picking) this.update();
    });
    this.update();
  }

  update() {
    const base = this.editor.state.primaryColor;
    this.outputs.steps.textContent = this.steps.value;
    this.outputs.intensity.textContent = this.intensity.value + '%';
    this.outputs.shift.textContent = this.shift.value + '°';
    const { ramp } = generateRamp(base, { steps: +this.steps.value, intensity: +this.intensity.value / 100, hueShift: +this.shift.value });
    this.colors = ramp;
    this.ramp.replaceChildren(
      ...ramp.map((c) =>
        swatch(c, {
          className: c === base ? 'base' : '',
          onClick: () => {
            this.picking = true;
            this.editor.setColor('primary', c);
            this.picking = false;
            this.mark(c);
          },
          onRightClick: () => this.editor.setColor('secondary', c),
        }),
      ),
    );
    this.mark(base);
  }

  mark(c) {
    [...this.ramp.children].forEach((b, i) => b.classList.toggle('active', this.colors[i] === c));
  }
}

export class LayersPanel {
  constructor(root, editor) {
    this.editor = editor;
    this.list = el('ol', { class: 'layer-list', 'aria-label': 'Camadas, da mais alta para a mais baixa' });
    this.opacity = el('input', { type: 'range', min: 0, max: 100, 'aria-label': 'Opacidade da camada' });
    this.opacityValue = el('output', { class: 'mono' });
    root.append(
      this.list,
      el('label', { class: 'field compact' }, el('span', {}, 'Opacidade'), this.opacity, this.opacityValue),
      el(
        'div',
        { class: 'row-actions icons' },
        iconButton('plus', 'Nova camada', () => this.action('Nova camada', (d) => editor.selectLayer(d.addLayer(null, d.layerIndex(editor.currentLayer.id) + 1).id))),
        iconButton('duplicate', 'Duplicar camada', () => this.action('Duplicar camada', (d) => editor.selectLayer(d.duplicateLayer(editor.currentLayer.id).id))),
        iconButton('up', 'Subir camada', () => this.action('Subir camada', (d) => d.moveLayer(editor.currentLayer.id, 1))),
        iconButton('down', 'Descer camada', () => this.action('Descer camada', (d) => d.moveLayer(editor.currentLayer.id, -1))),
        iconButton('merge', 'Mesclar com a de baixo', () => this.action('Mesclar camadas', (d) => d.mergeDown(editor.currentLayer.id))),
        iconButton('trash', 'Excluir camada', () => this.remove()),
      ),
    );
    const saveOpacity = delay((id, before, value) => {
      const layer = editor.doc.layer(id);
      if (!layer) return;
      layer.opacity = before;
      editor.editStructure('Opacidade da camada', (d) => {
        d.layer(id).opacity = value;
      });
    }, 400);
    this.opacity.addEventListener('input', () => {
      const c = editor.currentLayer;
      if (this.originalOpacity === undefined || this.opacityId !== c.id) {
        this.originalOpacity = c.opacity;
        this.opacityId = c.id;
      }
      c.opacity = +this.opacity.value;
      this.opacityValue.textContent = c.opacity + '%';
      editor.emit('pixels');
      saveOpacity(c.id, this.originalOpacity, c.opacity);
    });
    this.opacity.addEventListener('change', () => {
      this.originalOpacity = undefined;
    });
    editor.on('document', () => this.draw());
    editor.on('layer', () => this.draw());
    editor.on('frame', () => this.scheduleThumbnails());
    editor.on('pixels', ({ thumbnails }) => {
      if (thumbnails) this.scheduleThumbnails();
    });
    this.scheduleThumbnails = delay(() => this.thumbnails(), 120);
    this.draw();
  }

  action(label, fn) {
    try {
      this.editor.editStructure(label, fn);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async remove() {
    const d = this.editor.doc;
    if (d.layers.length <= 1) {
      notify('O projeto precisa de pelo menos uma camada.', 'warning');
      return;
    }
    this.action('Excluir camada', (doc) => doc.removeLayer(this.editor.currentLayer.id));
  }

  draw() {
    const { doc } = this.editor;
    const current = this.editor.currentLayer;
    this.list.replaceChildren(
      ...[...doc.layers].reverse().map((c) => {
        const name = el('span', { class: 'name', title: 'Clique duas vezes para renomear' }, c.name);
        const mini = createCanvas(28, 28);
        mini.className = 'mini';
        mini.dataset.layer = c.id;
        const item = el(
          'li',
          { class: `layer ${c.id === current.id ? 'active' : ''} ${c.visible ? '' : 'hidden-layer'}`, tabindex: 0, 'aria-current': c.id === current.id ? 'true' : null },
          el('button', {
            type: 'button',
            class: 'icon-button',
            title: c.visible ? 'Ocultar' : 'Mostrar',
            'aria-label': (c.visible ? 'Ocultar ' : 'Mostrar ') + c.name,
            html: icon(c.visible ? 'eye' : 'eyeClosed', 16),
            onclick: (e) => {
              e.stopPropagation();
              this.action(c.visible ? 'Ocultar camada' : 'Mostrar camada', (d) => {
                d.layer(c.id).visible = !c.visible;
              });
            },
          }),
          mini,
          name,
          c.opacity < 100 ? el('span', { class: 'badge' }, c.opacity + '%') : null,
          el('button', {
            type: 'button',
            class: `icon-button ${c.locked ? 'on' : 'off'}`,
            title: c.locked ? 'Desbloquear' : 'Bloquear',
            'aria-label': (c.locked ? 'Desbloquear ' : 'Bloquear ') + c.name,
            html: icon(c.locked ? 'lock' : 'lockOpen', 16),
            onclick: (e) => {
              e.stopPropagation();
              this.action(c.locked ? 'Desbloquear camada' : 'Bloquear camada', (d) => {
                d.layer(c.id).locked = !c.locked;
              });
            },
          }),
        );
        item.addEventListener('click', () => this.editor.selectLayer(c.id));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.editor.selectLayer(c.id);
        });
        name.addEventListener('dblclick', async () => {
          const newName = await promptText('Renomear camada', 'Nome da camada', c.name);
          if (newName)
            this.action('Renomear camada', (d) => {
              d.layer(c.id).name = newName;
            });
        });
        return item;
      }),
    );
    this.opacity.value = current.opacity;
    this.opacityValue.textContent = current.opacity + '%';
    this.thumbnails();
  }

  thumbnails() {
    const { doc } = this.editor;
    const q = this.editor.currentFrame;
    for (const canvas of this.list.querySelectorAll('canvas.mini')) {
      const id = canvas.dataset.layer;
      if (!doc.layer(id)) continue;
      drawThumbnail(canvas, doc.cell(q.id, id), doc.width, doc.height);
    }
  }
}

export function drawThumbnail(canvas, pixels, width, height) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const l = width * scale;
  const a = height * scale;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(pixelsToCanvas(pixels, width, height), (canvas.width - l) / 2, (canvas.height - a) / 2, l, a);
}

export class Timeline {
  constructor(root, editor) {
    this.editor = editor;
    this.list = el('ol', { class: 'frame-list', 'aria-label': 'Quadros da animação' });
    this.play = el('button', { type: 'button', class: 'icon-button large', title: 'Tocar animação (Enter)', 'aria-label': 'Tocar animação', onclick: () => (editor.state.playing ? editor.stop() : editor.play()) });
    this.fps = el('input', { type: 'number', min: 1, max: 60, class: 'fps', 'aria-label': 'Quadros por segundo' });
    this.onionSkin = el('button', { type: 'button', class: 'icon-button', title: 'Papel cebola: mostra o quadro anterior (K)', 'aria-label': 'Papel cebola', html: icon('onionSkin', 16), onclick: () => editor.setState('onionSkin', !editor.state.onionSkin) });
    const action = (label, fn) => {
      try {
        editor.editStructure(label, fn);
      } catch (error) {
        notify(error.message, 'error');
      }
    };
    root.append(
      el(
        'div',
        { class: 'timeline-controls' },
        this.play,
        el('label', { class: 'field compact fps-field' }, el('span', {}, 'FPS'), this.fps),
        this.onionSkin,
        el('span', { class: 'separator' }),
        iconButton('plus', 'Novo quadro', () =>
          action('Novo quadro', (d) => {
            d.addFrame(editor.state.frame + 1);
            editor.state.frame += 1;
          }),
        ),
        iconButton('duplicate', 'Duplicar quadro', () =>
          action('Duplicar quadro', (d) => {
            d.duplicateFrame(editor.currentFrame.id);
            editor.state.frame += 1;
          }),
        ),
        iconButton('left', 'Mover quadro para a esquerda', () =>
          action('Mover quadro', (d) => {
            if (!d.moveFrame(editor.currentFrame.id, -1)) return false;
            editor.state.frame -= 1;
          }),
        ),
        iconButton('right', 'Mover quadro para a direita', () =>
          action('Mover quadro', (d) => {
            if (!d.moveFrame(editor.currentFrame.id, 1)) return false;
            editor.state.frame += 1;
          }),
        ),
        iconButton('trash', 'Excluir quadro', () => {
          if (editor.doc.frames.length <= 1) return notify('A animação precisa de pelo menos um quadro.', 'warning');
          action('Excluir quadro', (d) => d.removeFrame(editor.currentFrame.id));
        }),
      ),
      this.list,
    );
    this.fps.addEventListener('change', () => {
      const v = Math.max(1, Math.min(60, Math.round(+this.fps.value) || 8));
      action('Velocidade da animação', (d) => {
        d.fps = v;
      });
    });
    editor.on('document', () => this.draw());
    editor.on('frame', () => this.mark());
    editor.on('state', ({ key }) => {
      if (key === 'playing' || key === 'onionSkin') this.updateButtons();
    });
    editor.on('pixels', ({ thumbnails }) => {
      if (thumbnails) this.schedule();
    });
    this.schedule = delay(() => this.thumbnails(), 150);
    this.draw();
  }

  updateButtons() {
    const playing = this.editor.state.playing;
    this.play.innerHTML = icon(playing ? 'pause' : 'play', 18);
    this.play.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar animação');
    this.play.classList.toggle('on', playing);
    this.onionSkin.classList.toggle('on', this.editor.state.onionSkin);
    this.onionSkin.setAttribute('aria-pressed', String(this.editor.state.onionSkin));
  }

  draw() {
    const { doc } = this.editor;
    this.fps.value = doc.fps;
    this.list.replaceChildren(
      ...doc.frames.map((q, i) => {
        const c = createCanvas(48, 48);
        c.className = 'mini';
        const item = el('li', { class: 'frame', tabindex: 0, title: `Quadro ${i + 1}` }, c, el('span', { class: 'number' }, String(i + 1)));
        item.addEventListener('click', () => {
          this.editor.stop();
          this.editor.selectFrame(i);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.editor.selectFrame(i);
        });
        return item;
      }),
    );
    this.mark();
    this.updateButtons();
    this.thumbnails();
  }

  mark() {
    [...this.list.children].forEach((li, i) => {
      const active = i === this.editor.state.frame;
      li.classList.toggle('active', active);
      li.setAttribute('aria-current', active ? 'true' : 'false');
      if (active && this.editor.state.playing) li.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  thumbnails() {
    const { doc } = this.editor;
    [...this.list.querySelectorAll('canvas.mini')].forEach((c, i) => {
      if (i < doc.frames.length) drawThumbnail(c, doc.composite(i), doc.width, doc.height);
    });
  }
}
