/**
 * control-panel.test.js — Tests for the control panel API layer (control-api.js)
 * and core UI logic (sillycontrol-core.js).
 *
 * Ejecutar: node tests/control-panel.test.js
 * (No requiere framework externo — usa asserts nativos de Node.js)
 */
'use strict';

const assert = require('assert');

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

// ── Test: control-api.js exports ──
console.log('\n🧪 control-api.js — API Layer Tests\n');

test('control-api.js defines API base URL', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes("window.location.origin + '/api'"), 'API URL must use window.location.origin');
});

test('control-api.js exports fetchRetry', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export async function fetchRetry'), 'Must export fetchRetry');
});

test('control-api.js exports apiPost', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export function apiPost'), 'Must export apiPost');
});

test('control-api.js exports apiPut', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export function apiPut'), 'Must export apiPut');
});

test('control-api.js exports apiDelete', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export function apiDelete'), 'Must export apiDelete');
});

test('control-api.js exports connectSSE', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export function connectSSE'), 'Must export connectSSE');
});

test('control-api.js exports disconnectSSE', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('export function disconnectSSE'), 'Must export disconnectSSE');
});

test('control-api.js sends CSRF token in auth headers', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes("X-CSRF-Token"), 'Must include X-CSRF-Token header');
});

test('control-api.js handles 401 auth redirect', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes("window.location.href = '/login'"), 'Must redirect to /login on 401');
});

test('control-api.js retry logic in fetchRetry', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('retries'), 'fetchRetry must have retry parameter');
  assert(code.includes('delay'), 'fetchRetry must have delay parameter');
});

test('control-api.js re-exports from sillycontrol-api.js', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'control-api.js'),
    'utf8'
  );
  assert(code.includes("./sillycontrol-api.js"), 'Must re-export from sillycontrol-api');
});

// ── Test: sillycontrol-core.js structure ──
console.log('\n🧪 sillycontrol-core.js — Core UI Tests\n');

test('sillycontrol-core.js imports from control-api.js', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes("from './control-api.js'"), 'Must import from control-api.js');
});

test('sillycontrol-core.js exposes ctrl on window', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('window.ctrl = ctrl'), 'Must expose ctrl on window');
});

test('sillycontrol-core.js has undo/redo system', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('_undoStack'), 'Must have undo stack');
  assert(code.includes('_redoStack'), 'Must have redo stack');
  assert(code.includes('MAX_UNDO'), 'Must have MAX_UNDO limit');
});

test('sillycontrol-core.js has keyboard shortcut for undo (Ctrl+Z)', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes("e.ctrlKey && e.key === 'z'"), 'Must have Ctrl+Z undo shortcut');
});

test('sillycontrol-core.js has keyboard shortcut for redo (Ctrl+Y)', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes("e.key === 'y'"), 'Must have Ctrl+Y redo shortcut');
});

test('sillycontrol-core.js has XSS-safe esc() function', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('function esc('), 'Must have esc() function');
  assert(code.includes('&amp;'), 'Must escape ampersands');
  assert(code.includes('&lt;'), 'Must escape less-than');
});

test('sillycontrol-core.js has tab switching', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('ctrl.selectTab'), 'Must have selectTab');
  assert(code.includes('initTabs'), 'Must have initTabs');
});

test('sillycontrol-core.js has toast notification system', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('function toast('), 'Must have toast()');
  assert(code.includes('toastSuccess'), 'Must have toastSuccess');
  assert(code.includes('toastError'), 'Must have toastError');
});

test('sillycontrol-core.js has abbreviation function for long names', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('function abbreviateName'), 'Must have abbreviateName');
});

test('sillycontrol-core.js has escape detection for input fields', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('function isEnInput'), 'Must have isEnInput');
  assert(code.includes('INPUT'), 'Must check for INPUT element');
  assert(code.includes('TEXTAREA'), 'Must check for TEXTAREA element');
});

test('sillycontrol-core.js has salirTodo (exit all) function', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('ctrl.salirTodo'), 'Must have salirTodo');
  assert(code.includes("/salir'"), 'Must call /salir endpoint');
});

test('sillycontrol-core.js has resetTodo function', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-core.js'),
    'utf8'
  );
  assert(code.includes('ctrl.resetTodo'), 'Must have resetTodo');
  assert(code.includes('/reset-todo'), 'Must call /reset-todo endpoint');
});

// ── Test: sillycontrol-api.js SSE logic ──
console.log('\n🧪 sillycontrol-api.js — SSE Connection Tests\n');

test('sillycontrol-api.js has SSE retry with exponential backoff', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('sseRetry = Math.min(sseRetry * 2, 20000)'), 'Must have exponential backoff capped at 20s');
});

test('sillycontrol-api.js falls back from EventSource to fetch SSE', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('startSseFetch'), 'Must have startSseFetch fallback');
  assert(code.includes('EventSource'), 'Must use EventSource');
});

test('sillycontrol-api.js disconnectSSE cleans up resources', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes('_sseStopped = true'), 'disconnectSSE must set _sseStopped');
  assert(code.includes('_sseFetchCtrl.abort()'), 'disconnectSSE must abort fetch controller');
});

test('sillycontrol-api.js sends credentials with requests', () => {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'sillycontrol-api.js'),
    'utf8'
  );
  assert(code.includes("credentials: 'same-origin'"), 'Must send credentials same-origin');
});


console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
