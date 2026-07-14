/**
 * i18n.js — Capa de internacionalización de SillyQuiz (ES ⇄ EN).
 *
 * Uso:
 *   I18N.t('run')                 -> 'Ejecutar' | 'Run'
 *   I18N.t('toastSavedServer', {id:'x'}) -> usa {id} en la plantilla
 *   I18N.setLang('en')            -> persiste en localStorage + dispara onChange
 *   I18N.getLang()                -> 'es' | 'en'
 *   I18N.mountSwitcher(el)        -> inyecta un <select> de idioma en `el`
 *
 * Diseño: diccionario embebido (sin fetch, funciona en file:// y http).
 * `t()` hace fallback al key si falta la traducción, así la cobertura puede
 * crecer de forma incremental sin romper nada.
 */
(function (global) {
  'use strict';

  const LANGS = ['es', 'en'];

  const DICT = {
    es: {
      __lang_name: 'Español',
      // --- Toolbar ---
      run: 'Ejecutar', panic: 'Pánico', undo: 'Deshacer', redo: 'Rehacer',
      clear: 'Limpiar', preview: 'Vista', export: 'Exportar', import: 'Importar',
      saveLocal: 'Guardar', saveServer: 'Servidor', loadLocal: 'Cargar',
      docs: 'Documentación', dark: 'Tema', zoomIn: 'Acercar', zoomOut: 'Alejar',
      zoomReset: 'Zoom', resetView: 'Centrar', customizer: 'Personalizar',
      perf: 'Rendimiento', shortcuts: 'Atajos', brand: 'Modo Builder',
      // --- Estado / consola ---
      statusReady: 'Listo', statusRunning: 'Ejecutando…',
      statusCompileFail: 'Compilación falló', statusValidFail: 'Validación falló',
      statusExecuted: 'Ejecutado', statusError: 'Error en ejecución',
      statusPanic: 'PÁNICO — hilos detenidos', statusStopped: 'Detenido por pánico',
      // --- Toasts ---
      toastExported: 'Plantilla exportada',
      toastDraftSaved: 'Borrador guardado en el navegador',
      toastDraftLoaded: 'Borrador cargado',
      toastNoDraft: 'No hay borrador guardado',
      toastSavedServer: 'Modo guardado en el servidor: {id}',
      toastSaveCancel: 'Guardado cancelado',
      toastServerErr: 'Error servidor: {err}',
      toastSaveErr: 'Error al guardar: {err}',
      toastNetErr: 'Error de red: {err}',
      toastImported: 'Plantilla importada: {name}',
      toastImportErr: 'Error al importar: {err}',
      // --- Visualizador ---
      previewEmpty: 'Arrastra bloques al lienzo…',
      previewTrace: 'Cadena de ejecución',
      previewUnavailable: 'Vista previa no disponible: {err}',
      hintCanvas: 'Arrastra bloques desde la paleta, o pulsa un bloque para añadirlo.',
      hintDrop: 'Arrastra bloques aquí'
    },
    en: {
      __lang_name: 'English',
      run: 'Run', panic: 'Panic', undo: 'Undo', redo: 'Redo',
      clear: 'Clear', preview: 'Preview', export: 'Export', import: 'Import',
      saveLocal: 'Save', saveServer: 'Server', loadLocal: 'Load',
      docs: 'Docs', dark: 'Theme', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
      zoomReset: 'Zoom', resetView: 'Center', customizer: 'Customize',
      perf: 'Performance', shortcuts: 'Shortcuts', brand: 'Mode Builder',
      statusReady: 'Ready', statusRunning: 'Running…',
      statusCompileFail: 'Compilation failed', statusValidFail: 'Validation failed',
      statusExecuted: 'Executed', statusError: 'Execution error',
      statusPanic: 'PANIC — threads stopped', statusStopped: 'Stopped by panic',
      toastExported: 'Template exported',
      toastDraftSaved: 'Draft saved in browser',
      toastDraftLoaded: 'Draft loaded',
      toastNoDraft: 'No saved draft',
      toastSavedServer: 'Mode saved on server: {id}',
      toastSaveCancel: 'Save cancelled',
      toastServerErr: 'Server error: {err}',
      toastSaveErr: 'Save error: {err}',
      toastNetErr: 'Network error: {err}',
      toastImported: 'Template imported: {name}',
      toastImportErr: 'Import error: {err}',
      previewEmpty: 'Drag blocks onto the canvas…',
      previewTrace: 'Execution chain',
      previewUnavailable: 'Preview unavailable: {err}',
      hintCanvas: 'Drag blocks from the palette, or tap a block to add it.',
      hintDrop: 'Drag blocks here'
    }
  };

  let current = 'es';
  try {
    const saved = localStorage.getItem('sq-lang');
    if (saved && DICT[saved]) current = saved;
  } catch (e) { /* ignore */ }
  try { document.documentElement.setAttribute('lang', current); } catch (e) {}

  function t(key, vars) {
    const table = DICT[current] || DICT.es;
    let s = (table && table[key] != null) ? table[key] : (DICT.es[key] != null ? DICT.es[key] : key);
    if (vars && typeof s === 'string') {
      Object.keys(vars).forEach(k => {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return s;
  }

  function setLang(lang) {
    if (!DICT[lang]) return;
    current = lang;
    try { localStorage.setItem('sq-lang', lang); } catch (e) {}
    try { document.documentElement.setAttribute('lang', lang); } catch (e) {}
    (global.__i18nHandlers || []).forEach(h => { try { h(lang); } catch (e) {} });
  }

  function getLang() { return current; }

  function onChange(handler) {
    (global.__i18nHandlers = global.__i18nHandlers || []).push(handler);
  }

  function mountSwitcher(container, opts) {
    if (!container || typeof document === 'undefined') return null;
    const sel = document.createElement('select');
    sel.className = 'lang-switch' + (opts && opts.className ? ' ' + opts.className : '');
    sel.setAttribute('aria-label', 'Language');
    LANGS.forEach(l => {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = (DICT[l] && DICT[l].__lang_name) || l.toUpperCase();
      sel.appendChild(o);
    });
    sel.value = current;
    sel.addEventListener('change', () => setLang(sel.value));
    container.appendChild(sel);
    return sel;
  }

  const I18N = { t, setLang, getLang, onChange, mountSwitcher, LANGS, DICT };
  global.I18N = I18N;
})(typeof window !== 'undefined' ? window : this);
