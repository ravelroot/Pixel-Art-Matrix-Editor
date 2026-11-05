import { PixelDocument } from '../document.js';
import { serialize } from '../format.js';
import { hexToColor } from '../colors.js';
import { newGame, newScene, newActor, newSound } from './project.js';

const COLORS = {
  k: '#2b1d17',
  w: '#5d1c16',
  c: '#5c4034',
  o: '#7a6e46',
  l: '#e6ddce',
  y: '#f6e4a6',
  r: '#d6bdb8',
  s: '#a3b4be',
  g: '#55602f',
  G: '#8a9a4a',
  R: '#d04a3a',
  W: '#faf6ef',
  h: '#8fa3a8',
  H: '#7b9088',
  b: '#2f4a5c',
  B: '#456a80',
};

function sprite(name, width, height, frames, { tags = [], duration = null, fps = 8 } = {}) {
  const doc = new PixelDocument(width, height, { name, fps, palette: Object.values(COLORS), empty: true });
  const layer = doc.addLayer('Arte');
  frames.forEach((rows, i) => {
    const frame = doc.addFrame(i, duration);
    const cell = doc.cell(frame.id, layer.id);
    const data = typeof rows === 'function' ? rows() : rows;
    for (let y = 0; y < height; y++) {
      const line = data[y] || '';
      for (let x = 0; x < width; x++) {
        const ch = line[x];
        if (ch && COLORS[ch]) cell[y * width + x] = hexToColor(COLORS[ch]);
      }
    }
  });
  for (const t of tags) doc.addTag({ name: t[0], from: doc.frames[t[1]].id, to: doc.frames[t[2]].id, color: '#7a6e46' });
  return serialize(doc);
}

function grid(width, height, paint) {
  const rows = Array.from({ length: height }, () => new Array(width).fill('.'));
  paint((x, y, ch) => {
    if (x >= 0 && y >= 0 && x < width && y < height) rows[y][x] = ch;
  });
  return rows.map((r) => r.join(''));
}

const HERO = [
  ['..kkkk..', '.kwwwwk.', 'kwwwwwwk', 'kwwlwwlk', 'kwwkwwkk', 'kwwwwwwk', '.kwwwwk.', '..k..k..'],
  ['........', '..kkkk..', '.kwwwwk.', 'kwwwwwwk', 'kwwlwwlk', 'kwwkwwkk', 'kwwwwwwk', '.kk..kk.'],
  ['..kkkk..', '.kwwwwk.', 'kwwwwwwk', 'kwwlwwlk', 'kwwkwwkk', 'kwwwwwwk', '.kwwwwk.', '.k...k..'],
  ['..kkkk..', '.kwwwwk.', 'kwwwwwwk', 'kwwlwwlk', 'kwwkwwkk', 'kwwwwwwk', '.kwwwwk.', '...k.k..'],
  ['..kkkk..', '.kwwwwk.', 'kwwlwwlk', 'kwwkwwkk', 'kwwwwwwk', 'kwwwwwwk', '.kwwwwk.', 'k......k'],
];

const COIN = [
  ['..kkkk..', '.kyyyyk.', 'kyWyyyck', 'kyWyyyck', 'kyyyyyck', 'kyyyyyck', '.kcccck.', '..kkkk..'],
  ['...kk...', '..kyyk..', '..kWyk..', '..kWyk..', '..kyyk..', '..kyck..', '..kcck..', '...kk...'],
  ['...kk...', '...kk...', '...kk...', '...kk...', '...kk...', '...kk...', '...kk...', '...kk...'],
  ['...kk...', '..kyyk..', '..kWyk..', '..kWyk..', '..kyyk..', '..kyck..', '..kcck..', '...kk...'],
];

const SLIME = [
  ['........', '........', '..kkkk..', '.kGGGGk.', 'kGWkGWkk', 'kGGGGGGk', 'kGGGGGGk', '.kkkkkk.'],
  ['........', '........', '........', '..kkkk..', '.kGGGGk.', 'kGWkGWkk', 'kGGGGGGk', 'kkkkkkkk'],
];

