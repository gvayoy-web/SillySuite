/**
 * scratch-builder.test.js — Extended tests for the Scratch Builder:
 * scratch-blocks.js category coverage, scratch-aot.js validation,
 * and scratch-runtime.js edge cases.
 *
 * Ejecutar: node tests/scratch-builder.test.js
 * (Extiende scratch-renderer.test.js con tests de integridad profunda)
 */
'use strict';

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

function loadScript(filePath, sandbox) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'interno', 'frontend', 'js', filePath), 'utf8');
  if (!sandbox) {
    sandbox = { window: {}, module: { exports: {} }, console };
    sandbox.window.module = sandbox.module;
    vm.createContext(sandbox);
  }
  vm.runInContext(code, sandbox);
  return sandbox;
}

const sandbox = { window: {}, module: { exports: {} }, console, performance: { now: () => Date.now() } };
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);

loadScript('scratch-blocks.js', sandbox);
loadScript('dynamic-blocks.js', sandbox);
loadScript('scratch-aot.js', sandbox);
loadScript('scratch-sandbox.js', sandbox);
loadScript('scratch-codegen.js', sandbox);
loadScript('scratch-runtime.js', sandbox);

const ScratchBlocks = sandbox.window.ScratchBlocks || sandbox.module.exports.ScratchBlocks;
const ScratchAOT = sandbox.window.ScratchAOT || sandbox.module.exports.ScratchAOT;
const ScratchRuntime = sandbox.window.ScratchRuntime || sandbox.module.exports.ScratchRuntime;

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


// ── Category coverage tests ──
console.log('\n🧪 scratch-blocks.js — Category Coverage Tests\n');

test('All 17 categories are defined', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  assert(cats.length >= 17, `Expected >=17 categories, got ${cats.length}`);
});

test('Each category has required properties', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    assert(c.id, `${c.id || '??'} must have id`);
    assert(c.label, `${c.id} must have label`);
    assert(typeof c.order === 'number', `${c.id} must have numeric order`);
    assert(c.icon, `${c.id} must have icon`);
  });
});

test('Events category has >= 8 hat blocks', () => {
  const hats = ScratchBlocks.byCategory('events').filter(b => b.type === 'hat');
  assert(hats.length >= 8, `Expected >=8 hat blocks in events, got ${hats.length}`);
});

test('Control category has containers (if/loop)', () => {
  const ctrl = ScratchBlocks.byCategory('control');
  const containers = ctrl.filter(b => b.type === 'c');
  assert(containers.length >= 5, `Expected >=5 containers in control, got ${containers.length}`);
});

test('Looks category has stack blocks', () => {
  const looks = ScratchBlocks.byCategory('looks');
  const stacks = looks.filter(b => b.type === 'stack');
  assert(stacks.length >= 5, `Expected >=5 stacks in looks, got ${stacks.length}`);
});

test('Quiz category has reporters and stacks', () => {
  const quiz = ScratchBlocks.byCategory('quiz');
  const reporters = quiz.filter(b => b.type === 'reporter');
  const stacks = quiz.filter(b => b.type === 'stack');
  assert(reporters.length >= 5, `Expected >=5 reporters in quiz`);
  assert(stacks.length >= 5, `Expected >=5 stacks in quiz`);
});

test('Operators category has reporters and booleans', () => {
  const ops = ScratchBlocks.byCategory('operators');
  const reporters = ops.filter(b => b.type === 'reporter');
  const booleans = ops.filter(b => b.type === 'boolean');
  assert(reporters.length >= 3, `Expected >=3 reporters in operators`);
  assert(booleans.length >= 3, `Expected >=3 booleans in operators`);
});

test('State category has persistence blocks', () => {
  const state = ScratchBlocks.byCategory('state');
  assert(state.length >= 5, `Expected >=5 blocks in state`);
  const persist = state.filter(b => b.opcode.includes('persistent') || b.opcode.includes('sqlite'));
  assert(persist.length >= 1, 'Must have persistence blocks');
});

