import { el, readPreference, writePreference } from './util.js';
import { icon, bitmapPath } from './icons.js';
import { pixelsToCanvas, createCanvas } from './image.js';
import { deserialize } from '../core/format.js';
import { bayerThreshold } from '../core/dither.js';
import { paginate, clampFlips, leafPose, spread, spreadLabel, frameDelays, framesToRender, isBlank, pageNumber, pageCount } from '../core/sketchbook.js';

const SHELF = 0.84;
const OPEN_TIME = 1000;
const CLOSE_TIME = 1000;
const SAVED_LIMIT = 36;
const PAPER = ['#f6e4a6', '#d6bdb8', '#a3b4be', '#e6ddce', '#7a6e46', '#5c4034', '#5d1c16'];

const COVERS = {
  open: { color: '#5d1c16', spine: '#3d0f0b', ink: '#f6e4a6' },
  saved: { color: '#7a6e46', spine: '#544b2c', ink: '#f6e4a6' },
  blank: { color: '#5c4034', spine: '#3e2a21', ink: '#d6bdb8' },
};

const GLYPHS = {
  t: ['.#.', '###', '.#.', '.#.', '.##', '...'],
  c: ['...', '###', '#..', '#..', '###', '...'],
  h: ['#..', '#..', '###', '#.#', '#.#', '...'],
  a: ['...', '##.', '..#', '###', '###', '...'],
  u: ['...', '#.#', '#.#', '#.#', '###', '...'],
  p: ['...', '##.', '#.#', '#.#', '##.', '#..'],
  ':': ['.', '.', '#', '.', '#', '.'],
  ' ': ['..', '..', '..', '..', '..', '..'],
};

function lettering(text, color) {
  const rows = Array.from({ length: 6 }, () => '');
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    g.forEach((r, y) => {
      rows[y] += (i ? '.' : '') + r;
    });
  });
  const width = rows[0].length;
  return `<svg class="caderno-letreiro" viewBox="-1 -1 ${width + 2} 8" shape-rendering="crispEdges" role="img" aria-label="${text}"><path fill="${color}" d="${bitmapPath(rows)}"/></svg>`;
}

function coverPattern(cover) {
  const w = 30;
  const h = 42;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cover.color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = cover.ink;
  const start = Math.round(h * 0.58);
  for (let y = start; y < h; y++) {
    const t = (y - start) / (h - start);
    for (let x = 0; x < w; x++) if (t * 0.85 > bayerThreshold(x, y)) ctx.fillRect(x, y, 1, 1);
  }
  return canvas;
}

function artFromDocument(doc, source) {
  const count = framesToRender(doc);
  const frames = [];
  for (let i = 0; i < count; i++) frames.push(doc.composite(i));
  if (frames.every(isBlank)) return null;
  return {
    name: doc.name || 'Sem título',
    width: doc.width,
    height: doc.height,
    frameCount: doc.frames.length,
    frames: frames.map((px) => pixelsToCanvas(px, doc.width, doc.height)),
    delays: frameDelays(doc).slice(0, count),
    source,
  };
}

