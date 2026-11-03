export function gamePlayer() {
  const GLYPHS = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
    9: '111101111001110', '.': '000000000000010', ',': '000000000010100', '!': '010010010000010', '?': '110001010000010',
    ':': '000010000010000', '-': '000000111000000', '+': '000010111010000', '/': '001001010100100', '(': '001010010010001',
    ')': '100010010010100', '%': '101001010100101', "'": '010010000000000', '=': '000111000111000', '<': '001010100010001',
    '>': '100010001010100', '*': '000101010101000', '#': '101111101111101',
  };
  const HEART = ['01010', '11111', '11111', '01110', '00100'];

  function clean(text) {
    return String(text ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function textWidth(text, size = 1) {
    return Math.max(0, clean(text).length * 4 - 1) * size;
  }

  function drawText(ctx, text, x, y, colorValue = '#faf6ef', size = 1, shadow = '#2b1d17') {
    const value = clean(text);
    const paint = (ox, oy, fill) => {
      ctx.fillStyle = fill;
      let cx = x + ox;
      for (const ch of value) {
        const g = GLYPHS[ch];
        if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) * size, y + oy + Math.floor(i / 3) * size, size, size);
        cx += 4 * size;
      }
    };
    if (shadow) paint(0, size, shadow);
    paint(0, 0, colorValue);
  }

  function drawHeart(ctx, x, y, full) {
    ctx.fillStyle = '#2b1d17';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (HEART[r][c] === '1') ctx.fillRect(x + c + 1, y + r + 1, 1, 1);
    ctx.fillStyle = full ? '#d04a3a' : '#5c4034';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (HEART[r][c] === '1') ctx.fillRect(x + c, y + r, 1, 1);
  }

  function wrap(text, max) {
    const words = clean(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (next.length > max && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function canvasOf(pixels, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const bytes = new Uint8ClampedArray(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength));
    ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
    return c;
  }

  function art(data, engine) {
    const sprites = new Map();
    for (const s of data.sprites || []) sprites.set(s.id, { ...s, canvases: s.frames.map((f) => canvasOf(engine.unpack(f.px, s.w * s.h), s.w, s.h)) });
    const tilesets = new Map();
    for (const t of data.tilesets || []) {
      const s = sprites.get(t.sprite);
      if (s) tilesets.set(t.id, { ...t, sheet: s.canvases[0] });
    }
    return { sprites, tilesets };
  }

  function drawTile(ctx, ts, k, dx, dy) {
    if (!ts || k <= 0 || k > ts.count) return;
    const i = k - 1;
    ctx.drawImage(ts.sheet, (i % ts.columns) * ts.tw, Math.floor(i / ts.columns) * ts.th, ts.tw, ts.th, dx, dy, ts.tw, ts.th);
  }

  function drawSprite(ctx, sprite, frame, x, y, flip) {
    const c = sprite?.canvases[frame] || sprite?.canvases[0];
    if (!c) return;
    if (flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(c, -x - c.width, y);
      ctx.restore();
    } else ctx.drawImage(c, x, y);
  }

  function render(ctx, game, gfx, engine, t, debug = null) {
    const world = game.world;
    const W = game.data.width;
    const H = game.data.height;
    if (!world) {
      ctx.fillStyle = game.data.background || '#a3b4be';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    let cx = Math.round(world.camera.x);
    let cy = Math.round(world.camera.y);
    if (world.shake > 0) {
      cx += Math.round((game.random() - 0.5) * 4);
      cy += Math.round((game.random() - 0.5) * 4);
    }
    ctx.fillStyle = world.scene.background || game.data.background || '#a3b4be';
    ctx.fillRect(0, 0, W, H);
    const back = gfx.sprites.get(world.scene.backdrop);
    if (back) {
      const bw = back.w;
      const off = -Math.round(cx * 0.5) % bw;
      const by = Math.round(H - back.h - Math.min(0, cy) * 0.5);
      for (let x = off - (off > 0 ? bw : 0); x < W; x += bw) drawSprite(ctx, back, 0, x, Math.min(by, H - back.h), false);
    }
    const ts = gfx.tilesets.get(world.scene.tileset);
    if (ts) {
      const c0 = Math.max(0, Math.floor(cx / ts.tw));
      const r0 = Math.max(0, Math.floor(cy / ts.th));
      const c1 = Math.min(world.cols - 1, Math.floor((cx + W) / ts.tw));
      const r1 = Math.min(world.rows - 1, Math.floor((cy + H) / ts.th));
      if (world.back) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) drawTile(ctx, ts, world.back[r * world.cols + c], c * ts.tw - cx, r * ts.th - cy);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) drawTile(ctx, ts, world.tiles[r * world.cols + c], c * ts.tw - cx, r * ts.th - cy);
    }
    const list = world.entities.filter((e) => !e.dead && e.visible !== false).sort((a, b) => b.depth - a.depth || a.layer - b.layer);
    for (const e of list) {
      const s = gfx.sprites.get(e.sprite?.id);
      if (!s) continue;
      if (e.hurt > 0 && Math.floor(t * 18) % 2 === 0) continue;
      ctx.globalAlpha = e.alpha ?? 1;
      const flip = e.dir < 0;
      const ox = flip ? s.w - e.hx - e.w : e.hx;
      let dy = Math.round(e.y - e.hy) - cy;
      if (e.behavior === 'item') dy += Math.round(Math.sin(e.t * 4) * 1.2);
      drawSprite(ctx, s, e.frame, Math.round(e.x - ox) - cx, dy, flip);
    }
    ctx.globalAlpha = 1;
    for (const p of world.particles || []) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x) - cx, Math.round(p.y) - cy, Math.max(1, Math.round(world.tw / 8)), Math.max(1, Math.round(world.th / 8)));
    }
    ctx.globalAlpha = 1;
    if (debug) {
      ctx.lineWidth = 1;
      for (const e of world.entities) {
        if (e.dead) continue;
        ctx.strokeStyle = e === world.player ? '#f6e4a6' : e.behavior === 'decor' ? 'rgba(163,180,190,0.7)' : '#d04a3a';
        ctx.strokeRect(Math.round(e.x) - cx + 0.5, Math.round(e.y) - cy + 0.5, Math.max(1, Math.round(e.w) - 1), Math.max(1, Math.round(e.h) - 1));
      }
      const info = [`FPS ${Math.round(debug.fps)}`, `${world.entities.filter((e) => !e.dead).length} ATORES`, `CAM ${cx},${cy}`];
      if (world.player) info.push(`JOGADOR ${Math.round(world.player.x - world.player.hx)},${Math.round(world.player.y - world.player.hy)}`);
      info.forEach((line, i) => drawText(ctx, line, W - textWidth(line) - 3, H - 8 * (info.length - i) - 2, '#f6e4a6'));
    }
    let x = 3;
    const P = world.player;
    if (P && P.actor.props?.health > 1) {
      const max = Math.min(10, P.actor.props.health);
      for (let i = 0; i < max; i++) drawHeart(ctx, 3 + i * 7, 3, i < Math.max(0, P.health));
      x = 3;
    }
    const items = engine.hud(game);
    let y = P && P.actor.props?.health > 1 ? 11 : 3;
    let line = '';
    for (const h of items) line += (line ? '  ' : '') + `${h.label} ${h.value}`;
    if (line) drawText(ctx, line, x, y);
    y += 8;
    if (world.message) {
      const lines = wrap(engine.format(world.message.text, game.vars), Math.floor((W - 16) / 4));
      const bh = lines.length * 8 + 6;
      const by = Math.round(H / 2 - bh / 2);
      ctx.fillStyle = 'rgba(43,29,23,0.78)';
      ctx.fillRect(4, by, W - 8, bh);
      lines.forEach((l, i) => drawText(ctx, l, Math.round((W - textWidth(l)) / 2), by + 4 + i * 8, '#f6e4a6'));
    }
  }

  function title(ctx, data, t, gfx) {
    const W = data.width;
    const H = data.height;
    ctx.fillStyle = data.background || '#a3b4be';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(43,29,23,0.18)';
    for (let y = 0; y < H; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < W; x += 4) ctx.fillRect(x, y, 1, 1);
    const size = textWidth(data.name, 2) <= W - 8 ? 2 : 1;
    const lines = wrap(data.name, Math.floor((W - 8) / (4 * size)));
    let y = Math.round(H * 0.28);
    for (const l of lines) {
      drawText(ctx, l, Math.round((W - textWidth(l, size)) / 2), y, '#faf6ef', size, '#5d1c16');
      y += 6 * size + 2;
    }
    const hero = [...gfx.sprites.values()][0];
    const player = (data.actors || []).find((a) => a.behavior === 'platformer' || a.behavior === 'topdown');
    const ps = player && gfx.sprites.get(player.sprite);
    const s = ps || hero;
    if (s) {
      const f = Math.floor(t * 6) % s.canvases.length;
      ctx.drawImage(s.canvases[f], Math.round((W - s.w) / 2), y + 2);
      y += s.h + 6;
    }
    if (Math.floor(t * 2) % 2 === 0) {
      const msg = 'Aperte Enter';
      drawText(ctx, msg, Math.round((W - textWidth(msg)) / 2), Math.min(H - 22, y + 4), '#f6e4a6');
    }
    const help = 'Setas: andar  Z: pular  X: acao';
    drawText(ctx, help, Math.round((W - textWidth(help)) / 2), H - 10, '#faf6ef');
  }

  const KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    z: 'jump', ' ': 'jump', k: 'jump', x: 'action', j: 'action', c: 'action',
  };

  function play({ engine, audio, script = null, onLog = null, data, canvas, scene = null, onExit = null, host = null, touch = false, skipTitle = false }) {
    const gfx = art(data, engine);
    const ctx = canvas.getContext('2d');
    canvas.width = data.width;
    canvas.height = data.height;
    ctx.imageSmoothingEnabled = false;
    const mix = audio.mixer();
    const game = engine.createGame(data, { seed: (Date.now() >>> 0) || 7, script, onLog });
    let debug = null;
    let fpsTime = 0;
    let fpsCount = 0;
    const held = new Set();
    const pressed = new Set();
    let mode = 'title';
    let raf = 0;
    let last = 0;
    let acc = 0;
    let clock = 0;
    let stopped = false;
    const begin = () => {
      mix.resume();
      if (scene) {
        game.reset();
        game.load(scene);
      } else game.restart();
      mode = 'playing';
    };
    if (skipTitle) begin();
    const fit = () => {
      const box = host || canvas.parentElement;
      const w = box ? box.clientWidth : innerWidth;
      const h = box ? box.clientHeight : innerHeight;
      const k = Math.max(1, Math.floor(Math.min(w / data.width, h / data.height)));
      canvas.style.width = `${data.width * k}px`;
      canvas.style.height = `${data.height * k}px`;
    };
    const onKey = (e) => {
      const down = e.type === 'keydown';
      const k = e.key.toLowerCase();
      const field = e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable]');
      if (field) {
        if (!down) held.clear();
        return;
      }
      if (k === 'f3' && down) {
        e.preventDefault();
        debug = debug ? null : { fps: 60 };
        return;
      }
      if (down) mix.resume();
      if (k === 'escape' && down && onExit) {
        e.preventDefault();
        e.stopPropagation();
        onExit();
        return;
      }
      if (k === 'enter' && down && !e.repeat) {
        e.preventDefault();
        if (mode === 'title') begin();
        else if (game.status !== 'playing') return;
        else mode = mode === 'paused' ? 'playing' : 'paused';
        return;
      }
      if (k === 'm' && down && !e.repeat) {
        mix.toggleMute();
        return;
      }
      if (k === 'r' && down && mode === 'paused') {
        begin();
        return;
      }
      const name = KEYMAP[k];
      if (!name) return;
      e.preventDefault();
      if (down) {
        if (!held.has(name)) pressed.add(name);
        held.add(name);
      } else held.delete(name);
    };
    const pad = { prev: new Set() };
    const readPad = () => {
      const now = new Set();
      const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of list || []) {
        if (!gp) continue;
        const ax = gp.axes[0] || 0;
        const ay = gp.axes[1] || 0;
        const b = (i) => gp.buttons[i]?.pressed;
        if (ax < -0.4 || b(14)) now.add('left');
        if (ax > 0.4 || b(15)) now.add('right');
        if (ay < -0.4 || b(12)) now.add('up');
        if (ay > 0.4 || b(13)) now.add('down');
        if (b(0)) now.add('jump');
        if (b(1) || b(2)) now.add('action');
        if (b(9)) now.add('start');
      }
      for (const k of now) if (!pad.prev.has(k)) {
        if (k === 'start') {
          if (mode === 'title') begin();
          else if (game.status === 'playing') mode = mode === 'paused' ? 'playing' : 'paused';
        } else pressed.add(k);
      }
      pad.prev = now;
      return now;
    };
    const frame = (time) => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
      last = time;
      clock += dt;
      const padHeld = readPad();
      if (mode === 'title') {
        title(ctx, data, clock, gfx);
        pressed.clear();
        return;
      }
      if (mode === 'playing') {
        acc += dt;
        while (acc >= engine.STEP) {
          acc -= engine.STEP;
          const input = {};
          const platformer = game.world?.player?.behavior === 'platformer';
          for (const k of engine.KEYS) {
            input[k] = held.has(k) || padHeld.has(k);
            input[k + 'Pressed'] = pressed.has(k);
          }
          if (platformer) {
            input.jump = input.jump || input.up;
            input.jumpPressed = input.jumpPressed || input.upPressed;
          }
          pressed.clear();
          game.step(input, engine.STEP);
          for (const fx of game.effects.splice(0)) {
            if (fx.type === 'sound') mix.play(fx.sound);
            else if (fx.type === 'music') mix.music(fx.music);
            else if (fx.type === 'title') mode = 'title';
          }
          if (mode !== 'playing') break;
        }
      } else pressed.clear();
      fpsTime += dt;
      fpsCount++;
      if (fpsTime >= 0.5 && debug) {
        debug.fps = fpsCount / fpsTime;
        fpsTime = 0;
        fpsCount = 0;
      }
      render(ctx, game, gfx, engine, clock, debug);
      if (mode === 'paused') {
        ctx.fillStyle = 'rgba(43,29,23,0.55)';
        ctx.fillRect(0, 0, data.width, data.height);
        drawText(ctx, 'Pausa', Math.round((data.width - textWidth('Pausa', 2)) / 2), Math.round(data.height / 2 - 12), '#f6e4a6', 2);
        const hint = 'Enter: voltar  R: recomecar';
        drawText(ctx, hint, Math.round((data.width - textWidth(hint)) / 2), Math.round(data.height / 2 + 6));
      }
    };
    const pads = [];
    if (touch) {
      const layer = document.createElement('div');
      layer.className = 'toque';
      const make = (label, key, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = cls;
        const on = (e) => {
          e.preventDefault();
          mix.resume();
          if (key === 'start') {
            if (mode === 'title') begin();
            else if (game.status === 'playing') mode = mode === 'paused' ? 'playing' : 'paused';
            return;
          }
          if (!held.has(key)) pressed.add(key);
          held.add(key);
        };
        const off = (e) => {
          e.preventDefault();
          held.delete(key);
        };
        b.addEventListener('pointerdown', on);
        b.addEventListener('pointerup', off);
        b.addEventListener('pointercancel', off);
        b.addEventListener('pointerleave', off);
        layer.append(b);
      };
      make('◀', 'left', 'toque-esq');
      make('▶', 'right', 'toque-dir');
      make('▲', 'up', 'toque-cima');
      make('▼', 'down', 'toque-baixo');
      make('A', 'jump', 'toque-a');
      make('B', 'action', 'toque-b');
      make('≡', 'start', 'toque-start');
      (host || document.body).append(layer);
      pads.push(layer);
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('resize', fit);
    fit();
    raf = requestAnimationFrame(frame);
    return {
      game,
      fit,
      start: begin,
      get paused() {
        return mode === 'paused';
      },
      pause(on = true) {
        if (mode !== 'title') mode = on ? 'paused' : 'playing';
      },
      toggleDebug() {
        debug = debug ? null : { fps: 60 };
        return Boolean(debug);
      },
      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('resize', fit);
        for (const p of pads) p.remove();
        mix.close();
      },
    };
  }

  return { art, play, render, title, drawText, textWidth, drawTile, drawSprite, GLYPHS };
}
