import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelDocument } from '../../editor/static/editor/js/core/document.js';
import { serialize } from '../../editor/static/editor/js/core/format.js';
import { gameEngine } from '../../editor/static/editor/js/core/game/engine.js';
import { gameScript } from '../../editor/static/editor/js/core/game/script.js';
import { compileGame, checkGame } from '../../editor/static/editor/js/core/game/compile.js';
import { sampleGame } from '../../editor/static/editor/js/core/game/sample.js';
import { newGame, newScene, newActor, normalizeGame, GAME_VERSION } from '../../editor/static/editor/js/core/game/project.js';

const E = gameEngine();
const S = gameScript();
const STEP = E.STEP;
const FLAGS = { 1: 'solid', 2: 'platform', 3: 'hazard', 4: 'ladder', 5: 'water', 6: 'ice', 7: 'bounce' };

function box(w, h, color = 0xff0000ff) {
  const doc = new PixelDocument(w, h, { name: 'Caixa' });
  doc.cell(doc.frames[0].id, doc.layers[0].id).fill(color);
  return serialize(doc);
}

function world({ tiles = {}, actors = [], entities = [], rules = [], cols = 20, rows = 10, scene: sceneExtra = {}, scenes = null, extra = {} } = {}) {
  const game = newGame('Teste');
  game.sprites = [
    { id: 'quadrado', name: 'Quadrado', data: box(8, 8) },
    { id: 'largo', name: 'Largo', data: box(24, 4) },
    { id: 'folha', name: 'Folha', data: box(56, 8, 0xff00ff00) },
  ];
  game.tilesets = [{ id: 'ts', name: 'TS', sprite: 'folha', tileWidth: 8, tileHeight: 8, flags: FLAGS }];
  game.actors = actors.map(([id, behavior, props = {}, more = {}]) => {
    const base = newActor(id, more.sprite || 'quadrado', behavior);
    return { ...base, id, props: { ...base.props, ...props }, ...more };
  });
  const scene = { ...newScene('Cena', cols, rows), ...sceneExtra };
  scene.id = 'c1';
  scene.tileset = 'ts';
  scene.tiles = new Array(cols * rows).fill(0);
  for (const [row, spec] of Object.entries(tiles)) for (const [c0, c1, t] of spec) for (let c = c0; c <= c1; c++) scene.tiles[Number(row) * cols + c] = t;
  scene.entities = entities.map(([actor, x, y, flip = false], i) => ({ id: `e${i}`, actor, x, y, flip }));
  game.scenes = scenes ? scenes(scene) : [scene];
  game.start = game.scenes[0].id;
  game.rules = rules;
  Object.assign(game, extra);
  return normalizeGame(game);
}

function start(project, options = {}) {
  const game = E.createGame(compileGame(project), { seed: 1, script: S, ...options });
  game.restart();
  return game;
}

function steps(game, frames, input = {}) {
  for (let i = 0; i < frames; i++) game.step(typeof input === 'function' ? input(i) : input, STEP);
  return game;
}

test('the file format keeps the new tiles, behaviors, scene lighting, camera and weather', () => {
  const p = world({ actors: [['heroi', 'platformer', { walljump: true, dash: true }, { light: { radius: 40, color: '#ffcc88', flicker: true } }], ['npc', 'npc', { say: 'a'.repeat(500) }]], scene: { ambient: 70, weather: 'snow', camera: 'deadzone', zoom: 2, parallax: 30 }, extra: { filter: 'crt', transition: 'iris' } });
  assert.equal(GAME_VERSION, 2);
  assert.equal(p.tilesets[0].flags[4], 'ladder');
  assert.equal(p.tilesets[0].flags[7], 'bounce');
  assert.equal(p.actors[0].props.walljump, true);
  assert.deepEqual(p.actors[0].light, { radius: 40, color: '#ffcc88', flicker: true });
  assert.equal(p.actors[1].props.say.length, 500);
  assert.equal(p.scenes[0].ambient, 70);
  assert.equal(p.scenes[0].weather, 'snow');
  assert.equal(p.scenes[0].camera, 'deadzone');
  assert.equal(p.scenes[0].zoom, 2);
  assert.equal(p.filter, 'crt');
  assert.equal(p.transition, 'iris');
  const bad = normalizeGame({ ...p, filter: 'x', scenes: [{ ...p.scenes[0], weather: 'lava', camera: 'x', ambient: 900 }] });
  assert.equal(bad.filter, '');
  assert.equal(bad.scenes[0].weather, '');
  assert.equal(bad.scenes[0].camera, 'smooth');
  assert.equal(bad.scenes[0].ambient, 100);
});

