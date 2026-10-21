import { Documento } from '../nucleo/documento.js';
import { Historico, Traco } from '../nucleo/historico.js';
import { hexParaCor, corParaHex } from '../nucleo/cores.js';
import { avisar, lerPreferencia, gravarPreferencia } from './util.js';

const PREFERENCIAS = ['ferramenta', 'tamanho', 'forma', 'simetria', 'grade', 'preenchido', 'conectividade', 'tolerancia', 'contiguo', 'amostra', 'modoBorracha', 'cebola', 'paleta'];

export class Editor extends EventTarget {
  constructor() {
    super();
    this.historico = new Historico();
    this.estado = {
      ferramenta: 'lapis',
      corPrimaria: hexParaCor('#5d1c16'),
      corSecundaria: hexParaCor('#e6ddce'),
      tamanho: 1,
      forma: 'quadrado',
      simetria: 'nenhuma',
      grade: true,
      preenchido: false,
      conectividade: 4,
      tolerancia: 0,
      contiguo: true,
      amostra: 'camada',
      modoBorracha: 'transparente',
      cebola: false,
      paleta: 'crivo',
      quadro: 0,
      camadaId: null,
      tocando: false,
    };
    for (const k of PREFERENCIAS) this.estado[k] = lerPreferencia(k, this.estado[k]);
    this.recentes = lerPreferencia('recentes', []).map(hexParaCor).filter((c) => c !== null);
    this.projeto = { id: null, local: null, revisao: null };
    this.modificado = false;
    this.versaoSalva = 0;
    this.carregar(new Documento(32, 32, { nome: 'Sem título' }));
  }

  emitir(tipo, detalhe = {}) {
    this.dispatchEvent(new CustomEvent(tipo, { detail: detalhe }));
  }

  ao(tipo, fn) {
    this.addEventListener(tipo, (e) => fn(e.detail));
  }

  carregar(doc, projeto = { id: null, local: null, revisao: null }) {
    this.doc = doc;
    this.projeto = { ...projeto };
    this.historico.limpar();
    this.estado.quadro = 0;
    this.estado.camadaId = doc.camadas.at(-1).id;
    this.modificado = false;
    this.versaoSalva = this.historico.versao;
    this.emitir('documento', { novo: true });
    this.emitir('historico');
  }

  get quadroAtual() {
    return this.doc.quadros[Math.min(this.estado.quadro, this.doc.quadros.length - 1)];
  }

  get camadaAtual() {
    return this.doc.camada(this.estado.camadaId) ?? this.doc.camadas.at(-1);
  }

  get chaveAtiva() {
    return this.doc.chave(this.quadroAtual.id, this.camadaAtual.id);
  }

  celulaAtiva() {
    return this.doc.celula(this.quadroAtual.id, this.camadaAtual.id);
  }

  definir(chave, valor) {
    if (this.estado[chave] === valor) return;
    this.estado[chave] = valor;
    if (PREFERENCIAS.includes(chave)) gravarPreferencia(chave, valor);
    this.emitir('estado', { chave, valor });
  }

  definirCor(qual, cor) {
    const chave = qual === 'secundaria' ? 'corSecundaria' : 'corPrimaria';
    this.estado[chave] = cor >>> 0;
    this.emitir('cor', { qual });
  }

  trocarCores() {
    [this.estado.corPrimaria, this.estado.corSecundaria] = [this.estado.corSecundaria, this.estado.corPrimaria];
    this.emitir('cor', { qual: 'ambas' });
  }

  lembrarCor(cor) {
    if (!(cor >>> 24)) return;
    this.recentes = [cor, ...this.recentes.filter((c) => c !== cor)].slice(0, 16);
    gravarPreferencia('recentes', this.recentes.map((c) => corParaHex(c, true)));
    this.emitir('recentes');
  }

  podeEditarCamada(avisarUsuario = true) {
    const c = this.camadaAtual;
    if (c.bloqueada) {
      if (avisarUsuario) avisar(`A camada "${c.nome}" está bloqueada.`, 'alerta');
      return false;
    }
    if (!c.visivel) {
      if (avisarUsuario) avisar(`A camada "${c.nome}" está oculta. Mostre a camada para desenhar nela.`, 'alerta');
      return false;
    }
    return true;
  }