const BAT = [
  ['w......w', 'ww....ww', 'wwwwwwww', '.wwywyw.', '..wwww..', '........', '........', '........'],
  ['........', '........', '..wwww..', '.wwywyw.', 'wwwwwwww', 'ww....ww', 'w......w', '........'],
];

const FLAG = [
  ['k.......', 'kRRRR...', 'kRRRRR..', 'kRRR....', 'k.......', 'k.......', 'k.......', 'kk......'],
  ['k.......', 'kRRR....', 'kRRRRRR.', 'kRRRR...', 'k.......', 'k.......', 'k.......', 'kk......'],
];

const HEART = [['........', '.kk.kk..', 'kRRkRRk.', 'kRWRRRk.', 'kRRRRRk.', '.kRRRk..', '..kRk...', '...k....']];
const SPARK = [['.yy.', 'yWWy', 'yWWy', '.yy.'], ['.WW.', 'WyyW', 'WyyW', '.WW.']];

const TILES = [
  ['GGGGGGGG', 'GGgGGGgG', 'gggggggg', 'cccocccc', 'cccccccc', 'ccccccoc', 'cocccccc', 'cccccccc'],
  ['cccccccc', 'cccccocc', 'cocccccc', 'cccccccc', 'ccccoccc', 'cccccccc', 'coccccco', 'cccccccc'],
  ['wwwwwwwk', 'wrwwwwwk', 'kkkkkkkk', 'wwwkwwww', 'wwwkwrww', 'kkkkkkkk', 'wwwwwwwk', 'wwwwwwwk'],
  ['kkkkkkkk', 'oyoooyoo', 'oooooooo', 'kkkkkkkk', '.k....k.', '.k....k.', '........', '........'],
  ['........', '...k...k', '..kWk.kW', '..kWk.kW', '.kWsWkWs', '.kWsWkWs', 'kWsssWss', 'kkkkkkkk'],
  ['kkkkkkkk', 'kWWsssck', 'kWssssck', 'kssssssk', 'kssssssk', 'kssssssk', 'kcccccck', 'kkkkkkkk'],
  ['........', '........', '...R....', '..RyR...', '...R....', '...g.G..', '..Gg.g..', '...g....'],
  ['........', '........', '........', '........', '.G...G..', '.gG.Gg.G', 'G.g.g.Gg', '........'],
  ['c......c', 'cooooooc', 'c......c', 'c......c', 'cooooooc', 'c......c', 'c......c', 'cooooooc'],
  ['BhBBBhBB', 'bBbbbBbb', 'bbbbbbbb', 'bbBbbbbb', 'bbbbbbBb', 'bbbbbbbb', 'bBbbbbbb', 'bbbbbbbb'],
  ['WWWWWWWW', 'WsssWsss', 'ssssssss', 'sWssssWs', 'ssssssss', 'ssWsssss', 'ssssssWs', 'hhhhhhhh'],
  ['kckkkckk', 'cwckkkwc', 'kkkcwkkk', 'kwkkkkck', 'kkckkwkk', 'ckkwkkkc', 'kkkkckkk', 'kwkckkkw'],
  ['BBhBBBBh', 'bbBbbbbB', 'bbbbbbbb', 'bbbbBbbb', 'bbbbbbbb', 'bBbbbbbb', 'bbbbbBbb', 'bbbbbbbb'],
  ['hBBBhBBB', 'Bbbbbbbb', 'bbbbbbbb', 'bbbbbbBb', 'bBbbbbbb', 'bbbbbbbb', 'bbbBbbbb', 'bbbbbbbb'],
  ['kckkkckk', 'cwckkkwc', 'kkkcskkk', 'kwkksWck', 'kkcksskk', 'ckkwkkkc', 'kkkkckkk', 'kwkckkkw'],
  ['kckkkckk', 'cwckkkwc', 'kkkcWkkk', 'kwkksWck', 'kkckWskk', 'ckkwkkkc', 'kkkkckkk', 'kwkckkkw'],
];

