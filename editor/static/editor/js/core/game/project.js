import { newId } from '../document.js';

export const GAME_FORMAT = 'crivo-jogo';
export const GAME_VERSION = 2;
export const GAME_EXTENSION = 'crivojogo';
export const MAX_SCENE_SIDE = 512;
export const MAX_VIEW = 3840;
export const MAX_CODE = 20000;
export const SIZE_PRESETS = [8, 16, 32, 64, 128, 256, 512, 1024];
export const CODE_LANGS = [
  ['crivo', 'Crivo Script'],
  ['cpp', 'C++'],
  ['lua', 'Lua'],
];
export const CODE_TEMPLATES = {
  crivo: 'function exemplo(n) {\n  return n * 2\n}\n',
  cpp: '#include <crivo>\n\nint exemplo(int n) {\n  return n * 2;\n}\n',
  lua: 'function exemplo(n)\n  return n * 2\nend\n',
};
export const RESOLUTION_FOR = { 8: [160, 120], 16: [320, 240], 32: [640, 480], 64: [1280, 720], 128: [1920, 1080], 256: [2560, 1440], 512: [3840, 2160], 1024: [3840, 2160] };

export const BEHAVIORS = {
  platformer: { label: 'Jogador (plataforma)', props: { speed: 70, jump: 175, jumps: 1, health: 3, shoot: '', cooldown: 0.35, walljump: false, dash: false, climb: true }, anims: ['idle', 'run', 'jump', 'fall', 'hurt', 'climb', 'wall', 'dash', 'swim'], sounds: ['jump', 'hurt', 'die', 'shoot', 'land', 'dash'] },
  topdown: { label: 'Jogador (visão de cima)', props: { speed: 60, health: 3, shoot: '', cooldown: 0.35, dash: false }, anims: ['idle', 'run', 'hurt', 'dash'], sounds: ['hurt', 'die', 'shoot', 'dash'] },
  patrol: { label: 'Inimigo que patrulha', props: { speed: 25, health: 1, damage: 1, gravity: true, edges: true, stompable: true, range: 0 }, anims: ['idle', 'run'], sounds: ['die'] },
  chase: { label: 'Inimigo que persegue', props: { speed: 35, health: 2, damage: 1, gravity: false, range: 72, stompable: true }, anims: ['idle', 'run'], sounds: ['die'] },
  flyer: { label: 'Inimigo voador', props: { speed: 30, health: 1, damage: 1, range: 32, wave: 6, stompable: true }, anims: ['idle', 'run'], sounds: ['die'] },
  item: { label: 'Item coletável', props: { points: 1, heal: 0 }, anims: ['idle'], sounds: ['collect'] },
  hazard: { label: 'Perigo', props: { damage: 1 }, anims: ['idle'], sounds: [] },
  goal: { label: 'Saída (vai para outra cena)', props: { scene: '' }, anims: ['idle'], sounds: ['collect'] },
  projectile: { label: 'Projétil', props: { speed: 160, damage: 1, life: 1.2, gravity: false }, anims: ['idle'], sounds: ['spawn'] },
  block: { label: 'Bloco sólido', props: { breakable: false, health: 1 }, anims: ['idle'], sounds: ['die'] },
  decor: { label: 'Decoração', props: {}, anims: ['idle'], sounds: [] },
  custom: { label: 'Objeto livre (só eventos)', props: { gravity: false, collide: true, friction: 0, health: 1 }, anims: ['idle', 'run', 'jump', 'fall'], sounds: ['die'] },
  mover: { label: 'Plataforma móvel', props: { speed: 30, range: 48, vertical: false, oneway: true, wait: 0.4 }, anims: ['idle'], sounds: [] },
  spring: { label: 'Mola (trampolim)', props: { power: 300 }, anims: ['idle', 'active'], sounds: ['activate'] },
  checkpoint: { label: 'Ponto de controle', props: { heal: false }, anims: ['idle', 'active'], sounds: ['activate'] },
  npc: { label: 'Personagem que fala (NPC)', props: { speaker: '', say: 'Olá!', auto: false }, anims: ['idle', 'run'], sounds: ['talk'] },
  pathfinder: { label: 'Inimigo que acha o caminho (A*)', props: { speed: 40, health: 2, damage: 1, range: 160, stompable: true }, anims: ['idle', 'run'], sounds: ['die'] },
  turret: { label: 'Torre que atira', props: { shoot: '', cooldown: 1.2, range: 120, aim: true, sight: true, health: 3, damage: 1, stompable: false }, anims: ['idle', 'active'], sounds: ['die'] },
  zone: { label: 'Área de gatilho', props: { signal: '', once: true, hidden: true }, anims: ['idle', 'active'], sounds: ['activate'] },
  emitter: { label: 'Emissor de partículas', props: { effect: 'fire', every: 0.2, amount: 3, range: 0 }, anims: ['idle'], sounds: [] },
  spawner: { label: 'Gerador de atores', props: { spawns: '', every: 3, max: 3, range: 0 }, anims: ['idle', 'active'], sounds: ['spawn'] },
};

