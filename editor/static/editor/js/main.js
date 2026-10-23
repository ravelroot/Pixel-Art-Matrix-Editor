import { serializar, desserializar, nomeDeArquivo } from './nucleo/formato.js';
import { corParaHex } from './nucleo/cores.js';
import { extrairRegiao, colarRegiao, limitesDoConteudo, deslocarComRepeticao, indicesDe, contem } from './nucleo/selecao.js';
import { contorno, converterParaPaleta, inverter, tonsDeCinza } from './nucleo/filtros.js';
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

const VERSAO = '1.1.0';

const editor = new Editor();
let armazenamento = new ArmazenamentoLocal();
const visor = new Visor($('#visor'), editor);
const controlador = new Controlador(editor, visor);
controlador.paleta = () => paleta.atual.cores;

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
    } else if (chave === 'modoSombra') {
      montarOpcoes();
    } else if (FERRAMENTAS.find((f) => f.id === editor.estado.ferramenta)?.opcoes.includes(chave) && !$('#opcoes').contains(document.activeElement)) {
      // Mudança feita por atalho ou por código: redesenha a barra para mostrar o valor atual.
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
      const r = el('input', { type: 'range', min: 1, max: 32, value: editor.estado.tamanho, 'aria-label': 'Tamanho do pincel' });
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
    } else if (op === 'pixelPerfect') {
      const c = el('input', { type: 'checkbox', checked: editor.estado.pixelPerfect });
      c.addEventListener('change', () => editor.definir('pixelPerfect', c.checked));
      itens.push(el('label', { class: 'opcao', title: 'Remove os cantos em L dos traços de 1 px' }, c, el('span', {}, 'Pixel perfect')));
    } else if (op === 'densidade') {
      itens.push(grupoOpcao('Densidade', selectEstado('densidade', [[12.5, '12,5%'], [25, '25%'], [37.5, '37,5%'], [50, '50% (xadrez)'], [62.5, '62,5%'], [75, '75%'], [87.5, '87,5%']], 'Densidade do pontilhado')));
    } else if (op === 'fundoPontilhado') {
      itens.push(grupoOpcao('Fundo', selectEstado('fundoPontilhado', [['secundaria', 'Cor secundária'], ['manter', 'Manter o que há']], 'Fundo do pontilhado')));
    } else if (op === 'tipoDegrade') {
      itens.push(grupoOpcao('Tipo', selectEstado('tipoDegrade', [['linear', 'Linear'], ['radial', 'Radial']], 'Tipo de degradê')));
    } else if (op === 'matrizDegrade') {
      itens.push(grupoOpcao('Padrão', selectEstado('matrizDegrade', [[2, 'Bayer 2×2'], [4, 'Bayer 4×4'], [8, 'Bayer 8×8']], 'Matriz de Bayer')));
    } else if (op === 'modoSombra') {
      itens.push(grupoOpcao('Modo', selectEstado('modoSombra', [['paleta', 'Rampa da paleta'], ['luz', 'Luminosidade (OKLCH)']], 'Modo de clarear e escurecer')));
    } else if (op === 'intensidadeSombra' && editor.estado.modoSombra === 'luz') {
      const r = el('input', { type: 'range', min: 2, max: 30, value: editor.estado.intensidadeSombra, 'aria-label': 'Intensidade' });
      const o = el('output', { class: 'mono' }, `${editor.estado.intensidadeSombra}%`);
      r.addEventListener('input', () => {
        editor.definir('intensidadeSombra', +r.value);
        o.textContent = `${r.value}%`;
      });
      itens.push(grupoOpcao('Intensidade', r, o));
    } else if (op === 'preenchido') {
      const c = el('input', { type: 'checkbox', checked: editor.estado.preenchido });
      c.addEventListener('change', () => editor.definir('preenchido', c.checked));
      itens.push(el('label', { class: 'opcao' }, c, el('span', {}, 'Preenchido')));
    }
  }
  const DICAS = {
    linha: 'Shift: 45°',
    retangulo: 'Shift: proporção 1:1 · Alt: do centro',
    elipse: 'Shift: proporção 1:1 · Alt: do centro',
    pontilhado: 'Botão direito troca as cores',
    degrade: 'Arraste de onde começa até onde termina · botão direito inverte · Shift: 45°',
    sombra: 'Esquerdo clareia · direito escurece',
    selecao: 'Shift: quadrada · clique para desmarcar · Ctrl+C/X/V',
    moverPixels: 'Arraste ou use as setas (Shift: 8 px) · sem seleção move a camada toda',
  };
  if (DICAS[f.id]) itens.push(el('span', { class: 'dica-opcao' }, DICAS[f.id]));
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
  const gradeForte = el(
    'select',
    { 'aria-label': 'Linha forte da grade a cada', title: 'Linha forte da grade a cada N pixels' },
    [[0, 'Sem linha forte'], [4, 'Forte a cada 4'], [8, 'Forte a cada 8'], [16, 'Forte a cada 16'], [32, 'Forte a cada 32']].map(([v, t]) => el('option', { value: v, selected: editor.estado.gradeForte === v }, t)),
  );
  gradeForte.addEventListener('change', () => editor.definir('gradeForte', +gradeForte.value));
  const ladrilho = el('button', { type: 'button', class: 'botao-icone', title: 'Modo ladrilho (T)', 'aria-label': 'Modo ladrilho', html: icone('quadros', 18), onclick: () => editor.definir('ladrilho', !editor.estado.ladrilho) });
  const zoom = el('output', { class: 'mono zoom' });
  barra.replaceChildren(
    el('span', { class: 'icone-rotulo', html: icone('simetria', 18), title: 'Simetria (M)' }),
    simetria,
    grade,
    gradeForte,
    ladrilho,
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
    gradeForte.value = String(editor.estado.gradeForte);
    ladrilho.classList.toggle('ligado', editor.estado.ladrilho);
    ladrilho.setAttribute('aria-pressed', String(editor.estado.ladrilho));
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
  exportarImagem: { rotulo: 'Exportar imagem (PNG, JPEG ou GIF)…', atalho: 'Ctrl+E', fn: () => dialogoExportarImagem(editor) },
  exportarGif: { rotulo: 'Exportar GIF animado…', atalho: 'Ctrl+Shift+G', fn: () => dialogoExportarImagem(editor, 'gif') },
  exportarFolha: { rotulo: 'Exportar sprite sheet…', atalho: '', fn: () => dialogoFolha(editor) },
  exportarDados: { rotulo: 'Exportar dados (JSON, CSV, código)…', atalho: 'Ctrl+Shift+E', fn: () => dialogoExportarDados(editor, paleta.atual) },
  desfazer: { rotulo: 'Desfazer', atalho: 'Ctrl+Z', fn: () => editor.desfazer() },
  refazer: { rotulo: 'Refazer', atalho: 'Ctrl+Y', fn: () => editor.refazer() },
  selecionarTudo: { rotulo: 'Selecionar tudo', atalho: 'Ctrl+A', fn: () => editor.definirSelecao({ x: 0, y: 0, largura: editor.doc.largura, altura: editor.doc.altura }) },
  desmarcar: { rotulo: 'Desmarcar', atalho: 'Ctrl+D', fn: () => editor.definirSelecao(null) },
  copiar: { rotulo: 'Copiar', atalho: 'Ctrl+C', fn: () => copiar(false) },
  recortar: { rotulo: 'Recortar', atalho: 'Ctrl+X', fn: () => copiar(true) },
  colar: { rotulo: 'Colar', atalho: 'Ctrl+V', fn: colar },
  limparCamada: {
    rotulo: 'Apagar (seleção ou camada)',
    atalho: 'Delete',
    fn: () => {
      if (!editor.podeEditarCamada()) return;
      const sel = editor.selecaoRecortada;
      if (sel) {
        const d = editor.doc;
        editor.aplicarMudancas('Apagar seleção', [...indicesDe(sel, d.largura, d.altura)].map((i) => [i, 0]));
        return;
      }
      editor.estrutura('Limpar camada', () => editor.celulaAtiva().fill(0));
    },
  },
  espelharH: { rotulo: 'Espelhar na horizontal (seleção ou camada)', atalho: 'Shift+H', fn: () => espelharCamada('horizontal') },
  espelharV: { rotulo: 'Espelhar na vertical (seleção ou camada)', atalho: 'Shift+V', fn: () => espelharCamada('vertical') },
  substituirCor: { rotulo: 'Substituir a cor primária pela secundária (todos os quadros)', atalho: '', fn: substituirCor },
  tamanho: { rotulo: 'Tamanho da matriz…', atalho: 'Ctrl+Alt+C', fn: () => dialogoRedimensionar(editor) },
  girarDireita: { rotulo: 'Girar 90° à direita', atalho: '', fn: () => girar(1) },
  girarEsquerda: { rotulo: 'Girar 90° à esquerda', atalho: '', fn: () => girar(-1) },
  recortarSelecao: { rotulo: 'Recortar para a seleção', atalho: '', fn: recortarParaSelecao },
  aparar: { rotulo: 'Aparar bordas transparentes', atalho: '', fn: aparar },
  deslocarMetade: { rotulo: 'Deslocar meia matriz (ladrilho)', atalho: 'Shift+T', fn: deslocarMetade },
  contorno4: { rotulo: 'Adicionar contorno (4 vizinhos)', atalho: '', fn: () => filtrar('Contorno', (px, d, f) => contorno(px, d.largura, d.altura, editor.estado.corPrimaria, { vizinhos: 4, filtro: f })) },
  contorno8: { rotulo: 'Adicionar contorno (8 vizinhos)', atalho: '', fn: () => filtrar('Contorno', (px, d, f) => contorno(px, d.largura, d.altura, editor.estado.corPrimaria, { vizinhos: 8, filtro: f })) },
  paraPaleta: { rotulo: 'Converter para a paleta atual', atalho: '', fn: () => filtrar('Converter para a paleta', (px, d, f) => converterParaPaleta(px, paleta.atual.cores, { filtro: f })) },
  inverter: { rotulo: 'Inverter cores', atalho: '', fn: () => filtrar('Inverter cores', (px, d, f) => inverter(px, { filtro: f })) },
  cinza: { rotulo: 'Tons de cinza', atalho: '', fn: () => filtrar('Tons de cinza', (px, d, f) => tonsDeCinza(px, { filtro: f })) },
  grade: { rotulo: 'Mostrar grade', atalho: 'G', marcado: () => editor.estado.grade, fn: () => editor.definir('grade', !editor.estado.grade) },
  cebola: { rotulo: 'Papel cebola', atalho: 'K', marcado: () => editor.estado.cebola, fn: () => editor.definir('cebola', !editor.estado.cebola) },
  ladrilho: { rotulo: 'Modo ladrilho', atalho: 'T', marcado: () => editor.estado.ladrilho, fn: () => editor.definir('ladrilho', !editor.estado.ladrilho) },
  aproximar: { rotulo: 'Aproximar', atalho: '+', fn: () => visor.passoZoom(1) },
  afastar: { rotulo: 'Afastar', atalho: '-', fn: () => visor.passoZoom(-1) },
  ajustar: { rotulo: 'Ajustar à tela', atalho: '0', fn: () => visor.ajustar() },
  zoom100: { rotulo: 'Tamanho real (100%)', atalho: '1', fn: () => (visor.definirZoom(1), visor.centralizar()) },
  tema: { rotulo: 'Alternar tema claro/escuro', atalho: '', fn: alternarTema },
  atalhos: { rotulo: 'Atalhos do teclado', atalho: '?', fn: () => dialogoAtalhos() },
  sobre: { rotulo: 'Sobre o Crivo', atalho: '', fn: () => dialogoSobre(VERSAO, armazenamento) },
};

