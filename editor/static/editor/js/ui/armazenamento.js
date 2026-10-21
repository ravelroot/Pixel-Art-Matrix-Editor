import { novoId } from '../nucleo/documento.js';

const API = '/api/v1';

function lerCookie(nome) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

async function pedir(caminho, { metodo = 'GET', corpo, tempo = 15000 } = {}) {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), tempo);
  try {
    const resp = await fetch(API + caminho, {
      method: metodo,
      headers: {
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(metodo !== 'GET' ? { 'X-CSRFToken': lerCookie('csrftoken') } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
      signal: controle.signal,
    });
    if (resp.status === 204) return null;
    const tipo = resp.headers.get('content-type') || '';
    const dados = tipo.includes('application/json') ? await resp.json() : await resp.text();
    if (!resp.ok) {
      const erro = new Error((dados && dados.erro) || `Erro ${resp.status} no servidor.`);
      erro.status = resp.status;
      erro.dados = dados;
      throw erro;
    }
    return dados;
  } finally {
    clearTimeout(t);
  }
}

export class ArmazenamentoServidor {
  constructor(info) {
    this.tipo = 'servidor';
    this.nome = 'servidor';
    this.info = info;
  }

  static async detectar() {
    try {
      const info = await pedir('/saude', { tempo: 2500 });
      if (info && info.status === 'ok') return new ArmazenamentoServidor(info);
    } catch {
      return null;
    }
    return null;
  }

  async listarProjetos() {
    return (await pedir('/projetos')).projetos;
  }

  async abrirProjeto(id) {
    return pedir(`/projetos/${id}`);
  }

  async salvarProjeto({ id, nome, dados, miniatura, revisao }) {
    if (id) return pedir(`/projetos/${id}`, { metodo: 'PUT', corpo: { nome, dados, miniatura, revisao } });
    return pedir('/projetos', { metodo: 'POST', corpo: { nome, dados, miniatura } });
  }

  async excluirProjeto(id) {
    return pedir(`/projetos/${id}`, { metodo: 'DELETE' });
  }

  async listarRevisoes(id) {
    return (await pedir(`/projetos/${id}/revisoes`)).revisoes;
  }

  async restaurarRevisao(id, numero) {
    return pedir(`/projetos/${id}/revisoes/${numero}/restaurar`, { metodo: 'POST', corpo: {} });
  }

  async listarPaletas() {
    const { paletas } = await pedir('/paletas');
    return paletas.filter((p) => !p.predefinida);
  }

  async salvarPaleta(p) {
    const corpo = { nome: p.nome, cores: p.cores };
    if (p.id && !String(p.id).startsWith('p')) return pedir(`/paletas/${p.id}`, { metodo: 'PUT', corpo });
    return pedir('/paletas', { metodo: 'POST', corpo });
  }

  async excluirPaleta(id) {
    return pedir(`/paletas/${id}`, { metodo: 'DELETE' });
  }
}

function abrirBanco() {
  return new Promise((resolver, rejeitar) => {
    const req = indexedDB.open('crivo', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projetos')) db.createObjectStore('projetos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rascunho')) db.createObjectStore('rascunho');
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rejeitar(req.error);
  });
}

async function transacao(loja, modo, fn) {
  const db = await abrirBanco();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction(loja, modo);
    const req = fn(tx.objectStore(loja));
    tx.oncomplete = () => {
      db.close();
      resolver(req?.result);
    };
    tx.onerror = () => {
      db.close();
      rejeitar(tx.error);
    };
  });
}

export class ArmazenamentoLocal {
  constructor() {
    this.tipo = 'local';
    this.nome = 'este navegador';
  }

  async listarProjetos() {
    const todos = (await transacao('projetos', 'readonly', (s) => s.getAll())) || [];
    return todos
      .map(({ dados, ...resto }) => ({ ...resto, largura: dados.largura, altura: dados.altura, quadros: dados.quadros.length, camadas: dados.camadas.length }))
      .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
  }

  async abrirProjeto(id) {
    const p = await transacao('projetos', 'readonly', (s) => s.get(id));
    if (!p) throw new Error('Projeto não encontrado neste navegador.');
    return p;
  }

  async salvarProjeto({ id, nome, dados, miniatura }) {
    const registro = {
      id: id || novoId('local-'),
      nome,
      dados,
      miniatura,
      revisao: null,
      atualizado_em: new Date().toISOString(),
    };
    await transacao('projetos', 'readwrite', (s) => s.put(registro));
    return registro;
  }

  async excluirProjeto(id) {
    await transacao('projetos', 'readwrite', (s) => s.delete(id));
  }

  async listarRevisoes() {
    return [];
  }

  async listarPaletas() {
    try {
      return JSON.parse(localStorage.getItem('crivo.paletas') || '[]');
    } catch {
      return [];
    }
  }

  async salvarPaleta(p) {
    const lista = await this.listarPaletas();
    const registro = { id: p.id || novoId('p'), nome: p.nome, cores: p.cores };
    const i = lista.findIndex((x) => x.id === registro.id);
    if (i >= 0) lista[i] = registro;
    else lista.push(registro);
    localStorage.setItem('crivo.paletas', JSON.stringify(lista));
    return registro;
  }

  async excluirPaleta(id) {
    const lista = (await this.listarPaletas()).filter((x) => x.id !== id);
    localStorage.setItem('crivo.paletas', JSON.stringify(lista));
  }
}

export async function guardarRascunho(rascunho) {
  try {
    await transacao('rascunho', 'readwrite', (s) => s.put(rascunho, 'atual'));
  } catch {
    return false;
  }
  return true;
}

export async function lerRascunho() {
  try {
    return await transacao('rascunho', 'readonly', (s) => s.get('atual'));
  } catch {
    return null;
  }
}