export const MAX_ALARMS = 12;
export const EASES = [
  ['linear', 'Linear'],
  ['in_quad', 'Acelera (quadrática)'],
  ['out_quad', 'Desacelera (quadrática)'],
  ['in_out_quad', 'Acelera e desacelera'],
  ['out_cubic', 'Desacelera (cúbica)'],
  ['in_out_sine', 'Suave (seno)'],
  ['out_back', 'Passa e volta'],
  ['out_elastic', 'Elástico'],
  ['out_bounce', 'Quica'],
];
export const TWEEN_PROPS = [
  ['x', 'X'],
  ['y', 'Y'],
  ['alpha', 'Opacidade (0 a 1)'],
  ['xscale', 'Escala X'],
  ['yscale', 'Escala Y'],
  ['scale', 'Escala'],
  ['angle', 'Rotação (graus)'],
  ['light', 'Raio da luz'],
];
export const PARTICLE_PRESETS = [
  ['explosion', 'Explosão'],
  ['dust', 'Poeira'],
  ['sparkle', 'Brilho'],
  ['smoke', 'Fumaça'],
  ['fire', 'Fogo'],
  ['splash', 'Respingo'],
  ['confetti', 'Confete'],
  ['magic', 'Magia'],
];
export const WEATHER = [
  ['', 'Nenhum'],
  ['rain', 'Chuva'],
  ['snow', 'Neve'],
  ['leaves', 'Folhas'],
  ['embers', 'Brasas'],
];
export const CAMERA_MODES = [
  ['smooth', 'Suave (segue com atraso)'],
  ['deadzone', 'Zona morta (só mexe perto da borda)'],
  ['snap', 'Presa ao jogador'],
  ['fixed', 'Fixa'],
];
export const SCREEN_FILTERS = [
  ['', 'Nenhum'],
  ['scanlines', 'Linhas de varredura'],
  ['crt', 'Tubo CRT (linhas e vinheta)'],
  ['lcd', 'LCD de portátil'],
  ['vignette', 'Vinheta'],
];
export const TRANSITIONS = [
  ['', 'Corte seco'],
  ['fade', 'Esmaecer'],
  ['iris', 'Íris (círculo)'],
];

export const EVENTS = {
  create: { label: 'Criar (quando surge)', fields: [] },
  step: { label: 'Passo (a cada quadro, 60 por segundo)', fields: [] },
  destroy: { label: 'Destruir', fields: [] },
  alarm: { label: 'Alarme', fields: ['alarm'] },
  collision: { label: 'Colisão com', fields: ['other'] },
  keyPress: { label: 'Tecla apertada', fields: ['key'] },
  keyDown: { label: 'Tecla segurada', fields: ['key'] },
  keyRelease: { label: 'Tecla solta', fields: ['key'] },
  outside: { label: 'Saiu da cena', fields: [] },
  animationEnd: { label: 'Fim da animação', fields: [] },
  sceneStart: { label: 'Início da cena', fields: [] },
  landed: { label: 'Tocou o chão', fields: [] },
  hurt: { label: 'Levou dano', fields: [] },
  signal: { label: 'Recebeu um sinal', fields: ['signal'] },
  mousePress: { label: 'Clique do mouse no ator', fields: [] },
  draw: { label: 'Desenhar (no mundo)', fields: [] },
  drawGui: { label: 'Desenhar na tela (HUD)', fields: [] },
  dialogEnd: { label: 'Fim do diálogo', fields: [] },
};

export const CONDITIONS = {
  '': { label: 'Sempre', fields: [] },
  var: { label: 'Se a variável global', fields: ['name', 'op', 'value'] },
  local: { label: 'Se a variável do ator', fields: ['local', 'op', 'value'] },
  count: { label: 'Se a quantidade de atores', fields: ['actor', 'op', 'value'] },
  chance: { label: 'Se a sorte deixar (%)', fields: ['value'] },
  ground: { label: 'Se está no chão', fields: [] },
  air: { label: 'Se está no ar', fields: [] },
  key: { label: 'Se o botão está segurado', fields: ['key'] },
  near: { label: 'Se o jogador está perto (px)', fields: ['value'] },
  sees: { label: 'Se vê o jogador (sem parede no meio)', fields: [] },
  expr: { label: 'Se a expressão em código for verdadeira', fields: ['lang', 'code'] },
};

