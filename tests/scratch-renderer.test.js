/**
 * scratch-renderer.test.js — Tests para scratch-blocks.js AOT compiler
 * y scratch-runtime.js executor.
 *
 * Ejecutar: node tests/scratch-renderer.test.js
 * (No requiere framework externo — usa asserts nativos de Node.js)
 */
'use strict';

const assert = require('assert');
const path = require('path');

// Cargar módulos del builder
const vm = require('vm');
const fs = require('fs');

function loadScript(filePath) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'interno', 'frontend', 'js', filePath), 'utf8');
  const sandbox = { window: {}, module: { exports: {} }, console };
  sandbox.window.module = sandbox.module;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const blocksCtx = loadScript('scratch-blocks.js');
const runtimeCtx = loadScript('scratch-runtime.js');

const ScratchBlocks = blocksCtx.window.ScratchBlocks || blocksCtx.module.exports.ScratchBlocks;
const ScratchAOT = blocksCtx.window.ScratchAOT || blocksCtx.module.exports.ScratchAOT;
const ScratchRuntime = runtimeCtx.window.ScratchRuntime || runtimeCtx.module.exports.ScratchRuntime;

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

console.log('\n🧪 scratch-blocks.js — Block Registry Tests\n');

test('ScratchBlocks.registry has entries', () => {
  assert(Object.keys(ScratchBlocks.registry).length > 0);
});

test('ScratchBlocks.all() returns opcode list', () => {
  const all = ScratchBlocks.all();
  assert(Array.isArray(all));
  assert(all.length > 50);
});

test('ScratchBlocks.get() returns block definition', () => {
  const def = ScratchBlocks.get('set_theme');
  assert(def !== null);
  assert(def.opcode === 'set_theme');
  assert(def.category === 'looks');
  assert(def.type === 'stack');
});

test('ScratchBlocks.get() returns null for unknown', () => {
  assert(ScratchBlocks.get('nonexistent_op') === null);
});

test('ScratchBlocks.exists() works', () => {
  assert(ScratchBlocks.exists('set_theme') === true);
  assert(ScratchBlocks.exists('nonexistent') === false);
});

test('ScratchBlocks.byCategory() filters correctly', () => {
  const events = ScratchBlocks.byCategory('events');
  assert(Array.isArray(events));
  assert(events.length >= 8);
  events.forEach(b => assert(b.category === 'events'));
});

test('ScratchBlocks.categoriesOrdered() returns sorted', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  assert(Array.isArray(cats));
  assert(cats.length >= 10);
  for (let i = 1; i < cats.length; i++) {
    assert(cats[i].order >= cats[i - 1].order);
  }
});

test('Hat blocks have exec type "event"', () => {
  const hats = ScratchBlocks.byCategory('events');
  hats.forEach(h => {
    if (h.type === 'hat') {
      assert(h.exec === 'event', `${h.opcode} should have exec "event"`);
    }
  });
});

test('Reporter blocks have returns property', () => {
  const def = ScratchBlocks.get('math_calc');
  assert(def.returns === 'number');
});

test('Boolean blocks have returns "boolean"', () => {
  const def = ScratchBlocks.get('logic_compare');
  assert(def.returns === 'boolean');
});

test('Container blocks have bodies', () => {
  const def = ScratchBlocks.get('if_then');
  assert(def.hasBody === true);
  assert(def.bodies.includes('body'));
});

test('if_then_else has two bodies', () => {
  const def = ScratchBlocks.get('if_then_else');
  assert(def.bodies.includes('body'));
  assert(def.bodies.includes('elseBody'));
});

test('portsCompatible works', () => {
  const PORT = ScratchBlocks.PORT;
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.number) === true);
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.string) === false);
  assert(ScratchBlocks.portsCompatible(PORT.any, PORT.string) === true);
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.any) === true);
});


console.log('\n🧪 ScratchAOT — Compiler Tests\n');

