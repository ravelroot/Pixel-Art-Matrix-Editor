import { corParaHex, corParaHex6, hexParaCor, comAlfa, alfa, gerarTons } from '../nucleo/cores.js';
import { PALETAS_PREDEFINIDAS, normalizarPaleta, importarPaleta, exportarPaleta, extrairPaleta } from '../nucleo/paletas.js';
import { nomeDeArquivo } from '../nucleo/formato.js';
import { el, avisar, escolherArquivo, baixarTexto, atrasar, lerPreferencia, gravarPreferencia } from './util.js';
import { icone } from './icones.js';
import { criarCanvas, pixelsParaCanvas } from './imagem.js';
import { perguntarTexto, confirmar, abrirDialogo } from './dialogo.js';

function amostra(cor, { titulo, aoClicar, aoDireito, ativa = false, classe = '' } = {}) {
  const b = el('button', {
    type: 'button',
    class: `amostra ${classe} ${ativa ? 'ativa' : ''}`,
    title: titulo ?? corParaHex(cor),
    'aria-label': titulo ?? corParaHex(cor),
    estilo: { '--cor': corParaHex(cor, true) },
  });
  if (aoClicar) b.addEventListener('click', aoClicar);
  if (aoDireito)
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      aoDireito(e);
    });
  return b;
}

function botaoIcone(nome, rotulo, acao, extra = {}) {
  return el('button', { type: 'button', class: 'botao-icone', title: rotulo, 'aria-label': rotulo, html: icone(nome, 16), onclick: acao, ...extra });
}

export class PainelCor {
  constructor(raiz, editor) {
    this.editor = editor;
    this.seletor = el('input', { type: 'color', class: 'invisivel', tabindex: -1, 'aria-hidden': 'true' });
    this.alvo = 'primaria';
    this.primaria = el('button', { type: 'button', class: 'cor-grande primaria', title: 'Cor principal (clique esquerdo)', onclick: () => this.abrirSeletor('primaria') });
    this.secundaria = el('button', { type: 'button', class: 'cor-grande secundaria', title: 'Cor secundária (clique direito)', onclick: () => this.abrirSeletor('secundaria') });
    this.hex = el('input', { type: 'text', class: 'hex', maxlength: 9, spellcheck: 'false', 'aria-label': 'Código hexadecimal da cor principal' });
    this.alfa = el('input', { type: 'range', min: 0, max: 255, 'aria-label': 'Opacidade da cor principal' });
    this.alfaValor = el('output', { class: 'mono' });
    this.recentes = el('div', { class: 'amostras recentes', 'aria-label': 'Cores recentes' });
    raiz.append(
      el(
        'div',
        { class: 'cor-linha' },
        el('div', { class: 'cores-par' }, this.secundaria, this.primaria, el('button', { type: 'button', class: 'botao-icone trocar', title: 'Trocar cores (X)', 'aria-label': 'Trocar cores', html: icone('trocar', 14), onclick: () => editor.trocarCores() })),
        el('div', { class: 'cor-campos' }, el('label', { class: 'campo compacto' }, el('span', {}, 'Hex'), this.hex), el('label', { class: 'campo compacto' }, el('span', {}, 'Alfa'), this.alfa, this.alfaValor)),
      ),
      el('div', { class: 'rotulo-pequeno' }, 'Recentes'),
      this.recentes,
      this.seletor,
    );
    this.seletor.addEventListener('input', () => {
      const atual = this.alvo === 'secundaria' ? editor.estado.corSecundaria : editor.estado.corPrimaria;
      editor.definirCor(this.alvo, comAlfa(hexParaCor(this.seletor.value), alfa(atual) || 255));
    });
    this.seletor.addEventListener('change', () => editor.lembrarCor(this.alvo === 'secundaria' ? editor.estado.corSecundaria : editor.estado.corPrimaria));
    this.hex.addEventListener('change', () => {
      const c = hexParaCor(this.hex.value);
      if (c === null) {
        avisar('Use um código como #5d1c16 ou #5d1c16cc.', 'alerta');
        this.atualizar();
        return;
      }
      editor.definirCor('primaria', c);
      editor.lembrarCor(c);
    });
    this.alfa.addEventListener('input', () => editor.definirCor('primaria', comAlfa(editor.estado.corPrimaria, +this.alfa.value)));
    editor.ao('cor', () => this.atualizar());
    editor.ao('recentes', () => this.atualizarRecentes());
    this.atualizar();
    this.atualizarRecentes();
  }