export const PROP_LABELS = {
  speed: ['Velocidade', 'px/s', 0, 20000, 1],
  jump: ['Força do pulo', 'px/s', 0, 40000, 1],
  jumps: ['Pulos no ar', 'vezes', 1, 5, 1],
  health: ['Vida', 'pontos', 1, 99, 1],
  damage: ['Dano', 'pontos', 0, 99, 1],
  range: ['Alcance', 'px', 0, 100000, 1],
  wave: ['Ondulação', 'px', 0, 8192, 1],
  points: ['Pontos', '', -9999, 9999, 1],
  heal: ['Recupera vida', 'pontos', 0, 99, 1],
  life: ['Duração', 's', 0, 30, 0.1],
  cooldown: ['Intervalo entre tiros', 's', 0.05, 5, 0.05],
  gravity: ['Sofre gravidade'],
  edges: ['Vira na beirada'],
  stompable: ['Morre quando pisado'],
  breakable: ['Quebra com tiros'],
  collide: ['Bate nos tiles sólidos'],
  friction: ['Atrito', '', 0, 60, 0.5],
  shoot: ['Atira (projétil)'],
  scene: ['Vai para a cena'],
  walljump: ['Pulo na parede (desliza e pula)'],
  dash: ['Investida (Shift ou L)'],
  climb: ['Sobe escadas'],
  vertical: ['Anda na vertical'],
  oneway: ['Só segura por cima'],
  wait: ['Pausa nas pontas', 's', 0, 30, 0.1],
  power: ['Força do impulso', 'px/s', 0, 40000, 1],
  speaker: ['Nome de quem fala'],
  say: ['Fala (separe as páginas com |)'],
  auto: ['Fala sozinho ao encostar'],
  aim: ['Mira no jogador'],
  sight: ['Só atira se vir o jogador'],
  signal: ['Envia o sinal'],
  once: ['Só dispara uma vez'],
  hidden: ['Invisível no jogo'],
  effect: ['Efeito'],
  every: ['Intervalo', 's', 0.02, 10, 0.01],
  amount: ['Partículas por vez', '', 1, 40, 1],
  spawns: ['Gera o ator'],
  max: ['Máximo vivos ao mesmo tempo', '', 1, 50, 1],
};

export const STRING_LIMITS = { say: 600, speaker: 40 };

export const ANIM_LABELS = { idle: 'Parado', run: 'Andando', jump: 'Pulando', fall: 'Caindo', hurt: 'Machucado', climb: 'Subindo escada', wall: 'Na parede', dash: 'Investida', swim: 'Nadando', active: 'Ativo' };
export const SOUND_SLOTS = { jump: 'Ao pular', hurt: 'Ao levar dano', die: 'Ao morrer', shoot: 'Ao atirar', collect: 'Ao ser pego', spawn: 'Ao surgir', land: 'Ao tocar o chão', dash: 'Na investida', activate: 'Ao ativar', talk: 'Ao falar' };
export const TILE_FLAGS = [
  ['', 'Vazio (passa por ele)'],
  ['solid', 'Sólido'],
  ['platform', 'Plataforma (sobe por baixo)'],
  ['hazard', 'Perigo (dá dano)'],
  ['ladder', 'Escada (sobe e desce)'],
  ['water', 'Água (nada devagar)'],
  ['ice', 'Gelo (escorrega)'],
  ['bounce', 'Mola (quica alto)'],
];
export const TILE_FLAG_NAMES = TILE_FLAGS.map(([k]) => k).filter(Boolean);

export const TRIGGERS = {
  start: { label: 'Ao começar a cena', fields: [] },
  touch: { label: 'Quando um ator toca em outro', fields: ['a', 'b'] },
  press: { label: 'Ao apertar um botão', fields: ['key'] },
  every: { label: 'A cada N segundos', fields: ['seconds'] },
  var: { label: 'Quando uma variável chegar a', fields: ['name', 'op', 'value'] },
  destroyed: { label: 'Quando um ator for destruído', fields: ['actor'] },
  cleared: { label: 'Quando não sobrar nenhum ator', fields: ['actor'] },
  hurt: { label: 'Quando o jogador levar dano', fields: [] },
  died: { label: 'Quando o jogador morrer', fields: [] },
  jump: { label: 'Quando o jogador pular', fields: [] },
  goal: { label: 'Quando o jogador chegar à saída', fields: ['actor'] },
  signal: { label: 'Quando um sinal for enviado', fields: ['signal'] },
  checkpoint: { label: 'Quando o jogador marcar um ponto de controle', fields: [] },
  land: { label: 'Quando o jogador tocar o chão', fields: [] },
};

