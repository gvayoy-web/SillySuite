/**
 * scratch-runtime.test.js — Tests para el ejecutor AOT (scratch-runtime.js).
 *
 * Verifica:
 *   - Ejecución de opcodes SEGUROS (math_clamp, string_split, json_parse,
 *     list_create / list_add_item / list_get_item_at, quiz_get_score,
 *     get_random_number) vía la SUPERFICIE PÚBLICA ESTABLE (ScratchRuntime +
 *     defaultProviders).
 *   - Rechazo de opcodes INSEGUROS: execute_raw_javascript e inject_css_raw
 *     devuelven { ok: false, error: 'SECURITY...' } y la ejecución de cadena
 *     falla (BlockError).
 *
 * Ejecutar: node --test tests/scratch-runtime.test.js
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Carga de módulos reales del builder en un sandbox vm (CJS, sin DOM).
   Mismo patrón que tests/scratch-renderer.test.js. */
function loadScript(filePath, sandbox) {
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', filePath),
    'utf8'
  );
  vm.runInContext(code, sandbox);
}

const sandbox = {
  window: {}, module: { exports: {} }, console,
  performance: (typeof performance !== 'undefined' ? performance : require('perf_hooks').performance),
};
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);

['scratch-blocks.js', 'dynamic-blocks.js', 'scratch-sandbox.js', 'scratch-runtime.js']
  .forEach((f) => loadScript(f, sandbox));

const ScratchRuntime = sandbox.window.ScratchRuntime;

assert(ScratchRuntime, 'ScratchRuntime debe estar disponible en la superficie pública');

console.log('\n🧪 scratch-runtime.js — Opcode Safety & Execution Tests\n');

// ──────────────────────────────────────────────────────────────
// TAREA A.1 — Opcodes seguros
// ──────────────────────────────────────────────────────────────

test('math_clamp acota valores fuera de rango (superior)', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('math_clamp', { VAL: 15, MIN: 0, MAX: 10 }, { state: rt.state });
  assert.strictEqual(r, 10);
});

test('math_clamp acota valores fuera de rango (inferior)', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('math_clamp', { VAL: -5, MIN: 0, MAX: 10 }, { state: rt.state });
  assert.strictEqual(r, 0);
});

test('math_clamp deja pasar valores dentro de rango', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('math_clamp', { VAL: 7, MIN: 0, MAX: 10 }, { state: rt.state });
  assert.strictEqual(r, 7);
});

test('string_split divide por separador', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('string_split', { TXT: 'a,b,c', SEP: ',' }, { state: rt.state });
  assert.strictEqual(r, JSON.stringify(['a', 'b', 'c']));
});

test('string_split usa separador explícito', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('string_split', { TXT: 'x-y-z', SEP: '-' }, { state: rt.state });
  assert.strictEqual(r, JSON.stringify(['x', 'y', 'z']));
});

test('string_split usa coma por defecto', () => {
  const rt = new ScratchRuntime({ state: {} });
  // SEP vacío -> el provider usa coma como separador por defecto.
  const r = rt.providers.reporter('string_split', { TXT: 'a,b,c', SEP: '' }, { state: rt.state });
  assert.strictEqual(r, JSON.stringify(['a', 'b', 'c']));
});

test('json_parse parsea objetos', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('json_parse', { S: '{"a":1,"b":[2,3]}' }, { state: rt.state });
  assert.strictEqual(JSON.stringify(r), JSON.stringify({ a: 1, b: [2, 3] }));
});

test('json_parse devuelve null ante JSON inválido', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.reporter('json_parse', { S: 'no-es-json' }, { state: rt.state });
  assert.strictEqual(r, null);
});

test('list_create + list_add_item + list_get_item_at', () => {
  const rt = new ScratchRuntime({ state: {} });
  const ctx = { state: rt.state };
  rt.providers.sideEffect('list_create', { NAME: 'mylist' }, ctx);
  assert.ok(Array.isArray(ctx.state.list_mylist));
  rt.providers.sideEffect('list_add_item', { NAME: 'mylist', VAL: 'x' }, ctx);
  rt.providers.sideEffect('list_add_item', { NAME: 'mylist', VAL: 'y' }, ctx);
  assert.strictEqual(ctx.state.list_mylist.length, 2);
  const item = rt.providers.reporter('list_get_item_at', { NAME: 'mylist', IDX: 1 }, ctx);
  assert.strictEqual(item, 'x');
  const item2 = rt.providers.reporter('list_get_item_at', { NAME: 'mylist', IDX: 2 }, ctx);
  assert.strictEqual(item2, 'y');
});

