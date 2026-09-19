/**
 * sandbox-worker.js — Sandbox de ejecución (Web Worker, opt-in).
 *
 * Ejecuta programas AOT del SillyBuilder DENTRO de un Web Worker para que un
 * mod mal escrito NO pueda congelar la pestaña principal del navegador.
 *
 * Modelo:
 *   - SOLO cómputo puro y serializable. NO hay acceso a document/window/DOM.
 *   - Caminata de nodos idéntica a scratch-runtime.js para las partes puras
 *     (matemáticas de variables, listas, operadores, cadenas, control de flujo).
 *   - Los efectos secundarios que tocan display/audio/ui/looks/ndi/señal de
 *     red NO se ejecutan aquí: se recogen como `intents` y se devuelven para
 *     que el hilo principal los aplique.
 *   - Guarda dura: presupuesto de nodos + timeout de reloj; si se excede,
 *     lanza y reporta (el hilo principal también hace worker.terminate()).
 *
 * Mensajes de entrada:  { type:'exec', program, initialState, timeoutMs }
 * Mensajes de salida:   { type:'result', state, intents }
 *                        { type:'error', message, code }
 *
 * Sin dependencias externas. No importa scratch-blocks.js (es autocontenido).
 */

'use strict';

/* ===================================================================
 * CONSTANTES DE SEGURIDAD
 * =================================================================== */
const MAX_STEPS = 10000000;

// Opcodes peligrosos: bloqueo duro, igual que el backend (_security.py).
const DANGEROUS_OPCODES = new Set(['execute_raw_javascript', 'inject_css_raw']);

// Opcodes que devuelven booleano (sin meta de def(), los clasificamos aquí).
const BOOLEAN_OPCODES = new Set([
  'logic_compare', 'logic_and_or', 'logic_not', 'logic_xor', 'logic_between',
  'string_contains', 'string_starts_with', 'string_ends_with', 'string_matches',
  'is_ndi_source_online', 'players_is_alive', 'key_pressed', 'list_contains',
  'quiz_is_paused', 'timer_is_paused', 'sprite_is_touching', 'proc_call_boolean'
]);

/* ===================================================================
 * HELPERS (espejo de scratch-runtime.js)
 * =================================================================== */
function truthy(v) { return v === true || v === 1 || v === 'true' || v === '1'; }
function num(v, d) {
  if (v === '' || v == null || isNaN(Number(v))) return (d || 0);
  return Number(v);
}
function _rankOf(ctx, score) {
  const s = num(score);
  let rank = 1;
  Object.keys(ctx.state || {}).forEach(k => {
    if (k.indexOf('score_') === 0 && num(ctx.state[k]) > s) rank++;
  });
  return rank;
}

class BlockError extends Error {
  constructor(opcode, message) { super(message); this.opcode = opcode; this.name = 'BlockError'; }
}
class BreakSignal extends Error { constructor() { super('break'); this.name = 'BreakSignal'; } }
class ContinueSignal extends Error { constructor() { super('continue'); this.name = 'ContinueSignal'; } }
class TimeoutSignal extends Error { constructor(ms) { super('timeout:' + ms); this.name = 'TimeoutSignal'; } }

/* ===================================================================
 * PROVIDERS (subconjunto puro y serializable de scratch-runtime)
 * =================================================================== */
