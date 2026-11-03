export function gameAudio() {
  const RATE = 22050;
  const NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

  function wave(kind, phase, duty, noise) {
    const p = phase - Math.floor(phase);
    if (kind === 'square') return p < duty ? 1 : -1;
    if (kind === 'triangle') return 4 * Math.abs(p - 0.5) - 1;
    if (kind === 'sawtooth') return 2 * p - 1;
    if (kind === 'sine') return Math.sin(2 * Math.PI * p);
    return noise;
  }

  function synthesize(s, rate = RATE) {
    const duration = Math.max(0.01, Math.min(4, Number(s.duration) || 0.2));
    const n = Math.floor(duration * rate);
    const out = new Float32Array(n);
    const volume = Math.max(0, Math.min(1, Number(s.volume ?? 0.5)));
    const f0 = Math.max(20, Number(s.freq) || 440);
    const f1 = Math.max(20, Number(s.freqEnd) || f0);
    const duty = Math.max(0.05, Math.min(0.95, Number(s.duty) || 0.5));
    const vibrato = Math.max(0, Math.min(1, Number(s.vibrato) || 0));
    const arp = Number(s.arp) || 0;
    const attack = Math.min(0.01, duration / 4);
    let phase = 0;
    let lfsr = 0x7ace;
    let noise = 0;
    let noisePhase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const k = t / duration;
      let f = f0 * Math.pow(f1 / f0, k);
      if (arp && k >= 0.35) f *= Math.pow(2, arp / 12);
      if (vibrato) f *= 1 + Math.sin(t * 2 * Math.PI * 9) * 0.06 * vibrato;
      phase += f / rate;
      noisePhase += (f * 2) / rate;
      if (noisePhase >= 1) {
        noisePhase -= Math.floor(noisePhase);
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        noise = lfsr & 1 ? 1 : -1;
      }
      const env = t < attack ? t / attack : Math.pow(1 - (t - attack) / (duration - attack || 1), 1.6);
      out[i] = wave(s.wave || 'square', phase, duty, noise) * env * volume * 0.5;
    }
    return out;
  }

  function noteFrequency(token) {
    const m = /^([a-g])([#b]?)(-?\d)$/i.exec(token);
    if (!m) return 0;
    let semis = NOTES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    semis += (Number(m[3]) + 1) * 12;
    return 440 * Math.pow(2, (semis - 69) / 12);
  }

  function parseMelody(text) {
    let source = String(text || '').trim();
    let bpm = 120;
    let kind = 'square';
    const head = /^(\d{2,3})\s*:/.exec(source);
    if (head) {
      bpm = Math.max(40, Math.min(300, Number(head[1])));
      source = source.slice(head[0].length);
    }
    const waveHead = /^\s*(quadrada|triangular|serra|seno|square|triangle|sawtooth|sine)\s*:/i.exec(source);
    if (waveHead) {
      const w = waveHead[1].toLowerCase();
      kind = { quadrada: 'square', triangular: 'triangle', serra: 'sawtooth', seno: 'sine' }[w] || w;
      source = source.slice(waveHead[0].length);
    }
    const steps = [];
    for (const raw of source.split(/\s+/).filter(Boolean).slice(0, 1024)) {
      const [token, mult] = raw.split('*');
      const length = Math.max(1, Math.min(16, Number(mult) || 1));
      if (token === '-' || token === '.') steps.push({ f: 0, length });
      else {
        const f = noteFrequency(token);
        if (f) steps.push({ f, length });
      }
    }
    return { bpm, wave: kind, steps };
  }

  function renderMelody(text, rate = RATE) {
    const { bpm, wave: kind, steps } = parseMelody(text);
    if (!steps.length) return null;
    const step = 60 / bpm / 2;
    const total = steps.reduce((s, x) => s + x.length, 0);
    const out = new Float32Array(Math.ceil(total * step * rate));
    let at = 0;
    for (const s of steps) {
      const duration = s.length * step;
      if (s.f) {
        const tone = synthesize({ wave: kind, freq: s.f, freqEnd: s.f, duration: duration * 0.92, volume: 0.32, duty: 0.5 }, rate);
        out.set(tone.subarray(0, Math.min(tone.length, out.length - at)), at);
      }
      at += Math.round(duration * rate);
    }
    return out;
  }

  function mixer() {
    let context = null;
    let musicNode = null;
    let musicKey = null;
    let muted = false;
    const cache = new Map();
    const ensure = () => {
      if (context) return context;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      try {
        context = new AC();
      } catch {
        context = null;
      }
      return context;
    };
    const bufferOf = (key, render) => {
      const ctx = ensure();
      if (!ctx) return null;
      if (cache.has(key)) return cache.get(key);
      const data = render();
      if (!data || !data.length) return null;
      const buffer = ctx.createBuffer(1, data.length, RATE);
      buffer.getChannelData(0).set(data);
      cache.set(key, buffer);
      return buffer;
    };
    const start = (buffer, loop) => {
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = loop;
      node.connect(context.destination);
      node.start();
      return node;
    };
    return {
      resume() {
        const ctx = ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      },
      play(sound) {
        if (muted || !sound) return;
        const buffer = bufferOf(JSON.stringify(sound), () => synthesize(sound));
        if (buffer) start(buffer, false);
      },
      music(text) {
        if (musicKey === text) return;
        this.stopMusic();
        musicKey = text;
        if (!text || muted) return;
        const buffer = bufferOf('music:' + text, () => renderMelody(text));
        if (buffer) musicNode = start(buffer, true);
      },
      stopMusic() {
        if (musicNode) {
          try {
            musicNode.stop();
          } catch {
            musicNode = null;
          }
        }
        musicNode = null;
        musicKey = null;
      },
      toggleMute() {
        muted = !muted;
        if (muted) this.stopMusic();
        return muted;
      },
      close() {
        this.stopMusic();
        if (context) context.close().catch(() => {});
        context = null;
        cache.clear();
      },
    };
  }

  return { RATE, synthesize, parseMelody, renderMelody, noteFrequency, mixer };
}
