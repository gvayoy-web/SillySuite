import { API, fetchRetry, apiPost, apiPut, connectSSE } from './control-api.js';

const ctrl = {};
window.ctrl = ctrl;

ctrl.versosIniciar = async function() {
  const timer = parseInt(id('versosTimer')?.value || '60', 10);
  const res = await apiPost('/modo/verses/iniciar', { timer: timer });
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('✔ Modo versos iniciado');
  const updated = await fetchRetry(API + '/estado-actual').catch(() => ({}));
  state = { ...state, ...updated };
  renderVersos();
};

ctrl.salirTodo = async function() {
  try {
    await apiPost('/salir');
    state.modo_activo = '';
    state.pregunta_actual = null;
    state.mostrar_respuesta = false;
    state.mostrar_opciones = false;
    state.opcion_seleccionada = null;
    state.temporizador = { activo: false, segundos_restantes: 0, segundos_totales: 0 };
    state.display_config = state.display_config || {};
    state.display_config.frozen = false;
    state.display_config.black_screen = false;
    state.display_config.clean = true;
    state.display_config.final_round = false;
    state.display_config.final_results = false;
    if (pregActualCache) {
      pregActualCache = null;
      document.getElementById('actualLabel') && (document.getElementById('actualLabel').textContent = 'Sin selección');
      document.getElementById('actualPreview') && document.getElementById('actualPreview').classList.add('hidden');
    }
    renderAll();
    toast('🚪 Modo salido — esperando pregunta');
  } catch (error) {
    toast('❌ Error');
  }
};

ctrl.resetTodo = async function() {
  if (!confirm('¿RESET COMPLETO?')) return;
  try {
    await fetchRetry(API + '/reset-todo', { method: 'POST' });
    selectedId = null;
    id('btnProyectar').disabled = true;
    await cargarPreguntas();
    toast('⚠ Todo reiniciado');
  } catch {
    toast('❌ Error');
  }
};

ctrl.versosDetener = async function() {
  const res = await apiPost('/modo/verses/cerrar');
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('✔ Modo versos detenido');
  state = { ...state, ...(await fetchRetry(API + '/estado-actual').catch(() => ({}))) };
  renderVersos();
};

ctrl.versosPausar = async function() {
  const res = await apiPost('/modo/verses/pausar');
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('⏸ Pausado');
  renderVersos();
};

ctrl.versosReanudar = async function() {
  const res = await apiPost('/modo/verses/reanudar');
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('▶ Reanudado');
  renderVersos();
};

ctrl.versosResetTimer = async function() {
  const res = await apiPost('/modo/verses/reset_timer');
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('✔ Timer reiniciado');
  renderVersos();
};

ctrl.versosAwardPoints = async function() {
  const grupo = id('versosGroupSelect')?.value;
  const puntos = parseInt(id('versosPointsInput')?.value || '10', 10);
  if (!grupo) { toast('⚠ Selecciona un grupo'); return; }
  if (puntos <= 0) { toast('⚠ Los puntos deben ser positivos'); return; }
  const res = await apiPost('/modo/verses/responder', { grupo: grupo, puntos: puntos });
  if (res.error) { toast('⚠ ' + res.error); return; }
  toast('✔ ' + grupo + ' +' + puntos + ' pts');
  state = { ...state, ...(await fetchRetry(API + '/estado-actual').catch(() => ({}))) };
  renderVersos();
};

// State
let state = {
  puntos: {},
  grupos: [],
  pregunta_actual: null,
  mostrar_respuesta: false,
  mostrar_opciones: false,
  opcion_seleccionada: null,
  temporizador: { activo: false, segundos_restantes: 0, segundos_totales: 0 },
  actividad: [],
  display_config: {},
  ruleta: {},
  hangman: {},
  verses: {},
  modo_activo: ''
};

// ── Undo/Redo System ──
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 20;

function pushUndoAction(action) {
  _undoStack.push(action);
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
}

ctrl.undo = async function() {
  if (_undoStack.length === 0) { toast('⚠ Nada para deshacer'); return; }
  const action = _undoStack.pop();
  _redoStack.push(action);
  try {
    if (action.undoFn) await action.undoFn();
    toast('⬅ Deshacer: ' + action.description);
  } catch { toast('❌ Error al deshacer'); }
};

ctrl.redo = async function() {
  if (_redoStack.length === 0) { toast('⚠ Nada para rehacer'); return; }
  const action = _redoStack.pop();
  _undoStack.push(action);
  try {
    if (action.redoFn) await action.redoFn();
    toast('➡ Rehacer: ' + action.description);
  } catch { toast('❌ Error al rehacer'); }
};

document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); ctrl.undo(); }
  if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); ctrl.redo(); }
});
let preguntasCache = [];
let categoriasDisponibles = [];
let selectedId = null;
let editingId = null;
let respuestaVisible = false;
let pregActualCache = null;
let timerActivo = false;
let gruposConfig = [];
let _displayPreviewVisible = true;

// Utilities
function toast(msg, dur = 2000, type = 'info') {
  const el = document.getElementById('toast');
  if (el) {
    el.textContent = msg;
    el.className = 'toast show toast-' + type;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), dur);
  }
}
function toastSuccess(msg, dur) { toast(msg, dur || 2000, 'success'); }
function toastError(msg, dur) { toast(msg, dur || 3000, 'error'); }
function toastWarning(msg, dur) { toast(msg, dur || 2500, 'warning'); }
function toastInfo(msg, dur) { toast(msg, dur || 2000, 'info'); }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function abbreviateName(name, maxLen) {
  if (!name || name.length <= (maxLen || 20)) return name || '';
  var words = name.split(/\s+/);
  if (words.length <= 1) return name.slice(0, (maxLen || 20) - 1) + '\u2026';
  return words.map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 6);
}

function isEnInput() {
  const t = document.activeElement?.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

function id(el) { return document.getElementById(el); }

// Tab switching
ctrl.selectTab = function(name) {
  const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
  if (!btn) return;
  btn.click();
};
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.id === 'displayPreviewToggle') {
      btn.addEventListener('click', () => { ctrl.toggleDisplayPreview(); });
      return;
    }
    if (!btn.dataset.tab) return;
    btn.addEventListener('click', () => {
      const panel = id('panel-' + btn.dataset.tab);
      if (!panel) { console.warn('Panel not found:', 'panel-' + btn.dataset.tab); return; }
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      panel.classList.add('active');
      _activePanel = btn.dataset.tab;
      renderActivePanel();
    });
  });
}

// Render functions
let _activePanel = 'dashboard';
function renderActivePanel() {
  switch (_activePanel) {
    case 'dashboard': renderDashboard(); renderTimer(); renderActividad(); break;
    case 'preguntas': renderPreguntaActual(); break;
    case 'ahorcado': renderHangman(); break;
    case 'grupos': renderGruposConfig(); break;
    case 'temas': renderDisplayConfig(); break;
    case 'editor': ctrl.themeLoadList(); break;
    case 'pantallas': ctrl.loadScreens(); ctrl.renderMapWorkspace(); ctrl.renderBlend(); break;
    case 'presentador': ctrl.presentadorCargarSiguiente(); break;
    case 'config': renderModesList(); renderAchievements(); ctrl.renderAudio(); break;
    case 'modos': ctrl.modosCargar(); break;
    case 'canva': ctrl.canvaCargar(); break;
    case 'sandbox': ctrl.renderSandbox(); break;
  }
}
function renderAll() {
  renderDashboard();
  renderTimer();
  renderActividad();
  renderActivePanel();

}



function renderDashboard() {
  const modeEl = id('activeModeDisplay');
  if (modeEl) {
    const mode = state.modo_activo || 'none';
    const icons = { preguntas: '❓', verses: '⏱', roulette: '🎰', hangman: '🪢' };
    const names = { preguntas: 'Preguntas', verses: 'Tiempo', roulette: 'Ruleta', hangman: 'Ahorcado' };
    modeEl.innerHTML = `
      <span class="mode-icon">${icons[mode] || '💤'}</span>
      <span class="mode-name">${names[mode] || 'Ninguno'}</span>
      <span class="mode-status">${mode !== 'none' ? 'Activo' : 'Inactivo'}</span>
    `;
  }
  const scoresEl = id('dashScores');
  if (scoresEl && state.puntos) {
    const sorted = Object.entries(state.puntos).sort((a, b) => b[1] - a[1]);
    const max = Math.max(sorted[0]?.[1] || 1, 1);
    const colorMap = {};
    gruposConfig.forEach(g => { colorMap[g.key] = g.color; });
    scoresEl.innerHTML = sorted.map(([name, pts], i) => `
      <div class="score-row">
        <span class="score-color" style="background:${colorMap[name] || '#888'}"></span>
        <span class="score-name" title="${esc(name)}">${i + 1}. ${esc(abbreviateName(name, 20))}</span>
        <div class="score-bar"><div class="score-bar-fill" style="transform:scaleX(${pts / max});background:${colorMap[name] || '#888'}"></div></div>
        <span class="score-pts" style="color:${colorMap[name] || 'var(--text)'}">${pts}</span>
      </div>
    `).join('');
  }
  renderPuntosGrid();
  renderSparkline();
  renderGameStateInfo();
  syncDisplayButtons();
}

function renderPuntosGrid() {
  const el = id('dashPuntosGrid');
  if (!el) return;
  const grupos = gruposConfig || [];
  if (!grupos.length) { el.innerHTML = '<div class="text-muted2 text-sm">Sin grupos configurados</div>'; return; }
  el.innerHTML = grupos.map(g => {
    const pts = state.puntos?.[g.key] ?? 0;
    const color = g.color || '#888';
    return '<div class="punto-item">' +
      '<span class="punto-name" style="color:' + color + '" title="' + esc(g.nombre) + '">' + esc(abbreviateName(g.nombre, 20)) + '</span>' +
      '<button class="punto-btn punto-btn-minus" onclick="ctrl.restarPuntos(\'' + g.key + '\')">−</button>' +
      '<span class="punto-pts" style="color:' + color + '">' + pts + '</span>' +
      '<button class="punto-btn punto-btn-plus" onclick="ctrl.sumarPuntos(\'' + g.key + '\')">+</button>' +
      '<button class="punto-btn punto-btn-reset" onclick="ctrl.resetPuntos(\'' + g.key + '\')" title="Reiniciar puntaje">↺</button>' +
      '</div>';
  }).join('');
}

ctrl.sumarPuntos = async function(grupo) {
  const cantidad = parseInt(id('inPuntos')?.value) || 10;
  try { await apiPost('/puntos', { grupo, cantidad }); toast('🏆 +' + cantidad + ' → ' + gruposConfig.find(g => g.key === grupo)?.nombre); }
  catch { toast('❌ Error al sumar puntos'); }
};

ctrl.restarPuntos = async function(grupo) {
  const cantidad = parseInt(id('inPuntos')?.value) || 10;
  try { await apiPost('/puntos/restar', { grupo, cantidad }); toast('➖ −' + cantidad + ' → ' + gruposConfig.find(g => g.key === grupo)?.nombre); }
  catch { toast('❌ Error al restar puntos'); }
};
ctrl.resetPuntos = async function(grupo) {
  try { await apiPost('/puntos/reset', { grupo }); toast('🔄 Puntos reiniciados: ' + gruposConfig.find(g => g.key === grupo)?.nombre); }
  catch { toast('❌ Error al reiniciar puntos'); }
};

