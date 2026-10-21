export function el(tag, atributos = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'texto') n.textContent = v;
    else if (k === 'estilo') {
      for (const [prop, valor] of Object.entries(v)) {
        if (prop.startsWith('--')) n.style.setProperty(prop, valor);
        else n.style[prop] = valor;
      }
    }
    else if (k === 'dados') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

export function avisar(texto, tipo = 'info', duracao = 3200) {
  const area = document.getElementById('avisos');
  if (!area) return;
  const aviso = el('div', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, texto);
  area.append(aviso);
  while (area.children.length > 3) area.firstElementChild.remove();
  setTimeout(() => {
    aviso.classList.add('saindo');
    setTimeout(() => aviso.remove(), 300);
  }, duracao);
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function baixarTexto(texto, nome, tipo = 'text/plain') {
  baixarBlob(new Blob([texto], { type: `${tipo};charset=utf-8` }), nome);
}

export function escolherArquivo(aceita, multiplos = false) {
  return new Promise((resolver) => {
    const input = el('input', { type: 'file', accept: aceita, multiple: multiplos, estilo: { display: 'none' } });
    input.addEventListener('change', () => {
      resolver(multiplos ? [...input.files] : input.files[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolver(multiplos ? [] : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function lerTexto(arquivo) {
  return arquivo.text();
}

export function formatarBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatarData(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function atrasar(fn, ms) {
  let t = null;
  const chamada = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  chamada.cancelar = () => clearTimeout(t);
  return chamada;
}

export function lerPreferencia(chave, padrao) {
  try {
    const v = localStorage.getItem('crivo.' + chave);
    return v === null ? padrao : JSON.parse(v);
  } catch {
    return padrao;
  }
}

export function gravarPreferencia(chave, valor) {
  try {
    localStorage.setItem('crivo.' + chave, JSON.stringify(valor));
  } catch {
    return false;
  }
  return true;
}

export function campoNumero(rotulo, valor, { min = 1, max = 1024, passo = 1, id } = {}) {
  const input = el('input', { type: 'number', value: valor, min, max, step: passo, id, inputmode: 'numeric' });
  return { rotulo: el('label', { class: 'campo' }, el('span', {}, rotulo), input), input };
}

export function campoSelecao(rotulo, opcoes, valor) {
  const select = el('select', {}, opcoes.map(([v, t]) => el('option', { value: v, selected: v === valor }, t)));
  return { rotulo: el('label', { class: 'campo' }, el('span', {}, rotulo), select), select };
}

export function campoMarcar(rotulo, marcado) {
  const input = el('input', { type: 'checkbox', checked: marcado });
  return { rotulo: el('label', { class: 'campo campo-marcar' }, input, el('span', {}, rotulo)), input };
}
