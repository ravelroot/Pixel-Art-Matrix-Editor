import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { serialize } from '../../editor/static/editor/js/core/format.js';
import { encodeRLE, decodeRLE, toBase64 } from '../../editor/static/editor/js/core/rle.js';
import { gameEngine } from '../../editor/static/editor/js/core/game/engine.js';
import { gameAudio } from '../../editor/static/editor/js/core/game/audio.js';
import { gameScript } from '../../editor/static/editor/js/core/game/script.js';
import { compileGame, checkGame, opaqueBounds } from '../../editor/static/editor/js/core/game/compile.js';
import { gameHtml, runtimeScript } from '../../editor/static/editor/js/core/game/bundle.js';
import { sampleGame } from '../../editor/static/editor/js/core/game/sample.js';
import {
  newGame,
  newScene,
  newActor,
  normalizeGame,
  parseGame,
  serializeGame,
  resizeScene,
  floodTiles,
  removeEverywhere,
  usedBy,
  GAME_FORMAT,
} from '../../editor/static/editor/js/core/game/project.js';

const E = gameEngine();
const STEP = E.STEP;

function box(w, h, color = 0xff0000ff) {
  const doc = new PixelDocument(w, h, { name: 'Caixa' });
  doc.cell(doc.frames[0].id, doc.layers[0].id).fill(color);
  return serialize(doc);
}

function world({ tiles = {}, flags = { 1: 'solid', 2: 'platform', 3: 'hazard' }, actors = [], entities = [], rules = [], vars, scenes } = {}) {
  const game = newGame('Teste');
  game.sprites = [
    { id: 'quadrado', name: 'Quadrado', data: box(8, 8) },
    { id: 'folha', name: 'Folha', data: box(24, 8, 0xff00ff00) },
  ];
  game.tilesets = [{ id: 'ts', name: 'TS', sprite: 'folha', tileWidth: 8, tileHeight: 8, flags }];
  game.actors = actors.map(([id, behavior, props = {}, extra = {}]) => ({ ...newActor(id, 'quadrado', behavior), id, props: { ...newActor(id, 'quadrado', behavior).props, ...props }, ...extra }));
  const scene = newScene('Cena', 20, 10);
  scene.id = 'c1';
  scene.tileset = 'ts';
  for (const [row, spec] of Object.entries(tiles)) for (const [c0, c1, t] of spec) for (let c = c0; c <= c1; c++) scene.tiles[Number(row) * 20 + c] = t;
  scene.entities = entities.map(([actor, x, y], i) => ({ id: `e${i}`, actor, x, y, flip: false }));
  game.scenes = scenes ? scenes(scene) : [scene];
  game.start = game.scenes[0].id;
  game.rules = rules;
  if (vars) game.vars = vars;
  return normalizeGame(game);
}

function run(project, frames, input = {}) {
  const game = E.createGame(compileGame(project), { seed: 1 });
  game.restart();
  for (let i = 0; i < frames; i++) game.step(typeof input === 'function' ? input(i) : input, STEP);
  return game;
}

test('unpack reads the same RLE and base64 as the editor', () => {
  const pixels = new Uint32Array(300);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 7 < 3 ? 0 : (0xff000000 | (i * 2654435761)) >>> 0;
  pixels.fill(0x80112233, 100, 260);
  const text = toBase64(encodeRLE(pixels));
  assert.deepEqual(E.unpack(text, pixels.length), decodeRLE(encodeRLE(pixels), pixels.length));
  assert.deepEqual(E.unpack('', 4), new Uint32Array(4));
});

test('compileGame bakes frames, tag animations, tilesets and the visible bounds', () => {
  const data = compileGame(sampleGame());
  const hero = data.sprites.find((s) => s.id === 'sprite_heroi');
  assert.equal(hero.frames.length, 5);
  assert.deepEqual(hero.anims.andando, { frames: [2, 3], loop: true });
  assert.ok(hero.frames.every((f) => f.d > 0 && typeof f.px === 'string'));
  const ts = data.tilesets[0];
  assert.deepEqual([ts.tw, ts.th, ts.columns, ts.count], [8, 8, 4, 8]);
  assert.equal(data.scenes.length, 2);
  assert.deepEqual(checkGame(sampleGame()), []);
  const px = new Uint32Array(16);
  px[5] = 0xff000000;
  px[10] = 0xff000000;
  assert.deepEqual(opaqueBounds(px, 4, 4), { x: 1, y: 1, w: 2, h: 2 });
  assert.deepEqual(opaqueBounds(new Uint32Array(4), 2, 2), { x: 0, y: 0, w: 2, h: 2 });
});

