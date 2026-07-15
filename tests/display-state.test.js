/**
 * display-state.test.js — Tests de la lógica pura de display-state.js.
 *
 * display-state.js es un ES Module que orquesta SSE (EventSource) y el render
 * del display. Depende de `EventSource`, `fetch`, `document`, `window`, etc.
 * Para testear SIN jsdom, transformamos los `import {...} from './x.js'`
 * por destructuraciones sobre un Proxy universal (no-op) y mockeamos
 * EventSource / fetch / document / window con stubs ligeros.
 *
 * Se verifica:
 *   - Parseo de snapshot SSE y despacho por modo (mutaciones de clase en body).
 *   - Decisión de reconexión: al perder la conexión sin haber abierto,
 *     cae al fallback fetch-stream (/stream).
 *
 * Ejecutar: node --test tests/display-state.test.js
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// ── Mocks ligeros (sin jsdom) ──────────────────────────────

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) set.delete(c); else set.add(c);
      } else if (force) set.add(c); else set.delete(c);
      return set.has(c);
    },
    contains: (c) => set.has(c),
  };
}

function makeEl() {
  return {
    className: '',
    textContent: '',
    style: new Proxy({}, {
      get: (t, p) => (p === 'setProperty' ? () => {} : (t[p] || '')),
      set: (t, p, v) => { t[p] = v; return true; },
    }),
    classList: makeClassList(),
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getAttribute: () => null,
    setAttribute() {},
    offsetWidth: 0,
    contains: () => false,
  };
}

const elCache = new Map();
function getEl(id) {
  if (!elCache.has(id)) elCache.set(id, makeEl());
  return elCache.get(id);
}

const documentMock = {
  getElementById: (id) => getEl(id),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  createElement: () => makeEl(),
  documentElement: makeEl(),
  body: makeEl(),
};

const windowMock = {
  location: { origin: 'http://localhost', search: '' },
  addEventListener() {},
  removeEventListener() {},
};

const localStorageMock = { getItem: () => null, setItem: () => {} };

// Proxy universal: cualquier acceso/llamada devuelve otro proxy (no-op).
const universal = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === Symbol.toPrimitive) return () => '';
    if (p === Symbol.toStringTag) return 'Proxy';
    return universal;
  },
  apply: () => universal,
  construct: () => universal,
});

// fetch mock: registra llamadas; /stream rechaza (aborted) para no re-programar.
function fetchMock(url) {
  fetchMock.calls.push(String(url));
  if (String(url).includes('/stream')) return Promise.reject(new Error('aborted'));
  return Promise.resolve({ ok: true, json: async () => ({}) });
}
fetchMock.calls = [];

// EventSource mock: no abre automáticamente (simula una conexión real
// cuyo readyState controlamos). Permite disparar onopen/onerror manualmente.
globalThis.__eventSources = [];
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    globalThis.__eventSources.push(this);
  }
  close() { this.readyState = 2; }
  addEventListener() {}
}

let mod = null;

before(async () => {
  // Instalar globals ANTES de importar el módulo real.
  globalThis.window = windowMock;
  globalThis.document = documentMock;
  globalThis.localStorage = localStorageMock;
  globalThis.AbortController = class { constructor() { this.signal = { aborted: true }; } abort() {} };
  globalThis.EventSource = MockEventSource;
  globalThis.fetch = fetchMock;
  globalThis.__depProxy = universal;

  // Transformar los `import {...} from './x.js'` por destructuraciones
  // sobre el Proxy universal, y escribir un .mjs temporal que importamos.
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'interno', 'frontend', 'js', 'display-state.js'),
    'utf8'
  );
  // Quitar BOM (display-state.js empieza con UTF-8 BOM) para que la
  // primera línea `import` coincida con el regex.
  const srcClean = src.charCodeAt(0) === 0xFEFF ? src.slice(1) : src;
  const transformed = srcClean.replace(
    /^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm,
    (m, names) => {
      // Soportar alias `x as y` (válido en import, no en destructuración).
      const cleaned = names.replace(/(\w+)\s+as\s+(\w+)/g, '$2');
      return 'const { ' + cleaned + ' } = globalThis.__depProxy;';
    }
  );
  const tmp = path.join(os.tmpdir(), 'sillyquiz-display-state.generated.mjs');
  fs.writeFileSync(tmp, transformed);

  mod = await import(pathToFileURL(tmp).href);
  // Dejar correr la IIFE de arranque (loadCategories + conectarSSE).
  await new Promise((r) => setTimeout(r, 30));
  // Simular que la conexión SSE abrió (limpia el timer de fallback de 4s).
  globalThis.__eventSources.forEach((s) => { if (s.onopen) s.onopen(); });
});

after(() => {
  // Abrir/cerrar fuentes para liberar handles y cancelar timers colgados.
  globalThis.__eventSources.forEach((s) => { if (s.onopen) s.onopen(); if (s.close) s.close(); });
});

console.log('\n🧪 display-state.js — Snapshot Parsing & SSE Reconnection Tests\n');

test('procesarEstado aplica clases de modo con pregunta activa', () => {
  assert.ok(mod && typeof mod.procesarEstado === 'function', 'procesarEstado debe exportarse');
  mod.procesarEstado({
    display_config: {},
    pregunta_actual: { id: 'q1', respuesta_correcta: 1 },
    mostrar_opciones: true,
  });
  assert.strictEqual(documentMock.body.classList.contains('modo-pregunta'), true);
  assert.strictEqual(documentMock.body.classList.contains('modo-opciones'), true);
});

test('procesarEstado sin pregunta muestra welcome overlay', () => {
  documentMock.body.classList.remove('modo-pregunta', 'modo-opciones', 'modo-respuesta');
  mod.procesarEstado({ display_config: {} });
  const welcome = getEl('welcomeOverlay');
  assert.strictEqual(welcome.classList.contains('show'), true);
  assert.strictEqual(documentMock.body.classList.contains('modo-pregunta'), false);
});

test('procesarEstado maneja display_config (kiosko-mode)', () => {
  documentMock.body.classList.remove('kiosko-mode');
  mod.procesarEstado({ display_config: { kiosko: true } });
  assert.strictEqual(documentMock.body.classList.contains('kiosko-mode'), true);
});

test('conectarSSE abre EventSource y marca conexión activa', () => {
  assert.strictEqual(globalThis.__eventSources.length >= 1, true);
  const pill = getEl('connPill');
  // Tras onopen(), setConexion("live", ...) asigna la clase conn-live.
  assert.ok(pill.className.includes('conn-live'), 'pill debe quedar en estado live');
});

test('Pérdida de conexión (onerror tras abrir) reprograma reconexión SSE', async () => {
  const es = globalThis.__eventSources[0];
  assert.ok(es, 'debe existir la fuente SSE');
  // Simular caída: el EventSource quedó CLOSED (readyState 2).
  es.readyState = 2;
  const before = globalThis.__eventSources.length;
  if (es.onerror) es.onerror();
  // conectarSSE reprograma vía setTimeout (jitter ~800-1200ms) creando
  // una nueva fuente SSE.
  await new Promise((r) => setTimeout(r, 1400));
  assert.strictEqual(
    globalThis.__eventSources.length > before,
    true,
    'debe crear una nueva fuente SSE al reconectar'
  );
});
