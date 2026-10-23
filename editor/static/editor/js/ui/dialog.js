import { el } from './util.js';

export function openDialog({ title, body, actions = [], className = '', onOpen }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: `dialog ${className}`, 'aria-labelledby': 'dialog-title' });
    const close = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const footer = el(
      'div',
      { class: 'dialog-actions' },
      actions.map((a) =>
        el(
          'button',
          {
            type: a.send ? 'submit' : 'button',
            class: a.primary ? 'button primary' : a.danger ? 'button danger' : 'button',
            onclick: async (e) => {
              if (a.send) return;
              e.preventDefault();
              const r = a.action ? await a.action() : a.value;
              if (r !== undefined && r !== false) close(r);
              else if (!a.action) close(a.value ?? null);
            },
          },
          a.label,
        ),
      ),
    );
    const form = el('form', { method: 'dialog', class: 'dialog-form' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const send = actions.find((a) => a.send);
      if (!send) return;
      const r = send.action ? await send.action() : send.value;
      if (r !== undefined && r !== false) close(r);
    });
    form.append(
      el('header', { class: 'dialog-header' }, el('h2', { id: 'dialog-title' }, title), el('button', { type: 'button', class: 'icon-button close', 'aria-label': 'Fechar', onclick: () => close(null) }, '×')),
      el('div', { class: 'dialog-body' }, body),
      footer,
    );
    dialog.append(form);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dialog);
    dialog.showModal();
    onOpen?.(dialog, close);
    const first = dialog.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus();
  });
}

export async function promptText(title, label, value = '') {
  const input = el('input', { type: 'text', value: value, maxlength: 80, required: true });
  const r = await openDialog({
    title,
    body: el('label', { class: 'field' }, el('span', {}, label), input),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Confirmar', primary: true, send: true, action: () => input.value.trim() || false },
    ],
  });
  return r;
}

export async function confirm(title, text, confirmLabel = 'Confirmar', danger = false) {
  const r = await openDialog({
    title,
    body: el('p', {}, text),
    actions: [
      { label: 'Cancelar', value: false },
      { label: confirmLabel, primary: !danger, danger, send: true, action: () => true },
    ],
  });
  return r === true;
}