test('normalizeGame validates the file and keeps only consistent references', () => {
  assert.throws(() => normalizeGame({ format: 'crivo' }), /não é um jogo/);
  assert.throws(() => normalizeGame({ format: GAME_FORMAT, version: 99 }), /mais novo/);
  assert.throws(() => parseGame('{'), /JSON/);
  const raw = {
    format: GAME_FORMAT,
    version: 1,
    name: 'X',
    width: 99999,
    sprites: [{ id: 's1', name: 'S', data: {} }, { id: 'bad id!', name: 'Sem dados' }],
    actors: [{ id: 'a1', sprite: 's1', behavior: 'hacker', props: { speed: 'muito' } }, { id: 'a2', sprite: 'nada', behavior: 'patrol', props: { speed: 1e9 } }],
    scenes: [{ id: 'c1', cols: 3, rows: 2, tiles: [1, 2, 3, 4, 5, 6, 7, 8], entities: [{ actor: 'a1', x: 1, y: 2 }, { actor: 'fantasma', x: 0, y: 0 }] }],
    vars: [{ name: 'Pontuação Total!', value: 2, hud: 1 }, { name: 'pontuacaototal', value: 5 }],
    rules: [{ when: { type: 'every', seconds: 'x' }, then: [{ type: 'add', name: 'Pontos', value: '3' }, { type: 'rm -rf' }] }, { when: { type: 'eval' } }],
    start: 'nenhuma',
  };
  const g = normalizeGame(raw);
  assert.equal(g.width, 3840);
  assert.equal(g.sprites.length, 1);
  assert.equal(g.actors[0].behavior, 'decor');
  assert.equal(g.actors[1].sprite, '');
  assert.equal(g.actors[1].props.speed, 20000);
  assert.equal(g.scenes[0].tiles.length, 6);
  assert.equal(g.scenes[0].entities.length, 1);
  assert.deepEqual(g.vars.map((v) => v.name), ['pontuacaototal']);
  assert.equal(g.rules.length, 1);
  assert.deepEqual(g.rules[0].then, [{ type: 'add', name: 'pontos', value: 3 }]);
  assert.equal(g.rules[0].when.seconds, 1);
  assert.equal(g.start, 'c1');
  assert.deepEqual(parseGame(serializeGame(g)), g);
});

test('scene helpers resize, flood fill and remove references', () => {
  const s = newScene('A', 3, 2);
  s.tiles = [1, 1, 2, 1, 2, 2];
  resizeScene(s, 4, 3);
  assert.deepEqual(s.tiles, [1, 1, 2, 0, 1, 2, 2, 0, 0, 0, 0, 0]);
  assert.equal(floodTiles(s, 3, 2, 5), 6);
  assert.deepEqual(s.tiles, [1, 1, 2, 5, 1, 2, 2, 5, 5, 5, 5, 5]);
  assert.equal(floodTiles(s, 9, 9, 1), 0);
  const g = sampleGame();
  assert.deepEqual(usedBy(g, 'sprite', 'sprite_tiles'), ['Campo']);
  removeEverywhere(g, 'actor', 'ator_moeda');
  assert.ok(g.scenes.every((sc) => sc.entities.every((e) => e.actor !== 'ator_moeda')));
  removeEverywhere(g, 'scene', 'cena_1');
  assert.equal(g.start, 'cena_2');
  assert.equal(removeEverywhere(g, 'scene', 'cena_2'), false);
});

test('a platformer player falls, lands on solid tiles and walks', () => {
  const p = world({ tiles: { 8: [[0, 19, 1]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 0]] });
  const game = run(p, 90);
  const hero = game.world.player;
  assert.equal(hero.y, 56);
  assert.ok(hero.ground);
  assert.equal(hero.state, 'idle');
  for (let i = 0; i < 30; i++) game.step({ right: true });
  assert.ok(hero.x > 40);
  assert.equal(hero.dir, 1);
  assert.equal(hero.state, 'run');
});

