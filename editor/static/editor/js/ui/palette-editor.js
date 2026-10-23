// Palette editor dialog: edit, add, remove, reorder (drag or arrows), sort, reverse, dedupe, ramp and resize.
// Resolves with { name, colors, origins } (origins[j] = index of the original entry, -1 for new ones) or null.
import { colorToHex } from '../core/colors.js';
import { sortOrder, dedupeOrder, insertRamp, resizePalette, moveItem } from '../core/palette-tools.js';
import { el, notify } from './util.js';
import { openDialog } from './dialog.js';
import { HsvPicker } from './color-picker.js';

export function paletteEditorDialog({ palette, newColor = 0xff000000, gray = false }) {
  let entries = palette.colors.map((color, origin) => ({ color: color >>> 0, origin }));
  let selected = entries.length ? 0 : -1;
  let mark = -1;
  const name = el('input', { type: 'text', value: palette.preset ? `${palette.name} (minha)` : palette.name, maxlength: 80, 'aria-label': 'Nome da paleta' });
  const grid = el('div', { class: 'swatches palette-editor-grid', role: 'listbox', 'aria-label': 'Cores da paleta' });
  const count = el('span', { class: 'hint' });
  const picker = new HsvPicker({
    color: entries[0]?.color ?? newColor,
    gray,
    sliders: true,
    onInput: (c) => {
      if (selected < 0) return;
      entries[selected].color = c;
      const b = grid.children[selected];
      if (b) {
        b.style.setProperty('--color', colorToHex(c, true));
        b.title = `${colorToHex(c)} (${selected + 1})`;
      }
    },
  });

  const select = (i, shift = false) => {
    if (shift && selected >= 0 && i !== selected) mark = i;
    else {
      selected = i;
      mark = -1;
      if (i >= 0) picker.setColor(entries[i].color);
    }
    draw();
  };

  const permute = (order) => {
    const current = entries[selected];
    const marked = entries[mark];
    entries = order.map((i) => entries[i]);
    selected = current ? entries.indexOf(current) : -1;
    mark = marked ? entries.indexOf(marked) : -1;
    if (selected < 0 && entries.length) select(0);
    draw();
  };

  let dragFrom = -1;
  function draw() {
    grid.replaceChildren(
      ...entries.map((e, i) => {
        const b = el('button', {
          type: 'button',
          class: `swatch ${i === selected ? 'active' : ''} ${i === mark ? 'marked' : ''}`,
          role: 'option',
          'aria-selected': String(i === selected),
          title: `${colorToHex(e.color)} (${i + 1})`,
          'aria-label': `${colorToHex(e.color)} (${i + 1})`,
          draggable: 'true',
          style: { '--color': colorToHex(e.color, true) },
        });
        b.addEventListener('click', (ev) => select(i, ev.shiftKey));
        b.addEventListener('dragstart', (ev) => {
          dragFrom = i;
          ev.dataTransfer?.setData('text/plain', String(i));
        });
        b.addEventListener('dragover', (ev) => ev.preventDefault());
        b.addEventListener('drop', (ev) => {
          ev.preventDefault();
          if (dragFrom < 0 || dragFrom === i) return;
          const order = moveItem(entries.map((_, k) => k), dragFrom, i);
          dragFrom = -1;
          permute(order);
        });
        return b;
      }),
    );
    count.textContent = `${entries.length} ${entries.length === 1 ? 'cor' : 'cores'}${mark >= 0 ? ` · rampa entre ${selected + 1} e ${mark + 1}` : ''}`;
    for (const b of needsSelection) b.disabled = selected < 0;
    rampButton.disabled = selected < 0 || mark < 0;
  }

  const button = (label, onclick, title) => el('button', { type: 'button', class: 'button small', onclick, title }, label);
  const move = (delta) => {
    if (selected < 0) return;
    const to = Math.max(0, Math.min(entries.length - 1, selected + delta));
    permute(moveItem(entries.map((_, k) => k), selected, to));
  };
  const sortKey = el('select', { 'aria-label': 'Ordenar por' }, el('option', { value: 'hue' }, 'Matiz'), el('option', { value: 'lightness' }, 'Luminosidade'), el('option', { value: 'saturation' }, 'Saturação'));
  const steps = el('input', { type: 'number', min: 2, max: 64, value: 5, class: 'small-number', 'aria-label': 'Passos da rampa' });
  const size = el('input', { type: 'number', min: 1, max: 256, value: Math.max(1, entries.length), class: 'small-number', 'aria-label': 'Quantidade de cores' });
  const needsSelection = [
    button('Remover', () => {
      if (selected < 0) return;
      entries.splice(selected, 1);
      mark = -1;
      select(Math.min(selected, entries.length - 1));
    }),
    button('◀', () => move(-1), 'Mover para a esquerda'),
    button('▶', () => move(1), 'Mover para a direita'),
  ];
  needsSelection[1].setAttribute('aria-label', 'Mover para a esquerda');
  needsSelection[2].setAttribute('aria-label', 'Mover para a direita');
  const rampButton = button('Gerar rampa', () => {
    if (selected < 0 || mark < 0) return;
    const colors = insertRamp(entries.map((e) => e.color), selected, mark, +steps.value || 5);
    const from = Math.min(selected, mark);
    const to = Math.max(selected, mark);
    const middle = colors.slice(from, colors.length - (entries.length - to - 1));
    // The two ends keep their identity (and their pixels in indexed mode); the colors between them are new.
    const head = entries[from];
    const tail = entries[to];
    const generated = middle.map((color, k) => (k === 0 ? head : k === middle.length - 1 ? tail : { color, origin: -1 }));
    entries = [...entries.slice(0, from), ...generated, ...entries.slice(to + 1)];
    selected = from;
    mark = from + generated.length - 1;
    draw();
  }, 'Shift+clique numa segunda cor para marcar o fim da rampa');

  const body = el(
    'div',
    { class: 'palette-editor' },
    el('label', { class: 'field' }, el('span', {}, 'Nome'), name),
    grid,
    el('p', { class: 'hint' }, 'Clique escolhe a cor para editar · Shift+clique marca o fim da rampa · arraste para reordenar.'),
    count,
    el('div', { class: 'palette-editor-columns' },
      picker.root,
      el(
        'div',
        { class: 'palette-editor-tools' },
        el('div', { class: 'row-actions' },
          button('Adicionar', () => {
            const color = selected >= 0 ? entries[selected].color : newColor;
            const at = selected >= 0 ? selected + 1 : entries.length;
            entries.splice(at, 0, { color, origin: -1 });
            select(at);
          }, 'Adiciona uma cor depois da selecionada'),
          ...needsSelection,
        ),
        el('div', { class: 'row-actions' },
          sortKey,
          button('Ordenar', () => permute(sortOrder(entries.map((e) => e.color), sortKey.value))),
          button('Inverter ordem', () => permute(entries.map((_, k) => entries.length - 1 - k))),
          button('Remover duplicadas', () => {
            const before = entries.length;
            permute(dedupeOrder(entries.map((e) => e.color)));
            notify(before === entries.length ? 'Não há cores repetidas.' : `${before - entries.length} cor(es) repetida(s) removida(s).`, 'info', 1600);
          }),
        ),
        el('div', { class: 'row-actions' }, el('label', { class: 'inline-field' }, el('span', {}, 'Passos'), steps), rampButton),
        el('div', { class: 'row-actions' },
          el('label', { class: 'inline-field' }, el('span', {}, 'Cores'), size),
          button('Redimensionar', () => {
            const n = Math.round(+size.value);
            if (!Number.isFinite(n) || n < 1 || n > 256) return notify('Use de 1 a 256 cores.', 'warning');
            const colors = resizePalette(entries.map((e) => e.color), n);
            entries = colors.map((color, k) => entries[k] ?? { color, origin: -1 });
            if (selected >= entries.length) selected = entries.length - 1;
            if (mark >= entries.length) mark = -1;
            draw();
          }),
        ),
      ),
    ),
  );
  // Enter in the small fields must not save the whole palette: it only confirms that field.
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target === name || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    e.target.dispatchEvent(new Event('change'));
  });
  draw();
  return openDialog({
    title: palette.preset ? `Editar paleta (cópia de "${palette.name}")` : `Editar paleta "${palette.name}"`,
    className: 'wide palette-editor-dialog',
    body,
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Salvar',
        primary: true,
        send: true,
        action: () => {
          const n = name.value.trim();
          if (!n) {
            notify('Dê um nome à paleta.', 'warning');
            return false;
          }
          if (!entries.length) {
            notify('A paleta precisa de pelo menos uma cor.', 'warning');
            return false;
          }
          return { name: n.slice(0, 80), colors: entries.map((e) => e.color >>> 0), origins: entries.map((e) => e.origin) };
        },
      },
    ],
  });
}