test('Players category has score/ranking blocks', () => {
  const players = ScratchBlocks.byCategory('players');
  assert(players.length >= 5, `Expected >=5 blocks in players`);
});

test('Physics category has body/joint blocks', () => {
  const physics = ScratchBlocks.byCategory('physics');
  assert(physics.length >= 3, `Expected >=3 blocks in physics`);
  const bodies = physics.filter(b => b.opcode.includes('body') || b.opcode.includes('joint'));
  assert(bodies.length >= 1, 'Must have body/joint blocks');
});

test('Procedures category has custom blocks', () => {
  const procs = ScratchBlocks.byCategory('procedures');
  assert(procs.length >= 3, `Expected >=3 blocks in procedures`);
  const defs = procs.filter(b => b.opcode.startsWith('proc_'));
  assert(defs.length >= 3, 'Must have proc_def, proc_call, proc_return');
});

test('No orphan blocks (all blocks in some category)', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  const catIds = new Set(cats.map(c => c.id));
  cats.forEach(c => {
    const blocks = ScratchBlocks.byCategory(c.id);
    assert(blocks.length > 0, `Category "${c.id}" has no blocks assigned`);
  });
});


// ── Block type integrity tests ──
console.log('\n🧪 scratch-blocks.js — Block Type Integrity\n');

test('No blocks with empty opcode', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    const blocks = ScratchBlocks.byCategory(c.id);
    blocks.forEach(b => {
      assert(b.opcode && b.opcode.length > 0, `Block missing opcode: ${JSON.stringify(b)}`);
    });
  });
});

test('Hat blocks have exec "event"', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    ScratchBlocks.byCategory(c.id).filter(b => b.type === 'hat').forEach(b => {
      assert(b.exec === 'event', `${b.opcode} hat must have exec "event"`);
    });
  });
});

test('Container blocks have hasBody=true and bodies array', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    ScratchBlocks.byCategory(c.id).filter(b => b.type === 'c').forEach(b => {
      assert(b.hasBody === true, `${b.opcode} must have hasBody=true`);
      assert(Array.isArray(b.bodies), `${b.opcode} must have bodies array`);
      assert(b.bodies.length >= 1, `${b.opcode} must have >=1 body`);
    });
  });
});

test('Reporter blocks have returns property', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    ScratchBlocks.byCategory(c.id).filter(b => b.type === 'reporter').forEach(b => {
      assert(b.returns, `${b.opcode} reporter must have returns`);
    });
  });
});

test('Boolean blocks have returns "boolean"', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    ScratchBlocks.byCategory(c.id).filter(b => b.type === 'boolean').forEach(b => {
      assert(b.returns === 'boolean', `${b.opcode} boolean must have returns="boolean"`);
    });
  });
});

test('No duplicate opcodes in registry', () => {
  const allOpcodes = ScratchBlocks.all();
  const seen = new Set();
  allOpcodes.forEach(opcode => {
    assert(!seen.has(opcode), `Duplicate opcode: ${opcode}`);
    seen.add(opcode);
  });
});

test('All blocks have args object', () => {
  const cats = ScratchBlocks.categoriesOrdered();
  cats.forEach(c => {
    ScratchBlocks.byCategory(c.id).forEach(b => {
      assert(typeof b.args === 'object' && b.args !== null, `${b.opcode} must have args object`);
    });
  });
});


// ── AOT compiler extended tests ──
console.log('\n🧪 ScratchAOT — Extended Compiler Tests\n');

test('AOT compile handles empty event', () => {
  const machine = ScratchAOT.compile({ on_mode_init: [] });
  assert(machine.events.on_mode_init.length === 0);
  assert(machine.blockCount === 0);
});

test('AOT compile handles 3-level deep chain', () => {
  const scripts = {
    on_mode_init: [{
      opcode: 'set_theme', args: { THEME: 'neon' },
      next: {
        opcode: 'set_text_smooth', args: { COMP: 'title', TXT: 'Hello' },
        next: {
          opcode: 'wait_seconds', args: { SEC: 1 },
          next: null
        }
      }
    }]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.blockCount === 3);
});

