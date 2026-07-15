// control-modos.js
// Responsabilidad: modos del constructor Scratch (importar/exportar .lkqmode,
// ejecutar en el display, gestión en localStorage). Se adjunta a `ctrl`.
import { ctrl, id, esc } from './control-shared.js';
import { API } from '../control-api.js';

export const MODOS_KEY = 'sillyquiz_modos';

export function _modosSetMsg(t, ok) {
  const el = id('modosMsg');
  if (!el) return;
  el.textContent = t;
  el.style.color = ok === false ? 'var(--red)' : (ok ? 'var(--green)' : 'var(--text-muted)');
}
export function _modosSetStatus(t) {
  const el = id('modosStatus');
  if (el) el.textContent = t;
}
export function _modosList() {
  try { return JSON.parse(localStorage.getItem(MODOS_KEY) || '[]'); }
  catch (e) { return []; }
}

ctrl.modosCargar = async function () {
  const list = _modosList();
  const wrap = id('modosList');
  const sel = id('modosSelect');
  if (wrap) {
    wrap.innerHTML = list.length
      ? list.map((md, i) => `
          <div class="flex-row justify-between" style="align-items:center;gap:8px;">
            <span class="text-sm">🧩 ${esc(md.name || ('Modo ' + i))}</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-primary btn-xs" onclick="ctrl.exportarModoPaquete(${i})" title="Exportar .lkqmode">📦</button>
              <button class="btn btn-ghost btn-xs" onclick="ctrl.modosEliminar(${i})">🗑</button>
            </div>
          </div>`).join('')
      : '<em class="text-xs text-muted">Sin modos guardados. Pega un JSON del constructor y pulsa "Guardar modo".</em>';
  }
  if (sel) {
    sel.innerHTML = list.length
      ? list.map((md, i) => `<option value="${i}">${esc(md.name || ('Modo ' + i))}</option>`).join('')
      : '<option value="">— sin modos —</option>';
  }
};

ctrl.modosImportar = async function () {
  const ta = id('modosJsonInput');
  const raw = (ta && ta.value || '').trim();
  if (!raw) { _modosSetMsg('Pega un JSON primero.', false); return; }
  let json;
  try { json = JSON.parse(raw); }
  catch (e) { _modosSetMsg('JSON inválido: ' + e.message, false); return; }
  if (json.type !== 'scratch-mode' && !json.heads) {
    _modosSetMsg('No parece un modo Scratch válido (falta "heads").', false); return;
  }
  const list = _modosList();
  list.push({ name: json.name || ('Modo ' + new Date().toLocaleTimeString()), json, savedAt: Date.now() });
  localStorage.setItem(MODOS_KEY, JSON.stringify(list));
  _modosSetMsg('✔ Modo guardado: ' + (json.name || ''), true);
  ctrl.modosCargar();
};

ctrl.modosCargarArchivo = function (e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { const ta = id('modosJsonInput'); if (ta) ta.value = r.result; };
  r.readAsText(f);
  e.target.value = '';
};

ctrl.modosPegarDesdeBuilder = async function () {
  try {
    const t = await navigator.clipboard.readText();
    if (t) { const ta = id('modosJsonInput'); if (ta) ta.value = t; _modosSetMsg('Pegado desde portapapeles.', true); return; }
  } catch (err) {}
  window.open('/html/modo-builder-v2.html', '_blank');
  _modosSetMsg('Abre el constructor, copia el JSON y pégalo aquí.', false);
};

ctrl.modosEliminar = async function (i) {
  const list = _modosList();
  list.splice(i, 1);
  localStorage.setItem(MODOS_KEY, JSON.stringify(list));
  ctrl.modosCargar();
};

/* Importa un modo empaquetado .lkqmode (ZIP con manifest.json + assets/).
   El servidor sanea cada asset (magic-bytes, tamaño, sin ejecutables) antes
   de registrarlo. Estética brutalista: input oculto + botón. */
ctrl.importarModoPaquete = async function (event) {
  const f = event.target.files && event.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  _modosSetMsg('Subiendo y saneando paquete…', true);
  try {
    const r = await fetch(API + '/mode-packages/import', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok || !data.success) {
      const errs = (data.errors && data.errors.join('; ')) || data.error || 'error';
      _modosSetMsg('✗ Import falló: ' + errs, false);
    } else {
      _modosSetMsg('✔ Modo importado: ' + data.nombre + ' (' + data.assets + ' assets)', true);
    }
  } catch (e) {
    _modosSetMsg('✗ Error de red: ' + e.message, false);
  }
  event.target.value = '';
};

/* Exporta un modo guardado como .lkqmode (ZIP con manifest.json + assets/).
   Usa el endpoint /api/mode-packages/<id>/export. */
ctrl.exportarModoPaquete = async function (modeId) {
  const list = _modosList();
  const md = list[modeId];
  if (!md) { _modosSetMsg('Modo no encontrado.', false); return; }
  _modosSetMsg('Generando paquete .lkqmode…', true);
  try {
    const r = await fetch(API + '/mode-packages/' + encodeURIComponent(md.id || modeId) + '/export');
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || 'Error ' + r.status);
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (md.name || 'modo').toLowerCase().replace(/\s+/g, '-') + '.lkqmode';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    _modosSetMsg('✔ Paquete .lkqmode descargado', true);
  } catch (e) {
    _modosSetMsg('✗ Export falló: ' + e.message, false);
  }
};

ctrl.modosEjecutar = async function () {
  const sel = id('modosSelect');
  const i = sel ? sel.value : '';
  const list = _modosList();
  const md = list[i];
  if (!md) { _modosSetMsg('Selecciona un modo guardado.', false); return; }
  const iframe = id('modosEngine');
  if (!iframe || !iframe.contentWindow) { _modosSetMsg('Motor de modos no disponible.', false); return; }
  _modosSetStatus('Ejecutando: ' + (md.name || ''));
  iframe.contentWindow.postMessage({ type: 'mode:run', json: md.json, head: 'on_mode_init' }, '*');
  _modosSetMsg('▶ Enviado al motor. El display debería reaccionar vía WebSocket.', true);
};

ctrl.modosInitHead = function () {
  const iframe = id('modosEngine');
  if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'mode:head', head: 'on_mode_init' }, '*');
};

ctrl.modosDetener = function () {
  const iframe = id('modosEngine');
  if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'mode:stop' }, '*');
  _modosSetStatus('Detenido');
};