test('jumping, coyote time, one-way platforms and dropping through them', () => {
  const p = world({ tiles: { 8: [[0, 19, 1]], 5: [[0, 19, 2]] }, actors: [['heroi', 'platformer', { jump: 220 }]], entities: [['heroi', 16, 56]] });
  const game = run(p, 10);
  const hero = game.world.player;
  game.step({ jump: true, jumpPressed: true });
  let top = hero.y;
  for (let i = 0; i < 80; i++) {
    game.step({ jump: true });
    top = Math.min(top, hero.y);
  }
  assert.ok(top < 32, 'passes up through the platform');
  assert.equal(hero.y, 32, 'lands on top of the platform');
  game.step({ down: true, jumpPressed: true, jump: true });
  for (let i = 0; i < 60; i++) game.step({});
  assert.equal(hero.y, 56, 'down + jump drops through');
  assert.ok(game.effects.some((f) => f.type === 'sound' || f.type === 'music'));
});

test('items add points, hazards hurt and falling into a pit costs a life', () => {
  const p = world({
    tiles: { 8: [[0, 9, 1]], 7: [[6, 6, 3]] },
    actors: [['heroi', 'platformer', { health: 2 }], ['moeda', 'item', { points: 5 }]],
    entities: [['heroi', 0, 56], ['moeda', 16, 56]],
  });
  const game = run(p, 40, { right: true });
  assert.equal(game.vars.pontos, 5);
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 0);
  for (let i = 0; i < 30; i++) game.step({ right: true });
  assert.ok(game.world.player.health < 2 || game.vars.vidas < 3, 'the hazard tile hurts');
  for (let i = 0; i < 400 && game.vars.vidas === 3; i++) game.step({ right: true });
  assert.equal(game.vars.vidas, 2);
  assert.equal(game.world.player.x, 0, 'the scene restarts with the player back at the start');
});

test('stomping an enemy destroys it and touching it from the side hurts', () => {
  const p = world({
    tiles: { 8: [[0, 19, 1]] },
    actors: [['heroi', 'platformer', { health: 3 }], ['gosma', 'patrol', { speed: 0 }]],
    entities: [['heroi', 40, 0], ['gosma', 40, 56]],
    rules: [{ id: 'r', scene: '', when: { type: 'destroyed', actor: 'gosma' }, then: [{ type: 'add', name: 'pontos', value: 10 }] }],
  });
  const game = run(p, 60);
  assert.equal(game.world.entities.filter((e) => e.id === 'gosma').length, 0);
  assert.equal(game.vars.pontos, 10);
  assert.equal(game.world.player.health, 3);
  const side = world({ tiles: { 8: [[0, 19, 1]] }, actors: [['heroi', 'platformer', { health: 3 }], ['gosma', 'patrol', { speed: 0 }]], entities: [['heroi', 10, 56], ['gosma', 40, 56]] });
  const g2 = run(side, 60, { right: true });
  assert.equal(g2.world.player.health, 2);
  assert.ok(g2.world.player.hurt > 0);
});

test('the goal goes to the next scene and the last one wins the game', () => {
  const p = world({
    tiles: { 8: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['saida', 'goal']],
    entities: [['heroi', 0, 56], ['saida', 24, 56]],
    scenes: (one) => {
      const two = JSON.parse(JSON.stringify(one));
      two.id = 'c2';
      two.name = 'Dois';
      return [one, two];
    },
  });
  const game = run(p, 60, { right: true });
  assert.equal(game.world.scene.id, 'c2');
  for (let i = 0; i < 60; i++) game.step({ right: true });
  assert.equal(game.status, 'won');
  assert.match(game.world.message.text, /venceu/);
  for (let i = 0; i < 220; i++) game.step({});
  assert.ok(game.effects.some((f) => f.type === 'title'));
});