test('ladders: the player climbs up and down, stands on top and jumps off', () => {
  const tiles = { 9: [[0, 19, 1]] };
  for (let r = 4; r <= 8; r++) tiles[r] = [[5, 5, 4]];
  const p = world({ tiles, actors: [['heroi', 'platformer']], entities: [['heroi', 40, 64]] });
  const game = steps(start(p), 20);
  const hero = game.world.player;
  assert.equal(hero.y, 64);
  steps(game, 40, { up: true });
  assert.ok(hero.climbing || hero.y <= 24, 'climbs while holding up');
  assert.ok(hero.y < 50, 'goes up the ladder');
  steps(game, 80, { up: true });
  steps(game, 30, {});
  assert.equal(hero.climbing, false);
  assert.equal(hero.y, 24, 'stands on top of the ladder');
  steps(game, 30, { down: true });
  assert.ok(hero.y > 24, 'climbs down from the top');
  steps(game, 60, { down: true });
  assert.equal(hero.y, 64);
});

test('water slows the fall and lets the player swim up', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]], 3: [[0, 19, 5]], 4: [[0, 19, 5]], 5: [[0, 19, 5]], 6: [[0, 19, 5]], 7: [[0, 19, 5]], 8: [[0, 19, 5]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 40, 0]] });
  const game = start(p);
  steps(game, 40);
  const hero = game.world.player;
  assert.ok(hero.inWater);
  assert.ok(hero.vy <= 260 * 0.35 + 0.01, 'falls slower in water');
  steps(game, 120);
  const bottom = hero.y;
  steps(game, 1, { jump: true, jumpPressed: true });
  steps(game, 6, { jump: true });
  assert.ok(hero.y < bottom, 'a stroke pushes the player up');
  assert.equal(hero.state === 'swim' || hero.state === 'idle' || hero.state === 'fall' || hero.state === 'jump', true);
});

test('ice keeps the momentum and bounce tiles throw the player up', () => {
  const ice = world({ tiles: { 8: [[0, 19, 6]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 56]] });
  const normal = world({ tiles: { 8: [[0, 19, 1]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 56]] });
  const a = steps(start(ice), 10);
  const b = steps(start(normal), 10);
  steps(a, 10, { right: true });
  steps(b, 10, { right: true });
  assert.ok(a.world.player.vx < b.world.player.vx, 'accelerates slower on ice');
  const bounce = world({ tiles: { 8: [[0, 19, 7]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 0]] });
  const c = start(bounce);
  let minY = Infinity;
  let bounced = false;
  for (let i = 0; i < 120; i++) {
    c.step({}, STEP);
    if (c.world.player.vy < -100) bounced = true;
    if (bounced) minY = Math.min(minY, c.world.player.y);
  }
  assert.ok(bounced, 'lands on the bounce tile and goes up');
  assert.ok(minY < 40);
});

test('wall jump and dash for the platformer', () => {
  const tiles = { 9: [[0, 19, 1]] };
  for (let r = 0; r <= 8; r++) tiles[r] = [[10, 10, 1]];
  const p = world({ tiles, actors: [['heroi', 'platformer', { walljump: true, dash: true, jump: 200 }]], entities: [['heroi', 64, 64]] });
  const game = steps(start(p), 10);
  const hero = game.world.player;
  steps(game, 1, { jump: true, jumpPressed: true });
  let slid = false;
  for (let i = 0; i < 90 && !slid; i++) {
    game.step({ right: true, jump: true }, STEP);
    slid = hero.wallSlide;
  }
  assert.ok(slid, 'slides on the wall when pressing towards it');
  assert.ok(hero.vy <= 260 * 0.22 + 0.001);
  steps(game, 1, { right: true, jump: true, jumpPressed: true });
  assert.ok(hero.vy < -150, 'jumps off the wall');
  assert.ok(hero.vx < 0, 'is pushed away from the wall');
  const q = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer', { dash: true }]], entities: [['heroi', 16, 64]] });
  const g2 = steps(start(q), 10);
  const x0 = g2.world.player.x;
  steps(g2, 1, { dash: true, dashPressed: true });
  assert.ok(g2.world.player.dashTime > 0);
  assert.equal(g2.world.player.state, 'dash');
  steps(g2, 10, {});
  assert.ok(g2.world.player.x - x0 > 25, 'the dash covers distance fast');
});

