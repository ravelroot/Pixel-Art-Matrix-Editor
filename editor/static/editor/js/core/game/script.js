export function gameScript() {
  const KEYWORDS = new Set(['var', 'if', 'else', 'while', 'for', 'repeat', 'do', 'until', 'break', 'continue', 'return', 'function', 'true', 'false', 'and', 'or', 'not', 'mod', 'div', 'self', 'other', 'global', 'noone']);
  const OPS2 = new Set(['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '++', '--']);
  const OPS1 = '+-*/%<>=!(){}[],;.?:';
  const NOT_FOUND = Symbol('nao-encontrado');
  const BREAK = { stop: 'break' };
  const CONTINUE = { stop: 'continue' };
  const LIMIT = 200000;
  const DEPTH = 64;

  class ScriptError extends Error {
    constructor(message, line) {
      super(line ? `linha ${line}: ${message}` : message);
      this.line = line || 0;
      this.script = true;
    }
  }

  class Return {
    constructor(value) {
      this.value = value;
    }
  }

  const LANGS = ['crivo', 'cpp', 'lua'];
  const KW = {
    crivo: KEYWORDS,
    cpp: new Set(['if', 'else', 'while', 'for', 'do', 'break', 'continue', 'return', 'true', 'false', 'nullptr', 'NULL', 'and', 'or', 'not', 'self', 'other', 'global', 'noone', 'using', 'namespace', 'const', 'static', 'inline', 'unsigned', 'signed', 'constexpr', 'struct', 'switch', 'case', 'default']),
    lua: new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'self', 'other', 'global', 'noone']),
  };
  const OPS = {
    crivo: { three: [], two: OPS2, one: OPS1 },
    cpp: { three: [], two: new Set([...OPS2, '->', '::', '<<', '>>', '%=']), one: OPS1 + '&|' },
    lua: { three: ['...'], two: new Set(['==', '~=', '<=', '>=', '..', '//', '::']), one: '+-*/%^#<>=(){}[],;.:' },
  };
  const CPP_TYPES = new Set(['int', 'float', 'double', 'bool', 'auto', 'void', 'char', 'long', 'short', 'string', 'var', 'size_t', 'Ator', 'Actor', 'Instancia', 'Instance', 'uint8_t', 'int32_t', 'int64_t', 'uint32_t']);

  function tokenize(src, lang = 'crivo') {
    const out = [];
    const n = src.length;
    const kw = KW[lang] || KEYWORDS;
    const ops = OPS[lang] || OPS.crivo;
    let i = 0;
    let line = 1;
    let lineStart = true;
    while (i < n) {
      const c = src[i];
      if (c === '\n') {
        line++;
        i++;
        lineStart = true;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r') {
        i++;
        continue;
      }
      if (lang === 'cpp' && c === '#' && lineStart) {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      lineStart = false;
      if (lang === 'lua' && c === '-' && src[i + 1] === '-') {
        const long = /^--\[(=*)\[/.exec(src.slice(i, i + 12));
        if (long) {
          const close = `]${long[1]}]`;
          const end = src.indexOf(close, i + long[0].length);
          const stop = end < 0 ? n : end + close.length;
          for (let j = i; j < stop; j++) if (src[j] === '\n') line++;
          i = stop;
        } else while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (lang !== 'lua' && c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (lang !== 'lua' && c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
          if (src[i] === '\n') line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (lang === 'lua' && c === '[' && /^\[=*\[/.test(src.slice(i, i + 8))) {
        const open = /^\[(=*)\[/.exec(src.slice(i, i + 8));
        const close = `]${open[1]}]`;
        const end = src.indexOf(close, i + open[0].length);
        if (end < 0) throw new ScriptError('texto longo sem o fechamento ]]', line);
        let s = src.slice(i + open[0].length, end);
        if (s.startsWith('\n')) s = s.slice(1);
        out.push({ t: 'str', v: s, line });
        for (const ch of src.slice(i, end)) if (ch === '\n') line++;
        i = end + close.length;
        continue;
      }
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        let j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        out.push({ t: 'num', v: parseInt(src.slice(i + 2, j), 16) || 0, line });
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        while (j < n && /[0-9_]/.test(src[j])) j++;
        if (src[j] === '.' && src[j + 1] !== '.') {
          j++;
          while (j < n && /[0-9_]/.test(src[j])) j++;
        }
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] || '')) {
          j += 2;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        const value = Number(src.slice(i, j).replace(/_/g, ''));
        if (!Number.isFinite(value)) throw new ScriptError(`número inválido "${src.slice(i, j)}"`, line);
        if (lang === 'cpp' && /[fFlLuU]/.test(src[j] || '')) j++;
        out.push({ t: 'num', v: value, line });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let s = '';
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') {
            const e = src[j + 1];
            s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '0' ? '' : e ?? '';
            j += 2;
          } else {
            if (src[j] === '\n') line++;
            s += src[j++];
          }
        }
        if (j >= n) throw new ScriptError('texto sem as aspas de fechamento', line);
        out.push({ t: 'str', v: s, line });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_À-ɏ]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_À-ɏ]/.test(src[j])) j++;
        const w = src.slice(i, j);
        out.push({ t: kw.has(w) ? 'kw' : 'id', v: w, line });
        i = j;
        continue;
      }
      const three = src.slice(i, i + 3);
      if (ops.three.includes(three)) {
        out.push({ t: 'op', v: three, line });
        i += 3;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (ops.two.has(two)) {
        out.push({ t: 'op', v: two, line });
        i += 2;
        continue;
      }
      if (ops.one.includes(c)) {
        out.push({ t: 'op', v: c, line });
        i++;
        continue;
      }
      throw new ScriptError(`caractere inesperado "${c}"`, line);
    }
    out.push({ t: 'eof', v: '', line });
    return out;
  }

  function parse(src, lang = 'crivo') {
    if (lang === 'lua') return parseLua(String(src ?? ''));
    const cpp = lang === 'cpp';
    const toks = tokenize(String(src ?? ''), cpp ? 'cpp' : 'crivo');
    let p = 0;
    const peek = (k = 0) => toks[Math.min(toks.length - 1, p + k)];
    const next = () => toks[p++];
    const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
    const isKw = (v) => toks[p].t === 'kw' && toks[p].v === v;
    const fail = (msg) => {
      throw new ScriptError(msg, toks[p].line);
    };
    const expect = (v) => {
      if (!isOp(v)) fail(`esperava "${v}"${toks[p].t === 'eof' ? ' antes do fim' : ` e encontrou "${toks[p].v}"`}`);
      return next();
    };
    const ident = () => {
      if (toks[p].t !== 'id') fail(`esperava um nome${toks[p].v ? ` e encontrou "${toks[p].v}"` : ''}`);
      return next().v;
    };
    const semis = () => {
      while (isOp(';')) p++;
    };

    function skipTemplate() {
      if (!isOp('<')) return;
      let depth = 0;
      do {
        if (isOp('<')) depth++;
        else if (isOp('>')) depth--;
        else if (isOp('>>')) depth -= 2;
        else if (toks[p].t === 'eof') fail('faltou fechar o tipo com ">"');
        next();
      } while (depth > 0);
    }

    function typeAhead() {
      if (!cpp) return 0;
      let k = 0;
      while (peek(k).t === 'kw' && ['const', 'static', 'inline', 'unsigned', 'signed', 'constexpr'].includes(peek(k).v)) k++;
      const t = peek(k);
      let isType = false;
      if (t.t === 'id' && t.v === 'std' && peek(k + 1).t === 'op' && peek(k + 1).v === '::') {
        isType = ['string', 'vector', 'array', 'map', 'list', 'deque'].includes(peek(k + 2).v);
      } else if (t.t === 'id' && CPP_TYPES.has(t.v)) isType = true;
      else if (t.t === 'kw' && (t.v === 'unsigned' || t.v === 'signed')) isType = true;
      if (!isType) return 0;
      let j = k;
      if (peek(j).v === 'std') j += 3;
      else j += 1;
      if (peek(j).t === 'op' && peek(j).v === '<') {
        let depth = 0;
        do {
          if (peek(j).v === '<') depth++;
          else if (peek(j).v === '>') depth--;
          else if (peek(j).v === '>>') depth -= 2;
          else if (peek(j).t === 'eof') return 0;
          j++;
        } while (depth > 0);
      }
      while (peek(j).t === 'op' && ['*', '&'].includes(peek(j).v)) j++;
      return peek(j).t === 'id' ? j + 1 : 0;
    }

    function readType() {
      let name = '';
      while (toks[p].t === 'kw' && ['const', 'static', 'inline', 'unsigned', 'signed', 'constexpr'].includes(toks[p].v)) next();
      if (toks[p].v === 'std' && isOp('::', 1)) {
        next();
        next();
      }
      if (toks[p].t === 'id') name = next().v;
      skipTemplate();
      while (isOp('*') || isOp('&')) next();
      return name;
    }

    function program() {
      const body = [];
      semis();
      while (toks[p].t !== 'eof') {
        body.push(statement());
        semis();
      }
      return { k: 'block', body, line: 1 };
    }

    function block() {
      const line = expect('{').line;
      const body = [];
      semis();
      while (!isOp('}')) {
        if (toks[p].t === 'eof') fail('faltou fechar o bloco com "}"');
        body.push(statement());
        semis();
      }
      expect('}');
      return { k: 'block', body, line };
    }

    function varDecl() {
      const line = next().line;
      const decls = [];
      do {
        const name = ident();
        let init = null;
        if (isOp('=')) {
          next();
          init = expression();
        }
        decls.push({ name, init });
      } while (isOp(',') && next());
      return { k: 'var', decls, line };
    }

    function cppDecl() {
      const line = peek().line;
      const type = readType();
      const int = ['int', 'long', 'short', 'char', 'size_t', 'uint8_t', 'int32_t', 'int64_t', 'uint32_t'].includes(type) && type !== 'char';
      const name = ident();
      if (isOp('(')) {
        next();
        const params = [];
        if (!isOp(')')) {
          do {
            if (isOp(')')) break;
            if (toks[p].t === 'id' && toks[p].v === 'void' && isOp(')', 1)) {
              next();
              break;
            }
            readType();
            params.push(ident());
            if (isOp('=')) {
              next();
              expression();
            }
          } while (isOp(',') && next());
        }
        expect(')');
        while (isKw('const')) next();
        if (isOp(';')) return { k: 'block', body: [], line };
        return { k: 'function', name, params, body: block(), line };
      }
      const decls = [];
      let current = name;
      for (;;) {
        let init = null;
        if (isOp('=')) {
          next();
          init = expression();
        } else if (isOp('{')) {
          init = expression();
        } else if (isOp('[')) {
          next();
          const size = isOp(']') ? null : expression();
          expect(']');
          if (isOp('=')) {
            next();
            init = expression();
          } else init = { k: 'call', name: 'array_create', args: [size || { k: 'num', v: 0, line }], line };
        } else if (isOp('(')) {
          next();
          const args = [];
          if (!isOp(')')) {
            do args.push(expression());
            while (isOp(',') && next());
          }
          expect(')');
          init = args[0] || null;
        }
        decls.push({ name: current, init, int });
        if (!isOp(',')) break;
        next();
        current = ident();
      }
      return { k: 'var', decls, line, int };
    }

    function coutStatement(line) {
      const args = [];
      while (isOp('<<')) {
        next();
        if (toks[p].v === 'std' && isOp('::', 1) && peek(2).v === 'endl') {
          p += 3;
          args.push({ k: 'str', v: '\n', line });
        } else if (toks[p].t === 'id' && toks[p].v === 'endl') {
          next();
          args.push({ k: 'str', v: '\n', line });
        } else args.push(additive());
      }
      return { k: 'expr', expr: { k: 'call', name: '__cout', args, line }, line };
    }

    function statement() {
      const line = peek().line;
      if (isOp('{')) return block();
      if (!cpp && isKw('var')) return varDecl();
      if (cpp) {
        if (isKw('using')) {
          while (!isOp(';') && toks[p].t !== 'eof') next();
          return { k: 'block', body: [], line };
        }
        if (isKw('struct')) fail('struct ainda não é suportado no C++ do Crivo; use variáveis do ator');
        if (isKw('switch')) return switchStatement();
        if ((toks[p].v === 'std' && isOp('::', 1) && peek(2).v === 'cout') || (toks[p].t === 'id' && toks[p].v === 'cout' && isOp('<<', 1))) {
          p += toks[p].v === 'std' ? 3 : 1;
          return coutStatement(line);
        }
        if (typeAhead()) return cppDecl();
      }
      if (isKw('if')) {
        next();
        const test = expression();
        const then = statement();
        semis();
        let other = null;
        if (isKw('else')) {
          next();
          other = statement();
        }
        return { k: 'if', test, then, other, line };
      }
      if (isKw('while')) {
        next();
        const test = expression();
        return { k: 'while', test, body: statement(), line };
      }
      if (!cpp && isKw('repeat')) {
        next();
        const count = expression();
        return { k: 'repeat', count, body: statement(), line };
      }
      if (isKw('do')) {
        next();
        const body = statement();
        semis();
        if (cpp) {
          if (!isKw('while')) fail('esperava "while" depois do "do"');
          next();
          return { k: 'do', body, test: { k: 'not', a: expression(), line }, line };
        }
        if (!isKw('until')) fail('esperava "until" depois do "do"');
        next();
        return { k: 'do', body, test: expression(), line };
      }
      if (isKw('for')) {
        next();
        expect('(');
        const init = isOp(';') ? null : !cpp && isKw('var') ? varDecl() : cpp && typeAhead() ? cppDecl() : simple();
        if (cpp && isOp(':')) {
          next();
          const list = expression();
          expect(')');
          const name = init.k === 'var' ? init.decls[0].name : init.expr?.name;
          return { k: 'forin', key: null, value: name, list, base: 0, body: statement(), line };
        }
        expect(';');
        const test = isOp(';') ? null : expression();
        expect(';');
        const update = isOp(')') ? null : simple();
        expect(')');
        return { k: 'for', init, test, update, body: statement(), line };
      }
      if (isKw('break')) {
        next();
        return { k: 'break', line };
      }
      if (isKw('continue')) {
        next();
        return { k: 'continue', line };
      }
      if (isKw('return')) {
        next();
        const value = isOp(';') || isOp('}') || toks[p].t === 'eof' ? null : expression();
        return { k: 'return', value, line };
      }
      if (!cpp && isKw('function')) {
        next();
        const name = ident();
        expect('(');
        const params = [];
        if (!isOp(')')) {
          do params.push(ident());
          while (isOp(',') && next());
        }
        expect(')');
        return { k: 'function', name, params, body: block(), line };
      }
      return simple();
    }

    function switchStatement() {
      const line = next().line;
      const subject = expression();
      expect('{');
      const cases = [];
      let current = null;
      while (!isOp('}')) {
        if (toks[p].t === 'eof') fail('faltou fechar o switch com "}"');
        if (isKw('case')) {
          next();
          current = { test: expression(), body: [] };
          expect(':');
          cases.push(current);
        } else if (isKw('default')) {
          next();
          expect(':');
          current = { test: null, body: [] };
          cases.push(current);
        } else {
          if (!current) fail('esperava "case" dentro do switch');
          current.body.push(statement());
          semis();
        }
      }
      expect('}');
      return { k: 'switch', subject, cases, line };
    }

    function simple() {
      const line = peek().line;
      if (isOp('++') || isOp('--')) {
        const op = next().v === '++' ? '+=' : '-=';
        const target = unary();
        if (!['id', 'member', 'index'].includes(target.k)) fail('não dá para somar nisso');
        return { k: 'assign', op, target, value: { k: 'num', v: 1, line }, line };
      }
      const target = expression();
      const t = toks[p];
      if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(t.v)) {
        if (!['id', 'member', 'index'].includes(target.k)) fail('não dá para guardar um valor nisso');
        next();
        return { k: 'assign', op: t.v, target, value: expression(), line };
      }
      if (isOp('++') || isOp('--')) {
        if (!['id', 'member', 'index'].includes(target.k)) fail('não dá para somar nisso');
        const op = next().v === '++' ? '+=' : '-=';
        return { k: 'assign', op, target, value: { k: 'num', v: 1, line }, line };
      }
      return { k: 'expr', expr: target, line };
    }

    function expression() {
      const test = orExpr();
      if (isOp('?')) {
        const line = next().line;
        const a = expression();
        expect(':');
        return { k: 'cond', test, a, b: expression(), line };
      }
      return test;
    }

    function orExpr() {
      let left = andExpr();
      while (isOp('||') || isKw('or')) {
        const line = next().line;
        left = { k: 'or', a: left, b: andExpr(), line };
      }
      return left;
    }

    function andExpr() {
      let left = equality();
      while (isOp('&&') || isKw('and')) {
        const line = next().line;
        left = { k: 'and', a: left, b: equality(), line };
      }
      return left;
    }

    function binary(sub, ops, words = []) {
      return () => {
        let left = sub();
        for (;;) {
          const t = toks[p];
          const op = (t.t === 'op' && ops.includes(t.v)) || (t.t === 'kw' && words.includes(t.v)) ? t.v : null;
          if (!op) return left;
          next();
          left = { k: 'bin', op, a: left, b: sub(), line: t.line };
        }
      };
    }

    const multiplicative = binary(unary, ['*', '/', '%'], cpp ? [] : ['mod', 'div']);
    const additive = binary(multiplicative, ['+', '-']);
    const comparison = binary(additive, ['<', '>', '<=', '>=']);
    const equality = binary(comparison, ['==', '!=']);

    function unary() {
      const line = peek().line;
      if (isOp('!') || isKw('not')) {
        next();
        return { k: 'not', a: unary(), line };
      }
      if (isOp('-')) {
        next();
        return { k: 'neg', a: unary(), line };
      }
      if (isOp('+')) {
        next();
        return unary();
      }
      if (cpp && isOp('(') && peek(1).t === 'id' && ['int', 'float', 'double', 'bool', 'long', 'short', 'char'].includes(peek(1).v) && isOp(')', 2)) {
        next();
        const type = next().v;
        next();
        return { k: 'cast', type, a: unary(), line };
      }
      if (cpp && toks[p].t === 'id' && ['static_cast', 'int_cast'].includes(toks[p].v) && isOp('<', 1)) {
        next();
        next();
        const type = readType();
        expect('>');
        expect('(');
        const a = expression();
        expect(')');
        return { k: 'cast', type, a, line };
      }
      return postfix();
    }

    function postfix() {
      let node = primary();
      for (;;) {
        const line = peek().line;
        if (isOp('(')) {
          if (node.k !== 'id') fail('só dá para chamar funções pelo nome');
          next();
          const args = [];
          if (!isOp(')')) {
            do args.push(expression());
            while (isOp(',') && next());
          }
          expect(')');
          node = { k: 'call', name: node.name, args, line };
        } else if (isOp('.') || (cpp && isOp('->'))) {
          next();
          const name = ident();
          if (cpp && isOp('(')) {
            next();
            const args = [];
            if (!isOp(')')) {
              do args.push(expression());
              while (isOp(',') && next());
            }
            expect(')');
            node = { k: 'method', obj: node, name, args, line };
          } else node = { k: 'member', obj: node, name, line };
        } else if (isOp('[')) {
          next();
          const index = expression();
          expect(']');
          node = { k: 'index', obj: node, index, line };
        } else return node;
      }
    }

    function primary() {
      const t = next();
      const line = t.line;
      if (t.t === 'num') return { k: 'num', v: t.v, line };
      if (t.t === 'str') return { k: 'str', v: t.v, line };
      if (t.t === 'id') {
        if (cpp && isOp('::')) {
          next();
          const name = ident();
          if (t.v === 'global' || t.v === 'jogo') return { k: 'member', obj: { k: 'global', line }, name, line };
          if (t.v === 'std' && (name === 'vector' || name === 'string' || name === 'array')) {
            skipTemplate();
            if (isOp('{')) return primary();
            if (isOp('(')) {
              next();
              const args = [];
              if (!isOp(')')) {
                do args.push(expression());
                while (isOp(',') && next());
              }
              expect(')');
              return name === 'string' ? { k: 'call', name: 'string', args: args.length ? args : [{ k: 'str', v: '', line }], line } : { k: 'call', name: 'array_create', args, line };
            }
            return { k: 'array', items: [], line };
          }
          if (t.v === 'std' && name === 'endl') return { k: 'str', v: '\n', line };
          return { k: 'id', name, line };
        }
        return { k: 'id', name: t.v, line };
      }
      if (t.t === 'kw') {
        if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true', line };
        if (t.v === 'noone' || t.v === 'nullptr' || t.v === 'NULL') return { k: 'num', v: null, line };
        if (t.v === 'self' || t.v === 'other') return { k: t.v, line };
        if (t.v === 'global') {
          if (cpp && isOp('::')) {
            next();
            return { k: 'member', obj: { k: 'global', line }, name: ident(), line };
          }
          return { k: 'global', line };
        }
      }
      if (t.t === 'op' && t.v === '(') {
        const e = expression();
        expect(')');
        return e;
      }
      if (t.t === 'op' && (t.v === '[' || (cpp && t.v === '{'))) {
        const close = t.v === '[' ? ']' : '}';
        const items = [];
        if (!isOp(close)) {
          do {
            if (isOp(close)) break;
            items.push(expression());
          } while (isOp(',') && next());
        }
        expect(close);
        return { k: 'array', items, line };
      }
      p--;
      fail(t.t === 'eof' ? 'o código terminou no meio de uma expressão' : `não esperava "${t.v}" aqui`);
      return null;
    }

    return program();
  }

  function parseLua(src) {
    const toks = tokenize(src, 'lua');
    let p = 0;
    const peek = (k = 0) => toks[Math.min(toks.length - 1, p + k)];
    const next = () => toks[p++];
    const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
    const isKw = (v) => toks[p].t === 'kw' && toks[p].v === v;
    const fail = (msg) => {
      throw new ScriptError(msg, toks[p].line);
    };
    const expect = (v) => {
      if (!isOp(v)) fail(`esperava "${v}"${toks[p].t === 'eof' ? ' antes do fim' : ` e encontrou "${toks[p].v}"`}`);
      return next();
    };
    const expectKw = (v) => {
      if (!isKw(v)) fail(`esperava "${v}"${toks[p].t === 'eof' ? ' antes do fim' : ` e encontrou "${toks[p].v}"`}`);
      return next();
    };
    const ident = () => {
      if (toks[p].t !== 'id') fail(`esperava um nome${toks[p].v ? ` e encontrou "${toks[p].v}"` : ''}`);
      return next().v;
    };
    const truth = (a) => ({ k: 'truth', a, line: a.line });

    function blockUntil(...words) {
      const body = [];
      const line = peek().line;
      while (!(toks[p].t === 'kw' && words.includes(toks[p].v))) {
        if (toks[p].t === 'eof') fail(`faltou "${words[words.length - 1]}"`);
        if (isOp(';')) {
          next();
          continue;
        }
        body.push(statement());
      }
      return { k: 'block', body, line };
    }

    function program() {
      const body = [];
      while (toks[p].t !== 'eof') {
        if (isOp(';')) {
          next();
          continue;
        }
        body.push(statement());
      }
      return { k: 'block', body, line: 1 };
    }

    function funcBody(name, line) {
      expect('(');
      const params = [];
      if (!isOp(')')) {
        do {
          if (isOp('...')) {
            next();
            break;
          }
          params.push(ident());
        } while (isOp(',') && next());
      }
      expect(')');
      const body = blockUntil('end');
      expectKw('end');
      return { k: 'function', name, params, body, line };
    }

    function statement() {
      const line = peek().line;
      if (isKw('local')) {
        next();
        if (isKw('function')) {
          next();
          return funcBody(ident(), line);
        }
        const names = [ident()];
        while (isOp(',')) {
          next();
          names.push(ident());
        }
        const values = [];
        if (isOp('=')) {
          next();
          do values.push(expression());
          while (isOp(',') && next());
        }
        return { k: 'var', decls: names.map((name, i) => ({ name, init: values[i] || { k: 'num', v: null, line } })), line };
      }
      if (isKw('function')) {
        next();
        let name = ident();
        while (isOp('.') || isOp(':')) {
          next();
          name = ident();
        }
        return funcBody(name, line);
      }
      if (isKw('if')) {
        next();
        const test = truth(expression());
        expectKw('then');
        const then = blockUntil('elseif', 'else', 'end');
        const root = { k: 'if', test, then, other: null, line };
        let cur = root;
        for (;;) {
          if (isKw('elseif')) {
            const l = next().line;
            const t2 = truth(expression());
            expectKw('then');
            const node = { k: 'if', test: t2, then: blockUntil('elseif', 'else', 'end'), other: null, line: l };
            cur.other = node;
            cur = node;
          } else if (isKw('else')) {
            next();
            cur.other = blockUntil('end');
            expectKw('end');
            break;
          } else {
            expectKw('end');
            break;
          }
        }
        return root;
      }
      if (isKw('while')) {
        next();
        const test = truth(expression());
        expectKw('do');
        const body = blockUntil('end');
        expectKw('end');
        return { k: 'while', test, body, line };
      }
      if (isKw('do')) {
        next();
        const body = blockUntil('end');
        expectKw('end');
        return body;
      }
      if (isKw('repeat')) {
        next();
        const body = blockUntil('until');
        expectKw('until');
        return { k: 'do', body, test: truth(expression()), line };
      }
      if (isKw('for')) {
        next();
        const first = ident();
        if (isOp('=')) {
          next();
          const from = expression();
          expect(',');
          const to = expression();
          let step = null;
          if (isOp(',')) {
            next();
            step = expression();
          }
          expectKw('do');
          const body = blockUntil('end');
          expectKw('end');
          return { k: 'numfor', name: first, from, to, step, body, line };
        }
        let second = null;
        if (isOp(',')) {
          next();
          second = ident();
        }
        expectKw('in');
        const iter = expression();
        const list = iter.k === 'call' && ['ipairs', 'pairs'].includes(iter.name) ? iter.args[0] : iter;
        expectKw('do');
        const body = blockUntil('end');
        expectKw('end');
        return { k: 'forin', key: second ? first : null, value: second || first, list, base: 1, keyOnly: !second, body, line };
      }
      if (isKw('break')) {
        next();
        return { k: 'break', line };
      }
      if (isOp('::')) fail('goto e rótulos não são suportados');
      if (isKw('return')) {
        next();
        const value = isKw('end') || isKw('else') || isKw('elseif') || isKw('until') || toks[p].t === 'eof' || isOp(';') ? null : expression();
        return { k: 'return', value, line };
      }
      const target = suffixed();
      if (isOp('=') || isOp(',')) {
        const targets = [target];
        while (isOp(',')) {
          next();
          targets.push(suffixed());
        }
        expect('=');
        const values = [];
        do values.push(expression());
        while (isOp(',') && next());
        for (const t of targets) if (!['id', 'member', 'index'].includes(t.k)) fail('não dá para guardar um valor nisso');
        if (targets.length === 1) return { k: 'assign', op: '=', target, value: values[0], line };
        return { k: 'multi', targets, values, line };
      }
      if (target.k !== 'call' && target.k !== 'method') fail('esperava uma chamada de função ou uma atribuição');
      return { k: 'expr', expr: target, line };
    }

    function expression() {
      return orExpr();
    }

    function orExpr() {
      let left = andExpr();
      while (isKw('or')) {
        const line = next().line;
        left = { k: 'lor', a: left, b: andExpr(), line };
      }
      return left;
    }

    function andExpr() {
      let left = comparison();
      while (isKw('and')) {
        const line = next().line;
        left = { k: 'land', a: left, b: comparison(), line };
      }
      return left;
    }

    function comparison() {
      let left = concat();
      for (;;) {
        const t = toks[p];
        if (t.t !== 'op' || !['<', '>', '<=', '>=', '==', '~='].includes(t.v)) return left;
        next();
        left = { k: 'bin', op: t.v === '~=' ? '!=' : t.v, a: left, b: concat(), line: t.line };
      }
    }

    function concat() {
      const left = additive();
      if (isOp('..')) {
        const line = next().line;
        return { k: 'bin', op: '..', a: left, b: concat(), line };
      }
      return left;
    }

    function additive() {
      let left = multiplicative();
      while (isOp('+') || isOp('-')) {
        const t = next();
        left = { k: 'bin', op: t.v, a: left, b: multiplicative(), line: t.line };
      }
      return left;
    }

    function multiplicative() {
      let left = unary();
      while (isOp('*') || isOp('/') || isOp('%') || isOp('//')) {
        const t = next();
        left = { k: 'bin', op: t.v === '//' ? 'fdiv' : t.v, a: left, b: unary(), line: t.line };
      }
      return left;
    }

    function unary() {
      const line = peek().line;
      if (isKw('not')) {
        next();
        return { k: 'lnot', a: unary(), line };
      }
      if (isOp('-')) {
        next();
        return { k: 'neg', a: unary(), line };
      }
      if (isOp('#')) {
        next();
        return { k: 'len', a: unary(), line };
      }
      return power();
    }

    function power() {
      const base = suffixed();
      if (isOp('^')) {
        const line = next().line;
        return { k: 'bin', op: '^', a: base, b: unary(), line };
      }
      return base;
    }

    function args() {
      if (toks[p].t === 'str') return [{ k: 'str', v: next().v, line: toks[p - 1].line }];
      if (isOp('{')) return [table()];
      expect('(');
      const list = [];
      if (!isOp(')')) {
        do list.push(expression());
        while (isOp(',') && next());
      }
      expect(')');
      return list;
    }

    function suffixed() {
      let node = primary();
      for (;;) {
        const line = peek().line;
        if (isOp('(') || (node.k === 'id' && (toks[p].t === 'str' || isOp('{')))) {
          if (node.k !== 'id') fail('só dá para chamar funções pelo nome');
          node = { k: 'call', name: node.name, args: args(), line };
        } else if (isOp('.')) {
          next();
          node = { k: 'member', obj: node, name: ident(), line };
        } else if (isOp(':')) {
          next();
          const name = ident();
          node = { k: 'method', obj: node, name, args: args(), line };
        } else if (isOp('[')) {
          next();
          const index = expression();
          expect(']');
          node = { k: 'index', obj: node, index, base: 1, line };
        } else return node;
      }
    }

    function table() {
      const line = expect('{').line;
      const items = [];
      while (!isOp('}')) {
        if (toks[p].t === 'id' && isOp('=', 1)) fail('tabelas com chaves (nome = valor) ainda não são suportadas; use listas {1, 2, 3}');
        items.push(expression());
        if (isOp(',') || isOp(';')) next();
        else break;
      }
      expect('}');
      return { k: 'array', items, line };
    }

    function primary() {
      const t = next();
      const line = t.line;
      if (t.t === 'num') return { k: 'num', v: t.v, line };
      if (t.t === 'str') return { k: 'str', v: t.v, line };
      if (t.t === 'id') return { k: 'id', name: t.v, line };
      if (t.t === 'kw') {
        if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true', line };
        if (t.v === 'nil' || t.v === 'noone') return { k: 'num', v: null, line };
        if (t.v === 'self' || t.v === 'other' || t.v === 'global') return { k: t.v, line };
        if (t.v === 'function') return funcBody('__anonima', line);
      }
      if (t.t === 'op' && t.v === '(') {
        const e = expression();
        expect(')');
        return e;
      }
      if (t.t === 'op' && t.v === '{') {
        p--;
        return table();
      }
      p--;
      fail(t.t === 'eof' ? 'o código terminou no meio de uma expressão' : `não esperava "${t.v}" aqui`);
      return null;
    }

    return program();
  }

  const cache = new Map();
  function compile(src, lang = 'crivo') {
    const dialect = LANGS.includes(lang) ? lang : 'crivo';
    const key = `${dialect}\u0000${String(src ?? '')}`;
    if (cache.has(key)) return cache.get(key);
    let ast;
    try {
      ast = parse(String(src ?? ''), dialect);
    } catch (error) {
      if (dialect !== 'lua' || String(src ?? '').includes('\n')) throw error;
      try {
        ast = parse(`return ${src}`, dialect);
      } catch {
        throw error;
      }
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, ast);
    return ast;
  }

  function check(src, lang = 'crivo') {
    try {
      compile(src, lang);
      return null;
    } catch (error) {
      return error.message;
    }
  }

  function format(v) {
    if (v === null || v === undefined) return 'noone';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return `[${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : format(x))).join(', ')}]`;
    if (typeof v === 'object' && v.describe) return v.describe();
    return String(v);
  }

  const truthy = (v) => (typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : Boolean(v));
  const numberOf = (v, line) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    throw new ScriptError(`esperava um número e recebeu ${typeof v === 'string' ? `o texto "${v}"` : format(v)}`, line);
  };
  const equals = (a, b) => {
    if ((typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean')) return Number(a) === Number(b);
    return a === b;
  };

  const MATH = {
    abs: (a) => Math.abs(numberOf(a[0])),
    sign: (a) => Math.sign(numberOf(a[0])),
    floor: (a) => Math.floor(numberOf(a[0])),
    ceil: (a) => Math.ceil(numberOf(a[0])),
    round: (a) => Math.round(numberOf(a[0])),
    frac: (a) => numberOf(a[0]) - Math.trunc(numberOf(a[0])),
    sqrt: (a) => Math.sqrt(Math.max(0, numberOf(a[0]))),
    sqr: (a) => numberOf(a[0]) ** 2,
    power: (a) => numberOf(a[0]) ** numberOf(a[1]),
    exp: (a) => Math.exp(numberOf(a[0])),
    ln: (a) => Math.log(numberOf(a[0])),
    min: (a) => Math.min(...a.map((x) => numberOf(x))),
    max: (a) => Math.max(...a.map((x) => numberOf(x))),
    mean: (a) => (a.length ? a.reduce((s, x) => s + numberOf(x), 0) / a.length : 0),
    clamp: (a) => Math.max(numberOf(a[1]), Math.min(numberOf(a[2]), numberOf(a[0]))),
    lerp: (a) => numberOf(a[0]) + (numberOf(a[1]) - numberOf(a[0])) * numberOf(a[2]),
    sin: (a) => Math.sin(numberOf(a[0])),
    cos: (a) => Math.cos(numberOf(a[0])),
    tan: (a) => Math.tan(numberOf(a[0])),
    dsin: (a) => Math.sin((numberOf(a[0]) * Math.PI) / 180),
    dcos: (a) => Math.cos((numberOf(a[0]) * Math.PI) / 180),
    darctan2: (a) => (Math.atan2(numberOf(a[0]), numberOf(a[1])) * 180) / Math.PI,
    degtorad: (a) => (numberOf(a[0]) * Math.PI) / 180,
    radtodeg: (a) => (numberOf(a[0]) * 180) / Math.PI,
    point_distance: (a) => Math.hypot(numberOf(a[2]) - numberOf(a[0]), numberOf(a[3]) - numberOf(a[1])),
    point_direction: (a) => ((Math.atan2(-(numberOf(a[3]) - numberOf(a[1])), numberOf(a[2]) - numberOf(a[0])) * 180) / Math.PI + 360) % 360,
    lengthdir_x: (a) => Math.cos((numberOf(a[1]) * Math.PI) / 180) * numberOf(a[0]),
    lengthdir_y: (a) => -Math.sin((numberOf(a[1]) * Math.PI) / 180) * numberOf(a[0]),
    angle_difference: (a) => ((((numberOf(a[0]) - numberOf(a[1])) % 360) + 540) % 360) - 180,
    approach: (a) => {
      const v = numberOf(a[0]);
      const t = numberOf(a[1]);
      const s = Math.abs(numberOf(a[2]));
      return v < t ? Math.min(t, v + s) : Math.max(t, v - s);
    },
    wrap: (a) => {
      const v = numberOf(a[0]);
      const lo = numberOf(a[1]);
      const hi = numberOf(a[2]);
      const r = hi - lo;
      return r <= 0 ? lo : ((((v - lo) % r) + r) % r) + lo;
    },
    string: (a) => format(a[0]),
    real: (a) => numberOf(a[0]),
    is_number: (a) => typeof a[0] === 'number',
    is_string: (a) => typeof a[0] === 'string',
    is_array: (a) => Array.isArray(a[0]),
    string_length: (a) => format(a[0]).length,
    string_upper: (a) => format(a[0]).toUpperCase(),
    string_lower: (a) => format(a[0]).toLowerCase(),
    string_repeat: (a) => format(a[0]).repeat(Math.max(0, Math.min(1000, numberOf(a[1])))),
    string_pos: (a) => format(a[1]).indexOf(format(a[0])) + 1,
    string_copy: (a) => format(a[0]).substr(Math.max(0, numberOf(a[1]) - 1), Math.max(0, numberOf(a[2]))),
    string_replace_all: (a) => format(a[0]).split(format(a[1])).join(format(a[2])),
    array_create: (a) => new Array(Math.max(0, Math.min(100000, numberOf(a[0])))).fill(a.length > 1 ? a[1] : 0),
    array_length: (a) => (Array.isArray(a[0]) ? a[0].length : 0),
    array_push: (a) => (Array.isArray(a[0]) ? a[0].push(...a.slice(1)) : 0),
    array_pop: (a) => (Array.isArray(a[0]) && a[0].length ? a[0].pop() : null),
    array_insert: (a) => (Array.isArray(a[0]) ? a[0].splice(numberOf(a[1]), 0, a[2]).length : 0),
    array_delete: (a) => (Array.isArray(a[0]) ? a[0].splice(numberOf(a[1]), Math.max(1, numberOf(a[2] ?? 1))).length : 0),
    array_contains: (a) => (Array.isArray(a[0]) ? a[0].some((x) => equals(x, a[1])) : false),
  };

  function run(src, env = {}, options = {}) {
    const ast = typeof src === 'string' ? compile(src, options.lang) : src;
    const state = { steps: 0, limit: options.limit || LIMIT, depth: 0, env, functions: Object.assign(Object.create(null), env.functions || {}), last: undefined, lastIsValue: false };
    hoist(ast, state.functions);
    const scope = options.scope || new Map();
    try {
      exec(ast, scope, state, true);
    } catch (error) {
      if (error instanceof Return) return { value: error.value, shown: true };
      if (error === BREAK || error === CONTINUE) return { value: undefined, shown: false };
      throw error;
    } finally {
      if (state.cout && env.print) env.print(state.cout);
      state.cout = '';
    }
    return { value: state.last, shown: state.lastIsValue };
  }

  function hoist(ast, into) {
    for (const s of ast.body || []) if (s.k === 'function') into[s.name] = s;
  }

  function library(scripts) {
    const functions = Object.create(null);
    const inits = [];
    const errors = [];
    for (const s of scripts || []) {
      try {
        const ast = compile(s.code || '', s.lang);
        hoist(ast, functions);
        const rest = ast.body.filter((x) => x.k !== 'function');
        if (rest.length) inits.push({ name: s.name, ast: { k: 'block', body: rest, line: 1 } });
      } catch (error) {
        errors.push(`${s.name}: ${error.message}`);
      }
    }
    return { functions, inits, errors };
  }

  function tick(state, line) {
    if (++state.steps > state.limit) throw new ScriptError(`o código passou de ${state.limit} passos (laço sem fim?)`, line);
  }

  function exec(node, scope, st, top = false) {
    tick(st, node.line);
    switch (node.k) {
      case 'block':
        for (const s of node.body) exec(s, scope, st, top);
        return;
      case 'var':
        for (const d of node.decls) {
          let v = d.init ? ev(d.init, scope, st) : 0;
          if (d.int) {
            (scope.ints ||= new Set()).add(d.name);
            if (typeof v === 'number') v = Math.trunc(v);
          } else scope.ints?.delete(d.name);
          scope.set(d.name, v);
        }
        if (top) st.lastIsValue = false;
        return;
      case 'multi': {
        const values = node.values.map((x) => ev(x, scope, st));
        node.targets.forEach((t, i) => store(t, i < values.length ? values[i] : null, scope, st));
        if (top) st.lastIsValue = false;
        return;
      }
      case 'numfor': {
        const from = numberOf(ev(node.from, scope, st), node.line);
        const to = numberOf(ev(node.to, scope, st), node.line);
        const step = node.step ? numberOf(ev(node.step, scope, st), node.line) : 1;
        if (step === 0) throw new ScriptError('o passo do for não pode ser 0', node.line);
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          scope.set(node.name, i);
          if (loopBody(node.body, scope, st)) break;
        }
        return;
      }
      case 'forin': {
        const list = ev(node.list, scope, st);
        if (!Array.isArray(list) && typeof list !== 'string') throw new ScriptError('o for só percorre listas e textos', node.line);
        const items = Array.isArray(list) ? list.slice() : [...list];
        for (let i = 0; i < items.length; i++) {
          if (node.keyOnly) scope.set(node.value, i + node.base);
          else {
            if (node.key) scope.set(node.key, i + node.base);
            scope.set(node.value, items[i]);
          }
          if (loopBody(node.body, scope, st)) break;
        }
        return;
      }
      case 'switch': {
        const value = ev(node.subject, scope, st);
        let matched = false;
        try {
          for (const c of node.cases) {
            if (!matched && (c.test === null || equals(ev(c.test, scope, st), value))) matched = true;
            if (matched) for (const s of c.body) exec(s, scope, st);
          }
          if (!matched) {
            const fallback = node.cases.findIndex((c) => c.test === null);
            if (fallback >= 0) for (const c of node.cases.slice(fallback)) for (const s of c.body) exec(s, scope, st);
          }
        } catch (e) {
          if (e !== BREAK) throw e;
        }
        return;
      }
      case 'function':
        st.functions[node.name] = node;
        return;
      case 'if':
        if (truthy(ev(node.test, scope, st))) exec(node.then, scope, st);
        else if (node.other) exec(node.other, scope, st);
        return;
      case 'while':
        while (truthy(ev(node.test, scope, st))) if (loopBody(node.body, scope, st)) break;
        return;
      case 'do':
        do if (loopBody(node.body, scope, st)) break;
        while (!truthy(ev(node.test, scope, st)));
        return;
      case 'repeat': {
        const count = Math.floor(numberOf(ev(node.count, scope, st), node.line));
        for (let i = 0; i < count; i++) if (loopBody(node.body, scope, st)) break;
        return;
      }
      case 'for':
        if (node.init) exec(node.init, scope, st);
        while (!node.test || truthy(ev(node.test, scope, st))) {
          if (loopBody(node.body, scope, st)) break;
          if (node.update) exec(node.update, scope, st);
        }
        return;
      case 'break':
        throw BREAK;
      case 'continue':
        throw CONTINUE;
      case 'return':
        throw new Return(node.value ? ev(node.value, scope, st) : undefined);
      case 'assign': {
        let value = ev(node.value, scope, st);
        if (node.op !== '=') {
          const cur = ev(node.target, scope, st);
          if (node.op === '+=' && (typeof cur === 'string' || typeof value === 'string')) value = format(cur) + format(value);
          else {
            const a = numberOf(cur, node.line);
            const b = numberOf(value, node.line);
            value = node.op === '+=' ? a + b : node.op === '-=' ? a - b : node.op === '*=' ? a * b : node.op === '%=' ? a % b : divide(a, b, node.line);
          }
        }
        store(node.target, value, scope, st);
        if (top) st.lastIsValue = false;
        return;
      }
      case 'expr': {
        const v = ev(node.expr, scope, st);
        if (top) {
          st.last = v;
          st.lastIsValue = !(node.expr.k === 'call' && v === undefined);
        }
        return;
      }
      default:
        throw new ScriptError('comando desconhecido', node.line);
    }
  }

  function loopBody(body, scope, st) {
    try {
      exec(body, scope, st);
    } catch (e) {
      if (e === BREAK) return true;
      if (e === CONTINUE) return false;
      throw e;
    }
    return false;
  }

  function divide(a, b, line) {
    if (b === 0) throw new ScriptError('divisão por zero', line);
    return a / b;
  }

  function needSelf(st, line) {
    const self = st.env.self;
    if (!self) throw new ScriptError('não há ator aqui (self): use global.nome ou var nome', line);
    return self;
  }

  function getMember(target, name, st, line) {
    if (target === null || target === undefined) throw new ScriptError(`noone não tem "${name}"`, line);
    if (Array.isArray(target)) {
      if (name === 'length') return target.length;
      throw new ScriptError(`lista não tem "${name}"`, line);
    }
    if (typeof target === 'string') {
      if (name === 'length') return target.length;
      throw new ScriptError(`texto não tem "${name}"`, line);
    }
    if (typeof target !== 'object' || !st.env.get) throw new ScriptError(`${format(target)} não tem "${name}"`, line);
    return st.env.get(target, name);
  }

  function ev(node, scope, st) {
    tick(st, node.line);
    switch (node.k) {
      case 'num':
      case 'str':
        return node.v;
      case 'array':
        return node.items.map((x) => ev(x, scope, st));
      case 'self':
        return st.env.self ?? null;
      case 'other':
        return st.env.other ?? null;
      case 'global':
        throw new ScriptError('use global.nome para ler uma variável global', node.line);
      case 'id': {
        if (scope.has(node.name)) return scope.get(node.name);
        if (node.name === 'pi') return Math.PI;
        if (st.env.constants && node.name in st.env.constants) return st.env.constants[node.name];
        if (!st.env.self) {
          if (st.env.globals?.has(node.name)) return st.env.globals.get(node.name);
          throw new ScriptError(`"${node.name}" não existe (crie com var ${node.name} = ...)`, node.line);
        }
        return st.env.get(st.env.self, node.name);
      }
      case 'member':
        if (node.obj.k === 'global') return st.env.globals ? st.env.globals.get(node.name) : 0;
        return getMember(ev(node.obj, scope, st), node.name, st, node.line);
      case 'index': {
        const arr = ev(node.obj, scope, st);
        const i = Math.floor(numberOf(ev(node.index, scope, st), node.line)) - (node.base || 0);
        if (typeof arr === 'string') return arr[i] ?? '';
        if (!Array.isArray(arr)) throw new ScriptError('só dá para usar [ ] numa lista', node.line);
        return arr[i] ?? (node.base ? null : 0);
      }
      case 'truth': {
        const v = ev(node.a, scope, st);
        return v !== null && v !== undefined && v !== false;
      }
      case 'land': {
        const a = ev(node.a, scope, st);
        return a === null || a === undefined || a === false ? a : ev(node.b, scope, st);
      }
      case 'lor': {
        const a = ev(node.a, scope, st);
        return a === null || a === undefined || a === false ? ev(node.b, scope, st) : a;
      }
      case 'lnot': {
        const a = ev(node.a, scope, st);
        return a === null || a === undefined || a === false;
      }
      case 'len': {
        const a = ev(node.a, scope, st);
        if (Array.isArray(a) || typeof a === 'string') return a.length;
        throw new ScriptError('# só mede listas e textos', node.line);
      }
      case 'cast': {
        const v = ev(node.a, scope, st);
        if (node.type === 'bool') return truthy(v);
        const n = numberOf(v, node.line);
        return ['int', 'long', 'short', 'char'].includes(node.type) ? Math.trunc(n) : n;
      }
      case 'method':
        return method(node, scope, st);
      case 'not':
        return !truthy(ev(node.a, scope, st));
      case 'neg':
        return -numberOf(ev(node.a, scope, st), node.line);
      case 'and':
        return truthy(ev(node.a, scope, st)) && truthy(ev(node.b, scope, st));
      case 'or':
        return truthy(ev(node.a, scope, st)) || truthy(ev(node.b, scope, st));
      case 'cond':
        return truthy(ev(node.test, scope, st)) ? ev(node.a, scope, st) : ev(node.b, scope, st);
      case 'bin': {
        const a = ev(node.a, scope, st);
        const b = ev(node.b, scope, st);
        switch (node.op) {
          case '+':
            if (typeof a === 'string' || typeof b === 'string') return format(a) + format(b);
            return numberOf(a, node.line) + numberOf(b, node.line);
          case '-':
            return numberOf(a, node.line) - numberOf(b, node.line);
          case '*':
            return numberOf(a, node.line) * numberOf(b, node.line);
          case '/':
            return divide(numberOf(a, node.line), numberOf(b, node.line), node.line);
          case '%':
          case 'mod': {
            const d = numberOf(b, node.line);
            if (d === 0) throw new ScriptError('resto de divisão por zero', node.line);
            return numberOf(a, node.line) % d;
          }
          case 'div':
            return Math.trunc(divide(numberOf(a, node.line), numberOf(b, node.line), node.line));
          case '..':
            return format(a) + format(b);
          case '^':
            return numberOf(a, node.line) ** numberOf(b, node.line);
          case 'fdiv':
            return Math.floor(divide(numberOf(a, node.line), numberOf(b, node.line), node.line));
          case '==':
            return equals(a, b);
          case '!=':
            return !equals(a, b);
          case '<':
            return typeof a === 'string' && typeof b === 'string' ? a < b : numberOf(a, node.line) < numberOf(b, node.line);
          case '>':
            return typeof a === 'string' && typeof b === 'string' ? a > b : numberOf(a, node.line) > numberOf(b, node.line);
          case '<=':
            return numberOf(a, node.line) <= numberOf(b, node.line);
          case '>=':
            return numberOf(a, node.line) >= numberOf(b, node.line);
        }
        throw new ScriptError(`operador desconhecido ${node.op}`, node.line);
      }
      case 'call':
        return call(node, scope, st);
    }
    throw new ScriptError('expressão desconhecida', node.line);
  }

  function method(node, scope, st) {
    const obj = ev(node.obj, scope, st);
    const args = node.args.map((x) => ev(x, scope, st));
    const name = node.name;
    if (Array.isArray(obj)) {
      if (name === 'push_back' || name === 'emplace_back' || name === 'insert_last') return obj.push(...args), undefined;
      if (name === 'pop_back') return obj.pop(), undefined;
      if (name === 'size' || name === 'length') return obj.length;
      if (name === 'empty') return obj.length === 0;
      if (name === 'clear') return (obj.length = 0), undefined;
      if (name === 'at') {
        const i = Math.floor(numberOf(args[0], node.line));
        if (i < 0 || i >= obj.length) throw new ScriptError(`posição fora da lista: ${i}`, node.line);
        return obj[i];
      }
      if (name === 'front') return obj[0] ?? null;
      if (name === 'back') return obj[obj.length - 1] ?? null;
    }
    if (typeof obj === 'string') {
      if (name === 'size' || name === 'length' || name === 'len') return obj.length;
      if (name === 'substr' || name === 'sub') return node.args.length > 1 ? obj.substr(numberOf(args[0], node.line) - (name === 'sub' ? 1 : 0), name === 'sub' ? numberOf(args[1], node.line) - numberOf(args[0], node.line) + 1 : numberOf(args[1], node.line)) : obj.slice(numberOf(args[0], node.line) - (name === 'sub' ? 1 : 0));
      if (name === 'upper') return obj.toUpperCase();
      if (name === 'lower') return obj.toLowerCase();
      if (name === 'find') return obj.indexOf(format(args[0]));
      if (name === 'c_str') return obj;
    }
    if (obj && typeof obj === 'object' && st.env.call) {
      const result = st.env.call(name, args, node.line, obj);
      if (result !== NOT_FOUND) return result;
    }
    throw new ScriptError(`não existe o método "${name}" em ${format(obj)}`, node.line);
  }

  function printf(args) {
    let i = 1;
    const text = format(args[0] ?? '').replace(/%(-?\d*)(?:\.(\d+))?([difsgc%])/g, (m, width, precision, kind) => {
      if (kind === '%') return '%';
      const v = args[i++];
      let out;
      if (kind === 'd' || kind === 'i') out = String(Math.trunc(Number(v) || 0));
      else if (kind === 'f') out = (Number(v) || 0).toFixed(precision === undefined ? 6 : Number(precision));
      else if (kind === 'g') out = format(Number(v) || 0);
      else out = format(v);
      const w = Math.abs(Number(width) || 0);
      if (!w) return out;
      if (width.startsWith('-')) return out.padEnd(w);
      if (width.startsWith('0') && kind !== 's') return out.startsWith('-') ? '-' + out.slice(1).padStart(w - 1, '0') : out.padStart(w, '0');
      return out.padStart(w);
    });
    return text;
  }

  function call(node, scope, st) {
    const args = node.args.map((x) => ev(x, scope, st));
    if (node.name === '__cout') {
      const text = args.map(format).join('');
      st.cout = (st.cout || '') + text;
      const parts = st.cout.split('\n');
      st.cout = parts.pop();
      for (const line of parts) if (st.env.print) st.env.print(line);
      return undefined;
    }
    if (node.name === 'printf') {
      const text = printf(args);
      for (const line of text.replace(/\n$/, '').split('\n')) if (st.env.print) st.env.print(line);
      return undefined;
    }
    if (node.name === 'tostring') return format(args[0]);
    if (node.name === 'tonumber') return typeof args[0] === 'number' ? args[0] : Number.isFinite(Number(args[0])) ? Number(args[0]) : null;
    if (node.name === 'to_string' || node.name === 'std_to_string') return format(args[0]);
    if (node.name === 'stoi') return Math.trunc(numberOf(args[0], node.line));
    if (node.name === 'stof' || node.name === 'stod') return numberOf(args[0], node.line);
    const fn = st.functions[node.name];
    if (fn) {
      if (++st.depth > DEPTH) throw new ScriptError(`chamadas demais dentro de chamadas (${DEPTH})`, node.line);
      const inner = new Map();
      fn.params.forEach((name, i) => inner.set(name, i < args.length ? args[i] : 0));
      inner.set('argument_count', args.length);
      try {
        exec(fn.body, inner, st);
      } catch (e) {
        if (e instanceof Return) return e.value;
        if (e === BREAK || e === CONTINUE) return undefined;
        throw e;
      } finally {
        st.depth--;
      }
      return undefined;
    }
    if (node.name === 'print' || node.name === 'show_debug_message') {
      const text = args.map(format).join(' ');
      if (st.env.print) st.env.print(text);
      return undefined;
    }
    if (node.name === 'random') return (st.env.random || Math.random)() * numberOf(args[0] ?? 1, node.line);
    if (node.name === 'irandom') return Math.floor((st.env.random || Math.random)() * (Math.floor(numberOf(args[0] ?? 1, node.line)) + 1));
    if (node.name === 'random_range') {
      const lo = numberOf(args[0], node.line);
      return lo + (st.env.random || Math.random)() * (numberOf(args[1], node.line) - lo);
    }
    if (node.name === 'irandom_range') {
      const lo = Math.ceil(numberOf(args[0], node.line));
      const hi = Math.floor(numberOf(args[1], node.line));
      return lo + Math.floor((st.env.random || Math.random)() * (hi - lo + 1));
    }
    if (node.name === 'choose') return args.length ? args[Math.floor((st.env.random || Math.random)() * args.length)] : 0;
    if (node.name === 'variable_exists') return st.env.self ? st.env.has?.(st.env.self, format(args[0])) ?? false : scope.has(format(args[0]));
    const math = MATH[node.name];
    if (math) {
      try {
        return math(args);
      } catch (e) {
        if (e.script) throw new ScriptError(e.message, node.line);
        throw e;
      }
    }
    if (st.env.call) {
      let result;
      try {
        result = st.env.call(node.name, args, node.line);
      } catch (e) {
        if (e.script) throw e;
        throw new ScriptError(e.message, node.line);
      }
      if (result !== NOT_FOUND) return result;
    }
    throw new ScriptError(`função desconhecida "${node.name}"`, node.line);
  }

  function store(target, value, scope, st) {
    if (target.k === 'id') {
      if (scope.has(target.name)) scope.set(target.name, scope.ints?.has(target.name) && typeof value === 'number' ? Math.trunc(value) : value);
      else if (st.env.self) st.env.set(st.env.self, target.name, value);
      else if (st.env.globals?.has(target.name)) st.env.globals.set(target.name, value);
      else scope.set(target.name, value);
      return;
    }
    if (target.k === 'member') {
      if (target.obj.k === 'global') {
        if (!st.env.globals) throw new ScriptError('não há variáveis globais aqui', target.line);
        st.env.globals.set(target.name, value);
        return;
      }
      const obj = ev(target.obj, scope, st);
      if (obj === null || obj === undefined) throw new ScriptError(`noone não tem "${target.name}"`, target.line);
      if (typeof obj !== 'object' || Array.isArray(obj) || !st.env.set) throw new ScriptError(`não dá para mudar "${target.name}" em ${format(obj)}`, target.line);
      st.env.set(obj, target.name, value);
      return;
    }
    const arr = ev(target.obj, scope, st);
    const i = Math.floor(numberOf(ev(target.index, scope, st), target.line)) - (target.base || 0);
    if (!Array.isArray(arr)) throw new ScriptError('só dá para usar [ ] numa lista', target.line);
    if (i < 0 || i > 100000) throw new ScriptError(`posição fora da lista: ${i}`, target.line);
    while (arr.length < i) arr.push(0);
    arr[i] = value;
  }

  return { LANGS, NOT_FOUND, ScriptError, tokenize, parse, compile, check, run, library, format, truthy, MATH };
}
