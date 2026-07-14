/**
 * sync_opcodes.js — Fuente única de verdad para opcodes.
 *
 * Lee el REGISTRY de scratch-blocks.js y vuelca TODOS los opcodes a
 * scripts/opcodes_gen.py, que compile_modes.py importa como VALID_SCRATCH_OPCODES.
 * Así JS y Python nunca se desincronizan al añadir bloques (p.ej. engine/sprites).
 *
 * Uso:  node scripts/sync_opcodes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const blocksPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'scratch-blocks.js');
const outPath = path.resolve(__dirname, 'opcodes_gen.py');

const sandbox = { window: {}, module: { exports: {} }, console };
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(blocksPath, 'utf8'), sandbox);

const ScratchBlocks = sandbox.window.ScratchBlocks || sandbox.module.exports.ScratchBlocks;
const opcodes = ScratchBlocks.all().sort();

const py = [
  '# GENERATED FILE — do not edit by hand. Run: node scripts/sync_opcodes.js',
  '# Contiene la lista de opcodes válidos sincronizada desde scratch-blocks.js.',
  'VALID_SCRATCH_OPCODES = {',
  ...opcodes.map(o => `    ${JSON.stringify(o)},`),
  '}',
  ''
].join('\n');

fs.writeFileSync(outPath, py, 'utf8');
console.log(`sync_opcodes: ${opcodes.length} opcodes -> ${outPath}`);