test('moving platforms carry the rider and one-way movers let the player jump through', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer'], ['plat', 'mover', { speed: 30, range: 48, wait: 0 }, { sprite: 'largo' }]], entities: [['plat', 16, 48], ['heroi', 24, 30]] });
  const game = steps(start(p), 60);
  const hero = game.world.player;
  const plat = game.world.entities.find((e) => e.behavior === 'mover');
  assert.equal(hero.y + hero.h, plat.y, 'stands on the platform');
  const offset = hero.x - plat.x;
  steps(game, 30);
  assert.ok(Math.abs(hero.x - plat.x - offset) < 0.5, 'moves along with the platform');
  steps(game, 200);
  assert.ok(plat.x >= 16 && plat.x <= 64 + 0.01, 'goes back and forth inside the range');
  const below = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer', { jump: 220 }], ['plat', 'mover', { speed: 0, range: 0 }, { sprite: 'largo' }]], entities: [['plat', 16, 40], ['heroi', 24, 64]] });
  const g2 = steps(start(below), 10);
  steps(g2, 1, { jump: true, jumpPressed: true });
  steps(g2, 60, { jump: true });
  assert.equal(g2.world.player.y + g2.world.player.h, 40, 'jumps up through and lands on top');
});

test('springs, checkpoints and respawning at the last checkpoint', () => {
  const p = world({
    tiles: { 9: [[0, 9, 1]] },
    actors: [['heroi', 'platformer', { health: 1 }], ['mola', 'spring', { power: 260 }, { hitbox: { x: 0, y: 4, w: 8, h: 4 } }], ['ponto', 'checkpoint']],
    entities: [['heroi', 8, 64], ['ponto', 40, 64], ['mola', 64, 64]],
    rules: [{ when: { type: 'checkpoint' }, then: [{ type: 'add', name: 'pontos', value: 1 }] }],
  });
  const game = steps(start(p), 10);
  steps(game, 30, { right: true });
  assert.equal(game.vars.pontos, 1, 'the checkpoint trigger fires once');
  assert.ok(game.checkpoint && game.checkpoint.scene === 'c1');
  let up = false;
  for (let i = 0; i < 40; i++) {
    game.step({ right: true }, STEP);
    if (game.world.player.vy < -200) up = true;
  }
  assert.ok(up, 'the spring throws the player up');
  const before = game.world;
  for (let i = 0; i < 600 && game.world === before; i++) game.step({ right: true }, STEP);
  assert.notEqual(game.world, before, 'falls into the pit and the scene reloads');
  const hero = game.world.player;
  assert.ok(Math.abs(hero.x - 40) < 0.01, 'respawns at the checkpoint');
  assert.ok(game.world.entities.find((e) => e.behavior === 'checkpoint').active);
  assert.equal(game.vars.vidas, 2);
});

test('dialogs pause the game, type the text, go through pages and send a signal at the end', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['velho', 'npc', { speaker: 'Velho', say: 'Olá, {pontos}!|Boa sorte.' }, { events: [{ type: 'dialogEnd', then: [{ type: 'add', name: 'pontos', value: 5 }] }] }], ['porta', 'custom', {}, { events: [{ type: 'signal', signal: 'abrir', then: [{ type: 'destroy', target: 'self' }] }] }]],
    entities: [['heroi', 16, 64], ['velho', 24, 64], ['porta', 120, 64]],
    rules: [{ when: { type: 'signal', signal: 'abrir' }, then: [{ type: 'add', name: 'vidas', value: 1 }] }],
  });
  const game = steps(start(p), 5);
  assert.ok(game.world.entities.find((e) => e.behavior === 'npc').near);
  steps(game, 1, { action: true, actionPressed: true });
  const d = game.world.dialog;
  assert.ok(d);
  assert.equal(d.speaker, 'Velho');
  assert.deepEqual(d.pages, ['Olá, 0!', 'Boa sorte.']);
  const x = game.world.player.x;
  steps(game, 30, { right: true });
  assert.equal(game.world.player.x, x, 'the game is paused while the dialog is open');
  assert.ok(d.shown > 0 && d.shown <= d.pages[0].length);
  steps(game, 1, { actionPressed: true });
  steps(game, 1, { actionPressed: true });
  assert.equal(d.page, 1);
  steps(game, 1, { actionPressed: true });
  assert.equal(game.world.dialog, null);
  assert.equal(game.vars.pontos, 5, 'the NPC dialogEnd event runs');
  game.exec('signal_send("abrir")');
  assert.equal(game.vars.vidas, 4, 'rules receive signals');
  assert.equal(game.world.entities.filter((e) => e.id === 'porta' && !e.dead).length, 0, 'actors receive signals');
});

