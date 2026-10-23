import { linha, retangulo, elipse, pincel, espelhos, restringir, cantoEmL } from '../nucleo/geometria.js';
import { regiao } from '../nucleo/preenchimento.js';
import { corParaHex } from '../nucleo/cores.js';
import { pixelDoPadrao, degrade } from '../nucleo/pontilhado.js';
import { retanguloDe, recortarAoDocumento, contem, extrairRegiao, colarRegiao, indicesDe } from '../nucleo/selecao.js';
import { passoDeLuz, passoNaPaleta, rampaDaPaleta } from '../nucleo/filtros.js';
import { avisar } from './util.js';

export const FERRAMENTAS = [
  { id: 'lapis', nome: 'Lápis', atalho: 'B', icone: 'lapis', opcoes: ['tamanho', 'forma', 'pixelPerfect'] },
  { id: 'borracha', nome: 'Borracha', atalho: 'E', icone: 'borracha', opcoes: ['tamanho', 'forma', 'modoBorracha'] },
  { id: 'balde', nome: 'Balde de tinta', atalho: 'F', icone: 'balde', opcoes: ['conectividade', 'tolerancia', 'contiguo', 'amostra'] },
  { id: 'linha', nome: 'Linha', atalho: 'L', icone: 'linha', opcoes: ['tamanho'] },
  { id: 'retangulo', nome: 'Retângulo', atalho: 'R', icone: 'retangulo', opcoes: ['preenchido'] },
  { id: 'elipse', nome: 'Elipse e círculo', atalho: 'O', icone: 'elipse', opcoes: ['preenchido'] },
  { id: 'pontilhado', nome: 'Pontilhado', atalho: 'D', icone: 'pontilhado', opcoes: ['tamanho', 'forma', 'densidade', 'fundoPontilhado'] },
  { id: 'degrade', nome: 'Degradê pontilhado', atalho: 'U', icone: 'degrade', opcoes: ['tipoDegrade', 'matrizDegrade'] },
  { id: 'sombra', nome: 'Clarear e escurecer', atalho: 'Q', icone: 'sombra', opcoes: ['tamanho', 'forma', 'modoSombra', 'intensidadeSombra'] },
  { id: 'contaGotas', nome: 'Conta-gotas', atalho: 'I', icone: 'contaGotas', opcoes: ['amostra'] },
  { id: 'selecao', nome: 'Seleção retangular', atalho: 'S', icone: 'selecao', opcoes: [] },
  { id: 'moverPixels', nome: 'Mover pixels', atalho: 'V', icone: 'moverPixels', opcoes: [] },
  { id: 'mover', nome: 'Mover a visão', atalho: 'H', icone: 'mover', opcoes: [] },
];

const PINCEIS = ['lapis', 'borracha', 'pontilhado', 'sombra'];
const ROTULOS = { lapis: 'Lápis', borracha: 'Borracha', pontilhado: 'Pontilhado', sombra: 'Clarear e escurecer' };