function syncDisplayButtons() {
  const dc = state.display_config || {};
  const toggleBtn = (id, active, labelOn, labelOff, clsOn, clsOff) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = active ? labelOn : labelOff;
    btn.className = active ? clsOn : clsOff;
  };
  toggleBtn('dashKioskoBtn', dc.kiosko, '🖥 Kiosko: ON', '🖥 Kiosko', 'btn btn-yellow btn-sm', 'btn btn-ghost btn-sm');
  toggleBtn('dashBlackBtn', dc.black_screen, '⬛ Black: ON', '⬛ Black', 'btn btn-red btn-sm', 'btn btn-ghost btn-sm');
  toggleBtn('dashFreezeBtn', dc.frozen, '⏸ Freeze: ON', '⏸ Freeze', 'btn btn-yellow btn-sm', 'btn btn-ghost btn-sm');
  toggleBtn('dashCleanBtn', dc.clean, '🧹 Clean: ON', '🧹 Clean', 'btn btn-yellow btn-sm', 'btn btn-ghost btn-sm');
  toggleBtn('dashFinalBtn', dc.final_round, '🏆 Final: ON', '🏆 Final', 'btn btn-red btn-sm', 'btn btn-ghost btn-sm');
  toggleBtn('temasKioskoBtn', dc.kiosko, '🖥 Kiosko: ON', '🖥 Kiosko', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('temasAnimBtn', dc.animations_disabled, '⚡ Anim: OFF', '⚡ Animaciones', 'btn btn-red btn-block', 'btn btn-ghost btn-block');
  toggleBtn('temasCleanBtn', dc.clean, '🧹 Clean: ON', '🧹 Clean Mode', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('dashFinalResultsBtn', dc.final_results, '🏆 Ocultar Resultados', '🏆 Resultados', 'btn btn-green btn-sm', 'btn btn-yellow btn-sm');
  const bgStyle = dc.bg_style || 'default';
  const highlightBgBtn = (id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    ['bgDefaultBtn','bgGradientBtn','bgParticlesBtn','bgNoneBtn'].forEach(bid => {
      const b = document.getElementById(bid);
      if (b) b.className = 'btn btn-ghost btn-block';
    });
    if (btn) btn.className = 'btn btn-primary btn-block';
  };
  highlightBgBtn('bg' + bgStyle.charAt(0).toUpperCase() + bgStyle.slice(1) + 'Btn');
  toggleBtn('decorBtn', dc.decorations !== false, '💎 Decor: ON', '💎 Decor: OFF', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('particlesBtn', dc.particles, '✨ Lluvia: ON', '✨ Lluvia', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('screenShakeBtn', dc.screen_shake, '🌊 Shake: ON', '🌊 Screen Shake', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('confettiBtn', dc.confetti, '🎊 Confetti: ON', '🎊 Confetti', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('soundBtn', dc.sound, '🔊 Sound: ON', '🔊 Sonido', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('scanlineBtn', dc.scanline, '📺 Scanline: ON', '📺 Scanline', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('glowFxBtn', dc.glow_fx, '✨ Brillo: ON', '✨ Brillo Extra', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('ultraGlowBtn', dc.ultra_glow, '🌟 Ultra Glow: ON', '🌟 Ultra Glow', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('microParticlesBtn', dc.micro_particles, '✦ Micro Part: ON', '✦ Micro Partículas', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('dynamicBgBtn', dc.dynamic_bg, '🌌 Dyn BG: ON', '🌌 Fondo Dinámico', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('fractalAnimBtn', dc.fractal_animations, '🌀 Fractal: ON', '🌀 Fractales', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('vignetteBtn', dc.vignette, '🎬 Vignete: ON', '🎬 Vignete', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('glowPulseBtn', dc.glow_pulse, '✨ Pulso: ON', '✨ Pulso Brillo', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('scoreBreatheBtn', dc.score_breathe, '💫 Score: ON', '💫 Score Animate', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('bgBreathBtn', dc.bg_breath, '🌫️ Respira: ON', '🌫️ Fondo Respira', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
  toggleBtn('themeEffectsBtn', dc.theme_effects, '🎨 Efectos: ON', '🎨 Efectos de Tema', 'btn btn-yellow btn-block', 'btn btn-ghost btn-block');
}

function toggleAnimBtn(id, active, labelOn, labelOff, clsOn, clsOff) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.textContent = active ? labelOn : labelOff;
  btn.className = active ? clsOn : clsOff;
}

function renderTimer() {
  const t = state.temporizador || {};
  const s = t.segundos_restantes || 0;
  const total = t.segundos_totales || 1;
  timerActivo = t.activo;
  const dashTimer = id('dashTimer');
  if (dashTimer) {
    dashTimer.textContent = s < 10 ? '0' + s : '' + s;
    dashTimer.className = 'timer-display' + (s <= 5 && t.activo ? ' urgent' : '');
  }
  const bar = id('dashTimerBar');
  if (bar) {
    bar.style.transform = 'scaleX(' + (s / total) + ')';
    bar.className = 'timer-bar-fill' + (s <= 5 && t.activo ? ' urgent' : '');
  }
}

function renderActividad() {
  const el = id('dashActivity');
  if (!el) return;
  const log = state.actividad || [];
  if (!log.length) {
    el.innerHTML = '<div class="log-entry text-muted2">Sin actividad</div>';
    return;
  }
  el.innerHTML = log.slice(0, 10).map(e => `<div class="log-entry">${esc(e)}</div>`).join('');
}

ctrl.iniciarModoPreguntas = async function() {
  try {
    await apiPost('/modo/preguntas/iniciar');
    await apiPost('/pregunta-actual/clear');
    await apiPost('/display/clean');
    toast('▶ Modo preguntas activo — selecciona una pregunta para proyectar');
  } catch { toast('❌ Error al iniciar modo preguntas'); }
};

function renderPreguntaActual() {
  const statusEl = id('pregModeStatus');
  if (statusEl) {
    const active = state.modo_activo === 'preguntas';
    statusEl.textContent = active ? '● Activo' : '○ Inactivo';
    statusEl.className = 'badge' + (active ? ' badge-success' : '');
  }
  const p = state.pregunta_actual;
  const mostrar = state.mostrar_respuesta;
  const lbl = id('actualLabel');
  const preview = id('actualPreview');
  pregActualCache = p && p.id ? p : null;
  if (p && p.id) {
    lbl.innerHTML = `Activa: <strong>${esc((p.texto || '').slice(0, 50))}…</strong>`;
    id('apTexto').textContent = p.texto;
    preview.classList.remove('hidden');
    actualizarRespPanel(mostrar);
    respuestaVisible = mostrar;
    const opBtns = id('opcionBtns');
    if (p.opciones && p.opciones.length === 3 && state.mostrar_opciones) {
      opBtns.classList.remove('hidden');
      const selectedIdx = state.opcion_seleccionada;
      opBtns.querySelectorAll('.btn').forEach((btn, i) => {
        btn.className = 'btn flex-1 fw-900';
        btn.style.fontSize = '14px'; btn.style.padding = '10px';
        if (mostrar) {
          if (i === p.respuesta_correcta) { btn.className += ' btn-green'; }
          else if (i === selectedIdx) { btn.className += ' btn-red'; }
          else { btn.className += ' btn-ghost'; btn.style.opacity = '0.35'; }
        } else if (selectedIdx !== null && selectedIdx !== undefined && i === selectedIdx) {
          btn.className += ' btn-yellow';
        } else {
          btn.className += ' btn-ghost';
        }
      });
    } else {
      opBtns.classList.add('hidden');
    }
  } else {
    lbl.textContent = 'Sin selección';
    preview.classList.add('hidden');
    id('opcionBtns').classList.add('hidden');
  }
  id('btnProyectar').disabled = selectedId === null;
}

function actualizarRespPanel(visible) {
  id('btnRevelar').classList.toggle('hidden', visible);
  id('btnOcultar').classList.toggle('hidden', !visible);
  const rt = id('apResp');
  if (pregActualCache) {
    rt.textContent = visible ? pregActualCache.respuesta : '— oculta —';
    rt.style.color = visible ? 'var(--green)' : 'var(--muted2)';
  }
  const btnMO = id('btnMostrarOpciones');
  if (pregActualCache && pregActualCache.opciones && pregActualCache.opciones.length === 3 && !visible) {
    btnMO.classList.remove('hidden');
  } else {
    btnMO.classList.add('hidden');
  }
}

function renderGruposConfig() {
  const list = id('gruposList');
  if (!list) return;
  // Don't regenerate if user is editing
  if (document.activeElement && list.contains(document.activeElement)) {
    return;
  }
  if (!gruposConfig.length) {
    list.innerHTML = '<div class="text-muted2 text-xs text-center">Sin grupos configurados</div>';
    return;
  }
  list.innerHTML = gruposConfig.map((g, i) => `
    <div class="grupo-row">
      <input type="text" value="${esc(g.nombre)}" data-key="${esc(g.key)}" class="grupo-name-input" />
      <input type="color" value="${esc(g.color)}" data-key="${esc(g.key)}" class="grupo-color-input" />
      <div class="color2-preview" style="background:${esc(g.color2 || g.color)}"></div>
      <button class="btn btn-ghost btn-sm" onclick="ctrl.eliminarGrupo('${esc(g.key)}')" ${gruposConfig.length <= 2 ? 'disabled' : ''}>✕</button>
    </div>
  `).join('');
  id('gruposCount').textContent = gruposConfig.length;
  let saveTimer;
  function debounceGuardar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctrl.guardarGrupos(), 400);
  }
  list.querySelectorAll('.grupo-color-input').forEach(inp => {
    inp.addEventListener('input', function() {
      const row = this.closest('.grupo-row');
      if (row) row.querySelector('.color2-preview').style.background = this.value;
      const g = gruposConfig.find(gg => gg.key === this.dataset.key);
      if (g) { g.color = this.value; g.color2 = this.value; }
      renderDashboard();
      debounceGuardar();
    });
  });
  list.querySelectorAll('.grupo-name-input').forEach(inp => {
    inp.addEventListener('input', function() {
      const g = gruposConfig.find(gg => gg.key === this.dataset.key);
      if (g) g.nombre = this.value.trim() || g.key;
      debounceGuardar();
    });
  });
}

function renderRuleta() {
  const r = state.ruleta || {};
  const status = id('ruletaStatus');
  const selBtn = id('btnSeleccionarRuleta');
  const girarBtn = id('btnGirarRuleta');
  const closeBtn = id('btnCerrarRuleta');
  const iniciarBtn = id('btnIniciarRuleta');
  if (r.activa) {
    status.textContent = '🎰 Activa — ' + (r.fase === 'category_select' ? 'Selección' : r.fase === 'wheel' ? 'Girando' : r.fase === 'result' ? 'Resultado' : r.fase);
    iniciarBtn.classList.add('hidden');
    closeBtn.classList.remove('hidden');
    if (r.fase === 'category_select') {
      selBtn.classList.remove('hidden');
      girarBtn.classList.add('hidden');
    } else if (r.fase === 'wheel') {
      selBtn.classList.add('hidden');
      girarBtn.classList.remove('hidden');
    } else {
      selBtn.classList.add('hidden');
      girarBtn.classList.add('hidden');
    }
  } else {
    status.textContent = 'Inactiva';
    iniciarBtn.classList.remove('hidden');
    selBtn.classList.add('hidden');
    girarBtn.classList.add('hidden');
    closeBtn.classList.add('hidden');
  }
  if (id('ruletaCatInputs') && !id('ruletaCatInputs').querySelector('.ruleta-cat-group')) {
    renderRuletaCatInputs();
  }
}

const _ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function renderHangman() {
  const h = state.hangman || {};
  const status = id('hangmanStatus');
  const wordDisplay = id('hangmanWordDisplay');
  const lettersContainer = id('hangmanLettersContainer');
  const attempts = id('hangmanAttempts');
  const btnIniciar = id('btnHangmanIniciar');
  const btnClose = id('btnHangmanClose');
  const letterGrid = id('hangmanLetterGrid');
  const adminRow = id('hangmanAdminRow');
  const palabraDisplay = id('hangmanPalabraDisplay');
  if (h.activo) {
    status.textContent = '🪢 Activo';
    btnIniciar.textContent = '🪢 AHORCADO ACTIVO';
    btnIniciar.disabled = true;
    btnClose.classList.remove('hidden');
    if (adminRow) adminRow.style.display = 'flex';
    if (palabraDisplay) {
      const lost = h.attempts_left <= 0;
      const won = h.word_state && h.word_state.indexOf('_') === -1;
      if (lost || won) {
        palabraDisplay.textContent = '🔓 Palabra: ' + (h.palabra || '---');
        palabraDisplay.style.color = lost ? 'var(--red)' : 'var(--green)';
      } else {
        palabraDisplay.textContent = '🔎 Admin: ' + (h.palabra || '---') + ' | Oculta: ' + (h.word_state || '');
        palabraDisplay.style.color = 'var(--accent)';
      }
    }
    if (h.word_state) {
      wordDisplay.textContent = h.word_state;
    }
    if (h.wrong_letters) {
      lettersContainer.innerHTML = (h.wrong_letters || []).map(l => `<span class="hangman-letter wrong">${esc(l)}</span>`).join('');
    } else {
      lettersContainer.innerHTML = '';
    }
    attempts.textContent = 'Intentos restantes: ' + (h.attempts_left !== undefined ? h.attempts_left : '--');
    if (letterGrid) {
      var guessed = (h.guessed_letters || []).concat(h.wrong_letters || []);
      letterGrid.innerHTML = _ALFABETO.map(function(l) {
        var used = guessed.indexOf(l) !== -1;
        return '<button class="hangman-letter-btn' + (used ? ' used' : '') + '" onclick="ctrl.hangmanGuess(\'' + l + '\')" ' + (used ? 'disabled' : '') + '>' + l + '</button>';
      }).join('');
    }
  } else {
    status.textContent = 'Inactivo';
    btnIniciar.textContent = '🪢 INICIAR AHORCADO';
    btnIniciar.disabled = false;
    btnClose.classList.add('hidden');
    wordDisplay.textContent = '';
    lettersContainer.innerHTML = '';
    attempts.textContent = 'Intentos restantes: --';
    if (letterGrid) { letterGrid.innerHTML = ''; }
    if (adminRow) adminRow.style.display = 'none';
  }
}

function renderVersos() {
  const btnIniciar = id('btnVersosIniciar');
  const btnDetener = id('btnVersosDetener');
  const btnPausar = id('btnVersosPausar');
  const btnReanudar = id('btnVersosReanudar');
  const btnReset = id('btnVersosResetTimer');
  const btnAward = id('btnVersosAwardPoints');
  const status = id('versosStatus');
  const verseMode = state.verses || {};

  const activo = !!verseMode.activo;
  const pausado = !!verseMode.pausado;

  if (btnIniciar) btnIniciar.disabled = activo;
  if (btnDetener) btnDetener.disabled = !activo;
  if (btnPausar) btnPausar.disabled = !activo || pausado;
  if (btnReanudar) btnReanudar.disabled = !activo || !pausado;
  if (btnReset) btnReset.disabled = !activo;
  if (btnAward) btnAward.disabled = !activo;

  if (status) {
    if (activo && pausado) status.textContent = 'Pausado';
    else if (activo) status.textContent = 'Activo';
    else status.textContent = 'Inactivo';
    status.className = 'badge' + (activo ? (pausado ? ' badge-warning' : ' badge-success') : '');
  }

  // Timer info
  const timerEl = id('versosTimerDisplay');
  if (timerEl) {
    if (activo) {
      timerEl.textContent = (verseMode.timer_segundos || 0) + 's / ' + (verseMode.timer_totales || '?') + 's';
    } else {
      timerEl.textContent = '-- / --';
    }
  }

  // History
  const histEl = id('versosHistory');
  if (histEl) {
    const history = verseMode.history || [];
    if (history.length > 0) {
      histEl.innerHTML = history.map(function(h) { return '<div>• ' + esc(h) + '</div>'; }).join('');
    } else {
      histEl.innerHTML = '<em>Sin actividad</em>';
    }
  }

  // Populate group select
  const sel = id('versosGroupSelect');
  if (sel) {
    sel.innerHTML = gruposConfig.map(function(g) {
      return '<option value="' + esc(g.key) + '">' + esc(g.nombre) + '</option>';
    }).join('');
  }
}

function renderDisplayConfig() {
  syncDisplayButtons();
}

function loadModeConfigs() { renderAll(); }

function renderModesList() {
  const el = id('modesList');
  if (!el) return;
  const modes = [
    { key: 'questions', icon: '❓', name: 'Preguntas' },
    { key: 'verses', icon: '⏱', name: 'Tiempo' },
    { key: 'roulette', icon: '🎰', name: 'Ruleta' },
    { key: 'hangman', icon: '🪢', name: 'Ahorcado' }
  ];
  window.__modeList = [
    { name: 'roulette', icon: '🎰' },
    { name: 'hangman', icon: '🪢' },
    { name: 'verses', icon: '⏱' },
    { name: 'battle', icon: '⚔️' },
    { name: 'survival', icon: '💀' },
    { name: 'quizshow', icon: '🎬' },
  ];
  el.innerHTML = modes.map(m => `
    <div class="flex-row">
      <span>${m.icon}</span>
      <span class="flex-1">${m.name}</span>
      <span class="text-xs ${state.modo_activo === m.key ? 'text-muted fw-700' : 'text-muted2'}">${state.modo_activo === m.key ? '● Activo' : '○ Inactivo'}</span>
    </div>
  `).join('');
}

// Questions
ctrl.toggleMultiChoice = function() {
  const el = id('multiChoiceFields');
  const show = id('chkMulti').checked;
  el.classList.toggle('hidden', !show);
  if (show) ctrl.onRcChange();
};

ctrl.addCategoriaFromModal = async function() {
  const name = id('catModalName').value.trim();
  if (!name) { toast('⚠ Nombre requerido'); return; }
  try {
    await apiPost('/config/categories/add', { name });
    categoriasDisponibles.push(name);
    poblarCategoriaSelects();
    id('catModalName').value = '';
    toast('✅ Categoría agregada');
    renderCatModal();
  } catch { toast('❌ Error'); }
};

ctrl.eliminarCategoria = async function(key) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  try {
    await fetchRetry(API + '/config/categories/remove', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ key })
    });
    toast('🗑 Categoría eliminada');
    await cargarPreguntas();
    renderCatModal();
  } catch { toast('❌ Error'); }
};

function renderCatModal() {
  const el = id('catList');
  if (!el) return;
  if (!categoriasDisponibles.length) {
    el.innerHTML = '<div class="text-muted2 text-sm">Sin categorías creadas</div>';
    return;
  }
  el.innerHTML = categoriasDisponibles.map(c => {
    const key = c.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return '<div class="cat-item"><span>' + esc(c) + '</span><button class="btn btn-ghost btn-sm" onclick="ctrl.eliminarCategoria(\'' + key + '\')" style="color:var(--red)">✕</button></div>';
  }).join('');
}

ctrl.onRcChange = function() {
  const rc = document.querySelector('input[name="rcRadio"]:checked');
  if (!rc) return;
  const idx = parseInt(rc.value);
  const ids = ['inOptA', 'inOptB', 'inOptC'];
  const target = id(ids[idx]);
  if (target) id('inRespuesta').value = target.value;
};

ctrl.crearPregunta = async function() {
  const texto = id('inPregunta').value.trim();
  const respuesta = id('inRespuesta').value.trim();
  if (!texto || !respuesta) { toast('⚠ Escribe pregunta y respuesta'); return; }
  const body = { texto, respuesta };
  const cat = id('inCategoria').value.trim();
  if (cat) body.categoria = cat;
  if (id('chkMulti').checked) {
    const a = id('inOptA').value.trim();
    const b = id('inOptB').value.trim();
    const c = id('inOptC').value.trim();
    if (!a || !b || !c) { toast('⚠ Completa las 3 opciones'); return; }
    const rc = parseInt(document.querySelector('input[name="rcRadio"]:checked').value);
    body.opciones = [a, b, c];
    body.respuesta_correcta = rc;
  }
  try {
    if (editingId) {
      body.opciones = id('chkMulti').checked ? body.opciones : null;
      await apiPut('/preguntas/' + editingId, body);
      toast('✅ Pregunta actualizada');
    } else {
      await apiPost('/preguntas', body);
      toast('✅ Pregunta guardada');
    }
    ctrl.limpiarFormularioPregunta();
    await cargarPreguntas();
  } catch { toast('❌ Error al guardar'); }
};

ctrl.limpiarFormularioPregunta = function() {
  editingId = null;
  id('inPregunta').value = '';
  id('inRespuesta').value = '';
  id('inOptA').value = ''; id('inOptB').value = ''; id('inOptC').value = '';
  id('chkMulti').checked = false;
  id('multiChoiceFields').classList.add('hidden');
  id('btnCrearPregunta').textContent = '+ Agregar';
  if (selectedId) {
    document.querySelectorAll('.q-item').forEach(el => el.classList.remove('selected'));
    selectedId = null;
    id('btnProyectar').disabled = true;
  }
}

ctrl.filtrarPreguntas = function() { cargarPreguntas(); };

async function cargarPreguntas() {
  try {
    const d = await fetchRetry(API + '/preguntas');
    preguntasCache = d.preguntas || [];
    if (d.categorias_disponibles) {
      categoriasDisponibles = d.categorias_disponibles;
      poblarCategoriaSelects();
    }
    const filtro = id('filterCategoria').value;
    const busqueda = (id('qSearch').value || '').toLowerCase().trim();
    let lista = filtro ? preguntasCache.filter(p => p.categoria === filtro) : preguntasCache;
    if (busqueda) {
      lista = lista.filter(p =>
        (p.texto || '').toLowerCase().includes(busqueda) ||
        (p.respuesta || '').toLowerCase().includes(busqueda)
      );
    }
    renderPreguntasLista(lista);
    id('qCount').textContent = preguntasCache.length + ' total';
    const filtroEl = id('qFilteredCount');
    if (lista.length !== preguntasCache.length) {
      filtroEl.textContent = lista.length + ' mostrados';
    } else {
      filtroEl.textContent = '';
    }
  } catch { toast('❌ Error al cargar preguntas'); }
}

function poblarCategoriaSelects() {
  const catCounts = {};
  preguntasCache.forEach(p => {
    const cat = p.categoria || '';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  ['inCategoria', 'filterCategoria'].forEach(selId => {
    const sel = id(selId);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + (selId === 'filterCategoria' ? 'Todas (' + preguntasCache.length + ')' : 'Sin categoría') + '</option>';
    categoriasDisponibles.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c + ' (' + (catCounts[c] || 0) + ')';
      if (c === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function renderPreguntasLista(lista) {
  const el = id('qList');
  if (!lista.length) {
    el.innerHTML = '<div class="text-center text-muted2" style="padding:16px;">Sin preguntas — agrega una arriba</div>';
    return;
  }
  el.innerHTML = lista.map((p, i) => `\n    <div class="q-item ${p.id === selectedId ? 'selected' : ''}" onclick="ctrl.seleccionar(${esc(p.id)})" id="qitem-${esc(p.id)}">
      <span class="q-num">${p.numero || (i + 1)}</span>
      <div class="q-body">
        <div class="q-text">${esc(p.texto)}</div>
        <div class="q-ans">↳ ${esc(p.respuesta)}</div>
        ${p.categoria ? '<span class="text-xs" style="color:var(--accent);">' + esc(p.categoria) + '</span>' : ''}
      </div>
      <div class="q-actions">
        <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();ctrl.seleccionar(${esc(p.id)})" title="Editar">✏</button>
        <button class="btn btn-ghost btn-icon btn-sm" style="color:var(--red)" onclick="event.stopPropagation();ctrl.eliminarPregunta(${esc(p.id)})" title="Eliminar">✕</button>
      </div>
    </div>
  `).join('');
  // Auto-select first question if none selected
  if (selectedId === null) {
    const firstQuestion = lista[0];
    if (firstQuestion) {
      ctrl.seleccionar(firstQuestion.id);
    }
  }
  // If we have a selectedId, ensure projection button is enabled
  if (selectedId !== null) {
    id('btnProyectar').disabled = false;
  } else {
    id('btnProyectar').disabled = selectedId === null;
  }
}

ctrl.seleccionar = function(qId) {
  if (qId == null || qId === undefined) return;
  selectedId = qId;
  document.querySelectorAll('.q-item').forEach(el => el.classList.remove('selected'));
  const item = document.getElementById('qitem-' + qId);
  if (item) item.classList.add('selected');
  document.getElementById('btnProyectar').disabled = false;
  const p = preguntasCache.find(q => q.id === qId);
  if (p) cargarEnFormulario(p);
};

function cargarEnFormulario(p) {
  editingId = p.id;
  id('inPregunta').value = p.texto || '';
  id('inRespuesta').value = p.respuesta || '';
  var catSel = id('inCategoria'); if (catSel) { var found = false; Array.from(catSel.options).forEach(function(o) { if (o.value === (p.categoria || '')) { catSel.value = o.value; found = true; } }); if (!found) { var opt = document.createElement('option'); opt.value = p.categoria || ''; opt.textContent = p.categoria || ''; catSel.appendChild(opt); catSel.value = p.categoria || ''; } }
  if (p.opciones && p.opciones.length === 3) {
    id('chkMulti').checked = true;
    id('multiChoiceFields').classList.remove('hidden');
    id('inOptA').value = p.opciones[0] || '';
    id('inOptB').value = p.opciones[1] || '';
    id('inOptC').value = p.opciones[2] || '';
    document.querySelectorAll('input[name="rcRadio"]').forEach((r, i) => {
      r.checked = i === p.respuesta_correcta;
    });
  } else {
    id('chkMulti').checked = false;
    id('multiChoiceFields').classList.add('hidden');
    id('inOptA').value = '';
    id('inOptB').value = '';
    id('inOptC').value = '';
  }
  id('inPregunta').focus();
  id('btnCrearPregunta').textContent = editingId ? '✔ Actualizar' : '+ Agregar';
}

ctrl.proyectarActual = async function() {
  if (!selectedId) { toast('⚠ Selecciona una pregunta primero'); return; }
  try {
    await apiPost('/pregunta-actual', { id: selectedId });
    respuestaVisible = false;
    toast('📸 Proyectando');
  } catch { toast('❌ Error al proyectar'); }
};

ctrl.toggleRespuesta = async function(mostrar) {
  try {
    await apiPost('/mostrar-respuesta', { mostrar });
    respuestaVisible = mostrar;
    toast(mostrar ? '👁 Respuesta visible' : '🙈 Respuesta oculta');
  } catch { toast('❌ Error'); }
};

ctrl.mostrarOpciones = async function() {
  await apiPost('/pregunta-actual/mostrar-opciones');
  toast('📋 Opciones mostradas');
};

ctrl.seleccionarOpcion = async function(indice) {
  await apiPost('/pregunta-actual/seleccionar-opcion', { indice });
};

ctrl.iniciarEdicion = function(id) {
  const p = preguntasCache.find(q => q.id === id);
  if (p) cargarEnFormulario(p);
};

ctrl.eliminarPregunta = async function(qId) {
  if (!confirm('¿Eliminar esta pregunta?')) return;
  try { await fetchRetry(API + '/preguntas/' + qId, { method: 'DELETE' }); }
  catch { toast('❌ Error al eliminar'); return; }
  if (selectedId === qId) { selectedId = null; document.getElementById('btnProyectar').disabled = true; }
  if (editingId === qId) ctrl.limpiarFormularioPregunta();
  await cargarPreguntas();
};

ctrl.exportarPreguntas = async function() {
  try {
    const r = await fetch(API + '/preguntas/exportar');
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'preguntas.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    toast('⬇ Exportado');
  } catch { toast('❌ Error al exportar'); }
};

ctrl.importarPreguntas = async function(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const preguntas = data.preguntas || data;
    if (!Array.isArray(preguntas) || preguntas.length === 0) {
      toastError('El archivo no contiene preguntas válidas');
      return;
    }
    const modo = confirm('Presiona OK para REEMPLAZAR todas las preguntas\nPresiona Cancelar para AGREGAR a las existentes') ? 'reemplazar' : 'agregar';
    const r = await apiPost('/preguntas/importar', { preguntas, modo });
    await cargarPreguntas();
    const accion = modo === 'reemplazar' ? 'Reemplazadas' : 'Agregadas';
    toastSuccess(accion + ': ' + preguntas.length + ' preguntas');
  } catch (e) {
    const msg = e.message || 'Error desconocido';
    toastError('Error al importar: ' + msg);
  }
  event.target.value = '';
};

ctrl.irAPreguntaAnterior = async function() {
  if (!preguntasCache.length) { toast('⚠ No hay preguntas'); return; }
  const idx = preguntasCache.findIndex(p => p.id === selectedId);
  const next = idx <= 0 ? preguntasCache.length - 1 : idx - 1;
  const p = preguntasCache[next];
  ctrl.seleccionar(p.id);
  await apiPost('/pregunta-actual', { id: p.id });
  respuestaVisible = false;
  toast('◄ Pregunta ' + (next + 1));
};

ctrl.irAPreguntaSiguiente = async function() {
  if (!preguntasCache.length) { toast('⚠ No hay preguntas'); return; }
  const idx = preguntasCache.findIndex(p => p.id === selectedId);
  const next = idx < 0 || idx >= preguntasCache.length - 1 ? 0 : idx + 1;
  const p = preguntasCache[next];
  ctrl.seleccionar(p.id);
  await apiPost('/pregunta-actual', { id: p.id });
  respuestaVisible = false;
  toast('► Pregunta ' + (next + 1));
}

// Timer
ctrl.iniciarTimer = async function() {
  const seg = parseInt(id('inSegundos')?.value) || 45;
  try {
    await apiPost('/temporizador/iniciar', { segundos: seg });
    toast('▶ ' + seg + 's');
  } catch { toast('❌ Error al iniciar timer'); }
};
ctrl.iniciarTimerProyectar = async function() {
  const seg = parseInt(id('inProyectarSegundos')?.value) || 30;
  try {
    await apiPost('/temporizador/iniciar', { segundos: seg });
    toast('⏱ ' + seg + 's');
  } catch { toast('❌ Error al iniciar timer proyectar'); }
};
ctrl.reiniciarTimer = async function() {
  try {
    await fetchRetry(API + '/temporizador/reiniciar', { method: 'POST' });
    toast('↪ Reiniciado');
  } catch { toast('❌ Error al reiniciar timer'); }
};
ctrl.pararTimer = async function() {
  try {
    await fetchRetry(API + '/temporizador/parar', { method: 'POST' });
    toast('■ Detenido');
  } catch { toast('❌ Error al parar timer'); }
};

// ── Additional Timers ──
let _roundTimerInterval = null;
let _roundTimerSeconds = 0;
let _gameTimerInterval = null;
let _gameTimerSeconds = 0;

function formatTimerDisplay(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

ctrl.startRoundTimer = function() {
  if (_roundTimerInterval) { clearInterval(_roundTimerInterval); }
  _roundTimerSeconds = parseInt(id('inRoundTimer')?.value || 120);
  const display = id('roundTimerDisplay');
  if (display) display.textContent = formatTimerDisplay(_roundTimerSeconds);
  _roundTimerInterval = setInterval(function() {
    _roundTimerSeconds--;
    if (display) display.textContent = formatTimerDisplay(_roundTimerSeconds);
    if (_roundTimerSeconds <= 0) {
      clearInterval(_roundTimerInterval);
      _roundTimerInterval = null;
      toast('⏱ Timer de ronda terminado');
    }
  }, 1000);
  toast('▶ Timer de ronda iniciado');
};

ctrl.stopRoundTimer = function() {
  if (_roundTimerInterval) { clearInterval(_roundTimerInterval); _roundTimerInterval = null; }
  toast('■ Timer de ronda detenido');
};

ctrl.startGameTimer = function() {
  if (_gameTimerInterval) { clearInterval(_gameTimerInterval); }
  _gameTimerSeconds = parseInt(id('inGameTimer')?.value || 3600);
  const display = id('gameTimerDisplay');
  if (display) display.textContent = formatTimerDisplay(_gameTimerSeconds);
  _gameTimerInterval = setInterval(function() {
    _gameTimerSeconds--;
    if (display) display.textContent = formatTimerDisplay(_gameTimerSeconds);
    if (_gameTimerSeconds <= 0) {
      clearInterval(_gameTimerInterval);
      _gameTimerInterval = null;
      toast('⏱ Timer de juego terminado');
    }
  }, 1000);
  toast('▶ Timer de juego iniciado');
};

ctrl.stopGameTimer = function() {
  if (_gameTimerInterval) { clearInterval(_gameTimerInterval); _gameTimerInterval = null; }
  toast('■ Timer de juego detenido');
};

// ── Presenter Mode ──
let _presentadorNotaIndex = 0;

ctrl.presentadorModoAnterior = async function() {
  try {
    const res = await fetchRetry(API + '/estado-actual');
    if (res && res.preguntas) {
      const idx = res.preguntas.findIndex(p => p.id === res.pregunta_actual?.id);
      if (idx > 0) {
        const prev = res.preguntas[idx - 1];
        await apiPost('/modo/preguntas/seleccionar', { id: prev.id });
        toast('⬅ Pregunta anterior');
      }
    }
  } catch { toast('❌ Error'); }
};

ctrl.presentadorModoSiguiente = async function() {
  try {
    const res = await fetchRetry(API + '/estado-actual');
    if (res && res.preguntas) {
      const idx = res.preguntas.findIndex(p => p.id === res.pregunta_actual?.id);
      if (idx < res.preguntas.length - 1) {
        const next = res.preguntas[idx + 1];
        await apiPost('/modo/preguntas/seleccionar', { id: next.id });
        toast('➡ Siguiente pregunta');
      }
    }
  } catch { toast('❌ Error'); }
};

ctrl.presentadorCorrecto = async function() {
  toast('✅ Marcado como correcto');
};

ctrl.presentadorIncorrecto = async function() {
  toast('❌ Marcado como incorrecto');
};

ctrl.presentadorRevelar = async function() {
  try {
    const res = await fetchRetry(API + '/estado-actual');
    if (res && !res.mostrar_respuesta) {
      await apiPost('/modo/preguntas/revelar');
      toast('👁 Respuesta revelada');
    }
  } catch { toast('❌ Error'); }
};

ctrl.presentadorPausar = async function() {
  try {
    await ctrl.pararTimer();
    toast('⏸ Pausado');
  } catch { toast('❌ Error'); }
};

ctrl.presentadorTimer = async function(seg) {
  try {
    await apiPost('/temporizador/iniciar', { segundos: seg });
    toast('⏱ ' + seg + 's');
  } catch { toast('❌ Error'); }
};

ctrl.presentadorTimerCustom = async function() {
  const seg = parseInt(prompt('Segundos del timer:', '45') || '45', 10);
  if (!isNaN(seg) && seg > 0) ctrl.presentadorTimer(seg);
};

ctrl.presentadorCargarSiguiente = async function() {
  try {
    const res = await fetchRetry(API + '/pregunta/proxima');
    if (!res || !res.ok || !res.pregunta) {
      const el = id('presentadorNextQ');
      if (el) el.innerHTML = '<span class="text-sm text-muted">Sin preguntas</span>';
      return;
    }
    const p = res.pregunta;
    const el = id('presentadorNextQ');
    if (el) {
      el.innerHTML = `
        <div class="text-xs text-muted">ID ${p.id}${p.categoria ? ' · ' + esc(p.categoria) : ''}</div>
        <div style="font-size:18px;font-weight:700;">${esc(p.pregunta || '')}</div>
        <div class="text-sm" style="color:var(--green);">» ${esc(p.respuesta || '')}</div>`;
    }
  } catch { toast('❌ Error'); }
};

ctrl.presentadorProyectarSiguiente = async function() {
  try {
    const res = await apiPost('/pregunta/proxima/proyectar', {});
    if (res && res.ok) { toast('⏭ Siguiente proyectada'); ctrl.presentadorCargarSiguiente(); }
    else if (res && res.error) toast('⚠ ' + res.error);
  } catch { toast('❌ Error'); }
};

ctrl.presentadorTeleprompter = async function() {
  const modal = id('teleprompterModal');
  if (!modal) return;
  await ctrl._tpRefresh();
  modal.classList.remove('hidden');
};

ctrl.cerrarTeleprompter = function() {
  const modal = id('teleprompterModal');
  if (modal) modal.classList.add('hidden');
};

ctrl._tpRefresh = async function() {
  try {
    const res = await fetchRetry(API + '/estado-actual');
    const q = res && res.pregunta_actual;
    const qEl = id('teleprompterQ');
    const aEl = id('teleprompterA');
    if (qEl) qEl.textContent = (q && q.pregunta) ? q.pregunta : 'Sin pregunta activa';
    if (aEl) aEl.textContent = (res && res.mostrar_respuesta && q) ? ('» ' + (q.respuesta || '')) : '';
  } catch { /* ignore */ }
};

ctrl.presentadorEmergency = async function() {
  try {
    await apiPost('/display/black-screen', { active: true });
    ctrl.presentadorTimer(30);
    toast('🚨 Emergencia: pantalla negra + timer 30s');
  } catch { toast('❌ Error'); }
};

function renderBlend() {
  const sel = id('blendMode');
  if (sel) {
    const lista = window.__modeList || [];
    sel.innerHTML = lista.map(m => `<option value="${m.name}">${m.icon || ''} ${m.name}</option>`).join('') ||
      ['roulette','hangman','verses','battle','survival','quizshow']
        .map(n => `<option value="${n}">${n}</option>`).join('');
  }
  const st = id('blendStatus');
  if (st) st.textContent = state.modo_secundario ? ('2º modo activo: ' + state.modo_secundario) : 'Sin 2º modo';
}
ctrl.renderBlend = renderBlend;

ctrl.blendIniciar = async function() {
  const name = id('blendMode')?.value;
  if (!name) return;
  try {
    const res = await fetchRetry(API + `/modo/${name}/iniciar?slot=secondary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (res && res.error) { toast('⚠ ' + res.error); return; }
    toast('🔀 2º modo iniciado: ' + name);
    ctrl.renderBlend();
  } catch (e) { toast('❌ ' + e.message); }
};

ctrl.blendCerrar = async function() {
  try {
    const name = state.modo_secundario;
    if (name) await fetchRetry(API + `/modo/${name}/cerrar?slot=secondary`, { method: 'POST' });
    toast('✕ 2º modo cerrado');
    ctrl.renderBlend();
  } catch (e) { toast('❌ ' + e.message); }
};

ctrl.guardarNotaPresentador = function() {
  const nota = id('presentadorNotas')?.value || '';
  localStorage.setItem('presentadorNota_' + _presentadorNotaIndex, nota);
  toast('💾 Nota guardada');
};

ctrl.cargarNotaPresentador = function() {
  const nota = localStorage.getItem('presentadorNota_' + _presentadorNotaIndex) || '';
  if (id('presentadorNotas')) id('presentadorNotas').value = nota;
  toast('📂 Nota cargada');
};

// ── Battle Mode ──
ctrl.batallaIniciar = async function() {
  const eq1 = id('batallaEq1')?.value;
  const eq2 = id('batallaEq2')?.value;
  const rondas = parseInt(id('batallaRondas')?.value || 5);
  const timer = parseInt(id('batallaTimer')?.value || 15);
  if (!eq1 || !eq2) { toast('⚠ Selecciona dos equipos'); return; }
  if (eq1 === eq2) { toast('⚠ Los equipos deben ser diferentes'); return; }
  try {
    const res = await apiPost('/modo/battle/iniciar', { equipo1: eq1, equipo2: eq2, rondas, timer });
    if (res.error) { toast('⚠ ' + res.error); return; }
    toast('⚔️ Batalla iniciada');
    id('batallaBtnEq1').disabled = false;
    id('batallaBtnEq2').disabled = false;
  } catch { toast('❌ Error'); }
};

ctrl.batallaCorrecto = async function(eq) {
  try {
    const res = await apiPost('/modo/battle/responder', { equipo: eq === 'eq1' ? id('batallaEq1')?.value : id('batallaEq2')?.value, correcta: true, puntos: 10 });
    if (res.finished) {
      toast('🏆 Batalla terminada — Ganador: ' + res.ganador);
      id('batallaBtnEq1').disabled = true;
      id('batallaBtnEq2').disabled = true;
    }
    id('batallaPts1').textContent = res.puntos_eq1 || 0;
    id('batallaPts2').textContent = res.puntos_eq2 || 0;
  } catch { toast('❌ Error'); }
};

ctrl.batallaCerrar = async function() {
  try { await apiPost('/modo/battle/cerrar'); toast('✕ Batalla cerrada'); id('batallaBtnEq1').disabled = true; id('batallaBtnEq2').disabled = true; } catch { toast('❌ Error'); }
};

// ── Survival Mode ──
ctrl.survivalIniciar = async function() {
  const timer = parseInt(id('survivalTimer')?.value || 20);
  try {
    const res = await apiPost('/modo/survival/iniciar', { timer });
    if (res.error) { toast('⚠ ' + res.error); return; }
    toast('💀 Supervivencia iniciada — ' + res.total + ' equipos');
  } catch { toast('❌ Error'); }
};

ctrl.survivalCerrar = async function() {
  try { await apiPost('/modo/survival/cerrar'); toast('✕ Supervivencia cerrada'); } catch { toast('❌ Error'); }
};

// ── Quiz Show Mode ──
ctrl.quizshowIniciar = async function() {
  const rondas = parseInt(id('quizshowRondas')?.value || 3);
  const timer = parseInt(id('quizshowTimer')?.value || 20);
  try {
    const res = await apiPost('/modo/quizshow/iniciar', { rondas, timer });
    if (res.error) { toast('⚠ ' + res.error); return; }
    toast('🎬 Quiz Show iniciado — ' + res.rondas + ' rondas');
  } catch { toast('❌ Error'); }
};

ctrl.quizshowCerrar = async function() {
  try { await apiPost('/modo/quizshow/cerrar'); toast('✕ Quiz Show cerrado'); } catch { toast('❌ Error'); }
};

// ─── Rapid Fire ─────────────────────────────────────────────
function _fillGrupoSelect(selId, selected) {
  const sel = id(selId);
  if (!sel) return;
  const grupos = state.display_config.grupos_config || [];
  sel.innerHTML = grupos.map(g => `<option value="${g.key}">${g.nombre || g.key}</option>`).join('');
  if (selected) sel.value = selected;
}
// Groups
ctrl.addGrupo = function() {
  if (gruposConfig.length >= 8) { toast('⚠ Máximo 8 grupos'); return; }
  const colors = ['#7c3aed','#db2777','#0284c7','#059669','#d97706','#dc2626','#0891b2','#4f46e5'];
  const idx = gruposConfig.length + 1;
  const key = 'Grupo' + idx;
  const nombre = '';
  const col = colors[(idx - 1) % colors.length];
  gruposConfig.push({ key, nombre, color: col, color2: col });
  renderGruposConfig();
};

ctrl.eliminarGrupo = function(key) {
  if (gruposConfig.length <= 2) { toast('⚠ Mínimo 2 grupos'); return; }
  gruposConfig = gruposConfig.filter(g => g.key !== key);
  renderGruposConfig();
};

ctrl.guardarGrupos = async function() {
  document.querySelectorAll('.grupo-name-input').forEach(inp => {
    const g = gruposConfig.find(gg => gg.key === inp.dataset.key);
    if (g) g.nombre = inp.value.trim() || g.key;
  });
  document.querySelectorAll('.grupo-color-input').forEach(inp => {
    const g = gruposConfig.find(gg => gg.key === inp.dataset.key);
    if (g) { g.color = inp.value; g.color2 = inp.value; }
  });
  try {
    await apiPost('/grupos/config', { grupos: gruposConfig });
    id('gruposStatus').style.opacity = '1';
    setTimeout(() => { id('gruposStatus').style.opacity = '0'; }, 2000);
    toast('💾 Grupos guardados');
  } catch { toast('❌ Error al guardar'); }
};

// Ruleta
const RULETA_COLORS = ['#FF5500', '#FF00FF', '#00AAFF', '#FFCC00'];

ctrl.ruletaCambiarCantidad = function() {
  renderRuletaCatInputs();
};

ctrl.ruletaResetearCategorias = function() {
  renderRuletaCatInputs();
  toast('↺ Categorías reiniciadas');
};

function renderRuletaCatInputs() {
  const container = id('ruletaCatInputs');
  if (!container) return;
  const count = parseInt(id('ruletaCatCount')?.value) || 3;
  const existing = container.querySelectorAll('.ruleta-cat-group');
  let html = '';
  for (let i = 0; i < count; i++) {
    const idx = i + 1;
    html += '<div class="ruleta-cat-group card card-sm" style="padding:8px;margin-bottom:6px;">' +
      '<div class="flex-row gap-4" style="align-items:center;margin-bottom:4px;">' +
      '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + RULETA_COLORS[i] + '"></span>' +
      '<input type="text" class="ruleta-cat-name" data-idx="' + idx + '" placeholder="Categoría ' + idx + '…" style="flex:1;font-weight:600;" />' +
      '</div>' +
      '<textarea class="ruleta-cat-items" data-idx="' + idx + '" rows="2" placeholder="Escribe un elemento por línea…" style="width:100%;font-family:inherit;font-size:12px;"></textarea>' +
      '</div>';
  }
  container.innerHTML = html;
  // Restore any previously saved values
  const saved = window._ruletaSavedCats;
  if (saved && saved.length === count) {
    saved.forEach(function(s, i) {
      const nameInp = container.querySelector('.ruleta-cat-name[data-idx="' + (i + 1) + '"]');
      const itemsTa = container.querySelector('.ruleta-cat-items[data-idx="' + (i + 1) + '"]');
      if (nameInp && s.name) nameInp.value = s.name;
      if (itemsTa && s.items) itemsTa.value = s.items;
    });
  }
}

ctrl.ruletaGuardarCategorias = async function() {
  const container = id('ruletaCatInputs');
  const groups = container.querySelectorAll('.ruleta-cat-group');
  const categories = {};
  const colors = RULETA_COLORS;
  const timer = parseInt(id('ruletaTimer')?.value) || 15;
  groups.forEach(function(g, i) {
    const nameInp = g.querySelector('.ruleta-cat-name');
    const itemsTa = g.querySelector('.ruleta-cat-items');
    const name = (nameInp ? nameInp.value.trim() : 'Categoría ' + (i + 1)) || 'Categoría ' + (i + 1);
    const raw = itemsTa ? itemsTa.value.trim() : '';
    const items = raw ? raw.split('\n').map(function(w) { return w.trim(); }).filter(function(w) { return w.length > 0; }) : [];
    const key = 'cat' + (i + 1);
    categories[key] = { name: name, color: colors[i] || '#888', items: items };
  });
  if (Object.keys(categories).length < 2) { toast('❌ Mínimo 2 categorías'); return; }
  try {
    await apiPost('/config/modes/save', { mode: 'roulette', config: { enabled: true, icon: '🎰', timer, categories } });
    window._ruletaSavedCats = [];
    groups.forEach(function(g) {
      const nameInp = g.querySelector('.ruleta-cat-name');
      const itemsTa = g.querySelector('.ruleta-cat-items');
      window._ruletaSavedCats.push({ name: nameInp ? nameInp.value : '', items: itemsTa ? itemsTa.value : '' });
    });
    toast('💾 Categorías guardadas');
    return categories;
  } catch { toast('❌ Error al guardar'); return null; }
};

ctrl.ruletaIniciar = async function() {
  const cats = await ctrl.ruletaGuardarCategorias();
  if (!cats) return;
  try {
    await apiPost('/ruleta/iniciar');
    id('btnIniciarRuleta').classList.add('hidden');
    id('btnSeleccionarRuleta').classList.remove('hidden');
    id('btnCerrarRuleta').classList.remove('hidden');
    id('btnGirarRuleta').classList.add('hidden');
    id('ruletaResultBox').classList.add('hidden');
    toast('🎰 Ruleta iniciada — selecciona una categoría');
  } catch { toast('❌ Error al iniciar'); }
};

ctrl.ruletaSeleccionar = async function() {
  try {
    const r = await apiPost('/ruleta/seleccionar');
    if (r.error) { toast('⚠ ' + r.error); return; }
    id('btnSeleccionarRuleta').classList.add('hidden');
    id('btnGirarRuleta').classList.remove('hidden');
    toast('🎯 Categoría: ' + (r.cat_name || '') + ' — Ahora gira la ruleta');
  } catch { toast('❌ Error'); }
};

ctrl.ruletaGirar = async function() {
  try {
    const r = await apiPost('/ruleta/girar');
    if (r.error) { toast('⚠ ' + r.error); return; }
    const display = id('ruletaResultadoDisplay');
    const box = id('ruletaResultBox');
    box.classList.remove('hidden');
    display.innerHTML = '<span style="color:' + (RULETA_COLORS[parseInt((r.categoria || '').replace('cat', '')) - 1] || '#fff') + ';">' + esc(r.cat_name || '') + '</span>: ' + esc(r.resultado || '');
    id('btnGirarRuleta').classList.add('hidden');
    toast('🎰 ¡' + (r.resultado || 'OK') + '!');
  } catch { toast('❌ Error'); }
};

ctrl.ruletaCerrar = async function() {
  try {
    await apiPost('/ruleta/cerrar');
    id('btnIniciarRuleta').classList.remove('hidden');
    id('btnSeleccionarRuleta').classList.add('hidden');
    id('btnGirarRuleta').classList.add('hidden');
    id('btnCerrarRuleta').classList.add('hidden');
    id('ruletaResultBox').classList.add('hidden');
    toast('✅ Ruleta cerrada');
  } catch { toast('❌ Error'); }
};

ctrl.ruletaExportar = function() {
  const container = id('ruletaCatInputs');
  const groups = container.querySelectorAll('.ruleta-cat-group');
  const categories = {};
  const colors = RULETA_COLORS;
  const timer = parseInt(id('ruletaTimer')?.value) || 15;
  groups.forEach(function(g, i) {
    const nameInp = g.querySelector('.ruleta-cat-name');
    const itemsTa = g.querySelector('.ruleta-cat-items');
    const name = (nameInp ? nameInp.value.trim() : 'Categoría ' + (i + 1)) || 'Categoría ' + (i + 1);
    const raw = itemsTa ? itemsTa.value.trim() : '';
    const items = raw ? raw.split('\n').map(function(w) { return w.trim(); }).filter(function(w) { return w.length > 0; }) : [];
    const key = 'cat' + (i + 1);
    categories[key] = { name: name, color: colors[i] || '#888', items: items };
  });
  const data = { ruleta: { timer, categories } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ruleta.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
  toast('📤 Ruleta exportada');
};

ctrl.ruletaImportar = async function(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const cfg = data.ruleta || data;
    if (cfg.timer) id('ruletaTimer').value = cfg.timer;
    const cats = cfg.categories || {};
    const catKeys = Object.keys(cats);
    if (catKeys.length >= 2 && catKeys.length <= 4) {
      id('ruletaCatCount').value = catKeys.length;
      ctrl.ruletaCambiarCantidad();
      await new Promise(r => setTimeout(r, 50));
      const container = id('ruletaCatInputs');
      catKeys.forEach(function(key, i) {
        const cat = cats[key];
        const nameInp = container.querySelector('.ruleta-cat-name[data-idx="' + (i + 1) + '"]');
        const itemsTa = container.querySelector('.ruleta-cat-items[data-idx="' + (i + 1) + '"]');
        if (nameInp) nameInp.value = cat.name || key;
        if (itemsTa) itemsTa.value = (cat.items || []).join('\n');
      });
    }
    toast('📥 Ruleta importada (' + catKeys.length + ' categorías)');
  } catch { toast('❌ Error al importar'); }
  event.target.value = '';
};

// Hangman
ctrl.hangmanIniciar = async function() {
  try {
    await apiPost('/hangman/iniciar');
    id('btnHangmanIniciar').textContent = '🪢 INICIANDO…';
    id('btnHangmanIniciar').disabled = true;
    setTimeout(() => {
      id('btnHangmanIniciar').textContent = '🪢 INICIAR AHORCADO';
      id('btnHangmanIniciar').disabled = false;
    }, 500);
    toast('🪢 Ahorcado iniciado');
  } catch { toast('❌ Error al iniciar'); }
};

ctrl.hangmanGuess = async function(letra) {
  if (!letra) return;
  try { await apiPost('/hangman/guess', { letra }); }
  catch { toast('❌ Error'); }
};

ctrl.hangmanHint = async function() {
  try { const r = await apiPost('/hangman/hint'); toast('💡 ' + (r.pista || 'Pista enviada')); }
  catch { toast('❌ Error'); }
};

// Enter key sends admin letter
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement === id('hangmanAdminInput')) {
    e.preventDefault();
    ctrl.hangmanAdminSend();
  }
});

ctrl.hangmanClose = async function() {
  try { await apiPost('/hangman/close'); toast('✅ Ahorcado cerrado'); }
  catch { toast('❌ Error'); }
};

ctrl.hangmanAdminSend = function() {
  const input = id('hangmanAdminInput');
  if (!input) return;
  const letter = input.value.trim().toUpperCase();
  if (!letter || letter.length !== 1) { toast('⚠ Escribe una sola letra'); return; }
  input.value = '';
  input.focus();
  ctrl.hangmanGuess(letter);
};

ctrl.hangmanGuardarConfig = async function() {
  const max_attempts = parseInt(id('hangmanMaxAttempts').value) || 6;
  const timer = parseInt(id('hangmanTimer').value) || 60;
  const wordsRaw = id('hangmanWordsArea').value.trim();
  const words = wordsRaw ? wordsRaw.split('\n').map(function(w) { return w.trim().toUpperCase(); }).filter(function(w) { return w.length > 0; }) : [];
  try {
    await apiPost('/config/modes/save', { mode: 'hangman', config: { enabled: true, icon: '🪢', max_attempts, timer, words } });
    toast('💾 Configuración guardada (' + words.length + ' palabras)');
    fetchRetry(API + '/config').then(function(d) { state.config = d; loadModeConfigs(); });
  } catch { toast('❌ Error al guardar'); }
};

ctrl.hangmanExportar = function() {
  const max_attempts = parseInt(id('hangmanMaxAttempts').value) || 6;
  const timer = parseInt(id('hangmanTimer').value) || 60;
  const wordsRaw = id('hangmanWordsArea').value.trim();
  const words = wordsRaw ? wordsRaw.split('\n').map(function(w) { return w.trim(); }).filter(function(w) { return w.length > 0; }) : [];
  const data = { ahorcado: { max_attempts, timer, words } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ahorcado.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
  toast('📤 Ahorcado exportado');
};

ctrl.hangmanImportar = async function(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const cfg = data.ahorcado || data;
    if (cfg.words && Array.isArray(cfg.words)) {
      id('hangmanWordsArea').value = cfg.words.join('\n');
    }
    if (cfg.max_attempts) id('hangmanMaxAttempts').value = cfg.max_attempts;
    if (cfg.timer) id('hangmanTimer').value = cfg.timer;
    toast('📥 Ahorcado importado (' + (cfg.words?.length || 0) + ' palabras)');
  } catch { toast('❌ Error al importar'); }
  event.target.value = '';
};

// Display controls
ctrl.toggleKiosko = async function() {
  try { await apiPost('/display/kiosko'); } catch { toast('❌ Error'); }
};
ctrl.toggleAnimaciones = async function() {
  try { await apiPost('/display/animations'); } catch { toast('❌ Error'); }
};
ctrl.resetOverlays = async function() {
  try { await apiPost('/display/reset-overlays'); toast('🔄 Overlays reiniciados'); } catch { toast('❌ Error'); }
};
ctrl.toggleBlackScreen = async function() {
  try {
    const res = await apiPost('/display/black-screen');
    state.display_config = state.display_config || {};
    state.display_config.black_screen = !(state.display_config.black_screen || false);
    const btn = id('dashBlackBtn');
    if (btn) {
      btn.textContent = state.display_config.black_screen ? '⬛ Black: ON' : '⬛ Black';
      btn.className = state.display_config.black_screen ? 'btn btn-red btn-sm' : 'btn btn-ghost btn-sm';
    }
    const btn2 = id('temasCleanBtn');
    if (btn2) {
      btn2.textContent = state.display_config.black_screen ? '⬛ Black: ON' : '⬛ Black';
      btn2.className = state.display_config.black_screen ? 'btn btn-red btn-block' : 'btn btn-ghost btn-block';
    }
    toast('⬛ Black Screen: ' + (state.display_config.black_screen ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Black Screen'); }
};
ctrl.toggleFreeze = async function() {
  try {
    const res = await apiPost('/display/freeze');
    state.display_config = state.display_config || {};
    state.display_config.frozen = !(state.display_config.frozen || false);
    const btn = id('dashFreezeBtn');
    if (btn) {
      btn.textContent = state.display_config.frozen ? '⏸ Freeze: ON' : '⏸ Freeze';
      btn.className = state.display_config.frozen ? 'btn btn-yellow btn-sm' : 'btn btn-ghost btn-sm';
    }
    const btn2 = id('temasCleanBtn');
    if (btn2) {
      btn2.textContent = state.display_config.frozen ? '⏸ Freeze: ON' : '⏸ Freeze';
      btn2.className = state.display_config.frozen ? 'btn btn-yellow btn-block' : 'btn btn-ghost btn-block';
    }
    toast('⏸ Freeze: ' + (state.display_config.frozen ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Freeze'); }
};
ctrl.toggleClean = async function() {
  try {
    const res = await apiPost('/display/clean');
    state.display_config = state.display_config || {};
    state.display_config.clean = !(state.display_config.clean || false);
    const btn = id('dashCleanBtn');
    if (btn) {
      btn.textContent = state.display_config.clean ? '🧹 Clean: ON' : '🧹 Clean';
      btn.className = state.display_config.clean ? 'btn btn-yellow btn-sm' : 'btn btn-ghost btn-sm';
    }
    const btn2 = id('temasCleanBtn');
    if (btn2) {
      btn2.textContent = state.display_config.clean ? '🧹 Clean: ON' : '🧹 Clean';
      btn2.className = state.display_config.clean ? 'btn btn-yellow btn-block' : 'btn btn-ghost btn-block';
    }
    toast('🖼️ Clean Mode: ' + (state.display_config.clean ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Clean Mode'); }
};
ctrl.toggleSoloScores = async function() {
  try {
    const res = await apiPost('/display/solo-scores');
    state.display_config = state.display_config || {};
    state.display_config.solo_scores = !(state.display_config.solo_scores || false);
    toast('📊 Solo Scores: ' + (state.display_config.solo_scores ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Solo Scores'); }
};
ctrl.toggleFinalRound = async function() {
  try {
    const res = await apiPost('/display/final-round');
    state.display_config = state.display_config || {};
    state.display_config.final_round = !(state.display_config.final_round || false);
    const btn = id('dashFinalBtn');
    if (btn) {
      btn.textContent = state.display_config.final_round ? '🏆 Final: ON' : '🏆 Final';
      btn.className = state.display_config.final_round ? 'btn btn-red btn-sm' : 'btn btn-ghost btn-sm';
    }
    toast('🏆 Final Round: ' + (state.display_config.final_round ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Final Round'); }
};
ctrl.toggleFinalResults = async function() {
  const showing = state.display_config?.final_results;
  try {
    if (showing) {
      await apiPost('/display/final-results/hide');
      state.display_config.final_results = false;
      toast('🏆 Resultados ocultados');
    } else {
      await apiPost('/display/final-results');
      state.display_config.final_results = true;
      toast('🏆 Resultados mostrados');
    }
  } catch { toast('❌ Error al cambiar resultados'); }
};
ctrl.setTheme = async function(theme) {
  try { await apiPost('/display/theme', { theme }); toast('🎨 Tema: ' + theme); } catch { toast('❌ Error'); }
};
ctrl.setBgStyle = async function(style) {
  try { await apiPost('/display/bg-style', { style }); toast('🎨 Fondo: ' + style); } catch { toast('❌ Error'); }
};
ctrl.toggleDecorations = async function() {
  try { await apiPost('/display/decorations'); toast('💎 Decoraciones'); } catch { toast('❌ Error'); }
};
ctrl.toggleParticles = async function() {
  try { await apiPost('/display/particles'); toast('✨ Lluvia'); } catch { toast('❌ Error'); }
};
ctrl.toggleScreenShake = async function() {
  try { await apiPost('/display/screen-shake'); toast('🌊 Screen Shake'); } catch { toast('❌ Error'); }
};
ctrl.toggleConfetti = async function() {
  try { await apiPost('/display/confetti'); toast('🎊 Confetti'); } catch { toast('❌ Error'); }
};
ctrl.toggleSound = async function() {
  try { await apiPost('/display/sound'); toast('🔊 Sonido'); } catch { toast('❌ Error'); }
};
ctrl.toggleScanline = async function() {
  try { await apiPost('/display/scanline'); toast('📺 Scanline'); } catch { toast('❌ Error'); }
};
ctrl.toggleGlowFx = async function() {
  try { await apiPost('/display/glow-fx'); toast('✨ Brillo Extra'); } catch { toast('❌ Error'); }
};
ctrl.toggleUltraGlow = async function() {
  try { await apiPost('/display/ultra-glow'); toast('🌟 Ultra Glow'); } catch { toast('❌ Error'); }
};
ctrl.toggleMicroParticles = async function() {
  try { await apiPost('/display/micro-particles'); toast('✦ Micro Partículas'); } catch { toast('❌ Error'); }
};
ctrl.toggleGlassMorph = async function() {
  toast('🪟 Glass Morph eliminado');
};
ctrl.toggleDynamicBg = async function() {
  try { await apiPost('/display/dynamic-bg'); toast('🌌 Fondo Dinámico'); } catch { toast('❌ Error'); }
};
ctrl.toggleFractalAnimations = async function() {
  try { await apiPost('/display/fractal-animations'); toast('🌀 Fractales'); } catch { toast('❌ Error'); }
};
ctrl.toggleVignette = async function() {
  try { await apiPost('/display/vignette'); toast('🎬 Vignete'); } catch { toast('❌ Error'); }
};
ctrl.toggleGlowPulse = async function() {
  try { await apiPost('/display/glow-pulse'); toast('✨ Pulso Brillo'); } catch { toast('❌ Error'); }
};
ctrl.toggleScoreBreathe = async function() {
  try { await apiPost('/display/score-breathe'); toast('💫 Score Animate'); } catch { toast('❌ Error'); }
};
ctrl.toggleBgBreath = async function() {
  try {
    const res = await apiPost('/display/bg-breath');
    state.display_config = state.display_config || {};
    state.display_config.bg_breath = !(state.display_config.bg_breath || false);
    toast('🌫️ Fondo Respira: ' + (state.display_config.bg_breath ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Fondo Respira'); }
};

ctrl.toggleQuizModeEffects = async function() {
  const isActive = state.modo_activo === 'preguntas';
  if (!isActive) {
    toast('⚠ Activa el modo preguntas primero');
    return;
  }
  try {
    const res = await apiPost('/modo/preguntas/effects');
    state.display_config = state.display_config || {};
    state.display_config.quiz_mode_effects = !(state.display_config.quiz_mode_effects || false);
    toast('❓ Efectos de Modo Preguntas: ' + (state.display_config.quiz_mode_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar efectos de modo preguntas'); }
};

ctrl.toggleTimerModeEffects = async function() {
  try {
    const res = await apiPost('/display/timer-mode-effects');
    state.display_config = state.display_config || {};
    state.display_config.timer_mode_effects = !(state.display_config.timer_mode_effects || false);
    toast('⏱ Efectos del Timer: ' + (state.display_config.timer_mode_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar efectos del timer'); }
};

ctrl.toggleScoreEffects = async function() {
  try {
    const res = await apiPost('/display/score-effects');
    state.display_config = state.display_config || {};
    state.display_config.score_effects = !(state.display_config.score_effects || false);
    toast('🏆 Efectos de Puntos: ' + (state.display_config.score_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar efectos de puntuación'); }
};

ctrl.toggleAnswerRevealEffects = async function() {
  try {
    const res = await apiPost('/display/answer-reveal-effects');
    state.display_config = state.display_config || {};
    state.display_config.answer_reveal_effects = !(state.display_config.answer_reveal_effects || false);
    toast('👁 Efectos de Revelado: ' + (state.display_config.answer_reveal_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar efectos de revelado'); }
};

ctrl.toggleControlTheme = function() {
  const html = document.documentElement;
  const isLight = html.classList.toggle('control-light'); // Fixed toggle behavior
  localStorage.setItem('controlTheme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btnControlTheme');
  if (btn) btn.textContent = isLight ? '🌙 Tema Oscuro' : '☀️ Tema Claro';
};

ctrl.toggleThemeEffects = async function() {
  try {
    const res = await apiPost('/display/theme-effects');
    state.display_config = state.display_config || {};
    state.display_config.theme_effects = !(state.display_config.theme_effects || false);
    toast('🎨 Efectos de Tema: ' + (state.display_config.theme_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Efectos de Tema'); }
};

ctrl.toggleAnimatedBackgrounds = async function() {
  try {
    const res = await apiPost('/display/animated-bg');
    state.display_config = state.display_config || {};
    state.display_config.animated_bg = !(state.display_config.animated_bg || false);
    toast('✨ Fondos Animados: ' + (state.display_config.animated_bg ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Fondos Animados'); }
};

ctrl.toggleDynamicTheme = async function() {
  try {
    const res = await apiPost('/display/dynamic-theme');
    state.display_config = state.display_config || {};
    state.display_config.dynamic_theme = !(state.display_config.dynamic_theme || false);
    toast('🎭 Tema Dinámico: ' + (state.display_config.dynamic_theme ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Tema Dinámico'); }
};

ctrl.toggleCustomEffects = async function() {
  try {
    const res = await apiPost('/display/custom-effects');
    state.display_config = state.display_config || {};
    state.display_config.custom_effects = !(state.display_config.custom_effects || false);
    toast('🎬 Efectos Personalizados: ' + (state.display_config.custom_effects ? 'ON' : 'OFF'));
  } catch { toast('❌ Error al cambiar Efectos Personalizados'); }
};

ctrl.toggleHapticFeedback = function() {
  const enabled = state.display_config?.haptic_feedback !== false;
  state.display_config = state.display_config || {};
  state.display_config.haptic_feedback = !enabled;
  toast('🔊 Retroalimentación Háptica: ' + (!enabled ? 'Habilitado' : 'Deshabilitado'));
};

ctrl.toggleTouchEffects = function() {
  const enabled = state.display_config?.touch_effects !== false;
  state.display_config = state.display_config || {};
  state.display_config.touch_effects = !enabled;
  toast('👆 Efectos Tactiles: ' + (!enabled ? 'Habilitados' : 'Deshabilitados'));
};

// ── Practice Mode ──
let _practiceMode = false;
ctrl.togglePracticeMode = function() {
  _practiceMode = !_practiceMode;
  const btn = id('dashPracticeBtn');
  if (btn) {
    btn.textContent = _practiceMode ? '🎯 Práctica ON' : '🎯 Práctica';
    btn.className = _practiceMode ? 'btn btn-green btn-sm' : 'btn btn-ghost btn-sm';
  }
  toast(_practiceMode ? '🎯 Modo práctica activado — sin puntos' : '🎯 Modo práctica desactivado');
};

// ── Custom Theme Editor ──
ctrl.onThemeEditorChange = function() {
  const primary = id('themePrimary')?.value || '#0038ff';
  const secondary = id('themeSecondary')?.value || '#ffffff';
  const accent = id('themeAccent')?.value || '#7C3AED';
  const brightness = id('themeBrightness')?.value || 70;
  const saturation = id('themeSaturation')?.value || 100;
  const bgOpacity = id('themeBgOpacity')?.value || 100;
  const borderRadius = id('themeBorderRadius')?.value || 12;
  const animSpeed = id('themeAnimSpeed')?.value || 1;
  if (id('themePrimaryHex')) id('themePrimaryHex').textContent = primary;
  if (id('themeSecondaryHex')) id('themeSecondaryHex').textContent = secondary;
  if (id('themeAccentHex')) id('themeAccentHex').textContent = accent;
  if (id('themeBrightnessVal')) id('themeBrightnessVal').textContent = brightness + '%';
  if (id('themeSaturationVal')) id('themeSaturationVal').textContent = saturation + '%';
  if (id('themeBgOpacityVal')) id('themeBgOpacityVal').textContent = bgOpacity + '%';
  if (id('themeBorderRadiusVal')) id('themeBorderRadiusVal').textContent = borderRadius + 'px';
  if (id('themeAnimSpeedVal')) id('themeAnimSpeedVal').textContent = animSpeed + 'x';
  ctrl._previewTheme = {
    primary, secondary, accent,
    brightness: parseInt(brightness), saturation: parseInt(saturation),
    bg_opacity: parseInt(bgOpacity), border_radius: parseInt(borderRadius),
    animation_speed: parseFloat(animSpeed)
  };
};

ctrl.previewCustomTheme = async function() {
  if (!ctrl._previewTheme) ctrl.onThemeEditorChange();
  try {
    await apiPost('/display/custom-theme', { custom_theme: ctrl._previewTheme });
    toast('👁 Preview del tema aplicado');
  } catch { toast('❌ Error'); }
};

ctrl.saveCustomTheme = async function() {
  if (!ctrl._previewTheme) ctrl.onThemeEditorChange();
  try {
    await apiPost('/display/custom-theme', { custom_theme: ctrl._previewTheme });
    toast('💾 Tema personalizado guardado');
  } catch { toast('❌ Error'); }
};

ctrl.resetCustomTheme = async function() {
  try {
    await apiPost('/display/custom-theme', { custom_theme: null });
    id('themePrimary').value = '#0038ff';
    id('themeSecondary').value = '#ffffff';
    id('themeAccent').value = '#7C3AED';
    id('themeBrightness').value = 70;
    id('themeSaturation').value = 100;
    id('themeBgOpacity').value = 100;
    id('themeBorderRadius').value = 12;
    id('themeAnimSpeed').value = 1;
    ctrl.onThemeEditorChange();
    toast('🔄 Tema reseteado');
  } catch { toast('❌ Error'); }
};

ctrl.applyThemePreset = async function(preset) {
  const presets = {
    starry: { primary: '#0a0e27', secondary: '#e0e7ff', accent: '#818cf8', brightness: 60, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    forest: { primary: '#064e3b', secondary: '#d1fae5', accent: '#34d399', brightness: 70, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    sunset: { primary: '#7c2d12', secondary: '#fef3c7', accent: '#f59e0b', brightness: 80, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    rain: { primary: '#1e293b', secondary: '#cbd5e1', accent: '#64748b', brightness: 50, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    bluefire: { primary: '#1e3a5f', secondary: '#bfdbfe', accent: '#3b82f6', brightness: 75, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    royalty: { primary: '#4c1d95', secondary: '#ede9fe', accent: '#a78bfa', brightness: 65, saturation: 100, bg_opacity: 100, border_radius: 12, animation_speed: 1 },
    neon: { primary: '#000000', secondary: '#00ff00', accent: '#ff00ff', brightness: 100, saturation: 100, bg_opacity: 100, border_radius: 0, animation_speed: 1.5 },
    paper: { primary: '#fefce8', secondary: '#1c1917', accent: '#dc2626', brightness: 90, saturation: 100, bg_opacity: 100, border_radius: 4, animation_speed: 0.8 }
  };
  const p = presets[preset];
  if (!p) return;
  id('themePrimary').value = p.primary;
  id('themeSecondary').value = p.secondary;
  id('themeAccent').value = p.accent;
  id('themeBrightness').value = p.brightness;
  id('themeSaturation').value = p.saturation;
  id('themeBgOpacity').value = p.bg_opacity;
  id('themeBorderRadius').value = p.border_radius;
  id('themeAnimSpeed').value = p.animation_speed;
  ctrl.onThemeEditorChange();
  ctrl.previewCustomTheme();
  toast('🎨 Preset: ' + preset);
};

ctrl.setThemeTransition = async function(type) {
  try {
    await apiPost('/display/theme-transition', { transition: type });
    toast('🎬 Transición: ' + type);
  } catch { toast('❌ Error'); }
};

// ── Ambient Effects ──
ctrl.toggleAmbientStars = async function() {
  try { await apiPost('/display/ambient', { effect: 'stars' }); toast('⭐ Estrellas'); } catch { toast('❌ Error'); }
};
ctrl.toggleAmbientFog = async function() {
  try { await apiPost('/display/ambient', { effect: 'fog' }); toast('🌫 Niebla'); } catch { toast('❌ Error'); }
};
ctrl.toggleAmbientLightning = async function() {
  try { await apiPost('/display/ambient', { effect: 'lightning' }); toast('⚡ Rayos'); } catch { toast('❌ Error'); }
};
ctrl.toggleAmbientGolden = async function() {
  try { await apiPost('/display/ambient', { effect: 'golden' }); toast('✨ Partículas Doradas'); } catch { toast('❌ Error'); }
};
ctrl.toggleAmbientConfetti = async function() {
  try { await apiPost('/display/ambient', { effect: 'confetti' }); toast('🎊 Confetti'); } catch { toast('❌ Error'); }
};
ctrl.toggleAmbientFireworks = async function() {
  try { await apiPost('/display/ambient', { effect: 'fireworks' }); toast('🎆 Fuegos Artificiales'); } catch { toast('❌ Error'); }
};

// ── New Visual Features ──
ctrl.setScoreAnim = async function(anim) {
  try { await apiPost('/display/score-anim', { anim }); toast('🎯 Anim: ' + anim); } catch { toast('❌ Error'); }
};
ctrl.toggleCrownLeader = async function() {
  try { await apiPost('/display/crown-leader'); toast('👑 Corona'); } catch { toast('❌ Error'); }
};
ctrl.setFlashIntensity = async function(intensity) {
  try { await apiPost('/display/flash-intensity', { intensity }); toast('💡 Flash: ' + intensity); } catch { toast('❌ Error'); }
};
ctrl.toggleShowProgress = async function() {
  try { await apiPost('/display/show-progress'); toast('📊 Progreso'); } catch { toast('❌ Error'); }
};
ctrl.setEdgeBlend = async function(preset) {
  try { await apiPost('/display/edge-blend', { preset }); toast('🎬 Blend: ' + preset); } catch { toast('❌ Error'); }
};
ctrl.toggleWelcomeScreen = async function() {
  try { await apiPost('/display/welcome-screen'); toast('🏠 Bienvenida'); } catch { toast('❌ Error'); }
};
ctrl.toggleShowVerse = async function() {
  try { await apiPost('/display/show-verse'); toast('📖 Verso'); } catch { toast('❌ Error'); }
};
ctrl.toggleDynamicBars = async function() {
  try { await apiPost('/display/dynamic-bars'); toast('📊 Barras'); } catch { toast('❌ Error'); }
};

// ── Scene Presets ──
ctrl.applyScenePreset = async function(preset) {
  const presets = {
    sobrio: { theme: 'dark', bg: 'default', effects: [], decorations: false, ambient: [] },
    fiesta: { theme: 'ocean', bg: 'gradient', effects: ['confetti'], decorations: true, ambient: ['ambient-confetti'] },
    epico: { theme: 'fire', bg: 'gradient', effects: ['glow_fx', 'ultra_glow'], decorations: true, ambient: ['ambient-fireworks', 'ambient-golden'] },
    infantil: { theme: 'default', bg: 'particles', effects: ['confetti'], decorations: true, ambient: ['ambient-stars'] },
    solemne: { theme: 'dark', bg: 'none', effects: [], decorations: false, ambient: ['ambient-fog'] },
    competitivo: { theme: 'default', bg: 'gradient', effects: ['glow_fx', 'scanline'], decorations: true, ambient: ['ambient-lightning'] }
  };
  const p = presets[preset];
  if (!p) return;
  try {
    await apiPost('/display/theme', { theme: p.theme });
    await apiPost('/display/bg-style', { style: p.bg });
    for (const eff of p.effects) {
      await apiPost('/display/' + eff.replace('_', '-'));
    }
    toast('🎬 Escena: ' + preset);
  } catch { toast('❌ Error'); }
};
// Display Preview
ctrl.toggleDisplayPreview = function() {
  const el = id('displayPreview');
  if (!el) return;
  _displayPreviewVisible = !_displayPreviewVisible;
  el.classList.toggle('minimized', !_displayPreviewVisible);
};

// Dashboard: Launch mode
ctrl.lanzarModo = async function(mode) {
  try {
    const res = await apiPost('/modo/' + mode + '/iniciar');
    if (res.error) { toast('⚠ ' + res.error); return; }
    toast('▶ Modo ' + mode + ' iniciado');
    const updated = await fetchRetry(API + '/estado-actual').catch(() => ({}));
    state = { ...state, ...updated };
    renderAll();
  } catch { toast('❌ Error al iniciar modo'); }
};

ctrl.ejecutarSiguienteRonda = async function() {
  const mode = id('dashNextRound')?.value;
  if (!mode) { toast('⚠ Selecciona un modo primero'); return; }
  await ctrl.lanzarModo(mode);
};

// Dashboard: Sparkline
let _sparklineHistory = [];
function renderSparkline() {
  const canvas = id('dashSparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 60 * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = 60;

  const grupos = gruposConfig || [];
  if (!grupos.length) { ctx.clearRect(0, 0, w, h); return; }

  const snapshot = {};
  grupos.forEach(g => { snapshot[g.key] = state.puntos?.[g.key] || 0; });
  _sparklineHistory.push(snapshot);
  if (_sparklineHistory.length > 30) _sparklineHistory.shift();

  ctx.clearRect(0, 0, w, h);
  const maxVal = Math.max(1, ..._sparklineHistory.flatMap(s => Object.values(s)));
  const len = _sparklineHistory.length;
  if (len < 2) return;

  grupos.forEach(g => {
    ctx.beginPath();
    ctx.strokeStyle = g.color || '#888';
    ctx.lineWidth = 2;
    _sparklineHistory.forEach((snap, i) => {
      const x = (i / (len - 1)) * w;
      const y = h - ((snap[g.key] || 0) / maxVal) * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

// Dashboard: Game state info
function renderGameStateInfo() {
  const groupsEl = id('dashGameGroups');
  const questionsEl = id('dashGameQuestions');
  const modeEl = id('dashGameMode');
  const timerEl = id('dashGameTimer');
  if (groupsEl) groupsEl.textContent = (gruposConfig || []).length;
  if (questionsEl) questionsEl.textContent = (preguntasCache || []).length;
  if (modeEl) {
    const modeNames = { preguntas: 'Preguntas', verses: 'Tiempo', roulette: 'Ruleta', hangman: 'Ahorcado', battle: 'Batalla', survival: 'Supervivencia', quizshow: 'Quiz Show' };
    modeEl.textContent = modeNames[state.modo_activo] || '—';
  }
  if (timerEl) {
    const t = state.temporizador || {};
    timerEl.textContent = t.activo ? t.segundos_restantes + 's' : '—';
  }
  // Update stats
  const statsEl = id('dashStatsShown');
  const correctEl = id('dashStatsCorrect');
  const incorrectEl = id('dashStatsIncorrect');
  const accuracyEl = id('dashStatsAccuracy');
  const streakEl = id('dashStatsMaxStreak');
  if (statsEl) statsEl.textContent = _stats.questionsShown || 0;
  if (correctEl) correctEl.textContent = _stats.correctAnswers || 0;
  if (incorrectEl) incorrectEl.textContent = _stats.incorrectAnswers || 0;
  if (accuracyEl) {
    const total = (_stats.correctAnswers || 0) + (_stats.incorrectAnswers || 0);
    accuracyEl.textContent = total > 0 ? Math.round((_stats.correctAnswers || 0) / total * 100) + '%' : '0%';
  }
  if (streakEl) streakEl.textContent = _stats.maxStreak || 0;
}

const _stats = { questionsShown: 0, correctAnswers: 0, incorrectAnswers: 0, maxStreak: 0 };

// Config / Export
ctrl.exportarJSON = async function() {
  try {
    const r = await fetchRetry(API + '/estado-actual');
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sillyquiz-estado.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    toast('📥 Estado exportado');
  } catch { toast('❌ Error'); }
};

ctrl.exportarResultados = async function() {
  try {
    const r = await fetch(API + '/exportar/resultados');
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sillyquiz-resultados.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    toast('📊 Resultados exportados');
  } catch { toast('❌ Error'); }
};

ctrl.exportarResultadosCSV = async function() {
  try {
    const r = await fetch(API + '/exportar/resultados/csv');
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sillyquiz-resultados.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    toast('📊 CSV exportado');
  } catch { toast('❌ Error'); }
};

// ── Exportar modo como .lkqpackage (ZIP con manifest + assets) ──
ctrl.exportarModoPaquete = async function(modeId) {
  if (!modeId) { toast('❌ Selecciona un modo primero'); return; }
  try {
    const r = await fetch(`${API}/templates/${modeId}/export`, { method: 'GET' });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Error al exportar');
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modeId}.lkqmode`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    toast('📦 Modo exportado como .lkqmode');
  } catch (e) {
    toast('❌ Error exportando: ' + e.message);
  }
};

// ── Print-Friendly Results ──
ctrl.imprimirResultados = async function() {
  try {
    const r = await fetch(API + '/exportar/resultados');
    if (!r.ok) throw new Error();
    const data = await r.json();
    const ranking = data.ranking || [];
    const fecha = data.fecha || new Date().toLocaleString('es');
    const modeNames = { preguntas: 'Preguntas', verses: 'Tiempo', roulette: 'Ruleta', hangman: 'Ahorcado', battle: 'Batalla', survival: 'Supervivencia', quizshow: 'Quiz Show' };
    const modo = modeNames[state.modo_activo] || state.modo_activo || 'General';
    const icons = ['🥇', '🥈', '🥉'];
    let rows = '';
    ranking.forEach((r, i) => {
      const icon = i < 3 ? icons[i] : `${i+1}°`;
      const style = i < 3 ? 'font-weight:700;' : '';
      rows += `<tr style="${style}"><td style="text-align:center;font-size:1.2rem;">${icon}</td><td>${r.grupo}</td><td style="text-align:center;font-weight:700;">${r.puntos}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Resultados - SillyQuiz</title><style>
      @page{margin:1.5cm;}body{font-family:'Segoe UI',sans-serif;color:#1a1a2e;padding:40px;max-width:700px;margin:0 auto;}
      h1{text-align:center;font-size:2rem;margin-bottom:4px;}h2{text-align:center;font-size:1rem;font-weight:400;color:#666;margin-top:0;}
      .date{text-align:center;color:#999;font-size:0.85rem;margin-bottom:24px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}th,td{padding:10px 16px;border-bottom:1px solid #e0e0e0;text-align:left;}
      th{background:#f5f5f5;font-size:0.85rem;text-transform:uppercase;letter-spacing:0.5px;}
      tr:nth-child(even){background:#fafafa;}.footer{text-align:center;margin-top:32px;color:#999;font-size:0.8rem;border-top:1px solid #eee;padding-top:12px;}
      @media print{body{padding:0;}h1{font-size:1.6rem;}}
    </style></head><body>
      <h1>🏆 RESULTADOS FINALES</h1>
      <h2>Modo: ${modo}</h2>
      <div class="date">${fecha}</div>
      <table><thead><tr><th style="width:60px;">#</th><th>Grupo</th><th style="width:80px;text-align:center;">Puntos</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="footer">Generado por SillyQuiz</div>
    </body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 400);
    toastSuccess('🖨️ Resultados listos para imprimir');
  } catch { toastError('❌ Error al generar resultados'); }
};

// ── Certificate Generator ──
ctrl.generarCertificados = async function() {
  try {
    const r = await fetch(API + '/exportar/resultados');
    if (!r.ok) throw new Error();
    const data = await r.json();
    const ranking = data.ranking || [];
    const top3 = ranking.slice(0, 3);
    if (top3.length === 0) { toastWarning('⚠ No hay resultados'); return; }
    const fecha = data.fecha || new Date().toLocaleString('es');
    const modeNames = { preguntas: 'Preguntas', verses: 'Tiempo', roulette: 'Ruleta', hangman: 'Ahorcado', battle: 'Batalla', survival: 'Supervivencia', quizshow: 'Quiz Show' };
    const modo = modeNames[state.modo_activo] || state.modo_activo || 'General';
    const medals = ['🥇', '🥈', '🥉'];
    const titles = ['1er Lugar', '2do Lugar', '3er Lugar'];
    const colors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    const accents = ['#B8860B', '#808080', '#8B4513'];
    let certs = '';
    top3.forEach((r, i) => {
      certs += `<div class="cert-page">
        <div class="cert-border" style="border-color:${colors[i]};">
          <div class="cert-medal">${medals[i]}</div>
          <div class="cert-title" style="color:${accents[i]};">CERTIFICADO DE LOGRO</div>
          <div class="cert-subtitle">Se otorga el reconocimiento de</div>
          <div class="cert-place" style="color:${accents[i]};">${titles[i]}</div>
          <div class="cert-team">"${r.grupo}"</div>
          <div class="cert-score">${r.puntos} PUNTOS</div>
          <div class="cert-details">Modo: ${modo} | ${fecha}</div>
          <div class="cert-footer">SILLYQUIZ</div>
        </div>
      </div>`;
    });
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Certificados - SillyQuiz</title><style>
      @page{size:landscape;margin:0;}body{margin:0;font-family:'Segoe UI',sans-serif;}
      .cert-page{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;page-break-after:always;page-break-inside:avoid;background:#f8f6f0;}
      .cert-page:last-child{page-break-after:auto;}
      .cert-border{border:8px solid #FFD700;border-radius:16px;padding:48px 64px;text-align:center;max-width:700px;width:80%;position:relative;background:#fffdf5;box-shadow:0 4px 24px rgba(0,0,0,0.1);}
      .cert-medal{font-size:4rem;margin-bottom:8px;}
      .cert-title{font-size:0.85rem;letter-spacing:6px;text-transform:uppercase;font-weight:700;margin:12px 0 4px;}
      .cert-subtitle{font-size:0.9rem;color:#666;margin:4px 0 8px;}
      .cert-place{font-size:2.2rem;font-weight:900;margin:8px 0;}
      .cert-team{font-size:1.8rem;font-weight:700;color:#1a1a2e;margin:12px 0;letter-spacing:1px;}
      .cert-score{font-size:1.3rem;font-weight:700;color:#444;margin:8px 0;}
      .cert-details{font-size:0.8rem;color:#999;margin-top:16px;}
      .cert-footer{font-size:0.7rem;letter-spacing:4px;text-transform:uppercase;color:#bbb;margin-top:20px;border-top:1px solid #eee;padding-top:8px;}
      @media print{body{margin:0;}.cert-page{background:#f8f6f0;}}
    </style></head><body>${certs}</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html); w.document.close();
    setTimeout(() => { try { w.print(); } catch {} }, 500);
    toastSuccess('📜 Certificados generados');
  } catch { toastError('❌ Error al generar certificados'); }
};

// Keyboard shortcuts
document.addEventListener('keydown', async (e) => {
  if (isEnInput()) return;
  const key = e.key.toLowerCase();
  if (key === 't') { e.preventDefault(); ctrl.iniciarTimer(); return; }
  if (e.key === ' ') { e.preventDefault(); if (!pregActualCache) { toast('⚠ No hay pregunta activa'); return; } ctrl.toggleRespuesta(!respuestaVisible); return; }
  if (e.key === 'Escape') { e.preventDefault(); if (pregActualCache) { ctrl.toggleRespuesta(false); apiPost('/pregunta-actual/clear'); } return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); await ctrl.irAPreguntaAnterior(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); await ctrl.irAPreguntaSiguiente(); return; }
  const num = parseInt(key);
  if (num >= 1 && num <= 9 && gruposConfig[num - 1]) {
    e.preventDefault();
    const cantidad = parseInt(id('inPuntos')?.value) || 10;
    try { await apiPost('/puntos', { grupo: gruposConfig[num - 1].key, cantidad }); toast('🏆 +' + cantidad + ' → ' + gruposConfig[num - 1].nombre); } catch { toast('❌ Error al sumar puntos'); }
    return;
  }
  if (key === 'k') { e.preventDefault(); ctrl.toggleKiosko(); }
  if (key === 'o') { e.preventDefault(); ctrl.resetOverlays(); }
  if (key === 'a') { e.preventDefault(); ctrl.toggleAnimaciones(); }
  if (key === 'b') { e.preventDefault(); ctrl.toggleBlackScreen(); }
  if (key === 'f') { e.preventDefault(); ctrl.toggleFreeze(); }
  if (key === 's') { e.preventDefault(); ctrl.salirTodo(); }
  if (key === 'c') { e.preventDefault(); ctrl.toggleClean(); }
  if (key === 'r') { e.preventDefault(); ctrl.reiniciarTimer(); }
  if (key === 'p') { e.preventDefault(); ctrl.toggleDisplayPreview(); }
});

// Display preview click handlers
document.addEventListener('click', function(e) {
  const closeBtn = e.target.closest('#displayPreviewClose');
  if (closeBtn) { ctrl.toggleDisplayPreview(); return; }
  const fullBtn = e.target.closest('#displayPreviewFull');
  if (fullBtn) { window.open('/display', '_blank'); return; }
  const interactBtn = e.target.closest('#displayPreviewInteract');
  if (interactBtn) {
    const iframe = document.querySelector('.display-preview-iframe');
    if (iframe) {
      const isInteract = iframe.style.pointerEvents !== 'auto';
      iframe.style.pointerEvents = isInteract ? 'auto' : 'none';
      interactBtn.style.color = isInteract ? 'var(--gold)' : '';
      interactBtn.textContent = isInteract ? '🖱️' : '🖱️';
    }
    return;
  }
  const minimizedPreview = e.target.closest('.display-preview.minimized');
  if (minimizedPreview) { ctrl.toggleDisplayPreview(); return; }
});

// Display preview draggable
const previewEl = id('displayPreview');
const previewHeader = previewEl?.querySelector('.display-preview-header');
if (previewEl && previewHeader) {
  let offX = 0, offY = 0, dragging = false;
  previewHeader.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    previewEl.classList.add('dragging');
    const rect = previewEl.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    previewEl.style.left = (e.clientX - offX) + 'px';
    previewEl.style.top = (e.clientY - offY) + 'px';
    previewEl.style.right = 'auto';
    previewEl.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', function() {
    dragging = false;
    previewEl.classList.remove('dragging');
  });
}

// Initialization
initTabs();
connectSSE({
  onMessage: function(data) {
    const ns = data;
    if (ns.puntos !== undefined) state.puntos = ns.puntos;
    if (ns.grupos !== undefined) state.grupos = ns.grupos;
    if (ns.pregunta_actual !== undefined) state.pregunta_actual = ns.pregunta_actual;
    if (ns.mostrar_respuesta !== undefined) state.mostrar_respuesta = ns.mostrar_respuesta;
    if (ns.mostrar_opciones !== undefined) state.mostrar_opciones = ns.mostrar_opciones;
    if (ns.temporizador !== undefined) state.temporizador = ns.temporizador;
    if (ns.actividad !== undefined) state.actividad = ns.actividad;
    if (ns.display_config !== undefined) {
      state.display_config = ns.display_config;
      if (ns.display_config.grupos_config) {
        gruposConfig = ns.display_config.grupos_config;
        state.grupos = gruposConfig;
      }
    }
    if (ns.ruleta !== undefined) state.ruleta = ns.ruleta;
    if (ns.hangman !== undefined) state.hangman = ns.hangman;
    if (ns.verses !== undefined) state.verses = ns.verses;
    if (ns.modo_activo !== undefined) state.modo_activo = ns.modo_activo;
    renderAll();
  },
  onStatusChange: function(connected) {
    const badge = document.querySelector('.content-header .badge');
    if (badge) {
      badge.textContent = connected ? '🟢 EN VIVO' : '🔴 DESCONECTADO';
      badge.className = 'badge' + (connected ? ' badge-success' : '');
    }
    const statusEl = document.getElementById('sidebarStatus');
    if (statusEl) {
      statusEl.textContent = connected ? '🟢' : '🔴';
      statusEl.className = 'sidebar-status' + (connected ? ' online' : '');
      statusEl.title = connected ? 'Conectado al servidor' : 'Desconectado';
    }
  }
});
// Restore saved theme
(function() {
  const saved = localStorage.getItem('controlTheme');
  if (saved === 'light') {
    document.documentElement.classList.add('control-light');
    document.getElementById('btnControlTheme').textContent = '🌙 Tema Oscuro';
  } else {
    document.getElementById('btnControlTheme').textContent = '☀️ Tema Claro';
  }
})();

fetchRetry(API + '/estado-actual').then(function(d) {
  Object.assign(state, d);
  if (d.display_config?.grupos_config) {
    gruposConfig = d.display_config.grupos_config;
    state.display_config = d.display_config;
    state.grupos = gruposConfig;
  }
  renderAll();
  const badge = document.querySelector('.content-header .badge');
  if (badge) {
    badge.textContent = '🟢 EN VIVO';
    badge.className = 'badge badge-success';
  }
  const statusEl = document.getElementById('sidebarStatus');
  if (statusEl) {
    statusEl.textContent = '🟢';
    statusEl.className = 'sidebar-status online';
    statusEl.title = 'Conectado al servidor';
  }
}).catch(function() {});
fetchRetry(API + '/preguntas').then(function(d) {
  preguntasCache = d.preguntas || [];
  if (d.categorias_disponibles) {
    categoriasDisponibles = d.categorias_disponibles;
    poblarCategoriaSelects();
  }
  renderPreguntasLista(preguntasCache);
}).catch(function() {});

// ── Render functions for new modes ──
function renderBatalla() {
  const groups = gruposConfig || [];
  const sel1 = id('batallaEq1');
  const sel2 = id('batallaEq2');
  if (sel1) { sel1.innerHTML = groups.map(g => '<option value="' + g.key + '">' + esc(g.nombre || g.key) + '</option>').join(''); }
  if (sel2) { sel2.innerHTML = groups.map(g => '<option value="' + g.key + '">' + esc(g.nombre || g.key) + '</option>').join(''); }
  if (sel2 && groups.length > 1) sel2.selectedIndex = 1;
  const statusEl = id('batallaStatus');
  if (statusEl) {
    const isActive = state.modo_activo === 'battle';
    statusEl.textContent = isActive ? 'Activa' : 'Inactiva';
    statusEl.className = 'badge ' + (isActive ? 'badge-success' : '');
  }
}

function renderSupervivencia() {
  const statusEl = id('survivalStatus');
  if (statusEl) {
    const isActive = state.modo_activo === 'survival';
    statusEl.textContent = isActive ? 'Activa' : 'Inactiva';
    statusEl.className = 'badge ' + (isActive ? 'badge-success' : '');
  }
}

function renderQuizShow() {
  const statusEl = id('quizshowStatus');
  if (statusEl) {
    const isActive = state.modo_activo === 'quizshow';
    statusEl.textContent = isActive ? 'Activo' : 'Inactivo';
    statusEl.className = 'badge ' + (isActive ? 'badge-success' : '');
  }
}

// ── Achievements System ──
const ACHIEVEMENTS = [
  { id: 'first_answer', name: 'Primera Vez', desc: 'Primera respuesta correcta', icon: '🎯' },
  { id: 'streak_3', name: 'Racha de 3', desc: '3 respuestas correctas seguidas', icon: '🔥' },
  { id: 'streak_5', name: 'Racha de 5', desc: '5 respuestas correctas seguidas', icon: '💥' },
  { id: 'streak_10', name: 'Racha de 10', desc: '10 respuestas correctas seguidas', icon: '⚡' },
  { id: 'all_modes', name: 'Explorador', desc: 'Usar todos los modos', icon: '🗺' },
  { id: 'speed_demon', name: 'Velocista', desc: 'Responder en menos de 3 segundos', icon: '⏱' },
  { id: 'perfect_round', name: 'Perfeccionista', desc: '100% precisión en una ronda', icon: '💎' },
  { id: 'veteran', name: 'Veterano', desc: 'Jugar 10 competencias', icon: '🎖' },
];

let _unlockedAchievements = JSON.parse(localStorage.getItem('achievements') || '[]');

function renderAchievements() {
  const el = id('achievementsList');
  if (!el) return;
  el.innerHTML = ACHIEVEMENTS.map(function(a) {
    const unlocked = _unlockedAchievements.includes(a.id);
    return '<div class="flex-row" style="align-items:center;gap:8px;padding:4px;opacity:' + (unlocked ? '1' : '0.4') + ';">' +
      '<span>' + a.icon + '</span>' +
      '<span class="flex-1"><strong>' + a.name + '</strong> — ' + a.desc + '</span>' +
      '<span>' + (unlocked ? '✅' : '🔒') + '</span></div>';
  }).join('');
}

function unlockAchievement(id) {
  if (_unlockedAchievements.includes(id)) return;
  _unlockedAchievements.push(id);
  localStorage.setItem('achievements', JSON.stringify(_unlockedAchievements));
  const a = ACHIEVEMENTS.find(function(x) { return x.id === id; });
  if (a) toast('🏆 Logro desbloqueado: ' + a.name, 3000);
  renderAchievements();
}

// ─── Theme Editor ───────────────────────────────────────────────────────────

const SHAPE_TYPES = [
  {id:'star', label:'⭐ Estrella'}, {id:'cross', label:'✝️ Cruz'},
  {id:'flame', label:'🔥 Llama'}, {id:'cup', label:'🏆 Copa'},
  {id:'crown', label:'👑 Corona'}, {id:'dove', label:'🕊 Paloma'},
  {id:'heart', label:'❤️ Corazón'}, {id:'lamp', label:'🪔 Lámpara'},
  {id:'wings', label:'🪽 Alas'}, {id:'key', label:'🔑 Llave'},
  {id:'fish', label:'🐟 Pez'}, {id:'sword', label:'⚔️ Espada'},
  {id:'shield', label:'🛡 Escudo'}, {id:'pray', label:'🙏 Oración'},
  {id:'hand', label:'✋ Mano'}, {id:'mountain', label:'⛰ Monte'},
  {id:'anchor', label:'⚓ Ancla'}, {id:'trumpet', label:'📯 Trompeta'},
  {id:'scroll', label:'📜 Rollo'}, {id:'stone', label:'🪨 Piedra'},
  {id:'bread', label:'🍞 Pan'}, {id:'tower', label:'🏛 Torre'},
  {id:'seal', label:'🔏 Sello'}, {id:'lamb', label:'🐑 Cordero'},
  {id:'ark', label:'🚢 Arca'}
];

let _themeList = [];
let _selectedTheme = null;
let _themeDirty = false;

function _teId(idStr) { return document.getElementById(idStr); }
function _teVal(idStr) { var el = _teId(idStr); return el ? el.value : null; }
function _teChecked(idStr) { var el = _teId(idStr); return el ? el.checked : false; }
function _teInt(idStr, def) { var v = parseInt(_teVal(idStr), 10); return isNaN(v) ? (def || 0) : v; }
function _teFloat(idStr, def) { var v = parseFloat(_teVal(idStr)); return isNaN(v) ? (def || 0) : v; }

function _initShapeCheckboxes() {
  var container = _teId('teShapeList');
  if (!container || container.children.length > 0) return;
  SHAPE_TYPES.forEach(function(s) {
    var label = document.createElement('label');
    label.className = 'flex-row';
    label.style.cssText = 'align-items:center;gap:3px;cursor:pointer;font-size:10px;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.id;
    cb.checked = true;
    cb.onchange = function() { ctrl.themeEditorChange(); };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + s.id));
    container.appendChild(label);
  });
}

function _collectThemeFromUI() {
  var shapes = [];
  var shapeCbs = (_teId('teShapeList') || {}).querySelectorAll('input[type=checkbox]:checked');
  shapeCbs && shapeCbs.forEach(function(cb) { shapes.push(cb.value); });

  return {
    name: _teVal('teName') || 'Untitled',
    description: _teVal('teDesc') || '',
    version: 2,
    colors: {
      primary: _teVal('teColorPrimary') || '#0038ff',
      secondary: _teVal('teColorSecondary') || '#ffffff',
      accent: _teVal('teColorAccent') || '#7C3AED',
      surface: _teVal('teColorSurface') || '#ffffff',
      text: _teVal('teColorText') || '#000000',
      border: _teVal('teColorBorder') || '#000000',
      glow: _teVal('teColorAccent') + '4D' || '#7C3AED4D',
      brightness: _teInt('teBrightness', 70),
      saturation: _teInt('teSaturation', 100)
    },
    typography: {
      heading_font: _teVal('teFontHeading') || 'Bebas Neue',
      body_font: _teVal('teFontBody') || 'Space Grotesk',
      timer_font: _teVal('teFontTimer') || 'Bebas Neue',
      score_font: _teVal('teFontScore') || 'Space Grotesk',
      size_scale: _teFloat('teFontScale', 100) / 100,
      text_shadow: _teChecked('teTextShadow'),
      text_glow: _teChecked('teTextGlow')
    },
    timer: {
      style: _teVal('teTimerStyle') || 'circle',
      position: _teVal('teTimerPos') || 'tr',
      size: _teVal('teTimerSize') || 'medium',
      colors: {
        background: _teVal('teTimerBg') || '#000000',
        text: _teVal('teTimerText') || '#ffffff',
        progress: _teVal('teTimerProgress') || '#7C3AED',
        background_opacity: _teInt('teTimerBgOpacity', 60) / 100
      }
    },
    layout: {
      scores_position: _teVal('teLayoutScores') || 'bottom',
      header_style: _teVal('teLayoutHeader') || 'full',
      logo_visible: _teChecked('teLayoutLogo'),
      decorations_visible: _teChecked('teLayoutDecor')
    },
    shapes: {
      enabled: shapes,
      spawn_rate: _teInt('teShapeRate', 2500),
      max_count: _teInt('teShapeMax', 15),
      color_source: _teVal('teShapeColor') || 'team',
      opacity: _teFloat('teShapeOpacity', 80) / 100
    },
    effects: {
      mode_transition: _teVal('teEffModeTrans') || 'fade',
      theme_transition: _teVal('teEffThemeTrans') || 'fade',
      intensity: _teFloat('teEffIntensity', 100) / 100,
      screen_shake: _teChecked('teEffShake'),
      confetti: _teChecked('teEffConfetti')
    }
  };
}

function _fillUIFromTheme(theme) {
  if (!theme) return;
  _setVal('teName', theme.name || '');
  _setVal('teDesc', theme.description || '');
  var c = theme.colors || {};
  _setVal('teColorPrimary', c.primary || '#0038ff');
  _setVal('teColorSecondary', c.secondary || '#ffffff');
  _setVal('teColorAccent', c.accent || '#7C3AED');
  _setVal('teColorSurface', c.surface || '#ffffff');
  _setVal('teColorText', c.text || '#000000');
  _setVal('teColorBorder', c.border || '#000000');
  _setVal('teBrightness', c.brightness != null ? c.brightness : 70);
  _setVal('teSaturation', c.saturation != null ? c.saturation : 100);
  var t = theme.typography || {};
  _setVal('teFontHeading', t.heading_font || 'Bebas Neue');
  _setVal('teFontBody', t.body_font || 'Space Grotesk');
  _setVal('teFontTimer', t.timer_font || 'Bebas Neue');
  _setVal('teFontScore', t.score_font || 'Space Grotesk');
  var scale = t.size_scale != null ? Math.round(t.size_scale * 100) : 100;
  _setVal('teFontScale', scale);
  _setVal('teTextShadow', t.text_shadow ? 'on' : 'off', true);
  _setVal('teTextGlow', t.text_glow ? 'on' : 'off', true);
  var tim = theme.timer || {};
  _setVal('teTimerStyle', tim.style || 'circle');
  _setVal('teTimerPos', tim.position || 'tr');
  _setVal('teTimerSize', tim.size || 'medium');
  var timC = tim.colors || {};
  _setVal('teTimerBg', timC.background ? timC.background.replace('rgba(','').replace(')','').split(',')[0] : '#000000');
  _setVal('teTimerText', timC.text || '#ffffff');
  _setVal('teTimerProgress', timC.progress || '#7C3AED');
  var bgOp = timC.background_opacity != null ? Math.round(timC.background_opacity * 100) : 60;
  _setVal('teTimerBgOpacity', bgOp);
  var l = theme.layout || {};
  _setVal('teLayoutScores', l.scores_position || 'bottom');
  _setVal('teLayoutHeader', l.header_style || 'full');
  _setVal('teLayoutLogo', l.logo_visible !== false ? 'on' : 'off', true);
  _setVal('teLayoutDecor', l.decorations_visible !== false ? 'on' : 'off', true);
  var sh = theme.shapes || {};
  var shapeCbs = (_teId('teShapeList') || {}).querySelectorAll('input[type=checkbox]');
  var enabled = sh.enabled || [];
  shapeCbs && shapeCbs.forEach(function(cb) { cb.checked = enabled.indexOf(cb.value) !== -1; });
  _setVal('teShapeRate', sh.spawn_rate || 2500);
  _setVal('teShapeMax', sh.max_count || 15);
  _setVal('teShapeColor', sh.color_source || 'team');
  var sop = sh.opacity != null ? Math.round(sh.opacity * 100) : 80;
  _setVal('teShapeOpacity', sop);
  var e = theme.effects || {};
  _setVal('teEffModeTrans', e.mode_transition || 'fade');
  _setVal('teEffThemeTrans', e.theme_transition || 'fade');
  var inten = e.intensity != null ? Math.round(e.intensity * 100) : 100;
  _setVal('teEffIntensity', inten);
  _setVal('teEffShake', e.screen_shake !== false ? 'on' : 'off', true);
  _setVal('teEffConfetti', e.confetti !== false ? 'on' : 'off', true);
  _themeDirty = false;
  _updateEditorStatus();
  ctrl.themeEditorChange();
}

function _setVal(idStr, val, isCheck) {
  var el = _teId(idStr);
  if (!el) return;
  if (isCheck) { el.checked = val === 'on' || val === true; return; }
  if (el.type === 'color') { el.value = val; return; }
  if (el.type === 'range') { el.value = val; _updateRangeLabel(idStr); return; }
  el.value = val;
}

function _updateRangeLabel(idStr) {
  var el = _teId(idStr);
  if (!el || el.type !== 'range') return;
  var labelId = idStr + 'Val';
  var lbl = _teId(labelId);
  if (lbl) lbl.textContent = el.value + '%';
}

function _updateEditorStatus() {
  var el = _teId('editorStatus');
  if (!el) return;
  var name = _selectedTheme ? _selectedTheme.name : 'Nuevo tema';
  el.textContent = (_themeDirty ? '⚠️ Sin guardar — ' : '✔ Guardado — ') + name;
}

ctrl.themeLoadList = async function() {
  _initShapeCheckboxes();
  try {
    var res = await fetchRetry(API + '/themes');
    var list = (res && res.themes) || [];
    if (!Array.isArray(list)) throw new Error('Lista inválida');
    _themeList = list;
    var container = _teId('themeList');
    if (!container) return;
    container.innerHTML = list.map(function(t) {
      var active = _selectedTheme && _selectedTheme.slug === t.slug ? 'active' : '';
      return '<div class="theme-list-item ' + active + '" data-slug="' + t.slug + '" onclick="ctrl.themeSelect(\'' + t.slug + '\')">' +
        '<strong>' + t.name + '</strong> <span class="text-xs text-muted">v' + (t.version || 1) + '</span>' +
        '<div class="text-xs text-muted" style="margin-top:2px;">' + (t.description || '') + '</div></div>';
    }).join('');
    if (!_selectedTheme && list.length > 0) {
      ctrl.themeSelect(list[0].slug);
    }

    // Populate rotation exclude dropdown
    var excludeSel = document.getElementById('rotationExclude');
    if (excludeSel) {
      excludeSel.innerHTML = list.map(function(t) {
        return '<option value="' + t.slug + '">' + t.name + '</option>';
      }).join('');
    }

    // Load rotation state
    await ctrl.themeRotationLoadState();
  } catch (e) {
    toast('⚠ Error cargando temas: ' + e.message);
  }
};

ctrl.themeSelect = async function(slug) {
  try {
    var res = await fetchRetry(API + '/themes/' + slug);
    if (!res) throw new Error('No encontrado');
    _selectedTheme = res;
    _fillUIFromTheme(res);
    var items = (_teId('themeList') || {}).querySelectorAll('.theme-list-item');
    items && items.forEach(function(el) { el.classList.toggle('active', el.dataset.slug === slug); });
    _updateEditorStatus();
    ctrl.themeEditorChange();
  } catch (e) {
    toast('⚠ Error seleccionando tema: ' + e.message);
  }
};

ctrl.themeNew = function() {
  _selectedTheme = null;
  var defaults = {
    name: 'Mi Tema',
    description: '',
    version: 2,
    colors: { primary:'#0038ff', secondary:'#ffffff', accent:'#7C3AED', surface:'#ffffff', text:'#000000', border:'#000000', brightness:70, saturation:100 },
    typography: { heading_font:'Bebas Neue', body_font:'Space Grotesk', timer_font:'Bebas Neue', score_font:'Space Grotesk', size_scale:1, text_shadow:false, text_glow:false },
    timer: { style:'circle', position:'tr', size:'medium', colors:{ background:'#000000', text:'#ffffff', progress:'#7C3AED', background_opacity:0.6 } },
    layout: { scores_position:'bottom', header_style:'full', logo_visible:true, decorations_visible:true },
    shapes: { enabled:SHAPE_TYPES.map(function(s){return s.id;}), spawn_rate:2500, max_count:15, color_source:'team', opacity:0.8 },
    effects: { mode_transition:'fade', theme_transition:'fade', intensity:1, screen_shake:true, confetti:true }
  };
  _fillUIFromTheme(defaults);
  _themeDirty = true;
  var items = (_teId('themeList') || {}).querySelectorAll('.theme-list-item');
  items && items.forEach(function(el) { el.classList.remove('active'); });
  _updateEditorStatus();
  ctrl.themeEditorChange();
};

ctrl.themeSave = async function() {
  var data = _collectThemeFromUI();
  var isNew = !_selectedTheme;
  try {
    var res;
    if (isNew) {
      res = await apiPost('/themes', data);
    } else {
      res = await apiPut('/themes/' + _selectedTheme.slug, data);
    }
    if (res && res.error) { toast('⚠ ' + res.error); return; }
    toast(isNew ? '✔ Tema creado' : '✔ Tema guardado');
    _themeDirty = false;
    await ctrl.themeLoadList();
  } catch (e) {
    toast('⚠ Error guardando tema: ' + e.message);
  }
};

ctrl.themePreview = async function() {
  var data = _collectThemeFromUI();
  try {
    await apiPost('/display/preview-theme', { theme: data });
    toast('👁 Preview enviado a la pantalla');
  } catch (e) {
    toast('⚠ Error de preview: ' + e.message);
  }
};

ctrl.themeApply = async function() {
  if (!_selectedTheme) { toast('⚠ Selecciona un tema primero'); return; }
  try {
    var res = await apiPost('/themes/' + _selectedTheme.slug + '/apply', {});
    if (res && res.error) { toast('⚠ ' + res.error); return; }
    toast('📌 Tema "' + _selectedTheme.name + '" aplicado');
    await actualizarEstado();
  } catch (e) {
    toast('⚠ Error aplicando tema: ' + e.message);
  }
};

ctrl.themeSorpresa = async function() {
  try {
    var res = await apiPost('/themes/sorpresa', {});
    if (res && res.selected) {
      toast('🎲 ¡Sorpresa! Tema: ' + (res.name || res.selected));
      await actualizarEstado();
    } else {
      toast('⚠ ' + (res.error || 'No hay temas disponibles'));
    }
  } catch (e) {
    toast('⚠ Error: ' + e.message);
  }
};

ctrl.themeRotationToggle = async function() {
  var btn = document.getElementById('rotationToggleBtn');
  if (!btn) return;
  var isActive = btn.textContent.trim() === '⏹ Detener';
  if (isActive) {
    // Stop rotation
    try {
      await apiPost('/themes/rotation/configure', {
        interval_seconds: 300,
        enabled: false
      });
      btn.textContent = '▶ Iniciar';
      btn.className = 'btn btn-ghost flex-1';
      toast('⏹ Rotación detenida');
    } catch (e) { toast('⚠ Error: ' + e.message); }
  } else {
    // Start rotation
    var interval = parseInt(document.getElementById('rotationInterval')?.value || '300', 10);
    var excludeSelect = document.getElementById('rotationExclude');
    var exclude = [];
    if (excludeSelect) {
      for (var i = 0; i < excludeSelect.options.length; i++) {
        if (excludeSelect.options[i].selected) exclude.push(excludeSelect.options[i].value);
      }
    }
    try {
      await apiPost('/themes/rotation/configure', {
        interval_seconds: interval,
        enabled: true,
        exclude_slugs: exclude
      });
      btn.textContent = '⏹ Detener';
      btn.className = 'btn btn-primary flex-1';
      toast('🔄 Rotación cada ' + interval + 's iniciada');
      // Trigger first rotation
      await ctrl.themeRotationNext();
    } catch (e) { toast('⚠ Error: ' + e.message); }
  }
};

ctrl.themeRotationNext = async function() {
  try {
    var res = await apiPost('/themes/rotation/next', {
      current_slug: (state.display_config && state.display_config.theme_slug) || ''
    });
    if (res && res.next_theme) {
      toast('⏭ Siguiente tema: ' + res.next_theme);
      await actualizarEstado();
    } else {
      toast('⚠ ' + (res.error || 'No hay más temas'));
    }
  } catch (e) {
    toast('⚠ Error: ' + e.message);
  }
};

ctrl.themeRotationLoadState = async function() {
  try {
    var res = await fetchRetry(API + '/themes/rotation/state');
    if (res && res.rotation) {
      var rot = res.rotation;
      var btn = document.getElementById('rotationToggleBtn');
      if (btn && rot.is_rotating) {
        btn.textContent = '⏹ Detener';
        btn.className = 'btn btn-primary flex-1';
      }
      var intervalSel = document.getElementById('rotationInterval');
      if (intervalSel && rot.interval_seconds) {
        intervalSel.value = String(rot.interval_seconds);
      }
      if (rot.excluded_themes && rot.excluded_themes.length) {
        var excludeSel = document.getElementById('rotationExclude');
        if (excludeSel) {
          for (var i = 0; i < excludeSel.options.length; i++) {
            excludeSel.options[i].selected = rot.excluded_themes.indexOf(excludeSel.options[i].value) !== -1;
          }
        }
      }
    }
  } catch (e) { /* silent */ }
};

ctrl.themeDuplicate = async function() {
  if (!_selectedTheme) { toast('⚠ Selecciona un tema primero'); return; }
  var data = _collectThemeFromUI();
  data.name = data.name + ' (copia)';
  try {
    var res = await apiPost('/themes', data);
    if (res && res.error) { toast('⚠ ' + res.error); return; }
    toast('📋 Tema duplicado');
    await ctrl.themeLoadList();
  } catch (e) {
    toast('⚠ Error duplicando tema: ' + e.message);
  }
};

ctrl.themeExport = function() {
  if (!_selectedTheme) { toast('⚠ Selecciona un tema primero'); return; }
  var data = _collectThemeFromUI();
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (data.name || 'theme').toLowerCase().replace(/\s+/g, '-') + '.theme.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('📤 Tema exportado');
};

ctrl.themeImport = function() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function(ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!data.name) data.name = file.name.replace(/\.(theme\.)?json$/, '');
        data.version = data.version || 2;
        var res = await apiPost('/themes', data);
        if (res && res.error) { toast('⚠ ' + res.error); return; }
        toast('📥 Tema importado: ' + data.name);
        await ctrl.themeLoadList();
      } catch (err) {
        toast('⚠ Error importando: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

ctrl.themeDelete = async function() {
  if (!_selectedTheme) { toast('⚠ Selecciona un tema primero'); return; }
  if (!confirm('¿Eliminar tema "' + _selectedTheme.name + '"?')) return;
  try {
    var res = await fetchRetry(API + '/themes/' + _selectedTheme.slug, { method: 'DELETE' });
    if (res && res.error) { toast('⚠ ' + res.error); return; }
    toast('🗑️ Tema eliminado');
    _selectedTheme = null;
    await ctrl.themeLoadList();
  } catch (e) {
    toast('⚠ Error eliminando tema: ' + e.message);
  }
};

ctrl.themeEditorChange = function() {
  _themeDirty = true;
  _updateEditorStatus();
  var tid = _selectedTheme ? _selectedTheme.slug : null;
  var isNew = !tid;
  _teId('btnThemeSave') && (_teId('btnThemeSave').textContent = isNew ? '➕ Crear tema' : '💾 Guardar');
  _teId('btnThemeDup') && (_teId('btnThemeDup').disabled = isNew);
  _teId('btnThemeExport') && (_teId('btnThemeExport').disabled = isNew);
  _teId('btnThemeDelete') && (_teId('btnThemeDelete').disabled = isNew);
  _teId('btnThemeApply') && (_teId('btnThemeApply').disabled = isNew);

  var data = _collectThemeFromUI();
  var c = data.colors || {};
  var previewEl = _teId('themeMiniPreview');
  if (previewEl) {
    previewEl.style.background = 'linear-gradient(135deg, ' + (c.primary || '#0038ff') + ', ' + (c.accent || '#7C3AED') + ')';
  }
  var colorsEl = _teId('miniPreviewColors');
  if (colorsEl) {
    var swatches = [c.primary, c.secondary, c.accent, c.surface, c.text];
    colorsEl.innerHTML = swatches.map(function(clr) {
      return '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,0.3);background:' + (clr || '#ccc') + ';"></span>';
    }).join('');
  }
};

// ─── Multi-Screen System ─────────────────────────────────────────────
const SCREEN_ELEMENTS = ["timer", "question", "scores", "shapes", "overlays"];
const SCREEN_ROLES = ["main", "secondary", "scoreboard", "timer", "stage"];

ctrl.loadScreens = async function() {
  try {
    const res = await fetchRetry(API + "/display/screens");
    const screens = (res && res.screens) || {};
    state.display_config = state.display_config || {};
    state.display_config.screens = screens;
    renderScreens();
  } catch (e) {
    toast("⚠ Error cargando pantallas: " + e.message);
  }
};

function renderScreens() {
  const wrap = id("screensList");
  if (!wrap) return;
  const screens = (state.display_config && state.display_config.screens) || {};
  const keys = Object.keys(screens).sort((a, b) => parseInt(a) - parseInt(b));
  if (!keys.length) {
    wrap.innerHTML = '<div class="text-sm text-muted">No hay pantallas configuradas.</div>';
    return;
  }
  wrap.innerHTML = keys.map(sid => {
    const s = screens[sid];
    const els = s.elements || {};
    const elToggles = SCREEN_ELEMENTS.map(el => {
      const on = els[el] !== false;
      const label = { timer: "⏱ Timer", question: "❓ Pregunta", scores: "🏆 Scores", shapes: "💎 Formas", overlays: "🎬 Overlays" }[el];
      return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
        <input type="checkbox" ${on ? "checked" : ""} onchange="ctrl.setScreenElement('${sid}','${el}',this.checked)"> ${label}
      </label>`;
    }).join("");
    const roleOpts = SCREEN_ROLES.map(r =>
      `<option value="${r}" ${s.role === r ? "selected" : ""}>${r}</option>`).join("");
    const lay = s.layout || {};
    const map = s.mapping || {};
    const elSel = (el) => { const l = lay[el] || {}; return `x:${l.x != null ? l.x : ''} y:${l.y != null ? l.y : ''} w:${l.w != null ? l.w : ''} h:${l.h != null ? l.h : ''}`; };
    return `<div class="card" data-screen-card="${sid}">
      <div class="flex-row" style="justify-content:space-between;align-items:center;gap:8px;">
        <input class="text-input" style="font-weight:700;max-width:200px;" value="${s.name || ('Pantalla ' + sid)}" onchange="ctrl.setScreenName('${sid}',this.value)">
        <div class="flex-row gap-4">
          <select class="text-input" onchange="ctrl.setScreenRole('${sid}',this.value)">${roleOpts}</select>
          <button class="btn btn-ghost btn-sm" onclick="ctrl.deleteScreen('${sid}')">🗑</button>
        </div>
      </div>
      <div class="text-xs text-muted" style="margin:4px 0;">ID Pantalla: <code>${sid}</code> — URL: <code>${window.location.origin}/display?screen=${sid}</code></div>
      <div class="flex-row" style="flex-wrap:wrap;gap:12px;margin-top:6px;">${elToggles}</div>

      <details class="mt-4" style="border-top:1px solid var(--border);padding-top:8px;">
        <summary style="cursor:pointer;font-size:13px;font-weight:700;">🎛 Layout & Posición</summary>
        <div class="text-xs text-muted" style="margin:6px 0;">Arrastra las cajas para posicionar (x/y %) y usa la esquina para redimensionar:</div>
        <div class="screen-mini" id="mini-${sid}" style="position:relative;width:100%;height:200px;background:#000;border:1px solid var(--border);overflow:hidden;border-radius:8px;">
          ${SCREEN_ELEMENTS.map(el => {
            const l = lay[el] || {};
            const on = els[el] !== false;
            return `<div class="mini-el" data-el="${el}" data-sid="${sid}"
              style="position:absolute;left:${l.x != null ? l.x : 5}%;top:${l.y != null ? l.y : 5}%;width:${l.w != null ? l.w : 25}%;height:${l.h != null ? l.h : 25}%;
              border:1px dashed ${on ? 'var(--accent)' : '#555'};background:${on ? 'rgba(124,58,237,0.18)' : 'rgba(80,80,80,0.12)'};
              color:${on ? 'var(--accent)' : '#777'};font-size:10px;display:flex;align-items:center;justify-content:center;cursor:move;${on ? '' : 'opacity:.4;'};">
              ${el}
              <span class="mini-el-resize" style="position:absolute;right:0;bottom:0;width:10px;height:10px;background:var(--accent);cursor:nwse-resize;"></span>
            </div>`;
          }).join("")}
        </div>
        <div class="flex-row gap-4 mt-4" style="flex-wrap:wrap;">
          ${SCREEN_ELEMENTS.map(el => `<span class="text-xs" style="font-family:monospace;">${el}: ${elSel(el)}</span>`).join("")}
        </div>
        <div class="flex-row gap-4 mt-4" style="flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="ctrl.resetScreenLayout('${sid}')">↺ Reset posiciones</button>
        </div>
      </details>

      <details class="mt-4" style="border-top:1px solid var(--border);padding-top:8px;">
        <summary style="cursor:pointer;font-size:13px;font-weight:700;">📽 Mapeo de Proyector</summary>
        <div class="text-xs text-muted" style="margin:8px 0;">
          Rotación ${map.rotation || 0}° · Zoom ${map.zoom != null ? map.zoom : 1}${map.bezel ? ' · Bezel ' + map.bezel + 'px' : ''}${map.group ? ' · Grupo: ' + map.group : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="ctrl.selectTab('mapping')">🗺️ Abrir workspace de mapeo</button>
      </details>
    </div>`;
  }).join("");
  ctrl.initScreenDrag();
}

function _mapSlider(sid, key, label, val, min, max, step) {
  step = step || 1;
  return `<div class="flex-col" style="gap:2px;">
    <span class="text-xs text-muted">${label}: <b id="map-${sid}-${key}">${val}</b></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
      oninput="ctrl.setScreenMapping('${sid}','${key}',parseFloat(this.value),'map-${sid}-${key}')" style="width:100%;">
  </div>`;
}

ctrl.setScreenElement = async function(sid, el, on) {
  try {
    await apiPost("/display/screens/" + sid + "/element", { element: el, active: !!on });
    if (state.display_config.screens[sid]) {
      state.display_config.screens[sid].elements = state.display_config.screens[sid].elements || {};
      state.display_config.screens[sid].elements[el] = !!on;
    }
    toast("🖵 Pantalla " + sid + ": " + el + (on ? " visible" : " oculto"));
  } catch (e) {
    toast("⚠ " + e.message);
    renderScreens();
  }
};

ctrl.setScreenName = async function(sid, name) {
  try {
    await apiPut("/display/screens/" + sid, { name: name });
    if (state.display_config.screens[sid]) state.display_config.screens[sid].name = name;
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.setScreenRole = async function(sid, role) {
  try {
    await apiPut("/display/screens/" + sid, { role: role });
    if (state.display_config.screens[sid]) state.display_config.screens[sid].role = role;
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.deleteScreen = async function(sid) {
  if (!confirm("¿Eliminar pantalla " + sid + "?")) return;
  try {
    const res = await fetchRetry(API + "/display/screens/" + sid, { method: "DELETE" });
    state.display_config.screens = (res && res.screens) || {};
    renderScreens();
    toast("🗑 Pantalla " + sid + " eliminada");
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.addScreen = async function() {
  try {
    const screens = (state.display_config && state.display_config.screens) || {};
    let nid = 1;
    while (screens[String(nid)]) nid++;
    const nidStr = String(nid);
    await apiPut("/display/screens/" + nidStr, {
      name: "Pantalla " + nidStr,
      role: "secondary",
      elements: { timer: false, question: false, scores: true, shapes: true, overlays: false },
    });
    await ctrl.loadScreens();
    toast("🖵 Pantalla " + nidStr + " creada");
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl._ensureScreen = function(sid) {
  state.display_config = state.display_config || {};
  state.display_config.screens = state.display_config.screens || {};
  state.display_config.screens[sid] = state.display_config.screens[sid] || { elements: {}, layout: {}, mapping: {} };
  return state.display_config.screens[sid];
};

ctrl.setScreenLayout = async function(sid, el, rect) {
  const sc = ctrl._ensureScreen(sid);
  sc.layout = sc.layout || {};
  sc.layout[el] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  try {
    await apiPut("/display/screens/" + sid, { layout: sc.layout });
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.resetScreenLayout = async function(sid) {
  const sc = ctrl._ensureScreen(sid);
  sc.layout = {};
  try {
    await apiPut("/display/screens/" + sid, { layout: {} });
    renderScreens();
    toast("↺ Posiciones reset");
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.setScreenMapping = async function(sid, key, val, labelId) {
  const sc = ctrl._ensureScreen(sid);
  sc.mapping = sc.mapping || {};
  sc.mapping[key] = val;
  const lbl = id(labelId);
  if (lbl) lbl.textContent = (key === "zoom") ? val.toFixed(2) : val;
  try {
    await apiPut("/display/screens/" + sid, { mapping: sc.mapping });
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.initScreenDrag = function() {
  document.querySelectorAll(".screen-mini").forEach(mini => {
    if (mini._dragInit) return;
    mini._dragInit = true;
    let active = null, startX = 0, startY = 0, orig = null, mode = "move";
    const onDown = (e) => {
      const el = e.target.closest(".mini-el");
      if (!el) return;
      active = el;
      mode = (e.target.classList.contains("mini-el-resize")) ? "resize" : "move";
      startX = e.clientX; startY = e.clientY;
      orig = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!active) return;
      const rect = mini.getBoundingClientRect();
      const dx = (e.clientX - startX) / rect.width * 100;
      const dy = (e.clientY - startY) / rect.height * 100;
      if (mode === "move") {
        active.style.left = Math.max(0, Math.min(100 - orig.w, orig.x + dx)) + "%";
        active.style.top = Math.max(0, Math.min(100 - orig.h, orig.y + dy)) + "%";
      } else {
        active.style.width = Math.max(5, Math.min(100 - orig.x, orig.w + dx)) + "%";
        active.style.height = Math.max(5, Math.min(100 - orig.y, orig.h + dy)) + "%";
      }
    };
    const onUp = (e) => {
      if (!active) return;
      const sid = active.dataset.sid, el = active.dataset.el;
      const rect = {
        x: Math.round(parseFloat(active.style.left)),
        y: Math.round(parseFloat(active.style.top)),
        w: Math.round(parseFloat(active.style.width)),
        h: Math.round(parseFloat(active.style.height)),
      };
      active = null;
      ctrl.setScreenLayout(sid, el, rect);
    };
    mini.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
};

// ─── Projector Mapping Workspace (MadMapper-style) ──────────
let _mapSel = "1";
let _mapWorking = null;
let _mapGrid = false;
let _mapSaveT = null;

function _mapDefaultMapping() {
  return { corners: { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] },
           rotation: 0, zoom: 1, offset_x: 0, offset_y: 0, perspective: 1200, bezel: 0,
           edge_blend: { top: 0, right: 0, bottom: 0, left: 0 }, z: 0 };
}

ctrl.selectMapScreen = function(sid) {
  _mapSel = sid;
  ctrl.renderMapWorkspace();
};

ctrl.renderMapWorkspace = async function() {
  if (!state.display_config) state.display_config = {};
  if (!state.display_config.screens) {
    await ctrl.loadScreens();
  }
  const sel = id("mapScreenSel");
  const screens = state.display_config.screens || {};
  if (sel) {
    sel.innerHTML = Object.keys(screens).sort((a, b) => parseInt(a) - parseInt(b))
      .map(s => `<option value="${s}" ${s === _mapSel ? "selected" : ""}>${screens[s].name || ("Pantalla " + s)}</option>`).join("");
  }
  const sc = screens[_mapSel];
  _mapWorking = sc && sc.mapping ? JSON.parse(JSON.stringify(sc.mapping)) : _mapDefaultMapping();
  if (!_mapWorking.corners) _mapWorking.corners = { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };
  if (!_mapWorking.edge_blend) _mapWorking.edge_blend = { top: 0, right: 0, bottom: 0, left: 0 };
  const grp = id("mapGroup"); if (grp) grp.value = (sc && sc.group) || "";
  const setR = (i, v) => { const e = id(i); if (e) e.value = v; };
  setR("mapZ", _mapWorking.z || 0);
  setR("mapRot", _mapWorking.rotation || 0);
  setR("mapZoom", _mapWorking.zoom != null ? _mapWorking.zoom : 1);
  setR("mapOffX", _mapWorking.offset_x || 0);
  setR("mapOffY", _mapWorking.offset_y || 0);
  setR("mapPersp", _mapWorking.perspective || 1200);
  setR("mapBezel", _mapWorking.bezel || 0);
  setR("mapEbTop", _mapWorking.edge_blend.top || 0);
  setR("mapEbRight", _mapWorking.edge_blend.right || 0);
  setR("mapEbBottom", _mapWorking.edge_blend.bottom || 0);
  setR("mapEbLeft", _mapWorking.edge_blend.left || 0);
  const gl = id("mapGroupLabel");
  if (gl) gl.textContent = (sc && sc.group) ? ("Grupo: " + sc.group) : "";
  ctrl._drawMapQuad();
};

ctrl._drawMapQuad = function() {
  const canvas = id("mapCanvas");
  if (!canvas) return;
  canvas.querySelectorAll(".map-quad, .map-grid").forEach(n => n.remove());
  if (_mapGrid) {
    const g = document.createElement("div");
    g.className = "map-grid";
    g.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;background-image:linear-gradient(rgba(255,255,255,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.12) 1px,transparent 1px);background-size:10% 10%;";
    canvas.appendChild(g);
  }
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const c = _mapWorking.corners;
  const pts = {
    tl: [c.tl[0] * W / 100, c.tl[1] * H / 100],
    tr: [W + c.tr[0] * W / 100, c.tr[1] * H / 100],
    br: [W + c.br[0] * W / 100, H + c.br[1] * H / 100],
    bl: [c.bl[0] * W / 100, H + c.bl[1] * H / 100],
  };
  const poly = document.createElement("div");
  poly.className = "map-quad";
  poly.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;border:2px solid var(--accent);background:rgba(124,58,237,0.12);clip-path:polygon(" +
    `${pts.tl[0]}px ${pts.tl[1]}px, ${pts.tr[0]}px ${pts.tr[1]}px, ${pts.br[0]}px ${pts.br[1]}px, ${pts.bl[0]}px ${pts.bl[1]}px);`;
  canvas.appendChild(poly);
  const colors = { tl: "#ff5a5a", tr: "#5aff8f", br: "#5a9bff", bl: "#ffd23f" };
  for (const k of Object.keys(pts)) {
    const h = document.createElement("div");
    h.className = "map-handle";
    h.dataset.corner = k;
    h.style.cssText = `position:absolute;width:18px;height:18px;border-radius:50%;background:${colors[k]};border:2px solid #fff;z-index:4;transform:translate(-50%,-50%);cursor:grab;left:${pts[k][0]}px;top:${pts[k][1]}px;`;
    canvas.appendChild(h);
  }
  if (!canvas._mapInit) {
    canvas._mapInit = true;
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".map-handle");
      if (!h) return;
      drag = h.dataset.corner;
      h.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      let x = (e.clientX - r.left) / r.width * 100;
      let y = (e.clientY - r.top) / r.height * 100;
      x = Math.max(-50, Math.min(50, x));
      y = Math.max(-50, Math.min(50, y));
      _mapWorking.corners[drag] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      ctrl._drawMapQuad();
      ctrl._mapScheduleSave();
    });
    const end = () => { drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }
};

ctrl._mapScheduleSave = function() {
  if (_mapSaveT) clearTimeout(_mapSaveT);
  _mapSaveT = setTimeout(() => ctrl.mapSaveCurrent(), 400);
};

ctrl.mapSaveCurrent = async function() {
  const sc = ctrl._ensureScreen(_mapSel);
  sc.mapping = JSON.parse(JSON.stringify(_mapWorking));
  try {
    await apiPut("/display/screens/" + _mapSel, { mapping: sc.mapping });
    toast("🗺️ Mapeo guardado (Pantalla " + _mapSel + ")");
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.mapSetField = function(field, val) {
  _mapWorking[field] = val;
  ctrl._mapScheduleSave();
};

ctrl.mapSetEdge = function(side, val) {
  _mapWorking.edge_blend = _mapWorking.edge_blend || {};
  _mapWorking.edge_blend[side] = val;
  ctrl._mapScheduleSave();
};

ctrl.mapSetGroup = async function(val) {
  const sc = ctrl._ensureScreen(_mapSel);
  sc.group = val || null;
  try {
    await apiPut("/display/screens/" + _mapSel, { group: val || "" });
    const gl = id("mapGroupLabel"); if (gl) gl.textContent = val ? ("Grupo: " + val) : "";
  } catch (e) { toast("⚠ " + e.message); }
};

ctrl.mapResetCorners = function() {
  _mapWorking.corners = { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };
  ctrl._drawMapQuad();
  ctrl._mapScheduleSave();
};

ctrl.mapCopyToAll = async function() {
  const screens = state.display_config.screens || {};
  for (const sid of Object.keys(screens)) {
    if (sid === _mapSel) continue;
    const sc = ctrl._ensureScreen(sid);
    sc.mapping = JSON.parse(JSON.stringify(_mapWorking));
    try { await apiPut("/display/screens/" + sid, { mapping: sc.mapping }); } catch (e) { toast("⚠ " + e.message); }
  }
  toast("📋 Mapeo copiado a todas las pantallas");
};

ctrl.mapToggleGrid = function() {
  _mapGrid = !_mapGrid;
  const b = id("mapGridBtn");
  if (b) b.classList.toggle("btn-primary", _mapGrid);
  ctrl._drawMapQuad();
};

// ── AUDIO (Fase 7) ──

const AUDIO_EVENTS = [
  ["new_question", "Nueva pregunta"],
  ["correct", "Acierto"],
  ["incorrect", "Fallo"],
  ["point", "Punto (equipo)"],
  ["penalty", "Penalización"],
  ["timer_start", "Inicio de timer"],
  ["tick", "Tick de timer"],
  ["urgent_tick", "Tick urgente"],
  ["timeout", "Fin de tiempo"],
  ["final_round", "Ronda final"],
  ["podium", "Podio / ganador"],
  ["eliminado", "Eliminado"],
  ["overtake", "Adelanto"],
  ["round_start", "Inicio de ronda"],
  ["mode_activate", "Activar modo"],
  ["countdown_3", "Cuenta 3"],
  ["countdown_2", "Cuenta 2"],
  ["countdown_1", "Cuenta 1"],
  ["countdown_go", "Cuenta ¡GO!"],
];

const AUDIO_MODES = [
  ["preguntas", "Preguntas"], ["versos", "Tiempo"], ["roulette", "Ruleta"],
  ["hangman", "Ahorcado"], ["battle", "Batalla"],
  ["survival", "Supervivencia"], ["quizshow", "Quiz Show"],
];

const AUDIO_CHANNELS = [
  ["sfx", "Efectos (SFX)"], ["music", "Música fondo"], ["ambient", "Ambiente"], ["voice", "Voz"],
];

ctrl._audio = { map: null, library: [] };

ctrl.renderAudio = async function() {
  try {
    const [lib, mapRes] = await Promise.all([
      fetchRetry(API + '/sounds'),
      fetchRetry(API + '/sounds/map'),
    ]);
    ctrl._audio.library = lib.sounds || [];
    ctrl._audio.map = mapRes.map || { events: {}, modes: {}, background: null, channels: { sfx: 1, music: 1, ambient: 1, voice: 1 }, muted: false, enabled: true };
  } catch (e) {
    ctrl._audio.library = [];
    ctrl._audio.map = { events: {}, modes: {}, background: null, channels: { sfx: 1, music: 1, ambient: 1, voice: 1 }, muted: false, enabled: true };
  }
  const scope = id('audioScope');
  if (scope && scope.options.length <= 1) {
    AUDIO_MODES.forEach(([k, label]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = label;
      scope.appendChild(o);
    });
  }
  ctrl.audioRenderLibrary();
  ctrl.audioRenderEvents();
  ctrl.audioRenderBg();
  ctrl.audioRenderChannels();
  const m = ctrl._audio.map;
  const en = id('audioEnabled'); if (en) en.checked = m.enabled !== false;
  const mu = id('audioMuted'); if (mu) mu.checked = !!m.muted;
};

// ==================== MODOS (Constructor Scratch) ====================
const MODOS_KEY = 'sillyquiz_modos';

function _modosSetMsg(t, ok) {
  const el = id('modosMsg');
  if (!el) return;
  el.textContent = t;
  el.style.color = ok === false ? 'var(--red)' : (ok ? 'var(--green)' : 'var(--text-muted)');
}
function _modosSetStatus(t) {
  const el = id('modosStatus');
  if (el) el.textContent = t;
}
function _modosList() {
  try { return JSON.parse(localStorage.getItem(MODOS_KEY) || '[]'); }
  catch (e) { return []; }
}

ctrl.modosCargar = async function() {
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

ctrl.modosImportar = async function() {
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

ctrl.modosCargarArchivo = function(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { const ta = id('modosJsonInput'); if (ta) ta.value = r.result; };
  r.readAsText(f);
  e.target.value = '';
};

ctrl.modosPegarDesdeBuilder = async function() {
  try {
    const t = await navigator.clipboard.readText();
    if (t) { const ta = id('modosJsonInput'); if (ta) ta.value = t; _modosSetMsg('Pegado desde portapapeles.', true); return; }
  } catch (err) {}
  window.open('/html/modo-builder-v2.html', '_blank');
  _modosSetMsg('Abre el constructor, copia el JSON y pégalo aquí.', false);
};

ctrl.modosEliminar = async function(i) {
  const list = _modosList();
  list.splice(i, 1);
  localStorage.setItem(MODOS_KEY, JSON.stringify(list));
  ctrl.modosCargar();
};

/* Importa un modo empaquetado .lkqmode (ZIP con manifest.json + assets/).
   El servidor sanea cada asset (magic-bytes, tamaño, sin ejecutables) antes
   de registrarlo. Estética brutalista: input oculto + botón. */
ctrl.importarModoPaquete = async function(event) {
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
ctrl.exportarModoPaquete = async function(modeId) {
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

ctrl.modosEjecutar = async function() {
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

ctrl.modosInitHead = function() {
  const iframe = id('modosEngine');
  if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'mode:head', head: 'on_mode_init' }, '*');
};

ctrl.modosDetener = function() {
  const iframe = id('modosEngine');
  if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'mode:stop' }, '*');
  _modosSetStatus('Detenido');
};

/* ===== CANVA / INFINITE CANVAS ===== */
ctrl.canvaCargar = function() {
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

ctrl.canvaRecargar = function() {
  const iframe = id('canvaIframe');
  if (iframe) { 
    iframe.src = '/html/modo-builder-v2.html'; 
    const status = id('canvaStatus');
    if (status) status.textContent = '🔄 Recargando…';
  }
};

ctrl.canvaPantallaCompleta = function() {
  const iframe = id('canvaIframe');
  if (iframe && iframe.requestFullscreen) {
    iframe.requestFullscreen().catch(e => console.warn('Fullscreen denied:', e));
  }
};

/* ===== CANVA HOTKEYS & AUTO-SAVE ===== */
ctrl.canvaInitHotkeys = function() {
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
ctrl.canvaAutoGuardar = function() {
  const iframe = id('canvaIframe');
  if (!iframe || !iframe.contentWindow) return;
  
  // Pedir estado al builder via postMessage
  iframe.contentWindow.postMessage({ type: 'canva:request_state' }, '*');
  _modosSetMsg('💾 Guardando estado del canvas…', true);
};

ctrl.canvaRestaurar = function() {
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

ctrl.canvaLimpiar = function() {
  if (!confirm('¿Borrar todo el canvas y empezar de cero?')) return;
  const iframe = id('canvaIframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'canva:clear_all' }, '*');
    localStorage.removeItem('canva_state');
    _modosSetMsg('🗑️ Canvas limpiado', true);
  }
};

/* ===== CANVA DEBUG CONSOLE ===== */
ctrl.canvaDebugConsole = function() {
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

ctrl.canvaDebugEjecutar = function() {
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

ctrl.canvaDebugLimpiar = function() {
  const log = id('canvaDebugLog');
  if (log) log.innerHTML = '';
};

ctrl.audioRenderLibrary = function() {
  const box = id('audioLibrary');
  if (!box) return;
  box.innerHTML = '';
  if (!ctrl._audio.library.length) {
    box.innerHTML = '<div class="text-xs text-muted">Sin sonidos subidos.</div>';
    return;
  }
  ctrl._audio.library.forEach(s => {
    const row = document.createElement('div');
    row.className = 'flex-row justify-between';
    row.style.gap = '6px';
    const sizeKb = Math.round((s.size || 0) / 1024);
    row.innerHTML = `<span class="text-sm">🎵 ${esc(s.name)} <span class="text-xs text-muted">(${sizeKb} KB)</span></span>`;
    const acts = document.createElement('div');
    acts.className = 'flex-row';
    acts.style.gap = '4px';
    const play = document.createElement('button');
    play.className = 'btn btn-ghost btn-sm'; play.textContent = '▶';
    play.onclick = () => { try { new Audio('/api/sounds/' + s.id).play(); } catch (e) {} };
    const del = document.createElement('button');
    del.className = 'btn btn-ghost btn-sm'; del.textContent = '🗑';
    del.onclick = () => ctrl.audioDelete(s.id);
    acts.appendChild(play); acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  });
};

ctrl.audioUpload = async function() {
  const f = id('audioFile');
  const msg = id('audioUploadMsg');
  if (msg) msg.textContent = '';
  if (!f || !f.files || !f.files[0]) { if (msg) msg.textContent = '⚠ Selecciona un archivo'; return; }
  const fd = new FormData();
  fd.append('file', f.files[0]);
  const name = id('audioName').value.trim();
  if (name) fd.append('name', name);
  try {
    const res = await fetch(API + '/sounds', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { if (msg) msg.textContent = '⚠ ' + (data.error || 'Error'); return; }
    toast('✔ Sonido subido: ' + data.name);
    f.value = ''; id('audioName').value = '';
    await ctrl.renderAudio();
  } catch (e) {
    if (msg) msg.textContent = '⚠ ' + e.message;
  }
};

ctrl.audioDelete = async function(sid) {
  if (!confirm('¿Eliminar este sonido?')) return;
  try {
    await fetch(API + '/sounds/' + sid, { method: 'DELETE' });
    toast('🗑 Sonido eliminado');
    await ctrl.renderAudio();
  } catch (e) { toast('⚠ ' + e.message); }
};

ctrl.audioScope = function() {
  const s = id('audioScope');
  return s ? s.value : '__global__';
};

ctrl.audioRenderEvents = function() {
  const box = id('audioEventRows');
  if (!box) return;
  box.innerHTML = '';
  const scope = ctrl.audioScope();
  const map = ctrl._audio.map;
  if (scope !== '__global__' && !map.modes[scope]) map.modes[scope] = {};
  const target = scope === '__global__' ? (map.events || (map.events = {})) : map.modes[scope];
  const clearBtn = id('audioClearScopeBtn');
  if (clearBtn) clearBtn.style.display = scope === '__global__' ? 'none' : '';
  const opts = '<option value="">— (procedural) —</option>' + ctrl._audio.library.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  AUDIO_EVENTS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'flex-row justify-between';
    row.style.gap = '8px';
    const lab = document.createElement('span');
    lab.className = 'text-sm text-muted';
    lab.style.width = '140px';
    lab.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'input';
    sel.style.flex = '1';
    sel.innerHTML = opts;
    sel.value = target[key] || '';
    sel.onchange = () => { target[key] = sel.value || undefined; if (!target[key]) delete target[key]; };
    row.appendChild(lab); row.appendChild(sel);
    box.appendChild(row);
  });
};

ctrl.audioClearScope = function() {
  const scope = ctrl.audioScope();
  if (scope === '__global__') return;
  delete ctrl._audio.map.modes[scope];
  ctrl.audioRenderEvents();
  toast('Override de "' + scope + '" limpiado');
};

ctrl.audioRenderBg = function() {
  const sel = id('audioBg');
  if (!sel) return;
  const opts = '<option value="">— (sin música) —</option>' + ctrl._audio.library.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.innerHTML = opts;
  const bg = ctrl._audio.map.background;
  sel.value = bg && bg.id ? bg.id : '';
  const vol = id('audioBgVol'); if (vol) { vol.value = bg && bg.volume != null ? bg.volume : 0.5; id('audioBgVolVal').textContent = vol.value; }
  const loop = id('audioBgLoop'); if (loop) loop.checked = !bg || bg.loop !== false;
};

ctrl.audioRenderChannels = function() {
  const box = id('audioChannels');
  if (!box) return;
  const ch = ctrl._audio.map.channels || (ctrl._audio.map.channels = {});
  box.innerHTML = '';
  AUDIO_CHANNELS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'flex-row';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    const lab = document.createElement('span');
    lab.className = 'text-sm text-muted';
    lab.style.width = '120px';
    lab.textContent = label;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '0'; sl.max = '1'; sl.step = '0.05';
    sl.value = ch[key] != null ? ch[key] : 1;
    sl.style.flex = '1';
    const val = document.createElement('span');
    val.className = 'text-xs';
    val.textContent = sl.value;
    sl.oninput = () => { ch[key] = parseFloat(sl.value); val.textContent = sl.value; };
    row.appendChild(lab); row.appendChild(sl); row.appendChild(val);
    box.appendChild(row);
  });
};

ctrl.audioChange = function() {
  const m = ctrl._audio.map;
  m.enabled = id('audioEnabled').checked;
  m.muted = id('audioMuted').checked;
  const bg = id('audioBg').value;
  const vol = parseFloat(id('audioBgVol').value);
  id('audioBgVolVal').textContent = id('audioBgVol').value;
  if (bg) {
    m.background = { id: bg, loop: id('audioBgLoop').checked, volume: vol };
  } else {
    m.background = null;
  }
};

ctrl.audioSave = async function() {
  ctrl.audioChange();
  try {
    const res = await apiPost('/sounds/map', ctrl._audio.map);
    if (res.error) { toast('⚠ ' + res.error); return; }
    ctrl._audio.map = res.map;
    toast('✔ Configuración de audio guardada');
  } catch (e) { toast('⚠ ' + e.message); }
};

ctrl.audioTest = async function() {
  ctrl.audioChange();
  const scope = ctrl.audioScope();
  const map = ctrl._audio.map;
  const target = scope === '__global__' ? (map.events || {}) : (map.modes[scope] || {});
  let i = 0;
  AUDIO_EVENTS.forEach(([key]) => {
    const idn = target[key];
    if (idn) {
      const url = '/api/sounds/' + idn;
      setTimeout(() => { try { new Audio(url).play(); } catch (e) {} }, i * 350);
      i++;
    }
  });
  if (map.background && map.background.id) {
    setTimeout(() => { try { const a = new Audio('/api/sounds/' + map.background.id); a.loop = map.background.loop !== false; a.volume = map.background.volume || 0.5; a.play(); setTimeout(() => a.pause(), 4000); } catch (e) {} }, i * 350 + 200);
  }
  if (i === 0) toast('No hay sonidos asignados en este alcance');
};