const MENUS = [
  ['Arquivo', ['novo', 'abrirSalvos', 'abrirArquivo', 'importarImagem', '-', 'salvar', 'salvarComo', 'baixarCrivo', '-', 'exportarImagem', 'exportarGif', 'exportarFolha', 'exportarDados']],
  ['Editar', ['desfazer', 'refazer', '-', 'copiar', 'recortar', 'colar', 'limparCamada', '-', 'selecionarTudo', 'desmarcar', '-', 'espelharH', 'espelharV']],
  ['Imagem', ['tamanho', 'recortarSelecao', 'aparar', '-', 'girarDireita', 'girarEsquerda', 'deslocarMetade', '-', 'contorno4', 'contorno8', '-', 'paraPaleta', 'substituirCor', 'inverter', 'cinza']],
  ['Exibir', ['grade', 'cebola', 'ladrilho', '-', 'aproximar', 'afastar', 'ajustar', 'zoom100', '-', 'tema']],
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
    // Tira o foco de um item que vai sumir, para os atalhos do teclado voltarem a valer.
    if (aberto.menu.contains(document.activeElement)) document.activeElement.blur();
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
  const rotulo = eixo === 'horizontal' ? 'Espelhar na horizontal' : 'Espelhar na vertical';
  const r = editor.selecaoRecortada;
  if (r) {
    const d = editor.doc;
    const px = editor.celulaAtiva();
    const mudancas = [];
    for (let y = 0; y < r.altura; y++) {
      for (let x = 0; x < r.largura; x++) {
        const sx = eixo === 'horizontal' ? r.largura - 1 - x : x;
        const sy = eixo === 'vertical' ? r.altura - 1 - y : y;
        mudancas.push([(r.y + y) * d.largura + r.x + x, px[(r.y + sy) * d.largura + r.x + sx]]);
      }
    }
    editor.aplicarMudancas(rotulo, mudancas);
    return;
  }
  editor.estrutura(rotulo, (d) => d.espelharCelula(editor.celulaAtiva(), eixo));
}