function artCanvas(art, className = 'caderno-pixels') {
  const canvas = createCanvas(art.width, art.height);
  canvas.className = className;
  canvas.getContext('2d').drawImage(art.frames[0], 0, 0);
  return canvas;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export class Sketchbook {
  constructor(app) {
    this.app = app;
    this.dialog = null;
    this.books = [];
    this.selected = 0;
    this.opened = false;
    this.players = [];
    this.raf = 0;
    this.pointer = null;
    this.showArt = readPreference('sketchbookArt', true) !== false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.onResize = () => this.measure();
  }

  get book() {
    return this.books[this.selected];
  }

  async show() {
    if (this.dialog) return;
    this.build();
    this.books = [this.openBook(), this.savedBook(), this.blankBook()];
    this.selected = 0;
    this.books.forEach((b) => this.stage.append(this.renderBook(b)));
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.stage.focus();
    this.measure();
    this.update();
    window.addEventListener('resize', this.onResize);
    this.loadSaved(this.books[1]);
  }

  close() {
    if (!this.dialog) return;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.phase);
    window.removeEventListener('resize', this.onResize);
    this.dialog.close();
    this.dialog.remove();
    this.dialog = null;
    this.books = [];
    this.players = [];
    this.opened = false;
  }

  build() {
    this.title = el('h2', { id: 'caderno-titulo' });
    this.subtitle = el('button', { type: 'button', class: 'caderno-sub', onclick: () => this.toggleArt() });
    this.counter = el('span', { class: 'caderno-contador mono', 'aria-live': 'polite' });
    this.back = el('button', { type: 'button', class: 'caderno-botao', title: 'Voltar à estante (Esc)', 'aria-label': 'Voltar à estante', html: icon('frames', 18), onclick: () => this.closeBook() });
    this.stage = el('div', { class: 'caderno-palco', tabindex: '0', 'aria-label': 'Estante de cadernos. Use as setas para escolher e Enter para abrir.' });
    this.prev = el('button', { type: 'button', class: 'caderno-botao', html: icon('left', 18), onclick: () => this.step(-1) });
    this.next = el('button', { type: 'button', class: 'caderno-botao', html: icon('right', 18), onclick: () => this.step(1) });
    this.eye = el('button', { type: 'button', class: 'caderno-botao', onclick: () => this.toggleArt() });
    this.main = el('button', { type: 'button', class: 'caderno-botao caderno-principal', onclick: () => (this.opened ? this.editPage() : this.openCurrent()) });
    this.dialog = el(
      'dialog',
      { class: 'caderno', 'aria-labelledby': 'caderno-titulo' },
      el(
        'header',
        { class: 'caderno-topo' },
        el('div', { class: 'caderno-grupo' }, el('button', { type: 'button', class: 'caderno-botao', title: 'Fechar o caderno', 'aria-label': 'Fechar o caderno', html: '×', onclick: () => this.close() }), this.back),
        el('div', { class: 'caderno-titulo' }, this.title, this.subtitle),
        el('div', { class: 'caderno-grupo caderno-direita' }, this.counter),
      ),
      this.stage,
      el('footer', { class: 'caderno-acoes' }, this.prev, this.eye, this.main, this.next),
    );
    this.dialog.classList.toggle('sem-artes', !this.showArt);
    this.dialog.addEventListener('cancel', (e) => e.preventDefault());
    this.dialog.addEventListener('keydown', (e) => this.key(e));
    this.stage.addEventListener('pointerdown', (e) => this.down(e));
    this.stage.addEventListener('pointerup', (e) => this.up(e));
    this.stage.addEventListener('pointercancel', () => (this.pointer = null));
  }

  openBook() {
    const { editor } = this.app;
    const tabs = this.app.tabs;
    const docs = tabs ? tabs.tabs.map((t, i) => ({ doc: i === tabs.active ? editor.doc : t.session?.doc, index: i })) : [{ doc: editor.doc, index: 0 }];
    const arts = docs.filter((d) => d.doc).map((d) => artFromDocument(d.doc, { type: 'tab', index: d.index })).filter(Boolean);
    return this.makeBook('open', 'Projetos abertos', arts, 'Nenhuma pixel art aberta ainda. Desenhe no Crivo e ela aparece aqui.');
  }

  savedBook() {
    const book = this.makeBook('saved', 'Projetos salvos', [], `Procurando projetos salvos em ${this.app.storage.name}…`);
    book.loading = true;
    return book;
  }

  blankBook() {
    return this.makeBook('blank', 'Caderno em branco', [], null, 6);
  }

  makeBook(kind, title, arts, empty, minLeaves) {
    return { kind, title, arts, empty, minLeaves, cover: COVERS[kind], flips: 0, ...paginate(kind === 'blank' ? [] : arts, minLeaves) };
  }

  async loadSaved(book) {
    const storage = this.app.storage;
    const arts = [];
    try {
      const list = (await storage.listProjects()).slice(0, SAVED_LIMIT);
      for (const p of list) {
        if (!this.dialog) return;
        try {
          const full = await storage.openProject(p.id);
          const art = artFromDocument(deserialize(full.data), { type: 'saved', id: p.id });
          if (art) arts.push(art);
        } catch {
          continue;
        }
      }
      book.empty = `Nenhum projeto salvo em ${storage.name}. Use Arquivo › Salvar (Ctrl+S) e ele entra neste caderno.`;
    } catch (error) {
      book.empty = `Não foi possível ler os projetos salvos: ${error.message}`;
    }
    if (!this.dialog || !this.books.includes(book)) return;
    book.loading = false;
    book.arts = arts;
    Object.assign(book, paginate(arts));
    book.flips = clampFlips(book.flips, book.total);
    const old = book.item;
    old.replaceWith(this.renderBook(book));
    this.layout();
    this.update();
  }

  renderBook(book) {
    book.leaves = [];
    this.players = this.players.filter((p) => p.book !== book);
    const content = (i) => this.page(book, i);
    book.leaves.push(this.leaf(this.cover(book), this.endpaper(book), 'caderno-folha-capa'));
    for (let i = 0; i < book.pages.length / 2; i++) book.leaves.push(this.leaf(content(2 * i), content(2 * i + 1)));
    book.leaves.push(this.leaf(this.inside(book), el('div', { class: 'caderno-capa-verso', style: { background: book.cover.color } }), 'caderno-folha-fundo'));
    book.pos = el('div', { class: 'caderno-livro-pos' }, el('div', { class: 'caderno-chao' }), (book.spin = el('div', { class: 'caderno-livro-giro' }, el('div', { class: 'caderno-livro' }, book.leaves))));
    book.item = el('div', { class: 'caderno-item', data: { kind: book.kind } }, book.pos);
    book.spin.addEventListener('animationend', () => book.spin.classList.remove('abrindo', 'fechando'));
    return book.item;
  }

  leaf(front, back, extra = '') {
    return el('div', { class: `caderno-folha ${extra}` }, el('div', { class: 'caderno-face frente' }, front), el('div', { class: 'caderno-face verso' }, back));
  }

  cover(book) {
    const thumbs = book.arts.slice(0, book.kind === 'saved' ? 4 : 1).map((a) => el('span', { class: 'caderno-miniatura' }, artCanvas(a)));
    const label = el(
      'div',
      { class: 'caderno-etiqueta' },
      thumbs.length ? el('div', { class: `caderno-miniaturas n${thumbs.length}` }, thumbs) : el('span', { class: 'caderno-logo', html: icon('logo', 28) }),
      el('strong', {}, book.title),
      el('span', { class: 'mono' }, book.loading ? 'carregando…' : plural(pageCount(book.pages.length / 2), 'página', 'páginas')),
    );
    const pattern = coverPattern(book.cover);
    pattern.className = 'caderno-padrao';
    return el('div', { class: 'caderno-capa', style: { '--capa': book.cover.color, '--lombada': book.cover.spine, '--tinta': book.cover.ink } }, pattern, label, el('span', { class: 'caderno-elastico' }));
  }

  endpaper(book) {
    return el(
      'div',
      { class: 'caderno-guarda' },
      el('span', { class: 'caderno-guarda-titulo' }, 'Este caderno'),
      el('strong', {}, book.title),
      el('span', { class: 'mono' }, book.kind === 'blank' ? 'páginas quadriculadas, prontas para rascunhos' : plural(book.arts.length, 'pixel art', 'pixel arts')),
      el('div', { class: 'caderno-amostras', 'aria-hidden': 'true' }, PAPER.map((c) => el('span', { style: { background: c } }))),
    );
  }

  inside(book, side = 'direita') {
    return el('div', { class: `caderno-final ${side}`, style: { background: book.cover.color }, html: lettering('tchau :p', book.cover.ink) });
  }

  page(book, index) {
    if (index === book.pages.length - 1) return this.inside(book, 'esquerda');
    const art = book.pages[index];
    const side = index % 2 === 0 ? 'direita' : 'esquerda';
    const page = el('div', { class: `caderno-pagina ${side}` }, el('span', { class: 'caderno-numero mono' }, pageNumber(index)));
    if (art) {
      const canvas = artCanvas(art);
      page.append(
        el('div', { class: 'caderno-arte' }, el('div', { class: 'caderno-matriz', style: { aspectRatio: `${art.width} / ${art.height}`, '--ar': String(art.width / art.height) } }, canvas)),
        el('div', { class: 'caderno-legenda' }, el('strong', {}, art.name), el('span', { class: 'mono' }, `${art.width} × ${art.height} · ${plural(art.frameCount, 'quadro', 'quadros')}`)),
      );
      if (art.frames.length > 1) this.players.push({ book, index, art, canvas, frame: 0, last: 0 });
    } else if (index === 0 && book.empty && !book.arts.length) {
      page.append(el('p', { class: 'caderno-vazio' }, book.empty));
    }
    return page;
  }

  measure() {
    if (!this.dialog) return;
    const r = this.stage.getBoundingClientRect();
    const height = Math.max(150, Math.min(r.height * 0.7, (r.width * 0.94) / 3.3 / 0.72));
    const width = height * 0.72;
    this.size = { width, height, stage: r.width };
    this.dialog.style.setProperty('--pw', `${width}px`);
    this.dialog.style.setProperty('--ph', `${height}px`);
    this.dialog.style.setProperty('--perspectiva', `${height * 3.2}px`);
    this.layout();
  }

  layout() {
    if (!this.size) return;
    const { width, height, stage } = this.size;
    const stepX = width * SHELF + Math.max(16, width * 0.1);
    this.books.forEach((book, i) => {
      const current = i === this.selected;
      const open = this.opened && current;
      let x = (i - this.selected) * stepX;
      if (this.opened && !current) x = Math.sign(i - this.selected) * (stage / 2 + width * 1.4);
      const scale = open ? 1 : SHELF;
      book.item.style.setProperty('--x', `${x}px`);
      book.item.classList.toggle('atual', current);
      book.item.classList.toggle('longe', this.opened && !current);
      book.pos.style.setProperty('--s', scale);
      book.pos.style.setProperty('--tx', open ? '0px' : `${(-width / 2) * scale}px`);
      book.pos.classList.toggle('aberto', open);
      book.leaves.forEach((leaf, k) => {
        const pose = leafPose(k, book.flips, { open, gap: open ? width * 0.2 : 1.2, depth: open ? height * 0.16 : width * 0.014, fan: 5 });
        leaf.style.setProperty('--fx', `${pose.x}px`);
        leaf.style.setProperty('--fz', `${pose.z}px`);
        leaf.style.setProperty('--fr', `${pose.rotate}deg`);
        leaf.style.setProperty('--sombra', pose.shade);
        leaf.classList.toggle('virada', pose.flipped);
        leaf.classList.toggle('funda', pose.level > 5);
      });
    });
  }

  update() {
    const book = this.book;
    if (!book) return;
    this.dialog.classList.toggle('aberto', this.opened);
    this.title.textContent = book.title;
    this.subtitle.innerHTML = `${icon(this.showArt ? 'eye' : 'eyeClosed', 14)}<span>${book.loading ? 'carregando…' : plural(pageCount(book.pages.length / 2), 'página', 'páginas')}</span>`;
    this.subtitle.title = this.showArt ? 'Ocultar as pixel arts' : 'Mostrar as pixel arts';
    this.counter.textContent = this.opened ? spreadLabel(book.flips, book.pages.length / 2) : `Caderno ${this.selected + 1} de ${this.books.length}`;
    this.back.disabled = !this.opened;
    this.eye.innerHTML = icon(this.showArt ? 'eye' : 'eyeClosed', 18);
    this.eye.title = this.showArt ? 'Ocultar as pixel arts' : 'Mostrar as pixel arts';
    this.eye.setAttribute('aria-pressed', String(!this.showArt));
    const target = this.opened ? this.currentArt() : null;
    this.main.innerHTML = icon(this.opened ? 'pencil' : 'sketchbook', 18);
    this.main.title = this.opened ? (target ? `Editar "${target.name}" no Crivo` : 'Esta página não tem pixel art') : `Abrir "${book.title}" (Enter)`;
    this.main.disabled = this.opened && (!target || !this.showArt);
    this.prev.title = this.opened ? 'Página anterior (←)' : 'Caderno anterior (←)';
    this.next.title = this.opened ? 'Próxima página (→)' : 'Próximo caderno (→)';
    this.prev.disabled = !this.opened && this.selected === 0;
    this.next.disabled = !this.opened && this.selected === this.books.length - 1;
    for (const b of [this.prev, this.next, this.eye, this.main]) b.setAttribute('aria-label', b.title);
    if (this.opened && !this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  currentArt() {
    const book = this.book;
    const s = spread(book.flips, book.pages.length / 2);
    return (s.right !== null && book.pages[s.right]) || (s.left !== null && book.pages[s.left]) || null;
  }

  select(i) {
    const n = Math.max(0, Math.min(this.books.length - 1, i));
    if (n === this.selected) return;
    this.selected = n;
    this.layout();
    this.update();
  }

  openCurrent() {
    if (this.opened) return;
    const book = this.book;
    this.opened = true;
    book.flips = 1;
    this.spin(book, 'abrindo');
    this.layout();
    this.update();
    this.stage.setAttribute('aria-label', `${book.title} aberto. Use as setas para virar as páginas e Esc para fechar.`);
  }

  closeBook() {
    if (!this.opened) return;
    const book = this.book;
    this.opened = false;
    book.flips = 0;
    this.spin(book, 'fechando');
    this.layout();
    this.update();
    this.stage.setAttribute('aria-label', 'Estante de cadernos. Use as setas para escolher e Enter para abrir.');
  }

  spin(book, name) {
    clearTimeout(this.phase);
    this.dialog.classList.remove('abrindo', 'fechando');
    this.books.forEach((b) => {
      b.item.classList.remove('abrindo', 'fechando');
      b.spin.classList.remove('abrindo', 'fechando');
    });
    if (this.reduced.matches) return;
    void book.spin.offsetWidth;
    this.dialog.classList.add(name);
    book.item.classList.add(name);
    book.spin.classList.add(name);
    this.phase = setTimeout(() => {
      this.dialog?.classList.remove(name);
      book.item.classList.remove(name);
    }, name === 'abrindo' ? OPEN_TIME : CLOSE_TIME);
  }

  flip(delta) {
    const book = this.book;
    const target = book.flips + delta;
    if (target < 1 || target > book.total - 1) {
      this.closeBook();
      return;
    }
    book.flips = target;
    this.layout();
    this.update();
  }

  step(delta) {
    if (this.opened) this.flip(delta);
    else this.select(this.selected + delta);
  }

  toggleArt() {
    this.showArt = !this.showArt;
    writePreference('sketchbookArt', this.showArt);
    this.dialog.classList.toggle('sem-artes', !this.showArt);
    this.update();
  }

  editPage() {
    const art = this.currentArt();
    if (!art) return;
    this.close();
    if (art.source.type === 'tab') this.app.tabs?.activate(art.source.index);
    else this.app.openSavedProject?.(art.source.id);
  }

  key(e) {
    const onButton = e.target instanceof HTMLButtonElement;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (this.opened) this.closeBook();
      else this.close();
    } else if (k === 'ArrowRight' || k === 'PageDown') {
      e.preventDefault();
      this.step(1);
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      this.step(-1);
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      if (this.opened) {
        this.book.flips = k === 'Home' ? 1 : this.book.total - 1;
        this.layout();
        this.update();
      } else this.select(k === 'Home' ? 0 : this.books.length - 1);
    } else if ((k === 'Enter' || k === ' ') && !onButton) {
      e.preventDefault();
      if (this.opened) this.flip(1);
      else this.openCurrent();
    } else if (k === 'F8') {
      e.preventDefault();
      this.close();
    }
  }

  down(e) {
    if (e.button !== 0) return;
    this.pointer = { x: e.clientX, y: e.clientY };
  }

  up(e) {
    const p = this.pointer;
    this.pointer = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - p.y)) {
      this.step(dx < 0 ? 1 : -1);
      return;
    }
    if (this.opened) {
      const r = this.stage.getBoundingClientRect();
      this.flip(e.clientX >= r.left + r.width / 2 ? 1 : -1);
      return;
    }
    const item = e.target.closest?.('.caderno-item');
    const i = this.books.findIndex((b) => b.item === item);
    if (i < 0) return;
    if (i === this.selected) this.openCurrent();
    else this.select(i);
  }

  tick(time) {
    this.raf = 0;
    if (!this.dialog || !this.opened) return;
    if (this.showArt && !this.reduced.matches) {
      const book = this.book;
      for (const p of this.players) {
        if (p.book !== book) continue;
        const leaf = Math.floor(p.index / 2) + 1;
        if (Math.abs(leaf - book.flips) > 2) continue;
        if (time - p.last < p.art.delays[p.frame]) continue;
        p.last = time;
        p.frame = (p.frame + 1) % p.art.frames.length;
        const ctx = p.canvas.getContext('2d');
        ctx.clearRect(0, 0, p.art.width, p.art.height);
        ctx.drawImage(p.art.frames[p.frame], 0, 0);
      }
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
}
