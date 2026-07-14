const vm = require('vm');
const fs = require('fs');
const path = require('path');

function loadScript(filePath, sandbox) {
  const code = fs.readFileSync(path.resolve('interno', 'frontend', 'js', filePath), 'utf8');
  vm.runInContext(code, sandbox);
}

const sandbox = { window: {}, module: { exports: {} }, console };
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);

loadScript('scratch-blocks.js', sandbox);
loadScript('scratch-aot.js', sandbox);
loadScript('scratch-codegen.js', sandbox);

const ScratchBlocks = sandbox.window.ScratchBlocks;
const ScratchAOT = sandbox.window.ScratchAOT;
const CodeGen = sandbox.window.CodeGen;

// Test the resolver directly
const REGISTRY = ScratchBlocks.registry;
const node = {
  opcode: 'if_then',
  args: {
    COND: { opcode: 'logic_compare', args: { A: 5, OP: '>', B: 3 } }
  }
};

const def = REGISTRY ? REGISTRY[node.opcode] : null;
console.log('Block def:', def ? { type: def.type, hasBody: def.hasBody, args: Object.keys(def.args) } : 'NOT FOUND');

if (def) {
  for (const [token, spec] of Object.entries(def.args)) {
    console.log(`Arg ${token}:`, { type: spec.type, port: spec.port });
    const val = node.args[token];
    console.log(`  Value:`, val);
    console.log(`  spec.type === 'boolean':`, spec.type === 'boolean');
    console.log(`  val?.opcode:`, val?.opcode);
    if (spec.type === 'boolean' && val?.opcode) {
      console.log('  -> SHOULD RESOLVE AS BOOLEAN');
      const resolved = `Providers.boolean('${val.opcode}', ${JSON.stringify(val.args)}, state)`;
      console.log('  -> Resolved:', resolved);
    }
  }
}