function buildProviders() {
  const reporter = function (opcode, args, ctx) {
    switch (opcode) {
      case 'math': {
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
      case 'score': return num(ctx.state['score_' + args.PLAYER]);
      case 'player_rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
      case 'question_category': return 'mixed';
      case 'option_count': return 4;
      case 'points': return num(ctx.state['score_' + args.PLAYER]);
      case 'count': return num(ctx.state['player_count'], 0);
      case 'all_names': return JSON.stringify(['Jugador 1', 'Jugador 2']);
      case 'rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
      case 'get_var': return ctx.state['player_' + args.PLAYER + '_' + args.VAR];
      case 'state_get_persistent': return ctx.state['persist_' + args.KEY];
      case 'timer_remaining': return num(ctx.state['timer_remaining'], 0);
      case 'correct_option': return 1;
      case 'question_image': return '(img)';
      case 'difficulty': return 'media';
      case 'total_questions': return num(ctx.state['total_questions'], 0);
      case 'top_n': {
        const n = Math.max(1, Math.floor(num(args.N, 3)));
        const scores = ctx.state['player_scores'];
        if (Array.isArray(scores) && scores.length) {
          return JSON.stringify(scores.slice(0, n));
        }
        const names = [];
        for (let i = 1; i <= n; i++) { const nm = ctx.state['player_name_' + i]; names.push(nm != null ? nm : ('Jugador ' + i)); }
        return JSON.stringify(names);
      }
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
      case 'quiz_get_current_question_text': return ctx.state['current_question'] || '(pregunta)';
      case 'quiz_get_answer_text': return ctx.state['answer_' + args.OPT] || '(respuesta ' + args.OPT + ')';
      case 'quiz_get_leaderboard_json': return JSON.stringify(ctx.state['leaderboard'] || []);
      case 'get_ndi_latency': return num(ctx.state['ndi_latency_' + args.SRC], 12);
      case 'name': return ctx.state['player_name_' + args.PLAYER] || args.PLAYER || 'Jugador';
      case 'fastest_buzzer': return ctx.state['fastest_buzzer'] || '';
      case 'db_query_get_unanswered_count': return num(ctx.state['db_unanswered_count'], 10);
      case 'db_query_search_by_keyword': return num(ctx.state['db_search_' + args.KW], 0);
      case 'db_query_get_hint_text': return ctx.state['db_hint_' + args.QID] || '(pista)';
      case 'list_get_item_at': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? (l[num(args.IDX) - 1] || '') : ''; }
      case 'list_get_length': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? l.length : 0; }
      case 'list_get_item': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? (l[num(args.IDX) - 1] || '') : ''; }
      case 'list_length': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? l.length : 0; }
      case 'get_display_connection_count': return 1;
      case 'variable_get': {
        if (ctx.runtime && typeof ctx.runtime._getFromScope === 'function') {
          return ctx.runtime._getFromScope(ctx, 'var_' + args.VAR);
        }
        return ctx.state['var_' + args.VAR];
      }
      case 'get_x': return 0;
      case 'get_y': return 0;
      case 'get_answer': return '';
      case 'mouse_x': return 0;
      case 'mouse_y': return 0;
      case 'math_clamp': {
        const v = num(args.VAL), lo = num(args.MIN), hi = num(args.MAX);
        return Math.max(lo, Math.min(hi, v));
      }
      case 'type_of': {
        const v = args.VAL;
        if (v === null || v === undefined) return 'null';
        if (typeof v === 'number') return 'number';
        if (typeof v === 'string') return 'string';
        if (typeof v === 'boolean') return 'boolean';
        if (Array.isArray(v)) return 'list';
        if (typeof v === 'object') return 'json';
        return 'string';
      }
      case 'math_lerp': {
        const a = num(args.A), b = num(args.B), t = num(args.T);
        return a + (b - a) * Math.max(0, Math.min(1, t));
      }
      case 'quiz_get_round': return num(ctx.state['quiz_round'], 1);
      case 'score': return num(ctx.state['score_' + args.PLAYER]);
      case 'event_data': return ctx.eventCtx || null;
      case 'quiz_get_leaderboard_data': {
        const sid = ctx.state['__active_session'];
        const metric = args.METRIC || 'kills';
        const sess = (ctx.runtime._gameSessions || {})[sid];
        if (!sess) return { leaderboard: [] };
        const board = [];
        sess.players.forEach(cid => {
          const k = 'player_' + cid + '_' + metric;
          board.push({ client_id: cid, value: num(ctx.state[k]) });
        });
        board.sort((a, b) => b.value - a.value);
        return { leaderboard: board };
      }
      default: return null;
    }
  };

  const boolean = function (opcode, args, ctx) {
    switch (opcode) {
      case 'compare': {
        const A = num(args.A), B = num(args.B);
        if (args.OP === '==') return A === B;
        if (args.OP === '!=') return A !== B;
        if (args.OP === '>') return A > B;
        if (args.OP === '<') return A < B;
        if (args.OP === '>=') return A >= B;
        if (args.OP === '<=') return A <= B;
        return false;
      }
      case 'and':
        return truthy(args.A) && truthy(args.B);
      case 'or':
        return truthy(args.A) || truthy(args.B);
      case 'not': return !truthy(args.A);
      case 'xor': return truthy(args.A) !== truthy(args.B);
      case 'between': {
        const v = num(args.VAL), lo = num(args.MIN), hi = num(args.MAX);
        return v >= lo && v <= hi;
      }
      case 'contains':
        return String(args.TXT || '').indexOf(String(args.SUB || '')) >= 0;
      case 'starts_with':
        return String(args.TXT || '').indexOf(String(args.SUB || '')) === 0;
      case 'ends_with':
        return String(args.TXT || '').lastIndexOf(String(args.SUB || '')) === (String(args.TXT || '').length - String(args.SUB || '').length);
      case 'matches':
        try { return new RegExp(String(args.PAT || '')).test(String(args.TXT || '')); } catch (e) { return false; }
      case 'is_ndi_source_online': return false;
      case 'alive': return ctx.state['alive_' + args.PLAYER] !== false;
      case 'key_pressed': return false;
      case 'list_contains': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) && l.indexOf(args.VAL) >= 0; }
      case 'quiz_is_paused': return truthy(ctx.state['quiz_paused']);
      case 'timer_is_paused': return truthy(ctx.state['timer_paused']);
      case 'sprite_is_touching': {
        const sprites = ctx.state.__sprites || {};
        const sa = sprites[args.A], sb = sprites[args.B];
        if (!sa || !sb) return false;
        const dx = (sa.x || 0) - (sb.x || 0), dy = (sa.y || 0) - (sb.y || 0);
        return Math.hypot(dx, dy) < 2;
      }
      default: return false;
    }
  };

  // Side effects que SÓLO mutan el estado serializable: se ejecutan en el worker.
  // Cualquier otro efecto secundario (display/audio/ui/looks/ndi/red) cae al
  // final y se recoge como `intent` (NO se ejecuta aquí).
  const sideEffect = function (opcode, args, ctx) {
    if (DANGEROUS_OPCODES.has(opcode)) {
      return { ok: false, error: 'SECURITY: ' + opcode + ' está bloqueado por razones de seguridad.' };
    }
    // ---- Estado en RAM (seguro, instantáneo, serializable) ----
    if (opcode === 'state_set_memory') { ctx.state[args.KEY] = args.VAL; return { ok: true }; }
    if (opcode === 'state_init_memory_key') { if (!(args.KEY in ctx.state)) ctx.state[args.KEY] = args.DEF; return { ok: true }; }
    if (opcode === 'state_increment_memory') { ctx.state[args.KEY] = num(ctx.state[args.KEY]) + num(args.BY); return { ok: true }; }
    if (opcode === 'state_commit_to_sqlite') { return { ok: true }; }
    if (opcode === 'state_clear_volatile_cache') { ctx.state = {}; return { ok: true }; }
    if (opcode === 'state_set_persistent') { ctx.state['persist_' + args.KEY] = args.VAL; return { ok: true }; }
    if (opcode === 'state_load_persistent') { ctx.state['var_' + (args.RAMKEY || args.KEY)] = ctx.state['persist_' + args.KEY]; return { ok: true }; }
    // ---- Variables ----
    if (opcode === 'variable_set') {
      if (ctx.runtime && typeof ctx.runtime._setInScope === 'function') ctx.runtime._setInScope(ctx, 'var_' + args.VAR, args.VAL);
      else ctx.state['var_' + args.VAR] = args.VAL;
      return { ok: true };
    }
    if (opcode === 'variable_change') {
      if (ctx.runtime && typeof ctx.runtime._getFromScope === 'function' && typeof ctx.runtime._setInScope === 'function') {
        const current = ctx.runtime._getFromScope(ctx, 'var_' + args.VAR) || 0;
        ctx.runtime._setInScope(ctx, 'var_' + args.VAR, num(current) + num(args.VAL));
      } else {
        ctx.state['var_' + args.VAR] = num(ctx.state['var_' + args.VAR]) + num(args.VAL);
      }
      return { ok: true };
    }
    if (opcode === 'variable_init') {
      if (!('var_' + args.VAR in ctx.state)) ctx.state['var_' + args.VAR] = args.DEF;
      return { ok: true };
    }
    // ---- Listas (RAM) ----
    if (opcode === 'list_create') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
    if (opcode === 'list_add_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.push(args.VAL); return { ok: true }; }
    if (opcode === 'list_delete_item' || opcode === 'list_remove_index') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 1); return { ok: true }; }
    if (opcode === 'list_insert_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 0, args.VAL); return { ok: true }; }
    if (opcode === 'list_delete_all') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
    if (opcode === 'list_set_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l[num(args.IDX) - 1] = args.VAL; return { ok: true }; }
    if (opcode === 'list_shuffle') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = l[i]; l[i] = l[j]; l[j] = t; } } return { ok: true }; }
    if (opcode === 'list_sort') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.sort((a, b) => args.OP === 'desc' ? (b > a ? 1 : -1) : (a > b ? 1 : -1)); return { ok: true }; }
    if (opcode === 'list_reverse') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.reverse(); return { ok: true }; }
    if (opcode === 'list_unique') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { const seen = {}; ctx.state['list_' + args.NAME] = l.filter(x => { const k = JSON.stringify(x); if (seen[k]) return false; seen[k] = 1; return true; }); } return { ok: true }; }
    // ---- Quiz ----
    if (opcode === 'add_score') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
    if (opcode === 'verify_answer') { return { ok: true }; }
    if (opcode === 'lock_answers') { return { ok: true }; }
    if (opcode === 'next_question') { return { ok: true }; }
    if (opcode === 'init') { return { ok: true }; }
    if (opcode === 'set_question') { ctx.state['current_question'] = args.TXT; return { ok: true }; }
    if (opcode === 'reveal_answer') { ctx.state['answer_revealed'] = true; return { ok: true }; }
    if (opcode === 'reset_scores') { Object.keys(ctx.state).forEach(k => { if (k.indexOf('score_') === 0) delete ctx.state[k]; }); return { ok: true }; }
    if (opcode === 'shuffle_options') { return { ok: true }; }
    // ---- Players (RAM) ----
    if (opcode === 'set_var') { ctx.state['player_' + args.PLAYER + '_' + args.VAR] = args.VAL; return { ok: true }; }
    if (opcode === 'eliminate') { ctx.state['alive_' + args.PLAYER] = false; return { ok: true }; }
    if (opcode === 'revive') { ctx.state['alive_' + args.PLAYER] = true; return { ok: true }; }
    if (opcode === 'award_bonus') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
    if (opcode === 'sort_scores') { return { ok: true }; }
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
      const data = args.JSON && args.JSON.leaderboard ? args.JSON : (args.JSON || null);
      if (data && Array.isArray(data.leaderboard)) {
        ctx.state['leaderboard_' + (args.COMP || 'ranking')] = data.leaderboard;
      }
      return { ok: true };
    }
    // ---- Temporizadores (RAM) ----
    if (opcode === 'set_timer_duration') { ctx.state['timer_remaining'] = num(args.SEC, 30); return { ok: true }; }
    if (opcode === 'timer_pause' || opcode === 'timer_resume') { return { ok: true }; }
    if (opcode === 'set_master_volume') { ctx.state['master_volume'] = num(args.VOL, 100); return { ok: true }; }
    // ---- Runtime / sistema (RAM) ----
    if (opcode === 'runtime_snapshot_take') { ctx.runtime._snapshot = JSON.parse(JSON.stringify(ctx.state)); return { ok: true }; }
    if (opcode === 'runtime_hot_reload') { return { ok: true }; }
    if (opcode === 'system_replicate_state_to_node') { return { ok: true }; }
    if (opcode === 'runtime_debug_log') { return { ok: true }; }
    if (opcode === 'runtime_export_json') { return { ok: true }; }
    if (opcode === 'panic_reset') { ctx.runtime.killed = true; return { ok: true }; }
    // ---- Sprites (viven en ctx.state.__sprites, serializable) ----
    if (opcode === 'sprite_spawn') {
      ctx.state.__sprites = ctx.state.__sprites || {};
      ctx.state.__sprites[args.SID] = { asset: args.ASSET, x: num(args.X), y: num(args.Y), vx: 0, vy: 0, anim: null };
      return { ok: true };
    }
    if (opcode === 'sprite_destroy') { if (ctx.state.__sprites) delete ctx.state.__sprites[args.SID]; return { ok: true }; }
    if (opcode === 'sprite_set_animation') { if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) ctx.state.__sprites[args.SID].anim = args.ANIM; return { ok: true }; }
    if (opcode === 'sprite_move_to') { if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) { const s = ctx.state.__sprites[args.SID]; s.x = num(args.TX); s.y = num(args.TY); s.motionMs = num(args.MS); s.ease = args.EASE; } return { ok: true }; }
    if (opcode === 'sprite_set_velocity') { if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) { const s = ctx.state.__sprites[args.SID]; s.vx = num(args.VX); s.vy = num(args.VY); } return { ok: true }; }
    // ---- Física (vive en ctx.state.__physics, serializable) ----
    if (opcode === 'physics_enable') {
      ctx.state.__physics = ctx.state.__physics || { world: { gravity: { x: num(args.GX), y: num(args.GY) } }, bodies: {}, stepCount: 0 };
      return { ok: true };
    }
    if (opcode === 'physics_disable') { ctx.state.__physics = null; return { ok: true }; }
    if (opcode === 'physics_create_body') {
      const physics = ctx.state.__physics;
      if (!physics) return { ok: false, error: 'Física no activada. Usa physics_enable primero.' };
      physics.bodies = physics.bodies || {};
      const type = args.TYPE || 'dynamic';
      const mass = type === 'static' ? 0 : 1;
      physics.bodies[args.BID] = { type, mass, x: num(args.X), y: num(args.Y), vx: 0, vy: 0, fx: 0, fy: 0, angle: 0, angularVel: 0, fixtures: [] };
      return { ok: true };
    }
    if (opcode === 'physics_destroy_body') { const physics = ctx.state.__physics; if (physics && physics.bodies) delete physics.bodies[args.BID]; return { ok: true }; }
    if (opcode === 'physics_set_velocity') { const physics = ctx.state.__physics; if (physics && physics.bodies && physics.bodies[args.BID]) { const b = physics.bodies[args.BID]; b.vx = num(args.VX); b.vy = num(args.VY); } return { ok: true }; }
    if (opcode === 'physics_apply_force') {
      const physics = ctx.state.__physics;
      if (physics && physics.bodies && physics.bodies[args.BID]) {
        const b = physics.bodies[args.BID];
        b.fx = (b.fx || 0) + num(args.FX); b.fy = (b.fy || 0) + num(args.FY);
        b.vx = (b.vx || 0) + num(args.FX) / (b.mass || 1) * 0.016;
        b.vy = (b.vy || 0) + num(args.FY) / (b.mass || 1) * 0.016;
      }
      return { ok: true };
    }
    if (opcode === 'physics_apply_impulse') {
      const physics = ctx.state.__physics;
      if (physics && physics.bodies && physics.bodies[args.BID]) {
        const b = physics.bodies[args.BID];
        b.vx = (b.vx || 0) + num(args.IX) / (b.mass || 1);
        b.vy = (b.vy || 0) + num(args.IY) / (b.mass || 1);
      }
      return { ok: true };
    }
    if (opcode === 'physics_set_gravity_scale') {
      const physics = ctx.state.__physics;
      if (physics && physics.bodies && physics.bodies[args.BID]) physics.bodies[args.BID].gravityScale = num(args.SCALE);
      return { ok: true };
    }
    if (opcode === 'physics_create_distance_joint') {
      const physics = ctx.state.__physics;
      if (!physics) return { ok: false, error: 'Física no activada' };
      physics.joints = physics.joints || {};
      physics.joints[args.JID] = { type: 'distance', bodyA: args.A, bodyB: args.B, length: num(args.LEN) };
      return { ok: true };
    }

    // ---- FALLBACK: efecto secundario externo -> INTENT ----
    // display/audio/ui/looks/ndi/red: NO se ejecuta en el worker; se recoge
    // para que el hilo principal lo aplique contra el DOM/canvas/red.
    ctx.runtime.intents.push({ opcode: opcode, args: args });
    return { ok: true, intent: true };
  };

  return { reporter, boolean, sideEffect };
}

