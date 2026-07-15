/**
 * sandbox-executor.js — Orquestador principal del Sandbox de ejecución.
 *
 * Módulo ES del hilo principal. Lanza sandbox-worker.js en un Web Worker,
 * envía el programa AOT y devuelve el resultado. Si el worker se pasa del
 * timeout o lanza un error, lo MATA con worker.terminate() para garantizar
 * que un mod descontrolado no deje un hilo zombie colgado.
 *
 * Opt-in: SANDBOX_ENABLED = false. El path en vivo sigue usando
 * scratch-runtime.js en el hilo principal; este módulo NO se importa aún.
 *
 * Sin dependencias externas.
 */

export const SANDBOX_ENABLED = false;

/**
 * Ejecuta un programa AOT dentro del sandbox (Web Worker).
 *
 * @param {object} program      Programa AOT: { scripts: { hat: [nodos] } } o array de nodos.
 * @param {object} initialState Estado inicial serializable.
 * @param {object} opts         { timeoutMs = 2000, workerUrl? }
 * @returns {Promise<{ok:boolean, state?:any, intents?:any[], error?:string}>}
 */
export async function executeInSandbox(program, initialState, opts = {}) {
  const timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 2000;

  return new Promise((resolve) => {
    let worker = null;
    let settled = false;
    let timer = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (worker) {
        try { worker.terminate(); } catch (_) { /* ignore */ }
      }
      resolve(value);
    };

    try {
      const url = opts.workerUrl || new URL('./sandbox-worker.js', import.meta.url);
      worker = new Worker(url, { type: 'module' });
    } catch (e) {
      finish({ ok: false, error: 'worker-spawn-failed: ' + (e && e.message ? e.message : String(e)) });
      return;
    }

    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'result') {
        finish({ ok: true, state: m.state, intents: m.intents || [] });
      } else if (m.type === 'error') {
        finish({ ok: false, error: m.message || 'worker-error' });
      } else if (m.type === 'intents') {
        finish({ ok: true, state: m.state, intents: m.intents || [] });
      }
    };

    worker.onerror = (e) => {
      finish({ ok: false, error: 'worker-error: ' + (e && e.message ? e.message : 'unknown') });
    };

    // Guarda de red: si el worker no responde, lo matamos igualmente.
    timer = setTimeout(() => {
      finish({ ok: false, error: 'timeout-after-' + timeoutMs + 'ms' });
    }, timeoutMs);

    worker.postMessage({ type: 'exec', program, initialState, timeoutMs });
  });
}

export default { SANDBOX_ENABLED, executeInSandbox };