test('tweens with easing, yoyo and the action that animates a property', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'topdown'], ['caixa', 'custom', { collide: false }, { events: [{ type: 'create', then: [{ type: 'tween', target: 'self', prop: 'y', value: 10, seconds: 0.5, ease: 'out_bounce' }] }] }]], entities: [['heroi', 16, 64], ['caixa', 80, 50]] });
  const game = start(p);
  const caixa = game.world.entities.find((e) => e.id === 'caixa');
  steps(game, 15);
  assert.ok(caixa.y - caixa.hy < 50 && caixa.y - caixa.hy > 10);
  steps(game, 30);
  assert.equal(Math.round(caixa.y - caixa.hy), 10);
  game.exec('tween(self, "alpha", 0, 0.25, "linear", true)');
  steps(game, 15);
  assert.ok(game.world.player.alpha < 0.05);
  steps(game, 20);
  assert.ok(game.world.player.alpha > 0.95, 'yoyo goes back');
  assert.equal(E.EASE.out_bounce(1), 1);
  assert.equal(E.EASE.in_out_quad(0.5), 0.5);
  for (const k of E.EASES) assert.ok(Math.abs(E.EASE[k](0)) < 1e-9 && Math.abs(E.EASE[k](1) - 1) < 1e-9, k);
});

test('A* finds a path around walls and the pathfinder enemy reaches the player', () => {
  const tiles = { 0: [[0, 19, 1]], 9: [[0, 19, 1]] };
  for (let r = 1; r <= 7; r++) tiles[r] = [[0, 0, 1], [10, 10, 1], [19, 19, 1]];
  const p = world({ tiles, actors: [['heroi', 'topdown'], ['caca', 'pathfinder', { speed: 60, range: 1000 }]], entities: [['heroi', 128, 16], ['caca', 16, 16]] });
  const game = start(p);
  const path = game.exec('path_find(20, 20, 132, 20)').value;
  assert.ok(path.length > 10, 'goes around the wall');
  assert.ok(path.some(([, y]) => y > 64), 'passes below the wall');
  assert.deepEqual(path[path.length - 1], [132, 20]);
  assert.deepEqual(game.exec('path_find(20, 20, 84, 20)').value, [], 'no path into a solid tile');
  assert.equal(game.exec('raycast(20, 20, 140, 20)').value > 0, true, 'the ray hits the wall');
  assert.equal(game.exec('raycast(20, 68, 140, 68)').value, -1, 'nothing in the way below');
  assert.equal(game.exec('line_of_sight(instance_nearest("caca"))').value, false);
  const enemy = game.world.entities.find((e) => e.behavior === 'pathfinder');
  let reached = false;
  for (let i = 0; i < 900 && !reached; i++) {
    game.step({}, STEP);
    if (game.world.player.hurt > 0 || game.world.player.health < 3) reached = true;
  }
  assert.ok(reached, `the enemy walks around the wall and touches the player (${Math.round(enemy.x)},${Math.round(enemy.y)})`);
});

test('turrets aim and shoot projectiles that hurt the player only when they see them', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer', { health: 5 }], ['bala', 'projectile', { speed: 120, life: 3 }], ['torre', 'turret', { shoot: 'bala', cooldown: 0.5, range: 200 }]], entities: [['heroi', 16, 64], ['torre', 120, 64]] });
  const game = start(p);
  steps(game, 120);
  assert.ok(game.world.player.health < 5, 'the turret shot hits');
  assert.deepEqual(checkGame(normalizeGame({ ...p, actors: p.actors.map((a) => (a.behavior === 'turret' ? { ...a, props: { ...a.props, shoot: '' } } : a)) })).some((x) => x.includes('torre')), true);
  const walled = world({ tiles: { 9: [[0, 19, 1]], 8: [[8, 8, 1]], 7: [[8, 8, 1]] }, actors: [['heroi', 'platformer', { health: 5 }], ['bala', 'projectile'], ['torre', 'turret', { shoot: 'bala', cooldown: 0.5, range: 200 }]], entities: [['heroi', 16, 64], ['torre', 120, 64]] });
  const g2 = steps(start(walled), 120);
  assert.equal(g2.world.entities.filter((e) => e.behavior === 'projectile').length, 0, 'no line of sight, no shot');
});