test('rules: touch, timers, variable thresholds, spawn, messages with {vars} and lose', () => {
  const p = world({
    tiles: { 8: [[0, 19, 1]] },
    actors: [['heroi', 'topdown'], ['bau', 'decor'], ['chave', 'block']],
    entities: [['heroi', 0, 0], ['chave', 30, 0]],
    rules: [
      { id: 'a', scene: '', when: { type: 'every', seconds: 0.5 }, then: [{ type: 'add', name: 'pontos', value: 1 }] },
      { id: 'b', scene: '', when: { type: 'var', name: 'pontos', op: '>=', value: 3 }, then: [{ type: 'spawn', actor: 'bau', at: 'player', dx: 0, dy: 0 }, { type: 'message', text: 'Pontos: {pontos}', seconds: 1 }] },
      { id: 'c', scene: '', when: { type: 'press', key: 'action' }, then: [{ type: 'destroyAll', actor: 'chave' }] },
      { id: 'd', scene: '', when: { type: 'var', name: 'pontos', op: '>=', value: 6 }, then: [{ type: 'lose', text: 'Acabou com {pontos}' }] },
    ],
  });
  const game = run(p, 95);
  assert.equal(game.vars.pontos, 3);
  assert.equal(game.world.entities.filter((e) => e.id === 'bau').length, 1, 'the threshold fires once');
  assert.equal(E.format(game.world.message.text, game.vars), 'Pontos: 3');
  for (let i = 0; i < 30; i++) game.step({ right: true });
  assert.ok(game.world.player.x + game.world.player.w <= 30.001, 'the block stops the player');
  game.step({ action: true, actionPressed: true });
  for (let i = 0; i < 20; i++) game.step({ right: true });
  assert.ok(game.world.player.x > 30, 'the rule removed the block');
  for (let i = 0; i < 120; i++) game.step({});
  assert.equal(game.status, 'lost');
  assert.equal(game.world.message.text, 'Acabou com 6');
});

test('top-down movement is normalized on diagonals and projectiles hit enemies', () => {
  const p = world({ actors: [['heroi', 'topdown', { speed: 60 }]], entities: [['heroi', 40, 40]] });
  const game = run(p, 60, { right: true, down: true });
  const hero = game.world.player;
  assert.ok(Math.abs(hero.x - 40 - 60 * Math.SQRT1_2) < 1.5);
  assert.ok(Math.abs(hero.x - hero.y) < 0.01);
  const shooter = world({
    actors: [['heroi', 'topdown', { shoot: 'tiro', cooldown: 0.1 }], ['tiro', 'projectile', { speed: 200, life: 2 }], ['morcego', 'chase', { speed: 0, health: 1 }]],
    entities: [['heroi', 10, 40], ['morcego', 80, 40]],
  });
  const g2 = run(shooter, 2);
  g2.step({ action: true, actionPressed: true });
  assert.equal(g2.world.entities.filter((e) => e.id === 'tiro').length, 1);
  for (let i = 0; i < 40; i++) g2.step({});
  assert.equal(g2.world.entities.filter((e) => e.id === 'morcego').length, 0);
  assert.equal(g2.world.entities.filter((e) => e.id === 'tiro').length, 0);
});

test('animations follow the tags mapped to each state', () => {
  const doc = new PixelDocument(4, 4, { name: 'Anim' });
  doc.addFrame();
  doc.addFrame();
  doc.frames.forEach((f, i) => (f.duration = 100 * (i + 1)));
  doc.addTag({ name: 'parado', from: doc.frames[0].id, to: doc.frames[0].id });
  doc.addTag({ name: 'andando', from: doc.frames[1].id, to: doc.frames[2].id });
  const p = world({ tiles: { 8: [[0, 19, 1]] }, actors: [['heroi', 'platformer', {}, { anims: { idle: 'parado', run: 'andando' }, hitbox: { x: 0, y: 0, w: 4, h: 4 } }]], entities: [['heroi', 0, 60]] });
  p.sprites[0].data = serialize(doc);
  const game = run(p, 5);
  assert.equal(game.world.player.frame, 0);
  for (let i = 0; i < 15; i++) game.step({ right: true });
  assert.equal(game.world.player.anim, 'andando');
  assert.equal(game.world.player.frame, 2, 'after 200 ms the second running frame shows');
});