export const ACTIONS = {
  add: { label: 'Somar à variável', fields: ['name', 'value'] },
  set: { label: 'Mudar a variável para', fields: ['name', 'value'] },
  destroy: { label: 'Destruir', fields: ['target'] },
  destroyAll: { label: 'Destruir todos os atores do tipo', fields: ['actor'] },
  damage: { label: 'Dar dano', fields: ['target', 'value'] },
  heal: { label: 'Recuperar vida', fields: ['target', 'value'] },
  spawn: { label: 'Criar ator', fields: ['actor', 'at', 'dx', 'dy', 'vx', 'vy'] },
  sound: { label: 'Tocar som', fields: ['sound'] },
  message: { label: 'Mostrar mensagem', fields: ['text', 'seconds'] },
  bounce: { label: 'Impulsionar para cima', fields: ['target', 'value'] },
  velocity: { label: 'Mudar a velocidade', fields: ['target', 'vx', 'vy'] },
  teleport: { label: 'Teletransportar', fields: ['target', 'x', 'y'] },
  shake: { label: 'Tremer a tela', fields: ['seconds'] },
  goto: { label: 'Ir para a cena', fields: ['scene'] },
  next: { label: 'Ir para a próxima cena', fields: [] },
  restart: { label: 'Reiniciar a cena', fields: [] },
  win: { label: 'Vencer o jogo', fields: ['text'] },
  lose: { label: 'Perder o jogo', fields: ['text'] },
  setAlarm: { label: 'Ligar alarme', fields: ['target', 'alarm', 'seconds'] },
  addLocal: { label: 'Somar à variável do ator', fields: ['target', 'local', 'value'] },
  setLocal: { label: 'Mudar a variável do ator', fields: ['target', 'local', 'value'] },
  motion: { label: 'Mover numa direção', fields: ['target', 'direction', 'speed'] },
  towards: { label: 'Ir em direção ao jogador', fields: ['target', 'speed'] },
  reverseX: { label: 'Inverter o movimento horizontal', fields: ['target'] },
  reverseY: { label: 'Inverter o movimento vertical', fields: ['target'] },
  stop: { label: 'Parar', fields: ['target'] },
  gravity: { label: 'Ligar ou desligar a gravidade', fields: ['target', 'toggle'] },
  animation: { label: 'Trocar a animação', fields: ['target', 'anim'] },
  jumpStart: { label: 'Voltar ao ponto de partida', fields: ['target'] },
  music: { label: 'Tocar música', fields: ['text'] },
  stopMusic: { label: 'Parar a música', fields: [] },
  prev: { label: 'Voltar para a cena anterior', fields: [] },
  particles: { label: 'Soltar partículas', fields: ['target', 'count', 'color', 'speed'] },
  code: { label: 'Executar código', fields: ['lang', 'code'] },
  tween: { label: 'Animar propriedade (tween)', fields: ['target', 'prop', 'value', 'seconds', 'ease'] },
  signal: { label: 'Enviar sinal', fields: ['signal'] },
  dialog: { label: 'Mostrar diálogo', fields: ['speaker', 'text', 'signal'] },
  float: { label: 'Texto flutuante', fields: ['target', 'text', 'color'] },
  effect: { label: 'Efeito de partículas', fields: ['target', 'preset', 'count', 'color'] },
  flash: { label: 'Piscar a tela', fields: ['color', 'seconds'] },
  cameraZoom: { label: 'Zoom da câmera', fields: ['zoom', 'seconds'] },
  cameraFollow: { label: 'Câmera segue', fields: ['target'] },
  slowmo: { label: 'Câmera lenta', fields: ['factor', 'seconds'] },
  hitstop: { label: 'Congelar o jogo (impacto)', fields: ['seconds'] },
  light: { label: 'Mudar a luz do ator', fields: ['target', 'radius', 'color'] },
  ambient: { label: 'Mudar a escuridão da cena (%)', fields: ['value'] },
  scale: { label: 'Mudar o tamanho do ator', fields: ['target', 'value'] },
  checkpoint: { label: 'Marcar ponto de controle aqui', fields: ['target'] },
  save: { label: 'Salvar o jogo', fields: ['slot'] },
  load: { label: 'Carregar o jogo salvo', fields: ['slot'] },
  wait: { label: 'Esperar e continuar depois', fields: ['seconds'] },
};

export const KEY_LABELS = { jump: 'Pular (Z ou Espaço)', action: 'Ação (X)', dash: 'Investida (Shift ou L)', up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita' };
export const TARGET_LABELS = { self: 'este ator (self)', other: 'o outro (na colisão)', a: 'o ator A (quem tocou)', b: 'o ator B (quem foi tocado)', player: 'o jogador' };
export const OPERATORS = ['>=', '<=', '==', '!=', '>', '<'];

export const SOUND_PRESETS = {
  jump: { name: 'Pulo', wave: 'square', freq: 280, freqEnd: 620, duration: 0.18, volume: 0.5, duty: 0.25, vibrato: 0, arp: 0 },
  coin: { name: 'Moeda', wave: 'square', freq: 988, freqEnd: 988, duration: 0.25, volume: 0.45, duty: 0.5, vibrato: 0, arp: 5 },
  hurt: { name: 'Dano', wave: 'sawtooth', freq: 320, freqEnd: 70, duration: 0.3, volume: 0.5, duty: 0.5, vibrato: 0, arp: 0 },
  explosion: { name: 'Explosão', wave: 'noise', freq: 900, freqEnd: 80, duration: 0.55, volume: 0.6, duty: 0.5, vibrato: 0, arp: 0 },
  powerup: { name: 'Power-up', wave: 'square', freq: 220, freqEnd: 880, duration: 0.6, volume: 0.45, duty: 0.25, vibrato: 0.3, arp: 0 },
  shoot: { name: 'Tiro', wave: 'square', freq: 1100, freqEnd: 180, duration: 0.14, volume: 0.4, duty: 0.125, vibrato: 0, arp: 0 },
  blip: { name: 'Blip', wave: 'triangle', freq: 660, freqEnd: 660, duration: 0.07, volume: 0.6, duty: 0.5, vibrato: 0, arp: 0 },
};

export const WAVES = [
  ['square', 'Quadrada'],
  ['triangle', 'Triangular'],
  ['sawtooth', 'Dente de serra'],
  ['sine', 'Senoidal'],
  ['noise', 'Ruído'],
];

const text = (v, fallback = '', max = 80) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const number = (v, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const color = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const ident = (v, prefix) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : newId(prefix));
const signalName = (v) => (typeof v === 'string' ? v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_ -]/g, '').slice(0, 32) : '');
const choice = (v, list, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const varName = (v) => (typeof v === 'string' ? v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 24) : '');

