// control-canva.js
// Responsabilidad: Infinite Canvas / Scratch Builder (iframe, hotkeys,
// auto-guardado, debug console). Se adjunta a `ctrl`.
import { ctrl, id } from './control-shared.js';
import { _modosSetMsg } from './control-modos.js';

/* ===== CANVA / INFINITE CANVAS ===== */
ctrl.canvaCargar = function () {
  const iframe = id('canvaIframe');
  if (!iframe) return;

  // Show loading state
  ctrl._modosSetMsg && ctrl._modosSetMsg('Cargando Canva…', true);

  // Reset iframe to force reload
  if (iframe.src && iframe.src !== 'about:blank') {
    iframe.src = 'about:blank';
    setTimeout(() => {
      iframe.src = '/html/modo-builder-v2.html';
    }, 50);
  } else {
    iframe.src = '/html/modo-builder-v2.html';
  }

  // Add load/error handlers
  iframe.onload = () => {
    ctrl._modosSetMsg && ctrl._modosSetMsg('✔ Canva cargado', true);
    const status = id('canvaStatus');
    if (status) status.textContent = '🟢 Activo';
  };
  iframe.onerror = () => {
    ctrl._modosSetMsg && ctrl._modosSetMsg('✗ Error cargando Canva', false);
    const status = id('canvaStatus');
    if (status) status.textContent = '🔴 Error';
  };
};

ctrl.canvaRecargar = function () {
  const iframe = id('canvaIframe');
  if (iframe) {
    iframe.src = '/html/modo-builder-v2.html';
    const status = id('canvaStatus');
    if (status) status.textContent = '🔄 Recargando…';
  }
};

ctrl.canvaPantallaCompleta = function () {
  const iframe = id('canvaIframe');
  if (iframe && iframe.requestFullscreen) {
    iframe.requestFullscreen().catch(e => console.warn('Fullscreen denied:', e));
  }
};

/* ===== CANVA HOTKEYS & AUTO-SAVE ===== */
ctrl.canvaInitHotkeys = function () {
  if (ctrl._canvaHotkeysBound) return;
  ctrl._canvaHotkeysBound = true;

  document.addEventListener('keydown', (e) => {
    // Alt+C -> Abrir/Enfocar CANVA
    if (e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      ctrl.selectTab('canva');
      return;
    }
    // Ctrl+S en CANVA -> Auto-save
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel && activePanel.id === 'panel-canva') {
        e.preventDefault();
        ctrl.canvaAutoGuardar();
      }
    }
    // F11 -> Fullscreen CANVA
    if (e.key === 'F11') {
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel && activePanel.id === 'panel-canva') {
        e.preventDefault();
        ctrl.canvaPantallaCompleta();
      }
    }
  });
};

/* ===== CANVA AUTO-SAVE / STATE ===== */
ctrl.canvaAutoGuardar = function () {
  const iframe = id('canvaIframe');
  if (!iframe || !iframe.contentWindow) return;

  // Pedir estado al builder via postMessage
  iframe.contentWindow.postMessage({ type: 'canva:request_state' }, '*');
  _modosSetMsg('💾 Guardando estado del canvas…', true);
};

ctrl.canvaRestaurar = function () {
  const iframe = id('canvaIframe');
  if (!iframe || !iframe.contentWindow) return;

  // Restaurar desde localStorage
  const saved = localStorage.getItem('canva_state');
  if (saved) {
    try {
      const state = JSON.parse(saved);
      iframe.contentWindow.postMessage({ type: 'canva:restore_state', state }, '*');
      _modosSetMsg('✅ Estado restaurado', true);
    } catch (e) {
      _modosSetMsg('✗ Error restaurando: ' + e.message, false);
    }
  } else {
    _modosSetMsg('No hay estado guardado', false);
  }
};

ctrl.canvaLimpiar = function () {
  if (!confirm('¿Borrar todo el canvas y empezar de cero?')) return;
  const iframe = id('canvaIframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'canva:clear_all' }, '*');
    localStorage.removeItem('canva_state');
    _modosSetMsg('🗑️ Canvas limpiado', true);
  }
};

/* ===== CANVA DEBUG CONSOLE ===== */
ctrl.canvaDebugConsole = function () {
  const iframe = id('canvaIframe');
  if (!iframe || !iframe.contentWindow) {
    _modosSetMsg('❌ Iframe no listo', false);
    return;
  }

  // Toggle debug panel
  let panel = id('canvaDebugPanel');
  if (panel) {
    panel.remove();
    return;
  }

  panel = document.createElement('div');
  panel.id = 'canvaDebugPanel';
  panel.style.cssText = `
    position:fixed; bottom:0; right:0; width:400px; max-height:300px;
    background:#1a1a1a; border:2px solid var(--ink); color:#0f0;
    font-family:monospace; font-size:11px; z-index:9999;
    display:flex; flex-direction:column; overflow:hidden;
    box-shadow: -4px -4px 0 var(--ink);
  `;
  panel.innerHTML = `
    <div style="background:var(--ink);color:#0f0;padding:8px 12px;font-weight:800;display:flex;justify-content:space-between;border-bottom:2px solid var(--ink);">
      <span>🐛 CANVA DEBUG CONSOLE</span>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#0f0;font-size:14px;cursor:pointer;">✕</button>
    </div>
    <div id="canvaDebugLog" style="flex:1;overflow-y:auto;padding:8px;font-family:monospace;font-size:10px;line-height:1.4;"></div>
    <div style="border-top:2px solid var(--ink);padding:8px;display:flex;gap:4px;">
      <input id="canvaDebugInput" style="flex:1;background:#000;color:#0f0;border:2px solid var(--ink);padding:4px;font-family:monospace;font-size:11px;" placeholder="Comando JS para inyectar en builder..." />
      <button class="btn btn-xs" onclick="ctrl.canvaDebugEjecutar()">▶ Ejecutar</button>
      <button class="btn btn-ghost btn-xs" onclick="ctrl.canvaDebugLimpiar()">🗑️</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Hook console.log del iframe
  ctrl._canvaDebugLog = (msg) => {
    const log = id('canvaDebugLog');
    if (log) {
      const line = document.createElement('div');
      line.style.cssText = 'border-bottom:1px solid #333;padding:2px 0;font-family:monospace;font-size:10px;color:#8f8;';
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
  };

  // Inyectar logger en el iframe
  iframe.contentWindow.postMessage({
    type: 'canva:debug_hook',
    enabled: true
  }, '*');

  _modosSetMsg('🐛 Debug console abierta', true);
};

ctrl.canvaDebugEjecutar = function () {
  const input = id('canvaDebugInput');
  const iframe = id('canvaIframe');
  if (!input || !iframe || !iframe.contentWindow) return;

  const code = input.value;
  if (!code.trim()) return;

  iframe.contentWindow.postMessage({
    type: 'canva:debug_exec',
    code
  }, '*');

  ctrl._canvaDebugLog('>> ' + code);
  input.value = '';
};

ctrl.canvaDebugLimpiar = function () {
  const log = id('canvaDebugLog');
  if (log) log.innerHTML = '';
};