// Troca a cor primária exata pela secundária na camada atual, em todos os quadros (respeita a seleção).
function substituirCor() {
  if (!editor.podeEditarCamada()) return;
  const { corPrimaria: de, corSecundaria: para } = editor.estado;
  if (de === para) {
    avisar('A cor primária e a secundária são iguais.', 'info');
    return;
  }
  const camada = editor.camadaAtual;
  const sel = editor.selecao;
  let total = 0;
  editor.estrutura('Substituir cor', (d) => {
    for (const q of d.quadros) {
      if (!d.temCelula(q.id, camada.id)) continue;
      const px = d.celula(q.id, camada.id);
      for (let i = 0; i < px.length; i++) {
        if (px[i] !== de) continue;
        if (sel && !contem(sel, i % d.largura, (i / d.largura) | 0)) continue;
        px[i] = para;
        total++;
      }
    }
    return total > 0;
  });
  avisar(total ? `${total} pixel(s) trocados em ${camada.nome}.` : 'A cor primária não aparece nesta camada.', total ? 'sucesso' : 'info');
}

function girar(sentido) {
  editor.estrutura(sentido > 0 ? 'Girar à direita' : 'Girar à esquerda', (d) => d.girar(sentido));
  visor.ajustar();
}

// Filtros de cor e contorno: atuam na célula atual e, se houver seleção, só dentro dela.
function filtrar(rotulo, fn) {
  if (!editor.podeEditarCamada()) return;
  const d = editor.doc;
  const sel = editor.selecao;
  const filtro = sel ? (i) => contem(sel, i % d.largura, (i / d.largura) | 0) : null;
  editor.aplicarMudancas(rotulo, fn(editor.celulaAtiva(), d, filtro));
}

