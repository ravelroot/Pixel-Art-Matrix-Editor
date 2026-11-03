import { el } from './util.js';

export const SCRIPT_HELP = [
  ['Linguagens', 'Crivo Script, C++ e Lua rodam no mesmo motor e chamam as mesmas funções; uma função escrita numa linguagem pode ser chamada pelas outras. Troque a linguagem no seletor do terminal ou do editor'],
  ['C++', 'int, float, double, bool, auto, std::string e std::vector<T> (com push_back, size, at), funções com tipo, ->, global::pontos, std::cout << ... << std::endl, printf, (int) e static_cast, switch, do ... while, for (auto v : lista); #include e using namespace são ignorados'],
  ['Lua', 'local, if ... then ... elseif ... else ... end, while ... do ... end, for i = 1, 10 do ... end, for i, v in ipairs(t) do ... end, repeat ... until, function ... end, tabelas {1, 2, 3} a partir do índice 1, #t, .., ~=, nil, s:upper()'],
  ['Crivo Script', 'var nome = 1; if (a > b) { } else { }; while, for (var i = 0; i < 10; i++), repeat 5 { }, do { } until (x), break, continue'],
  ['Funções', 'function dobro(n) { return n * 2 } — escreva na aba Código e chame em qualquer evento'],
  ['Variáveis', 'x, y, hspeed, vspeed, speed, direction, health, facing, on_ground, gravity, animation, visible, alpha, depth; qualquer outro nome vira variável do ator; global.pontos é do jogo'],
  ['Atores', 'self, other, player(), noone, instance_create(ator, x, y), instance_destroy([inst]), instance_exists(ator), instance_number(ator), instance_find(ator, n), instance_nearest(ator), instance_place(x, y, ator), place_meeting(x, y, ator), place_free(x, y), collision_point(x, y, ator), distance_to(inst), direction_to(inst)'],
  ['Movimento', 'motion_set(direção, velocidade), motion_add(direção, velocidade), move_towards_point(x, y, velocidade), lengthdir_x(dist, dir), lengthdir_y(dist, dir), point_distance, point_direction, approach(v, alvo, passo)'],
  ['Tempo e teclas', 'alarm_set(n, segundos), alarm_get(n), key_down("left"), key_pressed("jump"), key_released("action"), current_time'],
  ['Tiles', 'tile_get(coluna, linha), tile_set(coluna, linha, tile), tile_at(x, y), tile_solid(x, y), room_width, room_height, tile_width, tile_height'],
  ['Jogo', 'sound_play("Pulo"), music_play("140: C5 E5 G5"), music_stop(), message(texto, segundos), shake(segundos), particles(x, y, quantidade, cor, velocidade, vida), damage(inst, n), heal(inst, n), animation_set(tag), scene_goto(cena), scene_next(), scene_previous(), scene_restart(), game_win(texto), game_lose(texto)'],
  ['Matemática', 'abs, sign, floor, ceil, round, sqrt, power, min, max, clamp, lerp, sin, cos, dsin, dcos, random(n), irandom(n), random_range(a, b), irandom_range(a, b), choose(...), wrap, angle_difference, pi'],
  ['Texto e listas', 'string(v), real(t), string_length, string_upper, string_lower, string_copy, string_pos, string_replace_all, [1, 2, 3], lista[0], array_length, array_push, array_pop, array_insert, array_delete, array_contains, array_create'],
  ['Terminal', 'print(...) mostra aqui; step(n) avança n quadros; reset() recomeça; pause() e resume() no teste; debug() mostra as caixas de colisão; ajuda e limpar'],
];

export class Terminal {
  constructor({ title = 'Terminal', placeholder = 'Digite código e aperte Enter', onCommand, lang = 'crivo' }) {
    this.onCommand = onCommand;
    this.lang = lang;
    const langSelect = el(
      'select',
      { class: 'terminal-lingua', 'aria-label': 'Linguagem do terminal' },
      [
        ['crivo', 'Crivo Script'],
        ['cpp', 'C++'],
        ['lua', 'Lua'],
      ].map(([k, t]) => el('option', { value: k, selected: k === lang }, t)),
    );
    langSelect.addEventListener('change', () => {
      this.lang = langSelect.value;
      this.print(`Linguagem: ${langSelect.selectedOptions[0].textContent}`, 'info');
      this.input.focus();
    });
    this.history = [];
    this.position = 0;
    this.output = el('div', { class: 'terminal-saida', role: 'log', 'aria-live': 'polite' });
    this.input = el('input', { type: 'text', class: 'terminal-entrada mono', spellcheck: 'false', autocomplete: 'off', placeholder, 'aria-label': title });
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.root = el(
      'section',
      { class: 'terminal', 'aria-label': title },
      el('header', { class: 'terminal-topo' }, el('strong', {}, title), el('span', { class: 'terminal-espaco' }), langSelect, el('button', { type: 'button', class: 'terminal-limpar', onclick: () => this.clear() }, 'Limpar')),
      this.output,
      el('label', { class: 'terminal-linha' }, el('span', { class: 'terminal-prompt mono', 'aria-hidden': 'true' }, '>'), this.input),
    );
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.output || this.output.contains(e.target)) setTimeout(() => this.input.focus(), 0);
    });
  }

  key(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = this.input.value;
      if (!line.trim()) return;
      this.history.push(line);
      if (this.history.length > 100) this.history.shift();
      this.position = this.history.length;
      this.input.value = '';
      this.print(line, 'cmd');
      const word = line.trim().toLowerCase();
      if (word === 'limpar' || word === 'clear' || word === 'cls' || word === 'clear()') this.clear();
      else if (word === 'ajuda' || word === 'help' || word === 'help()' || word === 'ajuda()') this.help();
      else this.onCommand?.(line, this.lang);
    } else if (e.key === 'ArrowUp' && this.history.length) {
      e.preventDefault();
      this.position = Math.max(0, this.position - 1);
      this.input.value = this.history[this.position] ?? '';
    } else if (e.key === 'ArrowDown' && this.history.length) {
      e.preventDefault();
      this.position = Math.min(this.history.length, this.position + 1);
      this.input.value = this.history[this.position] ?? '';
    } else if (e.key === 'Escape') {
      this.input.blur();
    }
  }

  help() {
    for (const [title, text] of SCRIPT_HELP) this.print(`${title}: ${text}`, 'info');
  }

  print(text, kind = 'out') {
    const line = el('div', { class: `terminal-item terminal-${kind}` }, kind === 'cmd' ? `> ${text}` : String(text));
    this.output.append(line);
    while (this.output.children.length > 400) this.output.firstElementChild.remove();
    this.output.scrollTop = this.output.scrollHeight;
  }

  clear() {
    this.output.replaceChildren();
  }

  focus() {
    this.input.focus();
  }
}
