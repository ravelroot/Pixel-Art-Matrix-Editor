import { sobrepor } from './cores.js';
import { codificarRLE, decodificarRLE } from './rle.js';

export const LIMITE_LADO = 1024;

let sequencia = 0;

export function novoId(prefixo) {
  sequencia = (sequencia + 1) % 1679616;
  return prefixo + Date.now().toString(36) + sequencia.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 6);
}

export function validarLado(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > LIMITE_LADO) throw new Error(`O tamanho precisa ficar entre 1 e ${LIMITE_LADO}.`);
  return n;
}

export class Documento {
  constructor(largura = 32, altura = 32, opcoes = {}) {
    this.nome = opcoes.nome ?? 'Sem título';
    this.largura = validarLado(largura);
    this.altura = validarLado(altura);
    this.fps = opcoes.fps ?? 8;
    this.paleta = opcoes.paleta ? [...opcoes.paleta] : [];
    this.camadas = [];
    this.quadros = [];
    this.celulas = new Map();
    if (!opcoes.vazio) {
      this.adicionarCamada('Camada 1');
      this.adicionarQuadro();
    }
  }

  get total() {
    return this.largura * this.altura;
  }

  chave(quadroId, camadaId) {
    return quadroId + ':' + camadaId;
  }

  temCelula(quadroId, camadaId) {
    return this.celulas.has(this.chave(quadroId, camadaId));
  }

  celula(quadroId, camadaId) {
    const k = this.chave(quadroId, camadaId);
    let pixels = this.celulas.get(k);
    if (!pixels) {
      pixels = new Uint32Array(this.total);
      this.celulas.set(k, pixels);
    }
    return pixels;
  }

  celulaPorChave(k) {
    const [q, c] = k.split(':');
    return this.celula(q, c);
  }

  indiceCamada(id) {
    return this.camadas.findIndex((c) => c.id === id);
  }

  indiceQuadro(id) {
    return this.quadros.findIndex((q) => q.id === id);
  }

  camada(id) {
    return this.camadas.find((c) => c.id === id) ?? null;
  }

  adicionarCamada(nome, posicao = this.camadas.length) {
    const camada = {
      id: novoId('c'),
      nome: nome ?? `Camada ${this.camadas.length + 1}`,
      visivel: true,
      opacidade: 100,
      bloqueada: false,
    };
    this.camadas.splice(posicao, 0, camada);
    return camada;
  }

  removerCamada(id) {
    if (this.camadas.length <= 1) return false;
    const i = this.indiceCamada(id);
    if (i < 0) return false;
    this.camadas.splice(i, 1);
    for (const q of this.quadros) this.celulas.delete(this.chave(q.id, id));
    return true;
  }

  moverCamada(id, delta) {
    const i = this.indiceCamada(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.camadas.length) return false;
    const [c] = this.camadas.splice(i, 1);
    this.camadas.splice(j, 0, c);
    return true;
  }

  duplicarCamada(id) {
    const i = this.indiceCamada(id);
    if (i < 0) return null;
    const original = this.camadas[i];
    const copia = this.adicionarCamada(`${original.nome} (cópia)`, i + 1);
    copia.visivel = original.visivel;
    copia.opacidade = original.opacidade;
    for (const q of this.quadros) {
      if (this.temCelula(q.id, id)) this.celulas.set(this.chave(q.id, copia.id), this.celula(q.id, id).slice());
    }
    return copia;
  }

  mesclarAbaixo(id) {
    const i = this.indiceCamada(id);
    if (i <= 0) return false;
    const cima = this.camadas[i];
    const baixo = this.camadas[i - 1];
    const opacidade = cima.opacidade / 100;
    for (const q of this.quadros) {
      if (!this.temCelula(q.id, cima.id)) continue;
      const origem = this.celula(q.id, cima.id);
      const destino = this.celula(q.id, baixo.id);
      for (let p = 0; p < origem.length; p++) {
        if (origem[p] >>> 24) destino[p] = sobrepor(destino[p], origem[p], opacidade);
      }
    }
    this.removerCamada(cima.id);
    return true;
  }

  adicionarQuadro(posicao = this.quadros.length, duracao = null) {
    const quadro = { id: novoId('q'), duracao };
    this.quadros.splice(posicao, 0, quadro);
    return quadro;
  }

  duplicarQuadro(id) {
    const i = this.indiceQuadro(id);
    if (i < 0) return null;
    const copia = this.adicionarQuadro(i + 1, this.quadros[i].duracao);
    for (const c of this.camadas) {
      if (this.temCelula(id, c.id)) this.celulas.set(this.chave(copia.id, c.id), this.celula(id, c.id).slice());
    }
    return copia;
  }

  removerQuadro(id) {
    if (this.quadros.length <= 1) return false;
    const i = this.indiceQuadro(id);
    if (i < 0) return false;
    this.quadros.splice(i, 1);
    for (const c of this.camadas) this.celulas.delete(this.chave(id, c.id));
    return true;
  }

  moverQuadro(id, delta) {
    const i = this.indiceQuadro(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.quadros.length) return false;
    const [q] = this.quadros.splice(i, 1);
    this.quadros.splice(j, 0, q);
    return true;
  }