test('AOT compile produces valid machine', () => {
  const scripts = {
    on_mode_init: [
      { opcode: 'set_theme', args: { THEME: 'neon' }, next: null }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.version === 1);
  assert(machine.engine === 'scratch-aot');
  assert(machine.events.on_mode_init.length === 1);
  assert(machine.events.on_mode_init[0].opcode === 'set_theme');
  assert(machine.blockCount === 1);
});

test('AOT compile chains blocks', () => {
  const scripts = {
    on_mode_init: [
      {
        opcode: 'set_theme', args: { THEME: 'neon' },
        next: {
          opcode: 'set_text_smooth', args: { COMP: 'title', TXT: 'Hello' },
          next: null
        }
      }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.blockCount === 2);
  assert(machine.events.on_mode_init[0].next.length === 1);
  assert(machine.events.on_mode_init[0].next[0].opcode === 'set_text_smooth');
});

test('AOT compile throws on non-hat event', () => {
  const scripts = {
    set_theme: [{ opcode: 'set_theme', args: { THEME: 'neon' }, next: null }]
  };
  assert.throws(() => ScratchAOT.compile(scripts), /no es un bloque Hat válido/);
});

test('AOT coerce number args', () => {
  const scripts = {
    on_mode_init: [
      { opcode: 'quiz_init_engine', args: { N: '20', CAT: 'mix' }, next: null }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.events.on_mode_init[0].args.N === 20);
});

test('AOT coerce boolean args', () => {
  const scripts = {
    on_mode_init: [
      { opcode: 'play_bg_music', args: { FILE: 'test.mp3', VOL: 50, LOOP: 'true' }, next: null }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.events.on_mode_init[0].args.LOOP === true);
});

test('AOT validate returns valid for clean machine', () => {
  const scripts = {
    on_mode_init: [
      { opcode: 'set_theme', args: { THEME: 'neon' }, next: null }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  const result = ScratchAOT.validate(machine, { production: true });
  assert(result.valid === true);
  assert(result.errors.length === 0);
});

test('AOT validate catches disabledInProd in production', () => {
  const scripts = {
    on_mode_init: [
      { opcode: 'execute_raw_javascript', args: { CODE: 'alert(1)' }, next: null }
    ]
  };
  const machine = ScratchAOT.compile(scripts);
  const result = ScratchAOT.validate(machine, { production: true });
  assert(result.valid === false);
  assert(result.errors.some(e => e.includes('inseguro')));
});

test('AOT hotReload marks machine correctly', () => {
  const prev = ScratchAOT.compile({
    on_mode_init: [{ opcode: 'set_theme', args: { THEME: 'neon' }, next: null }]
  });
  const next = ScratchAOT.compile({
    on_mode_init: [{ opcode: 'set_theme', args: { THEME: 'retro' }, next: null }]
  });
  const reloaded = ScratchAOT.hotReload(prev, {
    on_mode_init: [{ opcode: 'set_theme', args: { THEME: 'retro' }, next: null }]
  });
  assert(reloaded.hotReload === true);
  assert(reloaded.previousCompiledAt === prev.compiledAt);
});


console.log('\n🧪 ScratchRuntime — Executor Tests\n');

test('Runtime executes simple chain', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [{ opcode: 'state_init_memory_key', args: { KEY: 'test', DEF: 42 }, next: null }]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.test === 42);
});

test('Runtime handles if_then (true branch)', async () => {
  const runtime = new ScratchRuntime({ state: { cond: true } });
  const scripts = {
    on_mode_init: [
      {
        opcode: 'if_then',
        args: { COND: { opcode: 'state_get_memory_value', args: { KEY: 'cond' } } },
        body: [{ opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'yes' }, next: null }],
        next: null
      }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.result === 'yes');
});

test('Runtime handles if_then (false branch skips)', async () => {
  const runtime = new ScratchRuntime({ state: { cond: false } });
  const scripts = {
    on_mode_init: [
      {
        opcode: 'if_then',
        args: { COND: { opcode: 'state_get_memory_value', args: { KEY: 'cond' } } },
        body: [{ opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'yes' }, next: null }],
        next: null
      }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.result === undefined);
});

test('Runtime handles if_then_else', async () => {
  const runtime = new ScratchRuntime({ state: { cond: false } });
  const scripts = {
    on_mode_init: [
      {
        opcode: 'if_then_else',
        args: { COND: { opcode: 'state_get_memory_value', args: { KEY: 'cond' } } },
        body: [{ opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'yes' }, next: null }],
        elseBody: [{ opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'no' }, next: null }],
        next: null
      }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.result === 'no');
});

test('Runtime handles repeat_times', async () => {
  const runtime = new ScratchRuntime({ state: { counter: 0 } });
  const scripts = {
    on_mode_init: [
      {
        opcode: 'repeat_times',
        args: { N: 5 },
        body: [{ opcode: 'state_increment_memory', args: { KEY: 'counter', BY: 1 }, next: null }],
        next: null
      }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.counter === 5);
});

test('Runtime handles wait_seconds with delay', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const start = Date.now();
  const scripts = {
    on_mode_init: [
      { opcode: 'wait_seconds', args: { SEC: 0.1 }, next: null }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  const elapsed = Date.now() - start;
  assert(elapsed >= 80, `Expected >=80ms, got ${elapsed}ms`);
});

test('Runtime panic stops execution', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'state_set_memory', args: { KEY: 'a', VAL: 1 }, next: null },
      { opcode: 'global_panic_reset', args: {}, next: null },
      { opcode: 'state_set_memory', args: { KEY: 'b', VAL: 1 }, next: null }
    ]
  };
  try {
    await runtime.start('on_mode_init', scripts, {});
  } catch (e) {
    // panic throws
  }
  assert(runtime.state.a === 1);
  assert(runtime.state.b === undefined);
});

test('Runtime reporter math_calc works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('math_calc', { A: 10, OP: '+', B: 5 }, { state: {} });
  assert(result === 15);
});

