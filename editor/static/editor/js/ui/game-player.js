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
      if (s) tilesets.set(t.id, { ...t, sheet: s.canvases[0], anim: new Map((t.anims || []).map((a) => [a.tile, a])) });
    }
    return { sprites, tilesets };
  }

  function drawTile(ctx, ts, k, dx, dy, t = 0) {
    const a = ts?.anim?.get(k);
    if (a) k = a.frames[Math.floor(t * a.fps) % a.frames.length];
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

  function drawEntity(ctx, s, e, cx, cy) {
    const flip = e.dir < 0;
    const ox = flip ? s.w - e.hx - e.w : e.hx;
    let dy = Math.round(e.y - e.hy) - cy;
    if (e.behavior === 'item') dy += Math.round(Math.sin(e.t * 4) * 1.2);
    const dx = Math.round(e.x - ox) - cx;
    const sx = e.sx ?? 1;
    const sy = e.sy ?? 1;
    const angle = e.angle || 0;
    if (sx === 1 && sy === 1 && !angle) {
      drawSprite(ctx, s, e.frame, dx, dy, flip);
      return;
    }
    const c = s.canvases[e.frame] || s.canvases[0];
    if (!c) return;
    ctx.save();
    ctx.translate(dx + s.w / 2, dy + s.h / 2);
    if (angle) ctx.rotate((-angle * Math.PI) / 180);
    ctx.scale((flip ? -1 : 1) * sx, sy);
    ctx.drawImage(c, -s.w / 2, -s.h / 2);
    ctx.restore();
  }

  function runDraws(ctx, list, gfx, world, cx, cy, t) {
    for (const d of list) {
      ctx.globalAlpha = d.alpha ?? 1;
      if (d.k === 'rect') {
        ctx.fillStyle = d.color;
        ctx.strokeStyle = d.color;
        if (d.line) ctx.strokeRect(Math.round(d.x - cx) + 0.5, Math.round(d.y - cy) + 0.5, Math.max(0, Math.round(d.w) - 1), Math.max(0, Math.round(d.h) - 1));
        else ctx.fillRect(Math.round(d.x - cx), Math.round(d.y - cy), Math.round(d.w), Math.round(d.h));
      } else if (d.k === 'circle') {
        ctx.fillStyle = d.color;
        const r = Math.round(d.r);
        const x0 = Math.round(d.x - cx);
        const y0 = Math.round(d.y - cy);
        for (let y = -r; y <= r; y++) {
          const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)) + 0.35);
          if (d.line) {
            const inner = Math.floor(Math.sqrt(Math.max(0, (r - 1) * (r - 1) - y * y)) + 0.35);
            if (Math.abs(y) >= r - 0.5) ctx.fillRect(x0 - span, y0 + y, span * 2 + 1, 1);
            else {
              ctx.fillRect(x0 - span, y0 + y, Math.max(1, span - inner), 1);
              ctx.fillRect(x0 + inner + 1, y0 + y, Math.max(1, span - inner), 1);
            }
          } else ctx.fillRect(x0 - span, y0 + y, span * 2 + 1, 1);
        }
      } else if (d.k === 'line') {
        ctx.fillStyle = d.color;
        let x0 = Math.round(d.x - cx);
        let y0 = Math.round(d.y - cy);
        const x1 = Math.round(d.x2 - cx);
        const y1 = Math.round(d.y2 - cy);
        const ddx = Math.abs(x1 - x0);
        const ddy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = ddx + ddy;
        for (let guard = 0; guard < 4096; guard++) {
          ctx.fillRect(x0, y0, 1, 1);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= ddy) {
            err += ddy;
            x0 += sx;
          }
          if (e2 <= ddx) {
            err += ddx;
            y0 += sy;
          }
        }
      } else if (d.k === 'text') {
        const x = d.center ? Math.round(d.x - cx - textWidth(d.text, d.size) / 2) : Math.round(d.x - cx);
        drawText(ctx, d.text, x, Math.round(d.y - cy), d.color, d.size);
      } else if (d.k === 'bar') {
        ctx.fillStyle = d.back;
        ctx.fillRect(Math.round(d.x - cx), Math.round(d.y - cy), Math.round(d.w), Math.round(d.h));
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x - cx), Math.round(d.y - cy), Math.round(d.w * d.value), Math.round(d.h));
      } else if (d.k === 'sprite') {
        const s = gfx.sprites.get(d.sprite);
        const c = s?.canvases[d.frame] || s?.canvases[0];
        if (!c) continue;
        if (d.sx === 1 && d.sy === 1 && !d.angle) ctx.drawImage(c, Math.round(d.x - cx), Math.round(d.y - cy));
        else {
          ctx.save();
          ctx.translate(Math.round(d.x - cx) + (s.w * Math.abs(d.sx)) / 2, Math.round(d.y - cy) + (s.h * Math.abs(d.sy)) / 2);
          if (d.angle) ctx.rotate((-d.angle * Math.PI) / 180);
          ctx.scale(d.sx, d.sy);
          ctx.drawImage(c, -s.w / 2, -s.h / 2);
          ctx.restore();
        }
      } else if (d.k === 'self') {
        const e = world.entities.find((x) => x.uid === d.uid);
        const s = e && gfx.sprites.get(e.sprite?.id);
        if (s && !(e.hurt > 0 && Math.floor(t * 18) % 2 === 0)) drawEntity(ctx, s, e, cx, cy);
      }
    }
    ctx.globalAlpha = 1;
  }

  function lightLayer(gfx, W, H) {
    if (!gfx.light || gfx.light.width !== W || gfx.light.height !== H) {
      gfx.light = document.createElement('canvas');
      gfx.light.width = W;
      gfx.light.height = H;
    }
    return gfx.light;
  }

  function lights(ctx, world, gfx, cx, cy, z, W, H, t) {
    const list = [];
    for (const e of world.entities) {
      if (e.dead || !e.light || e.visible === false || (e.behavior === 'checkpoint' && !e.active)) continue;
      let r = e.light.radius;
      if (e.light.flicker) r *= 1 + Math.sin(t * 13 + e.uid * 1.7) * 0.05 + Math.sin(t * 29 + e.uid) * 0.03;
      list.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, r, color: e.light.color, a: e.alpha ?? 1 });
    }
    for (const l of world.lights) list.push({ x: l.x, y: l.y, r: l.radius * (0.5 + 0.5 * (l.life / l.max)), color: l.color, a: l.life / l.max });
    for (const p of world.particles) if (p.twinkle || p.g < 0) list.push({ x: p.x, y: p.y, r: 3 * Math.max(1, world.tw / 8), color: p.color, a: (p.life / p.max) * 0.6 });
    if (world.ambient > 0.001) {
      const layer = lightLayer(gfx, W, H);
      const lc = layer.getContext('2d');
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, W, H);
      lc.globalAlpha = Math.min(1, world.ambient);
      lc.fillStyle = world.ambientColor || '#0b0812';
      lc.fillRect(0, 0, W, H);
      lc.globalAlpha = 1;
      lc.globalCompositeOperation = 'destination-out';
      for (const l of list) {
        const x = (l.x - cx) * z;
        const y = (l.y - cy) * z;
        const r = l.r * z;
        if (x < -r || y < -r || x > W + r || y > H + r) continue;
        for (const [k, a] of [[1, 0.28], [0.78, 0.32], [0.55, 0.4]]) {
          lc.globalAlpha = a * l.a;
          lc.beginPath();
          lc.arc(Math.round(x), Math.round(y), Math.max(1, Math.round(r * k)), 0, Math.PI * 2);
          lc.fill();
        }
      }
      lc.globalAlpha = 1;
      lc.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer, 0, 0);
    }
    if (!list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of list) {
      const x = (l.x - cx) * z;
      const y = (l.y - cy) * z;
      const r = l.r * z;
      if (l.r < 16 * Math.max(1, world.tw / 8) || x < -r || y < -r || x > W + r || y > H + r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, l.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (world.ambient > 0.001 ? 0.22 : 0.08) * l.a;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function weather(ctx, world, cx, cy, t, glowing) {
    const kind = world.weather;
    if (!kind || (kind === 'embers') !== glowing) return;
    const k = Math.max(1, Math.round(world.tw / 8));
    for (const d of world.drops) {
      const x = Math.round(d.x - cx);
      const y = Math.round(d.y - cy);
      if (kind === 'rain') {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#a9c6d8';
        ctx.fillRect(x, y, k, 3 * k);
      } else if (kind === 'snow') {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#faf6ef';
        ctx.fillRect(x, y, d.s > 1 ? 2 * k : k, d.s > 1 ? 2 * k : k);
      } else if (kind === 'leaves') {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = d.s > 1 ? '#c98a3a' : '#8a9a4a';
        const flat = Math.sin(t * 3 + d.p) > 0;
        ctx.fillRect(x, y, flat ? 2 * k : k, flat ? k : 2 * k);
      } else {
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 5 + d.p));
        ctx.fillStyle = d.s > 1 ? '#ffd27a' : '#e8743c';
        ctx.fillRect(x, y, k, k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function dialogBox(ctx, world, W, H, t, cy = 0, z = 1) {
    const d = world.dialog;
    if (!d) return;
    const page = d.pages[d.page] || '';
    const visible = page.slice(0, Math.floor(d.shown));
    const cols = Math.max(8, Math.floor((W - 16) / 4));
    const lines = wrap(visible, cols);
    const total = Math.min(5, Math.max(2, wrap(page, cols).length));
    const bh = total * 7 + 10;
    const P = world.player;
    const low = P && (P.y + P.h / 2 - cy) * z > H * 0.55;
    const by = low ? 12 : H - bh - 4;
    ctx.fillStyle = 'rgba(29,22,19,0.92)';
    ctx.fillRect(4, by, W - 8, bh);
    ctx.fillStyle = '#f6e4a6';
    ctx.fillRect(4, by, W - 8, 1);
    ctx.fillRect(4, by + bh - 1, W - 8, 1);
    ctx.fillRect(4, by, 1, bh);
    ctx.fillRect(W - 5, by, 1, bh);
    if (d.speaker) {
      const tw = textWidth(d.speaker) + 6;
      ctx.fillStyle = '#5d1c16';
      ctx.fillRect(8, by - 7, tw, 8);
      drawText(ctx, d.speaker, 11, by - 6, '#f6e4a6', 1, null);
    }
    lines.slice(0, 5).forEach((l, i) => drawText(ctx, l, 9, by + 5 + i * 7, '#faf6ef'));
    if (d.shown >= page.length && Math.floor(t * 3) % 2 === 0) {
      ctx.fillStyle = '#f6e4a6';
      ctx.fillRect(W - 12, by + bh - 6, 3, 1);
      ctx.fillRect(W - 11, by + bh - 5, 1, 1);
    }
  }

  function transition(ctx, world, W, H, cx, cy, z) {
    const f = world.fade;
    if (!f) return;
    const k = Math.max(0, Math.min(1, f.time / f.max));
    if (f.kind === 'iris') {
      const P = world.player;
      const px = P ? (P.x + P.w / 2 - cx) * z : W / 2;
      const py = P ? (P.y + P.h / 2 - cy) * z : H / 2;
      const R = Math.hypot(W, H) * (1 - k);
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(px, py, Math.max(0, R), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    } else {
      ctx.globalAlpha = k;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
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
    const z = world.camera.zoom || 1;
    const VW = W / z;
    const VH = H / z;
    let cx = Math.round(world.camera.x);
    let cy = Math.round(world.camera.y);
    if (world.shake > 0) {
      const power = world.shakePower || 2;
      cx += Math.round((game.random() - 0.5) * power * 2);
      cy += Math.round((game.random() - 0.5) * power * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = world.scene.background || game.data.background || '#a3b4be';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(z, 0, 0, z, 0, 0);
    const back = gfx.sprites.get(world.scene.backdrop);
    if (back) {
      const factor = (world.scene.parallax ?? 50) / 100;
      const bw = back.w;
      const off = -Math.round(cx * factor) % bw;
      const by = Math.round(VH - back.h - Math.min(0, cy) * factor);
      for (let x = off - (off > 0 ? bw : 0); x < VW; x += bw) drawSprite(ctx, back, 0, x, Math.min(by, VH - back.h), false);
    }
    const ts = gfx.tilesets.get(world.scene.tileset);
    if (ts) {
      const c0 = Math.max(0, Math.floor(cx / ts.tw));
      const r0 = Math.max(0, Math.floor(cy / ts.th));
      const c1 = Math.min(world.cols - 1, Math.floor((cx + VW) / ts.tw));
      const r1 = Math.min(world.rows - 1, Math.floor((cy + VH) / ts.th));
      if (world.back) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) drawTile(ctx, ts, world.back[r * world.cols + c], c * ts.tw - cx, r * ts.th - cy, t);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) drawTile(ctx, ts, world.tiles[r * world.cols + c], c * ts.tw - cx, r * ts.th - cy, t);
    }
    const list = world.entities.filter((e) => !e.dead && e.visible !== false && !e.customDraw).sort((a, b) => b.depth - a.depth || a.layer - b.layer);
    for (const e of list) {
      const s = gfx.sprites.get(e.sprite?.id);
      if (!s) continue;
      if (e.hurt > 0 && Math.floor(t * 18) % 2 === 0) continue;
      ctx.globalAlpha = e.alpha ?? 1;
      drawEntity(ctx, s, e, cx, cy);
    }
    ctx.globalAlpha = 1;
    if (game.data.hpBars) {
      for (const e of list) {
        if (!(engine.ENEMIES || []).includes(e.behavior) && e.behavior !== 'block' && e.behavior !== 'custom') continue;
        const max = Number(e.actor.props?.health) || 1;
        if (max <= 1 || e.health >= max || e.health <= 0) continue;
        const w = Math.max(6, Math.round(e.w));
        const bx = Math.round(e.x + e.w / 2 - w / 2) - cx;
        const by = Math.round(e.y - e.hy) - cy - 3;
        ctx.fillStyle = '#2b1d17';
        ctx.fillRect(bx - 1, by - 1, w + 2, 3);
        ctx.fillStyle = '#5d1c16';
        ctx.fillRect(bx, by, w, 1);
        ctx.fillStyle = e.health / max > 0.5 ? '#7bd88f' : e.health / max > 0.25 ? '#f6e4a6' : '#d04a3a';
        ctx.fillRect(bx, by, Math.max(1, Math.round((w * e.health) / max)), 1);
      }
    }
    runDraws(ctx, world.draws || [], gfx, world, cx, cy, t);
    for (const p of world.particles || []) {
      if (p.twinkle && Math.floor(t * 20 + p.x) % 3 === 0) continue;
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const size = p.size ? Math.max(1, Math.round(p.shrink ? p.size * (0.4 + 0.6 * a) : p.size)) : Math.max(1, Math.round(world.tw / 8));
      ctx.fillRect(Math.round(p.x - size / 2) - cx, Math.round(p.y - size / 2) - cy, size, size);
    }
    ctx.globalAlpha = 1;
    weather(ctx, world, cx, cy, t, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lights(ctx, world, gfx, cx, cy, z, W, H, t);
    ctx.setTransform(z, 0, 0, z, 0, 0);
    weather(ctx, world, cx, cy, t, true);
    for (const e of world.entities) {
      if (e.dead || e.behavior !== 'npc' || !e.near || world.dialog) continue;
      const bx = Math.round(e.x + e.w / 2) - cx - 2;
      const by = Math.round(e.y - e.hy) - cy - 9 + (Math.floor(t * 3) % 2);
      ctx.fillStyle = '#2b1d17';
      ctx.fillRect(bx - 1, by - 1, 6, 9);
      ctx.fillStyle = '#faf6ef';
      ctx.fillRect(bx, by, 4, 7);
      drawText(ctx, '!', bx, by + 1, '#5d1c16', 1, null);
    }
    for (const f of world.floats || []) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 2));
      drawText(ctx, f.text, Math.round(f.x - cx - textWidth(f.text) / 2), Math.round(f.y - cy), f.color);
    }
    ctx.globalAlpha = 1;
    if (debug) {
      ctx.lineWidth = 1;
      for (const e of world.entities) {
        if (e.dead) continue;
        ctx.strokeStyle = e === world.player ? '#f6e4a6' : e.behavior === 'zone' ? '#7bd88f' : e.behavior === 'decor' ? 'rgba(163,180,190,0.7)' : '#d04a3a';
        ctx.strokeRect(Math.round(e.x) - cx + 0.5, Math.round(e.y) - cy + 0.5, Math.max(1, Math.round(e.w) - 1), Math.max(1, Math.round(e.h) - 1));
        if (Math.abs(e.vx) > 1 || Math.abs(e.vy) > 1) {
          ctx.strokeStyle = '#6bd6ff';
          ctx.beginPath();
          ctx.moveTo(Math.round(e.x + e.w / 2) - cx + 0.5, Math.round(e.y + e.h / 2) - cy + 0.5);
          ctx.lineTo(Math.round(e.x + e.w / 2 + e.vx * 0.1) - cx + 0.5, Math.round(e.y + e.h / 2 + e.vy * 0.1) - cy + 0.5);
          ctx.stroke();
        }
        if (e.path?.length) {
          ctx.fillStyle = '#c9a4ff';
          for (const [px, py] of e.path) ctx.fillRect(Math.round(px) - cx - 1, Math.round(py) - cy - 1, 2, 2);
        }
      }
      if (world.camera.mode === 'deadzone') {
        ctx.strokeStyle = 'rgba(246,228,166,0.5)';
        ctx.strokeRect(Math.round(VW / 2 - VW * 0.16) + 0.5, Math.round(VH / 2 - VH * 0.2) + 0.5, Math.round(VW * 0.32), Math.round(VH * 0.4));
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (debug) {
      const info = [`FPS ${Math.round(debug.fps)}`, `PASSO ${(world.stats?.step || 0).toFixed(2)} MS`, `${world.entities.filter((e) => !e.dead).length} ATORES ${world.stats?.pairs || 0} PARES`, `${(world.particles || []).length} PARTICULAS`, `CAM ${cx},${cy} ZOOM ${Math.round(z * 100)}%`];
      if (world.player) info.push(`JOGADOR ${Math.round(world.player.x - world.player.hx)},${Math.round(world.player.y - world.player.hy)} ${String(world.player.state || '').toUpperCase()}`);
      const vars = Object.entries(game.vars).slice(0, 6).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 100) / 100 : String(v && v.describe ? v.describe() : v).slice(0, 24)}`);
      const room = Math.max(6, Math.floor(W / 2 / 4) - 1);
      vars.slice(0, Math.max(2, Math.floor(H / 40))).forEach((line, i) => {
        const text = line.length > room ? line.slice(0, room - 1) + '-' : line;
        drawText(ctx, text, W - textWidth(text) - 3, 3 + i * 8, '#c9e4ff');
      });
      info.forEach((line, i) => drawText(ctx, line, W - textWidth(line) - 3, H - 8 * (info.length - i) - 2, '#f6e4a6'));
    }
    let x = 3;
    const P = world.player;
    const hudOn = !world.dialog;
    if (hudOn && P && P.actor.props?.health > 1) {
      const max = Math.min(10, P.actor.props.health);
      for (let i = 0; i < max; i++) drawHeart(ctx, 3 + i * 7, 3, i < Math.max(0, P.health));
      x = 3;
    }
    const items = engine.hud(game);
    let y = P && P.actor.props?.health > 1 ? 11 : 3;
    let line = '';
    for (const h of items) line += (line ? '  ' : '') + `${h.label} ${h.value}`;
    if (line && hudOn) drawText(ctx, line, x, y);
    y += 8;
    runDraws(ctx, world.gui || [], gfx, world, 0, 0, t);
    if (world.message) {
      const lines = wrap(engine.format(world.message.text, game.vars), Math.floor((W - 16) / 4));
      const bh = lines.length * 8 + 6;
      const by = Math.round(H / 2 - bh / 2);
      ctx.fillStyle = 'rgba(43,29,23,0.78)';
      ctx.fillRect(4, by, W - 8, bh);
      lines.forEach((l, i) => drawText(ctx, l, Math.round((W - textWidth(l)) / 2), by + 4 + i * 8, '#f6e4a6'));
    }
    dialogBox(ctx, world, W, H, t, cy, z);
    if (world.flash) {
      ctx.globalAlpha = Math.max(0, Math.min(1, world.flash.time / world.flash.max)) * 0.85;
      ctx.fillStyle = world.flash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    transition(ctx, world, W, H, cx, cy, z);
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
    const help = W >= 200 ? 'Setas: andar  Z: pular  X: acao  Shift: investida' : 'Setas  Z: pular  X: acao';
    drawText(ctx, help, Math.round((W - textWidth(help)) / 2), H - 10, '#faf6ef');
  }

  const KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    z: 'jump', ' ': 'jump', k: 'jump', x: 'action', j: 'action', c: 'action', shift: 'dash', l: 'dash',
  };

  function localStore(name) {
    const prefix = `crivo-jogo:${String(name || 'jogo').slice(0, 60)}:`;
    const memory = new Map();
    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    };
    return {
      get: (k) => safe(() => localStorage.getItem(prefix + k), memory.get(k) ?? null) ?? memory.get(k) ?? null,
      set: (k, v) => {
        memory.set(k, v);
        safe(() => localStorage.setItem(prefix + k, v));
      },
      remove: (k) => {
        memory.delete(k);
        safe(() => localStorage.removeItem(prefix + k));
      },
    };
  }

  const FILTERS = {
    scanlines: (k) => ({ backgroundImage: `linear-gradient(rgba(0,0,0,0.28) 0 ${Math.max(1, Math.round(k / 3))}px, transparent 0)`, backgroundSize: `100% ${k}px` }),
    lcd: (k) => ({ backgroundImage: `linear-gradient(rgba(20,30,10,0.16) 0 1px, transparent 0), linear-gradient(90deg, rgba(20,30,10,0.16) 0 1px, transparent 0)`, backgroundSize: `${k}px ${k}px`, mixBlendMode: 'multiply' }),
    vignette: () => ({ backgroundImage: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)' }),
    crt: (k) => ({ backgroundImage: `radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.6) 100%), linear-gradient(rgba(0,0,0,0.3) 0 ${Math.max(1, Math.round(k / 3))}px, transparent 0)`, backgroundSize: `100% 100%, 100% ${k}px`, borderRadius: `${Math.max(4, k * 3)}px` }),
  };

  function play({ engine, audio, script = null, onLog = null, data, canvas, scene = null, onExit = null, host = null, touch = false, skipTitle = false, storage = null }) {
    const gfx = art(data, engine);
    const ctx = canvas.getContext('2d');
    canvas.width = data.width;
    canvas.height = data.height;
    ctx.imageSmoothingEnabled = false;
    const mix = audio.mixer();
    const game = engine.createGame(data, { seed: (Date.now() >>> 0) || 7, script, onLog, storage: storage || localStore(data.name) });
    const mouse = { x: -1, y: -1, inside: false, left: false, right: false, middle: false, pressed: new Set() };
    const BUTTONS = ['left', 'middle', 'right'];
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = r.width ? Math.floor(((e.clientX - r.left) * data.width) / r.width) : -1;
      mouse.y = r.height ? Math.floor(((e.clientY - r.top) * data.height) / r.height) : -1;
      mouse.inside = mouse.x >= 0 && mouse.y >= 0 && mouse.x < data.width && mouse.y < data.height;
    };
    const onPointer = (e) => {
      point(e);
      const name = BUTTONS[e.button];
      if (e.type === 'pointerdown' && name) {
        mix.resume();
        if (!mouse[name]) mouse.pressed.add(name);
        mouse[name] = true;
      } else if (e.type === 'pointerup' && name) mouse[name] = false;
    };
    const onMenu = (e) => e.preventDefault();
    canvas.addEventListener('pointerdown', onPointer);
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('contextmenu', onMenu);
    window.addEventListener('pointerup', onPointer);
    const filter = data.filter && FILTERS[data.filter] ? document.createElement('div') : null;
    if (filter) {
      filter.setAttribute('aria-hidden', 'true');
      Object.assign(filter.style, { gridArea: '1 / 1', pointerEvents: 'none', alignSelf: 'center', justifySelf: 'center', zIndex: '1' });
      canvas.style.gridArea = '1 / 1';
      canvas.insertAdjacentElement('afterend', filter);
    }
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
    let stepOnce = 0;
    let stepped = false;
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
      if (filter) Object.assign(filter.style, { width: `${data.width * k}px`, height: `${data.height * k}px` }, FILTERS[data.filter](k));
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
      if (k === '.' && down && mode === 'paused') {
        e.preventDefault();
        stepOnce++;
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
    const rumble = (fx) => {
      const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of list || []) {
        const act = gp?.vibrationActuator;
        if (!act?.playEffect) continue;
        try {
          Promise.resolve(act.playEffect('dual-rumble', { startDelay: 0, duration: fx.ms, strongMagnitude: fx.strong, weakMagnitude: fx.weak })).catch(() => {});
        } catch {
          continue;
        }
      }
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
        if (b(3) || b(5) || b(7)) now.add('dash');
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
        if (mouse.pressed.has('left')) begin();
        pressed.clear();
        mouse.pressed.clear();
        return;
      }
      if (mode !== 'paused') stepped = false;
      if (mode === 'paused' && stepOnce > 0) {
        stepOnce = 0;
        stepped = true;
        const input = {};
        for (const k of engine.KEYS) {
          input[k] = held.has(k) || padHeld.has(k);
          input[k + 'Pressed'] = pressed.has(k);
        }
        input.mouse = { x: mouse.inside ? mouse.x : -1, y: mouse.inside ? mouse.y : -1, inside: mouse.inside };
        pressed.clear();
        mouse.pressed.clear();
        game.step(input, engine.STEP);
        game.effects.length = 0;
      }
      if (mode === 'playing') {
        acc += dt;
        while (acc >= engine.STEP) {
          acc -= engine.STEP;
          const input = {};
          for (const k of engine.KEYS) {
            input[k] = held.has(k) || padHeld.has(k);
            input[k + 'Pressed'] = pressed.has(k);
          }
          input.mouse = { x: mouse.inside ? mouse.x : -1, y: mouse.inside ? mouse.y : -1, inside: mouse.inside };
          for (const b of BUTTONS) {
            input.mouse[b] = mouse[b];
            input.mouse[b + 'Pressed'] = mouse.pressed.has(b);
          }
          mouse.pressed.clear();
          pressed.clear();
          game.step(input, engine.STEP);
          for (const fx of game.effects.splice(0)) {
            if (fx.type === 'sound') mix.play(fx.sound);
            else if (fx.type === 'music') mix.music(fx.music);
            else if (fx.type === 'title') mode = 'title';
            else if (fx.type === 'rumble') rumble(fx);
          }
          if (mode !== 'playing') break;
        }
      } else {
        pressed.clear();
        mouse.pressed.clear();
      }
      fpsTime += dt;
      fpsCount++;
      if (fpsTime >= 0.5 && debug) {
        debug.fps = fpsCount / fpsTime;
        fpsTime = 0;
        fpsCount = 0;
      }
      render(ctx, game, gfx, engine, clock, debug);
      if (mode === 'paused' && stepped) {
        const tag = 'Quadro a quadro  .: proximo  Enter: voltar';
        ctx.fillStyle = 'rgba(43,29,23,0.75)';
        ctx.fillRect(0, data.height - 11, data.width, 11);
        drawText(ctx, tag, Math.round((data.width - textWidth(tag)) / 2), data.height - 9);
      } else if (mode === 'paused') {
        ctx.fillStyle = 'rgba(43,29,23,0.55)';
        ctx.fillRect(0, 0, data.width, data.height);
        drawText(ctx, 'Pausa', Math.round((data.width - textWidth('Pausa', 2)) / 2), Math.round(data.height / 2 - 12), '#f6e4a6', 2);
        const hint = 'Enter: voltar  R: recomecar';
        drawText(ctx, hint, Math.round((data.width - textWidth(hint)) / 2), Math.round(data.height / 2 + 6));
        const hint2 = '.: avancar um quadro';
        drawText(ctx, hint2, Math.round((data.width - textWidth(hint2)) / 2), Math.round(data.height / 2 + 16));
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
      make('C', 'dash', 'toque-c');
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
        window.removeEventListener('pointerup', onPointer);
        canvas.removeEventListener('pointerdown', onPointer);
        canvas.removeEventListener('pointermove', onPointer);
        canvas.removeEventListener('contextmenu', onMenu);
        filter?.remove();
        for (const p of pads) p.remove();
        mix.close();
      },
    };
  }

  return { art, play, render, title, drawText, textWidth, drawTile, drawSprite, GLYPHS };
}