  compor(indiceQuadro, destino = new Uint32Array(this.total), { incluirOcultas = false } = {}) {
    destino.fill(0);
    const quadro = this.quadros[indiceQuadro];
    if (!quadro) return destino;
    for (const camada of this.camadas) {
      if (!camada.visivel && !incluirOcultas) continue;
      if (!this.temCelula(quadro.id, camada.id)) continue;
      const origem = this.celula(quadro.id, camada.id);
      const opacidade = camada.opacidade / 100;
      if (opacidade <= 0) continue;
      for (let p = 0; p < origem.length; p++) {
        const c = origem[p];
        const a = c >>> 24;
        if (a === 0) continue;
        if (a === 255 && opacidade >= 1) destino[p] = c;
        else destino[p] = sobrepor(destino[p], c, opacidade);
      }
    }
    return destino;
  }

  redimensionar(novaLargura, novaAltura, ancoraX = 0.5, ancoraY = 0.5) {
    novaLargura = validarLado(novaLargura);
    novaAltura = validarLado(novaAltura);
    const dx = Math.round((novaLargura - this.largura) * ancoraX);
    const dy = Math.round((novaAltura - this.altura) * ancoraY);
    for (const [k, origem] of this.celulas) {
      const destino = new Uint32Array(novaLargura * novaAltura);
      for (let y = 0; y < this.altura; y++) {
        const ny = y + dy;
        if (ny < 0 || ny >= novaAltura) continue;
        for (let x = 0; x < this.largura; x++) {
          const nx = x + dx;
          if (nx < 0 || nx >= novaLargura) continue;
          destino[ny * novaLargura + nx] = origem[y * this.largura + x];
        }
      }
      this.celulas.set(k, destino);
    }
    this.largura = novaLargura;
    this.altura = novaAltura;
  }

  escalar(novaLargura, novaAltura) {
    novaLargura = validarLado(novaLargura);
    novaAltura = validarLado(novaAltura);
    for (const [k, origem] of this.celulas) {
      const destino = new Uint32Array(novaLargura * novaAltura);
      for (let y = 0; y < novaAltura; y++) {
        const sy = Math.min(this.altura - 1, Math.floor(((y + 0.5) * this.altura) / novaAltura));
        for (let x = 0; x < novaLargura; x++) {
          const sx = Math.min(this.largura - 1, Math.floor(((x + 0.5) * this.largura) / novaLargura));
          destino[y * novaLargura + x] = origem[sy * this.largura + sx];
        }
      }
      this.celulas.set(k, destino);
    }
    this.largura = novaLargura;
    this.altura = novaAltura;
  }

  espelharCelula(pixels, eixo) {
    const L = this.largura;
    const A = this.altura;
    const copia = pixels.slice();
    for (let y = 0; y < A; y++) {
      for (let x = 0; x < L; x++) {
        const sx = eixo === 'horizontal' ? L - 1 - x : x;
        const sy = eixo === 'vertical' ? A - 1 - y : y;
        pixels[y * L + x] = copia[sy * L + sx];
      }
    }
  }

  girar(sentido = 1) {
    const L = this.largura;
    const A = this.altura;
    for (const [k, origem] of this.celulas) {
      const destino = new Uint32Array(L * A);
      for (let y = 0; y < A; y++) {
        for (let x = 0; x < L; x++) {
          const nx = sentido > 0 ? A - 1 - y : y;
          const ny = sentido > 0 ? x : L - 1 - x;
          destino[ny * A + nx] = origem[y * L + x];
        }
      }
      this.celulas.set(k, destino);
    }
    this.largura = A;
    this.altura = L;
  }

  coresUsadas() {
    const cores = new Map();
    for (let q = 0; q < this.quadros.length; q++) {
      const px = this.compor(q);
      for (const c of px) if (c >>> 24 && !cores.has(c)) cores.set(c, cores.size);
    }
    return [...cores.keys()];
  }

  instantaneo() {
    const celulas = new Map();
    for (const [k, px] of this.celulas) {
      let vazia = true;
      for (let i = 0; i < px.length; i++) {
        if (px[i] !== 0) {
          vazia = false;
          break;
        }
      }
      if (!vazia) celulas.set(k, codificarRLE(px));
    }
    return {
      nome: this.nome,
      largura: this.largura,
      altura: this.altura,
      fps: this.fps,
      camadas: this.camadas.map((c) => ({ ...c })),
      quadros: this.quadros.map((q) => ({ ...q })),
      celulas,
    };
  }

  restaurar(estado) {
    this.nome = estado.nome;
    this.largura = estado.largura;
    this.altura = estado.altura;
    this.fps = estado.fps;
    this.camadas = estado.camadas.map((c) => ({ ...c }));
    this.quadros = estado.quadros.map((q) => ({ ...q }));
    this.celulas = new Map();
    for (const [k, bytes] of estado.celulas) this.celulas.set(k, decodificarRLE(bytes, this.total));
  }

  static bytesDoInstantaneo(estado) {
    let total = 256 + estado.camadas.length * 96 + estado.quadros.length * 48;
    for (const bytes of estado.celulas.values()) total += bytes.byteLength + 64;
    return total;
  }
}
