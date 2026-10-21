import { el } from './util.js';

export function abrirDialogo({ titulo, corpo, acoes = [], classe = '', aoAbrir }) {
  return new Promise((resolver) => {
    const dialogo = el('dialog', { class: `dialogo ${classe}`, 'aria-labelledby': 'dialogo-titulo' });
    const fechar = (valor) => {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    };
    const rodape = el(
      'div',
      { class: 'dialogo-acoes' },
      acoes.map((a) =>
        el(
          'button',
          {
            type: a.enviar ? 'submit' : 'button',
            class: a.primario ? 'botao primario' : a.perigo ? 'botao perigo' : 'botao',
            onclick: async (e) => {
              if (a.enviar) return;
              e.preventDefault();
              const r = a.acao ? await a.acao() : a.valor;
              if (r !== undefined && r !== false) fechar(r);
              else if (!a.acao) fechar(a.valor ?? null);
            },
          },
          a.rotulo,
        ),
      ),
    );
    const formulario = el('form', { method: 'dialog', class: 'dialogo-form' });
    formulario.addEventListener('submit', async (e) => {
      e.preventDefault();
      const enviar = acoes.find((a) => a.enviar);
      if (!enviar) return;
      const r = enviar.acao ? await enviar.acao() : enviar.valor;
      if (r !== undefined && r !== false) fechar(r);
    });
    formulario.append(
      el('header', { class: 'dialogo-topo' }, el('h2', { id: 'dialogo-titulo' }, titulo), el('button', { type: 'button', class: 'botao-icone fechar', 'aria-label': 'Fechar', onclick: () => fechar(null) }, '×')),
      el('div', { class: 'dialogo-corpo' }, corpo),
      rodape,
    );
    dialogo.append(formulario);
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      fechar(null);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    aoAbrir?.(dialogo, fechar);
    const primeiro = dialogo.querySelector('input:not([type=hidden]), select, textarea');
    if (primeiro) primeiro.focus();
  });
}

export async function perguntarTexto(titulo, rotulo, valor = '') {
  const input = el('input', { type: 'text', value: valor, maxlength: 80, required: true });
  const r = await abrirDialogo({
    titulo,
    corpo: el('label', { class: 'campo' }, el('span', {}, rotulo), input),
    acoes: [
      { rotulo: 'Cancelar', valor: null },
      { rotulo: 'Confirmar', primario: true, enviar: true, acao: () => input.value.trim() || false },
    ],
  });
  return r;
}

export async function confirmar(titulo, texto, rotuloConfirmar = 'Confirmar', perigo = false) {
  const r = await abrirDialogo({
    titulo,
    corpo: el('p', {}, texto),
    acoes: [
      { rotulo: 'Cancelar', valor: false },
      { rotulo: rotuloConfirmar, primario: !perigo, perigo, enviar: true, acao: () => true },
    ],
  });
  return r === true;
}
