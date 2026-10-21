import { serializar, desserializar, nomeDeArquivo } from './nucleo/formato.js';
import { corParaHex } from './nucleo/cores.js';
import { Editor } from './ui/editor.js';
import { Visor } from './ui/visor.js';
import { Controlador, FERRAMENTAS } from './ui/ferramentas.js';
import { PainelCor, PainelPaleta, PainelTons, PainelCamadas, LinhaDoTempo } from './ui/paineis.js';
import { ArmazenamentoServidor, ArmazenamentoLocal, guardarRascunho, lerRascunho } from './ui/armazenamento.js';
import {
  dialogoNovo,
  dialogoRedimensionar,
  dialogoExportarImagem,
  dialogoFolha,
  dialogoExportarDados,
  dialogoImportarImagem,
  dialogoProjetos,
  dialogoAtalhos,
  dialogoSobre,
} from './ui/dialogos.js';
import { confirmar } from './ui/dialogo.js';
import { icone } from './ui/icones.js';
import { miniatura } from './ui/imagem.js';
import { el, $, avisar, baixarTexto, escolherArquivo, formatarBytes, atrasar, lerPreferencia, gravarPreferencia } from './ui/util.js';

const VERSAO = '1.0.0';

const editor = new Editor();
let armazenamento = new ArmazenamentoLocal();
const visor = new Visor($('#visor'), editor);
const controlador = new Controlador(editor, visor);