export function newGame(name = 'Meu jogo') {
  const scene = newScene('Fase 1');
  return {
    format: GAME_FORMAT,
    version: GAME_VERSION,
    name,
    width: 160,
    height: 120,
    scale: 4,
    gravity: 480,
    maxFall: 260,
    background: '#a3b4be',
    scoreVar: 'pontos',
    livesVar: 'vidas',
    winText: 'Você venceu! {pontos} pontos',
    loseText: 'Fim de jogo',
    winSound: '',
    loseSound: '',
    sprites: [],
    tilesets: [],
    actors: [],
    scenes: [scene],
    sounds: [],
    vars: [
      { name: 'pontos', value: 0, hud: true, label: 'Pontos' },
      { name: 'vidas', value: 3, hud: true, label: 'Vidas' },
    ],
    rules: [],
    scripts: [],
    gridSize: 8,
    filter: '',
    transition: 'fade',
    textSpeed: 40,
    hpBars: false,
    damageNumbers: false,
    start: scene.id,
  };
}

export function newScene(name, cols = 40, rows = 15) {
  return { id: newId('cena'), name, cols, rows, tileset: '', background: '', backdrop: '', parallax: 50, music: '', ambient: 0, ambientColor: '#0b0812', weather: '', camera: 'smooth', zoom: 1, tiles: new Array(cols * rows).fill(0), entities: [] };
}

export function newActor(name, sprite = '', behavior = 'decor') {
  const def = BEHAVIORS[behavior] || BEHAVIORS.decor;
  return { id: newId('ator'), name, sprite, behavior, props: { ...def.props }, anims: {}, sounds: {}, hitbox: null, parent: '', depth: 0, events: [] };
}

export function newSound(preset = 'blip') {
  const p = SOUND_PRESETS[preset] || SOUND_PRESETS.blip;
  return { id: newId('som'), ...p };
}

function normalizeProps(raw, behavior) {
  const def = BEHAVIORS[behavior] || BEHAVIORS.decor;
  const out = {};
  for (const [k, v] of Object.entries(def.props)) {
    const value = raw && k in raw ? raw[k] : v;
    if (typeof v === 'boolean') out[k] = Boolean(value);
    else if (k === 'signal') out[k] = signalName(value);
    else if (k === 'effect') out[k] = PARTICLE_PRESETS.some(([id]) => id === value) ? value : v;
    else if (typeof v === 'string') out[k] = text(value, '', STRING_LIMITS[k] || 40);
    else {
      const [, , min, max] = PROP_LABELS[k] || [];
      out[k] = number(value, v, min ?? -1e6, max ?? 1e6);
    }
  }
  return out;
}

function normalizeAction(a) {
  if (!a || !ACTIONS[a.type]) return null;
  const out = { type: a.type };
  for (const f of ACTIONS[a.type].fields) {
    if (['value', 'dx', 'dy', 'vx', 'vy', 'seconds', 'x', 'y', 'direction', 'speed', 'count', 'radius'].includes(f)) out[f] = number(a[f], f === 'count' ? 12 : 0, -1e6, 1e6);
    else if (f === 'zoom') out[f] = number(a[f], 1, 0.25, 8);
    else if (f === 'factor') out[f] = number(a[f], 0.5, 0.05, 4);
    else if (f === 'slot') out[f] = Math.round(number(a[f], 0, 0, 9));
    else if (f === 'prop') out[f] = TWEEN_PROPS.some(([k]) => k === a[f]) ? a[f] : 'y';
    else if (f === 'ease') out[f] = EASES.some(([k]) => k === a[f]) ? a[f] : 'out_quad';
    else if (f === 'preset') out[f] = PARTICLE_PRESETS.some(([k]) => k === a[f]) ? a[f] : 'explosion';
    else if (f === 'signal') out[f] = signalName(a[f]);
    else if (f === 'speaker') out[f] = text(a[f], '', 40);
    else if (f === 'code') out[f] = typeof a[f] === 'string' ? a[f].slice(0, MAX_CODE) : '';
    else if (f === 'lang') out[f] = CODE_LANGS.some(([k]) => k === a[f]) ? a[f] : 'crivo';
    else if (f === 'color') out[f] = color(a[f], '#f6e4a6');
    else if (f === 'alarm') out[f] = Math.round(number(a[f], 0, 0, MAX_ALARMS - 1));
    else if (f === 'text') out[f] = text(a[f], '', a.type === 'music' || a.type === 'dialog' ? 600 : 120);
    else if (f === 'name' || f === 'local') out[f] = varName(a[f]);
    else if (f === 'toggle') out[f] = a[f] === 'off' ? 'off' : 'on';
    else if (f === 'target') out[f] = TARGET_LABELS[a[f]] ? a[f] : 'self';
    else out[f] = text(a[f], '', 40);
  }
  if (a.type === 'velocity') out.relative = Boolean(a.relative);
  return out;
}

