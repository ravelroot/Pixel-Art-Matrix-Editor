import { el, notify, pickFile, readText, downloadText } from './util.js';
import { openDialog, confirm, promptText } from './dialog.js';
import { icon } from './icons.js';
import { fileToPixels } from './image.js';
import { serialize, deserialize, fileNameFor } from '../core/format.js';
import { PixelDocument } from '../core/document.js';
import { gameEngine } from '../core/game/engine.js';
import { gameAudio } from '../core/game/audio.js';
import { gamePlayer } from './game-player.js';
import { Terminal } from './game-terminal.js';
import { codeEditor } from './code-editor.js';
import { gameScript } from '../core/game/script.js';
import { compileGame, checkGame, bakeSprite } from '../core/game/compile.js';
import { gameHtml } from '../core/game/bundle.js';
import { sampleGame } from '../core/game/sample.js';
import {
  BEHAVIORS,
  PROP_LABELS,
  ANIM_LABELS,
  SOUND_SLOTS,
  TILE_FLAGS,
  TRIGGERS,
  ACTIONS,
  EVENTS,
  CONDITIONS,
  KEY_LABELS,
  TARGET_LABELS,
  OPERATORS,
  SOUND_PRESETS,
  WAVES,
  GAME_EXTENSION,
  MAX_SCENE_SIDE,
  SIZE_PRESETS,
  RESOLUTION_FOR,
  CODE_LANGS,
  CODE_TEMPLATES,
  newGame,
  newScene,
  newActor,
  newSound,
  normalizeGame,
  serializeGame,
  parseGame,
  removeEverywhere,
  resizeScene,
  floodTiles,
  usedBy,
} from '../core/game/project.js';
import { newId } from '../core/document.js';

const STORE_KEY = 'crivo.jogo';
const TABS = [
  ['scene', 'Cenas'],
  ['actors', 'Atores'],
  ['sprites', 'Sprites'],
  ['tiles', 'Tiles'],
  ['rules', 'Regras'],
  ['code', 'Código'],
  ['sounds', 'Sons'],
  ['settings', 'Jogo'],
];
const TOOLS = [
  ['tile', 'Pintar tile', 'pencil', 'B'],
  ['erase', 'Apagar tile', 'eraser', 'E'],
  ['fill', 'Balde de tiles', 'bucket', 'G'],
  ['rect', 'Retângulo de tiles', 'rectangle', 'U'],
  ['actor', 'Colocar ator', 'plus', 'A'],
  ['select', 'Mover ator', 'move', 'V'],
];
const FLAG_COLORS = { solid: 'rgba(93,28,22,0.55)', platform: 'rgba(122,110,70,0.6)', hazard: 'rgba(208,74,58,0.65)' };
const FLAG_SHORT = { solid: 'S', platform: 'P', hazard: '!' };

const engine = gameEngine();
const audio = gameAudio();
const player = gamePlayer();
const script = gameScript();

function readStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? parseGame(raw) : null;
  } catch {
    return null;
  }
}

function canvasFromPixels(pixels, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength)), w, h), 0, 0);
  return c;
}

function field(label, control, hint = '') {
  return el('label', { class: 'field jogo-campo' }, el('span', {}, label), control, hint ? el('small', { class: 'jogo-dica' }, hint) : null);
}