/* ===================================================================
 * EJECUTOR (caminata AOT, autocontenida, sin DOM)
 * =================================================================== */
function createRuntime(initialState, timeoutMs) {
  const providers = buildProviders();
  const runtime = {
    providers,
    state: initialState,
    killed: false,
    steps: 0,
    intents: [],
    _gameSessions: {},
    _snapshot: null,
    scopeStack: [],
    startTime: (typeof Date !== 'undefined' ? Date.now() : 0),
    timeoutMs: timeoutMs,
  };

  runtime._pushScope = function (ctx) { ctx.scopeStack.push(new Map()); };
  runtime._popScope = function (ctx) { if (ctx.scopeStack.length > 0) ctx.scopeStack.pop(); };
  runtime._getFromScope = function (ctx, name) {
    for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
      if (ctx.scopeStack[i].has(name)) return ctx.scopeStack[i].get(name);
    }
    return ctx.state[name];
  };
  runtime._setInScope = function (ctx, name, value) {
    if (ctx.scopeStack.length > 0) ctx.scopeStack[ctx.scopeStack.length - 1].set(name, value);
    ctx.state[name] = value;
  };
  runtime.panic = function () { runtime.killed = true; };
  return runtime;
}

// Resuelve argumentos de forma estructural (sin meta de def): cualquier arg
// que sea un objeto con `opcode` es un nodo reporter/booleano anidado.
function resolveArgs(node, ctx) {
  const out = {};
  const args = node.args || {};
  for (const tok in args) {
    const raw = args[tok];
    if (raw && typeof raw === 'object' && raw.opcode) out[tok] = evalNode(raw, ctx);
    else out[tok] = raw;
  }
  return out;
}

