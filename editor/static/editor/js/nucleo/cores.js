export const TRANSPARENTE = 0;

export function limitar(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function empacotar(r, g, b, a = 255) {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function desempacotar(c) {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}

export function alfa(c) {
  return (c >>> 24) & 255;
}

export function hexParaCor(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
  return empacotar((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

const duas = (v) => v.toString(16).padStart(2, '0');

export function corParaHex(c, sempreAlfa = false) {
  const [r, g, b, a] = desempacotar(c);
  return '#' + duas(r) + duas(g) + duas(b) + (sempreAlfa || a !== 255 ? duas(a) : '');
}

export function corParaHex6(c) {
  const [r, g, b] = desempacotar(c);
  return '#' + duas(r) + duas(g) + duas(b);
}

export function comAlfa(c, a) {
  return ((c & 0x00ffffff) | ((a & 255) << 24)) >>> 0;
}

export function rgbParaHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslParaRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [canal(h + 1 / 3), canal(h), canal(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const linear = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const gama = (v) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function rgbParaOklab(r, g, b) {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabParaRgbLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabParaRgb(L, a, b) {
  return oklabParaRgbLinear(L, a, b).map((v) => limitar(Math.round(gama(limitar(v, 0, 1))), 0, 255));
}

export function rgbParaOklch(r, g, b) {
  const [L, a, bb] = rgbParaOklab(r, g, b);
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

function dentroDaGama(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const rgb = oklabParaRgbLinear(L, C * Math.cos(rad), C * Math.sin(rad));
  return rgb.every((v) => v >= -0.0005 && v <= 1.0005);
}

export function oklchParaRgb(L, C, H) {
  L = limitar(L, 0, 1);
  C = Math.max(0, C);
  if (!dentroDaGama(L, C, H)) {
    let baixo = 0;
    let alto = C;
    for (let i = 0; i < 24; i++) {
      const meio = (baixo + alto) / 2;
      if (dentroDaGama(L, meio, H)) baixo = meio;
      else alto = meio;
    }
    C = baixo;
  }
  const rad = (H * Math.PI) / 180;
  return oklabParaRgb(L, C * Math.cos(rad), C * Math.sin(rad));
}

function aproximarMatiz(h, alvo, quanto) {
  let d = ((alvo - h + 540) % 360) - 180;
  const passo = Math.sign(d) * Math.min(Math.abs(d), quanto);
  return (h + passo + 360) % 360;
}

export const MATIZ_LUZ = 95;
export const MATIZ_SOMBRA = 275;

export function gerarTons(cor, { passos = 3, intensidade = 0.8, desvioMatiz = 18, saturacao = 0 } = {}) {
  const [r, g, b, a] = desempacotar(cor);
  const [L, C, H] = rgbParaOklch(r, g, b);
  const cinza = C < 0.012;
  const escuros = [];
  const claros = [];
  for (let i = 1; i <= passos; i++) {
    const t = (i / passos) * limitar(intensidade, 0, 1);
    const Ls = L - (L - 0.08) * t;
    const Ll = L + (0.985 - L) * t;
    const Hs = cinza ? H : aproximarMatiz(H, MATIZ_SOMBRA, desvioMatiz * t);
    const Hl = cinza ? H : aproximarMatiz(H, MATIZ_LUZ, desvioMatiz * t);
    const Cs = cinza ? C : C * (1 - 0.15 * t) * (1 + saturacao);
    const Cl = cinza ? C : C * (1 - 0.55 * t) * (1 + saturacao);
    escuros.push(empacotar(...oklchParaRgb(Ls, Cs, Hs), a));
    claros.push(empacotar(...oklchParaRgb(Ll, Cl, Hl), a));
  }
  return { escuros: escuros.reverse(), base: cor, claros, rampa: [...escuros, cor, ...claros] };
}

export function distancia(c1, c2) {
  const a = desempacotar(c1);
  const b = desempacotar(c2);
  if (a[3] === 0 && b[3] === 0) return 0;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
}

export function sobrepor(fundo, frente, opacidade = 1) {
  const sa = (((frente >>> 24) & 255) / 255) * opacidade;
  if (sa <= 0) return fundo;
  const da = ((fundo >>> 24) & 255) / 255;
  if (sa >= 1 || da === 0) {
    if (sa >= 1) return frente;
    return comAlfa(frente, Math.round(sa * 255));
  }
  const oa = sa + da * (1 - sa);
  const mix = (s, d) => Math.round((s * sa + d * da * (1 - sa)) / oa);
  return empacotar(
    mix(frente & 255, fundo & 255),
    mix((frente >>> 8) & 255, (fundo >>> 8) & 255),
    mix((frente >>> 16) & 255, (fundo >>> 16) & 255),
    Math.round(oa * 255),
  );
}

export function luminancia(c) {
  const [r, g, b] = desempacotar(c);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
