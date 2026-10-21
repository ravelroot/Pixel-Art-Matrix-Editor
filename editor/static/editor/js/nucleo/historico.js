import { Documento } from './documento.js';
import { codificarRLE, decodificarRLE } from './rle.js';

export const LIMIAR_CELULA = 2048;

export class Traco {
  constructor(chave, pixels) {
    this.chave = chave;
    this.pixels = pixels;
    this.originais = new Map();
  }

  pintar(indice, cor) {
    const atual = this.pixels[indice];
    if (atual === cor) return false;
    if (!this.originais.has(indice)) this.originais.set(indice, atual);
    this.pixels[indice] = cor;
    return true;
  }

  get vazio() {
    for (const [i, antes] of this.originais) if (this.pixels[i] !== antes) return false;
    return true;
  }

  desfazerVisual() {
    for (const [i, antes] of this.originais) this.pixels[i] = antes;
    this.originais.clear();
  }

  concluir(rotulo) {
    const mudancas = [];
    for (const [i, antes] of this.originais) if (this.pixels[i] !== antes) mudancas.push(i);
    if (!mudancas.length) return null;
    mudancas.sort((a, b) => a - b);
    if (mudancas.length > LIMIAR_CELULA) {
      const antes = this.pixels.slice();
      for (const i of mudancas) antes[i] = this.originais.get(i);
      return { tipo: 'celula', rotulo, chave: this.chave, antes: codificarRLE(antes), depois: codificarRLE(this.pixels) };
    }
    const indices = Uint32Array.from(mudancas);
    const antes = new Uint32Array(indices.length);
    const depois = new Uint32Array(indices.length);
    for (let k = 0; k < indices.length; k++) {
      antes[k] = this.originais.get(indices[k]);
      depois[k] = this.pixels[indices[k]];
    }
    return { tipo: 'pixels', rotulo, chave: this.chave, indices, antes, depois };
  }
}

export function tamanhoDaEntrada(e) {
  if (e.tipo === 'pixels') return e.indices.byteLength + e.antes.byteLength + e.depois.byteLength + 96;
  if (e.tipo === 'celula') return e.antes.byteLength + e.depois.byteLength + 96;
  if (e.tipo === 'estado') return Documento.bytesDoInstantaneo(e.antes) + Documento.bytesDoInstantaneo(e.depois);
  if (e.tipo === 'grupo') return e.entradas.reduce((s, x) => s + tamanhoDaEntrada(x), 32);
  return 64;
}

function aplicar(doc, e, lado) {
  if (e.tipo === 'pixels') {
    const px = doc.celulaPorChave(e.chave);
    const valores = e[lado];
    for (let k = 0; k < e.indices.length; k++) px[e.indices[k]] = valores[k];
  } else if (e.tipo === 'celula') {
    const px = doc.celulaPorChave(e.chave);
    px.set(decodificarRLE(e[lado], px.length));
  } else if (e.tipo === 'estado') {
    doc.restaurar(e[lado]);
  } else if (e.tipo === 'grupo') {
    const ordem = lado === 'antes' ? [...e.entradas].reverse() : e.entradas;
    for (const x of ordem) aplicar(doc, x, lado);
  }
}

export class Historico {
  constructor() {
    this.limpar();
  }

  limpar() {
    this.passado = [];
    this.futuro = [];
    this.bytes = 0;
    this.versao = 0;
  }

  registrar(entrada, contexto = null) {
    if (!entrada) return;
    entrada.bytes = tamanhoDaEntrada(entrada);
    entrada.contexto = contexto;
    for (const e of this.futuro) this.bytes -= e.bytes;
    this.futuro = [];
    this.passado.push(entrada);
    this.bytes += entrada.bytes;
    this.versao++;
  }

  registrarEstado(rotulo, antes, depois, contexto = null) {
    this.registrar({ tipo: 'estado', rotulo, antes, depois }, contexto);
  }

  get podeDesfazer() {
    return this.passado.length > 0;
  }

  get podeRefazer() {
    return this.futuro.length > 0;
  }

  get proximoDesfazer() {
    return this.passado.at(-1)?.rotulo ?? null;
  }

  get proximoRefazer() {
    return this.futuro.at(-1)?.rotulo ?? null;
  }

  desfazer(doc) {
    const e = this.passado.pop();
    if (!e) return null;
    aplicar(doc, e, 'antes');
    this.futuro.push(e);
    this.versao++;
    return e;
  }

  refazer(doc) {
    const e = this.futuro.pop();
    if (!e) return null;
    aplicar(doc, e, 'depois');
    this.passado.push(e);
    this.versao++;
    return e;
  }
}
