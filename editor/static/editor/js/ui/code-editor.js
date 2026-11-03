import { el } from './util.js';

const KEYWORDS = {
  crivo: ['var', 'if', 'else', 'while', 'for', 'repeat', 'do', 'until', 'break', 'continue', 'return', 'function', 'and', 'or', 'not', 'mod', 'div'],
  cpp: ['if', 'else', 'while', 'for', 'do', 'break', 'continue', 'return', 'switch', 'case', 'default', 'using', 'namespace', 'const', 'static', 'auto', 'int', 'float', 'double', 'bool', 'void', 'char', 'long', 'short', 'unsigned', 'string', 'vector', 'std', 'and', 'or', 'not', 'static_cast'],
  lua: ['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while'],
};
const CONSTANTS = ['true', 'false', 'self', 'other', 'global', 'noone', 'nil', 'nullptr', 'NULL', 'pi', 'x', 'y', 'hspeed', 'vspeed', 'speed', 'direction', 'health'];
export const LANG_NAMES = { crivo: 'Crivo Script', cpp: 'C++', lua: 'Lua' };

function tokens(text, lang) {
  const out = [];
  const kw = new Set(KEYWORDS[lang] || KEYWORDS.crivo);
  const consts = new Set(CONSTANTS);
  const n = text.length;
  let i = 0;
  const push = (type, value) => out.push([type, value]);
  while (i < n) {
    const c = text[i];
    const rest = text.slice(i, i + 4);
    if (lang === 'lua' && rest.startsWith('--')) {
      let end = text.indexOf('\n', i);
      if (rest.startsWith('--[[')) {
        const close = text.indexOf(']]', i);
        end = close < 0 ? n : close + 2;
      }
      if (end < 0) end = n;
      push('com', text.slice(i, end));
      i = end;
    } else if (lang !== 'lua' && rest.startsWith('//')) {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      push('com', text.slice(i, end));
      i = end;
    } else if (lang !== 'lua' && rest.startsWith('/*')) {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      push('com', text.slice(i, end));
      i = end;
    } else if (lang === 'cpp' && c === '#' && (i === 0 || text[i - 1] === '\n')) {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      push('pre', text.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      push('str', text.slice(i, Math.min(n, j + 1)));
      i = Math.min(n, j + 1);
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxX._]/.test(text[j])) j++;
      push('num', text.slice(i, j));
      i = j;
    } else if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_À-ɏ]/.test(text[j])) j++;
      const word = text.slice(i, j);
      let k = j;
      while (text[k] === ' ') k++;
      push(kw.has(word) ? 'kw' : consts.has(word) ? 'const' : text[k] === '(' ? 'fn' : 'id', word);
      i = j;
    } else {
      let j = i + 1;
      while (j < n && !/[A-Za-z0-9_"'\s/#À-ɏ-]/.test(text[j])) j++;
      push(/[{}()[\]]/.test(c) ? 'pun' : /\s/.test(c) ? 'sp' : 'op', text.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function codeEditor({ value = '', lang = 'crivo', rows = 12, check = null, onChange = null, onLang = null, label = 'Código', compact = false }) {
  let language = lang;
  const area = el('textarea', { class: 'ce-area', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off', 'aria-label': label });
  area.value = value;
  const highlight = el('pre', { class: 'ce-realce', 'aria-hidden': 'true' });
  const gutter = el('div', { class: 'ce-linhas', 'aria-hidden': 'true' });
  const where = el('span', { class: 'ce-pos mono' });
  const state = el('span', { class: 'ce-estado mono' });
  const langSelect = el(
    'select',
    { class: 'ce-lingua', 'aria-label': 'Linguagem' },
    Object.entries(LANG_NAMES).map(([k, t]) => el('option', { value: k, selected: k === language }, t)),
  );
  langSelect.addEventListener('change', () => {
    language = langSelect.value;
    paint();
    validate();
    onLang?.(language);
  });
  const stack = el('div', { class: 'ce-pilha' }, highlight, area);
  const root = el(
    'div',
    { class: `ce${compact ? ' compacto' : ''}`, style: { '--linhas': String(rows) } },
    el('div', { class: 'ce-corpo' }, gutter, stack),
    el('div', { class: 'ce-barra' }, langSelect, where, state),
  );
  let errorLine = 0;
  const paint = () => {
    const text = area.value;
    const nodes = tokens(text + (text.endsWith('\n') ? ' ' : ''), language).map(([type, v]) => (type === 'sp' || type === 'id' ? document.createTextNode(v) : el('span', { class: `ce-${type}` }, v)));
    highlight.replaceChildren(...nodes);
    const count = text.split('\n').length;
    if (gutter.childElementCount !== count || errorLine !== Number(gutter.dataset.erro || 0)) {
      gutter.dataset.erro = String(errorLine);
      gutter.replaceChildren(...Array.from({ length: count }, (_, i) => el('span', { class: i + 1 === errorLine ? 'erro' : null }, String(i + 1))));
    }
    sync();
  };
  const sync = () => {
    highlight.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    gutter.style.transform = `translateY(${-area.scrollTop}px)`;
  };
  const caret = () => {
    const before = area.value.slice(0, area.selectionStart);
    const lines = before.split('\n');
    where.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
  };
  const validate = () => {
    const text = area.value;
    const error = text.trim() && check ? check(text, language) : null;
    const m = error && /linha (\d+)/.exec(error);
    errorLine = m ? Number(m[1]) : 0;
    state.textContent = !text.trim() ? '' : error || 'Sem erros';
    state.classList.toggle('erro', Boolean(error));
    root.classList.toggle('com-erro', Boolean(error));
    paint();
  };
  let timer = 0;
  area.addEventListener('input', () => {
    paint();
    caret();
    clearTimeout(timer);
    timer = setTimeout(validate, 220);
  });
  area.addEventListener('scroll', sync);
  area.addEventListener('keyup', caret);
  area.addEventListener('click', caret);
  area.addEventListener('change', () => onChange?.(area.value, language));
  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      const before = area.value.slice(0, area.selectionStart);
      const last = before.split('\n').pop();
      const opens = /[{(]\s*$/.test(last) || (language === 'lua' && /\b(then|do|else|function\b.*\))\s*$/.test(last));
      const indent = (last.match(/^\s*/) || [''])[0] + (opens ? '  ' : '');
      e.preventDefault();
      area.setRangeText('\n' + indent, area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    } else if (e.key === '}' && /^\s+$/.test(area.value.slice(area.value.lastIndexOf('\n', area.selectionStart - 1) + 1, area.selectionStart))) {
      const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1;
      const spaces = area.selectionStart - start;
      if (spaces >= 2) {
        e.preventDefault();
        area.setRangeText('}', area.selectionStart - 2, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input'));
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onChange?.(area.value, language);
      validate();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const mark = language === 'lua' ? '-- ' : '// ';
      const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1;
      const endIndex = area.value.indexOf('\n', area.selectionEnd);
      const end = endIndex < 0 ? area.value.length : endIndex;
      const block = area.value.slice(start, end).split('\n');
      const all = block.every((l) => l.trimStart().startsWith(mark.trim()));
      const changed = block.map((l) => (all ? l.replace(new RegExp(`^(\\s*)${mark.trim().replace(/[/-]/g, '\\$&')} ?`), '$1') : mark + l)).join('\n');
      area.setRangeText(changed, start, end, 'select');
      area.dispatchEvent(new Event('input'));
    }
  });
  validate();
  caret();
  return {
    root,
    area,
    get value() {
      return area.value;
    },
    get lang() {
      return language;
    },
    set(valueText) {
      area.value = valueText;
      validate();
    },
    focus() {
      area.focus();
    },
  };
}