function copiar(recortar) {
  const d = editor.doc;
  const area = editor.selecaoRecortada ?? { x: 0, y: 0, largura: d.largura, altura: d.altura };
  editor.areaTransferencia = extrairRegiao(editor.celulaAtiva(), d.largura, area);
  editor.areaTransferencia.origem = { x: area.x, y: area.y };
  if (recortar) {
    if (!editor.podeEditarCamada()) return;
    editor.aplicarMudancas('Recortar', [...indicesDe(area, d.largura, d.altura)].map((i) => [i, 0]));
  } else {
    avisar(`Copiado: ${area.largura} × ${area.altura} px`, 'info', 1200);
  }
}

function colar() {
  const regiao = editor.areaTransferencia;
  if (!regiao) {
    avisar('Nada para colar. Selecione uma área e use Ctrl+C.', 'info');
    return;
  }
  if (!editor.podeEditarCamada()) return;
  const d = editor.doc;
  const destino = editor.selecao ?? regiao.origem ?? { x: 0, y: 0 };
  const x = Math.min(Math.max(0, destino.x), Math.max(0, d.largura - regiao.largura));
  const y = Math.min(Math.max(0, destino.y), Math.max(0, d.altura - regiao.altura));
  const mudancas = [];
  colarRegiao(regiao, d.largura, d.altura, x, y, (i, c) => mudancas.push([i, c]), { somenteOpacos: true });
  const fundo = editor.celulaAtiva().slice();
  editor.aplicarMudancas('Colar', mudancas, { silencioso: true });
  editor.definirSelecao({ x, y, largura: regiao.largura, altura: regiao.altura });
  // A colagem fica "flutuando" sobre o fundo: Mover pixels (V) leva só ela, sem arrastar nem furar o que está embaixo.
  editor.flutuante = { chave: editor.chaveAtiva, regiao, fundo, x, y, versao: editor.historico.versao };
  editor.definir('ferramenta', 'moverPixels');
}

function recortarParaSelecao() {
  const r = editor.selecaoRecortada;
  if (!r) {
    avisar('Faça uma seleção primeiro (ferramenta S).', 'info');
    return;
  }
  editor.estrutura('Recortar para a seleção', (d) => d.recortar(r.x, r.y, r.largura, r.altura));
  editor.definirSelecao(null);
  visor.ajustar();
}