test('the 8-bit synthesizer is deterministic and the melody parser reads notes', () => {
  const A = gameAudio();
  const s = { wave: 'square', freq: 440, freqEnd: 880, duration: 0.1, volume: 1, duty: 0.5 };
  const a = A.synthesize(s, 8000);
  assert.equal(a.length, 800);
  assert.deepEqual(a, A.synthesize(s, 8000));
  assert.ok(a.every((v) => v >= -0.5 && v <= 0.5));
  assert.ok(a.some((v) => v > 0.3));
  assert.notDeepEqual(A.synthesize({ ...s, wave: 'noise' }, 8000), a);
  assert.equal(Math.round(A.noteFrequency('A4')), 440);
  assert.equal(Math.round(A.noteFrequency('C5')), 523);
  assert.equal(Math.round(A.noteFrequency('Eb4')), 311);
  assert.equal(A.noteFrequency('H2'), 0);
  const m = A.parseMelody('90: triangular: C4 - E4*2 xx');
  assert.equal(m.bpm, 90);
  assert.equal(m.wave, 'triangle');
  assert.deepEqual(m.steps.map((x) => x.length), [1, 1, 2]);
  assert.equal(A.renderMelody(''), null);
  assert.equal(A.renderMelody('120: C4 C4', 1000).length, 500);
});

test('the exported HTML runs offline and its CSP hash matches the inline script', async () => {
  const data = compileGame(sampleGame());
  data.name = 'Fase <script>alert(1)</script> & "x"';
  const player = function gamePlayer() {
    return { play() {} };
  };
  const html = await gameHtml(data, player);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!script.includes('</script'));
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.ok(html.includes('<title>Fase &#60;script&#62;alert(1)&#60;/script&#62; &#38; &#34;x&#34;</title>'));
  assert.doesNotThrow(() => new Script(script));
  assert.equal(script, runtimeScript(data, player));
});

test('object events: create, alarms, step with conditions, keys, collision with a parent and destroy', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'topdown', { speed: 0 }], ['base', 'custom', { collide: false }], ['bola', 'custom', { collide: false }, { parent: 'base' }], ['alvo', 'custom', { collide: false }]],
    entities: [['heroi', 0, 0], ['bola', 40, 40], ['alvo', 120, 40]],
    rules: [{ id: 'r', scene: '', when: { type: 'touch', a: 'base', b: 'alvo' }, then: [{ type: 'add', name: 'pontos', value: 100 }] }],
  });
  const base = p.actors.find((a) => a.id === 'base');
  const bola = p.actors.find((a) => a.id === 'bola');
  const alvo = p.actors.find((a) => a.id === 'alvo');
  base.events = [
    { id: 'e1', type: 'create', then: [{ type: 'setAlarm', target: 'self', alarm: 1, seconds: 0.5 }] },
    { id: 'e2', type: 'alarm', alarm: 1, then: [{ type: 'motion', target: 'self', direction: 0, speed: 120 }] },
    { id: 'e3', type: 'collision', other: 'alvo', then: [{ type: 'destroy', target: 'other' }, { type: 'addLocal', target: 'self', local: 'golpes', value: 1 }] },
  ];
  bola.events = [{ id: 'e4', type: 'keyPress', key: 'action', then: [{ type: 'add', name: 'pontos', value: 1 }] }];
  alvo.events = [{ id: 'e5', type: 'destroy', then: [{ type: 'add', name: 'vidas', value: 10 }] }];
  const game = run(normalizeGame(p), 20);
  const ball = game.world.entities.find((e) => e.id === 'bola');
  assert.ok(ball.alarms[1] > 0, 'the child inherited the create event');
  assert.equal(ball.vx, 0);
  for (let i = 0; i < 20; i++) game.step({});
  assert.equal(ball.vx, 120, 'the alarm fired the motion');
  game.step({ action: true, actionPressed: true });
  game.step({ action: true });
  assert.equal(game.vars.pontos, 1, 'key press fires once');
  for (let i = 0; i < 60; i++) game.step({});
  assert.equal(game.world.entities.filter((e) => e.id === 'alvo').length, 0);
  assert.equal(ball.vars.golpes, 1);
  assert.equal(game.vars.vidas, 13, 'the destroy event of the target ran');
  assert.equal(game.vars.pontos, 101, 'touch rules match children of the actor');
  assert.ok(E.isA(game.world, ball, 'base'));
  assert.ok(!E.isA(game.world, ball, 'alvo'));
});