export class Controlador {
  constructor(editor, visor) {
    this.editor = editor;
    this.visor = visor;
    this.ativo = null;
    this.espaco = false;
    this.ultimoPonto = null;
    this.paleta = () => [];
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
    if (e.altKey && ['lapis', 'borracha', 'balde', 'linha', 'retangulo', 'elipse', 'pontilhado', 'degrade'].includes(ferramenta)) {
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
    if (ferramenta === 'selecao') {
      this.ativo = { tipo: 'selecao', inicio: p, fim: p, arrastou: false, anterior: this.editor.selecao };
      return;
    }
    if (ferramenta === 'moverPixels') {
      this.iniciarMovimento(p);
      return;
    }
    const traco = this.editor.novoTraco();
    if (!traco) return;
    if (ferramenta === 'degrade') {
      this.ativo = { tipo: 'degrade', traco, botao, inicio: p, fim: p, pedido: 0 };
      return;
    }
    if (PINCEIS.includes(ferramenta)) {
      const cor = this.corDoPincel(ferramenta, botao, traco);
      const pixelPerfect = ferramenta === 'lapis' && this.estado.pixelPerfect && this.estado.tamanho === 1;
      this.ativo = { tipo: 'traco', traco, cor, ultimo: p, pixelPerfect, pontos: [[p.x, p.y]] };
      if (e.shiftKey && this.ultimoPonto) linha(this.ultimoPonto.x, this.ultimoPonto.y, p.x, p.y, (x, y) => this.carimbar(traco, x, y, cor));
      else this.carimbar(traco, p.x, p.y, cor);
      this.editor.emitir('pixels');
      return;
    }
    const cor = this.cor(botao);
    this.ativo = { tipo: 'forma', traco, cor, inicio: p, fim: p };
    this.atualizarForma(e);
  }

  // Cor fixa (lápis, borracha) ou função (x, y, índice) => cor | null (pontilhado, clarear e escurecer).
  corDoPincel(ferramenta, botao, traco) {
    if (ferramenta === 'borracha') return this.corBorracha(botao);
    if (ferramenta === 'lapis') return this.cor(botao);
    if (ferramenta === 'pontilhado') {
      const frente = this.cor(botao);
      const fundo = this.cor(botao === 2 ? 0 : 2);
      const densidade = this.estado.densidade / 100;
      const usaFundo = this.estado.fundoPontilhado === 'secundaria';
      return (x, y) => (pixelDoPadrao(x, y, densidade) ? frente : usaFundo ? fundo : null);
    }
    const direcao = botao === 2 ? -1 : 1;
    const tocados = new Set();
    const pixels = traco.pixels;
    if (this.estado.modoSombra === 'paleta') {
      const rampa = rampaDaPaleta(this.paleta());
      if (rampa.length < 2) avisar('A paleta atual precisa de pelo menos 2 cores para o modo rampa.', 'alerta');
      return (x, y, i) => {
        if (tocados.has(i)) return null;
        tocados.add(i);
        return pixels[i] >>> 24 ? passoNaPaleta(pixels[i], rampa, direcao) : null;
      };
    }
    const passo = (direcao * this.estado.intensidadeSombra) / 100;
    return (x, y, i) => {
      if (tocados.has(i)) return null;
      tocados.add(i);
      return pixels[i] >>> 24 ? passoDeLuz(pixels[i], passo) : null;
    };
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
        let primeiro = true;
        linha(a.ultimo.x, a.ultimo.y, q.x, q.y, (x, y) => {
          if (primeiro) {
            primeiro = false;
            return;
          }
          this.carimbar(a.traco, x, y, a.cor);
          if (a.pixelPerfect) this.filtrarCanto(a, x, y);
        });
        a.ultimo = q;
      }
      this.editor.emitir('pixels');
    } else if (a.tipo === 'selecao') {
      if (p.x !== a.inicio.x || p.y !== a.inicio.y) a.arrastou = true;
      a.fim = p;
      this.atualizarSelecao(e);
    } else if (a.tipo === 'moverPixels') {
      this.atualizarMovimento(p.x - a.inicio.x, p.y - a.inicio.y);
    } else if (a.tipo === 'degrade') {
      let { x, y } = p;
      if (e.shiftKey) [x, y] = restringir(a.inicio.x, a.inicio.y, x, y, 'linha');
      if (x !== a.fim.x || y !== a.fim.y) {
        a.fim = { x, y };
        if (!a.pedido) {
          a.pedido = requestAnimationFrame(() => {
            a.pedido = 0;
            if (this.ativo === a) this.atualizarDegrade();
          });
        }
      }
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
    if (a.tipo === 'traco' || a.tipo === 'degrade' || a.tipo === 'moverPixels') {
      if (cancelado) {
        a.traco.desfazerVisual();
        if (a.tipo === 'moverPixels') this.editor.definirSelecao(a.selecaoOriginal);
        this.editor.emitir('pixels');
        return;
      }
      if (a.tipo === 'traco') {
        this.ultimoPonto = a.ultimo;
        this.editor.concluirTraco(a.traco, ROTULOS[this.estado.ferramenta] ?? 'Pincel');
        if (typeof a.cor === 'number') this.editor.lembrarCor(a.cor);
      } else if (a.tipo === 'degrade') {
        if (a.pedido) cancelAnimationFrame(a.pedido);
        if (a.fim.x === a.inicio.x && a.fim.y === a.inicio.y) {
          // Clique sem arrastar: não há direção para o degradê, então nada é pintado.
          a.traco.desfazerVisual();
          this.editor.emitir('pixels');
          avisar('Arraste de onde o degradê começa até onde ele termina.', 'info', 1600);
          return;
        }
        this.ativo = a;
        this.atualizarDegrade();
        this.ativo = null;
        this.editor.concluirTraco(a.traco, 'Degradê pontilhado');
      } else {
        this.concluirMovimento(a);
      }
    } else if (a.tipo === 'selecao') {
      if (cancelado) {
        this.editor.definirSelecao(a.anterior);
        return;
      }
      if (!a.arrastou) this.editor.definirSelecao(null);
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

  // Dentro da matriz e, se houver seleção, dentro dela: as ferramentas de pintura só mexem aí.
  dentro(x, y) {
    const d = this.editor.doc;
    return x >= 0 && y >= 0 && x < d.largura && y < d.altura && contem(this.editor.selecao, x, y);
  }

  carimbar(traco, x, y, cor) {
    const d = this.editor.doc;
    const pontos = pincel(this.estado.tamanho, this.estado.forma);
    const funcao = typeof cor === 'function';
    for (const [dx, dy] of pontos) {
      for (const [px, py] of espelhos(x + dx, y + dy, d.largura, d.altura, this.estado.simetria)) {
        if (!this.dentro(px, py)) continue;
        const i = py * d.largura + px;
        const c = funcao ? cor(px, py, i) : cor;
        if (c !== null && c !== undefined) traco.pintar(i, c);
      }
    }
  }

  // Pixel perfect: desfaz o pixel do meio quando os três últimos formam um canto em L.
  filtrarCanto(a, x, y) {
    a.pontos.push([x, y]);
    if (a.pontos.length < 3) return;
    const [p0, p1, p2] = a.pontos.slice(-3);
    if (cantoEmL(p0, p1, p2)) {
      const d = this.editor.doc;
      for (const [px, py] of espelhos(p1[0], p1[1], d.largura, d.altura, this.estado.simetria)) {
        const i = py * d.largura + px;
        if (a.traco.originais.has(i)) a.traco.pixels[i] = a.traco.originais.get(i);
      }
      a.pontos.splice(-2, 1);
    }
    if (a.pontos.length > 3) a.pontos.splice(0, a.pontos.length - 3);
  }

  atualizarSelecao(e) {
    const a = this.ativo;
    const d = this.editor.doc;
    let [x1, y1] = [a.fim.x, a.fim.y];
    if (e?.shiftKey) [x1, y1] = restringir(a.inicio.x, a.inicio.y, x1, y1, 'quadrado');
    const r = retanguloDe(a.inicio.x, a.inicio.y, x1, y1, d.largura, d.altura);
    this.editor.definirSelecao(r);
    if (r) this.editor.emitir('forma', { largura: r.largura, altura: r.altura });
  }

  // Mover pixels trabalha com um conteúdo "flutuante": a região levantada (ou colada) e o fundo que fica
  // por baixo dela. Enquanto nada mais mudar no documento, arrastos e setas seguidos reaproveitam os
  // dois, então levar o conteúdo para fora da borda e trazer de volta não perde pixels e a colagem
  // nunca arrasta nem fura o fundo.
  iniciarMovimento(p) {
    const traco = this.editor.novoTraco();
    if (!traco) return null;
    const d = this.editor.doc;
    const f = this.editor.flutuanteValido();
    let area;
    let regiaoMovida;
    let fundo;
    if (f) {
      regiaoMovida = f.regiao;
      fundo = f.fundo;
      area = { x: f.x, y: f.y, largura: f.regiao.largura, altura: f.regiao.altura };
    } else {
      area = this.editor.selecaoRecortada ?? { x: 0, y: 0, largura: d.largura, altura: d.altura };
      regiaoMovida = extrairRegiao(traco.pixels, d.largura, area);
      fundo = traco.pixels.slice();
      for (let y = area.y; y < area.y + area.altura; y++) fundo.fill(0, y * d.largura + area.x, y * d.largura + area.x + area.largura);
    }
    this.ativo = { tipo: 'moverPixels', traco, area, regiao: regiaoMovida, fundo, inicio: p, dx: 0, dy: 0, selecaoOriginal: this.editor.selecao };
    return this.ativo;
  }

  atualizarMovimento(dx, dy, a = this.ativo) {
    if (dx === a.dx && dy === a.dy) return;
    a.dx = dx;
    a.dy = dy;
    const d = this.editor.doc;
    const { traco, area, fundo } = a;
    traco.desfazerVisual();
    const r = recortarAoDocumento(area, d.largura, d.altura);
    if (r) {
      for (let y = r.y; y < r.y + r.altura; y++) {
        for (let x = r.x; x < r.x + r.largura; x++) {
          const i = y * d.largura + x;
          traco.pintar(i, fundo[i]);
        }
      }
    }
    colarRegiao(a.regiao, d.largura, d.altura, area.x + dx, area.y + dy, (i, c) => traco.pintar(i, c), { somenteOpacos: true });
    if (a.selecaoOriginal) this.editor.definirSelecao({ ...area, x: area.x + dx, y: area.y + dy }, { manterFlutuante: true });
    this.editor.emitir('deslocamento', { dx, dy });
    this.editor.emitir('pixels');
  }

  concluirMovimento(a) {
    this.editor.concluirTraco(a.traco, 'Mover pixels');
    this.editor.flutuante = {
      chave: a.traco.chave,
      regiao: a.regiao,
      fundo: a.fundo,
      x: a.area.x + a.dx,
      y: a.area.y + a.dy,
      versao: this.editor.historico.versao,
    };
  }

  // Setas do teclado com a ferramenta Mover pixels: desloca 1 px (ou 8 px com Shift) num único passo.
  empurrar(dx, dy) {
    if (this.ativo) return;
    const a = this.iniciarMovimento({ x: 0, y: 0 });
    if (!a) return;
    this.ativo = null;
    this.atualizarMovimento(dx, dy, a);
    this.concluirMovimento(a);
  }

  atualizarDegrade() {
    const a = this.ativo;
    const d = this.editor.doc;
    a.traco.desfazerVisual();
    const [inicio, fim] = a.botao === 2 ? [this.estado.corSecundaria, this.estado.corPrimaria] : [this.estado.corPrimaria, this.estado.corSecundaria];
    const sel = this.editor.selecaoRecortada;
    const indices = sel ? indicesDe(sel, d.largura, d.altura) : null;
    const pares = degrade(d.largura, d.altura, {
      ax: a.inicio.x,
      ay: a.inicio.y,
      bx: a.fim.x,
      by: a.fim.y,
      tipo: this.estado.tipoDegrade,
      matriz: Number(this.estado.matrizDegrade) || 4,
      inicio,
      fim,
      indices,
    });
    for (const [i, cor] of pares) a.traco.pintar(i, cor);
    this.editor.emitir('forma', { largura: Math.abs(a.fim.x - a.inicio.x) + 1, altura: Math.abs(a.fim.y - a.inicio.y) + 1 });
    this.editor.emitir('pixels');
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
    const sel = this.editor.selecao;
    if (sel && !contem(sel, p.x, p.y)) {
      traco.desfazerVisual();
      return;
    }
    for (const [x, y] of espelhos(p.x, p.y, d.largura, d.altura, this.estado.simetria)) {
      const fonte = this.estado.amostra === 'todas' ? d.compor(this.editor.estado.quadro) : this.editor.celulaAtiva();
      for (const i of regiao(fonte, d.largura, d.altura, x, y, opcoes)) {
        if (sel && !contem(sel, i % d.largura, (i / d.largura) | 0)) continue;
        traco.pintar(i, cor);
      }
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