function aparar() {
  const d = editor.doc;
  const r = limitesDoConteudo(d.celulas.values(), d.largura, d.altura);
  if (!r) {
    avisar('O projeto está vazio: nada para aparar.', 'info');
    return;
  }
  if (r.largura === d.largura && r.altura === d.altura) {
    avisar('Não há bordas transparentes para aparar.', 'info');
    return;
  }
  editor.estrutura('Aparar bordas', (doc) => doc.recortar(r.x, r.y, r.largura, r.altura));
  editor.definirSelecao(null);
  visor.ajustar();
  avisar(`Aparado para ${r.largura} × ${r.altura}.`, 'sucesso');
}

function deslocarMetade() {
  if (!editor.podeEditarCamada()) return;
  const d = editor.doc;
  const novo = deslocarComRepeticao(editor.celulaAtiva(), d.largura, d.altura, Math.floor(d.largura / 2), Math.floor(d.altura / 2));
  editor.aplicarMudancas('Deslocar meia matriz', [...novo].map((c, i) => [i, c]));
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
  const sel = $('#status-selecao');
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
  editor.ao('deslocamento', ({ dx, dy }) => (pos.textContent = `Δ ${dx}, ${dy}`));
  editor.ao('selecao', (r) => {
    sel.textContent = r?.largura ? `Seleção: ${r.largura} × ${r.altura} em ${r.x}, ${r.y}` : '';
  });
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
  if (e.defaultPrevented) return;
  if (alvo instanceof HTMLElement && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || alvo.closest('.menu'))) return;
  if (document.querySelector('dialog[open]')) return;
  // Com o botão do mouse ainda pressionado (traço, forma, seleção ou arraste em andamento), só o Esc vale:
  // qualquer outro comando mexeria no documento no meio do gesto e embaralharia o histórico.
  if (controlador.ativo) {
    if (e.key === 'Escape') {
      controlador.cancelar();
      e.preventDefault();
    }
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) executar('desfazer');
    else if (k === 'y' || (k === 'z' && e.shiftKey)) executar('refazer');
    else if (k === 's') executar('salvar');
    else if (k === 'o') executar('abrirArquivo');
    else if (k === 'e') executar(e.shiftKey ? 'exportarDados' : 'exportarImagem');
    else if (k === 'c' && e.altKey) executar('tamanho');
    else if (k === 'g' && e.shiftKey) executar('exportarGif');
    else if (k === 'a') executar('selecionarTudo');
    else if (k === 'd') executar('desmarcar');
    else if (k === 'c') executar('copiar');
    else if (k === 'x') executar('recortar');
    else if (k === 'v') executar('colar');
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (k.startsWith('arrow') && editor.estado.ferramenta === 'moverPixels') {
    const passo = e.shiftKey ? 8 : 1;
    const [dx, dy] = { arrowleft: [-passo, 0], arrowright: [passo, 0], arrowup: [0, -passo], arrowdown: [0, passo] }[k];
    controlador.empurrar(dx, dy);
    e.preventDefault();
    return;
  }
  if (k === 't') {
    executar(e.shiftKey ? 'deslocarMetade' : 'ladrilho');
    e.preventDefault();
    return;
  }
  if (e.shiftKey && (k === 'h' || k === 'v')) {
    executar(k === 'h' ? 'espelharH' : 'espelharV');
    e.preventDefault();
    return;
  }
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
    editor.definir('tamanho', Math.max(1, Math.min(32, editor.estado.tamanho + (k === ']' ? 1 : -1))));
    if (['lapis', 'borracha', 'linha', 'pontilhado', 'sombra'].includes(editor.estado.ferramenta)) montarOpcoes();
  } else if (k === '+' || k === '=') visor.passoZoom(1);
  else if (k === '-' || k === '_') visor.passoZoom(-1);
  else if (k === '0') visor.ajustar();
  else if (k === '1') executar('zoom100');
  else if (k === ',') editor.selecionarQuadro(editor.estado.quadro - 1);
  else if (k === '.') editor.selecionarQuadro(editor.estado.quadro + 1);
  else if (k === 'enter') editor.estado.tocando ? editor.parar() : editor.tocar();
  else if (k === 'delete' || k === 'backspace') executar('limparCamada');
  else if (k === '?') executar('atalhos');
  else if (k === 'escape') editor.definirSelecao(null);
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
