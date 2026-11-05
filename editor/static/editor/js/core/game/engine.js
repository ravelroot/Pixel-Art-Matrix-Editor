export function gameEngine() {
  const SOLID = 1;
  const PLATFORM = 2;
  const HAZARD = 4;
  const LADDER = 8;
  const WATER = 16;
  const ICE = 32;
  const BOUNCE = 64;
  const FLAG_BITS = { solid: SOLID, platform: PLATFORM, hazard: HAZARD, ladder: LADDER, water: WATER, ice: SOLID | ICE, bounce: SOLID | BOUNCE };
  const ENEMIES = ['patrol', 'chase', 'flyer', 'pathfinder', 'turret'];
  const PLAYERS = ['platformer', 'topdown'];
  const SOLIDS = ['block', 'mover'];
  const STEP = 1 / 60;
  const ALARMS = 12;
  const KEYS = ['left', 'right', 'up', 'down', 'jump', 'action', 'dash'];
  const MOUSE = ['left', 'right', 'middle'];
  const EASE = {
    linear: (t) => t,
    in_quad: (t) => t * t,
    out_quad: (t) => 1 - (1 - t) * (1 - t),
    in_out_quad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
    out_cubic: (t) => 1 - (1 - t) ** 3,
    in_out_sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    out_back: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    out_elastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
    out_bounce: (t) => {
      const n = 7.5625;
      const d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
  };
  const PRESETS = {
    explosion: { count: 26, colors: ['#faf6ef', '#f6e4a6', '#e8a33c', '#d04a3a', '#5c4034'], speed: 90, life: 0.7, gravity: 60, drag: 2.5, size: 2, shrink: true, light: 48 },
    dust: { count: 8, colors: ['#e6ddce', '#d6bdb8', '#a3b4be'], speed: 28, life: 0.45, gravity: -10, drag: 4, size: 1, up: true },
    sparkle: { count: 12, colors: ['#faf6ef', '#f6e4a6', '#fff7c2'], speed: 45, life: 0.55, gravity: 0, drag: 3, size: 1, twinkle: true, light: 20 },
    smoke: { count: 10, colors: ['#8f8a86', '#6d6866', '#4f4a48'], speed: 18, life: 1.1, gravity: -28, drag: 1.5, size: 3, shrink: true, up: true },
    fire: { count: 14, colors: ['#fff2b0', '#f6c453', '#e8743c', '#b8382a'], speed: 26, life: 0.6, gravity: -70, drag: 2, size: 2, shrink: true, up: true, light: 36 },
    splash: { count: 14, colors: ['#e3ecef', '#a3c4d6', '#5d8fb0'], speed: 70, life: 0.6, gravity: 320, drag: 0.5, size: 1, up: true },
    confetti: { count: 30, colors: ['#d04a3a', '#f6e4a6', '#55a3d6', '#8a9a4a', '#ab5bb4'], speed: 110, life: 1.4, gravity: 140, drag: 1.2, size: 2, up: true },
    magic: { count: 18, colors: ['#c9a4ff', '#8f6bff', '#faf6ef', '#6bd6ff'], speed: 40, life: 0.9, gravity: -20, drag: 1.8, size: 1, twinkle: true, light: 30 },
  };
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
          const sig = `${ev.type}:${ev.key || ''}:${ev.alarm ?? ''}:${ev.other || ''}:${ev.signal || ''}`;
          if (seen.has(sig) && id !== a.id) continue;
          if (id === a.id) seen.add(sig);
          list.push(ev);
        }
        for (const ev of actors.get(id).events || []) seen.add(`${ev.type}:${ev.key || ''}:${ev.alarm ?? ''}:${ev.other || ''}:${ev.signal || ''}`);
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
    if (cond.kind === 'key') return Boolean(world.input?.[cond.key || 'action']);
    if (cond.kind === 'near') {
      const P = world.player;
      return Boolean(self && P && !P.dead && P !== self && centerDistance(self, P) <= num(cond.value, 32));
    }
    if (cond.kind === 'sees') {
      const P = world.player;
      return Boolean(self && P && !P.dead && lineOfSight(world, self, P));
    }
    if (cond.kind === 'expr') {
      if (!cond.code) return true;
      const v = runCode(world, cond.code, ctx, 'condição', cond.lang);
      return v !== null && v !== undefined && v !== false && v !== 0 && v !== '';
    }
    return true;
  }

  function centerDistance(a, b) {
    return Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2));
  }

  function rayTiles(world, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return flagAt(world, Math.floor(x1 / world.tw), Math.floor(y1 / world.th)) & SOLID ? 0 : -1;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    let c = Math.floor(x1 / world.tw);
    let r = Math.floor(y1 / world.th);
    const endC = Math.floor(x2 / world.tw);
    const endR = Math.floor(y2 / world.th);
    const tDeltaX = stepX ? Math.abs(world.tw / dx) : Infinity;
    const tDeltaY = stepY ? Math.abs(world.th / dy) : Infinity;
    let tMaxX = stepX > 0 ? ((c + 1) * world.tw - x1) / dx : stepX < 0 ? (c * world.tw - x1) / dx : Infinity;
    let tMaxY = stepY > 0 ? ((r + 1) * world.th - y1) / dy : stepY < 0 ? (r * world.th - y1) / dy : Infinity;
    let t = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (r >= 0 && r < world.rows && flagAt(world, c, r) & SOLID) return t * len;
      if (c === endC && r === endR) return -1;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        c += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        r += stepY;
      }
      if (t > 1) return -1;
    }
    return -1;
  }

  function lineOfSight(world, a, b) {
    return rayTiles(world, a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2) < 0;
  }

  function findPath(world, x1, y1, x2, y2, limit = 6000) {
    const cols = world.cols;
    const rows = world.rows;
    const sc = clamp(Math.floor(x1 / world.tw), 0, cols - 1);
    const sr = clamp(Math.floor(y1 / world.th), 0, rows - 1);
    const ec = clamp(Math.floor(x2 / world.tw), 0, cols - 1);
    const er = clamp(Math.floor(y2 / world.th), 0, rows - 1);
    const blocked = (c, r) => c < 0 || r < 0 || c >= cols || r >= rows || Boolean(world.flags[world.tiles[r * cols + c]] & SOLID);
    if (blocked(ec, er)) return [];
    const start = sr * cols + sc;
    const goal = er * cols + ec;
    if (start === goal) return [[ec * world.tw + world.tw / 2, er * world.th + world.th / 2]];
    const g = new Map([[start, 0]]);
    const from = new Map();
    const open = [[0, start]];
    const closed = new Set();
    const h = (i) => {
      const dc = Math.abs((i % cols) - ec);
      const dr = Math.abs(Math.floor(i / cols) - er);
      return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
    };
    const push = (item) => {
      open.push(item);
      let k = open.length - 1;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (open[parent][0] <= open[k][0]) break;
        [open[parent], open[k]] = [open[k], open[parent]];
        k = parent;
      }
    };
    const pop = () => {
      const top = open[0];
      const last = open.pop();
      if (open.length) {
        open[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === k) break;
          [open[m], open[k]] = [open[k], open[m]];
          k = m;
        }
      }
      return top;
    };
    let found = false;
    let visits = 0;
    while (open.length && visits++ < limit) {
      const [, cur] = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const c = cur % cols;
      const r = Math.floor(cur / cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (blocked(nc, nr)) continue;
          if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;
          const next = nr * cols + nc;
          if (closed.has(next)) continue;
          const cost = g.get(cur) + (dc && dr ? Math.SQRT2 : 1);
          if (cost < (g.get(next) ?? Infinity)) {
            g.set(next, cost);
            from.set(next, cur);
            push([cost + h(next), next]);
          }
        }
      }
    }
    if (!found) return [];
    const out = [];
    for (let cur = goal; cur !== start; cur = from.get(cur)) out.push([(cur % cols) * world.tw + world.tw / 2, Math.floor(cur / cols) * world.th + world.th / 2]);
    return out.reverse();
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
    const memory = new Map();
    const store = options.storage || { get: (k) => (memory.has(k) ? memory.get(k) : null), set: (k, v) => memory.set(k, v), remove: (k) => memory.delete(k) };
    const game = {
      data,
      refs,
      storage: store,
      checkpoint: null,
      vars: initialVars(data),
      persist: {},
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
      load(sceneId, { respawn = false } = {}) {
        const scene = data.scenes.find((s) => s.id === sceneId) || data.scenes[0];
        if (!scene) {
          game.world = null;
          return null;
        }
        if (!(respawn && game.checkpoint?.scene === scene.id)) game.checkpoint = null;
        const prev = game.world;
        if (prev && prev.scene?.persistent && (prev.scene.id !== scene.id || respawn)) game.persist[prev.scene.id] = snapshotScene(prev);
        else if (prev && prev.scene?.id === scene.id && !respawn) delete game.persist[scene.id];
        const world = createWorld(game, scene);
        game.world = world;
        if (scene.persistent && game.persist[scene.id]) restoreScene(world, game.persist[scene.id]);
        if (game.checkpoint && world.player) {
          world.player.x = game.checkpoint.x;
          world.player.y = game.checkpoint.y;
          for (const e of world.entities) if (e.behavior === 'checkpoint' && e.uid === game.checkpoint.uid) e.active = true;
          centerCamera(world, true);
        }
        if (data.transition) world.fade = { kind: data.transition, time: 0.45, max: 0.45 };
        if (scene.music) game.effects.push({ type: 'music', music: scene.music });
        else game.effects.push({ type: 'music', music: null });
        world.ready = true;
        for (const e of [...world.entities]) if (!e.restored) own(world, e, 'create');
        for (const e of [...world.entities]) if (e.code && !e.restored) runCode(world, e.code, { a: e, self: e, where: `${e.actor.name} (código da instância)` }, 'código', e.codeLang);
        for (const e of [...world.entities]) own(world, e, 'sceneStart');
        fire(world, 'start', {});
        return game.world;
      },
      reset() {
        game.vars = initialVars(data);
        game.status = 'playing';
        game.ended = null;
        game.checkpoint = null;
        game.persist = {};
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
        const world = game.world;
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        game.time += dt;
        const clean = normalizeInput(input);
        if (world.freeze > 0) {
          world.freeze = Math.max(0, world.freeze - dt);
          world.input = clean;
          tickEffects(world, dt);
        } else {
          let scale = 1;
          if (world.slow) {
            scale = world.slow.factor;
            world.slow.time -= dt;
            if (world.slow.time <= 0) world.slow = null;
          }
          stepWorld(game, world, clean, dt * scale, dt);
        }
        resolvePending(game);
        if (game.world === world && t0) world.stats.step = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      },
      signal(name) {
        if (game.world) sendSignal(game.world, name);
        resolvePending(game);
      },
      place(x, y) {
        const w = game.world;
        const P = w?.player;
        if (!P) return false;
        P.x = num(x, 0) - P.w / 2;
        P.y = num(y, 0) - P.h;
        P.vx = 0;
        P.vy = 0;
        P.climbing = false;
        centerCamera(w, true);
        return true;
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
  const isMap = (v) => Boolean(v && typeof v === 'object' && v.__map === true && v.data);
  const newMap = () => ({ __map: true, data: Object.create(null), describe() {
    return `mapa(${Object.keys(this.data).length})`;
  } });

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

  const KEY_ALIASES = { esquerda: 'left', direita: 'right', cima: 'up', baixo: 'down', pular: 'jump', pulo: 'jump', acao: 'action', 'ação': 'action', investida: 'dash', correr: 'dash' };

  function keyName(k) {
    const v = String(k ?? '').toLowerCase();
    const name = KEY_ALIASES[v] || v;
    if (!KEYS.includes(name)) throw new Error(`tecla desconhecida "${k}" (use left, right, up, down, jump, action ou dash)`);
    return name;
  }

  function mouseButton(b) {
    const v = String(b ?? 'left').toLowerCase();
    const name = { esquerdo: 'left', direito: 'right', meio: 'middle', 0: 'left', 1: 'middle', 2: 'right' }[v] || v;
    if (!MOUSE.includes(name)) throw new Error(`botão do mouse desconhecido "${b}" (use left, right ou middle)`);
    return name;
  }

  function entityRef(w, v, self) {
    if (isEntity(v)) return v;
    if (v === undefined) return self;
    return null;
  }

  function getProp(world, e, name) {
    if (isMap(e)) return name in e.data ? e.data[name] : null;
    if (!isEntity(e)) throw new Error(`não é um ator: não tem "${name}"`);
    switch (name) {
      case 'xscale':
      case 'image_xscale':
        return e.sx;
      case 'yscale':
      case 'image_yscale':
        return e.sy;
      case 'scale':
        return e.sx;
      case 'angle':
      case 'image_angle':
        return e.angle;
      case 'image_index':
        return e.frame;
      case 'image_speed':
        return e.imageSpeed;
      case 'light':
        return e.light ? e.light.radius : 0;
      case 'climbing':
        return e.climbing;
      case 'in_water':
        return e.inWater;
      case 'dashing':
        return e.dashTime > 0;
      case 'on_wall':
        return e.wallSlide;
      case 'active':
        return e.active;
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
    if (isMap(e)) {
      e.data[name] = v;
      return;
    }
    if (!isEntity(e)) throw new Error(`não é um ator: não dá para mudar "${name}"`);
    const n = Number(v);
    const value = Number.isFinite(n) ? n : 0;
    switch (name) {
      case 'xscale':
      case 'image_xscale':
        e.sx = value;
        return;
      case 'yscale':
      case 'image_yscale':
        e.sy = value;
        return;
      case 'scale':
        e.sx = value;
        e.sy = value;
        return;
      case 'angle':
      case 'image_angle':
        e.angle = value;
        return;
      case 'image_index':
        if (e.seq?.frames?.length) {
          e.animPos = ((Math.floor(value) % e.seq.frames.length) + e.seq.frames.length) % e.seq.frames.length;
          e.frame = e.seq.frames[e.animPos];
          e.animTime = 0;
        }
        return;
      case 'image_speed':
        e.imageSpeed = Math.max(0, value);
        return;
      case 'light':
        if (value <= 0) e.light = null;
        else e.light = { radius: value, color: e.light?.color || '#ffd98a', flicker: Boolean(e.light?.flicker) };
        return;
      case 'climbing':
      case 'in_water':
      case 'dashing':
      case 'on_wall':
      case 'active':
        throw new Error(`"${name}" só pode ser lido`);
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
    return world.entities.some((b) => b !== skip && !b.dead && SOLIDS.includes(b.behavior) && !oneWay(b) && overlap(box, b));
  }

  function emit(world, x, y, count, color, speed, life) {
    const list = world.particles;
    const n = Math.max(0, Math.min(200, Math.round(count)));
    for (let i = 0; i < n && list.length < 2000; i++) {
      const a = world.game.random() * Math.PI * 2;
      const v = speed * (0.4 + world.game.random() * 0.6);
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life, max: life, color, g: 140, drag: 0, size: 0 });
    }
  }

  function effect(world, preset, x, y, count = null, color = null) {
    const p = PRESETS[preset] || PRESETS.explosion;
    const list = world.particles;
    const rnd = world.game.random;
    const k = Math.max(1, world.tw / 8);
    const n = Math.max(0, Math.min(300, Math.round(count ?? p.count)));
    for (let i = 0; i < n && list.length < 3000; i++) {
      const a = p.up ? -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.1 : rnd() * Math.PI * 2;
      const v = p.speed * k * (0.35 + rnd() * 0.65);
      const life = p.life * (0.6 + rnd() * 0.6);
      list.push({ x: x + (rnd() - 0.5) * 2 * k, y: y + (rnd() - 0.5) * 2 * k, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color: color || p.colors[Math.floor(rnd() * p.colors.length)], g: p.gravity * k, drag: p.drag, size: Math.max(1, Math.round(p.size * k)), shrink: Boolean(p.shrink), twinkle: Boolean(p.twinkle) });
    }
    if (p.light) world.lights.push({ x, y, radius: p.light * k, color: p.colors[1] || '#ffd98a', life: p.life * 0.6, max: p.life * 0.6 });
  }

  function floatText(world, x, y, text, color) {
    if (world.floats.length > 120) world.floats.shift();
    world.floats.push({ x, y, text: String(text ?? ''), color: color || '#faf6ef', life: 1, max: 1 });
  }

  function addTween(world, e, prop, to, seconds, ease = 'out_quad', options = {}) {
    if (!isEntity(e)) throw new Error('tween precisa de um ator');
    const name = String(prop);
    world.tweens = world.tweens.filter((t) => !(t.e === e && t.prop === name));
    const from = Number(getProp(world, e, name)) || 0;
    world.tweens.push({ e, prop: name, from, to: Number(to) || 0, t: 0, d: Math.max(0.001, Number(seconds) || 0.001), ease: EASE[ease] ? ease : 'out_quad', yoyo: Boolean(options.yoyo), loop: Boolean(options.loop) });
  }

  function stepTweens(world, dt) {
    if (!world.tweens.length) return;
    const done = [];
    for (const tw of world.tweens) {
      if (tw.e.dead) {
        done.push(tw);
        continue;
      }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.d);
      const v = tw.from + (tw.to - tw.from) * EASE[tw.ease](k);
      try {
        setProp(world, tw.e, tw.prop, v);
      } catch {
        done.push(tw);
        continue;
      }
      if (k >= 1) {
        if (tw.yoyo) {
          [tw.from, tw.to] = [tw.to, tw.from];
          tw.t = 0;
          if (!tw.loop) tw.yoyo = false;
        } else if (tw.loop) tw.t = 0;
        else done.push(tw);
      }
    }
    if (done.length) world.tweens = world.tweens.filter((t) => !done.includes(t));
  }

  function openDialog(world, text, speaker = '', signal = '', from = null) {
    const pages = String(text ?? '').split('|').map((p) => format(p.trim(), world.game.vars)).filter(Boolean);
    if (!pages.length) return;
    world.dialog = { speaker: String(speaker || ''), pages, page: 0, shown: 0, signal: String(signal || ''), from };
    if (from) sound(world, from.actor.sounds?.talk);
  }

  function stepDialog(world, input, dt) {
    const d = world.dialog;
    const page = d.pages[d.page] || '';
    d.shown = Math.min(page.length, d.shown + dt * num(world.game.data.textSpeed, 40));
    if (input.actionPressed || input.jumpPressed) {
      if (d.shown < page.length) d.shown = page.length;
      else if (d.page + 1 < d.pages.length) {
        d.page++;
        d.shown = 0;
      } else {
        world.dialog = null;
        if (d.from) own(world, d.from, 'dialogEnd');
        if (d.signal) sendSignal(world, d.signal);
      }
    }
  }

  function sendSignal(world, name) {
    const sig = String(name ?? '').trim().toLowerCase();
    if (!sig) return;
    world.signals = (world.signals || 0) + 1;
    if (world.signals > 64) throw new Error(`sinais demais em sequência ("${sig}")`);
    try {
      for (const e of [...world.entities]) if (!e.dead) own(world, e, 'signal', (ev) => ev.signal === sig);
      for (const r of world.rules) if (r.when?.type === 'signal' && r.when.signal === sig) run(world, r.then, { a: world.player });
    } finally {
      world.signals--;
    }
  }

  function drawCommand(world, cmd) {
    const list = world.drawTarget === 'gui' ? world.gui : world.draws;
    if (list.length < 4000) list.push({ ...cmd, alpha: world.drawAlpha });
  }

  function saveKey(game, slot) {
    return `jogo:${Math.max(0, Math.min(9, Math.floor(num(slot, 0))))}`;
  }

  function saveGame(world, slot) {
    const g = world.game;
    const P = world.player;
    const payload = { scene: world.scene.id, vars: { ...g.vars }, checkpoint: g.checkpoint, player: P ? { x: P.x, y: P.y, health: P.health } : null, time: g.time };
    g.storage.set(saveKey(g, slot), JSON.stringify(payload));
    return true;
  }

  function loadGame(world, slot) {
    const g = world.game;
    const raw = g.storage.get(saveKey(g, slot));
    if (!raw) return false;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!data || !g.data.scenes.some((s) => s.id === data.scene)) return false;
    world.pending = { type: 'loadSave', save: data };
    return true;
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
      self.alarms[clamp(Math.floor(num(a[0], 0)), 0, ALARMS - 1)] = Math.max(0, num(a[1], 1));
      return undefined;
    },
    alarm_get: (w, self, other, a) => (self ? self.alarms[clamp(Math.floor(num(a[0], 0)), 0, ALARMS - 1)] : -1),
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
    camera_zoom: (w, self, other, a) => {
      if (a.length) {
        w.camera.zoomTo = clamp(num(a[0], 1), 0.25, 8);
        w.camera.zoomSpeed = a.length > 1 ? Math.max(0, num(a[1], 0)) : 0;
        if (!w.camera.zoomSpeed) w.camera.zoom = w.camera.zoomTo;
      }
      return w.camera.zoom;
    },
    camera_set: (w, self, other, a) => {
      w.camera.target = null;
      w.camera.mode = 'fixed';
      w.camera.x = num(a[0], 0);
      w.camera.y = num(a[1], 0);
      return undefined;
    },
    camera_follow: (w, self, other, a) => {
      const t = a.length ? (isEntity(a[0]) ? a[0] : null) : self;
      w.camera.target = t;
      if (w.camera.mode === 'fixed') w.camera.mode = 'smooth';
      return undefined;
    },
    camera_mode: (w, self, other, a) => {
      const m = String(a[0] ?? '');
      if (!['smooth', 'deadzone', 'snap', 'fixed'].includes(m)) throw new Error(`modo de câmera desconhecido "${m}" (smooth, deadzone, snap ou fixed)`);
      w.camera.mode = m;
      return undefined;
    },
    gamepad_rumble: (w, self, other, a) => {
      const force = clamp(num(a[0], 0.6), 0, 1);
      w.game.effects.push({ type: 'rumble', strong: force, weak: force * 0.6, ms: Math.round(clamp(num(a[1], 0.2), 0.01, 3) * 1000) });
      return undefined;
    },
    camera_shake: (w, self, other, a) => {
      w.shake = Math.max(w.shake, num(a[0], 0.4));
      w.shakePower = Math.max(1, num(a[1], 2));
      return undefined;
    },
    flash: (w, self, other, a) => {
      w.flash = { color: String(a[0] || '#faf6ef'), time: Math.max(0.02, num(a[1], 0.2)), max: Math.max(0.02, num(a[1], 0.2)) };
      return undefined;
    },
    time_scale: (w, self, other, a) => {
      if (a.length) w.slow = num(a[0], 1) === 1 ? null : { factor: clamp(num(a[0], 1), 0.05, 4), time: a.length > 1 ? Math.max(0.01, num(a[1], 1)) : Infinity };
      return w.slow ? w.slow.factor : 1;
    },
    hitstop: (w, self, other, a) => {
      w.freeze = Math.max(w.freeze, clamp(num(a[0], 0.08), 0, 2));
      return undefined;
    },
    effect: (w, self, other, a) => {
      const x = a.length > 2 ? num(a[1], 0) : self ? self.x + self.w / 2 : 0;
      const y = a.length > 2 ? num(a[2], 0) : self ? self.y + self.h / 2 : 0;
      effect(w, String(a[0] || 'explosion'), x, y, a[3] === undefined ? null : num(a[3], 12), a[4] ? String(a[4]) : null);
      return undefined;
    },
    floating_text: (w, self, other, a) => {
      const x = a.length > 2 ? num(a[0], 0) : self ? self.x + self.w / 2 : 0;
      const y = a.length > 2 ? num(a[1], 0) : self ? self.y : 0;
      floatText(w, x, y, a.length > 2 ? a[2] : a[0], a.length > 2 ? a[3] : a[1]);
      return undefined;
    },
    tween: (w, self, other, a) => {
      const target = isEntity(a[0]) ? a[0] : null;
      const rest = target ? a.slice(1) : a;
      const e = target || self;
      if (!e) throw new Error('tween precisa de um ator');
      addTween(w, e, rest[0], rest[1], rest[2], String(rest[3] || 'out_quad'), { yoyo: Boolean(rest[4]), loop: Boolean(rest[5]) });
      return undefined;
    },
    tween_stop: (w, self, other, a) => {
      const e = entityRef(w, a[0], self);
      w.tweens = w.tweens.filter((t) => t.e !== e);
      return undefined;
    },
    signal_send: (w, self, other, a) => {
      sendSignal(w, a[0]);
      return undefined;
    },
    dialog: (w, self, other, a) => {
      openDialog(w, a[0], a[1], a[2], self);
      return undefined;
    },
    dialog_open: (w) => Boolean(w.dialog),
    light_set: (w, self, other, a) => {
      const e = isEntity(a[0]) ? a[0] : self;
      const rest = isEntity(a[0]) ? a.slice(1) : a;
      if (!e) throw new Error('light_set precisa de um ator');
      const r = num(rest[0], 0);
      e.light = r > 0 ? { radius: r, color: String(rest[1] || e.light?.color || '#ffd98a'), flicker: Boolean(rest[2]) } : null;
      return undefined;
    },
    light_add: (w, self, other, a) => {
      w.lights.push({ x: num(a[0], 0), y: num(a[1], 0), radius: Math.max(1, num(a[2], 32)), color: String(a[3] || '#ffd98a'), life: Math.max(0.02, num(a[4], 0.3)), max: Math.max(0.02, num(a[4], 0.3)) });
      return undefined;
    },
    ambient_set: (w, self, other, a) => {
      w.ambient = clamp(num(a[0], 0), 0, 100) / 100;
      if (a[1]) w.ambientColor = String(a[1]);
      return undefined;
    },
    weather_set: (w, self, other, a) => {
      const kind = String(a[0] ?? '');
      if (kind && !['rain', 'snow', 'leaves', 'embers'].includes(kind)) throw new Error(`clima desconhecido "${kind}" (rain, snow, leaves, embers ou "")`);
      w.weather = kind;
      w.drops = [];
      return undefined;
    },
    raycast: (w, self, other, a) => rayTiles(w, num(a[0], 0), num(a[1], 0), num(a[2], 0), num(a[3], 0)),
    line_of_sight: (w, self, other, a) => {
      const t = isEntity(a[0]) ? a[0] : null;
      return Boolean(self && t && lineOfSight(w, self, t));
    },
    collision_line: (w, self, other, a) => {
      const actor = a[4] !== undefined ? findActor(w.game, a[4]) : null;
      const x1 = num(a[0], 0);
      const y1 = num(a[1], 0);
      const x2 = num(a[2], 0);
      const y2 = num(a[3], 0);
      let best = null;
      let bestT = Infinity;
      for (const o of w.entities) {
        if (o.dead || o === self || o.behavior === 'decor' || (actor && !isA(w, o, actor.id))) continue;
        let t0 = 0;
        let t1 = 1;
        const dx = x2 - x1;
        const dy = y2 - y1;
        let hit = true;
        for (const [p, q] of [[-dx, x1 - o.x], [dx, o.x + o.w - x1], [-dy, y1 - o.y], [dy, o.y + o.h - y1]]) {
          if (p === 0) {
            if (q < 0) hit = false;
          } else {
            const r = q / p;
            if (p < 0) t0 = Math.max(t0, r);
            else t1 = Math.min(t1, r);
          }
          if (t0 > t1) hit = false;
          if (!hit) break;
        }
        if (hit && t0 < bestT) {
          bestT = t0;
          best = o;
        }
      }
      return best;
    },
    path_find: (w, self, other, a) => findPath(w, num(a[0], 0), num(a[1], 0), num(a[2], 0), num(a[3], 0)),
    move_path_towards: (w, self, other, a) => {
      if (!self) throw new Error('move_path_towards precisa de um ator (self)');
      followPath(w, self, num(a[0], 0), num(a[1], 0), num(a[2], 40));
      return undefined;
    },
    instance_list: (w, self, other, a) => {
      const actor = a.length ? findActor(w.game, a[0]) : null;
      return w.entities.filter((x) => !x.dead && (!a.length || (actor && isA(w, x, actor.id))));
    },
    instance_count: (w) => w.entities.filter((x) => !x.dead).length,
    checkpoint_set: (w, self, other, a) => {
      const P = w.player;
      if (!P) return false;
      const x = a.length > 1 ? num(a[0], 0) + P.hx : P.x;
      const y = a.length > 1 ? num(a[1], 0) + P.hy : P.y;
      w.game.checkpoint = { scene: w.scene.id, x, y, uid: 0 };
      return true;
    },
    checkpoint_clear: (w) => {
      w.game.checkpoint = null;
      return undefined;
    },
    game_save: (w, self, other, a) => saveGame(w, a[0]),
    game_load: (w, self, other, a) => loadGame(w, a[0]),
    save_exists: (w, self, other, a) => Boolean(w.game.storage.get(saveKey(w.game, a[0]))),
    save_delete: (w, self, other, a) => {
      w.game.storage.remove?.(saveKey(w.game, a[0]));
      return undefined;
    },
    save_set: (w, self, other, a) => {
      w.game.storage.set(`valor:${String(a[0] ?? '')}`, JSON.stringify(isMap(a[1]) ? { __map: a[1].data } : a[1] ?? null));
      return undefined;
    },
    save_get: (w, self, other, a) => {
      const raw = w.game.storage.get(`valor:${String(a[0] ?? '')}`);
      if (raw === null || raw === undefined) return a.length > 1 ? a[1] : null;
      try {
        const v = JSON.parse(raw);
        if (v && typeof v === 'object' && v.__map) {
          const m = newMap();
          Object.assign(m.data, v.__map);
          return m;
        }
        return v;
      } catch {
        return a.length > 1 ? a[1] : null;
      }
    },
    mouse_check: (w, self, other, a) => Boolean(w.mouse?.[mouseButton(a[0])]),
    mouse_pressed: (w, self, other, a) => Boolean(w.mouse?.[mouseButton(a[0]) + 'Pressed']),
    mouse_over: (w, self, other, a) => {
      const e = entityRef(w, a[0], self);
      const m = w.mouse;
      return Boolean(e && m && m.x >= e.x && m.x < e.x + e.w && m.y >= e.y && m.y < e.y + e.h);
    },
    draw_set_alpha: (w, self, other, a) => {
      w.drawAlpha = clamp(num(a[0], 1), 0, 1);
      return undefined;
    },
    draw_rect: (w, self, other, a) => {
      drawCommand(w, { k: 'rect', x: num(a[0], 0), y: num(a[1], 0), w: num(a[2], 1), h: num(a[3], 1), color: String(a[4] || '#faf6ef'), line: Boolean(a[5]) });
      return undefined;
    },
    draw_circle: (w, self, other, a) => {
      drawCommand(w, { k: 'circle', x: num(a[0], 0), y: num(a[1], 0), r: Math.max(0, num(a[2], 4)), color: String(a[3] || '#faf6ef'), line: Boolean(a[4]) });
      return undefined;
    },
    draw_line: (w, self, other, a) => {
      drawCommand(w, { k: 'line', x: num(a[0], 0), y: num(a[1], 0), x2: num(a[2], 0), y2: num(a[3], 0), color: String(a[4] || '#faf6ef') });
      return undefined;
    },
    draw_text: (w, self, other, a) => {
      drawCommand(w, { k: 'text', x: num(a[0], 0), y: num(a[1], 0), text: format(String(a[2] ?? ''), w.game.vars), color: String(a[3] || '#faf6ef'), size: clamp(Math.round(num(a[4], 1)), 1, 8), center: Boolean(a[5]) });
      return undefined;
    },
    draw_bar: (w, self, other, a) => {
      const max = Math.max(0.0001, num(a[5], 1));
      drawCommand(w, { k: 'bar', x: num(a[0], 0), y: num(a[1], 0), w: num(a[2], 16), h: num(a[3], 2), value: clamp(num(a[4], 0) / max, 0, 1), color: String(a[6] || '#d04a3a'), back: String(a[7] || '#2b1d17') });
      return undefined;
    },
    draw_sprite: (w, self, other, a) => {
      const s = findByName(w.game.data.sprites || [], a[0]) || (findActor(w.game, a[0]) ? w.game.refs.sprites.get(findActor(w.game, a[0]).sprite) : null);
      if (!s) throw new Error(`o sprite "${a[0]}" não existe`);
      drawCommand(w, { k: 'sprite', sprite: s.id, frame: Math.max(0, Math.floor(num(a[1], 0))) % Math.max(1, s.frames.length), x: num(a[2], 0), y: num(a[3], 0), sx: num(a[4], 1), sy: num(a[5], a[4] === undefined ? 1 : num(a[4], 1)), angle: num(a[6], 0) });
      return undefined;
    },
    draw_self: (w, self) => {
      if (!self) throw new Error('draw_self precisa de um ator (self)');
      drawCommand(w, { k: 'self', uid: self.uid });
      return undefined;
    },
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
        ? { room_width: world.width, room_height: world.height, view_width: world.view.width, view_height: world.view.height, tile_width: world.tw, tile_height: world.th, current_time: world.time, game_speed: 60, mouse_x: world.mouse.x, mouse_y: world.mouse.y, mouse_gui_x: world.mouse.gx, mouse_gui_y: world.mouse.gy, delta_time: STEP }
        : { game_speed: 60 },
      get: (e, name) => getProp(world, e, name),
      set: (e, name, v) => setProp(world, e, name, v),
      has: (e, name) => (isMap(e) ? name in e.data : isEntity(e) && name in e.vars),
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
    const m = input.mouse || {};
    out.mouse = { x: num(m.x, -1), y: num(m.y, -1), inside: Boolean(m.inside) };
    for (const b of MOUSE) {
      out.mouse[b] = Boolean(m[b]);
      out.mouse[b + 'Pressed'] = Boolean(m[b + 'Pressed']);
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
      tweens: [],
      waits: [],
      lights: [],
      floats: [],
      draws: [],
      gui: [],
      drawTarget: 'world',
      drawAlpha: 1,
      dialog: null,
      flash: null,
      fade: null,
      freeze: 0,
      slow: null,
      shakePower: 2,
      ambient: clamp(num(scene.ambient, 0), 0, 100) / 100,
      ambientColor: scene.ambientColor || '#0b0812',
      weather: scene.weather || '',
      drops: [],
      mouse: { x: -1, y: -1, gx: -1, gy: -1, inside: false },
      stats: { step: 0, pairs: 0, checks: 0 },
      signals: 0,
    };
    world.camera = { x: 0, y: 0, zoom: clamp(num(scene.zoom, 1), 0.25, 8), zoomTo: clamp(num(scene.zoom, 1), 0.25, 8), zoomSpeed: 0, mode: scene.camera || 'smooth', target: null };
    for (const p of scene.entities || []) {
      const e = spawn(world, p.actor, num(p.x, 0), num(p.y, 0), { dir: p.flip ? -1 : 1, code: p.code || '', lang: p.lang || 'crivo' });
      if (e && p.id) e.place = p.id;
    }
    world.player = world.entities.find((e) => PLAYERS.includes(e.behavior)) || null;
    world.camera.target = world.player;
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
    return behavior === 'platformer' || behavior === 'patrol' || behavior === 'npc';
  }

  function snapshotScene(world) {
    const out = {};
    for (const e of world.entities) {
      if (e.dead || !e.place || e === world.player) continue;
      out[e.place] = { x: e.x, y: e.y, dir: e.dir, health: e.health, active: Boolean(e.active), used: Boolean(e.used), visible: e.visible !== false, alpha: e.alpha ?? 1, vars: JSON.parse(JSON.stringify(e.vars || {})) };
    }
    return out;
  }

  function restoreScene(world, saved) {
    for (const e of world.entities) {
      if (!e.place || e === world.player) continue;
      const s = saved[e.place];
      if (!s) {
        e.dead = true;
        continue;
      }
      Object.assign(e, { x: s.x, y: s.y, dir: s.dir, health: s.health, active: s.active, used: s.used, visible: s.visible, alpha: s.alpha, restored: true });
      e.vars = { ...s.vars };
    }
    world.entities = world.entities.filter((e) => !e.dead);
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
      visible: !(actor.behavior === 'zone' && actor.props?.hidden !== false),
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
      alarms: new Array(ALARMS).fill(-1),
      forced: '',
      outside: false,
      sx: 1,
      sy: 1,
      angle: 0,
      imageSpeed: 1,
      light: actor.light && actor.light.radius > 0 ? { ...actor.light } : null,
      climbing: false,
      inWater: false,
      onIce: false,
      wallSlide: false,
      wallDir: 0,
      wallLock: 0,
      dashTime: 0,
      dashCool: 0,
      dashReady: true,
      floor: 0,
      active: false,
      near: false,
      phase: 0,
      pause: 0,
      path: null,
      pathTime: 0,
      customDraw: false,
    };
    e.customDraw = (world.game.refs.events.get(actor.id) || []).some((ev) => ev.type === 'draw');
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

  function flagsIn(world, x, y, w, h) {
    const c0 = Math.max(0, Math.floor(x / world.tw));
    const c1 = Math.min(world.cols - 1, Math.floor((x + w - 0.001) / world.tw));
    const r0 = Math.max(0, Math.floor(y / world.th));
    const r1 = Math.min(world.rows - 1, Math.floor((y + h - 0.001) / world.th));
    let f = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f |= world.flags[world.tiles[r * world.cols + c]];
    return f;
  }

  function blocks(world, e) {
    const list = world.blocks || world.entities.filter((b) => SOLIDS.includes(b.behavior));
    return list.filter((b) => b !== e && !b.dead);
  }

  const oneWay = (b) => b.behavior === 'mover' && b.actor.props?.oneway !== false;

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
        if (oneWay(b) || !overlap(e, b)) continue;
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
          const above = before <= top + 0.01 && e.drop <= 0;
          const ladderTop = f & LADDER && !e.climbing && !(flagAt(world, c, r - 1) & LADDER);
          if (f & SOLID || (f & PLATFORM && above) || (ladderTop && above)) {
            e.y = top - e.h;
            e.floor = f;
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
        if (oneWay(b) && !(d > 0 && before <= b.y + 0.01 && e.drop <= 0)) continue;
        if (d > 0) {
          e.y = b.y - e.h;
          e.floor = 0;
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
    if (f & (SOLID | PLATFORM | LADDER)) return true;
    return blocks(world, null).some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  function landing(world, e, speed) {
    own(world, e, 'landed');
    if (e === world.player) {
      sound(world, e.actor.sounds?.land);
      fire(world, 'land', { a: e });
    }
    if (speed > num(world.game.data.maxFall, 260) * 0.7) effect(world, 'dust', e.x + e.w / 2, e.y + e.h, 6);
  }

  function physics(world, e, dt) {
    const data = world.game.data;
    let g = num(data.gravity, 480);
    let maxFall = num(data.maxFall, 260);
    const wasWater = e.inWater;
    e.inWater = Boolean(flagsIn(world, e.x, e.y + e.h * 0.4, e.w, e.h * 0.6) & WATER);
    if (e.inWater !== wasWater && e.t > 0.05 && Math.abs(e.vy) > 20) effect(world, 'splash', e.x + e.w / 2, e.y + e.h * 0.6, 8);
    if (e.inWater) {
      g *= 0.3;
      maxFall *= 0.35;
    }
    if (e.gravity && !e.climbing && e.dashTime <= 0) e.vy = Math.min(maxFall, e.vy + g * dt);
    if (e.inWater && e.vy > maxFall) e.vy = maxFall;
    const vxBefore = e.vx;
    e.wall = moveX(world, e, e.vx * dt);
    if (e.wall) {
      e.wallDir = Math.sign(vxBefore) || e.wallDir;
      e.vx = 0;
    } else e.wallDir = 0;
    const wasGround = e.ground;
    const vyBefore = e.vy;
    const { hit, landed } = moveY(world, e, e.vy * dt);
    e.ground = landed;
    if (hit) e.vy = 0;
    if (e.gravity && !e.ground && e.vy === 0 && !e.climbing) {
      const probe = moveY(world, e, 0.01);
      e.ground = probe.landed;
      if (!probe.landed) e.y -= 0.01;
    }
    e.onIce = e.ground && Boolean(e.floor & ICE);
    if (e.ground) e.dashReady = true;
    if (landed && e.floor & BOUNCE && vyBefore > 1) {
      const jump = num(e.actor.props?.jump, 170);
      e.vy = -Math.max(jump * 1.45, vyBefore * 0.85);
      e.ground = false;
      e.jumpsLeft = Math.max(0, num(e.actor.props?.jumps, 1) - 1);
      effect(world, 'dust', e.x + e.w / 2, e.y + e.h, 6);
      return;
    }
    if (!wasGround && e.ground && e.t > 0.05) landing(world, e, vyBefore);
  }

  function sound(world, id) {
    if (!id) return;
    const s = world.game.refs.sounds.get(id);
    if (s) world.game.effects.push({ type: 'sound', sound: s });
  }

  function onLadder(world, e) {
    return Boolean(flagsIn(world, e.x + e.w * 0.3, e.y, Math.max(1, e.w * 0.4), e.h + (e.ground ? 1 : 0)) & LADDER);
  }

  function startDash(world, e, fx, fy, speed) {
    const len = Math.hypot(fx, fy) || 1;
    e.dashTime = 0.15;
    e.dashCool = 0.45;
    e.dashReady = e.behavior === 'topdown';
    e.dashVec = { x: fx / len, y: fy / len, speed: speed * 3 };
    e.vx = e.dashVec.x * e.dashVec.speed;
    e.vy = e.dashVec.y * e.dashVec.speed;
    sound(world, e.actor.sounds?.dash);
    effect(world, 'dust', e.x + e.w / 2, e.y + e.h, 5);
  }

  function followPath(world, e, tx, ty, speed) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    e.pathTime -= STEP;
    if (!e.path || e.pathTime <= 0) {
      e.path = lineOfSight(world, e, { x: tx - 0.5, y: ty - 0.5, w: 1, h: 1 }) ? [[tx, ty]] : findPath(world, cx, cy, tx, ty, 4000);
      e.pathTime = 0.35;
    }
    const reach = Math.max(1.5, Math.min(world.tw, world.th) * 0.3);
    while (e.path.length && Math.hypot(e.path[0][0] - cx, e.path[0][1] - cy) < reach) e.path.shift();
    if (!e.path.length) {
      e.vx *= 0.7;
      if (!e.gravity) e.vy *= 0.7;
      return false;
    }
    const [nx, ny] = e.path[0];
    let dx = nx - cx;
    let dy = ny - cy;
    if (Math.abs(dy) < 1 && !e.gravity) {
      e.y = ny - e.h / 2;
      dy = 0;
    }
    if (Math.abs(dx) < 1) {
      e.x = nx - e.w / 2;
      dx = 0;
    }
    const d = Math.hypot(dx, dy) || 1;
    e.vx = (dx / d) * speed;
    if (!e.gravity) e.vy = (dy / d) * speed;
    if (Math.abs(dx) > 0.5) e.dir = Math.sign(dx);
    return true;
  }

  function fireShot(world, e, actorId, fx, fy) {
    const actor = world.game.refs.actors.get(actorId);
    if (!actor) return null;
    const speed = num(actor.props?.speed, 160);
    const len = Math.hypot(fx, fy) || 1;
    const sprite = world.game.refs.sprites.get(actor.sprite);
    const hb = hitboxOf(actor, sprite);
    const cx = e.x + e.w / 2 + (fx / len) * (e.w / 2 + 2);
    const cy = e.y + e.h / 2 + (fy / len) * (e.h / 2 + 2);
    const shot = spawn(world, actor.id, cx - hb.x - hb.w / 2, cy - hb.y - hb.h / 2, { vx: (fx / len) * speed, vy: (fy / len) * speed, dir: fx < 0 ? -1 : 1, owner: e });
    if (shot && shot.life <= 0) shot.life = 2;
    sound(world, actor.sounds?.spawn || e.actor.sounds?.shoot);
    return shot;
  }

  function behave(world, e, input, dt) {
    const p = e.actor.props || {};
    const speed = num(p.speed, 60);
    if (e.dashCool > 0) e.dashCool -= dt;
    if (e.wallLock > 0) e.wallLock -= dt;
    if (e.dashTime > 0) {
      e.dashTime -= dt;
      e.vx = e.dashVec.x * e.dashVec.speed;
      e.vy = e.dashVec.y * e.dashVec.speed;
      if (Math.floor(e.t * 60) % 3 === 0) world.particles.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, vx: 0, vy: 0, life: 0.18, max: 0.18, color: '#faf6ef', g: 0, drag: 0, size: Math.max(1, Math.round(world.tw / 8)) });
      if (e.dashTime <= 0) {
        e.vx *= 0.35;
        if (e.behavior === 'topdown') e.vy *= 0.35;
        else e.vy = 0;
      }
      physics(world, e, dt);
      if (PLAYERS.includes(e.behavior)) shoot(world, e, input, dt);
      return;
    }
    if (e.behavior === 'platformer') {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const jumps = Math.max(1, num(p.jumps, 1));
      const jumpPower = num(p.jump, 170);
      const ladder = p.climb !== false && onLadder(world, e);
      if (e.climbing && (!ladder || input.jumpPressed)) {
        e.climbing = false;
        if (input.jumpPressed && ladder) {
          e.vy = -jumpPower * 0.8;
          sound(world, e.actor.sounds?.jump);
          fire(world, 'jump', { a: e });
        }
        input = { ...input, jumpPressed: false };
      } else if (!e.climbing && ladder && (input.up || input.down) && !(input.down && input.jumpPressed)) {
        e.climbing = true;
        e.vx = 0;
        e.vy = 0;
        e.drop = 0;
      }
      if (e.climbing) {
        const cs = speed * 0.65;
        e.vy = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * cs;
        e.vx = dir * cs * 0.6;
        if (dir) e.dir = dir;
        e.face = { x: e.dir, y: 0 };
        e.jumpsLeft = jumps;
        e.coyote = 0;
        e.wallSlide = false;
        physics(world, e, dt);
        if (e.ground && input.down && !(flagsIn(world, e.x, e.y, e.w, e.h + 1) & LADDER)) e.climbing = false;
        shoot(world, e, input, dt);
        return;
      }
      const water = e.inWater ? 0.6 : 1;
      const accel = speed * (e.ground ? (e.onIce ? 1.4 : 12) : 7) * water;
      const target = e.hurt > 0.7 || e.wallLock > 0 ? e.vx : dir * speed * water;
      e.vx += clamp(target - e.vx, -accel * dt, accel * dt);
      if (dir && e.wallLock <= 0) e.dir = dir;
      e.face = { x: e.dir, y: 0 };
      if (e.ground) {
        e.coyote = 0.1;
        e.jumpsLeft = jumps;
      } else e.coyote -= dt;
      e.buffer = input.jumpPressed ? 0.12 : e.buffer - dt;
      e.drop -= dt;
      e.wallSlide = Boolean(p.walljump && !e.ground && e.wallDir && dir === e.wallDir && e.vy > 0 && !e.inWater);
      if (e.wallSlide) e.vy = Math.min(e.vy, num(world.game.data.maxFall, 260) * 0.22);
      if (input.down && input.jumpPressed && e.ground) {
        e.drop = 0.25;
        e.buffer = 0;
        e.y += 1;
      } else if (e.inWater && e.buffer > 0) {
        e.vy = -jumpPower * 0.55;
        e.buffer = 0;
        sound(world, e.actor.sounds?.jump);
        fire(world, 'jump', { a: e });
      } else if (p.walljump && e.buffer > 0 && !e.ground && e.coyote <= 0 && e.wallDir) {
        e.vy = -jumpPower;
        e.vx = -e.wallDir * speed * 1.1;
        e.dir = -e.wallDir;
        e.wallLock = 0.16;
        e.buffer = 0;
        e.jumpsLeft = jumps - 1;
        e.wallSlide = false;
        sound(world, e.actor.sounds?.jump);
        effect(world, 'dust', e.wallDir > 0 ? e.x + e.w : e.x, e.y + e.h / 2, 4);
        fire(world, 'jump', { a: e });
      } else if (e.buffer > 0 && (e.coyote > 0 || e.jumpsLeft > 0)) {
        if (e.coyote > 0) e.jumpsLeft = jumps - 1;
        else e.jumpsLeft--;
        e.vy = -jumpPower;
        e.buffer = 0;
        e.coyote = 0;
        e.ground = false;
        sound(world, e.actor.sounds?.jump);
        fire(world, 'jump', { a: e });
      }
      if (!input.jump && e.vy < 0 && !e.inWater) e.vy += num(world.game.data.gravity, 480) * dt;
      if (p.dash && input.dashPressed && e.dashCool <= 0 && e.dashReady) {
        startDash(world, e, e.dir, 0, speed);
        e.wallSlide = false;
      }
    } else if (e.behavior === 'topdown') {
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (dx && dy) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      const water = e.inWater ? 0.55 : 1;
      if (e.hurt <= 0.7) {
        if (e.onIce || flagsIn(world, e.x, e.y, e.w, e.h) & ICE) {
          e.vx += (dx * speed - e.vx) * Math.min(1, dt * 2.5);
          e.vy += (dy * speed - e.vy) * Math.min(1, dt * 2.5);
        } else {
          e.vx = dx * speed * water;
          e.vy = dy * speed * water;
        }
      } else {
        e.vx *= 0.9;
        e.vy *= 0.9;
      }
      if (dx) e.dir = Math.sign(dx);
      if (dx || dy) e.face = { x: Math.sign(dx), y: Math.sign(dy) };
      if (p.dash && input.dashPressed && e.dashCool <= 0) startDash(world, e, e.face.x || (e.face.y ? 0 : e.dir), e.face.y, speed);
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
    } else if (e.behavior === 'pathfinder') {
      const target = world.player && !world.player.dead ? world.player : null;
      if (target && centerDistance(e, target) < num(p.range, 160)) followPath(world, e, target.x + target.w / 2, target.y + target.h / 2, speed);
      else {
        e.vx *= 0.8;
        if (!e.gravity) e.vy *= 0.8;
        e.path = null;
      }
    } else if (e.behavior === 'turret') {
      const P = world.player;
      e.cool -= dt;
      e.vx = 0;
      if (!e.gravity) e.vy = 0;
      if (P && !P.dead) {
        const dx = P.x + P.w / 2 - (e.x + e.w / 2);
        const dy = P.y + P.h / 2 - (e.y + e.h / 2);
        if (Math.abs(dx) > 0.5) e.dir = Math.sign(dx);
        if (Math.hypot(dx, dy) <= num(p.range, 120) && e.cool <= 0 && (!p.sight || lineOfSight(world, e, P))) {
          const shot = fireShot(world, e, p.shoot, p.aim === false ? e.dir : dx, p.aim === false ? 0 : dy);
          e.cool = Math.max(0.1, num(p.cooldown, 1.2));
          if (shot) {
            e.active = true;
            e.activeT = 0.25;
          }
        }
      }
    } else if (e.behavior === 'spawner') {
      e.vx = 0;
      e.vy = 0;
      const every = Math.max(0.1, num(p.every, 3));
      if (e.spawnT === undefined) e.spawnT = every;
      e.spawnT -= dt;
      if (e.spawnT <= 0) {
        e.spawnT = every;
        const P = world.player;
        const range = num(p.range, 0);
        e.children = (e.children || []).filter((c) => !c.dead);
        if (p.spawns && p.spawns !== e.id && e.children.length < Math.max(1, num(p.max, 3)) && (range <= 0 || (P && centerDistance(e, P) <= range))) {
          const c = spawn(world, p.spawns, e.x - e.hx, e.y - e.hy, { dir: e.dir });
          if (c) {
            e.children.push(c);
            e.active = true;
            e.activeT = 0.3;
            sound(world, e.actor.sounds?.spawn);
            effect(world, 'smoke', c.x + c.w / 2, c.y + c.h / 2, 6);
          }
        }
      }
    } else if (e.behavior === 'emitter') {
      e.vx = 0;
      e.vy = 0;
      e.cool -= dt;
      if (e.cool <= 0) {
        e.cool = Math.max(0.02, num(p.every, 0.2));
        const P = world.player;
        const range = num(p.range, 0);
        if (range <= 0 || (P && centerDistance(e, P) <= range)) effect(world, p.effect || 'fire', e.x + e.w / 2, e.y + e.h / 2, Math.max(1, Math.min(40, Math.round(num(p.amount, 3)))));
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
      if (flagsIn(world, e.x, e.y, e.w, e.h) & SOLID) e.wallHit = true;
      if (e.wallHit || e.x < -64 || e.x > world.width + 64 || e.y > world.height + 64 || e.y < -world.height) {
        if (e.wallHit) effect(world, 'dust', e.x + e.w / 2, e.y + e.h / 2, 4);
        destroy(world, e);
      }
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
    if (['platformer', 'topdown', 'patrol', 'chase', 'flyer', 'pathfinder', 'turret', 'npc'].includes(e.behavior)) physics(world, e, dt);
  }

  function shoot(world, e, input, dt) {
    const p = e.actor.props || {};
    e.cool -= dt;
    if (!p.shoot || !input.actionPressed || e.cool > 0) return;
    if (!world.game.refs.actors.get(p.shoot)) return;
    const fx = e.face.x || (e.face.y ? 0 : e.dir);
    const fy = e.face.y || 0;
    fireShot(world, e, p.shoot, fx, fy);
    e.cool = Math.max(0.05, num(p.cooldown, 0.35));
  }

  function stepMovers(world, dt) {
    for (const m of world.entities) {
      if (m.dead || m.behavior !== 'mover') continue;
      const p = m.actor.props || {};
      const range = num(p.range, 48);
      const speed = Math.max(0, num(p.speed, 30));
      const vertical = Boolean(p.vertical);
      if (!m.span) {
        const r = range * (m.dir < 0 ? -1 : 1);
        m.span = [Math.min(0, r), Math.max(0, r)];
        m.dir = r >= 0 ? 1 : -1;
      }
      let dx = 0;
      let dy = 0;
      if (m.pause > 0) m.pause -= dt;
      else if (range > 0 && speed > 0) {
        const pos = vertical ? m.y - m.home.y : m.x - m.home.x;
        let next = pos + m.dir * speed * dt;
        if (next >= m.span[1]) {
          next = m.span[1];
          m.dir = -1;
          m.pause = Math.max(0, num(p.wait, 0.4));
        } else if (next <= m.span[0]) {
          next = m.span[0];
          m.dir = 1;
          m.pause = Math.max(0, num(p.wait, 0.4));
        }
        if (vertical) dy = next - pos;
        else dx = next - pos;
      }
      m.vx = dx / dt;
      m.vy = dy / dt;
      if (!dx && !dy) continue;
      const riders = world.entities.filter((o) => o !== m && !o.dead && !SOLIDS.includes(o.behavior) && o.behavior !== 'decor' && o.behavior !== 'projectile' && Math.abs(o.y + o.h - m.y) <= 1.01 && o.x + o.w > m.x && o.x < m.x + m.w && o.vy >= -0.01);
      m.x += dx;
      m.y += dy;
      for (const o of riders) {
        if (dx) moveX(world, o, dx);
        if (dy) o.y = m.y - o.h;
        o.ground = true;
      }
      if (!oneWay(m)) {
        for (const o of world.entities) {
          if (o === m || o.dead || riders.includes(o) || SOLIDS.includes(o.behavior) || o.behavior === 'decor' || !overlap(o, m)) continue;
          if (dx) o.x = dx > 0 ? m.x + m.w : m.x - o.w;
          else if (dy > 0) o.y = m.y + m.h;
          else o.y = m.y - o.h;
        }
      }
    }
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
    const lost = Math.min(Math.max(0, amount), Math.max(0, e.health));
    e.health -= Math.max(0, amount);
    if (world.game.data.damageNumbers && lost > 0) floatText(world, e.x + e.w / 2, e.y - 2, `-${Math.round(lost * 10) / 10}`, e === world.player ? '#ff8a7a' : '#f6e4a6');
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
    own(world, e, 'hurt', null, from);
    if (e === world.player) {
      world.game.effects.push({ type: 'rumble', strong: e.health <= 0 ? 1 : 0.7, weak: 0.4, ms: e.health <= 0 ? 400 : 180 });
      fire(world, 'hurt', { a: e, b: from });
    }
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

  function candidatePairs(world, live) {
    const n = live.length;
    if (n <= 32) {
      const out = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(i * n + j);
      return out;
    }
    const size = Math.max(32, world.tw * 4, world.th * 4);
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      const e = live[i];
      const c0 = Math.floor(e.x / size);
      const c1 = Math.floor((e.x + e.w) / size);
      const r0 = Math.floor(e.y / size);
      const r1 = Math.floor((e.y + e.h) / size);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = (r + 65536) * 262144 + (c + 65536);
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push(i);
        }
      }
    }
    const seen = new Set();
    for (const list of cells.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) seen.add(list[a] * n + list[b]);
    }
    return [...seen].sort((x, y) => x - y);
  }

  function activateCheckpoint(world, P, o) {
    for (const e of world.entities) if (e.behavior === 'checkpoint' && e !== o) e.active = false;
    o.active = true;
    world.game.checkpoint = { scene: world.scene.id, x: o.x + o.w / 2 - P.w / 2, y: o.y + o.h - P.h, uid: o.uid };
    if (o.actor.props?.heal) P.health = Math.max(P.health, num(P.actor.props?.health, 1));
    sound(world, o.actor.sounds?.activate || o.actor.sounds?.collect);
    effect(world, 'sparkle', o.x + o.w / 2, o.y + o.h / 3, 10);
    fire(world, 'checkpoint', { a: P, b: o });
  }

  function triggerZone(world, P, o) {
    const p = o.actor.props || {};
    if (o.used && p.once !== false) return;
    o.used = true;
    o.active = true;
    if (p.once === false) o.activeT = 0.4;
    sound(world, o.actor.sounds?.activate);
    if (p.signal) sendSignal(world, p.signal);
  }

  function interactions(world) {
    const P = world.player;
    const now = new Set();
    const live = world.entities.filter((e) => !e.dead && e.behavior !== 'decor');
    const watched = world.rules.filter((r) => r.when?.type === 'touch');
    const n = live.length;
    const pairs = candidatePairs(world, live);
    world.stats.pairs = pairs.length;
    for (const pk of pairs) {
      {
        const a = live[Math.floor(pk / n)];
        const b = live[pk % n];
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
          else if (o.behavior === 'checkpoint' && !o.active) activateCheckpoint(world, P, o);
          else if (o.behavior === 'zone' && begin) triggerZone(world, P, o);
          else if (o.behavior === 'spring' && P.vy >= 0 && P.y + P.h - o.y <= Math.max(4, o.h * 0.7)) {
            P.vy = -num(o.actor.props?.power, 300);
            P.ground = false;
            P.climbing = false;
            P.jumpsLeft = Math.max(0, num(P.actor.props?.jumps, 1) - 1);
            P.dashReady = true;
            o.active = true;
            o.activeT = 0.3;
            sound(world, o.actor.sounds?.activate);
            effect(world, 'dust', o.x + o.w / 2, o.y, 6);
          }
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
      if (flagsIn(world, P.x, P.y, P.w, P.h) & HAZARD) damage(world, P, 1, null);
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
    const list = actions || [];
    for (let k = 0; k < list.length; k++) {
      const act = list[k];
      if (world !== g.world && act.type !== 'sound') return;
      const t = act.type;
      if (t === 'wait') {
        const rest = list.slice(k + 1);
        if (rest.length) world.waits.push({ time: Math.max(0, Math.min(600, num(act.seconds, 1))), actions: rest, ctx: { ...ctx } });
        return;
      }
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
      } else if (t === 'tween') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) addTween(world, e, act.prop || 'y', num(act.value, 0), Math.max(0.01, num(act.seconds, 0.5)), act.ease || 'out_quad');
      } else if (t === 'signal') sendSignal(world, act.signal);
      else if (t === 'dialog') openDialog(world, act.text, act.speaker, act.signal, ctx.self || ctx.a || null);
      else if (t === 'float') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) floatText(world, e.x + e.w / 2, e.y, format(act.text, g.vars), act.color);
      } else if (t === 'effect') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) effect(world, act.preset, e.x + e.w / 2, e.y + e.h / 2, act.count ? num(act.count, 12) : null);
      } else if (t === 'flash') {
        const d = Math.max(0.02, num(act.seconds, 0.2));
        world.flash = { color: act.color || '#faf6ef', time: d, max: d };
      } else if (t === 'cameraZoom') {
        world.camera.zoomTo = clamp(num(act.zoom, 1), 0.25, 8);
        world.camera.zoomSpeed = Math.max(0, num(act.seconds, 0));
        if (!world.camera.zoomSpeed) world.camera.zoom = world.camera.zoomTo;
      } else if (t === 'cameraFollow') {
        world.camera.target = targetOf(world, act.target || 'self', ctx);
        if (world.camera.mode === 'fixed') world.camera.mode = 'smooth';
      } else if (t === 'slowmo') world.slow = { factor: clamp(num(act.factor, 0.5), 0.05, 4), time: Math.max(0.05, num(act.seconds, 1)) };
      else if (t === 'hitstop') world.freeze = Math.max(world.freeze, clamp(num(act.seconds, 0.08), 0, 2));
      else if (t === 'light') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) e.light = num(act.radius, 0) > 0 ? { radius: num(act.radius, 0), color: act.color || '#ffd98a', flicker: Boolean(e.light?.flicker) } : null;
      } else if (t === 'ambient') world.ambient = clamp(num(act.value, 0), 0, 100) / 100;
      else if (t === 'scale') {
        const e = targetOf(world, act.target || 'self', ctx);
        if (e) {
          e.sx = num(act.value, 1);
          e.sy = num(act.value, 1);
        }
      } else if (t === 'checkpoint') {
        const e = targetOf(world, act.target || 'self', ctx);
        const P = world.player;
        if (e && P) g.checkpoint = { scene: world.scene.id, x: e === P ? P.x : e.x + e.w / 2 - P.w / 2, y: e === P ? P.y : e.y + e.h - P.h, uid: e.behavior === 'checkpoint' ? e.uid : 0 };
      } else if (t === 'save') saveGame(world, act.slot);
      else if (t === 'load') loadGame(world, act.slot);
    }
  }

  function stepWaits(world, dt) {
    if (!world.waits.length) return;
    const due = [];
    world.waits = world.waits.filter((w) => {
      w.time -= dt;
      if (w.time > 0) return true;
      due.push(w);
      return false;
    });
    for (const w of due) {
      if (w.ctx.a && w.ctx.a.dead && w.ctx.a !== world.player) continue;
      run(world, w.actions, w.ctx);
      if (world !== world.game.world) return;
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

  const FALLBACK = { fall: ['jump'], hurt: ['idle'], climb: ['run'], wall: ['fall', 'jump'], dash: ['run'], swim: ['run', 'jump'], active: [] };

  function animationState(e) {
    if (e.dead) return 'idle';
    if (e.hurt > 0.6 && PLAYERS.includes(e.behavior)) return 'hurt';
    if (e.dashTime > 0) return 'dash';
    if (e.climbing) return 'climb';
    if (e.wallSlide) return 'wall';
    if (e.inWater && e.behavior === 'platformer' && !e.ground) return 'swim';
    if (e.active && ['checkpoint', 'spring', 'turret'].includes(e.behavior)) return 'active';
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
    let name = e.forced && sprite.anims?.[e.forced] ? e.forced : '';
    if (!name) name = map[e.state] || (FALLBACK[e.state] || []).map((k) => map[k]).find(Boolean) || map.idle || '';
    const seq = (name && sprite.anims?.[name]) || sprite.all || { frames: sprite.frames.map((_, i) => i), loop: true };
    if (e.anim !== name || e.seq !== seq) {
      e.anim = name;
      e.seq = seq;
      e.animPos = 0;
      e.animTime = 0;
    }
    if (!seq.frames.length) return;
    e.animTime += dt * (e.climbing && !e.vx && !e.vy ? 0 : e.imageSpeed ?? 1);
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
    const cam = world.camera;
    if (cam.zoom !== cam.zoomTo) {
      if (cam.zoomSpeed > 0 && !snap) {
        cam.zoom += (cam.zoomTo - cam.zoom) * Math.min(1, (dt * 4) / cam.zoomSpeed);
        if (Math.abs(cam.zoom - cam.zoomTo) < 0.002) cam.zoom = cam.zoomTo;
      } else cam.zoom = cam.zoomTo;
    }
    const z = cam.zoom || 1;
    const W = world.view.width / z;
    const H = world.view.height / z;
    const T = cam.target || null;
    let tx = cam.x;
    let ty = cam.y;
    if (T && cam.mode !== 'fixed') {
      if (cam.mode === 'deadzone' && !snap) {
        const sx = T.x + T.w / 2 - (cam.x + W / 2);
        const sy = T.y + T.h / 2 - (cam.y + H / 2);
        const dzw = W * 0.16;
        const dzh = H * 0.2;
        tx = cam.x + (Math.abs(sx) > dzw ? sx - Math.sign(sx) * dzw : 0);
        ty = cam.y + (Math.abs(sy) > dzh ? sy - Math.sign(sy) * dzh : 0);
      } else {
        tx = T.x + T.w / 2 - W / 2 + (T === world.player ? T.dir * 12 * Math.max(1, world.tw / 8) : 0);
        ty = T.y + T.h / 2 - H / 2;
      }
    }
    tx = world.width <= W ? (world.width - W) / 2 : clamp(tx, 0, world.width - W);
    ty = world.height <= H ? (world.height - H) / 2 : clamp(ty, 0, world.height - H);
    if (snap || cam.mode === 'snap' || cam.mode === 'deadzone' || cam.mode === 'fixed') {
      cam.x = tx;
      cam.y = ty;
    } else {
      const k = Math.min(1, dt * 7);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
    }
  }

  function tickEffects(world, dt) {
    if (world.message) {
      world.message.time -= dt;
      if (world.message.time <= 0) world.message = null;
    }
    if (world.shake > 0) world.shake = Math.max(0, world.shake - dt);
    else world.shakePower = 2;
    if (world.flash) {
      world.flash.time -= dt;
      if (world.flash.time <= 0) world.flash = null;
    }
    if (world.fade) {
      world.fade.time -= dt;
      if (world.fade.time <= 0) world.fade = null;
    }
    const k = Math.max(1, world.tw / 8);
    for (const f of world.floats) {
      f.y -= 14 * k * dt;
      f.life -= dt;
    }
    if (world.floats.length) world.floats = world.floats.filter((f) => f.life > 0);
    for (const l of world.lights) l.life -= dt;
    if (world.lights.length) world.lights = world.lights.filter((l) => l.life > 0);
    stepWeather(world, dt);
  }

  function stepWeather(world, dt) {
    const kind = world.weather;
    if (!kind) {
      if (world.drops.length) world.drops = [];
      return;
    }
    const z = world.camera.zoom || 1;
    const W = world.view.width / z;
    const H = world.view.height / z;
    const k = Math.max(1, world.tw / 8);
    const area = (W * H) / (160 * 120);
    const want = Math.min(600, Math.round({ rain: 110, snow: 70, leaves: 14, embers: 34 }[kind] * area));
    const rnd = world.game.random;
    while (world.drops.length < want) world.drops.push({ x: world.camera.x + rnd() * W, y: world.camera.y + rnd() * H, p: rnd() * Math.PI * 2, s: 0.6 + rnd() * 0.8 });
    if (world.drops.length > want) world.drops.length = want;
    for (const d of world.drops) {
      if (kind === 'rain') {
        d.x -= 40 * k * d.s * dt;
        d.y += 230 * k * d.s * dt;
      } else if (kind === 'snow') {
        d.x += Math.sin(world.time * 1.3 + d.p) * 10 * k * dt;
        d.y += 20 * k * d.s * dt;
      } else if (kind === 'leaves') {
        d.x += (16 + Math.sin(world.time * 2 + d.p) * 22) * k * dt;
        d.y += 16 * k * d.s * dt;
      } else {
        d.x += Math.sin(world.time * 2.2 + d.p) * 8 * k * dt;
        d.y -= 22 * k * d.s * dt;
      }
      const rx = d.x - world.camera.x;
      const ry = d.y - world.camera.y;
      if (rx < -8) d.x += W + 16;
      else if (rx > W + 8) d.x -= W + 16;
      if (ry < -8) d.y += H + 16;
      else if (ry > H + 8) d.y -= H + 16;
    }
  }

  function updateMouse(world, input) {
    const m = input.mouse;
    const z = world.camera.zoom || 1;
    const prev = world.mouse;
    world.mouse = { gx: m.x, gy: m.y, x: m.x < 0 ? prev.x : world.camera.x + m.x / z, y: m.y < 0 ? prev.y : world.camera.y + m.y / z, inside: m.inside };
    for (const b of MOUSE) {
      world.mouse[b] = m[b];
      world.mouse[b + 'Pressed'] = m[b + 'Pressed'];
    }
    if (m.leftPressed && m.x >= 0) {
      const { x, y } = world.mouse;
      for (const e of [...world.entities]) {
        if (e.dead || e.visible === false) continue;
        const sw = e.sprite ? e.sprite.w : e.w;
        const sh = e.sprite ? e.sprite.h : e.h;
        const left = e.x - e.hx;
        const top = e.y - e.hy;
        if (x >= left && x < left + sw && y >= top && y < top + sh) own(world, e, 'mousePress');
      }
    }
  }

  function buildDraws(world) {
    for (const e of world.entities) {
      if (e.dead) continue;
      const list = world.game.refs.events.get(e.id);
      if (!list || !list.some((ev) => ev.type === 'draw' || ev.type === 'drawGui')) continue;
      world.drawAlpha = 1;
      world.drawTarget = 'world';
      own(world, e, 'draw');
      world.drawAlpha = 1;
      world.drawTarget = 'gui';
      own(world, e, 'drawGui');
    }
    world.drawTarget = 'world';
    world.drawAlpha = 1;
  }

  function talkers(world, input) {
    const P = world.player;
    if (!P || P.dead) return input;
    const k = Math.max(1, world.tw / 8);
    const zone = { x: P.x - 4 * k, y: P.y - 2 * k, w: P.w + 8 * k, h: P.h + 4 * k };
    let out = input;
    for (const e of world.entities) {
      if (e.dead || e.behavior !== 'npc') continue;
      e.near = overlap(zone, e);
      if (!e.near) continue;
      if (P.x + P.w / 2 < e.x + e.w / 2 === e.dir > 0) e.dir = -e.dir;
      const p = e.actor.props || {};
      if (world.dialog) continue;
      if ((p.auto && !e.talked) || out.actionPressed) {
        e.talked = true;
        openDialog(world, p.say, p.speaker || e.actor.name, '', e);
        out = { ...out, actionPressed: false, jumpPressed: false };
      }
    }
    return out;
  }

  function stepWorld(game, world, input, dt, realDt = dt) {
    world.time += dt;
    tickEffects(world, realDt);
    if (game.status !== 'playing') {
      game.ended.time -= realDt;
      if (game.ended.time <= 0) world.pending = { type: 'title' };
      return;
    }
    if (world.dying > 0) {
      world.dying -= realDt;
      if (world.dying <= 0) world.pending = { type: 'died' };
      for (const e of world.entities) if (!e.dead) updateAnimation(e, dt, world);
      return;
    }
    updateMouse(world, input);
    world.draws = [];
    world.gui = [];
    world.input = input;
    if (world.dialog) {
      stepDialog(world, input, realDt);
      world.prevInput = input;
      for (const e of world.entities) if (!e.dead && e.behavior === 'npc') updateAnimation(e, realDt, world);
      buildDraws(world);
      return;
    }
    for (const pt of world.particles) {
      if (pt.drag) {
        const k = Math.max(0, 1 - pt.drag * dt);
        pt.vx *= k;
        pt.vy *= k;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += (pt.g ?? 140) * dt;
      pt.life -= dt;
    }
    if (world.particles.length) world.particles = world.particles.filter((pt) => pt.life > 0);
    const P = world.player;
    if (P && P.behavior === 'platformer' && !P.dead && !(P.actor.props?.climb !== false && onLadder(world, P))) {
      input = { ...input, jump: input.jump || input.up, jumpPressed: input.jumpPressed || input.upPressed };
      world.input = input;
    }
    input = talkers(world, input);
    world.input = input;
    if (world.dialog) {
      world.prevInput = input;
      buildDraws(world);
      return;
    }
    rulesPerStep(world, input, dt);
    world.blocks = world.entities.filter((b) => !b.dead && SOLIDS.includes(b.behavior));
    stepMovers(world, dt);
    stepTweens(world, dt);
    stepWaits(world, dt);
    if (world !== world.game.world) return;
    const none = normalizeInput({});
    const prev = world.prevInput || none;
    for (const e of [...world.entities]) {
      if (e.dead) continue;
      e.t += dt;
      if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
      if (e.activeT > 0) {
        e.activeT -= dt;
        if (e.activeT <= 0 && e.behavior !== 'checkpoint') e.active = false;
      }
      for (let n = 0; n < ALARMS; n++) {
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
      if (e.dead || e.behavior === 'mover') continue;
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
    if (world.camera.target && world.camera.target.dead && world.camera.target !== world.player) world.camera.target = world.player;
    centerCamera(world, false, dt);
    buildDraws(world);
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
      game.load(world.scene.id, { respawn: true });
    } else if (p.type === 'loadSave') {
      const save = p.save;
      game.vars = { ...initialVars(game.data), ...(save.vars || {}) };
      game.status = 'playing';
      game.ended = null;
      game.checkpoint = save.checkpoint && save.checkpoint.scene === save.scene ? save.checkpoint : null;
      const w = game.load(save.scene, { respawn: Boolean(game.checkpoint) });
      if (w && w.player && save.player && !game.checkpoint) {
        w.player.x = num(save.player.x, w.player.x);
        w.player.y = num(save.player.y, w.player.y);
        centerCamera(w, true);
      }
      if (w && w.player && save.player) w.player.health = Math.max(1, num(save.player.health, w.player.health));
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
    LADDER,
    WATER,
    ICE,
    BOUNCE,
    STEP,
    KEYS,
    MOUSE,
    ALARMS,
    ENEMIES,
    EASES: Object.keys(EASE),
    EASE,
    PRESETS: Object.keys(PRESETS),
    findPath,
    rayTiles,
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