  abrirSeletor(qual) {
    this.alvo = qual;
    const c = qual === 'secundaria' ? this.editor.estado.corSecundaria : this.editor.estado.corPrimaria;
    this.seletor.value = corParaHex6(c);
    this.seletor.click();
  }

  atualizar() {
    const { corPrimaria: p, corSecundaria: s } = this.editor.estado;
    this.primaria.style.setProperty('--cor', corParaHex(p, true));
    this.secundaria.style.setProperty('--cor', corParaHex(s, true));
    this.primaria.setAttribute('aria-label', `Cor principal ${corParaHex(p)}`);
    this.secundaria.setAttribute('aria-label', `Cor secundária ${corParaHex(s)}`);
    if (document.activeElement !== this.hex) this.hex.value = corParaHex(p);
    this.alfa.value = alfa(p);
    this.alfaValor.textContent = Math.round((alfa(p) / 255) * 100) + '%';
  }

  atualizarRecentes() {
    this.recentes.replaceChildren(
      ...this.editor.recentes.map((c) =>
        amostra(c, {
          aoClicar: () => this.editor.definirCor('primaria', c),
          aoDireito: () => this.editor.definirCor('secundaria', c),
        }),
      ),
    );
    if (!this.editor.recentes.length) this.recentes.append(el('span', { class: 'vazio' }, 'As cores usadas aparecem aqui.'));
  }
}

