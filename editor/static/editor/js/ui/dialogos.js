import { Documento, LIMITE_LADO } from '../nucleo/documento.js';
import { hexParaCor } from '../nucleo/cores.js';
import { FORMATOS_DADOS, montarMatrizes, gerarDados, layoutFolha, colar, achatarFundo, metadadosFolha } from '../nucleo/exportar.js';
import { nomeDeArquivo } from '../nucleo/formato.js';
import { deteccaoDeEscala } from '../nucleo/geometria.js';
import { PALETAS_PREDEFINIDAS } from '../nucleo/paletas.js';
import { el, avisar, baixarBlob, baixarTexto, escolherArquivo, campoNumero, campoSelecao, campoMarcar, formatarData, formatarBytes } from './util.js';
import { abrirDialogo, confirmar } from './dialogo.js';
import { pixelsParaCanvas, canvasParaBlob, arquivoParaPixels, reduzir, recortar } from './imagem.js';
import { icone } from './icones.js';
import { FERRAMENTAS } from './ferramentas.js';

const TAMANHOS = [8, 16, 24, 32, 48, 64, 96, 128, 256];

function presetsTamanho(inputL, inputA) {
  return el(
    'div',
    { class: 'presets' },
    TAMANHOS.map((t) =>
      el(
        'button',
        {
          type: 'button',
          class: 'botao pequeno',
          onclick: () => {
            inputL.value = t;
            inputA.value = t;
            inputL.dispatchEvent(new Event('input'));
          },
        },
        `${t}×${t}`,
      ),
    ),
  );
}

function lerLado(input) {
  const n = Math.round(+input.value);
  if (!Number.isFinite(n) || n < 1 || n > LIMITE_LADO) throw new Error(`Use tamanhos entre 1 e ${LIMITE_LADO}.`);
  return n;
}

export async function dialogoNovo(editor) {
  const nome = el('input', { type: 'text', value: 'Sem título', maxlength: 120 });
  const l = campoNumero('Largura', 32, { max: LIMITE_LADO });
  const a = campoNumero('Altura', 32, { max: LIMITE_LADO });
  const fundo = campoSelecao('Fundo', [['transparente', 'Transparente'], ['secundaria', 'Cor secundária'], ['branco', 'Branco']], 'transparente');
  const paleta = campoSelecao('Paleta', PALETAS_PREDEFINIDAS.map((p) => [p.slug, p.nome]), PALETAS_PREDEFINIDAS.some((p) => p.slug === editor.estado.paleta) ? editor.estado.paleta : 'crivo');
  const erro = el('p', { class: 'erro', role: 'alert' });
  const doc = await abrirDialogo({
    titulo: 'Novo projeto',
    corpo: el('div', { class: 'grade-form' }, el('label', { class: 'campo largo' }, el('span', {}, 'Nome'), nome), l.rotulo, a.rotulo, presetsTamanho(l.input, a.input), fundo.rotulo, paleta.rotulo, erro),
    acoes: [
      { rotulo: 'Cancelar', valor: null },
      {
        rotulo: 'Criar',
        primario: true,
        enviar: true,
        acao: () => {
          try {
            const d = new Documento(lerLado(l.input), lerLado(a.input), { nome: nome.value.trim() || 'Sem título' });
            const cor = fundo.select.value === 'secundaria' ? editor.estado.corSecundaria : fundo.select.value === 'branco' ? hexParaCor('#ffffff') : 0;
            if (cor) d.celula(d.quadros[0].id, d.camadas[0].id).fill(cor);
            return d;
          } catch (e) {
            erro.textContent = e.message;
            return false;
          }
        },
      },
    ],
  });
  if (!doc) return;
  editor.definir('paleta', paleta.select.value);
  editor.carregar(doc);
}

