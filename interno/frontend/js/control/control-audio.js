// control-audio.js
// Responsabilidad: audio personalizado (subir sonidos, asignar a eventos,
// música de fondo, mezclador). Se adjunta a `ctrl`.
import { ctrl, id, esc, toast } from './control-shared.js';
import { API, fetchRetry, apiPost } from '../control-api.js';

// 🔊 AUDIO (Fase 7)

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

ctrl.renderAudio = async function () {
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

ctrl.audioRenderLibrary = function () {
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

ctrl.audioUpload = async function () {
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

ctrl.audioDelete = async function (sid) {
  if (!confirm('¿Eliminar este sonido?')) return;
  try {
    await fetch(API + '/sounds/' + sid, { method: 'DELETE' });
    toast('🗑 Sonido eliminado');
    await ctrl.renderAudio();
  } catch (e) { toast('⚠ ' + e.message); }
};

ctrl.audioScope = function () {
  const s = id('audioScope');
  return s ? s.value : '__global__';
};

ctrl.audioRenderEvents = function () {
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

ctrl.audioClearScope = function () {
  const scope = ctrl.audioScope();
  if (scope === '__global__') return;
  delete ctrl._audio.map.modes[scope];
  ctrl.audioRenderEvents();
  toast('Override de "' + scope + '" limpiado');
};

ctrl.audioRenderBg = function () {
  const sel = id('audioBg');
  if (!sel) return;
  const opts = '<option value="">— (sin música) —</option>' + ctrl._audio.library.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.innerHTML = opts;
  const bg = ctrl._audio.map.background;
  sel.value = bg && bg.id ? bg.id : '';
  const vol = id('audioBgVol'); if (vol) { vol.value = bg && bg.volume != null ? bg.volume : 0.5; id('audioBgVolVal').textContent = vol.value; }
  const loop = id('audioBgLoop'); if (loop) loop.checked = !bg || bg.loop !== false;
};

ctrl.audioRenderChannels = function () {
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

ctrl.audioChange = function () {
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

ctrl.audioSave = async function () {
  ctrl.audioChange();
  try {
    const res = await apiPost('/sounds/map', ctrl._audio.map);
    if (res.error) { toast('⚠ ' + res.error); return; }
    ctrl._audio.map = res.map;
    toast('✔ Configuración de audio guardada');
  } catch (e) { toast('⚠ ' + e.message); }
};

ctrl.audioTest = async function () {
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