test('save and load slots, persistent values and maps', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 64]] });
  const store = new Map();
  const storage = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) };
  const game = steps(start(p, { storage }), 10);
  game.vars.pontos = 42;
  steps(game, 30, { right: true });
  const x = game.world.player.x;
  assert.equal(game.exec('game_save(2)').value, true);
  assert.equal(game.exec('save_exists(2)').value, true);
  game.exec('save_set("recorde", 99)');
  game.vars.pontos = 0;
  steps(game, 30, { right: true });
  assert.equal(game.exec('game_load(2)').value, true);
  assert.equal(game.vars.pontos, 42);
  assert.ok(Math.abs(game.world.player.x - x) < 0.01);
  const other = start(p, { storage });
  assert.equal(other.exec('save_get("recorde", 0)').value, 99, 'values survive a new game');
  assert.equal(other.exec('save_get("nada", 7)').value, 7);
  const r = other.exec('var m = map_create()\nm.vida = 3\nmap_set(m, "nome", "Gota")\nm.vida += 2\nreturn [m.vida, map_get(m, "nome"), map_has(m, "x"), map_size(m)]', { scope: null });
  assert.deepEqual(r.value ?? r, [5, 'Gota', false, 2]);
});

test('draw events collect drawing commands for the world and the HUD and skip the automatic sprite', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['hud', 'custom', {}, { events: [{ type: 'drawGui', then: [{ type: 'code', code: 'draw_text(4, 4, "pontos {pontos}", "#ffffff")\ndraw_bar(4, 12, 40, 3, 2, 4, "#d04a3a")' }] }, { type: 'draw', then: [{ type: 'code', code: 'draw_self()\ndraw_circle(x, y, 6, "#ff0000", true)' }] }] }]],
    entities: [['heroi', 16, 64], ['hud', 40, 40]],
  });
  const game = steps(start(p), 2);
  const w = game.world;
  assert.deepEqual(w.gui.map((c) => c.k), ['text', 'bar']);
  assert.equal(w.gui[0].text, 'pontos 0');
  assert.equal(w.gui[1].value, 0.5);
  assert.deepEqual(w.draws.map((c) => c.k), ['self', 'circle']);
  assert.equal(w.entities.find((e) => e.id === 'hud').customDraw, true);
});

test('camera modes, zoom, shake, slow motion, hitstop and screen flash', () => {
  const p = world({ cols: 80, tiles: { 9: [[0, 79, 1]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 64]], scene: { camera: 'deadzone', zoom: 2 } });
  const game = steps(start(p), 10);
  const w = game.world;
  assert.equal(w.camera.zoom, 2);
  const cx = w.camera.x;
  steps(game, 5, { right: true });
  assert.equal(w.camera.x, cx, 'the deadzone keeps the camera still for small moves');
  steps(game, 120, { right: true });
  assert.ok(w.camera.x > cx);
  game.exec('camera_zoom(1)');
  assert.equal(w.camera.zoom, 1);
  game.exec('time_scale(0.5, 1)');
  const x0 = w.player.x;
  steps(game, 10, { right: true });
  const slow = w.player.x - x0;
  game.exec('time_scale(1)');
  const x1 = w.player.x;
  steps(game, 10, { right: true });
  assert.ok(w.player.x - x1 > slow * 1.5, 'slow motion halves the speed');
  game.exec('hitstop(0.1)');
  const x2 = w.player.x;
  steps(game, 3, { right: true });
  assert.equal(w.player.x, x2, 'hitstop freezes the world');
  game.exec('flash("#ffffff", 0.2)');
  assert.ok(w.flash);
  steps(game, 20);
  assert.equal(w.flash, null);
});

test('particles presets, floating text, lights, weather and many actors with the spatial grid', () => {
  const actors = [['heroi', 'topdown'], ['moeda', 'item']];
  const entities = [['heroi', 8, 8]];
  for (let i = 0; i < 120; i++) entities.push(['moeda', 16 + (i % 18) * 8, 16 + Math.floor(i / 18) * 8]);
  const p = world({ cols: 40, rows: 20, actors, entities, scene: { weather: 'rain', ambient: 60 } });
  const game = steps(start(p), 2);
  const w = game.world;
  assert.equal(w.ambient, 0.6);
  assert.ok(w.drops.length > 50, 'rain drops fill the view');
  assert.ok(w.stats.pairs < (121 * 120) / 2, 'the spatial grid checks fewer pairs than all of them');
  game.exec('effect("explosion")');
  assert.ok(w.particles.length >= 20);
  assert.ok(w.lights.length >= 1, 'explosions light the scene');
  game.exec('floating_text("+10", "#ffff00")');
  assert.equal(w.floats[0].text, '+10');
  steps(game, 90, { right: true, down: true });
  assert.equal(w.floats.length, 0);
  assert.ok(game.vars.pontos > 0, 'still collects items with the grid');
  assert.ok(E.PRESETS.includes('fire') && E.PRESETS.includes('magic'));
});