export async function dialogoRedimensionar(editor) {
  const { doc } = editor;
  const l = campoNumero('Largura', doc.largura, { max: LIMITE_LADO });
  const a = campoNumero('Altura', doc.altura, { max: LIMITE_LADO });
  const modo = campoSelecao('Como mudar', [['ancorar', 'Recortar ou expandir a área'], ['escalar', 'Escalar o desenho (vizinho mais próximo)']], 'ancorar');
  let ancora = [0.5, 0.5];
  const grade = el('div', { class: 'ancora', role: 'radiogroup', 'aria-label': 'Âncora' });
  const nomes = ['Topo à esquerda', 'Topo', 'Topo à direita', 'Esquerda', 'Centro', 'Direita', 'Base à esquerda', 'Base', 'Base à direita'];
  const marcar = () => [...grade.children].forEach((b, i) => b.setAttribute('aria-checked', String(i % 3 === ancora[0] * 2 && Math.floor(i / 3) === ancora[1] * 2)));
  for (let i = 0; i < 9; i++) {
    grade.append(
      el('button', {
        type: 'button',
        role: 'radio',
        title: nomes[i],
        'aria-label': nomes[i],
        onclick: () => {
          ancora = [(i % 3) / 2, Math.floor(i / 3) / 2];
          marcar();
        },
      }),
    );
  }
  marcar();
  const blocoAncora = el('div', { class: 'campo' }, el('span', {}, 'Âncora (centralizar ou expandir para um lado)'), grade);
  modo.select.addEventListener('change', () => (blocoAncora.hidden = modo.select.value === 'escalar'));
  const erro = el('p', { class: 'erro', role: 'alert' });
  const r = await abrirDialogo({
    titulo: 'Tamanho da matriz',
    corpo: el('div', { class: 'grade-form' }, el('p', { class: 'largo dica' }, `Agora: ${doc.largura} × ${doc.altura} pixels.`), l.rotulo, a.rotulo, presetsTamanho(l.input, a.input), modo.rotulo, blocoAncora, erro),
    acoes: [
      { rotulo: 'Cancelar', valor: null },
      {
        rotulo: 'Aplicar',
        primario: true,
        enviar: true,
        acao: () => {
          try {
            return { L: lerLado(l.input), A: lerLado(a.input), modo: modo.select.value };
          } catch (e) {
            erro.textContent = e.message;
            return false;
          }
        },
      },
    ],
  });
  if (!r) return;
  if (r.L === doc.largura && r.A === doc.altura) return;
  editor.estrutura(r.modo === 'escalar' ? 'Escalar desenho' : 'Tamanho da matriz', (d) => {
    if (r.modo === 'escalar') d.escalar(r.L, r.A);
    else d.redimensionar(r.L, r.A, ancora[0], ancora[1]);
  });
  editor.emitir('documento', { novo: true });
}

