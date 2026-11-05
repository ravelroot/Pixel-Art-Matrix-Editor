import { deserialize } from '../format.js';
import { encodeRLE, toBase64 } from '../rle.js';
import { tagSequence } from '../animation.js';

export function opaqueBounds(pixels, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] >>> 24 === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function spriteDocument(sprite, cache) {
  const hit = cache?.get(sprite.id);
  if (hit && hit.data === sprite.data) return hit.doc;
  const doc = deserialize(sprite.data);
  cache?.set(sprite.id, { data: sprite.data, doc });
  return doc;
}

export function bakeSprite(sprite, cache) {
  const key = `bake:${sprite.id}`;
  const hit = cache?.get(key);
  if (hit && hit.data === sprite.data) return hit.baked;
  const doc = spriteDocument(sprite, cache);
  const fallback = 1000 / Math.max(1, doc.fps || 8);
  const frames = doc.frames.map((f, i) => {
    const pixels = doc.composite(i);
    return { d: Math.max(16, f.duration || fallback) / 1000, px: toBase64(encodeRLE(pixels)), pixels };
  });
  const anims = {};
  for (const tag of doc.tags || []) {
    const a = doc.frameIndex(tag.from);
    const b = doc.frameIndex(tag.to);
    if (a < 0 || b < 0) continue;
    const seq = tagSequence(a, b, tag.direction, 0);
    anims[tag.name] = { frames: seq.frames, loop: seq.loop };
  }
  const baked = {
    id: sprite.id,
    name: sprite.name,
    w: doc.width,
    h: doc.height,
    frames,
    anims,
    tags: (doc.tags || []).map((t) => t.name),
    all: { frames: doc.frames.map((_, i) => i), loop: true },
    bounds: opaqueBounds(frames[0]?.pixels || new Uint32Array(doc.width * doc.height), doc.width, doc.height),
  };
  cache?.set(key, { data: sprite.data, baked });
  return baked;
}

export function compileGame(game, cache = new Map()) {
  const sprites = [];
  const byId = new Map();
  for (const s of game.sprites) {
    try {
      const baked = bakeSprite(s, cache);
      byId.set(s.id, baked);
      sprites.push({ id: baked.id, name: baked.name, w: baked.w, h: baked.h, frames: baked.frames.map((f) => ({ d: f.d, px: f.px })), anims: baked.anims, all: baked.all, bounds: baked.bounds });
    } catch {
      continue;
    }
  }
  const tilesets = [];
  for (const t of game.tilesets) {
    const s = byId.get(t.sprite);
    if (!s) continue;
    const columns = Math.max(1, Math.floor(s.w / t.tileWidth));
    const rows = Math.max(1, Math.floor(s.h / t.tileHeight));
    tilesets.push({ id: t.id, name: t.name, sprite: s.id, tw: t.tileWidth, th: t.tileHeight, columns, count: columns * rows, flags: { ...t.flags }, anims: (t.anims || []).map((a) => ({ tile: a.tile, frames: a.frames.slice(), fps: a.fps })) });
  }
  const actors = game.actors.map((a) => ({
    id: a.id,
    name: a.name,
    sprite: byId.has(a.sprite) ? a.sprite : '',
    behavior: a.behavior,
    props: { ...a.props },
    anims: { ...a.anims },
    sounds: { ...a.sounds },
    hitbox: a.hitbox ? { ...a.hitbox } : null,
    parent: a.parent || '',
    depth: a.depth || 0,
    light: a.light ? { ...a.light } : null,
    events: (a.events || []).map((ev) => ({ ...ev, if: ev.if ? { ...ev.if } : undefined, then: ev.then.map((x) => ({ ...x })) })),
  }));
  const scenes = game.scenes.map((s) => ({
    id: s.id,
    name: s.name,
    cols: s.cols,
    rows: s.rows,
    tileset: s.tileset,
    background: s.background || game.background,
    backdrop: byId.has(s.backdrop) ? s.backdrop : '',
    parallax: s.parallax ?? 50,
    music: s.music || '',
    ambient: s.ambient || 0,
    ambientColor: s.ambientColor || '#0b0812',
    weather: s.weather || '',
    camera: s.camera || 'smooth',
    zoom: s.zoom || 1,
    persistent: Boolean(s.persistent),
    tiles: s.tiles.slice(),
    back: Array.isArray(s.back) ? s.back.slice() : null,
    entities: s.entities.map((e) => ({ id: e.id, actor: e.actor, x: e.x, y: e.y, flip: e.flip, code: e.code || '', lang: e.lang || 'crivo' })),
  }));
  return {
    name: game.name,
    width: game.width,
    height: game.height,
    scale: game.scale,
    gravity: game.gravity,
    maxFall: game.maxFall,
    background: game.background,
    scoreVar: game.scoreVar,
    livesVar: game.livesVar,
    winText: game.winText,
    loseText: game.loseText,
    winSound: game.winSound,
    loseSound: game.loseSound,
    sprites,
    tilesets,
    actors,
    scenes,
    sounds: game.sounds.map((s) => ({ ...s })),
    vars: game.vars.map((v) => ({ ...v })),
    rules: game.rules.map((r) => ({ scene: r.scene, when: { ...r.when }, then: r.then.map((a) => ({ ...a })) })),
    scripts: (game.scripts || []).map((x) => ({ name: x.name, lang: x.lang || 'crivo', code: x.code })),
    filter: game.filter || '',
    transition: game.transition ?? 'fade',
    textSpeed: game.textSpeed || 40,
    hpBars: Boolean(game.hpBars),
    damageNumbers: Boolean(game.damageNumbers),
    start: game.start,
  };
}

export function checkGame(game) {
  const problems = [];
  const players = game.actors.filter((a) => a.behavior === 'platformer' || a.behavior === 'topdown');
  if (!players.length) problems.push('Nenhum ator é o jogador: crie um ator com o comportamento "Jogador".');
  for (const s of game.scenes) {
    const has = s.entities.some((e) => players.some((p) => p.id === e.actor));
    if (!has) problems.push(`A cena "${s.name}" não tem o jogador.`);
    if (!s.tileset && s.tiles.some((t) => t)) problems.push(`A cena "${s.name}" tem tiles mas nenhum tileset escolhido.`);
  }
  for (const a of game.actors) if (!a.sprite) problems.push(`O ator "${a.name}" não tem sprite.`);
  for (const a of game.actors) if ((a.behavior === 'turret' || (a.behavior === 'platformer' && a.props.shoot)) && a.props.shoot && !game.actors.some((x) => x.id === a.props.shoot)) problems.push(`O ator "${a.name}" atira um projétil que não existe mais.`);
  for (const a of game.actors) if (a.behavior === 'turret' && !a.props.shoot) problems.push(`A torre "${a.name}" não tem projétil: escolha um em "Atira (projétil)".`);
  return problems;
}