function select(options, value, onchange, label = '') {
  const s = el('select', { 'aria-label': label || null }, options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

function numberInput(value, onchange, { min = -1e6, max = 1e6, step = 1 } = {}) {
  const i = el('input', { type: 'number', value: value, min, max, step });
  i.addEventListener('change', () => {
    const n = Number(i.value);
    if (!Number.isFinite(n)) return;
    onchange(Math.max(min, Math.min(max, n)));
  });
  return i;
}

function textInput(value, onchange, max = 80) {
  const i = el('input', { type: 'text', value: value ?? '', maxlength: max, spellcheck: 'false' });
  i.addEventListener('change', () => onchange(i.value));
  return i;
}

function checkbox(checked, onchange, label) {
  const i = el('input', { type: 'checkbox', checked: Boolean(checked) });
  i.addEventListener('change', () => onchange(i.checked));
  return el('label', { class: 'jogo-check' }, i, el('span', {}, label));
}

function button(label, onclick, { primary = false, danger = false, small = true, iconName = '', title = '' } = {}) {
  return el('button', { type: 'button', class: `button${small ? ' small' : ''}${primary ? ' primary' : ''}${danger ? ' danger' : ''}`, title: title || null, onclick }, iconName ? el('span', { class: 'jogo-ico', html: icon(iconName, 14) }) : null, label);
}

export class GameStudio {
  constructor(app) {
    this.app = app;
    this.game = null;
    this.cache = new Map();
    this.art = new Map();
    this.links = new Map();
    this.tab = 'scene';
    this.sceneId = '';
    this.actorId = '';
    this.tilesetId = '';
    this.soundId = '';
    this.tool = 'tile';
    this.brushTile = 1;
    this.brushActor = '';
    this.selected = null;
    this.zoom = 3;
    this.showGrid = true;
    this.showFlags = false;
    this.undoStack = [];
    this.redoStack = [];
    this.dialog = null;
    this.saveTimer = 0;
    this.raf = 0;
    this.previews = [];
  }

  load() {
    if (this.game) return this.game;
    this.game = readStored() || normalizeGame(sampleGame());
    this.sceneId = this.game.start;
    this.fixSelection();
    return this.game;
  }

  get scene() {
    return this.game.scenes.find((s) => s.id === this.sceneId) || this.game.scenes[0];
  }

  get actor() {
    return this.game.actors.find((a) => a.id === this.actorId) || null;
  }

  remember() {
    this.undoStack.push(serializeGame(this.game));
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
  }

  changed(render = true) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.store(), 400);
    if (render) this.render();
    this.updateHeader();
  }

  store() {
    try {
      localStorage.setItem(STORE_KEY, serializeGame(this.game));
      return true;
    } catch {
      if (!this.warnedQuota) notify('O jogo ficou grande demais para o rascunho do navegador. Use "Salvar arquivo" para não perder nada.', 'warning', 6000);
      this.warnedQuota = true;
      return false;
    }
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(serializeGame(this.game));
    this.game = parseGame(this.undoStack.pop());
    this.fixSelection();
    this.changed();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(serializeGame(this.game));
    this.game = parseGame(this.redoStack.pop());
    this.fixSelection();
    this.changed();
  }

  fixSelection() {
    const g = this.game;
    if (!g.scenes.some((s) => s.id === this.sceneId)) this.sceneId = g.start;
    if (!g.actors.some((a) => a.id === this.actorId)) this.actorId = g.actors[0]?.id || '';
    if (!g.actors.some((a) => a.id === this.brushActor)) this.brushActor = g.actors[0]?.id || '';
    if (!g.tilesets.some((t) => t.id === this.tilesetId)) this.tilesetId = g.tilesets[0]?.id || '';
    if (!g.sounds.some((s) => s.id === this.soundId)) this.soundId = g.sounds[0]?.id || '';
    if (this.selected && !this.scene.entities.includes(this.selected)) this.selected = null;
  }

  replace(game, message) {
    this.remember();
    this.game = game;
    this.cache.clear();
    this.art.clear();
    this.links.clear();
    this.sceneId = game.start;
    this.selected = null;
    this.fixSelection();
    this.changed();
    if (message) notify(message, 'success');
  }

  spriteArt(id) {
    const sprite = this.game.sprites.find((s) => s.id === id);
    if (!sprite) return null;
    const hit = this.art.get(id);
    if (hit && hit.data === sprite.data) return hit;
    let baked;
    try {
      baked = bakeSprite(sprite, this.cache);
    } catch {
      return null;
    }
    const art = { data: sprite.data, baked, w: baked.w, h: baked.h, canvases: baked.frames.map((f) => canvasFromPixels(f.pixels, baked.w, baked.h)) };
    this.art.set(id, art);
    return art;
  }

  tilesetArt(id) {
    const t = this.game.tilesets.find((x) => x.id === id);
    if (!t) return null;
    const s = this.spriteArt(t.sprite);
    if (!s) return { set: t, sheet: null, columns: 1, count: 0, tw: t.tileWidth, th: t.tileHeight };
    const columns = Math.max(1, Math.floor(s.w / t.tileWidth));
    const rows = Math.max(1, Math.floor(s.h / t.tileHeight));
    return { set: t, sheet: s.canvases[0], columns, count: columns * rows, tw: t.tileWidth, th: t.tileHeight };
  }

  refreshLinks() {
    const tabs = this.app.tabs;
    const open = new Set(tabs ? tabs.tabs.map((t, i) => (i === tabs.active ? this.app.editor.doc : t.session?.doc)).filter(Boolean) : [this.app.editor.doc]);
    let updated = 0;
    for (const [id, doc] of this.links) {
      const sprite = this.game.sprites.find((s) => s.id === id);
      if (!sprite || !open.has(doc)) {
        this.links.delete(id);
        continue;
      }
      const data = serialize(doc);
      if (JSON.stringify(data) !== JSON.stringify(sprite.data)) {
        sprite.data = data;
        sprite.name = doc.name || sprite.name;
        updated++;
      }
    }
    if (updated) {
      this.store();
      notify(updated === 1 ? 'Sprite atualizado com o que você desenhou.' : `${updated} sprites atualizados com o que você desenhou.`, 'success');
    }
  }

  async show(tab = null) {
    if (this.dialog) {
      if (tab) this.switchTab(tab);
      return;
    }
    if (tab) this.tab = tab;
    this.load();
    this.refreshLinks();
    this.fixSelection();
    this.build();
    document.body.append(this.dialog);
    this.dialog.showModal();
    window.addEventListener('keydown', this.onKey);
    this.render();
    this.updateHeader();
    this.loop();
  }

  close() {
    if (!this.dialog) return;
    this.stopTest();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.saveTimer);
    this.store();
    window.removeEventListener('keydown', this.onKey);
    this.dialog.close();
    this.dialog.remove();
    this.dialog = null;
  }

  loop() {
    const tick = (time) => {
      if (!this.dialog) return;
      this.raf = requestAnimationFrame(tick);
      for (const p of this.previews) {
        if (!p.canvas.isConnected) continue;
        const art = this.spriteArt(p.sprite);
        if (!art) continue;
        const seq = (p.anim && art.baked.anims[p.anim]) || art.baked.all;
        const total = seq.frames.reduce((s, f) => s + art.baked.frames[f].d, 0) || 1;
        let t = ((time / 1000) % total + total) % total;
        let f = seq.frames[0] ?? 0;
        for (const i of seq.frames) {
          const d = art.baked.frames[i].d;
          if (t < d) {
            f = i;
            break;
          }
          t -= d;
        }
        const ctx = p.canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
        const k = Math.max(1, Math.floor(Math.min(p.canvas.width / art.w, p.canvas.height / art.h)));
        ctx.drawImage(art.canvases[f], Math.floor((p.canvas.width - art.w * k) / 2), Math.floor((p.canvas.height - art.h * k) / 2), art.w * k, art.h * k);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  build() {
    this.nameInput = el('input', { type: 'text', class: 'jogo-nome', maxlength: 80, value: this.game.name, 'aria-label': 'Nome do jogo', spellcheck: 'false' });
    this.nameInput.addEventListener('change', () => {
      this.remember();
      this.game.name = this.nameInput.value.trim() || 'Meu jogo';
      this.changed(false);
    });
    this.undoButton = el('button', { type: 'button', class: 'icon-button', title: 'Desfazer (Ctrl+Z)', 'aria-label': 'Desfazer', html: icon('undo', 16), onclick: () => this.undo() });
    this.redoButton = el('button', { type: 'button', class: 'icon-button', title: 'Refazer (Ctrl+Y)', 'aria-label': 'Refazer', html: icon('redo', 16), onclick: () => this.redo() });
    this.tabBar = el(
      'nav',
      { class: 'jogo-abas', role: 'tablist', 'aria-label': 'Partes do jogo' },
      TABS.map(([id, label]) => el('button', { type: 'button', role: 'tab', class: 'jogo-aba', data: { tab: id }, onclick: () => this.switchTab(id) }, label)),
    );
    this.body = el('div', { class: 'jogo-corpo' });
    this.statusLine = el('span', { class: 'jogo-status mono' });
    this.dialog = el(
      'dialog',
      { class: 'jogo', 'aria-label': 'Estúdio de jogo' },
      el(
        'header',
        { class: 'jogo-topo' },
        el('div', { class: 'jogo-marca' }, el('span', { class: 'jogo-ico', html: icon('play', 18) }), el('strong', {}, 'Estúdio de jogo'), this.nameInput),
        this.tabBar,
        el(
          'div',
          { class: 'jogo-acoes' },
          this.undoButton,
          this.redoButton,
          button('Testar', () => this.test(), { primary: true, iconName: 'play', title: 'Testar o jogo a partir desta cena (F5)' }),
          button('Exportar jogo', () => this.exportHtml(), { iconName: 'disk', title: 'Gera um arquivo .html que roda o jogo em qualquer navegador' }),
          this.menuButton(),
          el('button', { type: 'button', class: 'icon-button close', title: 'Fechar (Esc)', 'aria-label': 'Fechar o estúdio', onclick: () => this.close() }, '×'),
        ),
      ),
      this.body,
      el('footer', { class: 'jogo-rodape' }, this.statusLine, el('span', { class: 'jogo-ajuda' }, 'F5 testa · Ctrl+Z desfaz · o jogo fica salvo neste navegador enquanto você edita')),
    );
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (this.testing) this.stopTest();
      else this.close();
    });
    this.onKey = (e) => {
      if (this.dialog && !e.defaultPrevented && !document.querySelector('dialog.dialog[open]')) this.key(e);
    };
  }

  menuButton() {
    const menu = el('div', { class: 'menu jogo-menu', role: 'menu', hidden: true });
    const items = [
      ['Novo jogo em branco', () => this.newGame()],
      ['Abrir o jogo de exemplo', () => this.loadSample()],
      ['-'],
      ['Abrir arquivo .crivojogo…', () => this.openFile()],
      ['Salvar arquivo .crivojogo…', () => this.saveFile()],
      ['-'],
      ['Exportar jogo (HTML)…', () => this.exportHtml()],
      ['Exportar dados do jogo (JSON)…', () => this.exportJson()],
    ];
    const toggle = el('button', { type: 'button', class: 'button small', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, 'Arquivo ▾');
    const close = () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => {
      if (!menu.contains(e.target) && e.target !== toggle) close();
    };
    menu.append(
      ...items.map(([label, fn]) =>
        label === '-'
          ? el('hr')
          : el(
              'button',
              {
                type: 'button',
                role: 'menuitem',
                class: 'menu-item',
                onclick: () => {
                  close();
                  Promise.resolve()
                    .then(fn)
                    .catch((error) => notify(error.message || String(error), 'error', 5000));
                },
              },
              el('span', { class: 'check' }),
              el('span', {}, label),
              el('kbd', {}),
            ),
      ),
    );
    toggle.addEventListener('click', () => {
      if (!menu.hidden) return close();
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
    });
    return el('div', { class: 'jogo-menu-host' }, toggle, menu);
  }

  updateHeader() {
    if (!this.dialog) return;
    this.undoButton.disabled = !this.undoStack.length;
    this.redoButton.disabled = !this.redoStack.length;
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.game.name;
    for (const b of this.tabBar.children) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('ativa', on);
      b.setAttribute('aria-selected', String(on));
    }
  }

  switchTab(tab) {
    this.tab = tab;
    this.render();
    this.updateHeader();
  }

  key(e) {
    const target = e.target;
    const typing = target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    if (this.testing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F5') {
      e.preventDefault();
      this.test();
      return;
    }
    if (typing) return;
    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      this.saveFile();
    } else if (this.tab === 'scene' && !ctrl) {
      const tool = TOOLS.find((t) => t[3].toLowerCase() === k);
      if (tool && !(this.tab === 'scene' && this.selected && document.activeElement?.closest?.('.jogo-inspetor'))) {
        this.tool = tool[0];
        this.render();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
        e.preventDefault();
        this.remember();
        this.scene.entities = this.scene.entities.filter((x) => x !== this.selected);
        this.selected = null;
        this.changed();
      } else if (k === 'f' && this.selected) {
        this.remember();
        this.selected.flip = !this.selected.flip;
        this.changed(false);
        this.drawScene();
      } else if (k === '+' || k === '=') {
        this.zoom = Math.min(8, this.zoom + 1);
        this.render();
      } else if (k === '-') {
        this.zoom = Math.max(1, this.zoom - 1);
        this.render();
      }
    }
  }

  render() {
    if (!this.dialog) return;
    this.previews = [];
    const tab = this.tab;
    const content =
      tab === 'scene'
        ? this.sceneTab()
        : tab === 'actors'
          ? this.actorsTab()
          : tab === 'sprites'
            ? this.spritesTab()
            : tab === 'tiles'
              ? this.tilesTab()
              : tab === 'rules'
                ? this.rulesTab()
                : tab === 'sounds'
                  ? this.soundsTab()
                  : tab === 'code'
                    ? this.codeTab()
                    : this.settingsTab();
    const scroll = this.body.querySelector('.jogo-palco')?.scrollLeft;
    const scrollTop = this.body.querySelector('.jogo-palco')?.scrollTop;
    this.body.replaceChildren(content);
    const stage = this.body.querySelector('.jogo-palco');
    if (stage && scroll !== undefined) {
      stage.scrollLeft = scroll;
      stage.scrollTop = scrollTop;
    }
    if (tab === 'scene') this.drawScene();
  }

  preview(spriteId, anim = '', size = 64) {
    const canvas = el('canvas', { class: 'jogo-previa', width: size, height: size });
    this.previews.push({ canvas, sprite: spriteId, anim });
    return canvas;
  }

  list(items, current, onpick, render) {
    return el(
      'ul',
      { class: 'jogo-lista', role: 'listbox' },
      items.map((item) =>
        el(
          'li',
          {},
          el(
            'button',
            { type: 'button', role: 'option', class: `jogo-item${item.id === current ? ' ativo' : ''}`, 'aria-selected': String(item.id === current), onclick: () => onpick(item.id) },
            render(item),
          ),
        ),
      ),
    );
  }

  spriteOptions(empty = '(nenhum)') {
    return [['', empty], ...this.game.sprites.map((s) => [s.id, s.name])];
  }

  actorOptions(empty = null) {
    const list = this.game.actors.map((a) => [a.id, a.name]);
    return empty === null ? list : [['', empty], ...list];
  }

  soundOptions(empty = '(nenhum)') {
    return [['', empty], ...this.game.sounds.map((s) => [s.id, s.name])];
  }

  sceneOptions(empty = null) {
    const list = this.game.scenes.map((s) => [s.id, s.name]);
    return empty === null ? list : [['', empty], ...list];
  }

  varOptions(empty = null) {
    const list = this.game.vars.map((v) => [v.name, v.label ? `${v.label} (${v.name})` : v.name]);
    return empty === null ? list : [['', empty], ...list];
  }

  sceneTab() {
    const g = this.game;
    const scene = this.scene;
    const sceneList = this.list(g.scenes, scene.id, (id) => {
      this.sceneId = id;
      this.selected = null;
      this.render();
    }, (s) => [el('span', {}, s.name), s.id === g.start ? el('small', { class: 'jogo-selo' }, 'início') : null]);
    const props = el(
      'div',
      { class: 'jogo-form' },
      field('Nome da cena', textInput(scene.name, (v) => this.edit(() => (scene.name = v.trim() || scene.name)))),
      el(
        'div',
        { class: 'jogo-linha' },
        field('Colunas', numberInput(scene.cols, (v) => this.edit(() => resizeScene(scene, v, scene.rows)), { min: 1, max: MAX_SCENE_SIDE })),
        field('Linhas', numberInput(scene.rows, (v) => this.edit(() => resizeScene(scene, scene.cols, v)), { min: 1, max: MAX_SCENE_SIDE })),
      ),
      field('Tileset', select([['', '(nenhum)'], ...g.tilesets.map((t) => [t.id, t.name])], scene.tileset, (v) => this.edit(() => (scene.tileset = v)))),
      field('Cor de fundo', this.colorInput(scene.background || g.background, (v) => this.edit(() => (scene.background = v)))),
      field('Paisagem ao fundo', select(this.spriteOptions(), scene.backdrop, (v) => this.edit(() => (scene.backdrop = v))), 'Um sprite que se repete atrás da cena, com profundidade.'),
      field('Música (notas)', this.musicInput(scene), 'Ex.: 140: C5 E5 G5 C6*2 - G5. Opcional: "triangular:" depois do andamento.'),
      el(
        'div',
        { class: 'jogo-botoes' },
        button('Nova', () => this.addScene(), { iconName: 'plus' }),
        button('Duplicar', () => this.duplicateScene(), { iconName: 'duplicate' }),
        button('Começa aqui', () => this.edit(() => (g.start = scene.id)), { title: 'O jogo começa por esta cena' }),
        button('Subir', () => this.moveScene(-1), { iconName: 'up' }),
        button('Descer', () => this.moveScene(1), { iconName: 'down' }),
        button('Excluir', () => this.deleteScene(), { iconName: 'trash', danger: true }),
      ),
    );
    const tools = el(
      'div',
      { class: 'jogo-ferramentas', role: 'toolbar', 'aria-label': 'Ferramentas da cena' },
      TOOLS.map(([id, label, ic, key]) =>
        el('button', {
          type: 'button',
          class: `tool${this.tool === id ? ' active' : ''}`,
          title: `${label} (${key})`,
          'aria-label': `${label} (${key})`,
          'aria-pressed': String(this.tool === id),
          html: icon(ic, 18),
          onclick: () => {
            this.tool = id;
            this.render();
          },
        }),
      ),
      el('span', { class: 'jogo-sep' }),
      el('button', { type: 'button', class: 'icon-button', title: 'Diminuir zoom (-)', 'aria-label': 'Diminuir zoom', html: icon('minus', 16), onclick: () => ((this.zoom = Math.max(1, this.zoom - 1)), this.render()) }),
      el('span', { class: 'mono jogo-zoom' }, `${this.zoom * 100}%`),
      el('button', { type: 'button', class: 'icon-button', title: 'Aumentar zoom (+)', 'aria-label': 'Aumentar zoom', html: icon('plus', 16), onclick: () => ((this.zoom = Math.min(8, this.zoom + 1)), this.render()) }),
      el('span', { class: 'jogo-sep' }),
      select([['front', 'Camada: frente (com colisão)'], ['back', 'Camada: fundo (só enfeite)']], this.layer || 'front', (v) => {
        this.layer = v;
        this.drawScene();
      }, 'Camada de tiles'),
      checkbox(this.showGrid, (v) => ((this.showGrid = v), this.drawScene()), 'Grade'),
      checkbox(this.showFlags, (v) => ((this.showFlags = v), this.drawScene()), 'Colisão'),
    );
    this.canvas = el('canvas', { class: 'jogo-cena', 'aria-label': 'Cena do jogo. Clique para pintar tiles ou colocar atores.' });
    this.canvas.addEventListener('pointerdown', (e) => this.scenePointer(e, 'down'));
    this.canvas.addEventListener('pointermove', (e) => this.scenePointer(e, 'move'));
    this.canvas.addEventListener('pointerup', (e) => this.scenePointer(e, 'up'));
    this.canvas.addEventListener('pointercancel', () => (this.drag = null));
    this.canvas.addEventListener('pointerleave', () => this.hover(null));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = el('div', { class: 'jogo-palco' }, this.canvas);
    const ts = this.tilesetArt(scene.tileset);
    let palette;
    if (!ts) palette = el('p', { class: 'jogo-vazio' }, 'Escolha um tileset para a cena (ou crie um na aba Tiles).');
    else if (!ts.sheet) palette = el('p', { class: 'jogo-vazio' }, 'O tileset não tem sprite.');
    else {
      palette = el(
        'div',
        { class: 'jogo-tiles', style: { '--colunas': String(Math.min(ts.columns, 6)) } },
        Array.from({ length: ts.count }, (_, i) => {
          const c = el('canvas', { width: ts.tw, height: ts.th });
          const ctx = c.getContext('2d');
          ctx.drawImage(ts.sheet, (i % ts.columns) * ts.tw, Math.floor(i / ts.columns) * ts.th, ts.tw, ts.th, 0, 0, ts.tw, ts.th);
          const flag = ts.set.flags[i + 1];
          return el(
            'button',
            {
              type: 'button',
              class: `jogo-tile${this.brushTile === i + 1 ? ' ativo' : ''}`,
              title: `Tile ${i + 1}${flag ? ` · ${TILE_FLAGS.find((f) => f[0] === flag)?.[1]}` : ''}`,
              onclick: () => {
                this.brushTile = i + 1;
                if (!['tile', 'fill', 'rect'].includes(this.tool)) this.tool = 'tile';
                this.render();
              },
            },
            c,
            flag ? el('span', { class: `jogo-flag flag-${flag}` }, FLAG_SHORT[flag]) : null,
          );
        }),
      );
    }
    const actors = g.actors.length
      ? el(
          'div',
          { class: 'jogo-atores' },
          g.actors.map((a) =>
            el(
              'button',
              {
                type: 'button',
                class: `jogo-ator${this.brushActor === a.id ? ' ativo' : ''}`,
                title: `${a.name} · ${BEHAVIORS[a.behavior].label}`,
                onclick: () => {
                  this.brushActor = a.id;
                  this.tool = 'actor';
                  this.render();
                },
              },
              this.preview(a.sprite, a.anims.idle || '', 32),
              el('span', {}, a.name),
            ),
          ),
        )
      : el('p', { class: 'jogo-vazio' }, 'Nenhum ator ainda. Crie na aba Atores.');
    return el(
      'div',
      { class: 'jogo-cenas' },
      el('aside', { class: 'jogo-lado' }, el('h3', {}, 'Cenas'), sceneList, props, this.inspector()),
      el('section', { class: 'jogo-centro' }, tools, stage),
      el('aside', { class: 'jogo-lado jogo-direita' }, el('h3', {}, 'Tiles'), palette, el('h3', {}, 'Atores'), actors),
    );
  }

  colorInput(value, onchange) {
    const i = el('input', { type: 'color', value: value || '#a3b4be' });
    i.addEventListener('change', () => onchange(i.value));
    return i;
  }

  musicInput(scene) {
    const i = textInput(scene.music, (v) => this.edit(() => (scene.music = v.trim())), 400);
    const play = button('Tocar', () => {
      const data = audio.renderMelody(i.value);
      if (!data) return notify('Nenhuma nota reconhecida. Use notas como C4, D#4, Eb5 e - para pausa.', 'warning');
      this.playSamples(data);
    }, { iconName: 'play' });
    return el('div', { class: 'jogo-linha' }, i, play);
  }

  playSamples(data) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.audioContext) this.audioContext = new AC();
      const ctx = this.audioContext;
      if (this.previewNode) {
        try {
          this.previewNode.stop();
        } catch {
          this.previewNode = null;
        }
      }
      const buffer = ctx.createBuffer(1, data.length, audio.RATE);
      buffer.getChannelData(0).set(data);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start();
      this.previewNode = node;
    } catch {
      notify('Este navegador não deixou tocar o som.', 'warning');
    }
  }

  edit(fn, render = true) {
    this.remember();
    fn();
    this.changed(render);
  }

  addScene() {
    const g = this.game;
    this.edit(() => {
      const s = newScene(`Fase ${g.scenes.length + 1}`, this.scene.cols, this.scene.rows);
      s.tileset = this.scene.tileset;
      g.scenes.push(s);
      this.sceneId = s.id;
    });
  }

  duplicateScene() {
    const g = this.game;
    this.edit(() => {
      const copy = JSON.parse(JSON.stringify(this.scene));
      copy.id = newId('cena');
      copy.name = `${this.scene.name} (cópia)`;
      copy.entities.forEach((e) => (e.id = newId('obj')));
      g.scenes.splice(g.scenes.indexOf(this.scene) + 1, 0, copy);
      this.sceneId = copy.id;
    });
  }

  moveScene(delta) {
    const list = this.game.scenes;
    const i = list.indexOf(this.scene);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    this.edit(() => ([list[i], list[j]] = [list[j], list[i]]));
  }

  async deleteScene() {
    if (this.game.scenes.length <= 1) return notify('O jogo precisa de pelo menos uma cena.', 'warning');
    if (!(await confirm('Excluir cena', `Excluir "${this.scene.name}"? As regras só desta cena também saem.`, 'Excluir', true))) return;
    this.edit(() => {
      removeEverywhere(this.game, 'scene', this.scene.id);
      this.sceneId = this.game.start;
    });
  }

  sceneMetrics() {
    const ts = this.tilesetArt(this.scene.tileset);
    return { tw: ts?.tw || 8, th: ts?.th || 8, ts };
  }

  drawScene() {
    const canvas = this.canvas;
    if (!canvas || !canvas.isConnected) return;
    const scene = this.scene;
    const { tw, th, ts } = this.sceneMetrics();
    const z = this.zoom;
    const W = scene.cols * tw;
    const H = scene.rows * th;
    canvas.width = W * z;
    canvas.height = H * z;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(z, 0, 0, z, 0, 0);
    ctx.fillStyle = scene.background || this.game.background;
    ctx.fillRect(0, 0, W, H);
    const back = this.spriteArt(scene.backdrop);
    if (back) for (let x = 0; x < W; x += back.w) ctx.drawImage(back.canvases[0], x, Math.max(0, Math.min(H, this.game.height) - back.h));
    if (ts?.sheet) {
      if (Array.isArray(scene.back)) {
        ctx.globalAlpha = this.layer === 'back' ? 1 : 0.85;
        for (let r = 0; r < scene.rows; r++) {
          for (let c = 0; c < scene.cols; c++) {
            const k = scene.back[r * scene.cols + c];
            if (k > 0 && k <= ts.count) ctx.drawImage(ts.sheet, ((k - 1) % ts.columns) * tw, Math.floor((k - 1) / ts.columns) * th, tw, th, c * tw, r * th, tw, th);
          }
        }
        ctx.globalAlpha = this.layer === 'back' ? 0.35 : 1;
      }
      for (let r = 0; r < scene.rows; r++) {
        for (let c = 0; c < scene.cols; c++) {
          const k = scene.tiles[r * scene.cols + c];
          if (k > 0 && k <= ts.count) ctx.drawImage(ts.sheet, ((k - 1) % ts.columns) * tw, Math.floor((k - 1) / ts.columns) * th, tw, th, c * tw, r * th, tw, th);
          if (this.showFlags && k > 0) {
            const f = ts.set.flags[k];
            if (f) {
              ctx.fillStyle = FLAG_COLORS[f];
              ctx.fillRect(c * tw, r * th, tw, th);
            }
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const e of scene.entities) {
      const a = this.game.actors.find((x) => x.id === e.actor);
      const art = a && this.spriteArt(a.sprite);
      if (!art) {
        ctx.fillStyle = 'rgba(93,28,22,0.6)';
        ctx.fillRect(e.x, e.y, 8, 8);
        continue;
      }
      if (e.flip) {
        ctx.save();
        ctx.translate(e.x + art.w, e.y);
        ctx.scale(-1, 1);
        ctx.drawImage(art.canvases[0], 0, 0);
        ctx.restore();
      } else ctx.drawImage(art.canvases[0], e.x, e.y);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.showGrid && z >= 2) {
      ctx.strokeStyle = 'rgba(43,29,23,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < scene.cols; c++) {
        ctx.moveTo(c * tw * z + 0.5, 0);
        ctx.lineTo(c * tw * z + 0.5, H * z);
      }
      for (let r = 1; r < scene.rows; r++) {
        ctx.moveTo(0, r * th * z + 0.5);
        ctx.lineTo(W * z, r * th * z + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(93,28,22,0.75)';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(0.5, 0.5, Math.min(W, this.game.width) * z - 1, Math.min(H, this.game.height) * z - 1);
    ctx.setLineDash([]);
    if (this.selected) {
      const a = this.game.actors.find((x) => x.id === this.selected.actor);
      const art = a && this.spriteArt(a.sprite);
      ctx.strokeStyle = '#f6e4a6';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.selected.x * z - 1, this.selected.y * z - 1, (art?.w || 8) * z + 2, (art?.h || 8) * z + 2);
    }
    if (this.rectDrag) {
      const { c0, r0, c1, r1 } = this.rectDrag;
      ctx.strokeStyle = '#f6e4a6';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(c0, c1) * tw * z, Math.min(r0, r1) * th * z, (Math.abs(c1 - c0) + 1) * tw * z, (Math.abs(r1 - r0) + 1) * th * z);
    }
    if (this.hoverCell && ['tile', 'erase', 'fill', 'rect', 'actor'].includes(this.tool)) {
      ctx.strokeStyle = 'rgba(250,246,239,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(this.hoverCell.c * tw * z + 0.5, this.hoverCell.r * th * z + 0.5, tw * z - 1, th * z - 1);
    }
  }

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const { tw, th } = this.sceneMetrics();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    const px = ((e.clientX - rect.left) * sx) / this.zoom;
    const py = ((e.clientY - rect.top) * sy) / this.zoom;
    return { px, py, c: Math.floor(px / tw), r: Math.floor(py / th), tw, th };
  }

  entityAt(px, py) {
    const list = this.scene.entities;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const a = this.game.actors.find((x) => x.id === e.actor);
      const art = a && this.spriteArt(a.sprite);
      const w = art?.w || 8;
      const h = art?.h || 8;
      if (px >= e.x && px < e.x + w && py >= e.y && py < e.y + h) return e;
    }
    return null;
  }

  hover(cell) {
    this.hoverCell = cell;
    const scene = this.scene;
    if (cell && cell.c >= 0 && cell.r >= 0 && cell.c < scene.cols && cell.r < scene.rows) {
      const k = scene.tiles[cell.r * scene.cols + cell.c];
      this.statusLine.textContent = `coluna ${cell.c + 1}, linha ${cell.r + 1} · x ${Math.floor(cell.px)}, y ${Math.floor(cell.py)} · tile ${k || '—'} · ${scene.entities.length} atores na cena`;
    } else this.statusLine.textContent = `${scene.cols}×${scene.rows} tiles · ${scene.entities.length} atores na cena`;
    this.drawScene();
  }

  paintCell(c, r, value) {
    const s = this.scene;
    if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) return false;
    const i = r * s.cols + c;
    const layer = this.layer === 'back' ? (s.back ||= new Array(s.cols * s.rows).fill(0)) : s.tiles;
    if (layer[i] === value) return false;
    layer[i] = value;
    return true;
  }

  scenePointer(e, phase) {
    const cell = this.cellAt(e);
    const scene = this.scene;
    const right = e.button === 2 || (e.buttons & 2) === 2;
    if (phase === 'down') {
      this.canvas.setPointerCapture(e.pointerId);
      this.remember();
      this.drag = { right, moved: false };
      if (this.tool === 'tile' || this.tool === 'erase') {
        this.paintCell(cell.c, cell.r, this.tool === 'erase' || right ? 0 : this.brushTile);
      } else if (this.tool === 'fill') {
        floodTiles(scene, cell.c, cell.r, right ? 0 : this.brushTile, this.layer === 'back' ? 'back' : 'tiles');
      } else if (this.tool === 'rect') {
        this.rectDrag = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r, value: right ? 0 : this.brushTile };
      } else if (this.tool === 'actor') {
        const hit = this.entityAt(cell.px, cell.py);
        if (right) {
          if (hit) scene.entities = scene.entities.filter((x) => x !== hit);
        } else if (this.brushActor) {
          const a = this.game.actors.find((x) => x.id === this.brushActor);
          const art = a && this.spriteArt(a.sprite);
          const h = art?.h || cell.th;
          const x = e.altKey ? Math.round(cell.px) : cell.c * cell.tw;
          const y = e.altKey ? Math.round(cell.py) : cell.r * cell.th + cell.th - h;
          const item = { id: newId('obj'), actor: this.brushActor, x, y, flip: false };
          scene.entities.push(item);
          this.selected = item;
        } else notify('Escolha um ator na lista da direita.', 'warning');
      } else if (this.tool === 'select') {
        const hit = this.entityAt(cell.px, cell.py);
        if (right && hit) {
          scene.entities = scene.entities.filter((x) => x !== hit);
          this.selected = null;
        } else {
          this.selected = hit;
          if (hit) this.drag.offset = { x: cell.px - hit.x, y: cell.py - hit.y };
        }
      }
      this.drawScene();
      return;
    }
    if (phase === 'move') {
      if (!this.drag) {
        this.hover(cell);
        return;
      }
      this.drag.moved = true;
      if (this.tool === 'tile' || this.tool === 'erase') {
        if (this.paintCell(cell.c, cell.r, this.tool === 'erase' || this.drag.right ? 0 : this.brushTile)) this.drawScene();
      } else if (this.tool === 'rect' && this.rectDrag) {
        this.rectDrag.c1 = cell.c;
        this.rectDrag.r1 = cell.r;
        this.drawScene();
      } else if (this.tool === 'select' && this.selected && this.drag.offset) {
        const nx = cell.px - this.drag.offset.x;
        const ny = cell.py - this.drag.offset.y;
        this.selected.x = e.altKey ? Math.round(nx) : Math.round(nx / cell.tw) * cell.tw;
        this.selected.y = e.altKey ? Math.round(ny) : Math.round(ny / cell.th) * cell.th;
        this.drawScene();
      }
      this.hover(cell);
      return;
    }
    if (phase === 'up') {
      if (this.tool === 'rect' && this.rectDrag) {
        const { c0, r0, c1, r1, value } = this.rectDrag;
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) this.paintCell(c, r, value);
        this.rectDrag = null;
      }
      this.drag = null;
      const last = this.undoStack[this.undoStack.length - 1];
      if (last === serializeGame(this.game)) this.undoStack.pop();
      this.changed(false);
      this.drawScene();
    }
  }

  actorsTab() {
    const g = this.game;
    const a = this.actor;
    const side = el(
      'aside',
      { class: 'jogo-lado' },
      el('h3', {}, 'Atores'),
      this.list(g.actors, a?.id, (id) => {
        this.actorId = id;
        this.render();
      }, (x) => [this.preview(x.sprite, x.anims.idle || '', 24), el('span', {}, x.name), el('small', { class: 'jogo-selo' }, BEHAVIORS[x.behavior].label.split(' (')[0])]),
      el(
        'div',
        { class: 'jogo-botoes' },
        button('Novo ator', () => this.addActor(), { iconName: 'plus' }),
        a ? button('Duplicar', () => this.duplicateActor(), { iconName: 'duplicate' }) : null,
        a ? button('Excluir', () => this.deleteActor(), { iconName: 'trash', danger: true }) : null,
      ),
    );
    if (!a) return el('div', { class: 'jogo-duas' }, side, el('section', { class: 'jogo-painel' }, el('p', { class: 'jogo-vazio' }, 'Um ator é qualquer coisa que se mexe ou interage na cena: o jogador, inimigos, moedas, portas, tiros. Crie o primeiro com "Novo ator".')));
    const def = BEHAVIORS[a.behavior];
    const art = this.spriteArt(a.sprite);
    const tags = art ? art.baked.tags : [];
    const propFields = Object.keys(def.props).map((k) => {
      const [label, unit, min, max, step] = PROP_LABELS[k] || [k];
      const v = a.props[k];
      if (typeof def.props[k] === 'boolean') return checkbox(v, (x) => this.edit(() => (a.props[k] = x), false), label);
      if (k === 'shoot') return field(label, select([['', '(não atira)'], ...g.actors.filter((x) => x.behavior === 'projectile').map((x) => [x.id, x.name])], v, (x) => this.edit(() => (a.props[k] = x), false)), 'Crie um ator "Projétil" para usar aqui. Botão X atira.');
      if (k === 'scene') return field(label, select([['', '(a próxima cena)'], ...this.sceneOptions()], v, (x) => this.edit(() => (a.props[k] = x), false)));
      return field(unit ? `${label} (${unit})` : label, numberInput(v, (x) => this.edit(() => (a.props[k] = x), false), { min, max, step }));
    });
    const animFields = def.anims.map((slot) => field(ANIM_LABELS[slot], select([['', '(todos os quadros)'], ...tags.map((t) => [t, t])], a.anims[slot] || '', (x) => this.edit(() => (x ? (a.anims[slot] = x) : delete a.anims[slot])))));
    const soundFields = def.sounds.map((slot) => field(SOUND_SLOTS[slot], select(this.soundOptions(), a.sounds[slot] || '', (x) => this.edit(() => (x ? (a.sounds[slot] = x) : delete a.sounds[slot]), false))));
    const hb = a.hitbox || (art ? art.baked.bounds : { x: 0, y: 0, w: 8, h: 8 });
    const hitbox = el(
      'div',
      { class: 'jogo-form' },
      checkbox(!a.hitbox, (auto) => this.edit(() => (a.hitbox = auto ? null : { ...hb })), 'Automática (só os pixels visíveis do 1º quadro)'),
      a.hitbox
        ? el(
            'div',
            { class: 'jogo-linha' },
            ...['x', 'y', 'w', 'h'].map((k) => field({ x: 'X', y: 'Y', w: 'Largura', h: 'Altura' }[k], numberInput(a.hitbox[k], (v) => this.edit(() => (a.hitbox[k] = v)), { min: k === 'w' || k === 'h' ? 1 : 0, max: 1024 }))),
          )
        : el('p', { class: 'jogo-dica' }, `x ${hb.x}, y ${hb.y}, ${hb.w}×${hb.h} px`),
    );
    const box = el('canvas', { class: 'jogo-previa grande', width: 160, height: 160 });
    this.previews.push({ canvas: box, sprite: a.sprite, anim: a.anims.idle || '' });
    const hitPreview = el('div', { class: 'jogo-hitbox-host' }, box);
    if (art) {
      const k = Math.max(1, Math.floor(Math.min(160 / art.w, 160 / art.h)));
      const ox = Math.floor((160 - art.w * k) / 2);
      const oy = Math.floor((160 - art.h * k) / 2);
      hitPreview.append(el('span', { class: 'jogo-hitbox', style: { left: `${ox + hb.x * k}px`, top: `${oy + hb.y * k}px`, width: `${hb.w * k}px`, height: `${hb.h * k}px` } }));
    }
    return el(
      'div',
      { class: 'jogo-duas' },
      side,
      el(
        'section',
        { class: 'jogo-painel' },
        el(
          'div',
          { class: 'jogo-grade' },
          el(
            'div',
            { class: 'jogo-form' },
            el('h3', {}, 'Ator'),
            field('Nome', textInput(a.name, (v) => this.edit(() => (a.name = v.trim() || a.name)))),
            field('Sprite', select(this.spriteOptions(), a.sprite, (v) => this.edit(() => {
              a.sprite = v;
              a.anims = {};
            }))),
            field('Comportamento', select(Object.entries(BEHAVIORS).map(([k, b]) => [k, b.label]), a.behavior, (v) => this.edit(() => {
              a.behavior = v;
              a.props = { ...BEHAVIORS[v].props };
            })), this.behaviorHelp(a.behavior)),
            el(
              'div',
              { class: 'jogo-linha' },
              field('Pai (herda eventos e colisões)', select([['', '(nenhum)'], ...g.actors.filter((x) => x.id !== a.id).map((x) => [x.id, x.name])], a.parent || '', (v) => this.edit(() => (a.parent = v), false))),
              field('Profundidade (menor fica na frente)', numberInput(a.depth || 0, (v) => this.edit(() => (a.depth = Math.round(v)), false), { min: -1000, max: 1000 })),
            ),
            el('h3', {}, 'Propriedades'),
            propFields.length ? propFields : el('p', { class: 'jogo-dica' }, 'Sem propriedades: só aparece na cena.'),
          ),
          el(
            'div',
            { class: 'jogo-form' },
            el('h3', {}, 'Prévia e área de colisão'),
            hitPreview,
            hitbox,
            el('h3', {}, 'Animações (tags do sprite)'),
            tags.length ? animFields : el('p', { class: 'jogo-dica' }, 'O sprite não tem tags: o ator toca todos os quadros. Crie tags no Crivo (Quadro → Tags) para ter animações parado, andando e pulando.'),
            def.sounds.length ? el('h3', {}, 'Sons') : null,
            soundFields,
            el('div', { class: 'jogo-botoes' }, button('Colocar na cena', () => {
              this.brushActor = a.id;
              this.tool = 'actor';
              this.switchTab('scene');
            }, { iconName: 'plus', primary: true })),
          ),
        ),
        el('h3', { class: 'jogo-titulo-eventos' }, `Eventos de "${a.name}"`),
        this.eventsEditor(a),
      ),
    );
  }

  actionEditor(list, kind) {
    const g = this.game;
    return el(
      'div',
      { class: 'jogo-entao' },
      el('span', { class: 'jogo-rotulo' }, 'Então'),
      list.length
        ? list.map((a, i) =>
            el(
              'div',
              { class: 'jogo-acao' },
              select(Object.entries(ACTIONS).map(([k, x]) => [k, x.label]), a.type, (v) => this.edit(() => (list[i] = { type: v }))),
              ACTIONS[a.type].fields.map((f) => this.ruleField(f, a, kind)),
              a.type === 'velocity' ? checkbox(a.relative, (x) => this.edit(() => (a.relative = x), false), 'X na direção do ator') : null,
              button('', () => this.edit(() => list.splice(i, 1)), { iconName: 'trash', danger: true, title: 'Tirar esta ação' }),
            ),
          )
        : el('p', { class: 'jogo-dica' }, 'Nenhuma ação ainda.'),
      button('Ação', () => this.edit(() => list.push(kind === 'event' ? { type: 'motion', target: 'self', direction: 0, speed: 40 } : { type: 'add', name: g.vars[0]?.name || '', value: 1 })), { iconName: 'plus' }),
    );
  }

  eventsEditor(a) {
    const events = a.events || (a.events = []);
    const cards = events.map((ev, index) => {
      const def = EVENTS[ev.type];
      const cond = ev.if || {};
      return el(
        'article',
        { class: 'jogo-regra jogo-evento' },
        el(
          'header',
          {},
          el('strong', { class: 'mono' }, `#${index + 1}`),
          select(Object.entries(EVENTS).map(([k, x]) => [k, x.label]), ev.type, (v) => this.edit(() => (events[index] = { id: ev.id, type: v, then: ev.then, if: ev.if }))),
          def.fields.map((f) => this.ruleField(f, ev, 'event')),
          el('span', { class: 'jogo-espaco' }),
          button('', () => this.edit(() => events.splice(index, 1)), { iconName: 'trash', danger: true, title: 'Excluir evento' }),
        ),
        el(
          'div',
          { class: 'jogo-condicao' },
          field('Condição', select(Object.entries(CONDITIONS).map(([k, x]) => [k, x.label]), cond.kind || '', (v) => this.edit(() => (v ? (ev.if = { kind: v, op: '>=', value: v === 'chance' ? 50 : 0 }) : delete ev.if)))),
          cond.kind ? CONDITIONS[cond.kind].fields.map((f) => this.ruleField(f, ev.if, 'event')) : null,
        ),
        this.actionEditor(ev.then, 'event'),
      );
    });
    return el(
      'div',
      { class: 'jogo-eventos' },
      el('p', { class: 'jogo-dica' }, 'Como num objeto: cada evento do ator roda as ações nele mesmo ("este ator") e, na colisão, no outro. Os filhos herdam os eventos do pai e podem trocar um evento igual. Use o comportamento "Objeto livre" para controlar tudo só por eventos.'),
      cards,
      button('Evento', () => this.edit(() => events.push({ id: newId('evento'), type: 'create', then: [] })), { iconName: 'plus', primary: true }),
    );
  }

  behaviorHelp(b) {
    return {
      platformer: 'Setas andam, Z ou Espaço pula (segure para pular mais alto), Baixo + pulo desce de plataformas. Pisa nos inimigos.',
      topdown: 'Anda nas quatro direções e na diagonal, sem gravidade. Bom para RPG e labirinto.',
      patrol: 'Anda para um lado e vira ao bater numa parede (e na beirada, se marcado). Encostar dá dano no jogador.',
      chase: 'Vai atrás do jogador quando ele chega perto (alcance).',
      flyer: 'Voa de um lado para o outro ondulando, sem gravidade.',
      item: 'Some quando o jogador encosta e soma pontos na variável de pontos.',
      hazard: 'Dá dano no jogador ao encostar (espinhos, lava, fogo).',
      goal: 'Leva para outra cena ao ser tocado. Na última cena, o jogador vence.',
      projectile: 'Anda em linha reta e some ao bater ou acabar o tempo. Use como tiro do jogador.',
      block: 'Ninguém atravessa. Pode quebrar com tiros ou sumir com uma regra.',
      decor: 'Só enfeite, sem colisão.',
      custom: 'Sem lógica pronta: anda com a velocidade que os eventos derem (Mover numa direção, Ir em direção ao jogador, alarmes), com atrito, gravidade e colisão opcionais.',
    }[b];
  }

  addActor() {
    const g = this.game;
    this.edit(() => {
      const a = newActor(`Ator ${g.actors.length + 1}`, g.sprites[0]?.id || '', g.actors.some((x) => x.behavior === 'platformer' || x.behavior === 'topdown') ? 'item' : 'platformer');
      g.actors.push(a);
      this.actorId = a.id;
    });
  }

  duplicateActor() {
    const a = this.actor;
    this.edit(() => {
      const copy = JSON.parse(JSON.stringify(a));
      copy.id = newId('ator');
      copy.name = `${a.name} (cópia)`;
      this.game.actors.splice(this.game.actors.indexOf(a) + 1, 0, copy);
      this.actorId = copy.id;
    });
  }

  async deleteActor() {
    const a = this.actor;
    const scenes = usedBy(this.game, 'actor', a.id);
    const text = scenes.length ? `"${a.name}" está em ${scenes.length} cena(s) (${scenes.join(', ')}) e sai de todas.` : `Excluir "${a.name}"?`;
    if (!(await confirm('Excluir ator', text, 'Excluir', true))) return;
    this.edit(() => removeEverywhere(this.game, 'actor', a.id));
    this.fixSelection();
    this.render();
  }

  spritesTab() {
    const g = this.game;
    const tabs = this.app.tabs;
    const cards = g.sprites.map((s) => {
      const art = this.spriteArt(s.id);
      const users = usedBy(g, 'sprite', s.id);
      const name = textInput(s.name, (v) => this.edit(() => (s.name = v.trim() || s.name)));
      return el(
        'article',
        { class: 'jogo-sprite' },
        this.preview(s.id, '', 96),
        name,
        el('small', { class: 'jogo-dica' }, art ? `${art.w}×${art.h} · ${art.baked.frames.length} quadro(s)${art.baked.tags.length ? ` · tags: ${art.baked.tags.join(', ')}` : ''}` : 'Sprite inválido'),
        users.length ? el('small', { class: 'jogo-dica' }, `Usado por: ${users.join(', ')}`) : null,
        el(
          'div',
          { class: 'jogo-botoes' },
          button('Editar no Crivo', () => this.editSprite(s), { iconName: 'pencil', title: 'Abre o sprite numa aba do editor. Volte ao estúdio (F9) e ele é atualizado.' }),
          this.links.has(s.id) ? el('small', { class: 'jogo-selo' }, 'aberto numa aba') : null,
          button('Excluir', () => this.deleteSprite(s), { iconName: 'trash', danger: true }),
        ),
      );
    });
    return el(
      'section',
      { class: 'jogo-painel jogo-sprites-tab' },
      el(
        'div',
        { class: 'jogo-botoes topo' },
        button('Usar o desenho atual', () => this.importDoc(this.app.editor.doc, true), { iconName: 'plus', primary: true, title: 'Copia o projeto da aba atual do editor como sprite' }),
        tabs && tabs.tabs.length > 1 ? button('Escolher de uma aba…', () => this.importFromTabs(), { iconName: 'frames' }) : null,
        button('Abrir arquivo (.crivo ou imagem)…', () => this.importFile(), { iconName: 'folder' }),
        button('Novo sprite em branco…', () => this.blankSprite(), { iconName: 'pencil' }),
      ),
      el('p', { class: 'jogo-dica' }, 'Sprites são desenhos do Crivo: personagens (com tags para cada animação), tiles (uma folha com vários tiles lado a lado) e paisagens. Desenhe no editor e traga para cá.'),
      cards.length ? el('div', { class: 'jogo-sprites' }, cards) : el('p', { class: 'jogo-vazio' }, 'Nenhum sprite ainda.'),
    );
  }

  importDoc(doc, link) {
    if (!doc) return;
    this.edit(() => {
      const s = { id: newId('sprite'), name: doc.name || 'Sprite', data: serialize(doc) };
      this.game.sprites.push(s);
      if (link) this.links.set(s.id, doc);
    });
    notify(`"${doc.name}" virou um sprite do jogo.`, 'success');
  }

  async importFromTabs() {
    const tabs = this.app.tabs;
    const docs = tabs.tabs.map((t, i) => (i === tabs.active ? this.app.editor.doc : t.session?.doc)).filter(Boolean);
    const choice = select(docs.map((d, i) => [String(i), `${d.name} (${d.width}×${d.height})`]), '0', () => {});
    const r = await openDialog({
      title: 'Escolher de uma aba',
      body: field('Projeto aberto', choice),
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Usar como sprite', primary: true, send: true, action: () => choice.value },
      ],
    });
    if (r === null || r === undefined) return;
    this.importDoc(docs[Number(r)], true);
  }

  async importFile() {
    const file = await pickFile('.crivo,application/json,image/png,image/gif,image/jpeg,image/webp');
    if (!file) return;
    let doc;
    if (/\.crivo$|json/i.test(file.name) || file.type.includes('json')) {
      doc = deserialize(JSON.parse(await readText(file)));
    } else {
      const { width, height, pixels } = await fileToPixels(file, 1024);
      doc = new PixelDocument(width, height, { name: file.name.replace(/\.[^.]+$/, '') });
      doc.cell(doc.frames[0].id, doc.layers[0].id).set(pixels);
    }
    this.importDoc(doc, false);
  }

  async blankSprite() {
    const base = this.game.gridSize || 16;
    const w = el('input', { type: 'number', value: base, min: 1, max: 1024 });
    const h = el('input', { type: 'number', value: base, min: 1, max: 1024 });
    const preset = select(SIZE_PRESETS.map((n) => [String(n), `${n}×${n} px`]), String(base), (v) => {
      w.value = v;
      h.value = v;
    });
    const n = el('input', { type: 'text', value: `Sprite ${this.game.sprites.length + 1}`, maxlength: 80 });
    const r = await openDialog({
      title: 'Novo sprite',
      body: el('div', { class: 'jogo-form' }, field('Nome', n), field('Tamanho', preset), el('div', { class: 'jogo-linha' }, field('Largura', w), field('Altura', h))),
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Criar e desenhar', primary: true, send: true, action: () => ({ w: Math.max(1, Math.min(1024, Number(w.value) || 16)), h: Math.max(1, Math.min(1024, Number(h.value) || 16)), name: n.value.trim() || 'Sprite' }) },
      ],
    });
    if (!r) return;
    const doc = new PixelDocument(r.w, r.h, { name: r.name });
    this.edit(() => this.game.sprites.push({ id: newId('sprite'), name: r.name, data: serialize(doc) }), false);
    this.editSprite(this.game.sprites[this.game.sprites.length - 1]);
  }

  editSprite(s) {
    const doc = deserialize(s.data);
    if (this.app.tabs) this.app.tabs.open(doc);
    else this.app.editor.load(doc, { id: null, local: null, revision: null });
    this.links.set(s.id, doc);
    this.close();
    notify(`Desenhe "${s.name}" e volte ao Estúdio de jogo (Jogo → Abrir o estúdio, F9): o sprite é atualizado sozinho.`, 'info', 6500);
  }

  async deleteSprite(s) {
    const users = usedBy(this.game, 'sprite', s.id);
    const text = users.length ? `"${s.name}" é usado por ${users.join(', ')}. Eles ficam sem sprite.` : `Excluir "${s.name}"?`;
    if (!(await confirm('Excluir sprite', text, 'Excluir', true))) return;
    this.edit(() => removeEverywhere(this.game, 'sprite', s.id));
    this.links.delete(s.id);
  }

  tilesTab() {
    const g = this.game;
    const t = g.tilesets.find((x) => x.id === this.tilesetId) || null;
    const side = el(
      'aside',
      { class: 'jogo-lado' },
      el('h3', {}, 'Tilesets'),
      this.list(g.tilesets, t?.id, (id) => {
        this.tilesetId = id;
        this.render();
      }, (x) => [el('span', {}, x.name), el('small', { class: 'jogo-selo' }, `${x.tileWidth}×${x.tileHeight}`)]),
      el(
        'div',
        { class: 'jogo-botoes' },
        button('Novo tileset', () => this.edit(() => {
          const n = { id: newId('tiles'), name: `Tiles ${g.tilesets.length + 1}`, sprite: g.sprites[0]?.id || '', tileWidth: g.gridSize || 8, tileHeight: g.gridSize || 8, flags: {} };
          g.tilesets.push(n);
          this.tilesetId = n.id;
        }), { iconName: 'plus' }),
        t ? button('Excluir', async () => {
          if (!(await confirm('Excluir tileset', `Excluir "${t.name}"? As cenas que usam ele ficam sem tiles.`, 'Excluir', true))) return;
          this.edit(() => removeEverywhere(g, 'tileset', t.id));
          this.fixSelection();
          this.render();
        }, { iconName: 'trash', danger: true }) : null,
      ),
    );
    if (!t) return el('div', { class: 'jogo-duas' }, side, el('section', { class: 'jogo-painel' }, el('p', { class: 'jogo-vazio' }, 'Um tileset recorta um sprite em quadradinhos (tiles) para montar o chão, as paredes e as plataformas das cenas. Desenhe uma folha com os tiles lado a lado no Crivo, traga em Sprites e crie o tileset aqui.')));
    const ts = this.tilesetArt(t.id);
    this.flagBrush = this.flagBrush ?? 'solid';
    const brush = el(
      'div',
      { class: 'jogo-botoes' },
      TILE_FLAGS.map(([v, label]) =>
        el(
          'button',
          {
            type: 'button',
            class: `button small${this.flagBrush === v ? ' ativo' : ''}`,
            'aria-pressed': String(this.flagBrush === v),
            onclick: () => {
              this.flagBrush = v;
              this.render();
            },
          },
          v ? el('span', { class: `jogo-flag flag-${v}` }, FLAG_SHORT[v]) : null,
          label,
        ),
      ),
    );
    const tiles = ts?.sheet
      ? el(
          'div',
          { class: 'jogo-tiles grandes', style: { '--colunas': String(Math.min(ts.columns, 12)) } },
          Array.from({ length: ts.count }, (_, i) => {
            const c = el('canvas', { width: ts.tw, height: ts.th });
            c.getContext('2d').drawImage(ts.sheet, (i % ts.columns) * ts.tw, Math.floor(i / ts.columns) * ts.th, ts.tw, ts.th, 0, 0, ts.tw, ts.th);
            const flag = t.flags[i + 1];
            return el(
              'button',
              {
                type: 'button',
                class: 'jogo-tile',
                title: `Tile ${i + 1}: ${TILE_FLAGS.find((f) => f[0] === (flag || ''))[1]}`,
                onclick: () => this.edit(() => (this.flagBrush ? (t.flags[i + 1] = this.flagBrush) : delete t.flags[i + 1])),
                oncontextmenu: (e) => {
                  e.preventDefault();
                  this.edit(() => delete t.flags[i + 1]);
                },
              },
              c,
              el('span', { class: 'jogo-num mono' }, String(i + 1)),
              flag ? el('span', { class: `jogo-flag flag-${flag}` }, FLAG_SHORT[flag]) : null,
            );
          }),
        )
      : el('p', { class: 'jogo-vazio' }, 'Escolha o sprite com a folha de tiles.');
    return el(
      'div',
      { class: 'jogo-duas' },
      side,
      el(
        'section',
        { class: 'jogo-painel' },
        el(
          'div',
          { class: 'jogo-form estreito' },
          field('Nome', textInput(t.name, (v) => this.edit(() => (t.name = v.trim() || t.name)))),
          field('Sprite com os tiles', select(this.spriteOptions(), t.sprite, (v) => this.edit(() => (t.sprite = v)))),
          el(
            'div',
            { class: 'jogo-linha' },
            field('Tamanho', select([['', 'Personalizado'], ...SIZE_PRESETS.map((n) => [String(n), `${n}×${n} px`])], t.tileWidth === t.tileHeight && SIZE_PRESETS.includes(t.tileWidth) ? String(t.tileWidth) : '', (v) => v && this.edit(() => (t.tileWidth = t.tileHeight = Number(v))))),
            field('Largura do tile', numberInput(t.tileWidth, (v) => this.edit(() => (t.tileWidth = v)), { min: 2, max: 1024 })),
            field('Altura do tile', numberInput(t.tileHeight, (v) => this.edit(() => (t.tileHeight = v)), { min: 2, max: 1024 })),
          ),
        ),
        el('h3', {}, 'Colisão de cada tile'),
        el('p', { class: 'jogo-dica' }, 'Escolha o tipo e clique nos tiles. Botão direito volta para vazio.'),
        brush,
        tiles,
      ),
    );
  }

  ruleField(name, obj, kind) {
    const set = (v) => this.edit(() => (obj[name] = v), false);
    const g = this.game;
    const label = {
      a: 'Ator A',
      b: 'Ator B',
      actor: 'Ator',
      key: 'Botão',
      seconds: 'Segundos',
      value: 'Valor',
      name: 'Variável',
      op: 'Comparação',
      target: 'Em quem',
      at: 'Onde',
      sound: 'Som',
      scene: 'Cena',
      text: 'Texto',
      dx: 'Deslocamento X',
      dy: 'Deslocamento Y',
      vx: 'Velocidade X',
      vy: 'Velocidade Y',
      x: 'X',
      y: 'Y',
      alarm: 'Alarme',
      local: 'Variável do ator',
      direction: 'Direção (graus: 0 direita, 90 cima)',
      speed: 'Velocidade (px/s)',
      anim: 'Animação (tag)',
      toggle: 'Gravidade',
      other: 'Com o ator',
      code: 'Código',
      color: 'Cor',
      count: 'Quantidade',
    }[name];
    let control;
    if (name === 'a') control = select(this.actorOptions(), obj[name], set);
    else if (name === 'b' || name === 'actor') control = select(this.actorOptions(kind === 'action' ? null : '(qualquer um)'), obj[name], set);
    else if (name === 'key') control = select(Object.entries(KEY_LABELS), obj[name] || 'action', set);
    else if (name === 'op') control = select(OPERATORS.map((o) => [o, o]), obj[name] || '>=', set);
    else if (name === 'target' || name === 'at') control = select(Object.entries(TARGET_LABELS), obj[name] || (kind === 'event' ? 'self' : 'a'), set);
    else if (name === 'sound') control = select(this.soundOptions(), obj[name], set);
    else if (name === 'scene') control = select(this.sceneOptions(), obj[name], set);
    else if (name === 'name') control = select(this.varOptions(), obj[name], set);
    else if (name === 'lang') return null;
    else if (name === 'code') control = this.codeArea(obj.code || '', (v) => this.edit(() => (obj.code = v), false), 7, obj.lang || 'crivo', (l) => this.edit(() => (obj.lang = l), false));
    else if (name === 'color') control = this.colorInput(obj[name] || '#f6e4a6', set);
    else if (name === 'text') control = textInput(obj[name], set, obj.type === 'music' ? 400 : 120);
    else if (name === 'alarm') control = select([0, 1, 2, 3].map((n) => [String(n), `Alarme ${n}`]), String(obj[name] ?? 0), (v) => set(Number(v)));
    else if (name === 'local') control = textInput(obj[name], (v) => set(v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 24)), 24);
    else if (name === 'toggle') control = select([['on', 'Ligar'], ['off', 'Desligar']], obj[name] || 'on', set);
    else if (name === 'other') control = select(this.actorOptions('(qualquer um)'), obj[name], set);
    else if (name === 'anim') {
      const art = this.spriteArt(this.actor?.sprite);
      const tags = art ? art.baked.tags : [];
      control = tags.length ? select([['', '(a do estado)'], ...tags.map((t) => [t, t])], obj[name], set) : textInput(obj[name], set, 40);
    }
    else control = numberInput(obj[name] ?? 0, set, { step: name === 'seconds' ? 0.1 : 1 });
    if (name === 'name' && !g.vars.length) control = el('span', { class: 'jogo-dica' }, 'Crie uma variável acima.');
    const out = field(label, control);
    if (name === 'text' || name === 'code') out.classList.add('largo');
    if (name === 'code') out.classList.add('codigo');
    return out;
  }

  rulesTab() {
    const g = this.game;
    const vars = el(
      'table',
      { class: 'jogo-tabela' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Variável'), el('th', {}, 'Começa com'), el('th', {}, 'Rótulo na tela'), el('th', {}, 'Mostrar'), el('th', {}))),
      el(
        'tbody',
        {},
        g.vars.map((v) =>
          el(
            'tr',
            {},
            el('td', { class: 'mono' }, v.name),
            el('td', {}, numberInput(v.value, (x) => this.edit(() => (v.value = x), false))),
            el('td', {}, textInput(v.label, (x) => this.edit(() => (v.label = x.slice(0, 24)), false), 24)),
            el('td', {}, checkbox(v.hud, (x) => this.edit(() => (v.hud = x), false), 'no placar')),
            el('td', {}, button('', () => this.edit(() => (g.vars = g.vars.filter((x) => x !== v))), { iconName: 'trash', danger: true, title: 'Excluir variável' })),
          ),
        ),
      ),
    );
    const rules = g.rules.map((r, index) => {
      const trig = TRIGGERS[r.when.type];
      const actions = r.then.map((a, i) =>
        el(
          'div',
          { class: 'jogo-acao' },
          select(Object.entries(ACTIONS).map(([k, x]) => [k, x.label]), a.type, (v) => this.edit(() => (r.then[i] = { type: v }))),
          ACTIONS[a.type].fields.map((f) => this.ruleField(f, a, 'action')),
          a.type === 'velocity' ? checkbox(a.relative, (x) => this.edit(() => (a.relative = x), false), 'X na direção do ator') : null,
          button('', () => this.edit(() => r.then.splice(i, 1)), { iconName: 'trash', danger: true, title: 'Tirar esta ação' }),
        ),
      );
      return el(
        'article',
        { class: 'jogo-regra' },
        el(
          'header',
          {},
          el('strong', { class: 'mono' }, `#${index + 1}`),
          select(Object.entries(TRIGGERS).map(([k, x]) => [k, x.label]), r.when.type, (v) => this.edit(() => (r.when = { type: v }))),
          el('span', {}, 'em'),
          select(this.sceneOptions('todas as cenas'), r.scene, (v) => this.edit(() => (r.scene = v), false)),
          el('span', { class: 'jogo-espaco' }),
          button('', () => this.moveRule(index, -1), { iconName: 'up', title: 'Subir' }),
          button('', () => this.moveRule(index, 1), { iconName: 'down', title: 'Descer' }),
          button('', () => this.edit(() => g.rules.splice(index, 1)), { iconName: 'trash', danger: true, title: 'Excluir regra' }),
        ),
        trig.fields.length ? el('div', { class: 'jogo-condicao' }, trig.fields.map((f) => this.ruleField(f, r.when, 'trigger'))) : null,
        el('div', { class: 'jogo-entao' }, el('span', { class: 'jogo-rotulo' }, 'Então'), actions.length ? actions : el('p', { class: 'jogo-dica' }, 'Nenhuma ação ainda.'), button('Ação', () => this.edit(() => r.then.push({ type: 'add', name: g.vars[0]?.name || '', value: 1 })), { iconName: 'plus' })),
      );
    });
    return el(
      'section',
      { class: 'jogo-painel jogo-regras' },
      el('h3', {}, 'Variáveis'),
      el('p', { class: 'jogo-dica' }, 'Números que o jogo guarda entre as cenas, como pontos, vidas e chaves. Marque "no placar" para mostrar no canto da tela. Use {nome} nas mensagens para mostrar o valor.'),
      vars,
      el('div', { class: 'jogo-botoes' }, button('Variável', () => this.addVar(), { iconName: 'plus' })),
      el('h3', {}, 'Regras'),
      el('p', { class: 'jogo-dica' }, 'Cada regra diz: quando algo acontecer, faça estas ações. O básico já vem pronto: o jogador pega itens, perde vida com inimigos e perigos, pisa nos inimigos e passa de fase na saída. Use regras para o resto.'),
      rules.length ? rules : el('p', { class: 'jogo-vazio' }, 'Nenhuma regra ainda.'),
      el('div', { class: 'jogo-botoes' }, button('Nova regra', () => this.edit(() => g.rules.push({ id: newId('regra'), scene: '', when: { type: 'touch', a: g.actors[0]?.id || '', b: '' }, then: [], note: '' })), { iconName: 'plus', primary: true })),
    );
  }

  moveRule(i, d) {
    const list = this.game.rules;
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    this.edit(() => ([list[i], list[j]] = [list[j], list[i]]));
  }

  async addVar() {
    const name = await promptText('Nova variável', 'Nome (letras e números, sem espaço)', 'chaves');
    if (!name) return;
    const clean = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
    if (!clean) return notify('Use letras e números no nome.', 'warning');
    if (this.game.vars.some((v) => v.name === clean)) return notify('Já existe uma variável com esse nome.', 'warning');
    this.edit(() => this.game.vars.push({ name: clean, value: 0, hud: false, label: name.slice(0, 24) }));
  }

  soundsTab() {
    const g = this.game;
    const s = g.sounds.find((x) => x.id === this.soundId) || null;
    const side = el(
      'aside',
      { class: 'jogo-lado' },
      el('h3', {}, 'Sons'),
      this.list(g.sounds, s?.id, (id) => {
        this.soundId = id;
        this.render();
      }, (x) => [el('span', {}, x.name), el('small', { class: 'jogo-selo' }, WAVES.find((w) => w[0] === x.wave)?.[1] || '')]),
      el(
        'div',
        { class: 'jogo-botoes' },
        button('Novo som', () => this.edit(() => {
          const n = newSound('blip');
          n.name = `Som ${g.sounds.length + 1}`;
          g.sounds.push(n);
          this.soundId = n.id;
        }), { iconName: 'plus' }),
        s ? button('Excluir', () => this.edit(() => removeEverywhere(g, 'sound', s.id)), { iconName: 'trash', danger: true }) : null,
      ),
    );
    if (!s) return el('div', { class: 'jogo-duas' }, side, el('section', { class: 'jogo-painel' }, el('p', { class: 'jogo-vazio' }, 'Sons de 8 bits gerados na hora, sem arquivos: pulo, moeda, dano, explosão. Crie um e ajuste.')));
    const play = () => this.playSamples(audio.synthesize(s));
    const set = (k) => (v) => {
      this.edit(() => (s[k] = v));
      play();
    };
    const wave = el('canvas', { class: 'jogo-onda', width: 480, height: 90 });
    const data = audio.synthesize(s);
    const ctx = wave.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#5d1c16';
    const step = data.length / wave.width;
    for (let x = 0; x < wave.width; x++) {
      let peak = 0;
      for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i++) peak = Math.max(peak, Math.abs(data[i] || 0));
      const h = Math.max(1, peak * 2 * wave.height * 0.9);
      ctx.fillRect(x, (wave.height - h) / 2, 1, h);
    }
    return el(
      'div',
      { class: 'jogo-duas' },
      side,
      el(
        'section',
        { class: 'jogo-painel' },
        el(
          'div',
          { class: 'jogo-form estreito' },
          field('Nome', textInput(s.name, (v) => this.edit(() => (s.name = v.trim() || s.name)))),
          el('div', { class: 'jogo-botoes' }, Object.entries(SOUND_PRESETS).map(([k, p]) => button(p.name, () => {
            this.edit(() => Object.assign(s, { ...p, name: s.name }));
            play();
          }))),
          wave,
          el('div', { class: 'jogo-botoes' }, button('Tocar', play, { iconName: 'play', primary: true }), button('Aleatório', () => {
            const r = Math.random;
            const kinds = ['square', 'square', 'triangle', 'sawtooth', 'noise'];
            this.edit(() => Object.assign(s, { wave: kinds[Math.floor(r() * kinds.length)], freq: Math.round(120 + r() * 1200), freqEnd: Math.round(60 + r() * 1400), duration: Math.round((0.06 + r() * 0.5) * 100) / 100, duty: [0.125, 0.25, 0.5][Math.floor(r() * 3)], vibrato: r() < 0.3 ? Math.round(r() * 10) / 10 : 0, arp: r() < 0.3 ? [3, 4, 5, 7, 12][Math.floor(r() * 5)] : 0 }));
            play();
          })),
          field('Onda', select(WAVES, s.wave, set('wave'))),
          el('div', { class: 'jogo-linha' }, field('Frequência inicial (Hz)', numberInput(s.freq, set('freq'), { min: 20, max: 8000 })), field('Frequência final (Hz)', numberInput(s.freqEnd, set('freqEnd'), { min: 20, max: 8000 }))),
          el('div', { class: 'jogo-linha' }, field('Duração (s)', numberInput(s.duration, set('duration'), { min: 0.01, max: 4, step: 0.01 })), field('Volume (0 a 1)', numberInput(s.volume, set('volume'), { min: 0, max: 1, step: 0.05 }))),
          el('div', { class: 'jogo-linha' }, field('Ciclo da onda quadrada', numberInput(s.duty, set('duty'), { min: 0.05, max: 0.95, step: 0.05 })), field('Vibrato (0 a 1)', numberInput(s.vibrato, set('vibrato'), { min: 0, max: 1, step: 0.1 }))),
          field('Salto de tom no meio (semitons)', numberInput(s.arp, set('arp'), { min: -24, max: 24 }), 'O som da moeda usa 5: sobe uma quarta no meio.'),
        ),
      ),
    );
  }

  settingsTab() {
    const g = this.game;
    const problems = checkGame(g);
    const set = (k) => (v) => this.edit(() => (g[k] = v), false);
    return el(
      'section',
      { class: 'jogo-painel' },
      el(
        'div',
        { class: 'jogo-grade' },
        el(
          'div',
          { class: 'jogo-form' },
          el('h3', {}, 'Tela'),
          field('Nome do jogo', textInput(g.name, (v) => this.edit(() => (g.name = v.trim() || g.name)))),
          el(
            'div',
            { class: 'jogo-linha' },
            field('Tamanho base (pixels por tile)', select(SIZE_PRESETS.map((n) => [String(n), `${n} bits · ${n}×${n} px`]), String(g.gridSize || 8), (v) => this.applyGrid(Number(v))), 'Ajusta a resolução, a gravidade, as velocidades e os tiles novos para a escala escolhida.'),
          ),
          el('div', { class: 'jogo-linha' }, field('Largura (px)', numberInput(g.width, set('width'), { min: 32, max: 3840 })), field('Altura (px)', numberInput(g.height, set('height'), { min: 32, max: 2160 }))),
          field('Cor de fundo', this.colorInput(g.background, set('background'))),
          el('p', { class: 'jogo-dica' }, 'A tela do jogo é ampliada pelo maior número inteiro que cabe na janela, sem borrar os pixels. 160×120 lembra um portátil; 256×144 é 16:9.'),
          el('h3', {}, 'Física'),
          el('div', { class: 'jogo-linha' }, field('Gravidade (px/s²)', numberInput(g.gravity, set('gravity'), { min: 0, max: 200000 })), field('Queda máxima (px/s)', numberInput(g.maxFall, set('maxFall'), { min: 10, max: 200000 }))),
          el('h3', {}, 'Regras do jogo'),
          field('Começa na cena', select(this.sceneOptions(), g.start, set('start'))),
          el('div', { class: 'jogo-linha' }, field('Variável de pontos', select(this.varOptions('(nenhuma)'), g.scoreVar, set('scoreVar'))), field('Variável de vidas', select(this.varOptions('(nenhuma)'), g.livesVar, set('livesVar')))),
          field('Mensagem de vitória', textInput(g.winText, set('winText'), 120), 'Use {pontos} para mostrar o valor de uma variável.'),
          field('Mensagem de fim de jogo', textInput(g.loseText, set('loseText'), 120)),
          el('div', { class: 'jogo-linha' }, field('Som da vitória', select(this.soundOptions(), g.winSound, set('winSound'))), field('Som do fim de jogo', select(this.soundOptions(), g.loseSound, set('loseSound')))),
        ),
        el(
          'div',
          { class: 'jogo-form' },
          el('h3', {}, 'Conferência'),
          problems.length ? el('ul', { class: 'jogo-problemas' }, problems.map((p) => el('li', {}, p))) : el('p', { class: 'jogo-ok' }, 'Tudo certo para jogar.'),
          el('h3', {}, 'Controles do jogo'),
          el(
            'table',
            { class: 'jogo-tabela' },
            el(
              'tbody',
              {},
              [
                ['Setas ou WASD', 'Andar (no jogo de plataforma, Cima também pula)'],
                ['Z, Espaço ou K', 'Pular'],
                ['X, J ou C', 'Ação (atirar)'],
                ['Enter', 'Começar e pausar'],
                ['R (na pausa)', 'Recomeçar'],
                ['M', 'Liga e desliga o som'],
                ['Controle (gamepad)', 'Direcional, A pula, B ou X age, Start pausa'],
                ['Celular', 'Botões na tela'],
              ].map(([k, v]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, v))),
            ),
          ),
          el('h3', {}, 'Tamanho'),
          el('p', { class: 'jogo-dica' }, `${g.scenes.length} cena(s), ${g.actors.length} ator(es), ${g.sprites.length} sprite(s), ${g.sounds.length} som(ns), ${g.rules.length} regra(s). Arquivo do jogo: ${Math.ceil(serializeGame(g).length / 1024)} KB.`),
        ),
      ),
    );
  }

  compiled() {
    return compileGame(this.game, this.cache);
  }

  test(sceneId = this.sceneId) {
    if (this.testing) return;
    const problems = checkGame(this.game).filter((p) => p.includes('jogador'));
    const data = this.compiled();
    if (!data.scenes.length) return;
    const host = el('div', { class: 'jogo-teste-palco' });
    const canvas = el('canvas', { class: 'jogo-teste-tela', 'aria-label': 'Jogo em teste' });
    host.append(canvas);
    const overlay = el(
      'div',
      { class: 'jogo-teste', role: 'region', 'aria-label': 'Teste do jogo' },
      el('div', { class: 'jogo-teste-topo' }, el('strong', {}, `Testando: ${this.scene.name}`), el('span', {}, 'Esc volta ao estúdio · Enter pausa · M liga/desliga o som'), button('Voltar ao estúdio', () => this.stopTest(), { primary: true })),
      host,
    );
    this.dialog.append(overlay);
    this.testing = { overlay, run: null };
    if (problems.length) notify(problems[0], 'warning', 5000);
    const terminal = new Terminal({
      title: 'Terminal do jogo',
      placeholder: 'Código no jogo rodando (self é o jogador): global.pontos = 99, instance_create("Moeda", x + 16, y)…',
      onCommand: (line, lang) => this.runIn(this.testing?.run?.game, terminal, line, this.testing?.run, lang),
    });
    terminal.root.classList.add('jogo-teste-terminal');
    terminal.root.hidden = true;
    const toggleTerminal = () => {
      terminal.root.hidden = !terminal.root.hidden;
      overlay.classList.toggle('com-terminal', !terminal.root.hidden);
      if (!terminal.root.hidden) terminal.focus();
      this.testing?.run?.fit();
    };
    overlay.append(terminal.root);
    overlay.querySelector('.jogo-teste-topo').insertBefore(button('Terminal (F4)', toggleTerminal, { title: 'Mostra o terminal para rodar código no jogo' }), overlay.querySelector('.jogo-teste-topo .button'));
    overlay.querySelector('.jogo-teste-topo').insertBefore(button('Depuração (F3)', () => this.testing?.run?.toggleDebug(), { title: 'Mostra caixas de colisão, FPS e posições' }), overlay.querySelector('.jogo-teste-topo .button'));
    this.testing.terminal = terminal;
    this.testing.onKey = (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener('keydown', this.testing.onKey, true);
    const onLog = (entry) => {
      terminal.print(entry.text, entry.kind === 'error' ? 'error' : 'print');
      if (entry.kind === 'error' && terminal.root.hidden) toggleTerminal();
    };
    this.testing.run = player.play({ engine, audio, script, onLog, data, canvas, scene: sceneId, skipTitle: true, host, onExit: () => this.stopTest() });
    terminal.print('Terminal ligado ao jogo. Digite ajuda para ver as funções. self é o jogador.', 'info');
    canvas.focus?.();
  }

  stopTest() {
    if (!this.testing) return;
    window.removeEventListener('keydown', this.testing.onKey, true);
    this.testing.run?.stop();
    this.testing.overlay.remove();
    this.testing = null;
  }

  runIn(game, terminal, line, run = null, lang = 'crivo') {
    if (!game) return terminal.print('Nenhum jogo rodando.', 'error');
    const extra = {
      step: (a) => {
        const n = Math.max(1, Math.min(6000, Math.floor(Number(a[0]) || 1)));
        for (let i = 0; i < n; i++) game.step({}, engine.STEP);
        game.effects.length = 0;
        return n;
      },
      pause: () => (run ? (run.pause(true), 'pausado') : 'só no teste'),
      resume: () => (run ? (run.pause(false), 'rodando') : 'só no teste'),
      debug: () => (run ? (run.toggleDebug() ? 'depuração ligada' : 'depuração desligada') : 'só no teste'),
      reset: () => {
        if (run) {
          run.start();
          return 'recomeçou';
        }
        this.sandbox = null;
        return 'sandbox recriado';
      },
      vars: () => Object.entries(game.vars).map(([k, v]) => `${k}=${script.format(v)}`).join(' '),
      instances: () => game.world.entities.filter((e) => !e.dead).map((e) => e.describe()),
      inspect: (a) => {
        const e = a[0];
        if (!e || typeof e !== 'object' || !('uid' in e)) return script.format(e);
        return `${e.describe()} x=${Math.round(e.x - e.hx)} y=${Math.round(e.y - e.hy)} hspeed=${Math.round(e.vx)} vspeed=${Math.round(e.vy)} vida=${e.health} vars=${JSON.stringify(e.vars)}`;
      },
    };
    try {
      const scopes = (terminal.scopes ||= {});
      const out = game.exec(line, { extra, lang, scope: (scopes[lang] ||= new Map()) });
      if (out.shown && out.value !== undefined) terminal.print(script.format(out.value), 'out');
    } catch (error) {
      terminal.print(error.message, 'error');
    }
  }

  sandboxGame(terminal) {
    if (!this.sandbox) {
      const data = this.compiled();
      this.sandbox = engine.createGame(data, { seed: 1, script, onLog: (entry) => terminal.print(entry.text, entry.kind === 'error' ? 'error' : 'print') });
      this.sandbox.reset();
      this.sandbox.load(this.sceneId);
      this.sandbox.effects.length = 0;
      terminal.print(`Sandbox criado na cena "${this.scene.name}". O jogador é self. step(60) avança 1 segundo; reset() recomeça com o jogo atual.`, 'info');
    }
    return this.sandbox;
  }

  codeArea(value, onchange, rows = 14, lang = 'crivo', onLang = null) {
    return codeEditor({ value, lang, rows, check: (text, l) => script.check(text, l), onChange: (v) => onchange(v), onLang, compact: rows < 10 }).root;
  }

  codeTab() {
    const g = this.game;
    g.scripts ||= [];
    const current = g.scripts.find((x) => x.id === this.scriptId) || g.scripts[0] || null;
    this.scriptId = current?.id || '';
    const terminal = (this.codeTerminal ||= new Terminal({
      title: 'Terminal',
      placeholder: 'print(1 + 2), instance_number("Moeda"), step(60), x += 16, reset()…',
      onCommand: (line, lang) => this.runIn(this.sandboxGame(terminal), terminal, line, null, lang),
    }));
    if (!terminal.greeted) {
      terminal.greeted = true;
      terminal.print('Terminal do Crivo: rode código no jogo sem abrir o teste. Digite ajuda para ver a linguagem e as funções.', 'info');
    }
    const side = el(
      'aside',
      { class: 'jogo-lado' },
      el('h3', {}, 'Scripts'),
      this.list(g.scripts, current?.id, (id) => {
        this.scriptId = id;
        this.render();
      }, (x) => [el('span', { class: 'mono' }, x.name), el('small', { class: `jogo-selo lingua-${x.lang || 'crivo'}` }, CODE_LANGS.find(([k]) => k === (x.lang || 'crivo'))[1])]),
      el(
        'div',
        { class: 'jogo-botoes' },
        ...CODE_LANGS.map(([lang, label]) =>
          button(label, () => this.edit(() => {
            const n = { id: newId('script'), name: `script${g.scripts.length + 1}`, lang, code: CODE_TEMPLATES[lang] };
            g.scripts.push(n);
            this.scriptId = n.id;
            this.sandbox = null;
          }), { iconName: 'plus', title: `Novo script em ${label}` }),
        ),
        current ? button('Excluir', async () => {
          if (!(await confirm('Excluir script', `Excluir "${current.name}"?`, 'Excluir', true))) return;
          this.edit(() => (g.scripts = g.scripts.filter((x) => x !== current)));
          this.sandbox = null;
        }, { iconName: 'trash', danger: true }) : null,
      ),
      el('p', { class: 'jogo-dica' }, 'Scripts guardam funções (function nome() { }) que qualquer evento, regra ou o terminal podem chamar. O que estiver fora das funções roda quando o jogo começa, bom para criar variáveis globais.'),
      el('h3', {}, 'Onde mais dá para codar'),
      el('p', { class: 'jogo-dica' }, 'Na aba Atores, a ação "Executar código" roda dentro de qualquer evento (Criar, Passo, Alarme, Colisão, Teclas). Na aba Cenas, cada ator colocado pode ter o próprio código da instância. No teste (F5), o Terminal (F4) mexe no jogo rodando.'),
    );
    let editor = el('p', { class: 'jogo-vazio' }, 'Nenhum script ainda. Crie um com "Novo script".');
    if (current) {
      const name = textInput(current.name, (v) => this.edit(() => (current.name = v.trim().replace(/\s+/g, '_') || current.name)), 60);
      editor = el(
        'div',
        { class: 'jogo-editor' },
        el(
          'div',
          { class: 'jogo-botoes' },
          field('Nome do script', name),
          el('span', { class: 'jogo-espaco' }),
          button('Verificar tudo', () => this.checkAll(terminal), { iconName: 'eye', title: 'Confere a escrita de todos os scripts e códigos do jogo' }),
          button('Rodar no terminal', () => {
            this.sandbox = null;
            this.runIn(this.sandboxGame(terminal), terminal, current.code, null, current.lang || 'crivo');
          }, { iconName: 'play', primary: true, title: 'Recria o sandbox e roda este script nele' }),
        ),
        this.codeArea(current.code, (v) => {
          this.edit(() => (current.code = v), false);
          this.sandbox = null;
        }, 18, current.lang || 'crivo', (l) => {
          this.edit(() => (current.lang = l), false);
          this.sandbox = null;
          this.render();
        }),
      );
    }
    return el('div', { class: 'jogo-duas' }, side, el('section', { class: 'jogo-painel jogo-codigo-tab' }, editor, terminal.root));
  }

  checkAll(terminal) {
    const g = this.game;
    let count = 0;
    let bad = 0;
    const test = (where, code, lang = 'crivo') => {
      if (!code || !code.trim()) return;
      count++;
      const error = script.check(code, lang);
      if (error) {
        bad++;
        terminal.print(`${where}: ${error}`, 'error');
      }
    };
    for (const x of g.scripts || []) test(`Script ${x.name}`, x.code, x.lang);
    for (const a of g.actors) for (const ev of a.events || []) for (const act of ev.then) if (act.type === 'code') test(`${a.name} › ${ev.type}`, act.code, act.lang);
    for (const r of g.rules) for (const act of r.then) if (act.type === 'code') test('Regra', act.code, act.lang);
    for (const sc of g.scenes) for (const e of sc.entities) if (e.code) test(`${sc.name} › instância ${e.id}`, e.code, e.lang);
    terminal.print(bad ? `${bad} de ${count} códigos com erro.` : `${count} código(s) conferido(s), nenhum erro.`, bad ? 'error' : 'info');
  }

  inspector() {
    const e = this.selected;
    if (!e || !this.scene.entities.includes(e)) return null;
    const a = this.game.actors.find((x) => x.id === e.actor);
    return el(
      'div',
      { class: 'jogo-form jogo-inspetor' },
      el('h3', {}, `Instância: ${a?.name || 'ator'}`),
      el(
        'div',
        { class: 'jogo-linha' },
        field('X', numberInput(e.x, (v) => this.edit(() => (e.x = Math.round(v)), false), { min: -1e7, max: 1e7 })),
        field('Y', numberInput(e.y, (v) => this.edit(() => (e.y = Math.round(v)), false), { min: -1e7, max: 1e7 })),
      ),
      checkbox(e.flip, (v) => {
        this.edit(() => (e.flip = v), false);
        this.drawScene();
      }, 'Espelhada'),
      field('Código da instância (roda quando ela surge)', this.codeArea(e.code || '', (v) => this.edit(() => (v.trim() ? (e.code = v) : delete e.code), false), 5, e.lang || 'crivo', (l) => this.edit(() => (e.lang = l), false))),
      button('Tirar da cena', () => this.edit(() => {
        this.scene.entities = this.scene.entities.filter((x) => x !== e);
        this.selected = null;
      }), { iconName: 'trash', danger: true }),
    );
  }

  applyGrid(size) {
    const g = this.game;
    const old = g.gridSize || 8;
    if (size === old) return;
    const k = size / old;
    confirm('Tamanho base', `Mudar de ${old} para ${size} px por tile? A resolução vai para ${RESOLUTION_FOR[size].join('×')}, e a gravidade, a queda máxima, as velocidades, os pulos e os alcances dos atores são multiplicados por ${k >= 1 ? k : `1/${1 / k}`}. Os tilesets e os sprites novos já nascem com ${size}×${size} px.`, 'Mudar').then((ok) => {
      if (!ok) return this.render();
      this.edit(() => {
        g.gridSize = size;
        [g.width, g.height] = RESOLUTION_FOR[size];
        g.gravity = Math.round(g.gravity * k);
        g.maxFall = Math.round(g.maxFall * k);
        for (const a of g.actors) for (const key of ['speed', 'jump', 'range', 'wave']) if (typeof a.props[key] === 'number') a.props[key] = Math.round(a.props[key] * k);
      });
      notify(`Escala de ${size} px aplicada.`, 'success');
    });
  }

  newGame() {
    confirm('Novo jogo', 'Começar um jogo em branco? O jogo atual sai do rascunho (salve o arquivo antes, se quiser guardar).', 'Começar', true).then((ok) => {
      if (ok) this.replace(normalizeGame(newGame()), 'Jogo em branco criado.');
    });
  }

  loadSample() {
    confirm('Jogo de exemplo', 'Abrir o jogo de exemplo (Gotinha e as moedas)? O jogo atual sai do rascunho (salve o arquivo antes, se quiser guardar).', 'Abrir', true).then((ok) => {
      if (ok) this.replace(normalizeGame(sampleGame()), 'Jogo de exemplo aberto. Aperte F5 para jogar.');
    });
  }

  async openFile() {
    const file = await pickFile(`.${GAME_EXTENSION},application/json`);
    if (!file) return;
    const game = parseGame(await readText(file));
    this.replace(game, `"${game.name}" aberto.`);
  }

  saveFile() {
    this.load();
    return downloadText(serializeGame(this.game), fileNameFor(this.game.name, GAME_EXTENSION), 'application/json', { title: 'Salvar jogo' });
  }

  exportJson() {
    this.load();
    return downloadText(JSON.stringify(this.compiled()), fileNameFor(`${this.game.name}-dados`, 'json'), 'application/json', { title: 'Exportar dados do jogo' });
  }

  async exportHtml() {
    this.load();
    const problems = checkGame(this.game);
    if (problems.some((p) => p.includes('jogador'))) notify(problems[0], 'warning', 5000);
    const html = await gameHtml(this.compiled(), gamePlayer);
    const r = await downloadText(html, fileNameFor(this.game.name, 'html'), 'text/html', { title: 'Exportar jogo' });
    if (r === 'downloaded') notify('Jogo exportado: abra o .html em qualquer navegador para jogar.', 'success', 5000);
  }
}
