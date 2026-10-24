// Quick tutorial: on the first run, Crivo asks once whether the person wants a short tour (they can decline).
// The tour lights up each part of the screen and explains, in a few lines, what every tool does and how to
// use it, then how to save. It can be opened again in Ajuda › Tutorial rápido.
import { el, readPreference, writePreference } from './util.js';
import { icon } from './icons.js';
import { TOOLS } from './tools.js';
import { canChooseLocation } from './save-file.js';

// localStorage "crivo.tutorial": null = never shown; afterwards 'shown', 'declined' or 'finished'.
const PREFERENCE = 'tutorial';

export const tutorialPending = () => readPreference(PREFERENCE, null) === null;

const HOW_TO = {
  pencil: 'Pinta pixel por pixel. Botão esquerdo usa a cor principal; o direito, a secundária.',
  spray: 'Borrifa pixels soltos em volta do cursor. Segure o botão para encher mais.',
  eraser: 'Apaga os pixels por onde passa, deixando o fundo transparente.',
  bucket: 'Clique numa área para pintar de uma vez tudo o que tem a mesma cor.',
  eyedropper: 'Clique num pixel do desenho para pegar a cor dele.',
  line: 'Arraste do ponto inicial até o final. Com Shift, a linha trava em 45°.',
  curve: 'Arraste uma linha e depois arraste de novo para curvá-la. Enter aplica.',
  rectangle: 'Arraste para desenhar. Shift faz um quadrado; marque “Preenchido” para pintar o miolo.',
  ellipse: 'Arraste para desenhar. Shift faz um círculo perfeito.',
  contour: 'Desenhe o contorno à mão livre: ao soltar, a forma fica preenchida.',
  polygon: 'Clique em cada canto; clique no primeiro ponto (ou aperte Enter) para fechar.',
  dither: 'Pinta em xadrez, misturando duas cores para criar textura e meio-tom.',
  gradient: 'Arraste de onde a cor começa até onde termina para fazer um degradê pontilhado.',
  shade: 'Passe por cima para clarear (botão esquerdo) ou escurecer (botão direito).',
  blur: 'Suaviza bordas e transições misturando os pixels vizinhos.',
  jumble: 'Troca pixels vizinhos de lugar, criando ruído sem cores novas.',
  selection: 'Arraste para marcar um retângulo. Depois copie (Ctrl+C), recorte, apague ou mova.',
  ellipseSelection: 'Igual à seleção retangular, mas em forma de elipse ou círculo.',
  lasso: 'Contorne à mão livre a área que quer selecionar.',
  polygonLasso: 'Clique nos cantos para selecionar uma área de lados retos.',
  magicWand: 'Clique numa cor para selecionar toda a área daquela cor.',
  movePixels: 'Arraste a seleção (ou a camada toda) para outro lugar. As setas movem 1 px.',
  move: 'Arraste para passear pelo desenho sem mudar nada. Atalho rápido: segure Espaço.',
};

const os = () => (/Windows/i.test(navigator.userAgent) ? 'o Windows' : 'o sistema');
const toolButton = (id) => document.querySelector(`#tools .tool[data-tool="${id}"]`);
const panelOf = (selector) => document.querySelector(selector)?.closest('.panel') ?? null;
const fileMenu = () => [...document.querySelectorAll('#menus .menu-button')].find((b) => b.textContent.trim() === 'Arquivo') ?? null;

function steps() {
  const toolStep = (title, text, ids, extra = []) => ({
    title,
    text,
    tools: ids.filter((id) => TOOLS.some((t) => t.id === id)),
    anchor: () => ids.map(toolButton),
    targets: () => [...ids.map(toolButton), ...extra.map((s) => document.querySelector(s))],
  });
  const saveText = canChooseLocation()
    ? `Terminou? Aperte Ctrl+S (ou o disquete): ${os()} abre a janela para você escolher a pasta e o nome do projeto (.crivo). Depois, o Ctrl+S salva no mesmo arquivo. Para guardar como imagem PNG ou GIF, use Arquivo › Exportar.`
    : 'Terminou? Aperte Ctrl+S (ou o disquete) para guardar o projeto em Projetos salvos. Para levar o arquivo ou guardar como imagem PNG ou GIF, use o menu Arquivo.';
  return [
    toolStep('Desenhar', 'Clique numa ferramenta ou aperte a tecla dela. Os ajustes, como o tamanho do pincel, aparecem na barra de cima.', ['pencil', 'spray', 'eraser', 'bucket', 'eyedropper'], ['.options-bar']),
    toolStep('Formas', 'Linhas e figuras geométricas, sempre com pixels nítidos.', ['line', 'curve', 'rectangle', 'ellipse', 'contour', 'polygon']),
    toolStep('Efeitos e sombras', 'Para dar textura, volume e acabamento ao desenho.', ['dither', 'gradient', 'shade', 'blur', 'jumble']),
    toolStep('Selecionar e mover', 'Marque uma parte do desenho para copiar, colar (Ctrl+V), apagar (Delete) ou mover.', ['selection', 'ellipseSelection', 'lasso', 'polygonLasso', 'magicWand', 'movePixels', 'move']),
    {
      title: 'Cores',
      text: 'Clique numa cor da paleta para pintar com ela. O botão esquerdo do mouse escolhe a cor principal; o direito, a secundária. A tecla X troca as duas.',
      targets: () => [panelOf('#color-panel'), panelOf('#palette-panel')],
    },
    {
      title: 'Camadas e animação',
      text: 'Camadas são folhas transparentes empilhadas: desenhe o fundo numa e o personagem em outra. Embaixo, cada quadro é um desenho da animação; Enter toca.',
      targets: () => [document.querySelector('#timeline'), panelOf('#layers-panel')],
      anchor: () => [document.querySelector('#timeline')],
      prefer: ['above', 'left', 'right', 'below'],
    },
    {
      title: 'Zoom e desfazer',
      text: 'Gire a roda do mouse para aproximar e segure Espaço para arrastar a visão. Errou? Ctrl+Z desfaz e Ctrl+Y refaz. A grade (G) e a simetria (M) ficam nesta barra.',
      targets: () => [document.querySelector('#view'), document.querySelector('#undo'), document.querySelector('#redo')],
      prefer: ['above', 'left', 'below', 'right'],
    },
    {
      title: 'Salvar e exportar',
      text: saveText,
      targets: () => [document.querySelector('#save'), fileMenu()],
      anchor: () => [document.querySelector('#save'), fileMenu()],
      prefer: ['below', 'left', 'right', 'above'],
    },
  ];
}