test('Runtime reporter math_calc division', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('math_calc', { A: 10, OP: '÷', B: 3 }, { state: {} });
  assert(Math.abs(result - 3.333) < 0.01);
});

test('Runtime boolean logic_compare works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  assert(runtime.providers.boolean('logic_compare', { A: 5, OP: '>', B: 3 }, { state: {} }) === true);
  assert(runtime.providers.boolean('logic_compare', { A: 5, OP: '<', B: 3 }, { state: {} }) === false);
  assert(runtime.providers.boolean('logic_compare', { A: 5, OP: '==', B: 5 }, { state: {} }) === true);
});

test('Runtime list operations work', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const ctx = { state: runtime.state };

  runtime.providers.sideEffect('list_create', { NAME: 'test' }, ctx);
  assert(Array.isArray(ctx.state.list_test));

  runtime.providers.sideEffect('list_add_item', { NAME: 'test', VAL: 'a' }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'test', VAL: 'b' }, ctx);
  assert(ctx.state.list_test.length === 2);

  const len = runtime.providers.reporter('list_length', { NAME: 'test' }, ctx);
  assert(len === 2);

  const item = runtime.providers.reporter('list_get_item', { NAME: 'test', IDX: 1 }, ctx);
  assert(item === 'a');
});

test('Runtime variable_set and variable_get work', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const ctx = { state: runtime.state };

  runtime.providers.sideEffect('variable_set', { VAR: 'score', VAL: 100 }, ctx);
  assert(ctx.state.var_score === 100);

  const val = runtime.providers.reporter('variable_get', { VAR: 'score' }, ctx);
  assert(val === 100);
});

test('Runtime providers handle unknown opcodes gracefully', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('unknown_op', {}, { state: {} });
  assert(result === null);
});

test('AOT rechaza cadenas que superan MAX_CHAIN (R1)', () => {
  // Construye una cadena lineal de 1001 bloques wait_seconds y compila.
  let chain = null;
  let prev = null;
  const N = ScratchAOT.MAX_CHAIN + 1;
  for (let i = 0; i < N; i++) {
    const node = { opcode: 'wait_seconds', args: { SEC: 0 }, next: null };
    if (!chain) chain = node;
    else prev.next = node;
    prev = node;
  }
  assert.throws(() => ScratchAOT.compile({ on_mode_init: chain }),
    /máximo de/);
});

test('Runtime agota presupuesto y hace panic en bucle enorme (R3)', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  let started = 0, ended = 0;
  runtime.hooks = {
    onBlockStart: () => { started++; },
    onBlockEnd: () => { ended++; },
    onPanic: () => {},
    onError: () => {}
  };
  const scripts = { on_mode_init: { opcode: 'repeat_times', args: { N: 99999999 }, next: null } };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.killed === true, 'debe quedar killed tras agotar presupuesto');
  assert(started < 50000, 'no debe ejecutar todos los bloques del bucle');
});

test('Engine: leaderboard local a partir de claves de RAM (Bloque 5)', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'engine_create_player_client', args: { SLOTS: 2, BASE: 'persona' } },
      { opcode: 'state_increment_memory', args: { KEY: 'player_persona1_kills', BY: 3 } },
      { opcode: 'state_increment_memory', args: { KEY: 'player_persona2_kills', BY: 5 } }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  const data = runtime.providers.reporter('engine_get_leaderboard_data', { METRIC: 'kills' }, { state: runtime.state, runtime });
  assert(Array.isArray(data.leaderboard), 'leaderboard debe ser array');
  assert(data.leaderboard.length === 2, 'debe listar 2 jugadores');
  assert(data.leaderboard[0].client_id === 'persona2' && data.leaderboard[0].value === 5, 'top debe ser persona2 con 5');
});

test('Sprites: spawn y destroy en RAM local', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'sprite_spawn', args: { SID: 'z1', ASSET: 'zombie.png', X: 10, Y: 20 } },
      { opcode: 'sprite_set_velocity', args: { SID: 'z1', VX: 1, VY: 0 } }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.__sprites['z1'].x === 10 && runtime.state.__sprites['z1'].vx === 1, 'spawn y velocity aplicados');
});


console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
