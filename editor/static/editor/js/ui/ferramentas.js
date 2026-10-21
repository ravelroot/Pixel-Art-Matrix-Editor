import { linha, retangulo, elipse, pincel, espelhos, restringir } from '../nucleo/geometria.js';
import { regiao } from '../nucleo/preenchimento.js';
import { corParaHex } from '../nucleo/cores.js';
import { avisar } from './util.js';

export const FERRAMENTAS = [
  { id: 'lapis', nome: 'Lápis', atalho: 'B', icone: 'lapis', opcoes: ['tamanho', 'forma'] },
  { id: 'borracha', nome: 'Borracha', atalho: 'E', icone: 'borracha', opcoes: ['tamanho', 'forma', 'modoBorracha'] },
  { id: 'balde', nome: 'Balde de tinta', atalho: 'F', icone: 'balde', opcoes: ['conectividade', 'tolerancia', 'contiguo', 'amostra'] },
  { id: 'linha', nome: 'Linha', atalho: 'L', icone: 'linha', opcoes: ['tamanho'] },
  { id: 'retangulo', nome: 'Retângulo', atalho: 'R', icone: 'retangulo', opcoes: ['preenchido'] },
  { id: 'elipse', nome: 'Elipse e círculo', atalho: 'O', icone: 'elipse', opcoes: ['preenchido'] },
  { id: 'contaGotas', nome: 'Conta-gotas', atalho: 'I', icone: 'contaGotas', opcoes: ['amostra'] },
  { id: 'mover', nome: 'Mover a visão', atalho: 'H', icone: 'mover', opcoes: [] },
];