test('event conditions: chance, local and global variables, count, outside and animation end', () => {
  const doc = new PixelDocument(4, 4, { name: 'Anim' });
  doc.addFrame();
  doc.frames.forEach((f) => (f.duration = 100));
  doc.addTag({ name: 'uma vez', from: doc.frames[0].id, to: doc.frames[1].id });
  const p = world({
    actors: [['heroi', 'topdown', { speed: 0 }], ['coisa', 'custom', { collide: false }, { hitbox: { x: 0, y: 0, w: 4, h: 4 } }]],
    entities: [['heroi', 0, 0], ['coisa', 60, 40]],
  });
  p.sprites[0].data = serialize(doc);
  p.actors.find((a) => a.id === 'coisa').events = [
    { id: 'a', type: 'step', if: { kind: 'chance', value: 0 }, then: [{ type: 'add', name: 'pontos', value: 1000 }] },
    { id: 'b', type: 'step', if: { kind: 'local', local: 'n', op: '<', value: 3 }, then: [{ type: 'addLocal', target: 'self', local: 'n', value: 1 }] },
    { id: 'c', type: 'step', if: { kind: 'count', actor: 'coisa', op: '==', value: 1 }, then: [{ type: 'set', name: 'vidas', value: 7 }] },
    { id: 'd', type: 'animationEnd', then: [{ type: 'add', name: 'pontos', value: 1 }, { type: 'motion', target: 'self', direction: 90, speed: 600 }] },
    { id: 'e', type: 'outside', then: [{ type: 'destroy', target: 'self' }, { type: 'add', name: 'pontos', value: 10 }] },
  ];
  const game = run(normalizeGame(p), 5);
  const thing = game.world.entities.find((e) => e.id === 'coisa');
  assert.equal(thing.vars.n, 3);
  assert.equal(game.vars.vidas, 7);
  assert.equal(game.vars.pontos, 0);
  for (let i = 0; i < 12; i++) game.step({});
  assert.equal(game.vars.pontos, 1, 'the animation ended once after 200 ms');
  for (let i = 0; i < 20; i++) game.step({});
  assert.ok(thing.dead, 'leaving the scene fires Outside');
  assert.ok(game.vars.pontos >= 11);
});

const S = gameScript();

function sandbox(source, env = {}) {
  const out = [];
  const globals = new Map();
  const result = S.run(source, { print: (t) => out.push(t), globals: { has: (n) => globals.has(n), get: (n) => globals.get(n) ?? 0, set: (n, v) => globals.set(n, v) }, ...env });
  return { out, globals, result };
}

test('the script language: variables, loops, functions, arrays, strings and operators', () => {
  const { out, globals, result } = sandbox(`
    var total = 0;
    for (var i = 1; i <= 10; i++) { total += i }
    function fat(n) { if n <= 1 return 1; return n * fat(n - 1) }
    var lista = [3, 1, 2]
    array_push(lista, 9)
    global.pontos = 5
    repeat 3 global.pontos++
    var k = 0
    while true { k++; if k > 4 break }
    do { k -= 2 } until k <= 0
    print(total, fat(5), lista, lista.length, "a" + 1 + true, 7 mod 3, 7 div 2, 2 + 3 * 4, (2 + 3) * 4, 1 < 2 and not false, k)
    total > 50 ? "grande" : "pequeno"
  `);
  assert.deepEqual(out, ['55 120 [3, 1, 2, 9] 4 a1true 1 3 14 20 true -1']);
  assert.equal(globals.get('pontos'), 8);
  assert.deepEqual(result, { value: 'grande', shown: true });
  assert.equal(sandbox('point_direction(0, 0, 0, -10)').result.value, 90);
  assert.equal(Math.round(sandbox('lengthdir_x(10, 180)').result.value), -10);
  assert.equal(sandbox('string_upper("pixel") + string(3.14159)').result.value, 'PIXEL3.1416');
  assert.equal(sandbox('wrap(370, 0, 360)').result.value, 10);
});