test('mouse clicks on actors, conditions with code, keys and distance', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'topdown'], ['botao', 'custom', {}, { events: [{ type: 'mousePress', then: [{ type: 'add', name: 'pontos', value: 1 }] }, { type: 'step', if: { kind: 'expr', code: 'global.pontos >= 1 and mouse_check("left")' }, then: [{ type: 'set', name: 'vidas', value: 9 }] }, { type: 'step', if: { kind: 'near', value: 20 }, then: [{ type: 'setLocal', target: 'self', local: 'perto', value: 1 }] }] }]],
    entities: [['heroi', 16, 16], ['botao', 80, 40]],
  });
  const game = steps(start(p), 2);
  const cam = game.world.camera;
  steps(game, 1, { mouse: { x: 84 - cam.x, y: 44 - cam.y, left: true, leftPressed: true, inside: true } });
  assert.equal(game.vars.pontos, 1);
  assert.equal(game.vars.vidas, 9);
  steps(game, 1, { mouse: { x: 10, y: 10, left: true, leftPressed: true } });
  assert.equal(game.vars.pontos, 1, 'clicks outside do not count');
  assert.equal(game.exec('mouse_x').value, 10 + cam.x);
  const b = game.world.entities.find((e) => e.id === 'botao');
  assert.notEqual(b.vars.perto, 1);
  game.world.player.x = 78;
  game.world.player.y = 40;
  steps(game, 1);
  assert.equal(b.vars.perto, 1);
});

test('the sample game has a third level with the new engine features and no problems', () => {
  const sample = sampleGame();
  assert.deepEqual(checkGame(sample), []);
  const three = sample.scenes[2];
  assert.ok(three.ambient > 0);
  const behaviors = new Set(three.entities.map((e) => sample.actors.find((a) => a.id === e.actor).behavior));
  for (const b of ['mover', 'spring', 'checkpoint', 'npc']) assert.ok(behaviors.has(b), b);
  const game = E.createGame(compileGame(sample), { seed: 3, script: S });
  game.reset();
  game.load(three.id);
  for (let i = 0; i < 240; i++) game.step({ right: i % 50 < 40, jump: i % 30 < 10, jumpPressed: i % 30 === 0 }, STEP);
  assert.equal(game.logs.filter((l) => l.kind === 'error').length, 0, game.logs.map((l) => l.text).join('\n'));
});

test('animated tiles are validated, compiled and keep the collision of the painted tile', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer']], entities: [['heroi', 16, 64]] });
  p.tilesets[0].anims = [{ tile: 5, frames: [5, 6, 7], fps: 4 }, { tile: 0, frames: [1, 2] }, { tile: 3, frames: [3] }, { tile: 2, frames: ['x', 4, -1, 2], fps: 999 }];
  const n = normalizeGame(p);
  assert.deepEqual(n.tilesets[0].anims, [{ tile: 5, frames: [5, 6, 7], fps: 4 }, { tile: 2, frames: [4, 1, 2], fps: 60 }]);
  const data = compileGame(n);
  assert.deepEqual(data.tilesets[0].anims[0], { tile: 5, frames: [5, 6, 7], fps: 4 });
  const sample = compileGame(sampleGame());
  assert.ok(sample.tilesets[0].anims.some((a) => a.tile === 10 && a.frames.length > 2), 'the water of the sample ripples');
});

test('maps and tables in the three languages: literals, fields, indexes, loops and methods', () => {
  const env = { print: () => {} };
  const r = (src, lang) => S.run(src, env, { lang }).value;
  assert.deepEqual(r('var m = { vida: 3, nome: "Gota" }\nm.vida += 2\nm["x"] = 7\nvar s = 0\nfor (var k in m) { s += 1 }\nvar soma = 0\nfor (var i, v in [1, 2, 3]) { soma += i * v }\nfor (var v in [10, 20]) { soma += v }\nreturn [m.vida, m.nome, map_get(m, "x"), s, map_size(m), soma]'), [5, 'Gota', 7, 3, 3, 38]);
  assert.deepEqual(r('local t = { vida = 3, nome = "Gota", 10, 20, ["x y"] = 5 }\nt.vida = t.vida + 1\nlocal n = 0\nfor k, v in pairs(t) do n = n + 1 end\nreturn { t.vida, t[1], t["x y"], #t, n }', 'lua'), [4, 10, 5, 2, 5]);
  assert.equal(r('std::map<std::string, int> m;\nm["a"] = 1;\nm["b"] = 2;\nint total = 0;\nfor (auto k : m.keys()) { total += m[k]; }\nreturn total + m.size() + m.count("a");', 'cpp'), 6);
  assert.equal(S.format(r('return { a: 1, b: "x" }')), '{a: 1, b: "x"}');
  assert.throws(() => r('map_set(3, "a", 1)'), /mapa/);
});

