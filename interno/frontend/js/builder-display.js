/**
 * builder-display.js — Modelo de "display" en vivo para el Modo Builder.
 *
 * Centraliza la interpretación de los bloques (looks / displays / quiz) en un
 * único estado y lo renderiza como una PANTALLA FIEL al display real (estética
 * brutalista). Así al EJECTUAR un modo se ve el programa de verdad, no solo
 * el resaltado de bloques.
 *
 * Uso:
 *   BuilderDisplay.interpret(opcode, args, state)  // muta state
 *   BuilderDisplay.renderStage(state, targetEl)     // dibuja state en targetEl
 *   BuilderDisplay.freshState()                     // estado limpio
 */
(function (global) {
  'use strict';

  const THEMES = {
    neon:   { bg: '#0a0a2e', fg: '#00ff88', accent: '#ff00ff', name: 'Neón' },
    biblia: { bg: '#1a0f00', fg: '#d4a574', accent: '#8b6914', name: 'Retro' },
    retro:  { bg: '#2d1b69', fg: '#e0e0e0', accent: '#ff6b35', name: 'Retro' },
    oscuro: { bg: '#0b0b0b', fg: '#f4f2ec', accent: '#FF5E3A', name: 'Oscuro' },
    brutal: { bg: '#0a0a0a', fg: '#f2f2f2', accent: '#2b50ff', name: 'Brutalist' },
    fire:   { bg: '#1a0000', fg: '#ffcc02', accent: '#ff3d00', name: 'Fire' },
    ocean:  { bg: '#0c1445', fg: '#e0f7fa', accent: '#00bcd4', name: 'Ocean' }
  };

  function freshState() {
    return {
      bg: '#0b0b0b', fg: '#f4f2ec', accent: '#FF5E3A', font: 'system-ui',
      gradient: null, bgImage: null,
      title: '', subtitle: '', body: '', footer: '',
      options: [], media: [], effects: [], audioIndicators: [],
      overlays: [], scores: [], timer: null,
      components: { question: true, scores: false, timer: false },
      theme: null, dirty: false
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function asText(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      try {
        if (v.text != null) return String(v.text);
        if (v.title != null) return String(v.title);
        if (v.body != null) return String(v.body);
        return JSON.stringify(v);
      } catch (e) { return ''; }
    }
    return String(v);
  }

  const BuilderDisplay = {
    freshState: freshState,

    /* Interpreta UN bloque y muta state. Cubre looks + displays + quiz. */
    interpret(opcode, a, state) {
      a = a || {};
      state = state || freshState();
      switch (opcode) {
        /* ---------- Looks / Visual ---------- */
        case 'set_theme': {
          const t = THEMES[a.THEME] || THEMES.oscuro;
          state.bg = t.bg; state.fg = t.fg; state.accent = t.accent;
          state.gradient = null; state.theme = t.name; break;
        }
        case 'set_custom_theme':
          if (a.BG) state.bg = a.BG;
          if (a.TXT) state.fg = a.TXT;
          if (a.ACC) state.accent = a.ACC;
          if (a.FNT) state.font = a.FNT;
          state.gradient = null; state.theme = 'Custom'; break;
        case 'set_gradient_bg': {
          const dirs = { '→': 'to right', '↓': 'to bottom', '↗': 'to top right', '↘': 'to bottom right' };
          state.gradient = 'linear-gradient(' + (dirs[a.DIR] || 'to right') + ', ' + (a.C1 || '#000') + ', ' + (a.C2 || '#fff') + ')';
          state.bg = 'transparent'; break;
        }
        case 'set_text_smooth':
          if (a.COMP && a.TXT) {
            const c = String(a.COMP).toLowerCase();
            if (/title|titulo|header|heading/.test(c)) state.title = a.TXT;
            else if (/sub|subtitle|bajada/.test(c)) state.subtitle = a.TXT;
            else if (/body|texto|content|pregunta|question/.test(c)) state.body = a.TXT;
            else if (/footer|pie|bottom/.test(c)) state.footer = a.TXT;
            else if (!state.title) state.title = a.TXT; else state.body = a.TXT;
          }
          break;
        case 'set_background_image':
          if (a.SRC) state.bgImage = a.SRC; break;
        case 'show_image':
          if (a.SRC) state.media.push({ type: 'image', src: a.SRC }); break;
        case 'show_video':
          if (a.SRC) state.media.push({ type: 'video', src: a.SRC, loop: !!a.LOOP }); break;
        case 'create_overlay':
          state.overlays.push({ id: a.ID || '', x: a.X, y: a.Y, w: a.W, h: a.H, text: '' }); break;
        case 'show_ui_component':
          if (a.COMP) {
            const c = String(a.COMP).toLowerCase();
            if (/score/.test(c)) state.components.scores = true;
            else if (/timer|tiempo|reloj/.test(c)) state.components.timer = true;
            else if (/question|pregunta/.test(c)) state.components.question = true;
          }
          break;
        case 'display_set_timer':
          state.components.timer = true;
          state.timer = { sec: Number(a.SEC) || 0 }; break;
        case 'screen_flash': state.effects.push('Flash'); break;
        case 'screen_shake': state.effects.push('Shake'); break;
        case 'set_text_shadow': state.effects.push('Sombra'); break;
        case 'set_border': state.effects.push('Borde'); break;
        case 'set_rounded_corners': state.effects.push('Esquinas'); break;
        case 'set_opacity_block': state.effects.push('Opacidad'); break;

        /* ---------- Displays (Multi-Display) ---------- */
        case 'display_broadcast_payload':
          interpretPayload(a.ACT, a.DATA, state); break;
        case 'clear_all_displays':
          Object.assign(state, freshState()); break;
        case 'display_register_setup':
          state.effects.push('Grid:' + (a.GRID || 'auto')); break;
        case 'set_layer_z_index':
        case 'set_grid_anchor':
          state.effects.push(opcode); break;
        case 'display_sync_clocks':
          break;

        /* ---------- Quiz / Estado ---------- */
        case 'add_score':
          state.components.scores = true;
          addScore(state, a.PLAYER, a.PTS); break;
        case 'reset_scores':
          state.scores = []; break;
        case 'score':
          break;

        default:
          // Algunos bloques reporter/bool no cambian el display; ignorar.
          break;
      }
      state.dirty = true;
      return state;
    },

    /* Render fiel del estado en targetEl (pantalla brutalista). */
    renderStage(state, targetEl) {
      if (!targetEl) return;
      state = state || freshState();
      let bg = state.bg;
      if (state.gradient) bg = state.gradient;
      else if (state.bgImage) bg = 'linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url(' + esc(state.bgImage) + ') center/cover';

      let html = '';
      html += '<div class="bd-screen" style="background:' + esc(bg) + ';color:' + esc(state.fg) + ';' +
        (state.font && state.font !== 'system-ui' ? 'font-family:' + esc(state.font) + ';' : '') + '">';

      // Barra superior: theme + timer
      html += '<div class="bd-topbar">';
      if (state.theme) html += '<span class="bd-badge">🎨 ' + esc(state.theme) + '</span>';
      if (state.components?.timer && state.timer?.sec != null) {
        html += '<span class="bd-timer">⏱ ' + esc(state.timer.sec) + 's</span>';
      }
      html += '</div>';

      // Cuerpo
      html += '<div class="bd-body">';
      if (state.title) html += '<div class="bd-title">' + esc(state.title) + '</div>';
      if (state.subtitle) html += '<div class="bd-sub">' + esc(state.subtitle) + '</div>';
      if (state.body) html += '<div class="bd-text">' + esc(state.body) + '</div>';

      (state.media || []).filter(m => m.type === 'image').forEach(m => {
        html += '<div class="bd-media">🖼️ ' + esc(m.src) + '</div>';
      });
      (state.media || []).filter(m => m.type === 'video').forEach(m => {
        html += '<div class="bd-media">▶️ ' + esc(m.src) + (m.loop ? ' 🔁' : '') + '</div>';
      });

      if (state.options && state.options.length) {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        html += '<div class="bd-options">';
        state.options.forEach((o, i) => {
          html += '<div class="bd-opt"><span class="bd-opt-key">' + (letters[i] || (i + 1)) + '</span>' + esc(o) + '</div>';
        });
        html += '</div>';
      }
      if (state.footer) html += '<div class="bd-footer">' + esc(state.footer) + '</div>';
      html += '</div>';

      // Scores
      if (state.components?.scores && (state.scores || []).length) {
        html += '<div class="bd-scores">';
        (state.scores || []).slice(0, 6).forEach(s => {
          html += '<div class="bd-score-row"><span class="bd-score-name">' + esc(s.name) + '</span>' +
            '<span class="bd-score-pts">' + esc(s.pts) + '</span></div>';
        });
        html += '</div>';
      }

      // Overlays
      (state.overlays || []).forEach(o => {
        html += '<div class="bd-overlay">' + (o.text || (o.id ? 'Overlay ' + esc(o.id) : 'Overlay')) + '</div>';
      });

      // Efectos
      if ((state.effects || []).length) {
        html += '<div class="bd-effects">' + (state.effects || []).map(e => '✦ ' + esc(e)).join(' ') + '</div>';
      }

      html += '</div>';
      targetEl.innerHTML = html;
    }
  };

  function interpretPayload(act, data, state) {
    const A = String(act || '').toLowerCase();
    const d = data;
    if (/overlay|banner|capa/.test(A)) {
      state.overlays.push({ id: '', text: asText(d) });
      return;
    }
    if (/score/.test(A)) { state.components.scores = true; return; }
    if (/timer|tiempo/.test(A)) { state.components.timer = true; return; }
    if (/image|imagen/.test(A)) {
      const src = (d && (d.src || d.url || d)) || '';
      if (src) state.media.push({ type: 'image', src: asText(src) });
      return;
    }
    // Por defecto: texto / pregunta
    const txt = asText(d);
    if (txt) state.body = txt;
  }

  function addScore(state, player, pts) {
    const name = asText(player) || 'Jugador';
    const p = Number(pts) || 0;
    let row = state.scores.find(s => s.name === name);
    if (!row) { row = { name: name, pts: 0 }; state.scores.push(row); }
    row.pts += p;
    state.scores.sort((a, b) => b.pts - a.pts);
  }

  global.BuilderDisplay = BuilderDisplay;
})(typeof window !== 'undefined' ? window : this);