test('the script language reports errors with the line and stops endless loops', () => {
  const cases = [
    ['var a = (1 + 2', /linha 1: esperava "\)"/],
    ['\n\nprint("oi)', /linha 3: texto sem as aspas/],
    ['while true {}', /passos/],
    ['foo()', /função desconhecida "foo"/],
    ['1 / 0', /divisão por zero/],
    ['x', /"x" não existe/],
    ['var a = "b" * 2', /esperava um número/],
    ['@', /caractere inesperado/],
    ['function f() { return f() }\nf()', /chamadas demais/],
  ];
  for (const [code, pattern] of cases) assert.throws(() => S.run(code, {}, { limit: 20000 }), pattern, code);
  assert.equal(S.check('var a = 1'), null);
  assert.match(S.check('if {'), /linha 1/);
  const scope = new Map();
  S.run('var a = 2', {}, { scope });
  assert.equal(S.run('a * 21', {}, { scope }).value, 42, 'the terminal keeps its variables');
});

test('code runs inside events, instances and scripts with the engine API', () => {
  const p = world({
    tiles: { 8: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['moeda', 'item'], ['caixa', 'custom', { collide: false }]],
    entities: [['heroi', 16, 56], ['caixa', 120, 0]],
  });
  p.scripts = [{ id: 's', name: 'util', code: 'global.recorde = 7\nfunction dobro(n) { return n * 2 }' }];
  p.actors.find((a) => a.id === 'heroi').events = [
    { id: 'e', type: 'keyPress', key: 'action', then: [{ type: 'code', code: 'global.pontos += dobro(5); var m = instance_create("moeda", x + 24, y); print(m.name, instance_number("moeda"), place_free(x, y), place_free(x, y + 8)); particles(x, y, 5, "#ff0000", 40, 0.5)' }] },
  ];
  p.scenes[0].entities[1].code = 'hspeed = 30; marcado = 1; alarm_set(0, 0.5)';
  p.actors.find((a) => a.id === 'caixa').events = [{ id: 'a', type: 'alarm', alarm: 0, then: [{ type: 'code', code: 'hspeed = -hspeed; print("virou", marcado)' }] }];
  const logs = [];
  const game = E.createGame(compileGame(normalizeGame(p)), { seed: 1, script: S, onLog: (e) => logs.push(`${e.kind}: ${e.text}`) });
  game.restart();
  assert.equal(game.vars.recorde, 7, 'the script top-level runs when the game starts');
  game.step({ action: true, actionPressed: true });
  assert.equal(game.vars.pontos, 10);
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 1);
  assert.ok(game.world.particles.length >= 5);
  assert.equal(logs[0], 'print: moeda 1 true false');
  const box = game.world.entities.find((e) => e.id === 'caixa');
  assert.equal(box.vx, 30);
  for (let i = 0; i < 40; i++) game.step({});
  assert.equal(box.vx, -30);
  assert.equal(logs.at(-1), 'print: virou 1');
  assert.equal(game.exec('dobro(global.recorde)').value, 14);
  game.exec('x = 100');
  assert.equal(game.world.player.x - game.world.player.hx, 100);
  assert.equal(game.exec('tile_get(0, 8)').value, 1);
  game.exec('tile_set(0, 8, 0)');
  assert.equal(game.world.tiles[8 * 20], 0);
  assert.throws(() => game.exec('instance_create("nada", 0, 0)'), /não existe/);
  p.actors.find((a) => a.id === 'heroi').events[0].then[0].code = 'oops(';
  const broken = E.createGame(compileGame(normalizeGame(p)), { script: S, onLog: (e) => logs.push(`${e.kind}: ${e.text}`) });
  broken.restart();
  broken.step({ action: true, actionPressed: true });
  assert.match(logs.at(-1), /^error: heroi › keyPress: linha 1/);
});