const visible = (node) => {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

function union(rects) {
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

// Puts the card next to the highlighted area, on the first side (in order of preference) where it fits
// without covering what is lit up. On the left and right sides it may slide down below a lit area.
function place(card, area, avoid = [], prefer = ['right', 'left', 'below', 'above']) {
  const margin = 12;
  const gap = 14;
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const fitsX = (x) => x >= margin && x + width <= innerWidth - margin;
  const fitsY = (y) => y >= margin && y + height <= innerHeight - margin;
  const clampX = (x) => Math.max(margin, Math.min(x, innerWidth - width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, innerHeight - height - margin));
  const hits = (x, y) => avoid.filter((b) => x < b.x + b.width && x + width > b.x && y < b.y + b.height && y + height > b.y);
  let spot = [(innerWidth - width) / 2, (innerHeight - height) / 2];
  if (area) {
    const candidates = {
      right: () => fitsX(area.right + gap) && [area.right + gap, clampY(area.top)],
      left: () => fitsX(area.left - gap - width) && [area.left - gap - width, clampY(area.top)],
      below: () => fitsY(area.bottom + gap) && [clampX(area.left), area.bottom + gap],
      above: () => fitsY(area.top - gap - height) && [clampX(area.left), area.top - gap - height],
    };
    let fallback = null;
    for (const side of prefer) {
      const found = candidates[side]();
      if (!found) continue;
      let [x, y] = found;
      let blocking = hits(x, y);
      if (blocking.length && (side === 'right' || side === 'left')) {
        const below = Math.max(...blocking.map((b) => b.y + b.height)) + gap;
        if (fitsY(below) && !hits(x, below).length) [y, blocking] = [below, []];
      }
      if (!blocking.length) {
        spot = [x, y];
        fallback = null;
        break;
      }
      fallback ??= [x, y];
    }
    if (fallback) spot = fallback;
  }
  card.style.left = `${Math.round(clampX(spot[0]))}px`;
  card.style.top = `${Math.round(clampY(spot[1]))}px`;
}

// Boxes of neighbouring buttons (that touch and line up) become one, so a group of tools lights up as a
// single area. Boxes that only brush against each other stay apart.
function merge(boxes) {
  const area = (b) => b.width * b.height;
  const list = boxes.map((b) => ({ ...b }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.x > b.x + b.width || b.x > a.x + a.width || a.y > b.y + b.height || b.y > a.y + a.height) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const joined = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        if (area(joined) > 1.1 * (area(a) + area(b))) continue;
        list[i] = joined;
        list.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

let running = null;

// welcome: true on the first run (asks before starting); false when opened from the Ajuda menu.
export function startTutorial({ welcome = false } = {}) {
  if (running) return running;
  writePreference(PREFERENCE, 'shown');
  const list = steps();
  const dialog = el('dialog', { class: 'tour', 'aria-labelledby': 'tour-title' });
  // The dimmed screen is a rectangle with a mask: each lit box is a black (see-through) rounded rectangle.
  const shade = svg('svg', { class: 'tour-shade', 'aria-hidden': 'true' });
  const holes = svg('g');
  const mask = svg('mask', { id: 'tour-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: '100%', height: '100%' });
  mask.append(svg('rect', { width: '100%', height: '100%', fill: 'white' }), holes);
  const defs = svg('defs');
  defs.append(mask);
  shade.append(defs, svg('rect', { class: 'tour-dim', width: '100%', height: '100%', mask: 'url(#tour-mask)' }));
  const rings = el('div', { class: 'tour-rings', 'aria-hidden': 'true' });
  const card = el('section', { class: 'tour-card' });
  dialog.append(shade, rings, card);

  // Lighting up a part may scroll the side panels to it; they go back to where they were at the end.
  const scrolled = [document.scrollingElement, ...document.querySelectorAll('.sidebar, .tools')].filter(Boolean).map((n) => [n, n.scrollTop, n.scrollLeft]);
  let index = welcome ? -1 : 0;
  let current = null; // the targets of the current step, with their rings

  running = new Promise((resolve) => {
    const finish = (result) => {
      writePreference(PREFERENCE, result);
      removeEventListener('resize', render);
      dialog.close();
      dialog.remove();
      for (const [n, top, left] of scrolled) n.scrollTo(left, top);
      running = null;
      resolve(result);
    };

    const button = (label, className, onclick) => el('button', { type: 'button', class: className, onclick }, label);

    const ringAt = (box, className = 'tour-ring') =>
      el('div', { class: className, style: { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` } });

    // Lights up the given elements; returns the lit boxes (the card avoids covering them).
    function highlight(nodes) {
      rings.replaceChildren();
      const pad = 4;
      current = [];
      for (const node of nodes) {
        node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        const r = visible(node);
        if (r) current.push({ node, box: { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 } });
      }
      const boxes = merge(current.map((c) => c.box));
      holes.replaceChildren(...boxes.map((b) => svg('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 8, fill: 'black' })));
      for (const box of boxes) rings.append(ringAt(box));
      return boxes;
    }

    // While the pointer is over a tool in the list, its button on the screen gets its own ring.
    function focusTool(id, on) {
      rings.querySelector('.tour-ring.focus')?.remove();
      const target = on && current?.find((c) => c.node === toolButton(id));
      if (target) rings.append(ringAt(target.box, 'tour-ring focus'));
    }

    function welcomeCard() {
      highlight([]);
      card.className = 'tour-card tour-welcome';
      const start = button('Ver tutorial', 'button primary', () => go(0));
      card.replaceChildren(
        el('div', { class: 'tour-logo', html: icon('logo', 40) }),
        el('h2', { id: 'tour-title' }, 'Bem-vindo ao Crivo!'),
        el('p', {}, 'Quer um tutorial rápido? Em menos de um minuto você vê o que cada ferramenta faz, como usá-la e como salvar o seu desenho.'),
        el('div', { class: 'tour-actions tour-actions-center' }, button('Agora não', 'button', () => finish('declined')), start),
        el('p', { class: 'tour-note' }, 'Se mudar de ideia, ele fica em Ajuda › Tutorial rápido.'),
      );
      place(card, null, []);
      start.focus();
    }

    function stepCard() {
      const step = list[index];
      const lit = highlight(step.targets());
      card.className = 'tour-card';
      const last = index === list.length - 1;
      const next = button(last ? 'Começar a desenhar' : 'Próximo', 'button primary', () => (last ? finish('finished') : go(index + 1)));
      const body = [
        el('div', { class: 'tour-step' }, `${index + 1} de ${list.length}`),
        el('h2', { id: 'tour-title' }, step.title),
        el('p', {}, step.text),
      ];
      if (step.tools) {
        body.push(
          el(
            'ul',
            { class: 'tour-tools' },
            step.tools.map((id) => {
              const tool = TOOLS.find((t) => t.id === id);
              return el(
                'li',
                { onmouseenter: () => focusTool(id, true), onmouseleave: () => focusTool(id, false) },
                el('span', { class: 'tour-tool-icon', html: icon(tool.icon, 20) }),
                el('span', { class: 'tour-tool-text' }, el('strong', {}, tool.name), ' ', el('kbd', {}, tool.shortcut), el('span', { class: 'tour-tool-how' }, HOW_TO[id] ?? '')),
              );
            }),
          ),
        );
      }
      body.push(
        el(
          'div',
          { class: 'tour-actions' },
          button('Pular tutorial', 'tour-skip', () => finish('declined')),
          el('span', { class: 'tour-spacer' }),
          index > 0 ? button('Voltar', 'button', () => go(index - 1)) : null,
          next,
        ),
        el('div', { class: 'tour-dots', 'aria-hidden': 'true' }, list.map((_, i) => el('span', { class: i === index ? 'on' : '' }))),
      );
      card.replaceChildren(...body);
      const anchor = step.anchor ? step.anchor() : step.targets().slice(0, 1);
      place(card, union(anchor.map(visible).filter(Boolean)), lit, step.prefer);
      next.focus();
    }

    function render() {
      if (index < 0) welcomeCard();
      else stepCard();
    }

    function go(i) {
      index = i < 0 && welcome ? -1 : Math.max(0, Math.min(list.length - 1, i));
      card.classList.remove('tour-enter');
      render();
      void card.offsetWidth; // restarts the entrance animation
      card.classList.add('tour-enter');
    }

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(index < 0 ? 'declined' : 'finished');
    });
    dialog.addEventListener('keydown', (e) => {
      if (index < 0) return;
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
      else return;
      e.preventDefault();
    });
    addEventListener('resize', render);
    document.body.append(dialog);
    dialog.showModal();
    go(index);
  });
  return running;
}