export class PainelPaleta {
  constructor(raiz, editor, obterArmazenamento) {
    this.editor = editor;
    this.obterArmazenamento = obterArmazenamento;
    this.minhas = [];
    this.select = el('select', { 'aria-label': 'Paleta' });
    this.grade = el('div', { class: 'amostras paleta' });
    this.info = el('div', { class: 'rotulo-pequeno paleta-info' });
    const acoes = el(
      'div',
      { class: 'acoes-linha' },
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.adicionarCorAtual(), title: 'Adicionar a cor principal à paleta' }, '+ Cor'),
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.nova() }, 'Nova'),
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.doDesenho(), title: 'Cria uma paleta com as cores usadas no projeto' }, 'Do desenho'),
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.importar() }, 'Importar'),
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.exportar() }, 'Exportar'),
      el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.renomear(), dados: { soMinhas: '1' } }, 'Renomear'),
      el('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => this.excluir(), dados: { soMinhas: '1' } }, 'Excluir'),
    );
    this.acoes = acoes;
    raiz.append(this.select, this.grade, this.info, acoes);
    this.select.addEventListener('change', () => {
      editor.definir('paleta', this.select.value);
      this.desenhar();
    });
    editor.ao('cor', () => this.marcarAtiva());
    this.carregar();
  }

  get todas() {
    return [...PALETAS_PREDEFINIDAS.map((p) => normalizarPaleta({ ...p, id: p.slug, predefinida: true })), ...this.minhas];
  }

  get atual() {
    return this.todas.find((p) => p.id === this.editor.estado.paleta) ?? this.todas[0];
  }

  async carregar() {
    try {
      const lista = await this.obterArmazenamento().listarPaletas();
      this.minhas = lista.map((p) => normalizarPaleta({ ...p, predefinida: false }));
    } catch (erro) {
      avisar('Não foi possível carregar as paletas salvas: ' + erro.message, 'erro');
    }
    this.montarSelect();
    this.desenhar();
  }

  montarSelect() {
    const grupo = (rotulo, lista) => el('optgroup', { label: rotulo }, lista.map((p) => el('option', { value: p.id, selected: p.id === this.atual.id }, `${p.nome} (${p.cores.length})`)));
    this.select.replaceChildren(grupo('Predefinidas', this.todas.filter((p) => p.predefinida)));
    if (this.minhas.length) this.select.append(grupo('Minhas paletas', this.minhas));
    this.select.value = this.atual.id;
  }

  desenhar() {
    const p = this.atual;
    this.grade.replaceChildren(
      ...p.cores.map((c, i) =>
        amostra(c, {
          titulo: `${corParaHex(c)} (${i + 1})${p.predefinida ? '' : ' · Ctrl+clique remove'}`,
          aoClicar: (e) => {
            if ((e.ctrlKey || e.metaKey) && !p.predefinida) return this.removerCor(i);
            this.editor.definirCor('primaria', c);
          },
          aoDireito: () => this.editor.definirCor('secundaria', c),
        }),
      ),
    );
    this.info.textContent = p.descricao || (p.predefinida ? '' : 'Clique esquerdo escolhe a cor principal, direito a secundária. Ctrl+clique remove a cor.');
    for (const b of this.acoes.querySelectorAll('[data-so-minhas]')) b.disabled = p.predefinida;
    this.marcarAtiva();
  }

  marcarAtiva() {
    const p = this.atual;
    const botoes = this.grade.children;
    p.cores.forEach((c, i) => botoes[i]?.classList.toggle('ativa', c === this.editor.estado.corPrimaria));
  }

  async salvar(p) {
    const salvo = await this.obterArmazenamento().salvarPaleta({ id: p.predefinida ? null : p.id, nome: p.nome, cores: p.cores.map((c) => corParaHex(c)) });
    const normal = normalizarPaleta({ ...salvo, predefinida: false });
    const i = this.minhas.findIndex((x) => x.id === normal.id || x.id === p.id);
    if (i >= 0) this.minhas[i] = normal;
    else this.minhas.push(normal);
    this.editor.definir('paleta', normal.id);
    this.montarSelect();
    this.desenhar();
    return normal;
  }

  async garantirEditavel() {
    const p = this.atual;
    if (!p.predefinida) return p;
    const nome = await perguntarTexto('Copiar paleta', 'As paletas predefinidas não mudam. Nome da sua cópia:', `${p.nome} (minha)`);
    if (!nome) return null;
    return this.salvar({ nome, cores: [...p.cores], predefinida: false });
  }

  async adicionarCores(cores) {
    const p = await this.garantirEditavel();
    if (!p) return;
    const novas = cores.filter((c) => !p.cores.includes(c));
    if (!novas.length) {
      avisar('Essas cores já estão na paleta.');
      return;
    }
    await this.salvar({ ...p, cores: [...p.cores, ...novas] });
    avisar(novas.length === 1 ? 'Cor adicionada à paleta.' : `${novas.length} cores adicionadas à paleta.`, 'sucesso');
  }

  adicionarCorAtual() {
    return this.adicionarCores([this.editor.estado.corPrimaria]);
  }

  async removerCor(i) {
    const p = this.atual;
    await this.salvar({ ...p, cores: p.cores.filter((_, k) => k !== i) });
  }

  async nova() {
    const nome = await perguntarTexto('Nova paleta', 'Nome da paleta', 'Minha paleta');
    if (!nome) return;
    await this.salvar({ nome, cores: [this.editor.estado.corPrimaria, this.editor.estado.corSecundaria].filter((c) => c >>> 24), predefinida: false });
    avisar('Paleta criada. Use "+ Cor" ou o gerador de tons para preencher.', 'sucesso');
  }

  async doDesenho() {
    const cores = extrairPaleta(this.editor.doc.quadros.flatMap((_, i) => [...this.editor.doc.compor(i)]), 256);
    if (!cores.length) {
      avisar('O desenho ainda não tem cores.', 'alerta');
      return;
    }
    const nome = await perguntarTexto('Paleta do desenho', `${cores.length} cores encontradas. Nome da paleta:`, `Cores de ${this.editor.doc.nome}`);
    if (!nome) return;
    await this.salvar({ nome, cores, predefinida: false });
  }

  async importar() {
    const arquivo = await escolherArquivo('.hex,.gpl,.json,.txt,.csv');
    if (!arquivo) return;
    try {
      const { nome, cores } = importarPaleta(await arquivo.text(), arquivo.name);
      await this.salvar({ nome, cores, predefinida: false });
      avisar(`Paleta "${nome}" importada com ${cores.length} cores.`, 'sucesso');
    } catch (erro) {
      avisar('Não deu para importar: ' + erro.message, 'erro');
    }
  }

  async exportar() {
    const p = this.atual;
    const select = el('select', {}, el('option', { value: 'hex' }, '.hex (uma cor por linha, Lospec)'), el('option', { value: 'gpl' }, '.gpl (GIMP, Aseprite, Krita)'), el('option', { value: 'json' }, '.json'));
    const formato = await abrirDialogo({
      titulo: `Exportar "${p.nome}"`,
      corpo: el('label', { class: 'campo' }, el('span', {}, 'Formato'), select),
      acoes: [
        { rotulo: 'Cancelar', valor: null },
        { rotulo: 'Baixar', primario: true, enviar: true, acao: () => select.value },
      ],
    });
    if (!formato) return;
    baixarTexto(exportarPaleta(p, formato), nomeDeArquivo(p.nome, formato));
  }

  async renomear() {
    const p = this.atual;
    if (p.predefinida) return;
    const nome = await perguntarTexto('Renomear paleta', 'Novo nome', p.nome);
    if (nome) await this.salvar({ ...p, nome });
  }

  async excluir() {
    const p = this.atual;
    if (p.predefinida) return;
    if (!(await confirmar('Excluir paleta', `A paleta "${p.nome}" será apagada.`, 'Excluir', true))) return;
    await this.obterArmazenamento().excluirPaleta(p.id);
    this.minhas = this.minhas.filter((x) => x.id !== p.id);
    this.editor.definir('paleta', 'crivo');
    this.montarSelect();
    this.desenhar();
  }
}