function evalNode(node, ctx) {
  if (!node || !node.opcode) return null;
  const resolved = resolveArgs(node, ctx);
  node._resolved = resolved;
  if (BOOLEAN_OPCODES.has(node.opcode)) return ctx.runtime.providers.boolean(node.opcode, resolved, ctx);
  return ctx.runtime.providers.reporter(node.opcode, resolved, ctx);
}

function guard(ctx) {
  if (ctx.runtime.killed) throw new BreakSignal();
  if (ctx.runtime.steps > MAX_STEPS) throw new BlockError('__budget', 'presupuesto de ejecución agotado (' + MAX_STEPS + ')');
  if ((typeof Date !== 'undefined') && (Date.now() - ctx.runtime.startTime) > ctx.runtime.timeoutMs) {
    throw new TimeoutSignal(ctx.runtime.timeoutMs);
  }
}

function runContainer(node, ctx) {
  const a = resolveArgs(node, ctx);
  node._resolved = a;
  switch (node.opcode) {
    case 'if_then': {
      if (truthy(a.COND)) {
        ctx.runtime._pushScope(ctx);
        try { executeChain(node.body, ctx); } finally { ctx.runtime._popScope(ctx); }
      }
      return;
    }
    case 'if_then_else': {
      ctx.runtime._pushScope(ctx);
      try {
        if (truthy(a.COND)) executeChain(node.body, ctx);
        else executeChain(node.elseBody, ctx);
      } finally { ctx.runtime._popScope(ctx); }
      return;
    }
    case 'repeat_times': {
      const n = Math.max(0, Math.floor(Number(a.N) || 0));
      const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
      const chain = [];
      for (let i = 0; i < n && !ctx.runtime.killed; i++) { ctx.runtime._pushScope(ctx); chain.push(...body); }
      try { executeChain(chain, ctx); } finally { for (let i = 0; i < n; i++) ctx.runtime._popScope(ctx); }
      return;
    }
    case 'repeat_until': {
      const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
      const condNode = node.args && node.args.COND;
      ctx.runtime._pushScope(ctx);
      try {
        const step = () => {
          guard(ctx);
          const condVal = condNode ? evalNode(condNode, ctx) : a.COND;
          if (truthy(condVal)) return;
          executeChain(body, ctx);
          step();
        };
        step();
      } finally { ctx.runtime._popScope(ctx); }
      return;
    }
    case 'for_each_in_list': {
      const list = ctx.state['list_' + a.NAME];
      if (!Array.isArray(list)) return;
      const chains = [];
      for (let i = 0; i < list.length && !ctx.runtime.killed; i++) {
        ctx.runtime._pushScope(ctx);
        ctx.state['var_' + a.VAR] = list[i];
        const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
        chains.push(...body);
      }
      try { executeChain(chains, ctx); } finally { for (let i = 0; i < list.length; i++) ctx.runtime._popScope(ctx); }
      return;
    }
    case 'repeat_for_range': {
      const from = Math.floor(num(a.FROM, 0));
      const to = Math.floor(num(a.TO, 0));
      const step = num(a.STEP, 1) || 1;
      const chains = [];
      let count = 0;
      const body = () => (Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []));
      if (step > 0) {
        for (let v = from; v <= to && !ctx.runtime.killed; v += step) { ctx.runtime._pushScope(ctx); ctx.state['var_' + a.VAR] = v; chains.push(...body()); count++; }
      } else {
        for (let v = from; v >= to && !ctx.runtime.killed; v += step) { ctx.runtime._pushScope(ctx); ctx.state['var_' + a.VAR] = v; chains.push(...body()); count++; }
      }
      try { executeChain(chains, ctx); } finally { for (let i = 0; i < count; i++) ctx.runtime._popScope(ctx); }
      return;
    }
    case 'for_each_with_index': {
      const list = ctx.state['list_' + a.LIST];
      if (!Array.isArray(list)) return;
      const chains = [];
      for (let i = 0; i < list.length && !ctx.runtime.killed; i++) {
        ctx.runtime._pushScope(ctx);
        ctx.state['var_' + a.VAR] = list[i];
        ctx.state['var_' + a.IDX] = i;
        const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
        chains.push(...body);
      }
      try { executeChain(chains, ctx); } finally { for (let i = 0; i < list.length; i++) ctx.runtime._popScope(ctx); }
      return;
    }
    case 'while_loop': {
      const condNode = node.args && node.args.COND;
      const cond = () => truthy(condNode ? evalNode(condNode, ctx) : a.COND);
      ctx.runtime._pushScope(ctx);
      try {
        const step = () => {
          if (!cond() || ctx.runtime.killed) return;
          const b = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
          ctx.runtime._pushScope(ctx);
          try { executeChain(b, ctx); } finally { ctx.runtime._popScope(ctx); }
          step();
        };
        step();
      } finally { ctx.runtime._popScope(ctx); }
      return;
    }
    case 'try_catch_fallback': {
      const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
      const fallback = Array.isArray(node.fallback) ? node.fallback : (node.fallback ? [node.fallback] : []);
      ctx.runtime._pushScope(ctx);
      try { executeChain(body, ctx); } finally { ctx.runtime._popScope(ctx); }
      return;
    }
    default:
      return;
  }
}

