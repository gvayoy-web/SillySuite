// sillybuild-bootstrap.js — Robust environment bootstrap for BuildSilly
// Provides polyfills, error handling, and module load tracking

(function() {
  'use strict';

  // Global polyfills
  window.global = window.global || window;
  window.globalThis = window.globalThis || window;

  // Module load tracker
  window.__SILLYBUILD_LOAD_STATE = {
    modules: [],
    errors: [],
    startTime: performance.now(),
    phase: 'bootstrap'
  };

  // Track script loading
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName, options) {
    const el = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'script' && !el.hasAttribute('data-no-track')) {
      const originalSetAttribute = el.setAttribute.bind(el);
      el.setAttribute = function(name, value) {
        if (name === 'src' && value && !value.includes('sillybuild-bootstrap')) {
          window.__SILLYBUILD_LOAD_STATE.modules.push({
            src: value,
            startTime: performance.now(),
            status: 'loading'
          });
          el.addEventListener('load', () => {
            const mod = window.__SILLYBUILD_LOAD_STATE.modules.find(m => m.src === value);
            if (mod) {
              mod.status = 'loaded';
              mod.endTime = performance.now();
              mod.duration = mod.endTime - mod.startTime;
            }
            window.__SILLYBUILD_LOAD_STATE.phase = 'modules-loading';
            updateSplashProgress();
          });
          el.addEventListener('error', () => {
            const mod = window.__SILLYBUILD_LOAD_STATE.modules.find(m => m.src === value);
            if (mod) {
              mod.status = 'error';
              mod.endTime = performance.now();
            }
            window.__SILLYBUILD_LOAD_STATE.errors.push({
              src: value,
              time: performance.now(),
              message: 'Failed to load script'
            });
            window.__SILLYBUILD_LOAD_STATE.phase = 'error';
            updateSplashProgress();
          });
        }
        return originalSetAttribute(name, value);
      };
    }
    return el;
  };

  // Expose progress update function (safe no-op; splash screen hooks override this)
  window.updateSplashProgress = function() {
    // Intentionally empty — overridden by splash screen if present
  };

  // Console error capture
  const originalError = console.error;
  console.error = function(...args) {
    window.__SILLYBUILD_LOAD_STATE.errors.push({
      time: performance.now(),
      message: args.join(' '),
      type: 'console.error'
    });
    originalError.apply(console, args);
  };

  // Unhandled promise rejection capture
  window.addEventListener('unhandledrejection', (e) => {
    window.__SILLYBUILD_LOAD_STATE.errors.push({
      time: performance.now(),
      message: e.reason?.message || String(e.reason),
      type: 'unhandledrejection'
    });
  });

  // Global error capture
  window.addEventListener('error', (e) => {
    window.__SILLYBUILD_LOAD_STATE.errors.push({
      time: performance.now(),
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      type: 'window.error'
    });
  });

  // Check for required APIs
  window.__SILLYBUILD_REQUIREMENTS = {
    esModules: typeof Symbol !== 'undefined' && typeof Promise !== 'undefined',
    webWorkers: typeof Worker !== 'undefined',
    blobUrls: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function',
    localStorage: (() => { try { localStorage.setItem('test', '1'); localStorage.removeItem('test'); return true; } catch { return false; } })(),
    requestAnimationFrame: typeof requestAnimationFrame !== 'undefined',
    intersectionObserver: typeof IntersectionObserver !== 'undefined',
    resizeObserver: typeof ResizeObserver !== 'undefined'
  };

  logInfo('BuildSilly bootstrap complete', { requirements: window.__SILLYBUILD_REQUIREMENTS });

  function logInfo(msg, data) {
    console.log(`%c[BuildSilly]%c ${msg}`, 'color: #FF5E3A; font-weight: bold', 'color: inherit', data || '');
  }

})();