export class Controlador {
  constructor(editor, visor) {
    this.editor = editor;
    this.visor = visor;
    this.ativo = null;
    this.espaco = false;
    this.ultimoPonto = null;
    const c = visor.canvas;
    c.addEventListener('pointerdown', (e) => this.baixar(e));
    c.addEventListener('pointermove', (e) => this.moverPonteiro(e));
    c.addEventListener('pointerup', (e) => this.soltar(e));
    c.addEventListener('pointercancel', (e) => this.soltar(e, true));
    c.addEventListener('pointerleave', () => {
      if (!this.ativo) {
        this.visor.definirCursor(null);
        this.editor.emitir('ponteiro', null);
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          if (e.shiftKey && !e.ctrlKey) this.visor.mover(-e.deltaY, 0);
          else this.visor.passoZoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
        } else {
          this.visor.mover(-e.deltaX, -e.deltaY);
        }
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !this.campoEmFoco(e)) {
        this.espaco = true;
        c.classList.add('arrastando');
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.espaco = false;
        c.classList.remove('arrastando');
      }
    });
  }

  campoEmFoco(e) {
    const t = e.target;
    return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  }

  get estado() {
    return this.editor.estado;
  }

  cor(botao) {
    return botao === 2 ? this.estado.corSecundaria : this.estado.corPrimaria;
  }

  baixar(e) {
    if (this.ativo) return;
    const p = this.visor.telaParaMatriz(e.clientX, e.clientY);
    this.visor.canvas.setPointerCapture(e.pointerId);
    const ferramenta = this.estado.ferramenta;
    if (e.button === 1 || this.espaco || ferramenta === 'mover') {
      this.ativo = { tipo: 'pan', x: e.clientX, y: e.clientY };
      this.visor.canvas.classList.add('arrastando');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (e.altKey && ['lapis', 'borracha', 'balde', 'linha', 'retangulo', 'elipse'].includes(ferramenta)) {
      this.amostrar(p, e.button);
      this.ativo = { tipo: 'amostra', botao: e.button };
      return;
    }
    const botao = e.button;
    if (ferramenta === 'contaGotas') {
      this.amostrar(p, botao);
      this.ativo = { tipo: 'amostra', botao };
      return;
    }
    if (ferramenta === 'balde') {
      this.balde(p, botao);
      return;
    }
    const traco = this.editor.novoTraco();
    if (!traco) return;
    const cor = ferramenta === 'borracha' ? this.corBorracha(botao) : this.cor(botao);
    if (ferramenta === 'lapis' || ferramenta === 'borracha') {
      this.ativo = { tipo: 'traco', traco, cor, ultimo: p };
      if (e.shiftKey && this.ultimoPonto) linha(this.ultimoPonto.x, this.ultimoPonto.y, p.x, p.y, (x, y) => this.carimbar(traco, x, y, cor));
      else this.carimbar(traco, p.x, p.y, cor);
      this.editor.emitir('pixels');
      return;
    }
    this.ativo = { tipo: 'forma', traco, cor, inicio: p, fim: p };
    this.atualizarForma(e);
  }

  corBorracha(botao) {
    if (this.estado.modoBorracha === 'fundo') return botao === 2 ? this.estado.corPrimaria : this.estado.corSecundaria;
    return 0;
  }

  moverPonteiro(e) {
    const p = this.visor.telaParaMatriz(e.clientX, e.clientY);
    this.visor.definirCursor(p);
    this.editor.emitir('ponteiro', p.dentro ? p : null);
    const a = this.ativo;
    if (!a) return;
    if (a.tipo === 'pan') {
      this.visor.mover(e.clientX - a.x, e.clientY - a.y);
      a.x = e.clientX;
      a.y = e.clientY;
    } else if (a.tipo === 'amostra') {
      this.amostrar(p, a.botao);
    } else if (a.tipo === 'traco') {
      const eventos = e.getCoalescedEvents?.() ?? [e];
      for (const ev of eventos) {
        const q = this.visor.telaParaMatriz(ev.clientX, ev.clientY);
        if (q.x === a.ultimo.x && q.y === a.ultimo.y) continue;
        linha(a.ultimo.x, a.ultimo.y, q.x, q.y, (x, y) => this.carimbar(a.traco, x, y, a.cor));
        a.ultimo = q;
      }
      this.editor.emitir('pixels');
    } else if (a.tipo === 'forma') {
      a.fim = p;
      this.atualizarForma(e);
    }
  }

  soltar(e, cancelado = false) {
    const a = this.ativo;
    this.ativo = null;
    this.visor.canvas.classList.remove('arrastando');
    if (!a) return;
    if (a.tipo === 'traco') {
      if (cancelado) {
        a.traco.desfazerVisual();
        this.editor.emitir('pixels');
        return;
      }
      this.ultimoPonto = a.ultimo;
      this.editor.concluirTraco(a.traco, this.estado.ferramenta === 'borracha' ? 'Borracha' : 'Lápis');
      this.editor.lembrarCor(a.cor);
    } else if (a.tipo === 'forma') {
      this.visor.definirPrevia(null);
      if (cancelado) return;
      for (const i of a.pontos ?? []) a.traco.pintar(i, a.cor);
      const nomes = { linha: 'Linha', retangulo: 'Retângulo', elipse: 'Elipse' };
      this.ultimoPonto = a.fim;
      this.editor.concluirTraco(a.traco, nomes[this.estado.ferramenta] ?? 'Forma');
      this.editor.lembrarCor(a.cor);
    }
  }

  cancelar() {
    if (this.ativo) this.soltar(null, true);
  }

  dentro(x, y) {
    const d = this.editor.doc;
    return x >= 0 && y >= 0 && x < d.largura && y < d.altura;
  }

  carimbar(traco, x, y, cor) {
    const d = this.editor.doc;
    const pontos = pincel(this.estado.tamanho, this.estado.forma);
    for (const [dx, dy] of pontos) {
      for (const [px, py] of espelhos(x + dx, y + dy, d.largura, d.altura, this.estado.simetria)) {
        if (this.dentro(px, py)) traco.pintar(py * d.largura + px, cor);
      }
    }
  }

  atualizarForma(e) {
    const a = this.ativo;
    const d = this.editor.doc;
    const ferramenta = this.estado.ferramenta;
    let { x: x0, y: y0 } = a.inicio;
    let [x1, y1] = [a.fim.x, a.fim.y];
    if (e?.shiftKey) [x1, y1] = restringir(x0, y0, x1, y1, ferramenta === 'linha' ? 'linha' : 'quadrado');
    if (e?.altKey && ferramenta !== 'linha') {
      x0 = 2 * a.inicio.x - x1;
      y0 = 2 * a.inicio.y - y1;
    }
    const pontos = new Set();
    const adicionar = (x, y) => {
      for (const [ex, ey] of espelhos(x, y, d.largura, d.altura, this.estado.simetria)) {
        if (this.dentro(ex, ey)) pontos.add(ey * d.largura + ex);
      }
    };
    if (ferramenta === 'linha') {
      const pontosPincel = pincel(this.estado.tamanho, this.estado.forma);
      linha(x0, y0, x1, y1, (x, y) => {
        for (const [dx, dy] of pontosPincel) adicionar(x + dx, y + dy);
      });
    } else if (ferramenta === 'retangulo') {
      retangulo(x0, y0, x1, y1, this.estado.preenchido, adicionar);
    } else {
      elipse(x0, y0, x1, y1, this.estado.preenchido, adicionar);
    }
    a.pontos = pontos;
    this.visor.definirPrevia(pontos, a.cor);
    this.editor.emitir('forma', { largura: Math.abs(x1 - x0) + 1, altura: Math.abs(y1 - y0) + 1 });
  }

  balde(p, botao) {
    if (!p.dentro) return;
    const traco = this.editor.novoTraco();
    if (!traco) return;
    const d = this.editor.doc;
    const cor = this.cor(botao);
    const opcoes = {
      conectividade: this.estado.conectividade,
      tolerancia: Math.round((this.estado.tolerancia / 100) * 255),
      contiguo: this.estado.contiguo,
    };
    for (const [x, y] of espelhos(p.x, p.y, d.largura, d.altura, this.estado.simetria)) {
      const fonte = this.estado.amostra === 'todas' ? d.compor(this.editor.estado.quadro) : this.editor.celulaAtiva();
      for (const i of regiao(fonte, d.largura, d.altura, x, y, opcoes)) traco.pintar(i, cor);
    }
    if (this.editor.concluirTraco(traco, 'Balde de tinta')) this.editor.lembrarCor(cor);
  }

  amostrar(p, botao) {
    if (!p.dentro) return;
    const d = this.editor.doc;
    const i = p.y * d.largura + p.x;
    const cor = this.estado.amostra === 'todas' ? d.compor(this.editor.estado.quadro)[i] : this.editor.celulaAtiva()[i];
    if (!(cor >>> 24)) {
      this.editor.emitir('amostra', { cor: null });
      return;
    }
    this.editor.definirCor(botao === 2 ? 'secundaria' : 'primaria', cor);
    this.editor.emitir('amostra', { cor: corParaHex(cor) });
  }
}

export function avisoFerramenta(id) {
  const f = FERRAMENTAS.find((x) => x.id === id);
  if (f) avisar(`${f.nome} (${f.atalho})`, 'info', 900);
}