function runBlock(node, ctx) {
  if (!node || !node.opcode) return;
  guard(ctx);
  ctx.runtime.steps++;
  try {
    // Contenedores de control de flujo.
    if (CONTAINER_OPCODES.has(node.opcode)) { runContainer(node, ctx); return; }
    if (node.opcode === 'hat') return;
    if (node.opcode === 'break_stack' || node.opcode === 'exit_loop') { throw new BreakSignal(); }
    if (node.opcode === 'continue_loop') { throw new ContinueSignal(); }
    // Efecto secundario (puede ser RAM puro o derivar en intent).
    const resolved = resolveArgs(node, ctx);
    node._resolved = resolved;
    const res = ctx.runtime.providers.sideEffect(node.opcode, resolved, ctx);
    if (res && res.ok === false) throw new BlockError(node.opcode, res.error || 'fallo');
    // wait_seconds: en el worker se ignora el delay (cómputo síncrono).
  } catch (e) {
    if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
    throw e;
  }
}

const CONTAINER_OPCODES = new Set([
  'if_then', 'if_then_else', 'repeat_times', 'repeat_until', 'for_each_in_list',
  'repeat_for_range', 'for_each_with_index', 'while_loop', 'try_catch_fallback'
]);

// Caminata iterativa (cola explícita) — sin recursión -> sin stack overflow.
function executeChain(chain, ctx) {
  if (!Array.isArray(chain)) return;
  const queue = [];
  chain.forEach(node => queue.push({ node, next: node.next || null }));
  while (queue.length) {
    guard(ctx);
    const frame = queue.shift();
    runBlock(frame.node, ctx);
    if (ctx.runtime.killed) return;
    if (frame.next) queue.unshift({ node: frame.next, next: frame.next.next || null });
  }
}