test('AOT compile handles container blocks with bodies', () => {
  const scripts = {
    on_mode_init: [{
      opcode: 'if_then',
      args: { COND: true },
      body: [
        { opcode: 'state_init_memory_key', args: { KEY: 'x', DEF: 0 }, next: null }
      ],
      next: null
    }]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.blockCount === 2, `Expected blockCount 2, got ${machine.blockCount}`);
  assert(machine.events.on_mode_init[0].body.length === 1);
  assert(machine.events.on_mode_init[0].body[0].opcode === 'state_init_memory_key');
});

test('AOT compile handles if_then_else with both bodies', () => {
  const scripts = {
    on_mode_init: [{
      opcode: 'if_then_else',
      args: { COND: true },
      body: [
        { opcode: 'set_theme', args: { THEME: 'neon' }, next: null }
      ],
      elseBody: [
        { opcode: 'set_theme', args: { THEME: 'retro' }, next: null }
      ],
      next: null
    }]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.events.on_mode_init[0].body.length === 1);
  assert(machine.events.on_mode_init[0].elseBody.length === 1);
});

test('AOT compile coerces number string args', () => {
  const scripts = {
    on_mode_init: [{
      opcode: 'repeat_times',
      args: { N: '5' },
      body: [],
      next: null
    }]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.events.on_mode_init[0].args.N === 5);
});

test('AOT compile coerces boolean string args', () => {
  const scripts = {
    on_mode_init: [{
      opcode: 'if_then',
      args: { COND: 'true' },
      body: [],
      next: null
    }]
  };
  const machine = ScratchAOT.compile(scripts);
  assert(machine.events.on_mode_init[0].args.COND === true);
});

test('AOT validate rejects unknown opcodes', () => {
  const machine = {
    version: 2,
    events: {
      on_mode_init: [{
        opcode: 'totally_fake_opcode_xyz',
        args: {},
        next: null
      }]
    }
  };
  const result = ScratchAOT.validate(machine, { production: true });
  assert(result.valid === false);
  assert(result.errors.some(e => e.includes('desconocido')));
});

test('AOT validate accepts safe opcodes', () => {
  const machine = ScratchAOT.compile({
    on_mode_init: [
      { opcode: 'set_theme', args: { THEME: 'neon' }, next: null }
    ]
  });
  const result = ScratchAOT.validate(machine, { production: true });
  assert(result.valid === true);
});

test('AOT MAX_CHAIN limit enforced', () => {
  let chain = null;
  let prev = null;
  const N = ScratchAOT.MAX_CHAIN + 1;
  for (let i = 0; i < N; i++) {
    const node = { opcode: 'wait_seconds', args: { SEC: 0 }, next: null };
    if (!chain) chain = node;
    else prev.next = node;
    prev = node;
  }
  assert.throws(() => ScratchAOT.compile({ on_mode_init: chain }), /máximo de/);
});

test('AOT hotReload preserves event structure', () => {
  const prev = ScratchAOT.compile({
    on_mode_init: [{ opcode: 'set_theme', args: { THEME: 'neon' }, next: null }]
  });
  const reloaded = ScratchAOT.hotReload(prev, {
    on_mode_init: [{ opcode: 'set_theme', args: { THEME: 'retro' }, next: null }]
  });
  assert(reloaded.events.on_mode_init.length === 1);
  assert(reloaded.events.on_mode_init[0].args.THEME === 'retro');
});


// ── Runtime extended tests ──
console.log('\n🧪 ScratchRuntime — Extended Executor Tests\n');

(async () => {

await testAsync('Runtime executes set_theme', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'set_theme', args: { THEME: 'neon' }, next: null }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  // set_theme is a UI side-effect, just verify it executes without error
});

