import { sobrepor } from '../nucleo/cores.js';
import { pincel, espelhos } from '../nucleo/geometria.js';

export const NIVEIS_ZOOM = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

export class Visor {
  constructor(canvas, editor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.editor = editor;
    this.zoom = 16;
    this.panX = 0;
    this.panY = 0;
    this.largura = 0;
    this.altura = 0;
    this.dpr = 1;
    this.cursor = null;
    this.previa = null;
    this.sujo = true;
    this.pedido = false;
    this.ajustado = false;
    this.oc = document.createElement('canvas');
    this.ocCebola = document.createElement('canvas');
    this.cores = {};
    this.lerCores();
    const observador = new ResizeObserver(() => this.redimensionar());
    observador.observe(canvas.parentElement);
    editor.ao('pixels', () => this.invalidar());
    editor.ao('documento', ({ novo }) => {
      this.sujo = true;
      if (novo && this.largura > 0) this.ajustar();
      else if (novo) this.ajustado = false;
      this.invalidar();
    });
    editor.ao('quadro', () => this.invalidar());
    editor.ao('selecao', () => this.pedir());
    editor.ao('estado', ({ chave }) => {
      if (['grade', 'simetria', 'cebola', 'ferramenta', 'tamanho', 'forma', 'gradeForte', 'ladrilho'].includes(chave)) this.pedir();
    });
    this.fase = 0;
    setInterval(() => {
      if (!this.editor.selecao || document.hidden) return;
      this.fase = (this.fase + 1) % 8;
      this.pedir();
    }, 120);
  }

  lerCores() {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    this.cores = {
      area: v('--area'),
      xadrezA: v('--xadrez-a'),
      xadrezB: v('--xadrez-b'),
      grade: v('--grade'),
      gradeForte: v('--grade-forte'),
      borda: v('--borda-matriz'),
      eixo: v('--eixo'),
      cursor: v('--cursor-claro'),
      cursorEscuro: v('--cursor-escuro'),
    };
    this.padrao = null;
    this.pedir();
  }