function previa(canvas, maximo = 320) {
  const c = el('canvas', { class: 'previa-exportacao' });
  const lado = Math.max(canvas.width, canvas.height);
  const escala = lado <= maximo ? Math.max(1, Math.min(8, Math.floor(maximo / lado))) : maximo / lado;
  c.width = Math.max(1, Math.round(canvas.width * escala));
  c.height = Math.max(1, Math.round(canvas.height * escala));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

export async function dialogoExportarImagem(editor) {
  const { doc } = editor;
  const formato = campoSelecao('Formato', [['png', 'PNG (mantém a transparência)'], ['jpeg', 'JPEG']], 'png');
  const escala = campoNumero('Escala', Math.max(1, Math.min(16, Math.floor(512 / Math.max(doc.largura, doc.altura)))), { min: 1, max: 64 });
  const quadro = campoSelecao('Quadro', doc.quadros.map((_, i) => [String(i), `Quadro ${i + 1}`]), String(editor.estado.quadro));
  const fundo = el('input', { type: 'color', value: '#ffffff', 'aria-label': 'Cor de fundo do JPEG' });
  const qualidade = campoNumero('Qualidade JPEG (%)', 92, { min: 10, max: 100 });
  const blocoJpeg = el('div', { class: 'grade-form largo' }, el('label', { class: 'campo' }, el('span', {}, 'Fundo do JPEG'), fundo), qualidade.rotulo);
  const info = el('p', { class: 'dica largo' });
  const area = el('div', { class: 'area-previa largo' });
  const atualizar = () => {
    const s = Math.max(1, Math.min(64, Math.round(+escala.input.value) || 1));
    blocoJpeg.hidden = formato.select.value !== 'jpeg';
    info.textContent = `Resultado: ${doc.largura * s} × ${doc.altura * s} pixels${s === 1 ? ' (tamanho real, pixel art pura)' : ` (cada pixel vira um bloco de ${s}×${s})`}.`;
    let px = doc.compor(+quadro.select.value);
    if (formato.select.value === 'jpeg') px = achatarFundo(px, hexParaCor(fundo.value));
    area.replaceChildren(previa(pixelsParaCanvas(px, doc.largura, doc.altura, Math.min(s, 8))));
  };
  for (const i of [formato.select, escala.input, quadro.select, fundo]) i.addEventListener('input', atualizar);
  atualizar();
  await abrirDialogo({
    titulo: 'Exportar imagem',
    corpo: el('div', { class: 'grade-form' }, formato.rotulo, escala.rotulo, doc.quadros.length > 1 ? quadro.rotulo : null, blocoJpeg, info, area),
    acoes: [
      { rotulo: 'Fechar', valor: null },
      {
        rotulo: 'Baixar',
        primario: true,
        enviar: true,
        acao: async () => {
          const s = Math.max(1, Math.min(64, Math.round(+escala.input.value) || 1));
          const jpeg = formato.select.value === 'jpeg';
          let px = doc.compor(+quadro.select.value);
          if (jpeg) px = achatarFundo(px, hexParaCor(fundo.value));
          const canvas = pixelsParaCanvas(px, doc.largura, doc.altura, s);
          const blob = await canvasParaBlob(canvas, jpeg ? 'image/jpeg' : 'image/png', (+qualidade.input.value || 92) / 100);
          const sufixo = doc.quadros.length > 1 ? `-q${+quadro.select.value + 1}` : '';
          baixarBlob(blob, nomeDeArquivo(doc.nome + sufixo + (s > 1 ? `-x${s}` : ''), jpeg ? 'jpg' : 'png'));
          return true;
        },
      },
    ],
  });
}

function montarFolha(doc, opcoes) {
  const s = opcoes.escala;
  const layout = layoutFolha(doc.quadros.length, doc.largura * s, doc.altura * s, opcoes);
  const px = new Uint32Array(layout.largura * layout.altura);
  doc.quadros.forEach((_, i) => {
    const canvas = pixelsParaCanvas(doc.compor(i), doc.largura, doc.altura, s);
    const dados = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    colar(px, layout.largura, new Uint32Array(dados.data.buffer), canvas.width, canvas.height, layout.posicoes[i].x, layout.posicoes[i].y);
  });
  return { layout, canvas: pixelsParaCanvas(px, layout.largura, layout.altura) };
}

export async function dialogoFolha(editor) {
  const { doc } = editor;
  const disposicao = campoSelecao('Disposição', [['horizontal', 'Horizontal (uma linha)'], ['vertical', 'Vertical (uma coluna)'], ['grade', 'Grade']], 'horizontal');
  const colunas = campoNumero('Colunas', Math.ceil(Math.sqrt(doc.quadros.length)), { min: 1, max: 256 });
  const escala = campoNumero('Escala', 1, { min: 1, max: 32 });
  const espacamento = campoNumero('Espaço entre quadros', 0, { min: 0, max: 64 });
  const json = campoMarcar('Baixar também o JSON com a posição de cada quadro', true);
  const info = el('p', { class: 'dica largo' });
  const area = el('div', { class: 'area-previa largo' });
  const opcoes = () => ({
    disposicao: disposicao.select.value,
    colunas: Math.max(1, +colunas.input.value || 1),
    escala: Math.max(1, Math.min(32, Math.round(+escala.input.value) || 1)),
    espacamento: Math.max(0, Math.round(+espacamento.input.value) || 0),
  });
  const atualizar = () => {
    colunas.rotulo.hidden = disposicao.select.value !== 'grade';
    const o = opcoes();
    const { layout, canvas } = montarFolha(doc, o);
    info.textContent = `${doc.quadros.length} quadro(s) em ${layout.colunas} coluna(s) e ${layout.linhas} linha(s): ${layout.largura} × ${layout.altura} pixels.`;
    area.replaceChildren(previa(canvas, 420));
  };
  for (const i of [disposicao.select, colunas.input, escala.input, espacamento.input]) i.addEventListener('input', atualizar);
  atualizar();
  await abrirDialogo({
    titulo: 'Exportar sprite sheet',
    classe: 'largo',
    corpo: el('div', { class: 'grade-form' }, disposicao.rotulo, colunas.rotulo, escala.rotulo, espacamento.rotulo, el('div', { class: 'largo' }, json.rotulo), info, area),
    acoes: [
      { rotulo: 'Fechar', valor: null },
      {
        rotulo: 'Baixar PNG',
        primario: true,
        enviar: true,
        acao: async () => {
          const o = opcoes();
          const { layout, canvas } = montarFolha(doc, o);
          const base = nomeDeArquivo(doc.nome + '-sprites', 'png').replace(/\.png$/, '');
          baixarBlob(await canvasParaBlob(canvas), base + '.png');
          if (json.input.checked) baixarTexto(JSON.stringify(metadadosFolha(base, layout, doc.quadros, doc.fps), null, 2) + '\n', base + '.json', 'application/json');
          return true;
        },
      },
    ],
  });
}

export async function dialogoExportarDados(editor, paletaAtual) {
  const { doc } = editor;
  const formato = campoSelecao('Formato', Object.entries(FORMATOS_DADOS).map(([k, v]) => [k, v.nome]), 'json');
  const modo = campoSelecao('Valores', [['indices', 'Índices de paleta (-1 = transparente)'], ['hex', 'Cores em hexadecimal']], 'indices');
  const quadros = campoSelecao('Quadros', [['atual', 'Só o quadro atual'], ['todos', `Todos os quadros (${doc.quadros.length})`]], doc.quadros.length > 1 ? 'todos' : 'atual');
  const usarPaleta = campoMarcar(`Seguir a ordem da paleta "${paletaAtual.nome}"`, false);
  const texto = el('textarea', { class: 'codigo', readonly: true, spellcheck: 'false', rows: 16, 'aria-label': 'Prévia do código exportado' });
  const info = el('p', { class: 'dica largo' });
  const gerar = () => {
    const indices = quadros.select.value === 'todos' ? doc.quadros.map((_, i) => i) : [editor.estado.quadro];
    const dados = montarMatrizes(
      indices.map((i) => doc.compor(i)),
      doc.largura,
      doc.altura,
      { modo: modo.select.value, paleta: usarPaleta.input.checked ? paletaAtual.cores : null },
    );
    return gerarDados(formato.select.value, dados, doc.nome);
  };
  const atualizar = () => {
    usarPaleta.rotulo.hidden = modo.select.value !== 'indices';
    const t = gerar();
    texto.value = t.length > 200000 ? t.slice(0, 200000) + '\n…' : t;
    info.textContent = `${formatarBytes(new Blob([t]).size)} · ${doc.largura} × ${doc.altura}`;
  };
  for (const i of [formato.select, modo.select, quadros.select, usarPaleta.input]) i.addEventListener('input', atualizar);
  atualizar();
  await abrirDialogo({
    titulo: 'Exportar dados da matriz',
    classe: 'largo',
    corpo: el('div', { class: 'grade-form' }, formato.rotulo, modo.rotulo, quadros.rotulo, el('div', { class: 'largo' }, usarPaleta.rotulo), el('div', { class: 'largo' }, texto), info),
    acoes: [
      { rotulo: 'Fechar', valor: null },
      {
        rotulo: 'Copiar',
        acao: async () => {
          try {
            await navigator.clipboard.writeText(gerar());
            avisar('Código copiado.', 'sucesso');
          } catch {
            texto.select();
            avisar('Selecione e copie com Ctrl+C.', 'alerta');
          }
          return undefined;
        },
      },
      {
        rotulo: 'Baixar',
        primario: true,
        enviar: true,
        acao: () => {
          const f = formato.select.value;
          const nome = f === 'java' ? gerar().match(/class (\w+)/)[1] + '.java' : nomeDeArquivo(doc.nome, FORMATOS_DADOS[f].extensao);
          baixarTexto(gerar(), nome);
          return true;
        },
      },
    ],
  });
}

export async function dialogoImportarImagem(editor) {
  const arquivo = await escolherArquivo('image/png,image/jpeg,image/gif,image/webp,image/bmp');
  if (!arquivo) return;
  let img;
  try {
    img = await arquivoParaPixels(arquivo);
  } catch (erro) {
    avisar('Não deu para ler a imagem: ' + erro.message, 'erro');
    return;
  }
  const detectado = deteccaoDeEscala(img.pixels, img.largura, img.altura);
  const destino = campoSelecao('Abrir como', [['projeto', 'Novo projeto'], ['camada', 'Nova camada no projeto atual'], ['folha', 'Animação (fatiar como sprite sheet)']], 'projeto');
  const fator = campoNumero('Tamanho de cada pixel na imagem', detectado, { min: 1, max: 64 });
  const quadroL = campoNumero('Largura de cada quadro', Math.min(img.largura, 32), { min: 1, max: LIMITE_LADO });
  const quadroA = campoNumero('Altura de cada quadro', Math.min(img.altura, 32), { min: 1, max: LIMITE_LADO });
  const blocoFolha = el('div', { class: 'grade-form largo' }, quadroL.rotulo, quadroA.rotulo);
  const info = el('p', { class: 'dica largo' });
  const area = el('div', { class: 'area-previa largo' }, previa(pixelsParaCanvas(img.pixels, img.largura, img.altura), 280));
  const atualizar = () => {
    const f = Math.max(1, +fator.input.value || 1);
    blocoFolha.hidden = destino.select.value !== 'folha';
    const L = Math.floor(img.largura / f);
    const A = Math.floor(img.altura / f);
    info.textContent = `Imagem: ${img.largura} × ${img.altura}. ${f > 1 ? `Reduzida ${f}× fica com ${L} × ${A}.` : ''} ${detectado > 1 ? `O Crivo detectou blocos de ${detectado}×${detectado}.` : ''}`;
  };
  for (const i of [destino.select, fator.input]) i.addEventListener('input', atualizar);
  atualizar();
  const erro = el('p', { class: 'erro', role: 'alert' });
  const r = await abrirDialogo({
    titulo: `Importar ${arquivo.name}`,
    corpo: el('div', { class: 'grade-form' }, destino.rotulo, fator.rotulo, blocoFolha, info, area, erro),
    acoes: [
      { rotulo: 'Cancelar', valor: null },
      {
        rotulo: 'Importar',
        primario: true,
        enviar: true,
        acao: () => {
          const f = Math.max(1, Math.round(+fator.input.value) || 1);
          const red = reduzir(img.pixels, img.largura, img.altura, f);
          if (red.largura > LIMITE_LADO || red.altura > LIMITE_LADO) {
            erro.textContent = `A imagem reduzida ainda passa de ${LIMITE_LADO} pixels. Aumente o tamanho do pixel.`;
            return false;
          }
          return { ...red, destino: destino.select.value, ql: +quadroL.input.value, qa: +quadroA.input.value };
        },
      },
    ],
  });
  if (!r) return;
  const nome = arquivo.name.replace(/\.[^.]+$/, '');
  if (r.destino === 'projeto') {
    const d = new Documento(r.largura, r.altura, { nome });
    d.celula(d.quadros[0].id, d.camadas[0].id).set(r.pixels);
    editor.carregar(d);
  } else if (r.destino === 'camada') {
    editor.estrutura('Importar imagem', (d) => {
      const c = d.adicionarCamada(nome);
      const destinoPx = d.celula(editor.quadroAtual.id, c.id);
      const L = Math.min(d.largura, r.largura);
      const A = Math.min(d.altura, r.altura);
      for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) destinoPx[y * d.largura + x] = r.pixels[y * r.largura + x];
      editor.estado.camadaId = c.id;
    });
    if (r.largura > editor.doc.largura || r.altura > editor.doc.altura) avisar('A imagem é maior que a matriz e foi cortada. Use Imagem → Tamanho da matriz para ampliar.', 'alerta', 5000);
  } else {
    const ql = Math.max(1, Math.min(r.largura, r.ql));
    const qa = Math.max(1, Math.min(r.altura, r.qa));
    const cols = Math.floor(r.largura / ql);
    const lins = Math.floor(r.altura / qa);
    const d = new Documento(ql, qa, { nome, vazio: true });
    const camada = d.adicionarCamada('Camada 1');
    for (let j = 0; j < lins; j++) {
      for (let i = 0; i < cols; i++) {
        const px = recortar(r.pixels, r.largura, i * ql, j * qa, ql, qa);
        if (!px.some((v) => v >>> 24)) continue;
        const q = d.adicionarQuadro();
        d.celula(q.id, camada.id).set(px);
      }
    }
    if (!d.quadros.length) d.adicionarQuadro();
    editor.carregar(d);
    avisar(`${d.quadros.length} quadro(s) importados.`, 'sucesso');
  }
}