function normalizeEvent(ev) {
  if (!ev || !EVENTS[ev.type]) return null;
  const out = { id: ident(ev.id, 'evento'), type: ev.type };
  if (ev.type === 'alarm') out.alarm = Math.round(number(ev.alarm, 0, 0, MAX_ALARMS - 1));
  if (ev.type === 'signal') out.signal = signalName(ev.signal);
  if (ev.type === 'collision') out.other = text(ev.other, '', 40);
  if (ev.type.startsWith('key')) out.key = KEY_LABELS[ev.key] ? ev.key : 'action';
  const c = ev.if;
  if (c && CONDITIONS[c.kind] && c.kind) {
    const cond = { kind: c.kind };
    for (const f of CONDITIONS[c.kind].fields) {
      if (f === 'value') cond[f] = number(c[f], 0, -1e9, 1e9);
      else if (f === 'code') cond[f] = typeof c[f] === 'string' ? c[f].slice(0, MAX_CODE) : '';
      else if (f === 'lang') cond[f] = CODE_LANGS.some(([k]) => k === c[f]) ? c[f] : 'crivo';
      else if (f === 'key') cond[f] = KEY_LABELS[c[f]] ? c[f] : 'action';
      else if (f === 'op') cond[f] = OPERATORS.includes(c[f]) ? c[f] : '>=';
      else if (f === 'name' || f === 'local') cond[f] = varName(c[f]);
      else cond[f] = text(c[f], '', 40);
    }
    out.if = cond;
  }
  out.then = (Array.isArray(ev.then) ? ev.then : []).slice(0, 32).map(normalizeAction).filter(Boolean);
  return out;
}

function normalizeRule(r) {
  if (!r || !r.when || !TRIGGERS[r.when.type]) return null;
  const when = { type: r.when.type };
  for (const f of TRIGGERS[r.when.type].fields) {
    if (['seconds', 'value'].includes(f)) when[f] = number(r.when[f], f === 'seconds' ? 1 : 0, -1e6, 1e6);
    else if (f === 'name') when[f] = varName(r.when[f]);
    else if (f === 'op') when[f] = OPERATORS.includes(r.when[f]) ? r.when[f] : '>=';
    else if (f === 'key') when[f] = KEY_LABELS[r.when[f]] ? r.when[f] : 'action';
    else if (f === 'signal') when[f] = signalName(r.when[f]);
    else when[f] = text(r.when[f], '', 40);
  }
  const then = (Array.isArray(r.then) ? r.then : []).slice(0, 32).map(normalizeAction).filter(Boolean);
  return { id: ident(r.id, 'regra'), scene: text(r.scene, '', 40), when, then, note: text(r.note, '', 120) };
}