test('quiz_get_score lee puntuación de estado', () => {
  const rt = new ScratchRuntime({ state: { score_player1: 5 } });
  const r = rt.providers.reporter('quiz_get_score', { PLAYER: 'player1' }, { state: rt.state });
  assert.strictEqual(r, 5);
});

test('get_random_number devuelve entero dentro de rango', () => {
  const rt = new ScratchRuntime({ state: {} });
  for (let i = 0; i < 50; i++) {
    const r = rt.providers.reporter('get_random_number', { MIN: 1, MAX: 6 }, { state: rt.state });
    assert.ok(Number.isInteger(r) && r >= 1 && r <= 6, `fuera de rango: ${r}`);
  }
});

test('Cadena: quiz_add_score_to_player acumula en estado', async () => {
  const rt = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'quiz_add_score_to_player', args: { PLAYER: 'p1', PTS: 3 }, next: {
        opcode: 'quiz_add_score_to_player', args: { PLAYER: 'p1', PTS: 2 }, next: null
      } }
    ]
  };
  await rt.start('on_mode_init', scripts, {});
  assert.strictEqual(rt.state['score_p1'], 5);
});

test('Cadena: if_then ejecuta body según condición anidada', async () => {
  const rt = new ScratchRuntime({ state: { flag: true } });
  const scripts = {
    on_mode_init: [
      {
        opcode: 'if_then',
        args: { COND: { opcode: 'state_get_memory_value', args: { KEY: 'flag' } } },
        body: [{ opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'yes' }, next: null }],
        next: null
      }
    ]
  };
  await rt.start('on_mode_init', scripts, {});
  assert.strictEqual(rt.state.result, 'yes');
});

// ──────────────────────────────────────────────────────────────
// TAREA A.2 — Opcodes INSEGUROS deben ser RECHAZADOS
// ──────────────────────────────────────────────────────────────

test('execute_raw_javascript es RECHAZADO (ok:false)', () => {
  const rt = new ScratchRuntime({ state: {} });
  const res = rt.providers.sideEffect('execute_raw_javascript', { CODE: 'alert(1)' }, { state: rt.state });
  assert.strictEqual(res.ok, false);
  assert.match(res.error || '', /SECURITY/i);
});

test('inject_css_raw es RECHAZADO (ok:false)', () => {
  const rt = new ScratchRuntime({ state: {} });
  const res = rt.providers.sideEffect('inject_css_raw', { CSS: 'body{display:none}' }, { state: rt.state });
  // CORREGIDO: el bloque de seguridad ahora se evalúa ANTES de la allow-list
  // por prefijo 'inject_', así que nunca se aprueba.
  assert.strictEqual(res.ok, false);
  assert.match(res.error || '', /SECURITY/i);
});

test('execute_raw_javascript en cadena falla la ejecución (BlockError)', async () => {
  const rt = new ScratchRuntime({ state: {} });
  let errorCount = 0;
  rt.hooks = { onError: () => { errorCount++; } };
  const scripts = {
    on_mode_init: [{ opcode: 'execute_raw_javascript', args: { CODE: 'alert(1)' }, next: null }]
  };
  await assert.rejects(async () => { await rt.start('on_mode_init', scripts, {}); });
  assert.ok(errorCount >= 1, 'debe reportar el bloque inseguro vía onError');
});

test('inject_css_raw en cadena falla la ejecución (BlockError)', async () => {
  // Ahora inject_css_raw se rechaza a nivel provider (ok:false) y la cadena
  // lanza BlockError, igual que execute_raw_javascript. No inyecta CSS.
  const rt = new ScratchRuntime({ state: {} });
  let errorCount = 0;
  rt.hooks = { onError: () => { errorCount++; } };
  const scripts = {
    on_mode_init: [{ opcode: 'inject_css_raw', args: { CSS: '*{}' }, next: null }]
  };
  await assert.rejects(async () => { await rt.start('on_mode_init', scripts, {}); });
  assert.ok(errorCount >= 1, 'debe reportar el bloque inseguro vía onError');
});

test('Bloques seguros NO son rechazados (contraste)', () => {
  const rt = new ScratchRuntime({ state: {} });
  const r = rt.providers.sideEffect('state_set_memory', { KEY: 'k', VAL: 1 }, { state: rt.state });
  assert.strictEqual(r.ok, true);
});