test('C++ adaptado: declarations with types, int truncation, vectors, cout, printf, switch and casts', () => {
  const out = [];
  const globals = new Map([['pontos', 0]]);
  const env = { print: (t) => out.push(t), globals: { has: (n) => globals.has(n), get: (n) => globals.get(n) ?? 0, set: (n, v) => globals.set(n, v) } };
  const result = S.run(
    `#include <iostream>
    #include <vector>
    using namespace std;
    int dobro(int n) { return n * 2; }
    void contar(const std::vector<int>& v) {
      int soma = 0;
      for (auto x : v) soma += x;
      std::cout << "soma=" << soma << std::endl;
    }
    int a = 7 / 2;
    float b = 7 / 2.0f;
    std::vector<int> lista = {1, 2, 3};
    lista.push_back(4);
    contar(lista);
    global::pontos += dobro(lista.size());
    for (int i = 0; i < 3; ++i) { if (i == 1) continue; cout << i << " "; }
    cout << endl;
    switch (a) { case 2: printf("dois\\n"); break; case 3: printf("tres %d %.2f %s\\n", a, b, "ok"); break; default: printf("outro\\n"); }
    int k = 0;
    do { k++; } while (k < 5);
    std::string nome = "pixel";
    printf("%s tem %d letras e k=%d\\n", nome.c_str(), nome.size(), k);
    (int)3.9 + static_cast<int>(2.5)`,
    env,
    { lang: 'cpp' },
  );
  assert.deepEqual(out, ['soma=10', '0 2 ', 'tres 3 3.50 ok', 'pixel tem 5 letras e k=5']);
  assert.equal(globals.get('pontos'), 8);
  assert.equal(result.value, 5);
  assert.throws(() => S.run('int x = ;', {}, { lang: 'cpp' }), /linha 1/);
  assert.throws(() => S.run('struct A {};', {}, { lang: 'cpp' }), /struct/);
});

test('Lua: local, then/end blocks, numeric and ipairs loops, 1-based tables, truthiness and string methods', () => {
  const out = [];
  const globals = new Map([['pontos', 0]]);
  const env = { print: (t) => out.push(t), globals: { has: (n) => globals.has(n), get: (n) => globals.get(n) ?? 0, set: (n, v) => globals.set(n, v) } };
  const result = S.run(
    `local function fat(n)
      if n <= 1 then return 1 end
      return n * fat(n - 1)
    end
    local t = {10, 20, 30}
    t[#t + 1] = 40
    local soma = 0
    for i, v in ipairs(t) do soma = soma + v end
    local passos = 0
    for i = 10, 1, -3 do passos = passos + 1 end
    print("fat(5)=" .. fat(5) .. " soma=" .. soma .. " primeiro=" .. t[1] .. " passos=" .. passos)
    local x = 0
    while x < 3 do x = x + 1 end
    repeat x = x - 1 until x == 0
    if 0 then print("0 é verdadeiro em Lua") end
    local a, b = 1, 2
    print(a ~= b and "diferentes" or "iguais", 2 ^ 10, 7 // 2, #"abc", ("Crivo"):upper(), nil == false)
    global.pontos = global.pontos + 1
    return fat(6)`,
    env,
    { lang: 'lua' },
  );
  assert.deepEqual(out, ['fat(5)=120 soma=100 primeiro=10 passos=4', '0 é verdadeiro em Lua', 'diferentes 1024 3 3 CRIVO false']);
  assert.equal(result.value, 720);
  assert.equal(globals.get('pontos'), 1);
  assert.equal(S.run('1 + 1', {}, { lang: 'lua' }).value, 2, 'a single expression works in the terminal');
  assert.throws(() => S.run('if x then', {}, { lang: 'lua' }), /faltou "end"/);
});

test('functions written in one language are called from the others inside the game', () => {
  const p = world({ tiles: { 8: [[0, 19, 1]] }, actors: [['heroi', 'platformer'], ['moeda', 'item']], entities: [['heroi', 16, 56]] });
  p.scripts = [
    { id: 'c', name: 'regras_cpp', lang: 'cpp', code: 'int bonus(int vidas) { return vidas * 10; }' },
    { id: 'l', name: 'magia_lua', lang: 'lua', code: 'function chuva(n)\n  for i = 1, n do instance_create("moeda", x + i * 10, y - 24) end\n  return bonus(n)\nend' },
  ];
  const game = E.createGame(compileGame(normalizeGame(p)), { script: S });
  game.restart();
  assert.equal(game.exec('chuva(3)').value, 30);
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 3);
  assert.equal(game.exec('return instance_number("moeda")', { lang: 'lua' }).value, 3);
  assert.equal(game.exec('self->x', { lang: 'cpp' }).value, 16);
  assert.equal(game.exec('player():motion_set(0, 50); return self.hspeed', { lang: 'lua' }).value, 50);
});
