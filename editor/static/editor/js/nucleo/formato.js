import { Documento, validarLado } from './documento.js';
import { codificarRLE, decodificarRLE, paraBase64, deBase64 } from './rle.js';
import { hexParaCor, corParaHex } from './cores.js';

export const FORMATO = 'crivo';
export const VERSAO_FORMATO = 1;

export function serializar(doc) {
  const celulas = [];
  for (const q of doc.quadros) {
    for (const c of doc.camadas) {
      if (!doc.temCelula(q.id, c.id)) continue;
      const px = doc.celula(q.id, c.id);
      if (!px.some((v) => v !== 0)) continue;
      celulas.push({ quadro: q.id, camada: c.id, rle: paraBase64(codificarRLE(px)) });
    }
  }
  return {
    formato: FORMATO,
    versao: VERSAO_FORMATO,
    nome: doc.nome,
    largura: doc.largura,
    altura: doc.altura,
    fps: doc.fps,
    paleta: doc.paleta.map((c) => corParaHex(c)),
    camadas: doc.camadas.map((c) => ({
      id: c.id,
      nome: c.nome,
      visivel: c.visivel,
      opacidade: c.opacidade,
      bloqueada: c.bloqueada,
    })),
    quadros: doc.quadros.map((q) => ({ id: q.id, duracao: q.duracao })),
    celulas,
  };
}

export function desserializar(dados) {
  if (typeof dados === 'string') dados = JSON.parse(dados);
  if (!dados || dados.formato !== FORMATO) throw new Error('Este arquivo não é um projeto do Crivo.');
  if (dados.versao > VERSAO_FORMATO) throw new Error('Este projeto foi salvo por uma versão mais nova do Crivo.');
  const doc = new Documento(validarLado(dados.largura), validarLado(dados.altura), {
    nome: String(dados.nome || 'Sem título').slice(0, 120),
    fps: Math.min(60, Math.max(1, Number(dados.fps) || 8)),
    vazio: true,
  });
  doc.paleta = (dados.paleta || []).map(hexParaCor).filter((c) => c !== null);
  const ids = new Set();
  for (const c of dados.camadas || []) {
    if (!c.id || ids.has(c.id)) throw new Error('Camadas com identificador repetido.');
    ids.add(c.id);
    doc.camadas.push({
      id: String(c.id),
      nome: String(c.nome || 'Camada').slice(0, 80),
      visivel: c.visivel !== false,
      opacidade: Math.min(100, Math.max(0, Number(c.opacidade ?? 100))),
      bloqueada: Boolean(c.bloqueada),
    });
  }
  for (const q of dados.quadros || []) {
    if (!q.id || ids.has(q.id)) throw new Error('Quadros com identificador repetido.');
    ids.add(q.id);
    doc.quadros.push({ id: String(q.id), duracao: q.duracao ? Number(q.duracao) : null });
  }
  if (!doc.camadas.length) doc.adicionarCamada('Camada 1');
  if (!doc.quadros.length) doc.adicionarQuadro();
  for (const cel of dados.celulas || []) {
    if (doc.indiceQuadro(cel.quadro) < 0 || doc.indiceCamada(cel.camada) < 0) continue;
    doc.celulas.set(doc.chave(cel.quadro, cel.camada), decodificarRLE(deBase64(cel.rle), doc.total));
  }
  return doc;
}

export function nomeDeArquivo(nome, extensao) {
  const base = String(nome || 'crivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (base || 'crivo') + '.' + extensao;
}