test('trigger zones are invisible, send their signal once when the player enters and can repeat', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['zona', 'zone', { signal: 'Alarme!' }], ['zona2', 'zone', { signal: 'eco', once: false, hidden: false }], ['porta', 'custom', {}, { events: [{ type: 'signal', signal: 'alarme', then: [{ type: 'add', name: 'pontos', value: 1 }] }] }]],
    entities: [['heroi', 8, 64], ['zona', 40, 64], ['zona2', 96, 64], ['porta', 140, 64]],
    rules: [{ when: { type: 'signal', signal: 'eco' }, then: [{ type: 'add', name: 'vidas', value: 1 }] }],
  });
  assert.equal(p.actors.find((a) => a.id === 'zona').props.signal, 'alarme', 'the signal name is normalized');
  const game = steps(start(p), 2);
  const zone = game.world.entities.find((e) => e.id === 'zona');
  assert.equal(zone.visible, false);
  assert.equal(game.world.entities.find((e) => e.id === 'zona2').visible, true);
  steps(game, 50, { right: true });
  assert.ok(zone.active && zone.used);
  assert.equal(game.vars.pontos, 1);
  steps(game, 60, { left: true });
  steps(game, 60, { right: true });
  assert.equal(game.vars.pontos, 1, 'a zone marked once fires a single time');
  steps(game, 80, { right: true });
  steps(game, 60, { left: true });
  steps(game, 60, { right: true });
  assert.ok(game.vars.vidas >= 5, 'a repeating zone fires every time the player enters');
});

test('particle emitters release their effect on a timer and only near the player when they have a range', () => {
  const p = world({
    cols: 60,
    actors: [['heroi', 'topdown'], ['fogo', 'emitter', { effect: 'smoke', every: 0.1, amount: 2 }], ['longe', 'emitter', { effect: 'magic', range: 40 }], ['ruim', 'emitter', { effect: 'nada' }]],
    entities: [['heroi', 8, 8], ['fogo', 40, 40], ['longe', 400, 40], ['ruim', 60, 60]],
  });
  assert.equal(p.actors.find((a) => a.id === 'ruim').props.effect, 'fire', 'unknown effects fall back to the default');
  const game = steps(start(p), 30);
  const parts = game.world.particles.length;
  assert.ok(parts >= 8, 'the emitter released particles');
  const far = game.world.entities.find((e) => e.id === 'longe');
  assert.equal(far.vx, 0);
  const before = JSON.stringify(game.world.particles.map((q) => q.color).filter((c) => c === '#c9a4ff'));
  assert.equal(before, '[]', 'the far emitter stays quiet while the player is away');
});

test('the wait action pauses the rest of a list and continues later, and is dropped with its actor', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['bomba', 'custom', {}, { events: [{ type: 'create', then: [{ type: 'wait', seconds: 0.5 }, { type: 'add', name: 'vidas', value: 10 }] }] }]],
    entities: [['heroi', 8, 64], ['bomba', 80, 64]],
    rules: [{ when: { type: 'start' }, then: [{ type: 'set', name: 'pontos', value: 1 }, { type: 'wait', seconds: 1 }, { type: 'add', name: 'pontos', value: 5 }, { type: 'wait', seconds: 0.5 }, { type: 'add', name: 'pontos', value: 100 }] }],
  });
  assert.equal(p.rules[0].then[1].type, 'wait');
  const game = steps(start(p), 2);
  assert.equal(game.vars.pontos, 1);
  steps(game, 50);
  assert.equal(game.vars.pontos, 1, 'nothing after the wait runs before one second');
  steps(game, 15);
  assert.equal(game.vars.pontos, 6);
  steps(game, 35);
  assert.equal(game.vars.pontos, 106, 'waits chain');
  assert.equal(game.vars.vidas, 13, 'actor events wait too');
  const again = steps(start(p), 2);
  const bomb = again.world.entities.find((e) => e.id === 'bomba');
  bomb.dead = true;
  steps(again, 60);
  assert.equal(again.vars.vidas, 3, 'the rest is dropped when the actor is gone');
});