  redimensionar() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.largura = r.width;
    this.altura = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (!this.ajustado && r.width > 0) this.ajustar();
    this.pedir();
  }

  ajustar() {
    const doc = this.editor.doc;
    const margem = 48;
    const z = Math.max(1, Math.floor(Math.min((this.largura - margem) / doc.largura, (this.altura - margem) / doc.altura)));
    this.zoom = Math.min(128, z);
    this.centralizar();
    this.ajustado = true;
    this.emitirZoom();
  }

  centralizar() {
    const doc = this.editor.doc;
    this.panX = Math.round((this.largura - doc.largura * this.zoom) / 2);
    this.panY = Math.round((this.altura - doc.altura * this.zoom) / 2);
    this.pedir();
  }

  definirZoom(z, cx = this.largura / 2, cy = this.altura / 2) {
    z = Math.max(1, Math.min(128, Math.round(z)));
    if (z === this.zoom) return;
    const mx = (cx - this.panX) / this.zoom;
    const my = (cy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = Math.round(cx - mx * z);
    this.panY = Math.round(cy - my * z);
    this.emitirZoom();
    this.pedir();
  }

  passoZoom(direcao, cx, cy) {
    const atual = this.zoom;
    let alvo;
    if (direcao > 0) alvo = NIVEIS_ZOOM.find((n) => n > atual) ?? 128;
    else alvo = [...NIVEIS_ZOOM].reverse().find((n) => n < atual) ?? 1;
    this.definirZoom(alvo, cx, cy);
  }

  emitirZoom() {
    this.editor.emitir('zoom', { zoom: this.zoom });
  }

  mover(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.pedir();
  }

  telaParaMatriz(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const x = Math.floor((sx - this.panX) / this.zoom);
    const y = Math.floor((sy - this.panY) / this.zoom);
    const doc = this.editor.doc;
    return { x, y, sx, sy, dentro: x >= 0 && y >= 0 && x < doc.largura && y < doc.altura };
  }

  definirPrevia(indices, cor) {
    this.previa = indices ? { indices, cor } : null;
    this.invalidar();
  }

  definirCursor(p) {
    const antes = this.cursor;
    this.cursor = p && p.dentro ? { x: p.x, y: p.y } : null;
    if (antes?.x !== this.cursor?.x || antes?.y !== this.cursor?.y) this.pedir();
  }

  invalidar() {
    this.sujo = true;
    this.pedir();
  }

  pedir() {
    if (this.pedido) return;
    this.pedido = true;
    requestAnimationFrame(() => {
      this.pedido = false;
      this.desenhar();
    });
  }

  compor() {
    const doc = this.editor.doc;
    const { largura: L, altura: A } = doc;
    if (this.oc.width !== L || this.oc.height !== A) {
      this.oc.width = L;
      this.oc.height = A;
      this.ocCebola.width = L;
      this.ocCebola.height = A;
      this.dados = new ImageData(L, A);
      this.buffer = new Uint32Array(this.dados.data.buffer);
      this.dadosCebola = new ImageData(L, A);
      this.bufferCebola = new Uint32Array(this.dadosCebola.data.buffer);
    }
    const q = Math.min(this.editor.estado.quadro, doc.quadros.length - 1);
    doc.compor(q, this.buffer);
    if (this.previa) {
      const { indices, cor } = this.previa;
      for (const i of indices) this.buffer[i] = cor >>> 24 ? sobrepor(this.buffer[i], cor) : 0;
    }
    this.oc.getContext('2d').putImageData(this.dados, 0, 0);
    this.temCebola = false;
    if (this.editor.estado.cebola && !this.editor.estado.tocando && q > 0) {
      doc.compor(q - 1, this.bufferCebola);
      this.ocCebola.getContext('2d').putImageData(this.dadosCebola, 0, 0);
      this.temCebola = true;
    }
    this.sujo = false;
  }

  xadrez() {
    if (this.padrao) return this.padrao;
    const t = 8;
    const c = document.createElement('canvas');
    c.width = t * 2;
    c.height = t * 2;
    const g = c.getContext('2d');
    g.fillStyle = this.cores.xadrezA;
    g.fillRect(0, 0, t * 2, t * 2);
    g.fillStyle = this.cores.xadrezB;
    g.fillRect(0, 0, t, t);
    g.fillRect(t, t, t, t);
    this.padrao = this.ctx.createPattern(c, 'repeat');
    return this.padrao;
  }

  desenhar() {
    if (this.sujo) this.compor();
    const { ctx, dpr, zoom: z } = this;
    const doc = this.editor.doc;
    const estado = this.editor.estado;
    const L = doc.largura * z;
    const A = doc.altura * z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.cores.area;
    ctx.fillRect(0, 0, this.largura, this.altura);
    const padrao = this.xadrez();
    padrao.setTransform?.(new DOMMatrix().translate(this.panX, this.panY));
    ctx.fillStyle = padrao;
    ctx.fillRect(this.panX, this.panY, L, A);
    ctx.imageSmoothingEnabled = false;
    if (estado.ladrilho) {
      // Modo ladrilho: repete o quadro 3×3 em volta da matriz, esmaecido, para conferir as emendas.
      ctx.globalAlpha = 0.55;
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          if (!tx && !ty) continue;
          const ox = this.panX + tx * L;
          const oy = this.panY + ty * A;
          ctx.fillStyle = padrao;
          ctx.fillRect(ox, oy, L, A);
          ctx.drawImage(this.oc, ox, oy, L, A);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (this.temCebola) {
      ctx.globalAlpha = 0.32;
      ctx.drawImage(this.ocCebola, this.panX, this.panY, L, A);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.oc, this.panX, this.panY, L, A);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const X = (v) => Math.round((this.panX + v * z) * dpr);
    const Y = (v) => Math.round((this.panY + v * z) * dpr);
    const passoForte = Number(estado.gradeForte) || 0;
    const ehForte = (v) => passoForte > 0 && v % passoForte === 0;
    if (estado.grade && z >= 4) {
      const linhas = (forte) => {
        ctx.beginPath();
        for (let x = 1; x < doc.largura; x++) {
          if (ehForte(x) !== forte) continue;
          ctx.moveTo(X(x) + 0.5, Y(0));
          ctx.lineTo(X(x) + 0.5, Y(doc.altura));
        }
        for (let y = 1; y < doc.altura; y++) {
          if (ehForte(y) !== forte) continue;
          ctx.moveTo(X(0), Y(y) + 0.5);
          ctx.lineTo(X(doc.largura), Y(y) + 0.5);
        }
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.cores.grade;
      linhas(false);
      if (passoForte > 0 && (doc.largura > passoForte || doc.altura > passoForte)) {
        ctx.strokeStyle = this.cores.gradeForte;
        linhas(true);
      }
    }
    if (estado.simetria !== 'nenhuma') {
      ctx.save();
      ctx.strokeStyle = this.cores.eixo;
      ctx.lineWidth = Math.max(1, Math.round(dpr * 1.5));
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      if (estado.simetria === 'horizontal' || estado.simetria === 'ambas') {
        const cx = Math.round((this.panX + (doc.largura / 2) * z) * dpr);
        ctx.moveTo(cx, Y(0) - 10 * dpr);
        ctx.lineTo(cx, Y(doc.altura) + 10 * dpr);
      }
      if (estado.simetria === 'vertical' || estado.simetria === 'ambas') {
        const cy = Math.round((this.panY + (doc.altura / 2) * z) * dpr);
        ctx.moveTo(X(0) - 10 * dpr, cy);
        ctx.lineTo(X(doc.largura) + 10 * dpr, cy);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = this.cores.borda;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.strokeRect(X(0) - 0.5, Y(0) - 0.5, X(doc.largura) - X(0) + 1, Y(doc.altura) - Y(0) + 1);
    if (this.editor.selecao) this.desenharSelecao(X, Y);
    if (this.cursor && !estado.tocando && !['mover', 'moverPixels'].includes(estado.ferramenta)) this.desenharCursor(X, Y);
  }

  // Seleção: retângulo tracejado em duas cores que "anda" (formigas), visível sobre qualquer fundo.
  desenharSelecao(X, Y) {
    const { ctx, dpr } = this;
    const r = this.editor.selecao;
    const x = X(r.x) + 0.5;
    const y = Y(r.y) + 0.5;
    const l = X(r.x + r.largura) - X(r.x) - 1;
    const a = Y(r.y + r.altura) - Y(r.y) - 1;
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.setLineDash([]);
    ctx.strokeStyle = this.cores.cursorEscuro || '#000';
    ctx.strokeRect(x, y, l, a);
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineDashOffset = -this.fase * dpr;
    ctx.strokeStyle = this.cores.cursor || '#fff';
    ctx.strokeRect(x, y, l, a);
    ctx.restore();
  }

  desenharCursor(X, Y) {
    const { ctx, dpr } = this;
    const estado = this.editor.estado;
    const usaPincel = ['lapis', 'borracha', 'linha', 'pontilhado', 'sombra'].includes(estado.ferramenta);
    const doc = this.editor.doc;
    const pontos = usaPincel ? pincel(estado.tamanho, estado.forma) : [[0, 0]];
    const celulas = new Map();
    for (const [dx, dy] of pontos) {
      for (const [x, y] of espelhos(this.cursor.x + dx, this.cursor.y + dy, doc.largura, doc.altura, estado.simetria)) celulas.set(`${x},${y}`, [x, y]);
    }
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    for (const [cor, deslocamento] of [[this.cores.cursorEscuro, 1], [this.cores.cursor, 0]]) {
      ctx.strokeStyle = cor;
      ctx.beginPath();
      for (const [x, y] of celulas.values()) {
        ctx.rect(X(x) + 0.5 + deslocamento, Y(y) + 0.5 + deslocamento, X(x + 1) - X(x) - 1, Y(y + 1) - Y(y) - 1);
      }
      ctx.stroke();
    }
  }
}