function aplicarTema(tema) {
  const efetivo = tema === 'sistema' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro') : tema;
  document.documentElement.dataset.tema = efetivo;
  const botao = $('#tema');
  if (botao) {
    botao.innerHTML = icone(efetivo === 'escuro' ? 'sol' : 'lua', 18);
    botao.setAttribute('aria-label', efetivo === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro');
    botao.title = botao.getAttribute('aria-label');
  }
  visor.lerCores();
}

function montarFerramentas() {
  const barra = $('#ferramentas');
  barra.replaceChildren(
    ...FERRAMENTAS.map((f) =>
      el('button', {
        type: 'button',
        class: 'ferramenta',
        dados: { ferramenta: f.id },
        title: `${f.nome} (${f.atalho})`,
        'aria-label': `${f.nome} (${f.atalho})`,
        html: icone(f.icone, 22),
        onclick: () => editor.definir('ferramenta', f.id),
      }),
    ),
  );
  const marcar = () => {
    for (const b of barra.children) {
      const ativo = b.dataset.ferramenta === editor.estado.ferramenta;
      b.classList.toggle('ativa', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    }
    $('#visor').dataset.ferramenta = editor.estado.ferramenta;
  };
  editor.ao('estado', ({ chave }) => {
    if (chave === 'ferramenta') {
      marcar();
      montarOpcoes();
    }
  });
  marcar();
}

function grupoOpcao(rotulo, ...conteudo) {
  return el('label', { class: 'opcao' }, el('span', {}, rotulo), ...conteudo);
}

function selectEstado(chave, opcoes, rotulo) {
  const s = el('select', { 'aria-label': rotulo }, opcoes.map(([v, t]) => el('option', { value: v, selected: String(editor.estado[chave]) === String(v) }, t)));
  s.addEventListener('change', () => editor.definir(chave, typeof editor.estado[chave] === 'number' ? +s.value : s.value));
  return s;
}

function montarOpcoes() {
  const barra = $('#opcoes');
  const f = FERRAMENTAS.find((x) => x.id === editor.estado.ferramenta);
  const itens = [el('strong', { class: 'nome-ferramenta' }, f.nome)];
  for (const op of f.opcoes) {
    if (op === 'tamanho') {
      const r = el('input', { type: 'range', min: 1, max: 16, value: editor.estado.tamanho, 'aria-label': 'Tamanho do pincel' });
      const o = el('output', { class: 'mono' }, `${editor.estado.tamanho}px`);
      r.addEventListener('input', () => {
        editor.definir('tamanho', +r.value);
        o.textContent = `${r.value}px`;
      });
      itens.push(grupoOpcao('Tamanho', r, o));
    } else if (op === 'forma') {
      itens.push(grupoOpcao('Ponta', selectEstado('forma', [['quadrado', 'Quadrada'], ['circulo', 'Redonda']], 'Formato da ponta')));
    } else if (op === 'modoBorracha') {
      itens.push(grupoOpcao('Apaga para', selectEstado('modoBorracha', [['transparente', 'Transparente'], ['fundo', 'Cor secundária']], 'Modo da borracha')));
    } else if (op === 'conectividade') {
      itens.push(grupoOpcao('Vizinhos', selectEstado('conectividade', [[4, '4 (lados)'], [8, '8 (com diagonais)']], 'Conectividade')));
    } else if (op === 'tolerancia') {
      const r = el('input', { type: 'range', min: 0, max: 100, value: editor.estado.tolerancia, 'aria-label': 'Tolerância' });
      const o = el('output', { class: 'mono' }, `${editor.estado.tolerancia}%`);
      r.addEventListener('input', () => {
        editor.definir('tolerancia', +r.value);
        o.textContent = `${r.value}%`;
      });
      itens.push(grupoOpcao('Tolerância', r, o));
    } else if (op === 'contiguo') {
      const c = el('input', { type: 'checkbox', checked: editor.estado.contiguo });
      c.addEventListener('change', () => editor.definir('contiguo', c.checked));
      itens.push(el('label', { class: 'opcao' }, c, el('span', {}, 'Só a área contígua')));
    } else if (op === 'amostra') {
      itens.push(grupoOpcao('Ler de', selectEstado('amostra', [['camada', 'Camada atual'], ['todas', 'Todas as camadas']], 'Amostragem')));
    } else if (op === 'preenchido') {
      const c = el('input', { type: 'checkbox', checked: editor.estado.preenchido });
      c.addEventListener('change', () => editor.definir('preenchido', c.checked));
      itens.push(el('label', { class: 'opcao' }, c, el('span', {}, 'Preenchido')));
    }
  }
  if (f.id === 'retangulo' || f.id === 'elipse' || f.id === 'linha') itens.push(el('span', { class: 'dica-opcao' }, f.id === 'linha' ? 'Shift: 45°' : 'Shift: proporção 1:1 · Alt: do centro'));
  barra.replaceChildren(...itens);
}

function montarVisao() {
  const barra = $('#visao');
  const simetria = el(
    'select',
    { 'aria-label': 'Simetria' },
    [['nenhuma', 'Sem simetria'], ['horizontal', 'Espelho horizontal'], ['vertical', 'Espelho vertical'], ['ambas', 'Horizontal e vertical']].map(([v, t]) => el('option', { value: v, selected: editor.estado.simetria === v }, t)),
  );
  simetria.addEventListener('change', () => editor.definir('simetria', simetria.value));
  const grade = el('button', { type: 'button', class: 'botao-icone', title: 'Grade (G)', 'aria-label': 'Grade', html: icone('grade', 18), onclick: () => editor.definir('grade', !editor.estado.grade) });
  const zoom = el('output', { class: 'mono zoom' });
  barra.replaceChildren(
    el('span', { class: 'icone-rotulo', html: icone('simetria', 18), title: 'Simetria (M)' }),
    simetria,
    grade,
    el('span', { class: 'separador' }),
    el('button', { type: 'button', class: 'botao-icone', title: 'Afastar (-)', 'aria-label': 'Afastar', html: icone('menos', 16), onclick: () => visor.passoZoom(-1) }),
    zoom,
    el('button', { type: 'button', class: 'botao-icone', title: 'Aproximar (+)', 'aria-label': 'Aproximar', html: icone('mais', 16), onclick: () => visor.passoZoom(1) }),
    el('button', { type: 'button', class: 'botao-icone', title: 'Ajustar à tela (0)', 'aria-label': 'Ajustar à tela', html: icone('ajustar', 16), onclick: () => visor.ajustar() }),
  );
  const atualizar = () => {
    simetria.value = editor.estado.simetria;
    grade.classList.toggle('ligado', editor.estado.grade);
    grade.setAttribute('aria-pressed', String(editor.estado.grade));
    zoom.textContent = `${visor.zoom * 100}%`;
  };
  editor.ao('estado', atualizar);
  editor.ao('zoom', atualizar);
  atualizar();
}

const COMANDOS = {
  novo: { rotulo: 'Novo projeto…', atalho: '', fn: () => dialogoNovo(editor) },
  abrirSalvos: { rotulo: 'Projetos salvos…', atalho: '', fn: () => dialogoProjetos(editor, armazenamento, abrirProjeto) },
  abrirArquivo: { rotulo: 'Abrir arquivo .crivo…', atalho: 'Ctrl+O', fn: abrirArquivo },
  importarImagem: { rotulo: 'Importar imagem ou sprite sheet…', atalho: '', fn: () => dialogoImportarImagem(editor) },
  salvar: { rotulo: 'Salvar', atalho: 'Ctrl+S', fn: () => salvar() },
  salvarComo: { rotulo: 'Salvar como cópia', atalho: '', fn: () => salvar(true) },
  baixarCrivo: { rotulo: 'Baixar arquivo .crivo', atalho: '', fn: baixarCrivo },
  exportarImagem: { rotulo: 'Exportar imagem (PNG/JPEG)…', atalho: 'Ctrl+E', fn: () => dialogoExportarImagem(editor) },
  exportarFolha: { rotulo: 'Exportar sprite sheet…', atalho: '', fn: () => dialogoFolha(editor) },
  exportarDados: { rotulo: 'Exportar dados (JSON, CSV, código)…', atalho: 'Ctrl+Shift+E', fn: () => dialogoExportarDados(editor, paleta.atual) },
  desfazer: { rotulo: 'Desfazer', atalho: 'Ctrl+Z', fn: () => editor.desfazer() },
  refazer: { rotulo: 'Refazer', atalho: 'Ctrl+Y', fn: () => editor.refazer() },
  limparCamada: {
    rotulo: 'Limpar camada',
    atalho: 'Delete',
    fn: () => {
      if (!editor.podeEditarCamada()) return;
      editor.estrutura('Limpar camada', () => editor.celulaAtiva().fill(0));
    },
  },
  espelharH: { rotulo: 'Espelhar camada na horizontal', atalho: '', fn: () => espelharCamada('horizontal') },
  espelharV: { rotulo: 'Espelhar camada na vertical', atalho: '', fn: () => espelharCamada('vertical') },
  tamanho: { rotulo: 'Tamanho da matriz…', atalho: 'Ctrl+Alt+C', fn: () => dialogoRedimensionar(editor) },
  girarDireita: { rotulo: 'Girar 90° à direita', atalho: '', fn: () => girar(1) },
  girarEsquerda: { rotulo: 'Girar 90° à esquerda', atalho: '', fn: () => girar(-1) },
  grade: { rotulo: 'Mostrar grade', atalho: 'G', marcado: () => editor.estado.grade, fn: () => editor.definir('grade', !editor.estado.grade) },
  cebola: { rotulo: 'Papel cebola', atalho: 'K', marcado: () => editor.estado.cebola, fn: () => editor.definir('cebola', !editor.estado.cebola) },
  aproximar: { rotulo: 'Aproximar', atalho: '+', fn: () => visor.passoZoom(1) },
  afastar: { rotulo: 'Afastar', atalho: '-', fn: () => visor.passoZoom(-1) },
  ajustar: { rotulo: 'Ajustar à tela', atalho: '0', fn: () => visor.ajustar() },
  zoom100: { rotulo: 'Tamanho real (100%)', atalho: '1', fn: () => (visor.definirZoom(1), visor.centralizar()) },
  tema: { rotulo: 'Alternar tema claro/escuro', atalho: '', fn: alternarTema },
  atalhos: { rotulo: 'Atalhos do teclado', atalho: '?', fn: () => dialogoAtalhos() },
  sobre: { rotulo: 'Sobre o Crivo', atalho: '', fn: () => dialogoSobre(VERSAO, armazenamento) },
};

const MENUS = [
  ['Arquivo', ['novo', 'abrirSalvos', 'abrirArquivo', 'importarImagem', '-', 'salvar', 'salvarComo', 'baixarCrivo', '-', 'exportarImagem', 'exportarFolha', 'exportarDados']],
  ['Editar', ['desfazer', 'refazer', '-', 'limparCamada', 'espelharH', 'espelharV']],
  ['Imagem', ['tamanho', 'girarDireita', 'girarEsquerda']],
  ['Exibir', ['grade', 'cebola', '-', 'aproximar', 'afastar', 'ajustar', 'zoom100', '-', 'tema']],
  ['Ajuda', ['atalhos', 'sobre']],
];

function executar(id) {
  const c = COMANDOS[id];
  if (!c) return;
  Promise.resolve()
    .then(() => c.fn())
    .catch((erro) => avisar(erro.message || String(erro), 'erro', 5000));
}

function montarMenus() {
  const barra = $('#menus');
  let aberto = null;
  const fechar = () => {
    if (!aberto) return;
    aberto.menu.hidden = true;
    aberto.botao.setAttribute('aria-expanded', 'false');
    aberto = null;
  };
  for (const [titulo, itens] of MENUS) {
    const menu = el('div', { class: 'menu', role: 'menu', hidden: true });
    const botao = el('button', { type: 'button', class: 'menu-botao', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, titulo);
    const preencher = () =>
      menu.replaceChildren(
        ...itens.map((id) => {
          if (id === '-') return el('hr');
          const c = COMANDOS[id];
          const marcado = c.marcado ? c.marcado() : null;
          return el(
            'button',
            {
              type: 'button',
              role: marcado === null ? 'menuitem' : 'menuitemcheckbox',
              'aria-checked': marcado === null ? null : String(marcado),
              class: 'menu-item',
              onclick: () => {
                fechar();
                executar(id);
              },
            },
            el('span', { class: 'marca' }, marcado ? '✓' : ''),
            el('span', {}, c.rotulo),
            el('kbd', {}, c.atalho),
          );
        }),
      );
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      const mesmo = aberto?.menu === menu;
      fechar();
      if (mesmo) return;
      preencher();
      menu.hidden = false;
      botao.setAttribute('aria-expanded', 'true');
      aberto = { menu, botao };
      menu.querySelector('.menu-item')?.focus();
    });
    botao.addEventListener('mouseenter', () => {
      if (aberto && aberto.menu !== menu) botao.click();
    });
    menu.addEventListener('keydown', (e) => {
      const itensFoco = [...menu.querySelectorAll('.menu-item')];
      const i = itensFoco.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') itensFoco[(i + 1) % itensFoco.length].focus();
      else if (e.key === 'ArrowUp') itensFoco[(i - 1 + itensFoco.length) % itensFoco.length].focus();
      else if (e.key === 'Escape') {
        fechar();
        botao.focus();
      } else return;
      e.preventDefault();
    });
    barra.append(el('div', { class: 'menu-grupo' }, botao, menu));
  }
  document.addEventListener('click', fechar);
}

function espelharCamada(eixo) {
  if (!editor.podeEditarCamada()) return;
  editor.estrutura(eixo === 'horizontal' ? 'Espelhar na horizontal' : 'Espelhar na vertical', (d) => d.espelharCelula(editor.celulaAtiva(), eixo));
}

function girar(sentido) {
  editor.estrutura(sentido > 0 ? 'Girar à direita' : 'Girar à esquerda', (d) => d.girar(sentido));
  visor.ajustar();
}

function alternarTema() {
  const atual = document.documentElement.dataset.tema;
  const novo = atual === 'escuro' ? 'claro' : 'escuro';
  gravarPreferencia('tema', novo);
  aplicarTema(novo);
}

function dadosDoProjeto() {
  const doc = editor.doc;
  doc.paleta = paleta.atual.cores.slice(0, 256);
  return {
    nome: doc.nome,
    dados: serializar(doc),
    miniatura: miniatura(doc.compor(0), doc.largura, doc.altura, 128),
  };
}

async function salvar(copia = false) {
  const base = dadosDoProjeto();
  try {
    if (armazenamento.tipo === 'servidor') {
      let r;
      const id = copia ? null : editor.projeto.id;
      try {
        r = await armazenamento.salvarProjeto({ ...base, id, revisao: editor.projeto.revisao });
      } catch (erro) {
        if (erro.status !== 409) throw erro;
        const sobrescrever = await confirmar('Projeto alterado em outro lugar', 'Este projeto foi salvo por outra aba ou pessoa depois que você o abriu. Salvar por cima mesmo assim? A outra versão continua no histórico de versões.', 'Salvar por cima');
        if (!sobrescrever) return;
        r = await armazenamento.salvarProjeto({ ...base, id, revisao: null });
      }
      editor.marcarSalvo({ id: r.id, revisao: r.revisao, local: null });
    } else {
      const r = await armazenamento.salvarProjeto({ ...base, id: copia ? null : editor.projeto.local });
      editor.marcarSalvo({ local: r.id, id: null, revisao: null });
    }
    avisar(`"${editor.doc.nome}" salvo em ${armazenamento.nome}.`, 'sucesso');
  } catch (erro) {
    avisar('Não foi possível salvar: ' + erro.message, 'erro', 6000);
  }
}

async function abrirProjeto(id) {
  if (editor.modificado && !(await confirmar('Abrir outro projeto', 'As mudanças não salvas deste projeto serão perdidas.', 'Abrir mesmo assim', true))) return;
  try {
    const p = await armazenamento.abrirProjeto(id);
    const doc = desserializar(p.dados);
    editor.carregar(doc, armazenamento.tipo === 'servidor' ? { id: p.id, revisao: p.revisao, local: null } : { id: null, revisao: null, local: p.id });
    avisar(`"${doc.nome}" aberto.`, 'sucesso');
  } catch (erro) {
    avisar('Não foi possível abrir: ' + erro.message, 'erro', 6000);
  }
}

async function abrirArquivo() {
  const arquivo = await escolherArquivo('.crivo,.json,application/json');
  if (!arquivo) return;
  if (editor.modificado && !(await confirmar('Abrir arquivo', 'As mudanças não salvas deste projeto serão perdidas.', 'Abrir mesmo assim', true))) return;
  try {
    const doc = desserializar(await arquivo.text());
    editor.carregar(doc);
    avisar(`"${doc.nome}" aberto.`, 'sucesso');
  } catch (erro) {
    avisar('Arquivo inválido: ' + erro.message, 'erro', 6000);
  }
}

function baixarCrivo() {
  const { dados } = dadosDoProjeto();
  baixarTexto(JSON.stringify(dados), nomeDeArquivo(editor.doc.nome, 'crivo'), 'application/json');
}

function montarNome() {
  const input = $('#nome-projeto');
  const atualizar = () => {
    if (document.activeElement !== input) input.value = editor.doc.nome;
    document.title = `${editor.modificado ? '• ' : ''}${editor.doc.nome} · Crivo`;
  };
  input.addEventListener('change', () => {
    const v = input.value.trim().slice(0, 120) || 'Sem título';
    if (v === editor.doc.nome) return;
    editor.estrutura('Renomear projeto', (d) => {
      d.nome = v;
    });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  editor.ao('documento', atualizar);
  editor.ao('historico', atualizar);
  atualizar();
}

function montarHistorico() {
  const desfazer = $('#desfazer');
  const refazer = $('#refazer');
  desfazer.innerHTML = icone('desfazer', 18);
  refazer.innerHTML = icone('refazer', 18);
  desfazer.addEventListener('click', () => editor.desfazer());
  refazer.addEventListener('click', () => editor.refazer());
  const atualizar = () => {
    const h = editor.historico;
    desfazer.disabled = !h.podeDesfazer;
    refazer.disabled = !h.podeRefazer;
    desfazer.title = h.podeDesfazer ? `Desfazer: ${h.proximoDesfazer} (Ctrl+Z)` : 'Nada para desfazer';
    refazer.title = h.podeRefazer ? `Refazer: ${h.proximoRefazer} (Ctrl+Y)` : 'Nada para refazer';
    desfazer.setAttribute('aria-label', desfazer.title);
    refazer.setAttribute('aria-label', refazer.title);
    $('#status-historico').textContent = `Histórico: ${h.passado.length} ${h.passado.length === 1 ? 'ação' : 'ações'} · ${formatarBytes(h.bytes)}`;
  };
  editor.ao('historico', atualizar);
  atualizar();
  $('#salvar').innerHTML = icone('disco', 18);
  $('#salvar').addEventListener('click', () => salvar());
}

function montarStatus() {
  const pos = $('#status-posicao');
  const cor = $('#status-cor');
  const tam = $('#status-tamanho');
  const zoom = $('#status-zoom');
  editor.ao('ponteiro', (p) => {
    if (!p) {
      pos.textContent = '–';
      cor.textContent = '';
      cor.style.removeProperty('--cor');
      return;
    }
    pos.textContent = `${p.x}, ${p.y}`;
    const c = editor.doc.compor(editor.estado.quadro)[p.y * editor.doc.largura + p.x];
    cor.textContent = c >>> 24 ? corParaHex(c) : 'transparente';
    cor.style.setProperty('--cor', corParaHex(c, true));
  });
  editor.ao('forma', ({ largura, altura }) => (pos.textContent = `${largura} × ${altura}`));
  const tamanho = () => (tam.textContent = `${editor.doc.largura} × ${editor.doc.altura} · ${editor.doc.quadros.length} quadro(s) · ${editor.doc.camadas.length} camada(s)`);
  editor.ao('documento', tamanho);
  editor.ao('zoom', ({ zoom: z }) => (zoom.textContent = `${z * 100}%`));
  editor.ao('amostra', ({ cor: c }) => {
    if (!c) avisar('Esse pixel está transparente.', 'info', 1200);
  });
  tamanho();
}

function atualizarArmazenamento() {
  const s = $('#status-armazenamento');
  s.replaceChildren(el('span', { class: 'icone-rotulo', html: icone(armazenamento.tipo === 'servidor' ? 'nuvem' : 'pasta', 14) }), armazenamento.tipo === 'servidor' ? ' Servidor Django' : ' Modo local (navegador)');
  s.title = armazenamento.tipo === 'servidor' ? 'Projetos e paletas salvos no banco de dados do servidor' : 'Sem servidor: projetos ficam no IndexedDB deste navegador';
}

function atalhos(e) {
  const alvo = e.target;
  if (alvo instanceof HTMLElement && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return;
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) executar('desfazer');
    else if (k === 'y' || (k === 'z' && e.shiftKey)) executar('refazer');
    else if (k === 's') executar('salvar');
    else if (k === 'o') executar('abrirArquivo');
    else if (k === 'e') executar(e.shiftKey ? 'exportarDados' : 'exportarImagem');
    else if (k === 'c' && e.altKey) executar('tamanho');
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const ferramenta = FERRAMENTAS.find((f) => f.atalho.toLowerCase() === k);
  if (ferramenta) editor.definir('ferramenta', ferramenta.id);
  else if (k === 'x') editor.trocarCores();
  else if (k === 'g') executar('grade');
  else if (k === 'k') executar('cebola');
  else if (k === 'm') {
    const modos = ['nenhuma', 'horizontal', 'vertical', 'ambas'];
    const novo = modos[(modos.indexOf(editor.estado.simetria) + 1) % modos.length];
    editor.definir('simetria', novo);
    avisar(`Simetria: ${{ nenhuma: 'desligada', horizontal: 'horizontal', vertical: 'vertical', ambas: 'horizontal e vertical' }[novo]}`, 'info', 1000);
  } else if (k === '[' || k === ']') {
    editor.definir('tamanho', Math.max(1, Math.min(16, editor.estado.tamanho + (k === ']' ? 1 : -1))));
    if (['lapis', 'borracha', 'linha'].includes(editor.estado.ferramenta)) montarOpcoes();
  } else if (k === '+' || k === '=') visor.passoZoom(1);
  else if (k === '-' || k === '_') visor.passoZoom(-1);
  else if (k === '0') visor.ajustar();
  else if (k === '1') executar('zoom100');
  else if (k === ',') editor.selecionarQuadro(editor.estado.quadro - 1);
  else if (k === '.') editor.selecionarQuadro(editor.estado.quadro + 1);
  else if (k === 'enter') editor.estado.tocando ? editor.parar() : editor.tocar();
  else if (k === 'delete' || k === 'backspace') executar('limparCamada');
  else if (k === '?') executar('atalhos');
  else if (k === 'escape') controlador.cancelar();
  else return;
  e.preventDefault();
}

const paleta = new PainelPaleta($('#painel-paleta'), editor, () => armazenamento);
new PainelCor($('#painel-cor'), editor);
new PainelTons($('#painel-tons'), editor, paleta);
new PainelCamadas($('#painel-camadas'), editor);
new LinhaDoTempo($('#linha-tempo'), editor);

const autosalvar = atrasar(() => {
  const doc = editor.doc;
  guardarRascunho({ dados: serializar(doc), projeto: editor.projeto, modificado: editor.modificado, quando: new Date().toISOString() });
}, 1200);
editor.ao('historico', autosalvar);
editor.ao('salvo', autosalvar);

async function iniciar() {
  aplicarTema(lerPreferencia('tema', 'sistema'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (lerPreferencia('tema', 'sistema') === 'sistema') aplicarTema('sistema');
  });
  $('#tema').addEventListener('click', alternarTema);
  $('#logo').innerHTML = icone('logo', 22);
  montarFerramentas();
  montarOpcoes();
  montarVisao();
  montarMenus();
  montarNome();
  montarHistorico();
  montarStatus();
  atualizarArmazenamento();
  window.addEventListener('keydown', atalhos);
  window.addEventListener('beforeunload', () => {
    autosalvar.cancelar();
    guardarRascunho({ dados: serializar(editor.doc), projeto: editor.projeto, modificado: editor.modificado, quando: new Date().toISOString() });
  });
  const rascunho = await lerRascunho();
  if (rascunho?.dados) {
    try {
      const doc = desserializar(rascunho.dados);
      editor.carregar(doc, rascunho.projeto);
      editor.modificado = Boolean(rascunho.modificado);
      editor.emitir('historico');
    } catch {
      avisar('O rascunho anterior não pôde ser recuperado.', 'alerta');
    }
  }
  const servidor = await ArmazenamentoServidor.detectar();
  if (servidor) {
    armazenamento = servidor;
    atualizarArmazenamento();
    paleta.carregar();
  }
  document.body.classList.add('pronto');
}

iniciar();

window.crivo = { editor, visor, versao: VERSAO };
