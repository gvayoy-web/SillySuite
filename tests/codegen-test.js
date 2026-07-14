/**
 * Quick test of CodeGen export functionality
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadScript(filePath, sandbox) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'interno', 'frontend', 'js', filePath), 'utf8');
  vm.runInContext(code, sandbox);
}

const sandbox = { window: {}, module: { exports: {} }, console };
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);

loadScript('scratch-blocks.js', sandbox);
loadScript('scratch-aot.js', sandbox);
loadScript('scratch-codegen.js', sandbox);

const ScratchBlocks = sandbox.window.ScratchBlocks || sandbox.module.exports.ScratchBlocks;
const ScratchAOT = sandbox.window.ScratchAOT || sandbox.module.exports.ScratchAOT;
const CodeGen = sandbox.window.CodeGen || sandbox.module.exports.CodeGen;

// Test machine
const scripts = {
  on_mode_init: [
    {
      opcode: 'set_theme', args: { THEME: 'neon' },
      next: {
        opcode: 'physics_enable', args: { GX: 0, GY: 9.8 },
        next: {
          opcode: 'physics_create_body', args: { BID: 'ball', TYPE: 'dynamic', X: 50, Y: 10 },
          next: {
            opcode: 'set_text_smooth', args: { COMP: 'title', TXT: 'Physics Demo' },
            next: null
          }
        }
      }
    }
  ],
  on_question_start: [
    {
      opcode: 'physics_apply_force', args: { BID: 'ball', FX: 0, FY: -50, X: 50, Y: 10 },
      next: null
    }
  ]
};

const machine = ScratchAOT.compile(scripts);
console.log('✅ AOT compiled, blocks:', machine.blockCount);

// Export to all targets
const targets = [
  { target: 'typescript', file: path.join(os.tmpdir(), 'mode.ts') },
  { target: 'python', file: path.join(os.tmpdir(), 'mode.py') },
  { target: 'csharp', file: path.join(os.tmpdir(), 'Mode.cs') },
  { target: 'rust', file: path.join(os.tmpdir(), 'mode.rs') }
];

for (const { target, file } of targets) {
  try {
    const code = CodeGen.export(machine, target, { modeName: 'PhysicsDemo' });
    fs.writeFileSync(file, code, 'utf8');
    console.log(`✅ Exported ${target} to ${file} (${code.length} chars)`);
  } catch (e) {
    console.log(`❌ ${target} export failed:`, e.message);
  }
}

console.log('\n📝 Sample TypeScript output (first 50 lines):');
const tsCode = CodeGen.export(machine, 'typescript', { modeName: 'PhysicsDemo' });
console.log(tsCode.split('\n').slice(0, 50).join('\n'));