export class PainelTons {
  constructor(raiz, editor, painelPaleta) {
    this.editor = editor;
    this.painelPaleta = painelPaleta;
    const prefs = lerPreferencia('tons', { passos: 3, intensidade: 80, desvio: 18 });
    this.passos = el('input', { type: 'range', min: 1, max: 6, value: prefs.passos, 'aria-label': 'Tons para cada lado' });
    this.intensidade = el('input', { type: 'range', min: 10, max: 100, value: prefs.intensidade, 'aria-label': 'Intensidade' });
    this.desvio = el('input', { type: 'range', min: 0, max: 60, value: prefs.desvio, 'aria-label': 'Desvio de matiz' });
    this.saidas = { passos: el('output', { class: 'mono' }), intensidade: el('output', { class: 'mono' }), desvio: el('output', { class: 'mono' }) };
    this.rampa = el('div', { class: 'amostras rampa' });
    raiz.append(
      this.rampa,
      el('label', { class: 'campo compacto' }, el('span', {}, 'Passos'), this.passos, this.saidas.passos),
      el('label', { class: 'campo compacto' }, el('span', {}, 'Alcance'), this.intensidade, this.saidas.intensidade),
      el('label', { class: 'campo compacto', title: 'Sombras puxam para o azul e luzes para o amarelo, como na pintura de pixel art' }, el('span', {}, 'Matiz'), this.desvio, this.saidas.desvio),
      el('div', { class: 'acoes-linha' }, el('button', { type: 'button', class: 'botao pequeno', onclick: () => this.painelPaleta.adicionarCores(this.cores) }, 'Adicionar à paleta')),
    );
    for (const i of [this.passos, this.intensidade, this.desvio]) {
      i.addEventListener('input', () => {
        gravarPreferencia('tons', { passos: +this.passos.value, intensidade: +this.intensidade.value, desvio: +this.desvio.value });
        this.atualizar();
      });
    }
    editor.ao('cor', ({ qual }) => {
      if (qual !== 'secundaria' && !this.escolhendo) this.atualizar();
    });
    this.atualizar();
  }

