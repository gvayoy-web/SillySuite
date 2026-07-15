/**
 * gen_types.js — Codegen de contratos TypeScript para creadores de mods.
 *
 * Carga el REGISTRY de interno/frontend/js/scratch-blocks.js vía vm
 * (igual que scripts/sync_opcodes.js) y auto-genera
 * interno/frontend/ts/opcodes.d.ts con:
 *   - un tipo string-literal-union por cada una de las 17 categorías
 *   - BlockType, PortType, ArgDef, BlockDef
 *   - la interfaz ScratchBlocks (espejo de scratch-blocks.js)
 *
 * Uso:  node scripts/gen_types.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const blocksPath = path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'scratch-blocks.js');
const outDir = path.resolve(__dirname, '..', 'interno', 'frontend', 'ts');
const outPath = path.join(outDir, 'opcodes.d.ts');

/* Las 17 categorías canon (orden fijo, para que el .d.ts nunca se reordene). */
const CATEGORIES = [
  'events', 'control', 'looks', 'audio', 'ndi', 'displays', 'quiz',
  'state', 'operators', 'custom', 'players', 'db', 'runtime', 'engine',
  'sprites', 'physics', 'procedures'
];

/* Carga del registry exactamente como sync_opcodes.js. */
const sandbox = { window: {}, module: { exports: {} }, console };
sandbox.window.module = sandbox.module;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(blocksPath, 'utf8'), sandbox);

const ScratchBlocks = sandbox.window.ScratchBlocks
  || sandbox.module.exports.ScratchBlocks
  || sandbox.ScratchBlocks;

if (!ScratchBlocks || typeof ScratchBlocks.all !== 'function') {
  console.error('gen_types: no se pudo cargar window.ScratchBlocks desde scratch-blocks.js');
  process.exit(1);
}

const all = ScratchBlocks.all();
const byCat = Object.create(null);
for (const cat of CATEGORIES) byCat[cat] = [];

for (const opcode of all) {
  const def = ScratchBlocks.get(opcode);
  const cat = def && def.category;
  if (cat && byCat[cat]) byCat[cat].push(opcode);
  else (byCat[cat] || (byCat[cat] = [])).push(opcode);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const union = (arr) =>
  arr.length ? arr.slice().sort().map((o) => `  | '${o}'`).join('\n') : '  never';

const lines = [];
lines.push('/**');
lines.push(' * opcodes.d.ts — GENERATED FILE. Do not edit by hand.');
lines.push(' * Run: node scripts/gen_types.js');
lines.push(' *');
lines.push(' * Contratos de tipos derivados de scratch-blocks.js (REGISTRY).');
lines.push(' * Es la fuente única de verdad para los opcodes válidos de un mod.');
lines.push(' */');
lines.push('');
lines.push('/* Tipos primitivos compartidos --------------------------------- */');
lines.push("export type BlockType = 'hat' | 'stack' | 'c' | 'reporter' | 'boolean';");
lines.push('');
lines.push("export type PortType =");
lines.push("  | 'port-number'");
lines.push("  | 'port-string'");
lines.push("  | 'port-boolean'");
lines.push("  | 'port-color'");
lines.push("  | 'port-ndi'");
lines.push("  | 'port-display'");
lines.push("  | 'port-any';");
lines.push('');
lines.push("export type SideEffect =");
lines.push("  | 'ndi' | 'db' | 'state' | 'display' | 'ui' | 'audio'");
lines.push("  | 'players' | 'quiz' | 'engine' | 'all' | 'unsafe';");
lines.push('');
lines.push('export interface ArgDef {');
lines.push('  type: string;');
lines.push('  port: PortType;');
lines.push('  options?: string | string[];');
lines.push('  default?: unknown;');
lines.push('  accepts?: string;');
lines.push('  returns?: string;');
lines.push('}');
lines.push('');
lines.push('export interface BlockDef {');
lines.push('  opcode: string;');
lines.push('  category: string;');
lines.push('  type: BlockType;');
lines.push('  text: string;');
lines.push('  args: Record<string, ArgDef>;');
lines.push('  hasBody: boolean;');
lines.push('  bodies: string[] | null;');
lines.push("  exec: 'event' | 'sync' | 'async';");
lines.push('  returns: string | null;');
lines.push('  sideEffects: SideEffect[];');
lines.push('  scope: string | null;');
lines.push('  disabledInProd: boolean;');
lines.push('}');
lines.push('');
lines.push('export interface CategoryDef {');
lines.push('  id: string;');
lines.push('  label: string;');
lines.push('  colorVar: string;');
lines.push('  order: number;');
lines.push('  icon: string;');
lines.push('  desc: string;');
lines.push('}');
lines.push('');
lines.push('/* Opcodes por categoría (string-literal-union) ------------------ */');

for (const cat of CATEGORIES) {
  const name = `${cap(cat)}Opcode`;
  const ops = byCat[cat].slice().sort();
  lines.push(`export type ${name} =`);
  lines.push(union(ops) + ';');
  lines.push('');
}

lines.push('/* Interfaz del registro (espejo de scratch-blocks.js) ----------- */');
lines.push('export interface ScratchBlocks {');
lines.push('  CATEGORIES: Record<string, CategoryDef>;');
lines.push('  PORT: Record<string, PortType>;');
lines.push('  registry: Record<string, BlockDef>;');
lines.push('  get(opcode: string): BlockDef | null;');
lines.push('  exists(opcode: string): boolean;');
lines.push('  all(): string[];');
lines.push('  byCategory(catId: string): BlockDef[];');
lines.push('  categoriesOrdered(): CategoryDef[];');
lines.push('  portsCompatible(srcPort: string, dstPort: string): boolean;');
lines.push('}');
lines.push('');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(`gen_types: ${all.length} opcodes -> ${outPath}`);
for (const cat of CATEGORIES) {
  console.log(`  ${cap(cat).padEnd(12)} ${byCat[cat].length}`);
}