await testAsync('Runtime executes repeat_times with body', async () => {
  const runtime = new ScratchRuntime({ state: { counter: 0 } });
  const scripts = {
    on_mode_init: [{
      opcode: 'repeat_times',
      args: { N: 3 },
      body: [
        { opcode: 'state_increment_memory', args: { KEY: 'counter', BY: 1 }, next: null }
      ],
      next: null
    }]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.counter === 3);
});

await testAsync('Runtime handles nested if_then', async () => {
  const runtime = new ScratchRuntime({ state: { a: true, b: true } });
  const scripts = {
    on_mode_init: [{
      opcode: 'if_then',
      args: { COND: { opcode: 'logic_compare', args: { A: { opcode: 'state_get_memory_value', args: { KEY: 'a' } }, OP: '==', B: true } } },
      body: [{
        opcode: 'if_then',
        args: { COND: { opcode: 'logic_compare', args: { A: { opcode: 'state_get_memory_value', args: { KEY: 'b' } }, OP: '==', B: true } } },
        body: [
          { opcode: 'state_set_memory', args: { KEY: 'result', VAL: 'deep' }, next: null }
        ],
        next: null
      }],
      next: null
    }]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.result === 'deep');
});

await testAsync('Runtime handles repeat_until', async () => {
  const runtime = new ScratchRuntime({ state: { var_counter: 0 } });
  const scripts = {
    on_mode_init: [{
      opcode: 'repeat_until',
      args: { COND: { opcode: 'logic_compare', args: { A: { opcode: 'variable_get', args: { VAR: 'counter' } }, OP: '>=', B: 5 } } },
      body: [
        { opcode: 'variable_change', args: { VAR: 'counter', VAL: 1 }, next: null }
      ],
      next: null
    }]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.var_counter >= 5);
});

await testAsync('Runtime reporter string_join works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('string_join', { A: 'Hello', B: ' World' }, { state: {} });
  assert(result === 'Hello World');
});

await testAsync('Runtime reporter string_length works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('string_length', { TXT: 'test' }, { state: {} });
  assert(result === 4);
});

await testAsync('Runtime boolean logic_and_or works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const ctx = { state: {} };
  assert(runtime.providers.boolean('logic_and_or', { A: true, OP: 'AND', B: true }, ctx) === true);
  assert(runtime.providers.boolean('logic_and_or', { A: true, OP: 'AND', B: false }, ctx) === false);
  assert(runtime.providers.boolean('logic_and_or', { A: false, OP: 'OR', B: true }, ctx) === true);
});

await testAsync('Runtime list_sort works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const ctx = { state: runtime.state };
  runtime.providers.sideEffect('list_create', { NAME: 'nums' }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'nums', VAL: 3 }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'nums', VAL: 1 }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'nums', VAL: 2 }, ctx);
  runtime.providers.sideEffect('list_sort', { NAME: 'nums', DIR: 'asc' }, ctx);
  const first = runtime.providers.reporter('list_get_item', { NAME: 'nums', IDX: 1 }, ctx);
  assert(first === 1);
});

await testAsync('Runtime list_shuffle works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const ctx = { state: runtime.state };
  runtime.providers.sideEffect('list_create', { NAME: 'items' }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'items', VAL: 'a' }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'items', VAL: 'b' }, ctx);
  runtime.providers.sideEffect('list_add_item', { NAME: 'items', VAL: 'c' }, ctx);
  runtime.providers.sideEffect('list_shuffle', { NAME: 'items' }, ctx);
  const len = runtime.providers.reporter('list_get_length', { NAME: 'items' }, ctx);
  assert(len === 3, 'Shuffle preserves length');
});

await testAsync('Runtime math_clamp works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('math_clamp', { VAL: 15, MIN: 0, MAX: 10 }, { state: {} });
  assert(result === 10);
});

await testAsync('Runtime math_lerp works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('math_lerp', { A: 0, B: 10, T: 0.5 }, { state: {} });
  assert(result === 5);
});

