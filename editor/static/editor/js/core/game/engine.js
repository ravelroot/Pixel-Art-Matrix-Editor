export function gameEngine() {
  const SOLID = 1;
  const PLATFORM = 2;
  const HAZARD = 4;
  const FLAG_BITS = { solid: SOLID, platform: PLATFORM, hazard: HAZARD };
  const ENEMIES = ['patrol', 'chase', 'flyer'];
  const PLAYERS = ['platformer', 'topdown'];
  const STEP = 1 / 60;
  const KEYS = ['left', 'right', 'up', 'down', 'jump', 'action'];
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64R = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) B64R[B64.charCodeAt(i)] = i;

  function bytesOf(text) {
    const clean = String(text || '').replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let p = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const a = B64R[clean.charCodeAt(i)];
      const b = B64R[clean.charCodeAt(i + 1)];
      const c = i + 2 < clean.length ? B64R[clean.charCodeAt(i + 2)] : -1;
      const d = i + 3 < clean.length ? B64R[clean.charCodeAt(i + 3)] : -1;
      const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      if (p < out.length) out[p++] = (n >> 16) & 255;
      if (c >= 0 && p < out.length) out[p++] = (n >> 8) & 255;
      if (d >= 0 && p < out.length) out[p++] = n & 255;
    }
    return out.subarray(0, p);
  }

  function unpack(text, total) {
    const bytes = bytesOf(text);
    const pixels = new Uint32Array(total);
    let p = 0;
    let i = 0;
    while (p < bytes.length && i < total) {
      let run = 0;
      let scale = 1;
      for (;;) {
        if (p >= bytes.length) return pixels;
        const b = bytes[p++];
        run += (b & 127) * scale;
        if (b < 128) break;
        scale *= 128;
      }
      if (p + 4 > bytes.length) return pixels;
      const color = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
      p += 4;
      pixels.fill(color, i, Math.min(total, i + run));
      i += run;
    }
    return pixels;
  }

  function random(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function index(data) {
    const sprites = new Map((data.sprites || []).map((s) => [s.id, s]));
    const actors = new Map((data.actors || []).map((a) => [a.id, a]));
    const lineage = new Map();
    const events = new Map();
    for (const a of actors.values()) {
      const line = [];
      let cur = a;
      while (cur && line.length < 8 && !line.includes(cur.id)) {
        line.push(cur.id);
        cur = cur.parent ? actors.get(cur.parent) : null;
      }
      lineage.set(a.id, line);
      const seen = new Set();
      const list = [];
      for (const id of line) {
        for (const ev of actors.get(id).events || []) {
          const sig = `${ev.type}:${ev.key || ''}:${ev.alarm ?? ''}:${ev.other || ''}`;
          if (seen.has(sig) && id !== a.id) continue;
          if (id === a.id) seen.add(sig);
          list.push(ev);
        }
        for (const ev of actors.get(id).events || []) seen.add(`${ev.type}:${ev.key || ''}:${ev.alarm ?? ''}:${ev.other || ''}`);
      }
      events.set(a.id, list);
    }
    const sounds = new Map((data.sounds || []).map((s) => [s.id, s]));
    const tilesets = new Map((data.tilesets || []).map((t) => [t.id, t]));
    return { sprites, actors, sounds, tilesets, lineage, events };
  }

  function isA(world, e, id) {
    if (!e || !id) return false;
    const line = world.game.refs.lineage.get(e.id);
    return line ? line.includes(id) : e.id === id;
  }

  function passes(world, cond, ctx) {
    if (!cond || !cond.kind) return true;
    const self = ctx.self || ctx.a;
    if (cond.kind === 'chance') return world.game.random() * 100 < num(cond.value, 50);
    if (cond.kind === 'var') return compare(num(world.game.vars[cond.name], 0), cond.op || '>=', num(cond.value, 0));
    if (cond.kind === 'local') return compare(num(self?.vars?.[cond.local], 0), cond.op || '>=', num(cond.value, 0));
    if (cond.kind === 'count') return compare(world.entities.filter((o) => !o.dead && isA(world, o, cond.actor)).length, cond.op || '>=', num(cond.value, 0));
    if (cond.kind === 'ground') return Boolean(self?.ground);
    if (cond.kind === 'air') return Boolean(self && !self.ground);
    return true;
  }

  function own(world, e, type, match, other = null) {
    if (!e || e.dead && type !== 'destroy') return;
    const list = world.game.refs.events.get(e.id);
    if (!list || !list.length) return;
    for (const ev of list) {
      if (ev.type !== type || (match && !match(ev))) continue;
      const ctx = { a: e, b: other, self: e, other, where: `${e.actor.name} › ${ev.type}${ev.type === 'alarm' ? ` ${ev.alarm || 0}` : ''}` };
      if (!passes(world, ev.if, ctx)) continue;
      run(world, ev.then, ctx);
    }
  }

  function initialVars(data) {
    const vars = {};
    for (const v of data.vars || []) vars[v.name] = num(v.value, 0);
    return vars;
  }

  function format(text, vars) {
    return String(text ?? '').replace(/\{([^{}]{1,32})\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }

  function createGame(data, options = {}) {
    const refs = index(data);
    const rand = random(options.seed ?? 12345);
    const game = {
      data,
      refs,
      vars: initialVars(data),
      world: null,
      effects: [],
      status: 'playing',
      ended: null,
      time: 0,
      logs: [],
      onLog: options.onLog || null,
      script: options.script || null,
      lib: null,
      lastError: null,
      load(sceneId) {
        const scene = data.scenes.find((s) => s.id === sceneId) || data.scenes[0];
        if (!scene) {
          game.world = null;
          return null;
        }
        const world = createWorld(game, scene);
        game.world = world;
        if (scene.music) game.effects.push({ type: 'music', music: scene.music });
        else game.effects.push({ type: 'music', music: null });
        world.ready = true;
        for (const e of [...world.entities]) own(world, e, 'create');
        for (const e of [...world.entities]) if (e.code) runCode(world, e.code, { a: e, self: e, where: `${e.actor.name} (código da instância)` }, 'código', e.codeLang);
        for (const e of [...world.entities]) own(world, e, 'sceneStart');
        fire(world, 'start', {});
        return game.world;
      },
      reset() {
        game.vars = initialVars(data);
        game.status = 'playing';
        game.ended = null;
        if (game.lib) {
          for (const init of game.lib.inits) {
            try {
              game.script.run(init.ast, scriptEnv(null, {}, null, game));
            } catch (error) {
              reportError(game, `${init.name}: ${error.message}`);
            }
          }
        }
      },
      restart() {
        game.reset();
        return game.load(data.start);
      },
      exec(source, { self, extra = null, scope = null, lang = 'crivo' } = {}) {
        if (!game.script) throw new Error('Este jogo não tem o interpretador de código.');
        const world = game.world;
        const me = self === undefined ? world?.player || null : self;
        const out = game.script.run(source, scriptEnv(world, { self: me, a: me }, extra, game), { scope, lang });
        resolvePending(game);
        return out;
      },
      step(input, dt = STEP) {
        if (!game.world) return;
        game.time += dt;
        stepWorld(game, game.world, normalizeInput(input), dt);
        resolvePending(game);
      },
      random: rand,
    };
    if (game.script) {
      game.lib = game.script.library(data.scripts || []);
      for (const e of game.lib.errors) log(game, 'error', e);
    }
    return game;
  }

  function log(game, kind, text) {
    const entry = { kind, text: String(text), time: game.time };
    game.logs.push(entry);
    if (game.logs.length > 300) game.logs.shift();
    if (game.onLog) game.onLog(entry);
  }

  function reportError(game, text) {
    if (game.lastError && game.lastError.text === text && game.time - game.lastError.time < 2) return;
    game.lastError = { text, time: game.time };
    log(game, 'error', text);
  }

  function runCode(world, source, ctx, where = 'código', lang = 'crivo') {
    const g = world.game;
    if (!g.script || !source) return undefined;
    try {
      return g.script.run(source, scriptEnv(world, ctx, null, g), { lang }).value;
    } catch (error) {
      reportError(g, `${ctx.where || where}: ${error.message}`);
      return undefined;
    }
  }

  const isEntity = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v) && 'uid' in v && 'actor' in v);

  function findActor(game, ref) {
    if (ref && typeof ref === 'object' && ref.actor) return ref.actor;
    const r = game.refs.actors;
    if (r.has(ref)) return r.get(ref);
    const name = String(ref ?? '').toLowerCase();
    for (const a of r.values()) if (a.name.toLowerCase() === name) return a;
    return null;
  }

  function findByName(list, ref) {
    const name = String(ref ?? '').toLowerCase();
    return list.find((x) => x.id === ref) || list.find((x) => String(x.name).toLowerCase() === name) || null;
  }

  const KEY_ALIASES = { esquerda: 'left', direita: 'right', cima: 'up', baixo: 'down', pular: 'jump', pulo: 'jump', acao: 'action', 'ação': 'action' };

  function keyName(k) {
    const v = String(k ?? '').toLowerCase();
    const name = KEY_ALIASES[v] || v;
    if (!KEYS.includes(name)) throw new Error(`tecla desconhecida "${k}" (use left, right, up, down, jump ou action)`);
    return name;
  }

  function getProp(world, e, name) {
    if (!isEntity(e)) throw new Error(`não é um ator: não tem "${name}"`);
    switch (name) {
      case 'x':
        return e.x - e.hx;
      case 'y':
        return e.y - e.hy;
      case 'hspeed':
        return e.vx;
      case 'vspeed':
        return e.vy;
      case 'speed':
        return Math.hypot(e.vx, e.vy);
      case 'direction':
        return ((Math.atan2(-e.vy, e.vx) * 180) / Math.PI + 360) % 360;
      case 'health':
        return e.health;
      case 'facing':
        return e.dir;
      case 'on_ground':
        return e.ground;
      case 'width':
        return e.w;
      case 'height':
        return e.h;
      case 'id':
        return e.uid;
      case 'name':
        return e.actor.name;
      case 'actor':
        return e.id;
      case 'alive':
        return !e.dead;
      case 'gravity':
        return e.gravity;
      case 'animation':
        return e.anim;
      case 'start_x':
        return e.home.x - e.hx;
      case 'start_y':
        return e.home.y - e.hy;
      case 'depth':
        return e.depth;
      case 'visible':
        return e.visible !== false;
      case 'alpha':
        return e.alpha ?? 1;
      default:
        return name in e.vars ? e.vars[name] : 0;
    }
  }

  function setProp(world, e, name, v) {
    if (!isEntity(e)) throw new Error(`não é um ator: não dá para mudar "${name}"`);
    const n = Number(v);
    const value = Number.isFinite(n) ? n : 0;
    switch (name) {
      case 'x':
        e.x = value + e.hx;
        return;
      case 'y':
        e.y = value + e.hy;
        return;
      case 'hspeed':
        e.vx = value;
        if (value) e.dir = Math.sign(value);
        return;
      case 'vspeed':
        e.vy = value;
        return;
      case 'speed': {
        const d = Math.atan2(-e.vy, e.vx);
        e.vx = Math.cos(d) * value;
        e.vy = -Math.sin(d) * value;
        return;
      }
      case 'direction': {
        const sp = Math.hypot(e.vx, e.vy);
        const d = (value * Math.PI) / 180;
        e.vx = Math.cos(d) * sp;
        e.vy = -Math.sin(d) * sp;
        return;
      }
      case 'health':
        e.health = value;
        if (value <= 0) e === world.player ? killPlayer(world) : destroy(world, e);
        return;
      case 'facing':
        e.dir = value < 0 ? -1 : 1;
        return;
      case 'gravity':
        e.gravity = Boolean(v);
        return;
      case 'animation':
        e.forced = String(v ?? '');
        return;
      case 'depth':
        e.depth = value;
        return;
      case 'visible':
        e.visible = Boolean(v);
        return;
      case 'alpha':
        e.alpha = Math.max(0, Math.min(1, value));
        return;
      case 'id':
      case 'name':
      case 'actor':
      case 'alive':
      case 'on_ground':
      case 'width':
      case 'height':
      case 'speed_x':
        throw new Error(`"${name}" só pode ser lido`);
      default:
        e.vars[name] = v;
    }
  }

  function placeAt(world, e, x, y, fn) {
    const box = { x: x + e.hx, y: y + e.hy, w: e.w, h: e.h };
    return fn(box);
  }

  function solidIn(world, box, skip) {
    const c0 = Math.floor(box.x / world.tw);
    const c1 = Math.floor((box.x + box.w - 0.001) / world.tw);
    const r0 = Math.floor(box.y / world.th);
    const r1 = Math.floor((box.y + box.h - 0.001) / world.th);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (flagAt(world, c, r) & SOLID) return true;
    return world.entities.some((b) => b !== skip && !b.dead && b.behavior === 'block' && overlap(box, b));
  }

  function emit(world, x, y, count, color, speed, life) {
    const list = world.particles;
    const n = Math.max(0, Math.min(200, Math.round(count)));
    for (let i = 0; i < n && list.length < 2000; i++) {
      const a = world.game.random() * Math.PI * 2;
      const v = speed * (0.4 + world.game.random() * 0.6);
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life, max: life, color });
    }
  }

  const API = {
    player: (w) => w.player || null,
    instance_create: (w, self, other, a) => {
      const actor = findActor(w.game, a[0]);
      if (!actor) throw new Error(`o ator "${a[0]}" não existe`);
      return spawn(w, actor.id, num(a[1], 0), num(a[2], 0), { owner: self, dir: self ? self.dir : 1, vx: num(a[3], 0), vy: num(a[4], 0) });
    },
    instance_destroy: (w, self, other, a) => {
      const e = a.length ? (isEntity(a[0]) ? a[0] : null) : self;
      if (!a.length && !self) throw new Error('instance_destroy() precisa de um ator (self)');
      if (e) e === w.player ? killPlayer(w) : destroy(w, e);
      return undefined;
    },
    instance_exists: (w, self, other, a) => {
      if (isEntity(a[0])) return !a[0].dead;
      const actor = findActor(w.game, a[0]);
      return actor ? w.entities.some((x) => !x.dead && isA(w, x, actor.id)) : false;
    },
    instance_number: (w, self, other, a) => {
      const actor = findActor(w.game, a[0]);
      return actor ? w.entities.filter((x) => !x.dead && isA(w, x, actor.id)).length : 0;
    },
    instance_find: (w, self, other, a) => {
      const actor = findActor(w.game, a[0]);
      const list = actor ? w.entities.filter((x) => !x.dead && isA(w, x, actor.id)) : [];
      return list[Math.floor(num(a[1], 0))] || null;
    },
    instance_nearest: (w, self, other, a) => {
      const actor = findActor(w.game, a[0]);
      const px = a.length > 1 ? num(a[1], 0) : self ? self.x + self.w / 2 : 0;
      const py = a.length > 2 ? num(a[2], 0) : self ? self.y + self.h / 2 : 0;
      let best = null;
      let dist = Infinity;
      for (const x of w.entities) {
        if (x.dead || x === self || !actor || !isA(w, x, actor.id)) continue;
        const d = Math.hypot(x.x + x.w / 2 - px, x.y + x.h / 2 - py);
        if (d < dist) {
          dist = d;
          best = x;
        }
      }
      return best;
    },
    instance_place: (w, self, other, a) => {
      if (!self) throw new Error('instance_place precisa de um ator (self)');
      const actor = a[2] !== undefined ? findActor(w.game, a[2]) : null;
      return placeAt(w, self, num(a[0], 0), num(a[1], 0), (box) => w.entities.find((x) => x !== self && !x.dead && x.behavior !== 'decor' && (!actor || isA(w, x, actor.id)) && overlap(box, x)) || null);
    },
    place_meeting: (w, self, other, a) => API.instance_place(w, self, other, a) !== null,
    place_free: (w, self, other, a) => {
      if (!self) throw new Error('place_free precisa de um ator (self)');
      return placeAt(w, self, num(a[0], 0), num(a[1], 0), (box) => !solidIn(w, box, self));
    },
    collision_point: (w, self, other, a) => {
      const actor = a[2] !== undefined ? findActor(w.game, a[2]) : null;
      const x = num(a[0], 0);
      const y = num(a[1], 0);
      return w.entities.find((o) => !o.dead && (!actor || isA(w, o, actor.id)) && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) || null;
    },
    tile_get: (w, self, other, a) => {
      const c = Math.floor(num(a[0], -1));
      const r = Math.floor(num(a[1], -1));
      return c < 0 || r < 0 || c >= w.cols || r >= w.rows ? 0 : w.tiles[r * w.cols + c];
    },
    tile_set: (w, self, other, a) => {
      const c = Math.floor(num(a[0], -1));
      const r = Math.floor(num(a[1], -1));
      if (c < 0 || r < 0 || c >= w.cols || r >= w.rows) return false;
      w.tiles[r * w.cols + c] = Math.max(0, Math.min(65535, Math.floor(num(a[2], 0))));
      return true;
    },
    tile_at: (w, self, other, a) => API.tile_get(w, self, other, [Math.floor(num(a[0], 0) / w.tw), Math.floor(num(a[1], 0) / w.th)]),
    tile_solid: (w, self, other, a) => Boolean(flagAt(w, Math.floor(num(a[0], 0) / w.tw), Math.floor(num(a[1], 0) / w.th)) & SOLID),
    motion_set: (w, self, other, a) => {
      if (!self) throw new Error('motion_set precisa de um ator (self)');
      const d = (num(a[0], 0) * Math.PI) / 180;
      self.vx = Math.cos(d) * num(a[1], 0);
      self.vy = -Math.sin(d) * num(a[1], 0);
      if (Math.abs(self.vx) > 0.01) self.dir = Math.sign(self.vx);
      return undefined;
    },
    motion_add: (w, self, other, a) => {
      if (!self) throw new Error('motion_add precisa de um ator (self)');
      const d = (num(a[0], 0) * Math.PI) / 180;
      self.vx += Math.cos(d) * num(a[1], 0);
      self.vy -= Math.sin(d) * num(a[1], 0);
      return undefined;
    },
    move_towards_point: (w, self, other, a) => {
      if (!self) throw new Error('move_towards_point precisa de um ator (self)');
      const dx = num(a[0], 0) - (self.x - self.hx);
      const dy = num(a[1], 0) - (self.y - self.hy);
      const d = Math.hypot(dx, dy) || 1;
      self.vx = (dx / d) * num(a[2], 0);
      self.vy = (dy / d) * num(a[2], 0);
      if (Math.abs(dx) > 0.5) self.dir = Math.sign(dx);
      return undefined;
    },
    distance_to: (w, self, other, a) => {
      const t = isEntity(a[0]) ? a[0] : null;
      if (!self || !t) return 0;
      return Math.hypot(t.x + t.w / 2 - (self.x + self.w / 2), t.y + t.h / 2 - (self.y + self.h / 2));
    },
    direction_to: (w, self, other, a) => {
      const t = isEntity(a[0]) ? a[0] : null;
      if (!self || !t) return 0;
      return ((Math.atan2(-(t.y + t.h / 2 - (self.y + self.h / 2)), t.x + t.w / 2 - (self.x + self.w / 2)) * 180) / Math.PI + 360) % 360;
    },
    alarm_set: (w, self, other, a) => {
      if (!self) throw new Error('alarm_set precisa de um ator (self)');
      self.alarms[clamp(Math.floor(num(a[0], 0)), 0, 3)] = Math.max(0, num(a[1], 1));
      return undefined;
    },
    alarm_get: (w, self, other, a) => (self ? self.alarms[clamp(Math.floor(num(a[0], 0)), 0, 3)] : -1),
    key_down: (w, self, other, a) => Boolean(w.input?.[keyName(a[0])]),
    key_pressed: (w, self, other, a) => Boolean(w.input?.[keyName(a[0]) + 'Pressed']),
    key_released: (w, self, other, a) => {
      const k = keyName(a[0]);
      return Boolean(w.prevInput?.[k] && !w.input?.[k]);
    },
    sound_play: (w, self, other, a) => {
      const snd = findByName(w.game.data.sounds || [], a[0]);
      if (!snd) throw new Error(`o som "${a[0]}" não existe`);
      w.game.effects.push({ type: 'sound', sound: snd });
      return undefined;
    },
    music_play: (w, self, other, a) => {
      w.game.effects.push({ type: 'music', music: String(a[0] ?? '') || null });
      return undefined;
    },
    music_stop: (w) => {
      w.game.effects.push({ type: 'music', music: null });
      return undefined;
    },
    message: (w, self, other, a) => {
      w.message = { text: String(a[0] ?? ''), time: Math.max(0.5, num(a[1], 2)) };
      return undefined;
    },
    shake: (w, self, other, a) => {
      w.shake = Math.max(w.shake, num(a[0], 0.4));
      return undefined;
    },
    particles: (w, self, other, a) => {
      const x = a.length > 1 ? num(a[0], 0) : self ? self.x + self.w / 2 : 0;
      const y = a.length > 1 ? num(a[1], 0) : self ? self.y + self.h / 2 : 0;
      emit(w, x, y, num(a[2], 12), String(a[3] || '#f6e4a6'), num(a[4], 60), num(a[5], 0.6));
      return undefined;
    },
    scene_goto: (w, self, other, a) => {
      const sc = findByName(w.game.data.scenes, a[0]);
      if (!sc) throw new Error(`a cena "${a[0]}" não existe`);
      w.pending = { type: 'goto', scene: sc.id };
      return undefined;
    },
    scene_next: (w) => {
      w.pending = { type: 'next' };
      return undefined;
    },
    scene_previous: (w) => {
      w.pending = { type: 'prev' };
      return undefined;
    },
    scene_restart: (w) => {
      w.pending = { type: 'restart' };
      return undefined;
    },
    scene_name: (w) => w.scene.name,
    game_win: (w, self, other, a) => {
      w.pending = { type: 'win', text: String(a[0] ?? w.game.data.winText ?? 'Você venceu!') };
      return undefined;
    },
    game_lose: (w, self, other, a) => {
      w.pending = { type: 'lose', text: String(a[0] ?? w.game.data.loseText ?? 'Fim de jogo') };
      return undefined;
    },
    damage: (w, self, other, a) => {
      const e = isEntity(a[0]) ? a[0] : null;
      if (e) damage(w, e, num(a[1], 1), self);
      return undefined;
    },
    heal: (w, self, other, a) => {
      const e = isEntity(a[0]) ? a[0] : null;
      if (e) e.health = Math.min(Math.max(1, num(e.actor.props?.health, 1)), e.health + num(a[1], 1));
      return undefined;
    },
    animation_set: (w, self, other, a) => {
      if (self) self.forced = String(a[0] ?? '');
      return undefined;
    },
    camera_x: (w) => w.camera.x,
    camera_y: (w) => w.camera.y,
  };

  function scriptEnv(world, ctx, extra, game) {
    const g = game || world.game;
    const self = ctx.self || ctx.a || null;
    const other = ctx.other || ctx.b || null;
    return {
      self,
      other,
      functions: g.lib ? g.lib.functions : null,
      globals: { has: (n) => n in g.vars, get: (n) => (n in g.vars ? g.vars[n] : 0), set: (n, v) => (g.vars[n] = v) },
      random: g.random,
      print: (text) => log(g, 'print', text),
      constants: world
        ? { room_width: world.width, room_height: world.height, view_width: world.view.width, view_height: world.view.height, tile_width: world.tw, tile_height: world.th, current_time: world.time, game_speed: 60 }
        : { game_speed: 60 },
      get: (e, name) => getProp(world, e, name),
      set: (e, name, v) => setProp(world, e, name, v),
      has: (e, name) => isEntity(e) && name in e.vars,
      call: (name, args, line, target) => {
        if (extra && extra[name] && !target) return extra[name](args);
        const fn = API[name];
        if (!fn) return g.script.NOT_FOUND;
        if (!world) throw new Error(`${name} só funciona com uma cena aberta`);
        if (target && !isEntity(target)) return g.script.NOT_FOUND;
        return fn(world, target || self, other, args);
      },
    };
  }

  function normalizeInput(input = {}) {
    const out = {};
    for (const k of KEYS) {
      out[k] = Boolean(input[k]);
      out[k + 'Pressed'] = Boolean(input[k + 'Pressed']);
    }
    return out;
  }

  function createWorld(game, scene) {
    const { data, refs } = game;
    const tileset = refs.tilesets.get(scene.tileset) || null;
    const tw = tileset ? tileset.tw : 8;
    const th = tileset ? tileset.th : 8;
    const cols = Math.max(1, num(scene.cols, 20));
    const rows = Math.max(1, num(scene.rows, 15));
    const tiles = new Uint16Array(cols * rows);
    const source = scene.tiles || [];
    for (let i = 0; i < tiles.length; i++) tiles[i] = num(source[i], 0);
    let back = null;
    if (Array.isArray(scene.back)) {
      back = new Uint16Array(cols * rows);
      for (let i = 0; i < back.length; i++) back[i] = num(scene.back[i], 0);
    }
    const flags = new Uint8Array(65536);
    if (tileset) {
      for (const [k, v] of Object.entries(tileset.flags || {})) {
        const t = Number(k);
        if (t > 0 && t < 65536) flags[t] = (FLAG_BITS[v] || 0) | (Array.isArray(v) ? v.reduce((s, x) => s | (FLAG_BITS[x] || 0), 0) : 0);
      }
    }
    const world = {
      game,
      scene,
      tileset,
      tw,
      th,
      cols,
      rows,
      width: cols * tw,
      height: rows * th,
      tiles,
      back,
      flags,
      entities: [],
      uid: 0,
      player: null,
      camera: { x: 0, y: 0 },
      shake: 0,
      message: null,
      time: 0,
      touching: new Set(),
      timers: new Map(),
      varStates: new Map(),
      rules: (data.rules || []).filter((r) => !r.scene || r.scene === scene.id),
      pending: null,
      dying: 0,
      particles: [],
      input: null,
      view: { width: num(data.width, 160), height: num(data.height, 120) },
    };
    for (const p of scene.entities || []) spawn(world, p.actor, num(p.x, 0), num(p.y, 0), { dir: p.flip ? -1 : 1, code: p.code || '', lang: p.lang || 'crivo' });
    world.player = world.entities.find((e) => PLAYERS.includes(e.behavior)) || null;
    centerCamera(world, true);
    return world;
  }

  function hitboxOf(actor, sprite) {
    const hb = actor.hitbox;
    if (hb && hb.w > 0 && hb.h > 0) return { x: num(hb.x, 0), y: num(hb.y, 0), w: num(hb.w, 8), h: num(hb.h, 8) };
    if (sprite?.bounds) return { ...sprite.bounds };
    return { x: 0, y: 0, w: sprite ? sprite.w : 8, h: sprite ? sprite.h : 8 };
  }

  function defaultGravity(behavior) {
    return behavior === 'platformer' || behavior === 'patrol';
  }

  function spawn(world, actorId, x, y, extra = {}) {
    const actor = world.game.refs.actors.get(actorId);
    if (!actor) return null;
    const sprite = world.game.refs.sprites.get(actor.sprite) || null;
    const hb = hitboxOf(actor, sprite);
    const props = actor.props || {};
    const e = {
      uid: ++world.uid,
      actor,
      id: actor.id,
      behavior: actor.behavior || 'decor',
      sprite,
      x: x + hb.x,
      y: y + hb.y,
      w: hb.w,
      h: hb.h,
      hx: hb.x,
      hy: hb.y,
      vx: num(extra.vx, 0),
      vy: num(extra.vy, 0),
      dir: extra.dir || 1,
      face: { x: extra.dir || 1, y: 0 },
      ground: false,
      wall: false,
      health: Math.max(1, num(props.health, 1)),
      hurt: 0,
      dead: false,
      t: 0,
      life: num(props.life, 0),
      home: { x: x + hb.x, y: y + hb.y },
      gravity: props.gravity === undefined ? defaultGravity(actor.behavior) : Boolean(props.gravity),
      jumpsLeft: 0,
      coyote: 0,
      buffer: 0,
      cool: 0,
      drop: 0,
      owner: extra.owner || null,
      anim: '',
      animPos: 0,
      animTime: 0,
      frame: 0,
      state: 'idle',
      layer: actor.behavior === 'decor' ? 0 : PLAYERS.includes(actor.behavior) ? 2 : 1,
      depth: num(actor.depth, 0),
      code: extra.code || '',
      codeLang: extra.lang || 'crivo',
      describe() {
        return `${this.actor.name}#${this.uid}`;
      },
      vars: {},
      alarms: [-1, -1, -1, -1],
      forced: '',
      outside: false,
    };
    world.entities.push(e);
    updateAnimation(e, 0, world);
    if (world.ready) own(world, e, 'create');
    return e;
  }

  function flagAt(world, c, r) {
    if (c < 0 || c >= world.cols) return SOLID;
    if (r < 0 || r >= world.rows) return 0;
    return world.flags[world.tiles[r * world.cols + c]];
  }

  function blocks(world, e) {
    const list = world.blocks || world.entities.filter((b) => b.behavior === 'block');
    return list.filter((b) => b !== e && !b.dead);
  }

  function moveX(world, e, dx) {
    let hit = false;
    const limit = Math.max(1, Math.min(world.tw, world.th) - 1);
    let left = dx;
    while (left !== 0) {
      const d = clamp(left, -limit, limit);
      left -= d;
      e.x += d;
      const r0 = Math.floor(e.y / world.th);
      const r1 = Math.floor((e.y + e.h - 0.001) / world.th);
      if (d > 0) {
        const c = Math.floor((e.x + e.w - 0.001) / world.tw);
        for (let r = r0; r <= r1; r++) {
          if (flagAt(world, c, r) & SOLID) {
            e.x = c * world.tw - e.w;
            hit = true;
            break;
          }
        }
      } else if (d < 0) {
        const c = Math.floor(e.x / world.tw);
        for (let r = r0; r <= r1; r++) {
          if (flagAt(world, c, r) & SOLID) {
            e.x = (c + 1) * world.tw;
            hit = true;
            break;
          }
        }
      }
      for (const b of blocks(world, e)) {
        if (!overlap(e, b)) continue;
        e.x = d > 0 ? b.x - e.w : b.x + b.w;
        hit = true;
      }
      if (hit) break;
    }
    return hit;
  }

  function moveY(world, e, dy) {
    let hit = false;
    let landed = false;
    const limit = Math.max(1, Math.min(world.tw, world.th) - 1);
    let left = dy;
    while (left !== 0) {
      const d = clamp(left, -limit, limit);
      left -= d;
      const before = e.y + e.h;
      e.y += d;
      const c0 = Math.floor(e.x / world.tw);
      const c1 = Math.floor((e.x + e.w - 0.001) / world.tw);
      if (d > 0) {
        const r = Math.floor((e.y + e.h - 0.001) / world.th);
        const top = r * world.th;
        for (let c = c0; c <= c1; c++) {
          const f = flagAt(world, c, r);
          if (f & SOLID || (f & PLATFORM && e.drop <= 0 && before <= top + 0.01)) {
            e.y = top - e.h;
            hit = true;
            landed = true;
            break;
          }
        }
      } else if (d < 0) {
        const r = Math.floor(e.y / world.th);
        for (let c = c0; c <= c1; c++) {
          if (flagAt(world, c, r) & SOLID) {
            e.y = (r + 1) * world.th;
            hit = true;
            break;
          }
        }
      }
      for (const b of blocks(world, e)) {
        if (!overlap(e, b)) continue;
        if (d > 0) {
          e.y = b.y - e.h;
          landed = true;
        } else e.y = b.y + b.h;
        hit = true;
      }
      if (hit) break;
    }
    return { hit, landed };
  }

  function solidBelow(world, x, y) {
    const c = Math.floor(x / world.tw);
    const r = Math.floor(y / world.th);
    const f = flagAt(world, c, r);
    if (f & (SOLID | PLATFORM)) return true;
    return blocks(world, null).some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  function physics(world, e, dt) {
    const g = num(world.game.data.gravity, 480);
    const maxFall = num(world.game.data.maxFall, 260);
    if (e.gravity) e.vy = Math.min(maxFall, e.vy + g * dt);
    e.wall = moveX(world, e, e.vx * dt);
    if (e.wall) e.vx = 0;
    const { hit, landed } = moveY(world, e, e.vy * dt);
    e.ground = landed;
    if (hit) e.vy = 0;
    if (e.gravity && !e.ground && e.vy === 0) {
      const probe = moveY(world, e, 0.01);
      e.ground = probe.landed;
      if (!probe.landed) e.y -= 0.01;
    }
  }

  function sound(world, id) {
    if (!id) return;
    const s = world.game.refs.sounds.get(id);
    if (s) world.game.effects.push({ type: 'sound', sound: s });
  }

  function behave(world, e, input, dt) {
    const p = e.actor.props || {};
    const speed = num(p.speed, 60);
    if (e.behavior === 'platformer') {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const accel = speed * (e.ground ? 12 : 7);
      const target = e.hurt > 0.7 ? e.vx : dir * speed;
      e.vx += clamp(target - e.vx, -accel * dt, accel * dt);
      if (dir) e.dir = dir;
      e.face = { x: e.dir, y: 0 };
      const jumps = Math.max(1, num(p.jumps, 1));
      if (e.ground) {
        e.coyote = 0.1;
        e.jumpsLeft = jumps;
      } else e.coyote -= dt;
      e.buffer = input.jumpPressed ? 0.12 : e.buffer - dt;
      e.drop -= dt;
      if (input.down && input.jumpPressed && e.ground) {
        e.drop = 0.25;
        e.buffer = 0;
        e.y += 1;
      } else if (e.buffer > 0 && (e.coyote > 0 || e.jumpsLeft > 0)) {
        if (e.coyote > 0) e.jumpsLeft = jumps - 1;
        else e.jumpsLeft--;
        e.vy = -num(p.jump, 170);
        e.buffer = 0;
        e.coyote = 0;
        e.ground = false;
        sound(world, e.actor.sounds?.jump);
        fire(world, 'jump', { a: e });
      }
      if (!input.jump && e.vy < 0) e.vy += num(world.game.data.gravity, 480) * dt;
    } else if (e.behavior === 'topdown') {
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (dx && dy) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      if (e.hurt <= 0.7) {
        e.vx = dx * speed;
        e.vy = dy * speed;
      } else {
        e.vx *= 0.9;
        e.vy *= 0.9;
      }
      if (dx) e.dir = Math.sign(dx);
      if (dx || dy) e.face = { x: Math.sign(dx), y: Math.sign(dy) };
    } else if (e.behavior === 'patrol') {
      if (e.wall) e.dir = -e.dir;
      if (e.ground && p.edges !== false) {
        const fx = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
        if (!solidBelow(world, fx, e.y + e.h + 1)) e.dir = -e.dir;
      }
      e.vx = e.dir * speed;
      if (!e.gravity) {
        const range = num(p.range, 0);
        if (range > 0 && Math.abs(e.x - e.home.x) > range) {
          e.dir = e.x > e.home.x ? -1 : 1;
          e.vx = e.dir * speed;
        }
      }
    } else if (e.behavior === 'chase') {
      const target = world.player && !world.player.dead ? world.player : null;
      const range = num(p.range, 64);
      if (target) {
        const dx = target.x + target.w / 2 - (e.x + e.w / 2);
        const dy = target.y + target.h / 2 - (e.y + e.h / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < range && dist > 0.5) {
          if (e.gravity) e.vx = Math.sign(dx) * speed;
          else {
            e.vx = (dx / dist) * speed;
            e.vy = (dy / dist) * speed;
          }
          if (Math.abs(dx) > 0.5) e.dir = Math.sign(dx);
        } else {
          e.vx *= 0.8;
          if (!e.gravity) e.vy *= 0.8;
        }
      }
    } else if (e.behavior === 'flyer') {
      const range = num(p.range, 32);
      if (e.wall || (range > 0 && Math.abs(e.x - e.home.x) > range)) e.dir = e.x > e.home.x ? -1 : 1;
      e.vx = e.dir * speed;
      e.vy = Math.cos(e.t * 3) * num(p.wave, 8) * 3;
    } else if (e.behavior === 'projectile') {
      if (e.life > 0) {
        e.life -= dt;
        if (e.life <= 0) destroy(world, e);
      }
    }
    if (PLAYERS.includes(e.behavior)) shoot(world, e, input, dt);
    if (e.behavior === 'projectile') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.gravity) e.vy += num(world.game.data.gravity, 480) * dt;
      const c0 = Math.floor(e.x / world.tw);
      const c1 = Math.floor((e.x + e.w - 0.001) / world.tw);
      const r0 = Math.floor(e.y / world.th);
      const r1 = Math.floor((e.y + e.h - 0.001) / world.th);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (flagAt(world, c, r) & SOLID) e.wallHit = true;
      if (e.wallHit || e.x < -64 || e.x > world.width + 64 || e.y > world.height + 64 || e.y < -world.height) destroy(world, e);
      if (e.vx) e.dir = Math.sign(e.vx);
      return;
    }
    if (e.behavior === 'custom') {
      const friction = num(p.friction, 0);
      if (friction > 0) {
        const k = Math.max(0, 1 - friction * dt);
        e.vx *= k;
        if (!e.gravity) e.vy *= k;
      }
      if (p.collide === false) {
        if (e.gravity) e.vy = Math.min(num(world.game.data.maxFall, 260), e.vy + num(world.game.data.gravity, 480) * dt);
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.ground = false;
      } else physics(world, e, dt);
      if (Math.abs(e.vx) > 0.5) e.dir = Math.sign(e.vx);
      return;
    }
    if (['platformer', 'topdown', 'patrol', 'chase', 'flyer'].includes(e.behavior)) physics(world, e, dt);
  }

  function shoot(world, e, input, dt) {
    const p = e.actor.props || {};
    e.cool -= dt;
    if (!p.shoot || !input.actionPressed || e.cool > 0) return;
    const actor = world.game.refs.actors.get(p.shoot);
    if (!actor) return;
    const speed = num(actor.props?.speed, 160);
    const fx = e.face.x || (e.face.y ? 0 : e.dir);
    const fy = e.face.y || 0;
    const len = Math.hypot(fx, fy) || 1;
    const sprite = world.game.refs.sprites.get(actor.sprite);
    const hb = hitboxOf(actor, sprite);
    const cx = e.x + e.w / 2 + (fx / len) * (e.w / 2 + 2);
    const cy = e.y + e.h / 2 + (fy / len) * (e.h / 2 + 2);
    const shot = spawn(world, actor.id, cx - hb.x - hb.w / 2, cy - hb.y - hb.h / 2, { vx: (fx / len) * speed, vy: (fy / len) * speed, dir: fx < 0 ? -1 : 1, owner: e });
    if (shot && shot.life <= 0) shot.life = 2;
    e.cool = Math.max(0.05, num(p.cooldown, 0.35));
    sound(world, actor.sounds?.spawn || e.actor.sounds?.shoot);
  }

  function destroy(world, e) {
    if (e.dead) return;
    e.dead = true;
    own(world, e, 'destroy');
    if (world.player === e) return;
    fire(world, 'destroyed', { a: e });
    if (!world.entities.some((o) => !o.dead && o.id === e.id)) fire(world, 'cleared', { a: e });
  }

  function damage(world, e, amount, from) {
    if (e.dead || e.hurt > 0) return;
    e.health -= Math.max(0, amount);
    e.hurt = PLAYERS.includes(e.behavior) ? 1.2 : 0.25;
    if (from) {
      const side = e.x + e.w / 2 < from.x + from.w / 2 ? -1 : 1;
      if (e.behavior === 'platformer') {
        e.vx = side * 90;
        e.vy = -120;
      } else if (e.behavior === 'topdown') {
        const dx = e.x - from.x;
        const dy = e.y - from.y;
        const d = Math.hypot(dx, dy) || 1;
        e.vx = (dx / d) * 140;
        e.vy = (dy / d) * 140;
      }
    }
    sound(world, e.actor.sounds?.hurt);
    if (e === world.player) fire(world, 'hurt', { a: e, b: from });
    if (e.health <= 0) {
      if (e === world.player) killPlayer(world);
      else destroy(world, e);
    }
  }

  function killPlayer(world) {
    const p = world.player;
    if (!p || world.dying > 0) return;
    p.dead = true;
    world.dying = 1.1;
    sound(world, p.actor.sounds?.die);
    fire(world, 'died', { a: p });
  }

  function collect(world, player, item) {
    const g = world.game;
    const points = num(item.actor.props?.points, 1);
    const scoreVar = g.data.scoreVar;
    if (scoreVar && scoreVar in g.vars) g.vars[scoreVar] += points;
    sound(world, item.actor.sounds?.collect);
    if (item.actor.props?.heal) player.health = Math.min(num(player.actor.props?.health, 1), player.health + num(item.actor.props.heal, 0));
    destroy(world, item);
  }

  function interactions(world) {
    const P = world.player;
    const now = new Set();
    const live = world.entities.filter((e) => !e.dead && e.behavior !== 'decor');
    const watched = world.rules.filter((r) => r.when?.type === 'touch');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (a.dead || b.dead || !overlap(a, b)) continue;
        const key = a.uid < b.uid ? `${a.uid}:${b.uid}` : `${b.uid}:${a.uid}`;
        now.add(key);
        const begin = !world.touching.has(key);
        if (begin) {
          for (const r of watched) {
            if (isA(world, a, r.when.a) && (!r.when.b || isA(world, b, r.when.b))) run(world, r.then, { a, b });
            else if (isA(world, b, r.when.a) && (!r.when.b || isA(world, a, r.when.b))) run(world, r.then, { a: b, b: a });
          }
          own(world, a, 'collision', (ev) => !ev.other || isA(world, b, ev.other), b);
          own(world, b, 'collision', (ev) => !ev.other || isA(world, a, ev.other), a);
        }
        const pair = a === P ? [a, b] : b === P ? [b, a] : null;
        if (pair && !P.dead) {
          const o = pair[1];
          if (o.behavior === 'item' && begin) collect(world, P, o);
          else if (o.behavior === 'goal' && begin) reachGoal(world, o);
          else if (o.behavior === 'hazard') damage(world, P, num(o.actor.props?.damage, 1), o);
          else if (ENEMIES.includes(o.behavior)) {
            const stomp = P.behavior === 'platformer' && o.actor.props?.stompable !== false && P.vy > 0 && P.y + P.h - P.vy / 60 <= o.y + 3;
            if (stomp) {
              P.vy = -num(P.actor.props?.jump, 170) * 0.6;
              damage(world, o, 99, P);
              sound(world, o.actor.sounds?.die);
            } else damage(world, P, num(o.actor.props?.damage, 1), o);
          }
        }
        for (const [shot, target] of [
          [a, b],
          [b, a],
        ]) {
          if (shot.behavior !== 'projectile' || shot.dead || target.dead) continue;
          if (shot.owner && shot.owner === target) continue;
          const friendly = shot.owner && PLAYERS.includes(shot.owner.behavior);
          if (friendly && (ENEMIES.includes(target.behavior) || target.behavior === 'block' && target.actor.props?.breakable)) {
            damage(world, target, num(shot.actor.props?.damage, 1), shot);
            destroy(world, shot);
          } else if (!friendly && target === P) {
            damage(world, P, num(shot.actor.props?.damage, 1), shot);
            destroy(world, shot);
          }
        }
      }
    }
    world.touching = now;
    if (P && !P.dead) {
      const c0 = Math.floor(P.x / world.tw);
      const c1 = Math.floor((P.x + P.w - 0.001) / world.tw);
      const r0 = Math.floor(P.y / world.th);
      const r1 = Math.floor((P.y + P.h - 0.001) / world.th);
      let hazard = false;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && r < world.rows && flagAt(world, c, r) & HAZARD) hazard = true;
      if (hazard) damage(world, P, 1, null);
      if (P.y > world.height + 16) killPlayer(world);
    }
  }

  function reachGoal(world, goal) {
    const target = goal.actor.props?.scene;
    sound(world, goal.actor.sounds?.collect);
    fire(world, 'goal', { a: world.player, b: goal });
    if (world.pending) return;
    if (target) world.pending = { type: 'goto', scene: target };
    else world.pending = { type: 'next' };
  }

  function matchesTrigger(rule, type, ctx, world) {
    const w = rule.when || {};
    if (w.type !== type) return false;
    if (type === 'destroyed' || type === 'cleared') return !w.actor || isA(world, ctx.a, w.actor);
    if (type === 'goal') return !w.actor || isA(world, ctx.b, w.actor);
    return Boolean(world);
  }

  function fire(world, type, ctx) {
    for (const r of world.rules) if (matchesTrigger(r, type, ctx, world)) run(world, r.then, ctx);
  }

  function targetOf(world, which, ctx) {
    if (which === 'b' || which === 'other') return ctx.other || ctx.b || null;
    if (which === 'player') return world.player;
    if (which === 'self') return ctx.self || ctx.a || null;
    return ctx.a || world.player;
  }

  function compare(a, op, b) {
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '!=') return a !== b;
    return a === b;
  }

  function run(world, actions, ctx) {
    const g = world.game;
    for (const act of actions || []) {
      if (world !== g.world && act.type !== 'sound') return;
      const t = act.type;
      if (t === 'add' && act.name) g.vars[act.name] = num(g.vars[act.name], 0) + num(act.value, 1);
      else if (t === 'set' && act.name) g.vars[act.name] = num(act.value, 0);
      else if (t === 'destroy') {
        const e = targetOf(world, act.target, ctx);
        if (e) e === world.player ? killPlayer(world) : destroy(world, e);
      } else if (t === 'destroyAll') {
        for (const e of world.entities) if (!e.dead && e.id === act.actor && e !== world.player) destroy(world, e);
      } else if (t === 'damage') {
        const e = targetOf(world, act.target, ctx);
        if (e) damage(world, e, num(act.value, 1), ctx.b && ctx.b !== e ? ctx.b : null);
      } else if (t === 'heal') {
        const e = targetOf(world, act.target, ctx);
        if (e) e.health = Math.min(Math.max(1, num(e.actor.props?.health, 1)), e.health + num(act.value, 1));
      } else if (t === 'spawn') {
        const at = targetOf(world, act.at, ctx);
        const x = (at ? at.x - at.hx : 0) + num(act.dx, 0);
        const y = (at ? at.y - at.hy : 0) + num(act.dy, 0);
        const dir = at ? at.dir : 1;
        spawn(world, act.actor, x, y, { vx: num(act.vx, 0) * dir, vy: num(act.vy, 0), dir, owner: at });
      } else if (t === 'sound') sound(world, act.sound);
      else if (t === 'message') world.message = { text: act.text || '', time: Math.max(0.5, num(act.seconds, 2)) };
      else if (t === 'goto' && act.scene) world.pending = { type: 'goto', scene: act.scene };
      else if (t === 'next') world.pending = { type: 'next' };
      else if (t === 'restart') world.pending = { type: 'restart' };
      else if (t === 'win') world.pending = { type: 'win', text: act.text || 'Você venceu!' };
      else if (t === 'lose') world.pending = { type: 'lose', text: act.text || 'Fim de jogo' };
      else if (t === 'shake') world.shake = Math.max(world.shake, num(act.seconds, 0.4));
      else if (t === 'bounce') {
        const e = targetOf(world, act.target, ctx);
        if (e) e.vy = -num(act.value, 160);
      } else if (t === 'velocity') {
        const e = targetOf(world, act.target, ctx);
        if (e) {
          e.vx = num(act.vx, 0) * (act.relative ? e.dir : 1);
          e.vy = num(act.vy, 0);
        }
      } else if (t === 'setAlarm') {
        const e = targetOf(world, act.target || 'self', ctx);
        const n = clamp(Math.round(num(act.alarm, 0)), 0, 3);
        if (e) e.alarms[n] = Math.max(0, num(act.seconds, 1));
      } else if (t === 'addLocal' || t === 'setLocal') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e && act.local) e.vars[act.local] = (t === 'addLocal' ? num(e.vars[act.local], 0) : 0) + num(act.value, 0);
      } else if (t === 'motion') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) {
          const rad = (num(act.direction, 0) * Math.PI) / 180;
          e.vx = Math.cos(rad) * num(act.speed, 0);
          e.vy = -Math.sin(rad) * num(act.speed, 0);
          if (Math.abs(e.vx) > 0.01) e.dir = Math.sign(e.vx);
        }
      } else if (t === 'towards') {
        const e = targetOf(world, act.target || 'self', ctx);
        const P = world.player;
        if (e && P && e !== P) {
          const dx = P.x + P.w / 2 - (e.x + e.w / 2);
          const dy = P.y + P.h / 2 - (e.y + e.h / 2);
          const d = Math.hypot(dx, dy) || 1;
          e.vx = (dx / d) * num(act.speed, 40);
          if (!e.gravity) e.vy = (dy / d) * num(act.speed, 40);
          if (Math.abs(dx) > 0.5) e.dir = Math.sign(dx);
        }
      } else if (t === 'reverseX' || t === 'reverseY' || t === 'stop') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) {
          if (t === 'reverseX') {
            e.vx = -e.vx;
            e.dir = -e.dir;
          } else if (t === 'reverseY') e.vy = -e.vy;
          else {
            e.vx = 0;
            e.vy = 0;
          }
        }
      } else if (t === 'gravity') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) e.gravity = act.toggle !== 'off';
      } else if (t === 'animation') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) e.forced = act.anim || '';
      } else if (t === 'jumpStart') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) {
          e.x = e.home.x;
          e.y = e.home.y;
          e.vx = 0;
          e.vy = 0;
        }
      } else if (t === 'code') runCode(world, act.code, ctx, 'código', act.lang);
      else if (t === 'particles') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) emit(world, e.x + e.w / 2, e.y + e.h / 2, num(act.count, 12), act.color || '#f6e4a6', num(act.speed, 60), 0.6);
      } else if (t === 'music') g.effects.push({ type: 'music', music: act.text || null });
      else if (t === 'stopMusic') g.effects.push({ type: 'music', music: null });
      else if (t === 'prev') world.pending = { type: 'prev' };
      else if (t === 'teleport') {
        const e = targetOf(world, act.target, ctx);
        if (e) {
          e.x = num(act.x, 0) + e.hx;
          e.y = num(act.y, 0) + e.hy;
          e.vx = 0;
          e.vy = 0;
        }
      }
    }
  }

  function rulesPerStep(world, input, dt) {
    for (const r of world.rules) {
      const w = r.when || {};
      if (w.type === 'press') {
        if (input[(w.key || 'action') + 'Pressed']) run(world, r.then, { a: world.player });
      } else if (w.type === 'every') {
        const every = Math.max(0.1, num(w.seconds, 1));
        const t = (world.timers.get(r) || 0) + dt;
        if (t >= every) {
          world.timers.set(r, t - every);
          run(world, r.then, { a: world.player });
        } else world.timers.set(r, t);
      } else if (w.type === 'var' && w.name) {
        const now = compare(num(world.game.vars[w.name], 0), w.op || '>=', num(w.value, 0));
        const before = world.varStates.get(r) || false;
        world.varStates.set(r, now);
        if (now && !before) run(world, r.then, { a: world.player });
      }
    }
  }

  function animationState(e) {
    if (e.dead) return 'idle';
    if (e.hurt > 0.6 && PLAYERS.includes(e.behavior)) return 'hurt';
    if (e.behavior === 'platformer' || (e.gravity && ENEMIES.includes(e.behavior))) {
      if (!e.ground) return e.vy < 0 ? 'jump' : 'fall';
      return Math.abs(e.vx) > 4 ? 'run' : 'idle';
    }
    if (e.behavior === 'custom' && e.gravity && !e.ground) return e.vy < 0 ? 'jump' : 'fall';
    return Math.abs(e.vx) > 4 || Math.abs(e.vy) > 4 ? 'run' : 'idle';
  }

  function updateAnimation(e, dt, world) {
    const sprite = e.sprite;
    if (!sprite || !sprite.frames?.length) return;
    e.state = animationState(e);
    const map = e.actor.anims || {};
    const name = (e.forced && sprite.anims?.[e.forced] ? e.forced : '') || map[e.state] || (e.state === 'fall' ? map.jump : '') || (e.state === 'hurt' ? map.idle : '') || map.idle || '';
    const seq = (name && sprite.anims?.[name]) || sprite.all || { frames: sprite.frames.map((_, i) => i), loop: true };
    if (e.anim !== name || e.seq !== seq) {
      e.anim = name;
      e.seq = seq;
      e.animPos = 0;
      e.animTime = 0;
    }
    if (!seq.frames.length) return;
    e.animTime += dt;
    let guard = 0;
    for (;;) {
      const f = seq.frames[e.animPos] ?? 0;
      const d = Math.max(0.016, num(sprite.frames[f]?.d, 0.1));
      if (e.animTime < d || guard++ > 64) break;
      e.animTime -= d;
      if (e.animPos + 1 >= seq.frames.length) {
        if (world && dt > 0) own(world, e, 'animationEnd');
        if (seq.loop) e.animPos = 0;
        else {
          e.animTime = 0;
          break;
        }
      } else e.animPos++;
    }
    e.frame = seq.frames[e.animPos] ?? 0;
  }

  function centerCamera(world, snap, dt = STEP) {
    const P = world.player;
    const W = world.view.width;
    const H = world.view.height;
    let tx = world.camera.x;
    let ty = world.camera.y;
    if (P) {
      tx = P.x + P.w / 2 - W / 2 + P.dir * 12;
      ty = P.y + P.h / 2 - H / 2;
    }
    tx = world.width <= W ? (world.width - W) / 2 : clamp(tx, 0, world.width - W);
    ty = world.height <= H ? (world.height - H) / 2 : clamp(ty, 0, world.height - H);
    if (snap) {
      world.camera.x = tx;
      world.camera.y = ty;
    } else {
      const k = Math.min(1, dt * 7);
      world.camera.x += (tx - world.camera.x) * k;
      world.camera.y += (ty - world.camera.y) * k;
    }
  }

  function stepWorld(game, world, input, dt) {
    world.time += dt;
    if (world.message) {
      world.message.time -= dt;
      if (world.message.time <= 0) world.message = null;
    }
    if (world.shake > 0) world.shake = Math.max(0, world.shake - dt);
    if (game.status !== 'playing') {
      game.ended.time -= dt;
      if (game.ended.time <= 0) world.pending = { type: 'title' };
      return;
    }
    if (world.dying > 0) {
      world.dying -= dt;
      if (world.dying <= 0) world.pending = { type: 'died' };
      for (const e of world.entities) if (!e.dead) updateAnimation(e, dt, world);
      return;
    }
    world.input = input;
    for (const pt of world.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 140 * dt;
      pt.life -= dt;
    }
    if (world.particles.length) world.particles = world.particles.filter((pt) => pt.life > 0);
    rulesPerStep(world, input, dt);
    world.blocks = world.entities.filter((b) => !b.dead && b.behavior === 'block');
    const none = normalizeInput({});
    const prev = world.prevInput || none;
    for (const e of [...world.entities]) {
      if (e.dead) continue;
      e.t += dt;
      if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
      for (let n = 0; n < 4; n++) {
        if (e.alarms[n] < 0) continue;
        e.alarms[n] -= dt;
        if (e.alarms[n] <= 0) {
          e.alarms[n] = -1;
          own(world, e, 'alarm', (ev) => num(ev.alarm, 0) === n);
        }
      }
      if (e.dead) continue;
      own(world, e, 'step');
      for (const k of KEYS) {
        if (input[k + 'Pressed']) own(world, e, 'keyPress', (ev) => ev.key === k);
        if (input[k]) own(world, e, 'keyDown', (ev) => ev.key === k);
        if (prev[k] && !input[k]) own(world, e, 'keyRelease', (ev) => ev.key === k);
      }
      if (e.dead) continue;
      behave(world, e, PLAYERS.includes(e.behavior) && e === world.player ? input : none, dt);
      const out = e.x + e.w < 0 || e.x > world.width || e.y + e.h < 0 || e.y > world.height;
      if (out && !e.outside) own(world, e, 'outside');
      e.outside = out;
    }
    world.prevInput = input;
    world.blocks = null;
    interactions(world);
    for (const e of world.entities) if (!e.dead) updateAnimation(e, dt, world);
    world.entities = world.entities.filter((e) => !e.dead || e === world.player);
    centerCamera(world, false, dt);
  }

  function sceneAfter(game, id) {
    const list = game.data.scenes;
    const i = list.findIndex((s) => s.id === id);
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  }

  function end(game, kind, text) {
    game.status = kind;
    game.ended = { kind, text, time: 3.2 };
    if (game.world) {
      game.world.message = { text, time: 3.2 };
      game.world.pending = null;
    }
    game.effects.push({ type: 'music', music: null });
    const s = kind === 'won' ? game.data.winSound : game.data.loseSound;
    if (s && game.world) sound(game.world, s);
  }

  function resolvePending(game) {
    const world = game.world;
    if (!world || !world.pending) return;
    const p = world.pending;
    world.pending = null;
    const livesVar = game.data.livesVar;
    if (p.type === 'goto') game.load(p.scene);
    else if (p.type === 'prev') {
      const list = game.data.scenes;
      const i = list.findIndex((s) => s.id === world.scene.id);
      game.load(list[Math.max(0, i - 1)].id);
    }
    else if (p.type === 'restart') game.load(world.scene.id);
    else if (p.type === 'next') {
      const next = sceneAfter(game, world.scene.id);
      if (next) game.load(next.id);
      else end(game, 'won', game.data.winText || 'Você venceu!');
    } else if (p.type === 'win') end(game, 'won', format(p.text, game.vars));
    else if (p.type === 'lose') end(game, 'lost', format(p.text, game.vars));
    else if (p.type === 'died') {
      if (livesVar && livesVar in game.vars) {
        game.vars[livesVar] -= 1;
        if (game.vars[livesVar] <= 0) {
          end(game, 'lost', game.data.loseText || 'Fim de jogo');
          return;
        }
      }
      game.load(world.scene.id);
    } else if (p.type === 'title') {
      game.status = 'title';
      game.effects.push({ type: 'title' });
    }
  }

  function hud(game) {
    const out = [];
    for (const v of game.data.vars || []) if (v.hud) out.push({ label: v.label || v.name, value: game.vars[v.name] ?? 0 });
    return out;
  }

  return {
    SOLID,
    PLATFORM,
    HAZARD,
    STEP,
    KEYS,
    unpack,
    createGame,
    isA,
    API_NAMES: Object.keys(API),
    format,
    hud,
    overlap,
    random,
  };
}
