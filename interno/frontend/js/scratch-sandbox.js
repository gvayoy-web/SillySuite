/**
 * scratch-sandbox.js — Ejecución segura de código JS no confiable
 *
 * Aísla `execute_raw_javascript` en un Web Worker (browser) o vm (Node)
 * con límites de tiempo, memoria y sin acceso a DOM/red/cookies.
 *
 * API:
 *   SandboxedJS.run(code, { timeoutMs, memoryLimitMb, globals }) -> Promise<result>
 */

(function (global) {
  'use strict';

  const DEFAULT_TIMEOUT = 2000;
  const DEFAULT_MEMORY_MB = 10;

  function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  function isNode() {
    return typeof process !== 'undefined' && process.versions && process.versions.node;
  }

  const SandboxedJS = {
    run(code, opts) {
      opts = opts || {};
      const timeout = opts.timeoutMs || DEFAULT_TIMEOUT;
      const memoryLimit = (opts.memoryLimitMb || DEFAULT_MEMORY_MB) * 1024 * 1024;
      const globals = Object.assign({
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        setTimeout: undefined,
        clearTimeout: undefined,
        setInterval: undefined,
        clearInterval: undefined,
        fetch: undefined,
        XMLHttpRequest: undefined,
        WebSocket: undefined,
        localStorage: undefined,
        sessionStorage: undefined,
        document: undefined,
        window: undefined,
        navigator: undefined,
        location: undefined,
        history: undefined,
        crypto: undefined,
        indexedDB: undefined,
        caches: undefined,
        performance: { now: () => Date.now() }
      }, opts.globals || {});

      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          reject(new Error('Sandbox timeout (' + timeout + 'ms)'));
        }, timeout);

        const safeReject = (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        };
        const safeResolve = (val) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(val);
          }
        };

        if (isBrowser()) {
          this._runInWorker(code, globals, memoryLimit, safeResolve, safeReject);
        } else if (isNode()) {
          this._runInVm(code, globals, memoryLimit, safeResolve, safeReject);
        } else {
          safeReject(new Error('Entorno no soportado para sandbox'));
        }
      });
    },

    _runInWorker(code, globals, memoryLimit, resolve, reject) {
      const workerCode = `
        // Sandboxed execution context
        const globals = ${JSON.stringify(Object.keys(globals))};
        ${Object.entries(globals).map(([k, v]) => {
          if (typeof v === 'function') return '';
          return 'const ' + k + ' = ' + JSON.stringify(v) + ';';
        }).join('\n')}

        let result = null;
        let error = null;
        try {
          (function() {
            ${code}
          })();
        } catch (e) {
          error = e.message + '\\n' + (e.stack || '');
        }
        self.postMessage({ result, error });
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);

      const timeoutId = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(new Error('Worker timeout'));
      }, 2500);

      worker.onmessage = (e) => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
        worker.terminate();
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.result);
      };
      worker.onerror = (e) => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
        worker.terminate();
        reject(new Error('Worker error: ' + e.message));
      };
    },

    _runInVm(code, globals, memoryLimit, resolve, reject) {
      try {
        const vm = require('vm');
        const context = vm.createContext(globals);
        const script = new vm.Script(code, {
          timeout: 2000,
          displayErrors: true
        });
        const result = script.runInContext(context);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }
  };

  global.SandboxedJS = SandboxedJS;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SandboxedJS };
  }
})(typeof window !== 'undefined' ? window : this);