export function normalizeGame(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('O arquivo não é um jogo do Crivo.');
  if (data.format !== GAME_FORMAT) throw new Error('O arquivo não é um jogo do Crivo (.crivojogo).');
  if (Number(data.version) > GAME_VERSION) throw new Error('Este jogo foi salvo por um Crivo mais novo.');
  const base = newGame();
  const sprites = (Array.isArray(data.sprites) ? data.sprites : []).slice(0, 256).filter((s) => s && typeof s.data === 'object' && s.data).map((s) => ({ id: ident(s.id, 'sprite'), name: text(s.name, 'Sprite'), data: s.data }));
  const spriteIds = new Set(sprites.map((s) => s.id));
  const tilesets = (Array.isArray(data.tilesets) ? data.tilesets : []).slice(0, 64).map((t) => {
    const flags = {};
    if (t?.flags && typeof t.flags === 'object') {
      for (const [k, v] of Object.entries(t.flags)) if (/^\d{1,5}$/.test(k) && TILE_FLAG_NAMES.includes(v)) flags[k] = v;
    }
    const anims = (Array.isArray(t?.anims) ? t.anims : []).slice(0, 64).map((a) => ({ tile: Math.round(number(a?.tile, 0, 0, 65535)), frames: (Array.isArray(a?.frames) ? a.frames : []).slice(0, 32).map((f) => Math.round(number(f, 0, 1, 65535))).filter((f) => f > 0), fps: number(a?.fps, 4, 0.5, 60) })).filter((a) => a.tile > 0 && a.frames.length > 1);
    return { id: ident(t?.id, 'tiles'), name: text(t?.name, 'Tiles'), sprite: spriteIds.has(t?.sprite) ? t.sprite : '', tileWidth: Math.round(number(t?.tileWidth, 8, 2, 1024)), tileHeight: Math.round(number(t?.tileHeight, 8, 2, 1024)), flags, ...(anims.length ? { anims } : {}) };
  });
  const actors = (Array.isArray(data.actors) ? data.actors : []).slice(0, 256).map((a) => {
    const behavior = BEHAVIORS[a?.behavior] ? a.behavior : 'decor';
    const anims = {};
    for (const k of Object.keys(ANIM_LABELS)) if (typeof a?.anims?.[k] === 'string' && a.anims[k]) anims[k] = a.anims[k].slice(0, 80);
    const sounds = {};
    for (const k of Object.keys(SOUND_SLOTS)) if (typeof a?.sounds?.[k] === 'string' && a.sounds[k]) sounds[k] = a.sounds[k].slice(0, 40);
    const hb = a?.hitbox;
    const hitbox = hb && typeof hb === 'object' ? { x: number(hb.x, 0, 0, 1024), y: number(hb.y, 0, 0, 1024), w: number(hb.w, 8, 1, 1024), h: number(hb.h, 8, 1, 1024) } : null;
    const events = (Array.isArray(a?.events) ? a.events : []).slice(0, 64).map(normalizeEvent).filter(Boolean);
    const lt = a?.light;
    const light = lt && typeof lt === 'object' && Number(lt.radius) > 0 ? { radius: Math.round(number(lt.radius, 0, 0, 2048)), color: color(lt.color, '#ffd98a'), flicker: Boolean(lt.flicker) } : null;
    return { id: ident(a?.id, 'ator'), name: text(a?.name, 'Ator'), sprite: spriteIds.has(a?.sprite) ? a.sprite : '', behavior, props: normalizeProps(a?.props, behavior), anims, sounds, hitbox, parent: text(a?.parent, '', 40), depth: Math.round(number(a?.depth, 0, -1000, 1000)), ...(light ? { light } : {}), events };
  });
  const actorIds = new Set(actors.map((a) => a.id));
  for (const a of actors) if (!actorIds.has(a.parent) || a.parent === a.id) a.parent = '';
  const scenes = (Array.isArray(data.scenes) ? data.scenes : []).slice(0, 128).map((s) => {
    const cols = Math.round(number(s?.cols, 40, 1, MAX_SCENE_SIDE));
    const rows = Math.round(number(s?.rows, 15, 1, MAX_SCENE_SIDE));
    const tiles = new Array(cols * rows).fill(0);
    const src = Array.isArray(s?.tiles) ? s.tiles : [];
    for (let i = 0; i < tiles.length && i < src.length; i++) tiles[i] = Math.round(number(src[i], 0, 0, 65535));
    const entities = (Array.isArray(s?.entities) ? s.entities : []).slice(0, 4096).filter((e) => actorIds.has(e?.actor)).map((e) => {
      const item = { id: ident(e.id, 'obj'), actor: e.actor, x: Math.round(number(e.x, 0, -1e7, 1e7)), y: Math.round(number(e.y, 0, -1e7, 1e7)), flip: Boolean(e.flip) };
      if (typeof e.code === 'string' && e.code.trim()) {
        item.code = e.code.slice(0, MAX_CODE);
        item.lang = CODE_LANGS.some(([k]) => k === e.lang) ? e.lang : 'crivo';
      }
      return item;
    });
    let back;
    if (Array.isArray(s?.back) && s.back.some((v) => Number(v) > 0)) {
      back = new Array(cols * rows).fill(0);
      for (let i = 0; i < back.length && i < s.back.length; i++) back[i] = Math.round(number(s.back[i], 0, 0, 65535));
    }
    return {
      id: ident(s?.id, 'cena'),
      name: text(s?.name, 'Cena'),
      cols,
      rows,
      ...(back ? { back } : {}),
      tileset: text(s?.tileset, '', 40),
      background: color(s?.background, ''),
      backdrop: spriteIds.has(s?.backdrop) ? s.backdrop : '',
      parallax: Math.round(number(s?.parallax, 50, 0, 100)),
      music: text(s?.music, '', 400),
      ambient: Math.round(number(s?.ambient, 0, 0, 100)),
      ambientColor: color(s?.ambientColor, '#0b0812'),
      weather: choice(s?.weather, WEATHER, ''),
      camera: choice(s?.camera, CAMERA_MODES, 'smooth'),
      zoom: number(s?.zoom, 1, 0.25, 8),
      persistent: Boolean(s?.persistent),
      tiles,
      entities,
    };
  });
  if (!scenes.length) scenes.push(newScene('Fase 1'));
  const sounds = (Array.isArray(data.sounds) ? data.sounds : []).slice(0, 128).map((s) => ({
    id: ident(s?.id, 'som'),
    name: text(s?.name, 'Som'),
    wave: WAVES.some(([w]) => w === s?.wave) ? s.wave : 'square',
    freq: number(s?.freq, 440, 20, 8000),
    freqEnd: number(s?.freqEnd, 440, 20, 8000),
    duration: number(s?.duration, 0.2, 0.01, 4),
    volume: number(s?.volume, 0.5, 0, 1),
    duty: number(s?.duty, 0.5, 0.05, 0.95),
    vibrato: number(s?.vibrato, 0, 0, 1),
    arp: number(s?.arp, 0, -24, 24),
  }));
  const seen = new Set();
  const vars = (Array.isArray(data.vars) ? data.vars : base.vars).slice(0, 32).map((v) => ({ name: varName(v?.name), value: number(v?.value, 0, -1e9, 1e9), hud: Boolean(v?.hud), label: text(v?.label, '', 24) })).filter((v) => v.name && !seen.has(v.name) && seen.add(v.name));
  const rules = (Array.isArray(data.rules) ? data.rules : []).slice(0, 256).map(normalizeRule).filter(Boolean);
  const scripts = (Array.isArray(data.scripts) ? data.scripts : []).slice(0, 128).filter((x) => x && typeof x.code === 'string').map((x) => ({ id: ident(x.id, 'script'), name: text(x.name, 'script', 60) || 'script', lang: CODE_LANGS.some(([k]) => k === x.lang) ? x.lang : 'crivo', code: x.code.slice(0, MAX_CODE) }));
  const soundIds = new Set(sounds.map((s) => s.id));
  const sceneIds = new Set(scenes.map((s) => s.id));
  return {
    format: GAME_FORMAT,
    version: GAME_VERSION,
    name: text(data.name, base.name, 80) || base.name,
    width: Math.round(number(data.width, base.width, 32, MAX_VIEW)),
    height: Math.round(number(data.height, base.height, 32, 2160)),
    scale: Math.round(number(data.scale, base.scale, 1, 12)),
    gravity: number(data.gravity, base.gravity, 0, 200000),
    maxFall: number(data.maxFall, base.maxFall, 10, 200000),
    background: color(data.background, base.background),
    scoreVar: varName(data.scoreVar ?? base.scoreVar),
    livesVar: varName(data.livesVar ?? base.livesVar),
    winText: text(data.winText, base.winText, 120),
    loseText: text(data.loseText, base.loseText, 120),
    winSound: soundIds.has(data.winSound) ? data.winSound : '',
    loseSound: soundIds.has(data.loseSound) ? data.loseSound : '',
    sprites,
    tilesets,
    actors,
    scenes,
    sounds,
    vars,
    rules,
    scripts,
    gridSize: SIZE_PRESETS.includes(Number(data.gridSize)) ? Number(data.gridSize) : 8,
    filter: choice(data.filter, SCREEN_FILTERS, ''),
    transition: choice(data.transition, TRANSITIONS, 'fade'),
    textSpeed: Math.round(number(data.textSpeed, 40, 5, 400)),
    hpBars: Boolean(data.hpBars),
    damageNumbers: Boolean(data.damageNumbers),
    start: sceneIds.has(data.start) ? data.start : scenes[0].id,
  };
}