  novoTraco() {
    if (this.estado.tocando) this.parar();
    if (!this.podeEditarCamada()) return null;
    return new Traco(this.chaveAtiva, this.celulaAtiva());
  }

  concluirTraco(traco, rotulo) {
    const entrada = traco.concluir(rotulo);
    if (!entrada) return false;
    this.historico.registrar(entrada, { quadro: this.estado.quadro, camadaId: this.estado.camadaId });
    this.marcarModificado();
    this.emitir('pixels', { miniaturas: true });
    return true;
  }

  estrutura(rotulo, fn) {
    if (this.estado.tocando) this.parar();
    const antes = this.doc.instantaneo();
    let resultado;
    try {
      resultado = fn(this.doc);
    } catch (erro) {
      this.doc.restaurar(antes);
      throw erro;
    }
    if (resultado === false) return false;
    this.historico.registrarEstado(rotulo, antes, this.doc.instantaneo(), { quadro: this.estado.quadro, camadaId: this.estado.camadaId });
    this.corrigirSelecao();
    this.marcarModificado();
    this.emitir('documento');
    return resultado ?? true;
  }

  corrigirSelecao() {
    if (this.estado.quadro >= this.doc.quadros.length) this.estado.quadro = this.doc.quadros.length - 1;
    if (!this.doc.camada(this.estado.camadaId)) this.estado.camadaId = this.doc.camadas.at(-1).id;
  }

  marcarModificado() {
    this.modificado = true;
    this.emitir('historico');
  }

  desfazer() {
    if (this.estado.tocando) this.parar();
    const e = this.historico.desfazer(this.doc);
    if (!e) return;
    this.aposViagem(e);
    avisar(`Desfeito: ${e.rotulo}`, 'info', 1400);
  }

  refazer() {
    if (this.estado.tocando) this.parar();
    const e = this.historico.refazer(this.doc);
    if (!e) return;
    this.aposViagem(e);
    avisar(`Refeito: ${e.rotulo}`, 'info', 1400);
  }

  aposViagem(e) {
    if (e.contexto && e.tipo !== 'estado') {
      this.estado.quadro = e.contexto.quadro;
      if (this.doc.camada(e.contexto.camadaId)) this.estado.camadaId = e.contexto.camadaId;
    }
    this.corrigirSelecao();
    this.modificado = this.historico.versao !== this.versaoSalva;
    this.emitir(e.tipo === 'estado' ? 'documento' : 'pixels', { miniaturas: true });
    this.emitir('historico');
  }

  marcarSalvo(projeto) {
    this.projeto = { ...this.projeto, ...projeto };
    this.modificado = false;
    this.versaoSalva = this.historico.versao;
    this.emitir('historico');
    this.emitir('salvo');
  }

  selecionarQuadro(i) {
    this.estado.quadro = Math.max(0, Math.min(this.doc.quadros.length - 1, i));
    this.emitir('quadro');
    this.emitir('pixels');
  }

  selecionarCamada(id) {
    this.estado.camadaId = id;
    this.emitir('camada');
  }

  tocar() {
    if (this.estado.tocando || this.doc.quadros.length < 2) return;
    this.estado.tocando = true;
    this.quadroAntesDeTocar = this.estado.quadro;
    const passo = () => {
      if (!this.estado.tocando) return;
      this.estado.quadro = (this.estado.quadro + 1) % this.doc.quadros.length;
      this.emitir('quadro');
      this.emitir('pixels');
      const q = this.quadroAtual;
      this.temporizador = setTimeout(passo, q.duracao || 1000 / this.doc.fps);
    };
    this.temporizador = setTimeout(passo, this.quadroAtual.duracao || 1000 / this.doc.fps);
    this.emitir('estado', { chave: 'tocando', valor: true });
  }

  parar() {
    if (!this.estado.tocando) return;
    clearTimeout(this.temporizador);
    this.estado.tocando = false;
    this.estado.quadro = this.quadroAntesDeTocar ?? this.estado.quadro;
    this.emitir('estado', { chave: 'tocando', valor: false });
    this.emitir('quadro');
    this.emitir('pixels');
  }
}