function execute(program, initialState, timeoutMs) {
  const scripts = program && program.scripts ? program.scripts : (program && Array.isArray(program) ? program : {});
  const runtime = createRuntime(initialState, timeoutMs);
  const ctx = {
    state: runtime.state,
    eventCtx: program && program.eventCtx ? program.eventCtx : {},
    runtime: runtime,
    scopeStack: runtime.scopeStack,
  };

  // Soporta tanto {scripts:{hat:[...]}} como un array plano de nodos.
  if (Array.isArray(scripts)) {
    executeChain(scripts, ctx);
  } else {
    Object.keys(scripts).forEach(hat => {
      const chain = scripts[hat];
      if (Array.isArray(chain)) executeChain(chain, ctx);
    });
  }
  return { state: ctx.state, intents: runtime.intents };
}

/* ===================================================================
 * ENTRADA DEL WORKER
 * =================================================================== */
self.onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type !== 'exec') return;
  const program = msg.program || {};
  const initialState = msg.initialState || {};
  const timeoutMs = (typeof msg.timeoutMs === 'number' && msg.timeoutMs > 0) ? msg.timeoutMs : 2000;

  try {
    const result = execute(program, initialState, timeoutMs);
    self.postMessage({ type: 'result', state: result.state, intents: result.intents });
  } catch (err) {
    let message = (err && err.message) ? err.message : String(err);
    let code = (err && err.name) || 'Error';
    if (err instanceof TimeoutSignal) { message = 'timeout: ejecución excedió ' + timeoutMs + 'ms'; code = 'TimeoutSignal'; }
    self.postMessage({ type: 'error', message: message, code: code });
  }
};
