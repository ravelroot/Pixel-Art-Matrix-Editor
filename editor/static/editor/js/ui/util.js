import { saveBlob, canChooseLocation } from './save-file.js';

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') {
      for (const [prop, value] of Object.entries(v)) {
        if (prop.startsWith('--')) n.style.setProperty(prop, value);
        else n.style[prop] = value;
      }
    }
    else if (k === 'data') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const f of children.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function notify(text, type = 'info', duration = 3200) {
  const area = document.getElementById('toasts');
  if (!area) return;
  const toast = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, text);
  area.append(toast);
  while (area.children.length > 3) area.firstElementChild.remove();
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Saves a file: opens the "Save as" window when possible (desktop app, Chrome and Edge), so the person
// chooses the folder; elsewhere it goes to the Downloads folder. Resolves to 'saved', 'downloaded' or
// null (canceled in the window).
export async function downloadBlob(blob, name, options = {}) {
  try {
    const result = await saveBlob(blob, name, options);
    if (!result) return null;
    if (result.saved) {
      notify(result.saved.path ? `Salvo em ${result.saved.path}` : `"${result.saved.label}" salvo.`, 'success', 4500);
      return 'saved';
    }
    return 'downloaded';
  } catch (error) {
    notify('Não foi possível salvar o arquivo: ' + (error?.message || error), 'error', 6000);
    return null;
  }
}

export function downloadText(text, name, type = 'text/plain', options = {}) {
  return downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), name, options);
}

// Label of the button that saves an export: "Salvar…" opens the Save as window; "Baixar" downloads.
export const saveLabel = (label = 'Salvar…', fallback = 'Baixar') => (canChooseLocation() ? label : fallback);

export function pickFile(accepts, multiples = false) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: accepts, multiple: multiples, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(multiples ? [...input.files] : input.files[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(multiples ? [] : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function readText(file) {
  return file.text();
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function delay(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// Crivo 1.x stored the preferences under Portuguese keys and values. They move to the English keys on first read.
const LEGACY_KEYS = {
  tool: 'ferramenta', size: 'tamanho', shape: 'forma', symmetry: 'simetria', grid: 'grade', filled: 'preenchido',
  connectivity: 'conectividade', tolerance: 'tolerancia', contiguous: 'contiguo', sample: 'amostra', eraserMode: 'modoBorracha',
  onionSkin: 'cebola', palette: 'paleta', density: 'densidade', ditherBackground: 'fundoPontilhado', gradientType: 'tipoDegrade',
  gradientMatrix: 'matrizDegrade', shadeMode: 'modoSombra', shadeIntensity: 'intensidadeSombra', majorGrid: 'gradeForte',
  tile: 'ladrilho', recent: 'recentes', theme: 'tema', ramp: 'tons',
};
const LEGACY_VALUES = {
  lapis: 'pencil', borracha: 'eraser', balde: 'bucket', linha: 'line', retangulo: 'rectangle', elipse: 'ellipse',
  contaGotas: 'eyedropper', mover: 'move', selecao: 'selection', moverPixels: 'movePixels', pontilhado: 'dither',
  degrade: 'gradient', sombra: 'shade', quadrado: 'square', circulo: 'circle', nenhuma: 'none', ambas: 'both',
  camada: 'layer', todas: 'all', transparente: 'transparent', fundo: 'background', secundaria: 'secondary', manter: 'keep',
  paleta: 'palette', luz: 'light', claro: 'light', escuro: 'dark', sistema: 'system',
};
const LEGACY_FIELDS = { passos: 'steps', intensidade: 'intensity', desvio: 'shift' };

function upgradePreference(key, value) {
  if (key === 'palette' || key === 'recent') return value;
  if (typeof value === 'string') return LEGACY_VALUES[value] ?? value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [LEGACY_FIELDS[k] ?? k, v]));
  }
  return value;
}

export function readPreference(key, fallback) {
  try {
    let v = localStorage.getItem('crivo.' + key);
    if (v === null && LEGACY_KEYS[key]) {
      const legacy = localStorage.getItem('crivo.' + LEGACY_KEYS[key]);
      if (legacy === null) return fallback;
      v = JSON.stringify(upgradePreference(key, JSON.parse(legacy)));
      localStorage.setItem('crivo.' + key, v);
      localStorage.removeItem('crivo.' + LEGACY_KEYS[key]);
    }
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function writePreference(key, value) {
  try {
    localStorage.setItem('crivo.' + key, JSON.stringify(value));
  } catch {
    return false;
  }
  return true;
}

export function numberField(label, value, { min = 1, max = 1024, step = 1, id } = {}) {
  const input = el('input', { type: 'number', value: value, min, max, step: step, id, inputmode: 'numeric' });
  return { label: el('label', { class: 'field' }, el('span', {}, label), input), input };
}

export function selectField(label, options, value) {
  const select = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
  return { label: el('label', { class: 'field' }, el('span', {}, label), select), select };
}

export function checkboxField(label, checked) {
  const input = el('input', { type: 'checkbox', checked: checked });
  return { label: el('label', { class: 'field check-field' }, input, el('span', {}, label)), input };
}