  atualizar() {
    const base = this.editor.estado.corPrimaria;
    this.saidas.passos.textContent = this.passos.value;
    this.saidas.intensidade.textContent = this.intensidade.value + '%';
    this.saidas.desvio.textContent = this.desvio.value + '°';
    const { rampa } = gerarTons(base, { passos: +this.passos.value, intensidade: +this.intensidade.value / 100, desvioMatiz: +this.desvio.value });
    this.cores = rampa;
    this.rampa.replaceChildren(
      ...rampa.map((c) =>
        amostra(c, {
          classe: c === base ? 'base' : '',
          aoClicar: () => {
            this.escolhendo = true;
            this.editor.definirCor('primaria', c);
            this.escolhendo = false;
            this.marcar(c);
          },
          aoDireito: () => this.editor.definirCor('secundaria', c),
        }),
      ),
    );
    this.marcar(base);
  }

  marcar(c) {
    [...this.rampa.children].forEach((b, i) => b.classList.toggle('ativa', this.cores[i] === c));
  }
}

export class PainelCamadas {
  constructor(raiz, editor) {
    this.editor = editor;
    this.lista = el('ol', { class: 'lista-camadas', 'aria-label': 'Camadas, da mais alta para a mais baixa' });
    this.opacidade = el('input', { type: 'range', min: 0, max: 100, 'aria-label': 'Opacidade da camada' });
    this.opacidadeValor = el('output', { class: 'mono' });
    raiz.append(
      this.lista,
      el('label', { class: 'campo compacto' }, el('span', {}, 'Opacidade'), this.opacidade, this.opacidadeValor),
      el(
        'div',
        { class: 'acoes-linha icones' },
        botaoIcone('mais', 'Nova camada', () => this.acao('Nova camada', (d) => editor.selecionarCamada(d.adicionarCamada(null, d.indiceCamada(editor.camadaAtual.id) + 1).id))),
        botaoIcone('duplicar', 'Duplicar camada', () => this.acao('Duplicar camada', (d) => editor.selecionarCamada(d.duplicarCamada(editor.camadaAtual.id).id))),
        botaoIcone('cima', 'Subir camada', () => this.acao('Subir camada', (d) => d.moverCamada(editor.camadaAtual.id, 1))),
        botaoIcone('baixo', 'Descer camada', () => this.acao('Descer camada', (d) => d.moverCamada(editor.camadaAtual.id, -1))),
        botaoIcone('mesclar', 'Mesclar com a de baixo', () => this.acao('Mesclar camadas', (d) => d.mesclarAbaixo(editor.camadaAtual.id))),
        botaoIcone('lixeira', 'Excluir camada', () => this.excluir()),
      ),
    );
    const salvarOpacidade = atrasar((id, antes, valor) => {
      const camada = editor.doc.camada(id);
      if (!camada) return;
      camada.opacidade = antes;
      editor.estrutura('Opacidade da camada', (d) => {
        d.camada(id).opacidade = valor;
      });
    }, 400);
    this.opacidade.addEventListener('input', () => {
      const c = editor.camadaAtual;
      if (this.opacidadeOriginal === undefined || this.opacidadeId !== c.id) {
        this.opacidadeOriginal = c.opacidade;
        this.opacidadeId = c.id;
      }
      c.opacidade = +this.opacidade.value;
      this.opacidadeValor.textContent = c.opacidade + '%';
      editor.emitir('pixels');
      salvarOpacidade(c.id, this.opacidadeOriginal, c.opacidade);
    });
    this.opacidade.addEventListener('change', () => {
      this.opacidadeOriginal = undefined;
    });
    editor.ao('documento', () => this.desenhar());
    editor.ao('camada', () => this.desenhar());
    editor.ao('quadro', () => this.agendarMiniaturas());
    editor.ao('pixels', ({ miniaturas }) => {
      if (miniaturas) this.agendarMiniaturas();
    });
    this.agendarMiniaturas = atrasar(() => this.miniaturas(), 120);
    this.desenhar();
  }

