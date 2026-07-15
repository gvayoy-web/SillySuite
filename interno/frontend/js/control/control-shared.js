// control-shared.js
// Infraestructura compartida del Panel de Control (SillyQuiz).
// Exporta el singleton `ctrl` (la API pública global) y los helpers
// transversales usados por sillycontrol-core.js y por los módulos de
// responsabilidad (control-modos.js, control-canva.js, control-audio.js).
// No importa nada del core para evitar ciclos.

export const ctrl = {};
if (typeof window !== 'undefined') window.ctrl = ctrl;

export function id(el) { return document.getElementById(el); }

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function abbreviateName(name, maxLen) {
  if (!name || name.length <= (maxLen || 20)) return name || '';
  var words = name.split(/\s+/);
  if (words.length <= 1) return name.slice(0, (maxLen || 20) - 1) + '…';
  return words.map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 6);
}

export function isEnInput() {
  const t = document.activeElement?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

export function toast(msg, dur = 2000, type = 'info') {
  const el = document.getElementById('toast');
  if (el) {
    el.textContent = msg;
    el.className = 'toast show toast-' + type;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), dur);
  }
}

export function toastSuccess(msg, dur) { toast(msg, dur || 2000, 'success'); }
export function toastError(msg, dur) { toast(msg, dur || 3000, 'error'); }
export function toastWarning(msg, dur) { toast(msg, dur || 2500, 'warning'); }
export function toastInfo(msg, dur) { toast(msg, dur || 2000, 'info'); }