export function serializeGame(game) {
  return JSON.stringify(game);
}

export function parseGame(textValue) {
  let data;
  try {
    data = JSON.parse(textValue);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  return normalizeGame(data);
}

export function usedBy(game, kind, id) {
  if (kind === 'sprite') return [...game.actors.filter((a) => a.sprite === id).map((a) => a.name), ...game.tilesets.filter((t) => t.sprite === id).map((t) => t.name)];
  if (kind === 'actor') return game.scenes.filter((s) => s.entities.some((e) => e.actor === id)).map((s) => s.name);
  if (kind === 'tileset') return game.scenes.filter((s) => s.tileset === id).map((s) => s.name);
  return [];
}

export function removeEverywhere(game, kind, id) {
  if (kind === 'sprite') {
    game.sprites = game.sprites.filter((s) => s.id !== id);
    for (const a of game.actors) if (a.sprite === id) a.sprite = '';
    for (const t of game.tilesets) if (t.sprite === id) t.sprite = '';
    for (const s of game.scenes) if (s.backdrop === id) s.backdrop = '';
  } else if (kind === 'actor') {
    game.actors = game.actors.filter((a) => a.id !== id);
    for (const s of game.scenes) s.entities = s.entities.filter((e) => e.actor !== id);
  } else if (kind === 'tileset') {
    game.tilesets = game.tilesets.filter((t) => t.id !== id);
    for (const s of game.scenes) if (s.tileset === id) s.tileset = '';
  } else if (kind === 'scene') {
    if (game.scenes.length <= 1) return false;
    game.scenes = game.scenes.filter((s) => s.id !== id);
    game.rules = game.rules.filter((r) => r.scene !== id);
    if (game.start === id) game.start = game.scenes[0].id;
  } else if (kind === 'sound') game.sounds = game.sounds.filter((s) => s.id !== id);
  return true;
}

export function resizeScene(scene, cols, rows) {
  cols = Math.round(Math.max(1, Math.min(MAX_SCENE_SIDE, cols)));
  rows = Math.round(Math.max(1, Math.min(MAX_SCENE_SIDE, rows)));
  const tiles = new Array(cols * rows).fill(0);
  for (let r = 0; r < Math.min(rows, scene.rows); r++) for (let c = 0; c < Math.min(cols, scene.cols); c++) tiles[r * cols + c] = scene.tiles[r * scene.cols + c] || 0;
  if (Array.isArray(scene.back)) {
    const back = new Array(cols * rows).fill(0);
    for (let r = 0; r < Math.min(rows, scene.rows); r++) for (let c = 0; c < Math.min(cols, scene.cols); c++) back[r * cols + c] = scene.back[r * scene.cols + c] || 0;
    scene.back = back;
  }
  scene.cols = cols;
  scene.rows = rows;
  scene.tiles = tiles;
  return scene;
}

export function floodTiles(scene, col, row, value, layer = 'tiles') {
  const { cols, rows } = scene;
  const tiles = layer === 'back' ? (scene.back ||= new Array(cols * rows).fill(0)) : scene.tiles;
  if (col < 0 || row < 0 || col >= cols || row >= rows) return 0;
  const from = tiles[row * cols + col];
  if (from === value) return 0;
  const stack = [row * cols + col];
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    if (tiles[i] !== from) continue;
    tiles[i] = value;
    count++;
    const c = i % cols;
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (i >= cols) stack.push(i - cols);
    if (i < tiles.length - cols) stack.push(i + cols);
  }
  return count;
}