  acao(rotulo, fn) {
    try {
      this.editor.estrutura(rotulo, fn);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async excluir() {
    const d = this.editor.doc;
    if (d.camadas.length <= 1) {
      avisar('O projeto precisa de pelo menos uma camada.', 'alerta');
      return;
    }
    this.acao('Excluir camada', (doc) => doc.removerCamada(this.editor.camadaAtual.id));
  }

  desenhar() {
    const { doc } = this.editor;
    const atual = this.editor.camadaAtual;
    this.lista.replaceChildren(
      ...[...doc.camadas].reverse().map((c) => {
        const nome = el('span', { class: 'nome', title: 'Clique duas vezes para renomear' }, c.nome);
        const mini = criarCanvas(28, 28);
        mini.className = 'mini';
        mini.dataset.camada = c.id;
        const item = el(
          'li',
          { class: `camada ${c.id === atual.id ? 'ativa' : ''} ${c.visivel ? '' : 'oculta'}`, tabindex: 0, 'aria-current': c.id === atual.id ? 'true' : null },
          el('button', {
            type: 'button',
            class: 'botao-icone',
            title: c.visivel ? 'Ocultar' : 'Mostrar',
            'aria-label': (c.visivel ? 'Ocultar ' : 'Mostrar ') + c.nome,
            html: icone(c.visivel ? 'olho' : 'olhoFechado', 16),
            onclick: (e) => {
              e.stopPropagation();
              this.acao(c.visivel ? 'Ocultar camada' : 'Mostrar camada', (d) => {
                d.camada(c.id).visivel = !c.visivel;
              });
            },
          }),
          mini,
          nome,
          c.opacidade < 100 ? el('span', { class: 'etiqueta' }, c.opacidade + '%') : null,
          el('button', {
            type: 'button',
            class: `botao-icone ${c.bloqueada ? 'ligado' : 'apagado'}`,
            title: c.bloqueada ? 'Desbloquear' : 'Bloquear',
            'aria-label': (c.bloqueada ? 'Desbloquear ' : 'Bloquear ') + c.nome,
            html: icone(c.bloqueada ? 'cadeado' : 'cadeadoAberto', 16),
            onclick: (e) => {
              e.stopPropagation();
              this.acao(c.bloqueada ? 'Desbloquear camada' : 'Bloquear camada', (d) => {
                d.camada(c.id).bloqueada = !c.bloqueada;
              });
            },
          }),
        );
        item.addEventListener('click', () => this.editor.selecionarCamada(c.id));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.editor.selecionarCamada(c.id);
        });
        nome.addEventListener('dblclick', async () => {
          const novo = await perguntarTexto('Renomear camada', 'Nome da camada', c.nome);
          if (novo)
            this.acao('Renomear camada', (d) => {
              d.camada(c.id).nome = novo;
            });
        });
        return item;
      }),
    );
    this.opacidade.value = atual.opacidade;
    this.opacidadeValor.textContent = atual.opacidade + '%';
    this.miniaturas();
  }

  miniaturas() {
    const { doc } = this.editor;
    const q = this.editor.quadroAtual;
    for (const canvas of this.lista.querySelectorAll('canvas.mini')) {
      const id = canvas.dataset.camada;
      if (!doc.camada(id)) continue;
      desenharMiniatura(canvas, doc.celula(q.id, id), doc.largura, doc.altura);
    }
  }
}

export function desenharMiniatura(canvas, pixels, largura, altura) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const escala = Math.min(canvas.width / largura, canvas.height / altura);
  const l = largura * escala;
  const a = altura * escala;
  ctx.imageSmoothingEnabled = escala < 1;
  ctx.drawImage(pixelsParaCanvas(pixels, largura, altura), (canvas.width - l) / 2, (canvas.height - a) / 2, l, a);
}