await testAsync('Runtime get_random_number works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.reporter('get_random_number', { MIN: 1, MAX: 100 }, { state: {} });
  assert(typeof result === 'number');
  assert(result >= 1 && result <= 100);
});

await testAsync('Runtime string_contains works', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const result = runtime.providers.boolean('string_contains', { TXT: 'hello world', SUB: 'world' }, { state: {} });
  assert(result === true);
  const result2 = runtime.providers.boolean('string_contains', { TXT: 'hello world', SUB: 'xyz' }, { state: {} });
  assert(result2 === false);
});

await testAsync('Runtime variable_init only sets if not present', async () => {
  const runtime = new ScratchRuntime({ state: { var_x: 42 } });
  const scripts = {
    on_mode_init: [
      { opcode: 'variable_init', args: { VAR: 'x', VAL: 99 }, next: null },
      { opcode: 'variable_init', args: { VAR: 'y', VAL: 77 }, next: null }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.var_x === 42, 'variable_init must not overwrite existing');
  assert(runtime.state.var_y === 77, 'variable_init must set new variable');
});

await testAsync('Runtime panic stops mid-chain', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'state_set_memory', args: { KEY: 'before', VAL: 1 }, next: null },
      { opcode: 'global_panic_reset', args: {}, next: null },
      { opcode: 'state_set_memory', args: { KEY: 'after', VAL: 1 }, next: null }
    ]
  };
  try { await runtime.start('on_mode_init', scripts, {}); } catch (e) {}
  assert(runtime.state.before === 1);
  assert(runtime.state.after === undefined);
  assert(runtime.killed === true);
});

await testAsync('Runtime kills infinite loop via budget', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [{
      opcode: 'repeat_times',
      args: { N: 99999999 },
      body: [],
      next: null
    }]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.killed === true);
});

await testAsync('Runtime providers handle unknown opcodes gracefully', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const r1 = runtime.providers.reporter('nonexistent_op', {}, { state: {} });
  assert(r1 === null);
  const r2 = runtime.providers.boolean('nonexistent_bool', {}, { state: {} });
  assert(r2 === false);
});

await testAsync('Runtime handles multiple events', async () => {
  const runtime = new ScratchRuntime({ state: {} });
  const scripts = {
    on_mode_init: [
      { opcode: 'state_set_memory', args: { KEY: 'init', VAL: true }, next: null }
    ],
    on_question_load: [
      { opcode: 'state_set_memory', args: { KEY: 'loaded', VAL: true }, next: null }
    ]
  };
  await runtime.start('on_mode_init', scripts, {});
  assert(runtime.state.init === true);
  assert(runtime.state.loaded === undefined, 'on_question_load should not auto-fire');
});


// ── Port compatibility tests ──
console.log('\n🧪 ScratchBlocks — Port Compatibility Tests\n');

test('PORT constants defined', () => {
  const PORT = ScratchBlocks.PORT;
  assert(PORT.number);
  assert(PORT.string);
  assert(PORT.boolean);
  assert(PORT.color);
  assert(PORT.any);
});

test('Any port compatible with all', () => {
  const PORT = ScratchBlocks.PORT;
  assert(ScratchBlocks.portsCompatible(PORT.any, PORT.number));
  assert(ScratchBlocks.portsCompatible(PORT.any, PORT.string));
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.any));
  assert(ScratchBlocks.portsCompatible(PORT.string, PORT.any));
});

test('Same ports compatible', () => {
  const PORT = ScratchBlocks.PORT;
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.number));
  assert(ScratchBlocks.portsCompatible(PORT.string, PORT.string));
  assert(ScratchBlocks.portsCompatible(PORT.boolean, PORT.boolean));
});

test('Different ports incompatible', () => {
  const PORT = ScratchBlocks.PORT;
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.string) === false);
  assert(ScratchBlocks.portsCompatible(PORT.number, PORT.boolean) === false);
  assert(ScratchBlocks.portsCompatible(PORT.string, PORT.boolean) === false);
});


console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);

})();