export async function dialogoProjetos(editor, armazenamento, abrir) {
  const lista = el('ul', { class: 'lista-projetos' });
  let fecharDialogo;
  const carregar = async () => {
    lista.replaceChildren(el('li', { class: 'vazio' }, 'Carregando...'));
    let projetos;
    try {
      projetos = await armazenamento.listarProjetos();
    } catch (erro) {
      lista.replaceChildren(el('li', { class: 'erro' }, erro.message));
      return;
    }
    if (!projetos.length) {
      lista.replaceChildren(el('li', { class: 'vazio' }, 'Nenhum projeto salvo ainda. Use Arquivo → Salvar (Ctrl+S).'));
      return;
    }
    lista.replaceChildren(
      ...projetos.map((p) => {
        const imagem = p.miniatura || p.miniatura_url;
        return el(
          'li',
          { class: 'projeto' },
          imagem ? el('img', { src: imagem, alt: '', width: 56, height: 56 }) : el('div', { class: 'sem-miniatura' }),
          el('div', { class: 'projeto-info' }, el('strong', {}, p.nome), el('span', { class: 'dica' }, `${p.largura} × ${p.altura} · ${p.quadros} quadro(s) · ${p.camadas} camada(s) · ${formatarData(p.atualizado_em)}`)),
          el(
            'div',
            { class: 'acoes-linha' },
            armazenamento.tipo === 'servidor' ? el('button', { type: 'button', class: 'botao pequeno', onclick: () => dialogoRevisoes(editor, armazenamento, p, abrir).then(() => fecharDialogo?.(null)) }, 'Versões') : null,
            el(
              'button',
              {
                type: 'button',
                class: 'botao pequeno perigo',
                onclick: async () => {
                  if (!(await confirmar('Excluir projeto', `"${p.nome}" será apagado de ${armazenamento.nome}.`, 'Excluir', true))) return;
                  await armazenamento.excluirProjeto(p.id);
                  if (editor.projeto.id === p.id || editor.projeto.local === p.id) editor.projeto = { id: null, local: null, revisao: null };
                  carregar();
                },
              },
              'Excluir',
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'botao pequeno primario',
                onclick: async () => {
                  fecharDialogo?.(null);
                  await abrir(p.id);
                },
              },
              'Abrir',
            ),
          ),
        );
      }),
    );
  };
  carregar();
  await abrirDialogo({
    titulo: `Projetos salvos em ${armazenamento.nome}`,
    classe: 'largo',
    corpo: lista,
    acoes: [{ rotulo: 'Fechar', valor: null }],
    aoAbrir: (_, fechar) => (fecharDialogo = fechar),
  });
}