export class LinhaDoTempo {
  constructor(raiz, editor) {
    this.editor = editor;
    this.lista = el('ol', { class: 'lista-quadros', 'aria-label': 'Quadros da animação' });
    this.tocar = el('button', { type: 'button', class: 'botao-icone grande', title: 'Tocar animação (Enter)', 'aria-label': 'Tocar animação', onclick: () => (editor.estado.tocando ? editor.parar() : editor.tocar()) });
    this.fps = el('input', { type: 'number', min: 1, max: 60, class: 'fps', 'aria-label': 'Quadros por segundo' });
    this.cebola = el('button', { type: 'button', class: 'botao-icone', title: 'Papel cebola: mostra o quadro anterior (K)', 'aria-label': 'Papel cebola', html: icone('cebola', 16), onclick: () => editor.definir('cebola', !editor.estado.cebola) });
    const acao = (rotulo, fn) => {
      try {
        editor.estrutura(rotulo, fn);
      } catch (erro) {
        avisar(erro.message, 'erro');
      }
    };
    raiz.append(
      el(
        'div',
        { class: 'tempo-controles' },
        this.tocar,
        el('label', { class: 'campo compacto fps-campo' }, el('span', {}, 'FPS'), this.fps),
        this.cebola,
        el('span', { class: 'separador' }),
        botaoIcone('mais', 'Novo quadro', () =>
          acao('Novo quadro', (d) => {
            d.adicionarQuadro(editor.estado.quadro + 1);
            editor.estado.quadro += 1;
          }),
        ),
        botaoIcone('duplicar', 'Duplicar quadro', () =>
          acao('Duplicar quadro', (d) => {
            d.duplicarQuadro(editor.quadroAtual.id);
            editor.estado.quadro += 1;
          }),
        ),
        botaoIcone('esquerda', 'Mover quadro para a esquerda', () =>
          acao('Mover quadro', (d) => {
            if (!d.moverQuadro(editor.quadroAtual.id, -1)) return false;
            editor.estado.quadro -= 1;
          }),
        ),
        botaoIcone('direita', 'Mover quadro para a direita', () =>
          acao('Mover quadro', (d) => {
            if (!d.moverQuadro(editor.quadroAtual.id, 1)) return false;
            editor.estado.quadro += 1;
          }),
        ),
        botaoIcone('lixeira', 'Excluir quadro', () => {
          if (editor.doc.quadros.length <= 1) return avisar('A animação precisa de pelo menos um quadro.', 'alerta');
          acao('Excluir quadro', (d) => d.removerQuadro(editor.quadroAtual.id));
        }),
      ),
      this.lista,
    );
    this.fps.addEventListener('change', () => {
      const v = Math.max(1, Math.min(60, Math.round(+this.fps.value) || 8));
      acao('Velocidade da animação', (d) => {
        d.fps = v;
      });
    });
    editor.ao('documento', () => this.desenhar());
    editor.ao('quadro', () => this.marcar());
    editor.ao('estado', ({ chave }) => {
      if (chave === 'tocando' || chave === 'cebola') this.atualizarBotoes();
    });
    editor.ao('pixels', ({ miniaturas }) => {
      if (miniaturas) this.agendar();
    });
    this.agendar = atrasar(() => this.miniaturas(), 150);
    this.desenhar();
  }

  atualizarBotoes() {
    const tocando = this.editor.estado.tocando;
    this.tocar.innerHTML = icone(tocando ? 'pausar' : 'tocar', 18);
    this.tocar.setAttribute('aria-label', tocando ? 'Pausar' : 'Tocar animação');
    this.tocar.classList.toggle('ligado', tocando);
    this.cebola.classList.toggle('ligado', this.editor.estado.cebola);
    this.cebola.setAttribute('aria-pressed', String(this.editor.estado.cebola));
  }

  desenhar() {
    const { doc } = this.editor;
    this.fps.value = doc.fps;
    this.lista.replaceChildren(
      ...doc.quadros.map((q, i) => {
        const c = criarCanvas(48, 48);
        c.className = 'mini';
        const item = el('li', { class: 'quadro', tabindex: 0, title: `Quadro ${i + 1}` }, c, el('span', { class: 'numero' }, String(i + 1)));
        item.addEventListener('click', () => {
          this.editor.parar();
          this.editor.selecionarQuadro(i);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.editor.selecionarQuadro(i);
        });
        return item;
      }),
    );
    this.marcar();
    this.atualizarBotoes();
    this.miniaturas();
  }

  marcar() {
    [...this.lista.children].forEach((li, i) => {
      const ativo = i === this.editor.estado.quadro;
      li.classList.toggle('ativa', ativo);
      li.setAttribute('aria-current', ativo ? 'true' : 'false');
      if (ativo && this.editor.estado.tocando) li.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  miniaturas() {
    const { doc } = this.editor;
    [...this.lista.querySelectorAll('canvas.mini')].forEach((c, i) => {
      if (i < doc.quadros.length) desenharMiniatura(c, doc.compor(i), doc.largura, doc.altura);
    });
  }
}
