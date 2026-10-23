import { Documento } from '../nucleo/documento.js';
import { Historico, Traco } from '../nucleo/historico.js';
import { hexParaCor, corParaHex } from '../nucleo/cores.js';
import { recortarAoDocumento } from '../nucleo/selecao.js';
import { avisar, lerPreferencia, gravarPreferencia } from './util.js';

const PREFERENCIAS = [
  'ferramenta', 'tamanho', 'forma', 'simetria', 'grade', 'preenchido', 'conectividade', 'tolerancia', 'contiguo', 'amostra', 'modoBorracha', 'cebola', 'paleta',
  'pixelPerfect', 'densidade', 'fundoPontilhado', 'tipoDegrade', 'matrizDegrade', 'modoSombra', 'intensidadeSombra', 'gradeForte', 'ladrilho',
];

// Valores aceitos para cada preferência lida do localStorage (que pode ter sido editado à mão).
const PERMITIDOS = {
  forma: ['quadrado', 'circulo'],
  simetria: ['nenhuma', 'horizontal', 'vertical', 'ambas'],
  conectividade: [4, 8],
  amostra: ['camada', 'todas'],
  modoBorracha: ['transparente', 'fundo'],
  densidade: [12.5, 25, 37.5, 50, 62.5, 75, 87.5],
  fundoPontilhado: ['secundaria', 'manter'],
  tipoDegrade: ['linear', 'radial'],
  matrizDegrade: [2, 4, 8],
  modoSombra: ['paleta', 'luz'],
  gradeForte: [0, 4, 8, 16, 32],
};
const FAIXAS = { tamanho: [1, 32], tolerancia: [0, 100], intensidadeSombra: [2, 30] };
const BOOLEANOS = ['grade', 'preenchido', 'contiguo', 'cebola', 'pixelPerfect', 'ladrilho'];

function preferenciaValida(chave, valor) {
  if (chave === 'ferramenta') return FERRAMENTAS_VALIDAS.includes(valor);
  if (chave === 'paleta') return typeof valor === 'string' && valor.length <= 80;
  if (PERMITIDOS[chave]) return PERMITIDOS[chave].includes(valor);
  if (FAIXAS[chave]) return Number.isInteger(valor) && valor >= FAIXAS[chave][0] && valor <= FAIXAS[chave][1];
  if (BOOLEANOS.includes(chave)) return typeof valor === 'boolean';
  return false;
}

export const FERRAMENTAS_VALIDAS = ['lapis', 'borracha', 'balde', 'linha', 'retangulo', 'elipse', 'contaGotas', 'mover', 'selecao', 'moverPixels', 'pontilhado', 'degrade', 'sombra'];

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
      pixelPerfect: false,
      densidade: 50,
      fundoPontilhado: 'secundaria',
      tipoDegrade: 'linear',
      matrizDegrade: 4,
      modoSombra: 'paleta',
      intensidadeSombra: 8,
      gradeForte: 8,
      ladrilho: false,
      quadro: 0,
      camadaId: null,
      tocando: false,
    };
    for (const k of PREFERENCIAS) {
      const padrao = this.estado[k];
      const lido = lerPreferencia(k, padrao);
      this.estado[k] = preferenciaValida(k, lido) ? lido : padrao;
    }
    if (!FERRAMENTAS_VALIDAS.includes(this.estado.ferramenta)) this.estado.ferramenta = 'lapis';
    this.estado.tamanho = Math.max(1, Math.min(32, Math.round(this.estado.tamanho) || 1));
    this.selecao = null;
    this.flutuante = null;
    this.areaTransferencia = null;
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
    this.selecao = null;
    this.emitir('selecao', null);
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
    if (this.selecao) {
      const r = recortarAoDocumento(this.selecao, this.doc.largura, this.doc.altura);
      if (r?.x !== this.selecao.x || r?.y !== this.selecao.y || r?.largura !== this.selecao.largura || r?.altura !== this.selecao.altura) this.definirSelecao(r);
    }
  }

  definirSelecao(r, { manterFlutuante = false } = {}) {
    this.selecao = r ? { x: r.x, y: r.y, largura: r.largura, altura: r.altura } : null;
    if (!manterFlutuante) this.flutuante = null;
    this.emitir('selecao', this.selecao);
  }

  // A seleção pode sair da matriz enquanto o conteúdo flutua; comandos usam sempre a parte que cabe nela.
  get selecaoRecortada() {
    return this.selecao ? recortarAoDocumento(this.selecao, this.doc.largura, this.doc.altura) : null;
  }

  // Conteúdo levantado por Mover pixels ou por Colar, válido só se nada mudou no documento desde então.
  flutuanteValido() {
    const f = this.flutuante;
    if (!f || f.versao !== this.historico.versao || f.chave !== this.chaveAtiva) return null;
    return f;
  }

  // Aplica uma lista de pares [índice, cor] na célula ativa como um único passo do histórico.
  aplicarMudancas(rotulo, mudancas, { silencioso = false } = {}) {
    const traco = this.novoTraco();
    if (!traco) return false;
    for (const [i, cor] of mudancas) traco.pintar(i, cor);
    const ok = this.concluirTraco(traco, rotulo);
    if (!ok && !silencioso) avisar('Nada mudou.', 'info', 1200);
    return ok;
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