async function dialogoRevisoes(editor, armazenamento, projeto, abrir) {
  const revisoes = await armazenamento.listarRevisoes(projeto.id);
  const lista = el(
    'ul',
    { class: 'lista-projetos' },
    revisoes.length
      ? revisoes.map((r) =>
          el(
            'li',
            { class: 'projeto' },
            el('div', { class: 'projeto-info' }, el('strong', {}, `Versão ${r.numero}`), el('span', { class: 'dica' }, `${formatarData(r.criado_em)} · ${formatarBytes(r.tamanho_bytes)}`)),
            el(
              'button',
              {
                type: 'button',
                class: 'botao pequeno',
                onclick: async () => {
                  if (!(await confirmar('Restaurar versão', `O projeto volta para a versão ${r.numero}. A versão atual fica guardada no histórico.`, 'Restaurar'))) return;
                  await armazenamento.restaurarRevisao(projeto.id, r.numero);
                  await abrir(projeto.id);
                  avisar(`Versão ${r.numero} restaurada.`, 'sucesso');
                },
              },
              'Restaurar',
            ),
          ),
        )
      : el('li', { class: 'vazio' }, 'Este projeto ainda não tem versões anteriores. Cada vez que você salva, a versão anterior fica guardada aqui.'),
  );
  await abrirDialogo({ titulo: `Versões de "${projeto.nome}"`, corpo: lista, acoes: [{ rotulo: 'Fechar', valor: null }] });
}

