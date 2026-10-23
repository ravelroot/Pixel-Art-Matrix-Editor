import { newId } from '../core/document.js';
import { upgradeDocument } from '../core/format.js';

const API = '/api/v2';

function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

async function request(path, { method = 'GET', body, time = 15000 } = {}) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), time);
  try {
    const resp = await fetch(API + path, {
      method: method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRFToken': readCookie('csrftoken') } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: control.signal,
    });
    if (resp.status === 204) return null;
    const type = resp.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await resp.json() : await resp.text();
    if (!resp.ok) {
      const error = new Error((data && data.error) || `Erro ${resp.status} no servidor.`);
      error.status = resp.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export class ServerStorage {
  constructor(info) {
    this.type = 'server';
    this.name = 'servidor';
    this.info = info;
  }

  static async detect() {
    // Opened straight from disk (Crivo.html): there is no server, everything stays in the browser.
    if (location.protocol === 'file:') return null;
    try {
      const info = await request('/health', { time: 2500 });
      if (info && info.status === 'ok') return new ServerStorage(info);
    } catch {
      return null;
    }
    return null;
  }

  async listProjects() {
    return (await request('/projects')).projects;
  }

  async openProject(id) {
    return request(`/projects/${id}`);
  }

  async saveProject({ id, name, data, thumbnail, revision }) {
    if (id) return request(`/projects/${id}`, { method: 'PUT', body: { name, data, thumbnail, revision } });
    return request('/projects', { method: 'POST', body: { name, data, thumbnail } });
  }

  async deleteProject(id) {
    return request(`/projects/${id}`, { method: 'DELETE' });
  }

  async listRevisions(id) {
    return (await request(`/projects/${id}/revisions`)).revisions;
  }

  async restoreRevision(id, number) {
    return request(`/projects/${id}/revisions/${number}/restore`, { method: 'POST', body: {} });
  }

  async listPalettes() {
    const { palettes } = await request('/palettes');
    return palettes.filter((p) => !p.preset);
  }

  async savePalette(p) {
    const body = { name: p.name, colors: p.colors };
    if (p.id && !String(p.id).startsWith('p')) return request(`/palettes/${p.id}`, { method: 'PUT', body });
    return request('/palettes', { method: 'POST', body });
  }

  async deletePalette(id) {
    return request(`/palettes/${id}`, { method: 'DELETE' });
  }
}

// Crivo 1.x project reference ({ id, revisao, local }) as stored in its drafts.
function upgradeProjectRef(p) {
  if (!p || typeof p !== 'object' || !('revisao' in p)) return p ?? null;
  return { id: p.id ?? null, revision: p.revisao ?? null, local: p.local ?? null };
}

// Crivo 1.x used database version 1 with the stores "projetos" and "rascunho" and Portuguese fields.
// The upgrade to version 2 copies every record into "projects" and "draft", converted, and then drops the old stores.
function migrateLegacyStores(db, tx) {
  if (db.objectStoreNames.contains('projetos')) {
    tx.objectStore('projetos').getAll().onsuccess = (e) => {
      const projects = tx.objectStore('projects');
      for (const p of e.target.result || []) {
        projects.put({
          id: p.id,
          name: p.nome,
          data: upgradeDocument(p.dados),
          thumbnail: p.miniatura ?? null,
          revision: p.revisao ?? null,
          updated_at: p.atualizado_em || new Date().toISOString(),
        });
      }
      db.deleteObjectStore('projetos');
    };
  }
  if (db.objectStoreNames.contains('rascunho')) {
    tx.objectStore('rascunho').get('atual').onsuccess = (e) => {
      const r = e.target.result;
      if (r) {
        tx.objectStore('draft').put(
          { data: upgradeDocument(r.dados), project: upgradeProjectRef(r.projeto), modified: Boolean(r.modificado), savedAt: r.quando },
          'current',
        );
      }
      db.deleteObjectStore('rascunho');
    };
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('crivo', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
      migrateLegacyStores(db, req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transaction(store, mode, fn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export class BrowserStorage {
  constructor(name = 'este navegador') {
    this.type = 'local';
    this.name = name;
  }

  async listProjects() {
    const all = (await transaction('projects', 'readonly', (s) => s.getAll())) || [];
    return all
      .map(({ data, ...rest }) => ({ ...rest, width: data.width, height: data.height, frames: data.frames.length, layers: data.layers.length }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async openProject(id) {
    const p = await transaction('projects', 'readonly', (s) => s.get(id));
    if (!p) throw new Error('Projeto não encontrado neste navegador.');
    return p;
  }

  async saveProject({ id, name, data, thumbnail }) {
    const record = {
      id: id || newId('local-'),
      name,
      data,
      thumbnail,
      revision: null,
      updated_at: new Date().toISOString(),
    };
    await transaction('projects', 'readwrite', (s) => s.put(record));
    return record;
  }

  async deleteProject(id) {
    await transaction('projects', 'readwrite', (s) => s.delete(id));
  }

  async listRevisions() {
    return [];
  }

  async listPalettes() {
    try {
      const stored = localStorage.getItem('crivo.palettes');
      if (stored !== null) return JSON.parse(stored);
      // Crivo 1.x kept the palettes under "crivo.paletas" with Portuguese fields.
      const legacy = localStorage.getItem('crivo.paletas');
      if (legacy === null) return [];
      const list = JSON.parse(legacy).map((p) => ({ id: p.id, name: p.nome, colors: p.cores }));
      localStorage.setItem('crivo.palettes', JSON.stringify(list));
      localStorage.removeItem('crivo.paletas');
      return list;
    } catch {
      return [];
    }
  }

  async savePalette(p) {
    const list = await this.listPalettes();
    const record = { id: p.id || newId('p'), name: p.name, colors: p.colors };
    const i = list.findIndex((x) => x.id === record.id);
    if (i >= 0) list[i] = record;
    else list.push(record);
    localStorage.setItem('crivo.palettes', JSON.stringify(list));
    return record;
  }

  async deletePalette(id) {
    const list = (await this.listPalettes()).filter((x) => x.id !== id);
    localStorage.setItem('crivo.palettes', JSON.stringify(list));
  }
}

export async function saveDraft(draft) {
  try {
    await transaction('draft', 'readwrite', (s) => s.put(draft, 'current'));
  } catch {
    return false;
  }
  return true;
}

export async function readDraft() {
  try {
    return await transaction('draft', 'readonly', (s) => s.get('current'));
  } catch {
    return null;
  }
}
