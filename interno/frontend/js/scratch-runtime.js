/**
 * scratch-runtime.js — Ejecutor de la máquina de estados AOT (SillyQuiz Builder v3.0)
 *
 * Consume el JSON producido por ScratchAOT.compile() y lo ejecuta de forma
 * determinista y segura:
 *   - Control de flujo: if_then, if_then_else, repeat_times, repeat_until,
 *     try_catch_fallback, break_stack.
 *   - Kill switch global (global_panic_reset / runtime.panic()).
 *   - Visual Stepper: callbacks onBlockStart / onBlockEnd / onError para resaltar
 *     el bloque activo en vivo (#block-console).
 *   - Providers inyectables: reporter / boolean / sideEffect (el backend real
 *     conecta la lógica de juego; aquí hay defaults seguros para testing).
 *   - Performance monitoring: mide tiempo de ejecución por bloque y global.
 *   - Error boundaries: captura errores sin detener el show.
 *
 * Sin dependencias de DOM. Expone window.ScratchRuntime y module.exports.
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks
    || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);

  const MAX_STEPS = 2000000;
  const PERF_LOG_THRESHOLD_MS = 50;

  class BlockError extends Error {
    constructor(opcode, message) {
      super(message);
      this.opcode = opcode;
      this.name = 'BlockError';
    }
  }
  class BreakSignal extends Error {
    constructor() { super('break'); this.name = 'BreakSignal'; }
  }
  class ContinueSignal extends Error {
    constructor() { super('continue'); this.name = 'ContinueSignal'; }
  }

  function truthy(v) {
    return v === true || v === 1 || v === 'true' || v === '1';
  }

  function toNum(v, d) {
    if (v === '' || v == null || isNaN(Number(v))) return (d || 0);
    return Number(v);
  }

  function _rankOf(ctx, score) {
    const s = toNum(score);
    let rank = 1;
    Object.keys(ctx.state || {}).forEach(k => {
      if (k.indexOf('score_') === 0 && toNum(ctx.state[k]) > s) rank++;
    });
    return rank;
  }

  class ScratchRuntime {
    constructor(opts) {
      opts = opts || {};
      this.providers = opts.providers || ScratchRuntime.defaultProviders();
      this.hooks = opts.hooks || {};
      this.state = opts.state || {};
      this.killed = false;
      this.activeCount = 0;
      this._delayQueue = [];
      this._isPaused = false;
      this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
    }

    panic() {
      this.killed = true;
      if (this.hooks.onPanic) this.hooks.onPanic();
    }

    reset() {
      this.killed = false;
      this.activeCount = 0;
      this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
    }

    getMetrics() {
      return { ...this._perfMetrics };
    }

    /* Conecta una fuente de eventos del Game Engine (WebSocket al sync_server).
       La fuente debe tener .on(eventName, handler) y .off(eventName, handler).
       Cuando emite 'engine_event' con { eventKey, payload }, dispara el Hat
       engine_on_client_event filtrando por eventKey. */
    attachEngineEventSource(source) {
      this._engineEventSource = source;
      const self = this;
      source.on('engine_event', (data) => {
        if (!data || !data.eventKey) return;
        // Busca scripts que tengan el Hat engine_on_client_event con ese eventKey
        const scripts = self._engineScripts || {};
        const chain = scripts['engine_on_client_event'];
        if (Array.isArray(chain) && chain.length) {
          self.start('engine_on_client_event', scripts, {
            eventKey: data.eventKey,
            payload: data.payload || {},
            clientId: data.clientId,
            metric: data.metric,
            value: data.value,
          });
        }
      });
    }

    detachEngineEventSource() {
      if (this._engineEventSource) {
        this._engineEventSource.off('engine_event');
        this._engineEventSource = null;
      }
    }

    /* Guarda referencia a los scripts compilados para que attachEngineEventSource
       pueda acceder a la cadena del Hat engine_on_client_event. */
    setEngineScripts(scripts) {
      this._engineScripts = scripts;
    }

    /* Ejecuta la cadena de un evento Hat. ctx adicional (p.ej. player_id).
     * Retorna una Promise que se resuelve cuando la cadena completa termina
     * (incluyendo delays de wait_seconds). */
    start(eventOpcode, scripts, eventCtx) {
      const chain = scripts && scripts[eventOpcode];
      if (!Array.isArray(chain)) return Promise.resolve();
      const ctx = {
        state: this.state,
        eventCtx: eventCtx || {},
        runtime: this,
        killedRef: this
      };
      ctx.runtime.steps = 0;
      return this.executeChain(chain, ctx);
    }

    /* Recorrido ITERATIVO con cola explícita (sin recursión -> sin stack overflow
       aunque las cadenas sean enormes o estén profundamente anidadas). Respeta
       el orden asíncrono: cada nodo encola su 'next' y sus cuerpos de contenedor,
       y se drenan en secuencia. */
    executeChain(chain, ctx) {
      if (!Array.isArray(chain)) return Promise.resolve();
      const queue = [];
      chain.forEach(node => queue.push({ node, next: node.next || null }));
      const drain = () => {
        if (ctx.runtime.killed) return Promise.resolve();
        const frame = queue.shift();
        if (!frame) return Promise.resolve();
        return Promise.resolve()
          .then(() => this.runBlock(frame.node, ctx))
          .then(() => {
            if (ctx.runtime.killed) return;
            if (frame.next) queue.unshift({ node: frame.next, next: frame.next.next || null });
            return drain();
          });
      };
      return drain();
    }

    /* Resuelve argumentos: evalúa reporters/booleans anidados a valores concretos. */
    resolveArgs(node, ctx) {
      const def = ScratchBlocks.get(node.opcode);
      const out = {};
      Object.keys(node.args || {}).forEach(tok => {
        const spec = def.args[tok];
        const raw = node.args[tok];
        if (spec && (spec.type === 'reporter' || spec.type === 'boolean') && raw && raw.opcode) {
          out[tok] = this.evalNode(raw, ctx);
        } else {
          out[tok] = raw;
        }
      });
      return out;
    }

    runBlock(node, ctx) {
      const def = ScratchBlocks.get(node.opcode);
      if (!def) {
        this.stepper('error', node, ctx, 'opcode desconocido: ' + node.opcode);
        return Promise.resolve();
      }
      // Presupuesto de ejecución (anti-hang): frena el show si se agota.
      ctx.runtime.steps = (ctx.runtime.steps || 0) + 1;
      if (ctx.runtime.steps > MAX_STEPS) {
        this.panic();
        this.stepper('error', node, ctx, 'presupuesto de ejecución agotado (' + MAX_STEPS + ')');
        return Promise.resolve();
      }
      this.stepper('start', node, ctx);
      const startTime = performance.now();
      try {
        if (def.hasBody) {
          return this.runContainer(node, def, ctx);
        } else if (def.type === 'hat') {
          return Promise.resolve();
        } else {
          const resolved = this.resolveArgs(node, ctx);
          node._resolved = resolved;
          const res = this.providers.sideEffect(node.opcode, resolved, ctx);
          if (res && res.ok === false) {
            this.stepper('error', node, ctx, res.error || 'fallo');
            throw new BlockError(node.opcode, res.error || 'sideEffect falló');
          }
          if (res && res.delay) {
            return new Promise(resolve => setTimeout(resolve, res.delay));
          }
          return Promise.resolve();
        }
      } catch (e) {
        if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
        this.stepper('error', node, ctx, e.message);
        throw e;
      } finally {
        const elapsed = performance.now() - startTime;
        this._perfMetrics.blocks++;
        this._perfMetrics.totalTime += elapsed;
        if (elapsed > PERF_LOG_THRESHOLD_MS) {
          this._perfMetrics.slowBlocks.push({ opcode: node.opcode, ms: elapsed });
          if (this._perfMetrics.slowBlocks.length > 50) this._perfMetrics.slowBlocks.shift();
        }
        this.stepper('end', node, ctx);
      }
    }

    runContainer(node, def, ctx) {
      const a = this.resolveArgs(node, ctx);
      node._resolved = a;
      switch (node.opcode) {
        case 'if_then':
          if (truthy(a.COND)) return this.executeChain(node.body, ctx);
          return Promise.resolve();
        case 'if_then_else':
          if (truthy(a.COND)) return this.executeChain(node.body, ctx);
          else return this.executeChain(node.elseBody, ctx);
        case 'repeat_times': {
          const n = Math.max(0, Math.floor(Number(a.N) || 0));
          let chain = [];
          for (let i = 0; i < n && !ctx.runtime.killed; i++) chain.push(node.body);
          return this.executeChain(chain, ctx);
        }
        case 'repeat_until': {
          const body = node.body;
          const cond = () => truthy(a.COND);
          const step = () => {
            if (cond() || ctx.runtime.killed || ctx.runtime.steps > MAX_STEPS) return Promise.resolve();
            return this.executeChain(body, ctx).then(step);
          };
          return step();
        }
        case 'for_each_in_list': {
          const list = ctx.state['list_' + a.NAME];
          if (!Array.isArray(list)) return Promise.resolve();
          const chains = [];
          for (let i = 0; i < list.length && !ctx.runtime.killed; i++) {
            ctx.state['var_' + a.VAR] = list[i];
            chains.push(node.body);
          }
          return this.executeChain(chains, ctx);
        }
        case 'repeat_for_range': {
          const from = Math.floor(toNum(a.FROM, 0));
          const to = Math.floor(toNum(a.TO, 0));
          const step = toNum(a.STEP, 1) || 1;
          const chains = [];
          if (step > 0) {
            for (let v = from; v <= to && !ctx.runtime.killed; v += step) {
              ctx.state['var_' + a.VAR] = v;
              chains.push(node.body);
            }
          } else {
            for (let v = from; v >= to && !ctx.runtime.killed; v += step) {
              ctx.state['var_' + a.VAR] = v;
              chains.push(node.body);
            }
          }
          return this.executeChain(chains, ctx);
        }
        case 'try_catch_fallback':
          return this.executeChain(node.body, ctx).catch(e => {
            if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
            this.stepper('catch', node, ctx, e.message);
            return this.executeChain(node.fallback, ctx);
          });
        default:
          return Promise.resolve();
      }
    }

    /* Evalúa un nodo reporter/boolean (o devuelve valor literal). */
    evalNode(v, ctx) {
      if (v && v.opcode) {
        const def = ScratchBlocks.get(v.opcode);
        const resolved = this.resolveArgs(v, ctx);
        if (def.type === 'boolean') {
          return truthy(this.providers.boolean(v.opcode, resolved, ctx));
        }
        return this.providers.reporter(v.opcode, resolved, ctx);
      }
      return v;
    }

    stepper(phase, node, ctx, msg) {
      const h = this.hooks;
      if (phase === 'start' && h.onBlockStart) h.onBlockStart(node, ctx);
      else if (phase === 'end' && h.onBlockEnd) h.onBlockEnd(node, ctx);
      else if ((phase === 'error' || phase === 'catch') && h.onError) h.onError(node, phase, msg, ctx);
    }
  }

  /* ===================================================================
   * PROVIDERS POR DEFECTO (seguros para testing / sin backend)
   * El backend real sobreescribe reporter/boolean/sideEffect con la lógica
   * de juego, NDI, displays y estado persistente.
   * =================================================================== */
  ScratchRuntime.defaultProviders = function () {
    const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? (d || 0) : Number(v));
    // Estado de juego local (RAM del runtime). La vía de red server-authoritative
    // (Flask -> sync_server) es el equivalente en producción.
    const game = { sessions: {}, sprites: {}, leaderboards: {} };
    return {
      reporter(opcode, args, ctx) {
        switch (opcode) {
          case 'math_calc': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === '+') return A + B;
            if (args.OP === '-') return A - B;
            if (args.OP === '*') return A * B;
            if (args.OP === '÷') return B === 0 ? 0 : A / B;
            return 0;
          }
          case 'get_random_number':
            return Math.floor(Math.random() * (num(args.MAX) - num(args.MIN) + 1)) + num(args.MIN);
          case 'math_unary': {
            const x = num(args.A);
            switch (args.OP) {
              case 'sqrt': return Math.sqrt(x);
              case 'abs': return Math.abs(x);
              case 'round': return Math.round(x);
              case 'floor': return Math.floor(x);
              case 'ceil': return Math.ceil(x);
              case 'sin': return Math.sin(x);
              case 'cos': return Math.cos(x);
              case 'tan': return Math.tan(x);
              case 'ln': return Math.log(x);
              case 'log10': return Math.log10(x);
              default: return x;
            }
          }
          case 'math_binary': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === 'pow') return Math.pow(A, B);
            if (args.OP === 'mod') return B === 0 ? 0 : A % B;
            if (args.OP === 'min') return Math.min(A, B);
            if (args.OP === 'max') return Math.max(A, B);
            return 0;
          }
          case 'string_length': return String(args.TXT || '').length;
          case 'string_case': {
            const s = String(args.TXT || '');
            if (args.OP === 'upper') return s.toUpperCase();
            if (args.OP === 'lower') return s.toLowerCase();
            if (args.OP === 'title') return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
            return s;
          }
          case 'string_replace': return String(args.TXT || '').split(String(args.OLD || '')).join(String(args.NEW || ''));
          case 'string_slice': {
            const s = String(args.TXT || '');
            const start = num(args.START, 0);
            const end = num(args.END, -1);
            return end < 0 ? s.slice(start) : s.slice(start, end);
          }
          case 'engine_get_leaderboard_data': {
            const sid = ctx.state['__active_session'];
            const metric = args.METRIC || 'kills';
            const sess = (ctx.runtime._gameSessions || {})[sid];
            if (!sess) return { leaderboard: [] };
            // Construye el ranking desde state['player_<cid>_kills'] estilo AOT.
            const board = [];
            sess.players.forEach(cid => {
              const k = 'player_' + cid + '_' + metric;
              board.push({ client_id: cid, value: num(ctx.state[k]) });
            });
            board.sort((a, b) => b.value - a.value);
            return { leaderboard: board };
          }
          case 'list_index_of': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l)) return 0;
            const idx = l.indexOf(args.VAL);
            return idx < 0 ? 0 : idx + 1;
          }
          case 'list_get_random_item': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l) || !l.length) return '';
            return l[Math.floor(Math.random() * l.length)];
          }
          case 'list_join': {
            const l = ctx.state['list_' + args.NAME];
            return Array.isArray(l) ? l.join(String(args.SEP == null ? ', ' : args.SEP)) : '';
          }
          case 'list_count': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l)) return 0;
            return l.filter(x => x === args.VAL).length;
          }
          case 'quiz_get_score': return num(ctx.state['score_' + args.PLAYER]);
          case 'quiz_get_player_rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
          case 'quiz_get_question_category': return 'mixed';
          case 'quiz_get_option_count': return 4;
          case 'players_get_points': return num(ctx.state['score_' + args.PLAYER]);
          case 'players_get_count': return num(ctx.state['player_count'], 0);
          case 'players_get_all_names': return JSON.stringify(['Jugador 1', 'Jugador 2']);
          case 'players_get_rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
          case 'players_get_var': return ctx.state['player_' + args.PLAYER + '_' + args.VAR];
          case 'state_get_persistent': return ctx.state['persist_' + args.KEY];
          // Power Pack 2 — reporters
          case 'get_timer_remaining': return num(ctx.state['timer_remaining'], 0);
          case 'quiz_get_correct_option': return 1;
          case 'quiz_get_question_image': return '(img)';
          case 'quiz_get_difficulty': return 'media';
          case 'quiz_get_total_questions': return num(ctx.state['total_questions'], 0);
          case 'players_get_top_n': return JSON.stringify(['Jugador 1', 'Jugador 2', 'Jugador 3'].slice(0, Math.max(1, num(args.N, 3))));
          case 'list_pop': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) && l.length ? l.pop() : ''; }
          case 'list_to_json': { const l = ctx.state['list_' + args.NAME]; return JSON.stringify(Array.isArray(l) ? l : []); }
          case 'string_trim': return String(args.TXT || '').trim();
          case 'string_repeat': { const s = String(args.TXT || ''); const n = Math.max(0, Math.floor(num(args.N, 1))); let o = ''; for (let i = 0; i < n; i++) o += s; return o; }
          case 'string_split': { const s = String(args.TXT || ''); const sep = args.SEP === '' || args.SEP == null ? ',' : args.SEP; return JSON.stringify(s.split(sep)); }
          case 'string_to_number': { const n = Number(args.TXT); return isNaN(n) ? 0 : n; }
          case 'math_const': { if (args.C === 'E') return Math.E; if (args.C === 'TAU') return Math.PI * 2; if (args.C === 'PHI') return 1.618033988749895; return Math.PI; }
          case 'math_round_to': { const f = Math.pow(10, Math.max(0, Math.floor(num(args.DEC, 2)))); return Math.round(num(args.A) * f) / f; }
          case 'json_parse': { try { return JSON.parse(args.S || 'null'); } catch (e) { return null; } }
          case 'json_stringify': { try { return JSON.stringify(args.V); } catch (e) { return '""'; } }
          case 'get_timestamp': return (typeof Date !== 'undefined') ? Date.now() : 0;
          case 'get_current_time': {
            const d = new Date();
            const p = n => String(n).padStart(2, '0');
            if (args.FMT === 'HH:MM') return p(d.getHours()) + ':' + p(d.getMinutes());
            if (args.FMT === 'DD/MM') return p(d.getDate()) + '/' + p(d.getMonth() + 1);
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
          }
          case 'random_choice': { const l = ctx.state['list_' + args.NAME]; if (!Array.isArray(l) || !l.length) return ''; return l[Math.floor(Math.random() * l.length)]; }
          case 'string_join':
            return String(args.A == null ? '' : args.A) + String(args.B == null ? '' : args.B);
          case 'parse_json_key':
            try { return JSON.parse(args.J || '{}')[args.K]; } catch (e) { return null; }
          case 'state_get_memory_value':
            return ctx.state[args.KEY];
          case 'quiz_get_current_question_text': return '(pregunta)';
          case 'quiz_get_answer_text': return '(respuesta ' + args.OPT + ')';
          case 'quiz_get_leaderboard_json': return '{}';
          case 'get_ndi_latency': return 12;
          case 'players_get_name': return 'Jugador';
          case 'players_get_fastest_buzzer': return 'p1';
          case 'db_query_get_unanswered_count': return 10;
          case 'db_query_search_by_keyword': return 1;
          case 'db_query_get_hint_text': return '(pista)';
          case 'list_get_item_at': return '';
          case 'list_get_length': return 0;
          case 'list_get_item': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? (l[num(args.IDX) - 1] || '') : ''; }
          case 'list_length': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? l.length : 0; }
          case 'get_display_connection_count': return 1;
          case 'variable_get': return ctx.state['var_' + args.VAR];
          case 'get_x': return 0;
          case 'get_y': return 0;
          case 'get_answer': return '';
          case 'mouse_x': return 0;
          case 'mouse_y': return 0;
          default: return null;
        }
      },
      boolean(opcode, args, ctx) {
        switch (opcode) {
          case 'logic_compare': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === '==') return A === B;
            if (args.OP === '>') return A > B;
            if (args.OP === '<') return A < B;
            return false;
          }
          case 'logic_and_or': {
            const r = args.OP === 'AND' ? (truthy(args.A) && truthy(args.B)) : (truthy(args.A) || truthy(args.B));
            return r;
          }
          case 'logic_not': return !truthy(args.A);
          case 'logic_xor': return truthy(args.A) !== truthy(args.B);
          case 'logic_between': {
            const v = num(args.VAL), lo = num(args.MIN), hi = num(args.MAX);
            return v >= lo && v <= hi;
          }
          case 'string_contains':
            return String(args.TXT || '').indexOf(String(args.SUB || '')) >= 0;
          case 'string_starts_with':
            return String(args.TXT || '').indexOf(String(args.SUB || '')) === 0;
          case 'string_ends_with':
            return String(args.TXT || '').lastIndexOf(String(args.SUB || '')) === (String(args.TXT || '').length - String(args.SUB || '').length);
          case 'string_matches': {
            try { return new RegExp(String(args.PAT || '')).test(String(args.TXT || '')); } catch (e) { return false; }
          }
          case 'is_ndi_source_online': return false;
          case 'players_is_alive': return true;
          case 'key_pressed': return false;
          case 'list_contains': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) && l.indexOf(args.VAL) >= 0; }
          default: return false;
        }
      },
      sideEffect(opcode, args, ctx) {
        // ---- Local Game Engine (RAM local del runtime) ----
        if (opcode === 'engine_create_player_client') {
          const base = args.BASE || 'persona';
          const n = num(args.SLOTS, 4);
          const players = [];
          for (let i = 1; i <= n; i++) players.push(base + i);
          ctx.runtime._gameSessions = ctx.runtime._gameSessions || {};
          const sid = 'local_' + (args.BASE || 'persona');
          ctx.runtime._gameSessions[sid] = { players: players, template: null };
          ctx.state['__active_session'] = sid;
          return { ok: true, players: players };
        }
        if (opcode === 'engine_load_game_template') {
          const sid = ctx.state['__active_session'];
          if (sid && ctx.runtime._gameSessions) ctx.runtime._gameSessions[sid].template = args.TPL;
          return { ok: true };
        }
        if (opcode === 'render_update_proyector_leaderboard') {
          // json_data puede ser reporter engine_get_leaderboard_data o un objeto.
          const data = args.JSON && args.JSON.leaderboard ? args.JSON : (args.JSON || null);
          if (data && Array.isArray(data.leaderboard)) {
            ctx.state['leaderboard_' + (args.COMP || 'ranking')] = data.leaderboard;
          }
          return { ok: true };
        }
        // ---- Engine Sprites (Canvas 2D local) ----
        if (opcode === 'sprite_spawn') {
          ctx.state.__sprites = ctx.state.__sprites || {};
          ctx.state.__sprites[args.SID] = { asset: args.ASSET, x: num(args.X), y: num(args.Y), vx: 0, vy: 0, anim: null };
          return { ok: true };
        }
        if (opcode === 'sprite_destroy') {
          if (ctx.state.__sprites) delete ctx.state.__sprites[args.SID];
          return { ok: true };
        }
        if (opcode === 'sprite_set_animation') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) ctx.state.__sprites[args.SID].anim = args.ANIM;
          return { ok: true };
        }
        if (opcode === 'sprite_move_to') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) {
            const s = ctx.state.__sprites[args.SID];
            s.x = num(args.TX); s.y = num(args.TY); s.motionMs = num(args.MS); s.ease = args.EASE;
          }
          return { ok: true };
        }
        if (opcode === 'sprite_set_velocity') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) {
            const s = ctx.state.__sprites[args.SID];
            s.vx = num(args.VX); s.vy = num(args.VY);
          }
          return { ok: true };
        }
        // Estado en RAM (seguro, instantáneo)
        if (opcode === 'state_set_memory') { ctx.state[args.KEY] = args.VAL; return { ok: true }; }
        if (opcode === 'state_init_memory_key') { if (!(args.KEY in ctx.state)) ctx.state[args.KEY] = args.DEF; return { ok: true }; }
        if (opcode === 'state_increment_memory') { ctx.state[args.KEY] = num(ctx.state[args.KEY]) + num(args.BY); return { ok: true }; }
        if (opcode === 'state_commit_to_sqlite') { return { ok: true }; }
        if (opcode === 'state_clear_volatile_cache') { ctx.state = {}; return { ok: true }; }
        // Quiz
        if (opcode === 'quiz_add_score_to_player') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
        if (opcode === 'quiz_verify_player_answer') { return { ok: true }; }
        if (opcode === 'quiz_lock_answers') { return { ok: true }; }
        if (opcode === 'quiz_fetch_next_question') { return { ok: true }; }
        if (opcode === 'quiz_init_engine') { return { ok: true }; }
        // Players
        if (opcode === 'players_strike_penalize' || opcode === 'players_toggle_lockout' ||
            opcode === 'players_set_active_slots' || opcode === 'players_swap_positions' ||
            opcode === 'players_set_avatar') { return { ok: true }; }
        if (opcode === 'players_set_var') { ctx.state['player_' + args.PLAYER + '_' + args.VAR] = args.VAL; return { ok: true }; }
        if (opcode === 'players_send_message') { return { ok: true, message: args.MSG, target: args.PLAYER }; }
        if (opcode === 'players_show_effect') { return { ok: true, effect: args.EFFECT, target: args.PLAYER }; }
        // DB
        if (opcode === 'db_query_filter_difficulty' || opcode === 'db_query_exclude_last_questions' ||
            opcode === 'db_query_mark_as_burned' || opcode === 'db_query_shuffle_answers') { return { ok: true }; }
        // NDI / displays / looks / audio / movement / effects
        if (opcode.indexOf('ndi_') === 0 || opcode.indexOf('display_') === 0 ||
            opcode.indexOf('set_') === 0 || opcode.indexOf('play_') === 0 ||
            opcode.indexOf('hide_') === 0 || opcode.indexOf('show_') === 0 ||
            opcode.indexOf('trigger_') === 0 || opcode.indexOf('inject_') === 0 ||
            opcode.indexOf('spawn_') === 0 || opcode.indexOf('toggle_') === 0 ||
            opcode.indexOf('clear_') === 0 || opcode === 'stop_all_sounds' ||
            opcode.indexOf('stop_bg_') === 0 ||
            opcode === 'go_to_xy' || opcode === 'glide_to_xy' ||
            opcode === 'change_x' || opcode === 'change_y' ||
            opcode === 'set_x' || opcode === 'set_y' ||
            opcode === 'say' || opcode === 'think' ||
            opcode === 'change_size' || opcode === 'set_size' ||
            opcode === 'change_color_effect' ||
            opcode === 'create_clone' || opcode === 'delete_clone' ||
            opcode === 'ask_and_wait' ||
            opcode === 'broadcast' || opcode === 'broadcast_and_wait') { return { ok: true }; }
        // Variables
        if (opcode === 'variable_set') { ctx.state['var_' + args.VAR] = args.VAL; return { ok: true }; }
        if (opcode === 'variable_change') { ctx.state['var_' + args.VAR] = num(ctx.state['var_' + args.VAR]) + num(args.VAL); return { ok: true }; }
        // Listas Pro
        if (opcode === 'list_set_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l[num(args.IDX) - 1] = args.VAL; return { ok: true }; }
        if (opcode === 'list_shuffle') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = l[i]; l[i] = l[j]; l[j] = t; } } return { ok: true }; }
        if (opcode === 'list_sort') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.sort((a, b) => args.OP === 'desc' ? (b > a ? 1 : -1) : (a > b ? 1 : -1)); return { ok: true }; }
        // Control avanzado
        if (opcode === 'exit_loop') { throw new BreakSignal(); }
        if (opcode === 'continue_loop') { throw new ContinueSignal(); }
        // Quiz Pro
        if (opcode === 'quiz_set_question') { ctx.state['current_question'] = args.TXT; return { ok: true }; }
        if (opcode === 'quiz_reveal_answer') { ctx.state['answer_revealed'] = true; return { ok: true }; }
        if (opcode === 'quiz_reset_scores') { Object.keys(ctx.state).forEach(k => { if (k.indexOf('score_') === 0) delete ctx.state[k]; }); return { ok: true }; }
        if (opcode === 'quiz_shuffle_options') { return { ok: true }; }
        // Concursantes Pro
        if (opcode === 'players_eliminate') { ctx.state['alive_' + args.PLAYER] = false; return { ok: true }; }
        if (opcode === 'players_revive') { ctx.state['alive_' + args.PLAYER] = true; return { ok: true }; }
        // Estado persistente
        if (opcode === 'state_set_persistent') { ctx.state['persist_' + args.KEY] = args.VAL; return { ok: true }; }
        if (opcode === 'state_load_persistent') { ctx.state['var_' + (args.RAMKEY || args.KEY)] = ctx.state['persist_' + args.KEY]; return { ok: true }; }
        // Looks / Efectos Pro
        if (opcode.indexOf('screen_') === 0 || opcode === 'announce' || opcode === 'display_set_timer') { return { ok: true }; }
        // Audio / Runtime Pro
        if (opcode === 'play_sfx_by_name') { return { ok: true }; }
        if (opcode === 'set_master_volume') { ctx.state['master_volume'] = num(args.VOL, 100); return { ok: true }; }
        if (opcode === 'runtime_debug_log') { if (typeof console !== 'undefined') console.log('[builder]', args.MSG); return { ok: true }; }
        if (opcode === 'runtime_export_json') { if (typeof console !== 'undefined') console.log('[builder:export]', JSON.stringify(ctx.state)); return { ok: true }; }
        // Power Pack 2 — sideEffects
        if (opcode === 'set_timer_duration') { ctx.state['timer_remaining'] = num(args.SEC, 30); return { ok: true }; }
        if (opcode === 'timer_pause' || opcode === 'timer_resume') { return { ok: true }; }
        if (opcode === 'players_sort_by_score') { return { ok: true }; }
        if (opcode === 'players_award_bonus') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
        if (opcode === 'list_reverse') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.reverse(); return { ok: true }; }
        if (opcode === 'list_unique') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { const seen = {}; ctx.state['list_' + args.NAME] = l.filter(x => { const k = JSON.stringify(x); if (seen[k]) return false; seen[k] = 1; return true; }); } return { ok: true }; }
        // Listas
        if (opcode === 'list_create') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
        if (opcode === 'list_add_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.push(args.VAL); return { ok: true }; }
        if (opcode === 'list_delete_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 1); return { ok: true }; }
        if (opcode === 'list_insert_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 0, args.VAL); return { ok: true }; }
        if (opcode === 'list_delete_all') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
        // Runtime / sistema
        if (opcode === 'runtime_snapshot_take') { ctx.runtime._snapshot = JSON.parse(JSON.stringify(ctx.state)); return { ok: true }; }
        if (opcode === 'runtime_hot_reload') { return { ok: true }; }
        if (opcode === 'system_replicate_state_to_node') { return { ok: true }; }
        if (opcode === 'global_panic_reset') { ctx.runtime.panic(); return { ok: true }; }
        if (opcode === 'break_stack') { throw new BreakSignal(); }
        if (opcode === 'wait_seconds') {
          const sec = num(args.SEC, 1);
          return { ok: true, delay: Math.max(0, Math.min(sec * 1000, 30000)) };
        }
        if (opcode === 'wait_until_timestamp') { return { ok: true }; }
        return { ok: true };
      }
    };
  };

  ScratchRuntime.BlockError = BlockError;
  ScratchRuntime.BreakSignal = BreakSignal;
  ScratchRuntime.ContinueSignal = ContinueSignal;

  global.ScratchRuntime = ScratchRuntime;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScratchRuntime, BlockError, BreakSignal };
  }
})(typeof window !== 'undefined' ? window : this);