export const ATALHOS = [
  ...FERRAMENTAS.map((f) => [f.atalho, f.nome]),
  ['Alt + clique', 'Pegar cor com qualquer ferramenta de desenho'],
  ['Clique direito', 'Desenhar com a cor secundária'],
  ['Shift (lápis)', 'Linha reta a partir do último ponto'],
  ['Shift (formas)', 'Linha a 45°, quadrado ou círculo perfeito'],
  ['Alt (formas)', 'Desenhar a partir do centro'],
  ['X', 'Trocar cor principal e secundária'],
  ['[ e ]', 'Diminuir e aumentar o pincel'],
  ['M', 'Alternar o modo de simetria'],
  ['G', 'Mostrar ou ocultar a grade'],
  ['K', 'Papel cebola'],
  ['Espaço + arrastar', 'Mover a visão'],
  ['Roda do mouse', 'Zoom no ponto do cursor'],
  ['+ e -', 'Aproximar e afastar'],
  ['0', 'Ajustar à tela'],
  ['1', 'Zoom 100%'],
  [', e .', 'Quadro anterior e próximo'],
  ['Enter', 'Tocar ou pausar a animação'],
  ['Ctrl + Z', 'Desfazer'],
  ['Ctrl + Y ou Ctrl + Shift + Z', 'Refazer'],
  ['Ctrl + S', 'Salvar'],
  ['Ctrl + O', 'Abrir arquivo .crivo'],
  ['Ctrl + E', 'Exportar imagem'],
  ['Ctrl + Shift + E', 'Exportar dados da matriz'],
];

export function dialogoAtalhos() {
  return abrirDialogo({
    titulo: 'Atalhos do teclado',
    corpo: el('table', { class: 'tabela-atalhos' }, el('tbody', {}, ATALHOS.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d))))),
    acoes: [{ rotulo: 'Fechar', valor: null }],
  });
}

export function dialogoSobre(versao, armazenamento) {
  return abrirDialogo({
    titulo: 'Sobre o Crivo',
    corpo: el(
      'div',
      { class: 'sobre' },
      el('div', { class: 'sobre-logo', html: icone('logo', 72) }),
      el('p', {}, el('strong', {}, `Crivo ${versao}`), ' · editor de pixel art baseado em matrizes.'),
      el('p', {}, `Projetos e paletas ficam salvos em ${armazenamento.nome}.`),
      el('p', {}, 'Código aberto sob a licença MIT. Copyright (©) 2026 Erik Pimenta.'),
      el('p', {}, el('a', { href: 'https://github.com/ravelroot/Pixel-Art-Matrix-Editor', target: '_blank', rel: 'noopener' }, 'github.com/ravelroot/Pixel-Art-Matrix-Editor')),
    ),
    acoes: [{ rotulo: 'Fechar', valor: null }],
  });
}