test('persistent scenes remember collected items, defeated enemies and actor variables when the player comes back', () => {
  const p = world({
    tiles: { 9: [[0, 19, 1]] },
    actors: [['heroi', 'platformer'], ['moeda', 'item'], ['porta', 'custom', {}, { events: [{ type: 'create', then: [{ type: 'code', code: 'abertas = 0' }] }] }]],
    entities: [['heroi', 8, 64], ['moeda', 24, 64], ['moeda', 120, 64], ['porta', 140, 64]],
    scene: { persistent: true },
    scenes: (first) => {
      const second = { ...first, id: 'c2', name: 'Outra', persistent: false, entities: [{ id: 'x0', actor: 'heroi', x: 8, y: 64, flip: false }, { id: 'x1', actor: 'moeda', x: 24, y: 64, flip: false }] };
      return [first, second];
    },
  });
  assert.equal(p.scenes[0].persistent, true);
  assert.equal(p.scenes[1].persistent, false);
  const game = steps(start(p), 2);
  const door = () => game.world.entities.find((e) => e.id === 'porta');
  door().vars.abertas = 7;
  steps(game, 20, { right: true });
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda' && !e.dead).length, 1, 'the first coin was collected');
  game.load('c2');
  steps(game, 20, { right: true });
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda' && !e.dead).length, 0);
  game.load('c2');
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 1, 'a normal scene starts over');
  game.load('c1');
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 1, 'the collected coin stays collected');
  assert.equal(door().vars.abertas, 7, 'actor variables come back and the create event does not run again');
  assert.ok(door().restored);
  game.load('c1');
  assert.equal(game.world.entities.filter((e) => e.id === 'moeda').length, 2, 'restarting the same scene starts it over');
  game.restart();
  assert.deepEqual(game.persist, {});
});

test('gamepad rumble is requested when the player is hurt and from code', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer'], ['espinho', 'hazard']], entities: [['heroi', 8, 64], ['espinho', 20, 64]] });
  const game = steps(start(p), 1);
  game.effects.length = 0;
  steps(game, 20, { right: true });
  const hurt = game.effects.find((f) => f.type === 'rumble');
  assert.ok(hurt && hurt.strong > 0 && hurt.ms > 0);
  game.effects.length = 0;
  game.exec('gamepad_rumble(2, 10)');
  assert.deepEqual(game.effects.at(-1), { type: 'rumble', strong: 1, weak: 0.6, ms: 3000 });
});

test('spawners create the chosen actor on a timer, up to a maximum alive, and only near the player with a range', () => {
  const p = world({
    cols: 60,
    tiles: { 9: [[0, 59, 1]] },
    actors: [['heroi', 'topdown'], ['gosma', 'patrol'], ['ninho', 'spawner', { spawns: 'gosma', every: 0.5, max: 2 }], ['longe', 'spawner', { spawns: 'gosma', every: 0.5, range: 40 }], ['eco', 'spawner', { spawns: 'eco', every: 0.2 }]],
    entities: [['heroi', 8, 8], ['ninho', 80, 64], ['longe', 400, 64], ['eco', 200, 64]],
  });
  assert.equal(p.actors.find((a) => a.id === 'ninho').props.max, 2);
  const game = steps(start(p), 20);
  const count = () => game.world.entities.filter((e) => e.id === 'gosma' && !e.dead).length;
  assert.equal(count(), 0, 'waits one interval before the first one');
  steps(game, 20);
  assert.equal(count(), 1);
  steps(game, 120);
  assert.equal(count(), 2, 'never more than the maximum alive');
  const one = game.world.entities.find((e) => e.id === 'gosma' && !e.dead);
  one.dead = true;
  steps(game, 40);
  assert.equal(count(), 2, 'replaces the ones that died');
  assert.equal(game.world.entities.filter((e) => e.id === 'eco').length, 1, 'a spawner does not create itself');
});

test('damage numbers float over hurt actors when the game asks for them, and the options are kept in the file', () => {
  const p = world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer'], ['espinho', 'hazard', { damage: 2 }]], entities: [['heroi', 8, 64], ['espinho', 20, 64]], extra: { damageNumbers: true, hpBars: true } });
  assert.equal(p.damageNumbers, true);
  assert.equal(p.hpBars, true);
  const data = compileGame(p);
  assert.equal(data.damageNumbers, true);
  assert.equal(data.hpBars, true);
  const game = steps(start(p), 1);
  steps(game, 20, { right: true });
  assert.ok(game.world.floats.some((f) => f.text === '-2'), 'shows the damage taken');
  const off = steps(start(world({ tiles: { 9: [[0, 19, 1]] }, actors: [['heroi', 'platformer'], ['espinho', 'hazard']], entities: [['heroi', 8, 64], ['espinho', 20, 64]] })), 21, { right: true });
  assert.equal(off.world.floats.length, 0);
  assert.ok(E.ENEMIES.includes('turret'));
});