const TORCH = [
  ['...y....', '..yRy...', '..RyR...', '...R....', '..kck...', '...c....', '...c....', '..kcck..'],
  ['....y...', '...yRy..', '..RyyR..', '...RR...', '..kck...', '...c....', '...c....', '..kcck..'],
  ['...yy...', '..yWRy..', '..RyR...', '...R....', '..kck...', '...c....', '...c....', '..kcck..'],
];
const PLATFORM = [['kkkkkkkkkkkkkkkk', 'cocccoccccocccoc', 'cccccccccccccccc', 'k.k..........k.k']];
const SPRING = [
  ['........', '........', '........', '........', '.RRRRRR.', '..k..k..', '.kkkkkk.', 'kssssssk'],
  ['.RRRRRR.', '..k..k..', '...kk...', '..k..k..', '...kk...', '..k..k..', '.kkkkkk.', 'kssssssk'],
];
const LAMP = [
  ['..kkkk..', '..kssk..', '..kssk..', '..kkkk..', '...kk...', '...cc...', '...cc...', '..kcck..'],
  ['..kkkk..', '..kyWk..', '..kyyk..', '..kkkk..', '...kk...', '...cc...', '...cc...', '..kcck..'],
  ['..kkkk..', '..kWyk..', '..kyyk..', '..kkkk..', '...kk...', '...cc...', '...cc...', '..kcck..'],
];
const MINER = [
  ['..yyyy..', '.kyyyyk.', '.krrrrk.', '.krkrkk.', '.krrrrk.', '..kcckk.', '.kcccck.', '..k..k..'],
  ['........', '..yyyy..', '.kyyyyk.', '.krrrrk.', '.krkrkk.', '.krrrrk.', '.kcccck.', '..k..k..'],
];

function tileSheet() {
  const rows = [];
  for (let r = 0; r < 4; r++) for (let y = 0; y < 8; y++) rows.push(TILES.slice(r * 4, r * 4 + 4).map((t) => t[y]).join(''));
  return [rows];
}

function hills() {
  return [
    () =>
      grid(96, 48, (set) => {
        for (let x = 0; x < 96; x++) {
          const far = Math.round(22 + Math.sin((x / 96) * Math.PI * 4) * 5 + Math.sin((x / 96) * Math.PI * 2) * 3);
          const near = Math.round(32 + Math.sin((x / 96) * Math.PI * 2 + 1) * 6);
          for (let y = far; y < 48; y++) set(x, y, 'h');
          for (let y = near; y < 48; y++) set(x, y, 'H');
        }
        for (const [cx, cy, rx] of [
          [18, 8, 7],
          [62, 12, 9],
        ]) {
          for (let y = -3; y <= 3; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / 9 <= 1) set(cx + x, cy + y, 'W');
        }
      }),
  ];
}

function paintRow(scene, row, from, to, tile) {
  for (let c = from; c <= to; c++) if (c >= 0 && c < scene.cols && row >= 0 && row < scene.rows) scene.tiles[row * scene.cols + c] = tile;
}

export function sampleGame() {
  const game = newGame('Gotinha e as moedas');
  game.sprites = [
    { id: 'sprite_heroi', name: 'Gotinha', data: sprite('Gotinha', 8, 8, HERO, { tags: [['parado', 0, 1], ['andando', 2, 3], ['pulando', 4, 4]], duration: 160 }) },
    { id: 'sprite_moeda', name: 'Moeda', data: sprite('Moeda', 8, 8, COIN, { duration: 120 }) },
    { id: 'sprite_gosma', name: 'Gosma', data: sprite('Gosma', 8, 8, SLIME, { duration: 260 }) },
    { id: 'sprite_morcego', name: 'Morcego', data: sprite('Morcego', 8, 8, BAT, { duration: 140 }) },
    { id: 'sprite_bandeira', name: 'Bandeira', data: sprite('Bandeira', 8, 8, FLAG, { duration: 300 }) },
    { id: 'sprite_coracao', name: 'Coração', data: sprite('Coração', 8, 8, HEART) },
    { id: 'sprite_faisca', name: 'Faísca', data: sprite('Faísca', 4, 4, SPARK, { duration: 80 }) },
    { id: 'sprite_tiles', name: 'Tiles do campo', data: sprite('Tiles do campo', 32, 32, tileSheet()) },
    { id: 'sprite_tocha', name: 'Tocha', data: sprite('Tocha', 8, 8, TORCH, { duration: 110 }) },
    { id: 'sprite_plataforma', name: 'Plataforma', data: sprite('Plataforma', 16, 4, PLATFORM) },
    { id: 'sprite_mola', name: 'Mola', data: sprite('Mola', 8, 8, SPRING, { tags: [['parada', 0, 0], ['ativa', 1, 1]] }) },
    { id: 'sprite_lampiao', name: 'Lampião', data: sprite('Lampião', 8, 8, LAMP, { tags: [['apagado', 0, 0], ['aceso', 1, 2]], duration: 180 }) },
    { id: 'sprite_mineiro', name: 'Mineiro', data: sprite('Mineiro', 8, 8, MINER, { duration: 420 }) },
    { id: 'sprite_morros', name: 'Morros', data: sprite('Morros', 96, 48, hills()) },
  ];
  game.tilesets = [{ id: 'tiles_campo', name: 'Campo', sprite: 'sprite_tiles', tileWidth: 8, tileHeight: 8, flags: { 1: 'solid', 2: 'solid', 3: 'solid', 4: 'platform', 5: 'hazard', 6: 'solid', 9: 'ladder', 10: 'water', 11: 'ice', 12: 'solid', 15: 'solid' }, anims: [{ tile: 10, frames: [10, 13, 14, 13], fps: 3 }, { tile: 15, frames: [15, 16], fps: 1.5 }] }];
  const sounds = {};
  for (const key of ['jump', 'coin', 'hurt', 'explosion', 'shoot', 'powerup']) {
    const s = newSound(key);
    s.id = `som_${key}`;
    sounds[key] = s;
  }
  const fanfare = { ...newSound('powerup'), id: 'som_vitoria', name: 'Vitória', freq: 523, freqEnd: 1046, duration: 0.9, arp: 7, vibrato: 0.2 };
  game.sounds = [...Object.values(sounds), fanfare];
  game.winSound = 'som_vitoria';
  game.loseSound = 'som_hurt';
  const make = (id, name, spriteId, behavior, extra = {}) => {
    const a = newActor(name, spriteId, behavior);
    a.id = id;
    Object.assign(a.props, extra.props || {});
    Object.assign(a.anims, extra.anims || {});
    Object.assign(a.sounds, extra.sounds || {});
    if (extra.hitbox) a.hitbox = extra.hitbox;
    if (extra.light) a.light = extra.light;
    return a;
  };
  game.actors = [
    make('ator_heroi', 'Gotinha', 'sprite_heroi', 'platformer', { props: { shoot: 'ator_faisca', dash: true }, light: { radius: 34, color: '#ffe7b0', flicker: false }, anims: { idle: 'parado', run: 'andando', jump: 'pulando', fall: 'pulando' }, sounds: { jump: 'som_jump', hurt: 'som_hurt', die: 'som_explosion', shoot: 'som_shoot' }, hitbox: { x: 1, y: 1, w: 6, h: 7 } }),
    make('ator_moeda', 'Moeda', 'sprite_moeda', 'item', { sounds: { collect: 'som_coin' }, hitbox: { x: 1, y: 0, w: 6, h: 8 }, light: { radius: 9, color: '#f6e4a6', flicker: false } }),
    make('ator_gosma', 'Gosma', 'sprite_gosma', 'patrol', { sounds: { die: 'som_explosion' }, hitbox: { x: 0, y: 3, w: 8, h: 5 } }),
    make('ator_morcego', 'Morcego', 'sprite_morcego', 'flyer', { props: { range: 40, speed: 28 }, sounds: { die: 'som_explosion' }, hitbox: { x: 1, y: 1, w: 6, h: 5 } }),
    make('ator_bandeira', 'Bandeira', 'sprite_bandeira', 'goal', { sounds: { collect: 'som_powerup' } }),
    make('ator_coracao', 'Coração', 'sprite_coracao', 'item', { props: { points: 0, heal: 1 }, sounds: { collect: 'som_powerup' } }),
    make('ator_faisca', 'Faísca', 'sprite_faisca', 'projectile', { props: { speed: 170, life: 0.6 } }),
    make('ator_guardiao', 'Morcego guardião', 'sprite_morcego', 'custom', { props: { collide: false, friction: 1.5 }, sounds: { die: 'som_explosion' }, hitbox: { x: 1, y: 1, w: 6, h: 5 } }),
    make('ator_tocha', 'Tocha', 'sprite_tocha', 'decor', { light: { radius: 30, color: '#ffb35c', flicker: true } }),
    make('ator_plataforma', 'Plataforma', 'sprite_plataforma', 'mover', { props: { speed: 24, range: 40, wait: 0.5, oneway: true } }),
    make('ator_mola', 'Mola', 'sprite_mola', 'spring', { props: { power: 290 }, anims: { idle: 'parada', active: 'ativa' }, sounds: { activate: 'som_jump' }, hitbox: { x: 0, y: 4, w: 8, h: 4 } }),
    make('ator_lampiao', 'Lampião', 'sprite_lampiao', 'checkpoint', { props: { heal: true }, anims: { idle: 'apagado', active: 'aceso' }, sounds: { activate: 'som_powerup' } }),
    make('ator_mineiro', 'Mineiro', 'sprite_mineiro', 'npc', { props: { speaker: 'Mineiro', say: 'Que escuro! Sua luz mostra o caminho.|Atravesse a água nadando: Z dá uma braçada.|Suba a escada, acenda o lampião e pule na mola.|Shift dá uma investida. Boa sorte, Gotinha!' }, sounds: { talk: 'som_coin' } }),
    make('ator_cacador', 'Morcego caçador', 'sprite_morcego', 'pathfinder', { props: { speed: 30, range: 88, health: 1 }, sounds: { die: 'som_explosion' }, hitbox: { x: 1, y: 1, w: 6, h: 5 } }),
    make('ator_aviso', 'Aviso da saída', 'sprite_tocha', 'zone', { props: { signal: 'saida' }, hitbox: { x: 0, y: 0, w: 8, h: 96 } }),
  ];
  game.actors.find((a) => a.id === 'ator_tocha').light = { radius: 30, color: '#ffb35c', flicker: true };
  const lamp = game.actors.find((a) => a.id === 'ator_lampiao');
  lamp.light = { radius: 26, color: '#f6e4a6', flicker: false };
  lamp.events = [{ id: 'ev_lampiao', type: 'signal', signal: 'lampiao', if: { kind: 'expr', lang: 'crivo', code: 'active' }, then: [{ type: 'code', code: 'acender(self)' }] }];
  const guard = game.actors.find((a) => a.id === 'ator_guardiao');
  guard.depth = -1;
  guard.events = [
    { id: 'ev_criar', type: 'create', then: [{ type: 'setAlarm', target: 'self', alarm: 0, seconds: 1 }] },
    { id: 'ev_alarme', type: 'alarm', alarm: 0, if: { kind: 'chance', value: 80 }, then: [{ type: 'towards', target: 'self', speed: 45 }, { type: 'setAlarm', target: 'self', alarm: 0, seconds: 1.2 }] },
    { id: 'ev_alarme_falhou', type: 'alarm', alarm: 0, if: { kind: 'chance', value: 100 }, then: [{ type: 'setAlarm', target: 'self', alarm: 0, seconds: 1.2 }] },
    { id: 'ev_heroi', type: 'collision', other: 'ator_heroi', then: [{ type: 'damage', target: 'other', value: 1 }, { type: 'reverseX', target: 'self' }, { type: 'reverseY', target: 'self' }] },
    { id: 'ev_faisca', type: 'collision', other: 'ator_faisca', then: [{ type: 'addLocal', target: 'self', local: 'acertos', value: 1 }, { type: 'destroy', target: 'other' }, { type: 'shake', seconds: 0.15 }] },
    { id: 'ev_passo', type: 'step', if: { kind: 'local', local: 'acertos', op: '>=', value: 2 }, then: [{ type: 'code', code: 'explodir(self)\nglobal.pontos += 5\nsound_play("Explosão")\ninstance_destroy()' }] },
  ];
  game.scripts = [
    {
      id: 'script_cpp',
      name: 'pontuacao_cpp',
      lang: 'cpp',
      code: '#include <crivo>\n\nint bonus_por_vida(int vidas) {\n  return vidas * 10;\n}\n\nvoid relatorio() {\n  std::cout << "C++: " << global::pontos << " pontos, bônus " << bonus_por_vida(global::vidas) << std::endl;\n}\n',
    },
    {
      id: 'script_lua',
      name: 'magia_lua',
      lang: 'lua',
      code: 'function chuva_de_moedas(n)\n  for i = 1, n do\n    instance_create("Moeda", x + i * 10, y - 24)\n  end\n  return bonus_por_vida(n)\nend\n',
    },
    {
      id: 'script_mina',
      name: 'mina',
      code: 'global.mochila = { moedas: 0, lampioes: 0 }\n\nfunction acender(lampiao) {\n  global.mochila.lampioes += 1\n  effect("sparkle", lampiao.x + 4, lampiao.y + 2)\n  tween(lampiao, "light", 34, 0.6, "out_elastic", true)\n  floating_text(lampiao.x + 4, lampiao.y - 4, "salvo!", "#f6e4a6")\n}\n\nfunction resumo() {\n  return "lampiões acesos: " + string(global.mochila.lampioes)\n}\n',
    },
    {
      id: 'script_efeitos',
      name: 'efeitos',
      code: 'global.recorde = 0\n\nfunction explodir(alvo) {\n  particles(alvo.x + 4, alvo.y + 4, 18, "#f6e4a6", 70, 0.6)\n  shake(0.2)\n}\n\nfunction placar() {\n  return "pontos: " + string(global.pontos) + " | vidas: " + string(global.vidas)\n}\n',
    },
  ];
  const one = newScene('Fase 1: o campo', 48, 15);
  one.id = 'cena_1';
  one.tileset = 'tiles_campo';
  one.backdrop = 'sprite_morros';
  one.music = '150: C5 E5 G5 E5 C5 E5 G5*2 A4 C5 E5 C5 A4 C5 E5*2 F4 A4 C5 A4 G4 B4 D5*2 C5 - G4 - C5*2 - -';
  paintRow(one, 13, 0, 47, 1);
  paintRow(one, 14, 0, 47, 2);
  paintRow(one, 13, 14, 16, 0);
  paintRow(one, 14, 14, 16, 0);
  paintRow(one, 13, 30, 32, 0);
  paintRow(one, 14, 30, 32, 0);
  paintRow(one, 9, 7, 10, 4);
  paintRow(one, 9, 14, 16, 4);
  paintRow(one, 8, 19, 22, 4);
  paintRow(one, 12, 24, 25, 5);
  paintRow(one, 7, 34, 38, 4);
  paintRow(one, 12, 41, 42, 6);
  paintRow(one, 11, 42, 42, 6);
  for (const c of [3, 12, 27, 44]) paintRow(one, 12, c, c, 7);
  for (const c of [6, 18, 35, 38]) paintRow(one, 12, c, c, 8);
  const coins = [[60, 64], [68, 64], [76, 64], [120, 64], [128, 64], [160, 56], [168, 56], [176, 56], [240, 96], [248, 96], [280, 48], [288, 48], [296, 48], [304, 48]];
  one.entities = [
    { id: 'o1', actor: 'ator_heroi', x: 16, y: 96, flip: false },
    ...coins.map(([x, y], i) => ({ id: `m${i}`, actor: 'ator_moeda', x, y, flip: false })),
    { id: 'g1', actor: 'ator_gosma', x: 208, y: 96, flip: false },
    { id: 'g2', actor: 'ator_gosma', x: 272, y: 96, flip: true },
    { id: 'c1', actor: 'ator_coracao', x: 312, y: 40, flip: false },
    { id: 'b1', actor: 'ator_bandeira', x: 368, y: 96, flip: false },
  ];
  const two = newScene('Fase 2: a caverna', 40, 15);
  two.id = 'cena_2';
  two.tileset = 'tiles_campo';
  two.background = '#56656e';
  two.music = '130: A4 C5 E5 C5 A4 - E4 - F4 A4 C5 A4 F4 - C4 - G4 B4 D5 B4 G4 - D4 - E4 G#4 B4 E5*2 - - -';
  paintRow(two, 13, 0, 39, 6);
  paintRow(two, 14, 0, 39, 2);
  for (const [a, b] of [[10, 12], [24, 26]]) {
    paintRow(two, 13, a, b, 0);
    paintRow(two, 14, a, b, 0);
  }
  paintRow(two, 0, 0, 39, 3);
  paintRow(two, 10, 9, 13, 4);
  paintRow(two, 10, 23, 27, 4);
  paintRow(two, 6, 15, 20, 3);
  paintRow(two, 12, 33, 33, 5);
  paintRow(two, 12, 34, 34, 5);
  const coins2 = [[80, 72], [88, 72], [96, 72], [128, 40], [136, 40], [144, 40], [152, 40], [192, 72], [200, 72], [208, 72], [240, 96], [248, 96]];
  two.entities = [
    { id: 'o1', actor: 'ator_heroi', x: 16, y: 96, flip: false },
    ...coins2.map(([x, y], i) => ({ id: `m${i}`, actor: 'ator_moeda', x, y, flip: false })),
    { id: 'z1', actor: 'ator_morcego', x: 120, y: 56, flip: false },
    { id: 'z2', actor: 'ator_morcego', x: 232, y: 48, flip: true },
    { id: 'z3', actor: 'ator_guardiao', x: 280, y: 24, flip: true },
    { id: 'g1', actor: 'ator_gosma', x: 152, y: 96, flip: false },
    { id: 'b1', actor: 'ator_bandeira', x: 304, y: 96, flip: false },
  ];
  const three = newScene('Fase 3: a mina escura', 56, 15);
  three.id = 'cena_3';
  three.tileset = 'tiles_campo';
  three.background = '#1d1613';
  three.ambient = 78;
  three.ambientColor = '#07050c';
  three.weather = 'embers';
  three.camera = 'smooth';
  three.music = '110: triangular: E4 G4 B4 G4 E4 - D4 - C4 E4 G4 E4 B3*2 - - A3 C4 E4 C4 B3 - G3 - E3*2 - - - -';
  paintRow(three, 0, 0, 55, 12);
  for (const row of [12, 13, 14]) {
    paintRow(three, row, 0, 11, 12);
    paintRow(three, row, 18, 30, 12);
    paintRow(three, row, 39, 55, 12);
  }
  paintRow(three, 12, 12, 17, 10);
  paintRow(three, 13, 12, 17, 10);
  paintRow(three, 14, 12, 17, 12);
  for (let r = 5; r <= 11; r++) paintRow(three, r, 22, 22, 9);
  paintRow(three, 5, 23, 30, 4);
  paintRow(three, 5, 39, 43, 4);
  paintRow(three, 3, 45, 50, 4);
  paintRow(three, 11, 27, 28, 11);
  three.back = new Array(three.cols * three.rows).fill(0);
  for (const [c, r] of [[3, 3], [9, 6], [15, 2], [33, 8], [36, 4], [47, 8], [52, 5], [27, 9]]) three.back[r * three.cols + c] = 15;
  for (const c of [5, 20, 41, 50]) three.tiles[12 * three.cols + c] = 15;
  const coins3 = [[104, 80], [112, 80], [120, 80], [128, 80], [232, 32], [240, 32], [368, 16], [376, 16], [384, 16], [392, 16], [416, 64]];
  three.entities = [
    { id: 'o1', actor: 'ator_heroi', x: 8, y: 88, flip: false },
    { id: 'n1', actor: 'ator_mineiro', x: 40, y: 88, flip: true },
    { id: 't1', actor: 'ator_tocha', x: 24, y: 88, flip: false },
    { id: 't2', actor: 'ator_tocha', x: 88, y: 88, flip: false },
    { id: 't3', actor: 'ator_tocha', x: 160, y: 88, flip: false },
    { id: 't4', actor: 'ator_tocha', x: 216, y: 32, flip: false },
    { id: 't5', actor: 'ator_tocha', x: 328, y: 32, flip: false },
    { id: 't6', actor: 'ator_tocha', x: 408, y: 88, flip: false },
    { id: 'l1', actor: 'ator_lampiao', x: 200, y: 32, flip: false },
    { id: 'p1', actor: 'ator_plataforma', x: 248, y: 40, flip: false },
    { id: 's1', actor: 'ator_mola', x: 360, y: 88, flip: false },
    { id: 'z1', actor: 'ator_cacador', x: 440, y: 48, flip: true },
    ...coins3.map(([x, y], i) => ({ id: `m${i}`, actor: 'ator_moeda', x, y, flip: false })),
    { id: 'b1', actor: 'ator_bandeira', x: 424, y: 88, flip: false },
    { id: 'g1', actor: 'ator_aviso', x: 400, y: 0, flip: false },
  ];
  one.weather = 'leaves';
  two.ambient = 40;
  two.weather = '';
  game.scenes = [one, two, three];
  game.start = one.id;
  game.rules = [
    { id: 'regra_1', scene: 'cena_1', when: { type: 'start' }, then: [{ type: 'message', text: 'Pegue as moedas e chegue à bandeira! X solta faíscas.', seconds: 3 }], note: '' },
    { id: 'regra_2', scene: 'cena_2', when: { type: 'start' }, then: [{ type: 'message', text: 'Fase 2: cuidado com os morcegos!', seconds: 2.5 }], note: '' },
    { id: 'regra_3', scene: '', when: { type: 'var', name: 'pontos', op: '>=', value: 20 }, then: [{ type: 'add', name: 'vidas', value: 1 }, { type: 'sound', sound: 'som_powerup' }, { type: 'message', text: '20 moedas: +1 vida!', seconds: 2 }], note: '' },
    { id: 'regra_4', scene: '', when: { type: 'destroyed', actor: 'ator_gosma' }, then: [{ type: 'add', name: 'pontos', value: 2 }, { type: 'code', code: 'explodir(self)' }], note: '' },
    { id: 'regra_5', scene: 'cena_3', when: { type: 'start' }, then: [{ type: 'message', text: 'Fase 3: a mina escura. Fale com o mineiro (X).', seconds: 3 }], note: '' },
    { id: 'regra_6', scene: '', when: { type: 'checkpoint' }, then: [{ type: 'signal', signal: 'lampiao' }, { type: 'flash', color: '#f6e4a6', seconds: 0.25 }], note: '' },
    { id: 'regra_7', scene: 'cena_3', when: { type: 'signal', signal: 'saida' }, then: [{ type: 'message', text: 'A saída! Cuidado com o morcego caçador.', seconds: 2.5 }, { type: 'cameraZoom', zoom: 1.25, seconds: 0.6 }, { type: 'wait', seconds: 2 }, { type: 'cameraZoom', zoom: 1, seconds: 0.6 }], note: '' },
  ];
  return game;
}

