/* global window, document, global, requestAnimationFrame, cancelAnimationFrame, performance */
/*
 * scratch-stage.js — Panel Stage de previsualización en vivo para Modo Builder.
 *
 * Es un OBSERVADOR: el runtime (scratch-runtime.js) reenvía cada sideEffect/
 * reporter a window.ScratchStage.handle(...). El Stage pinta:
 *   - un preview de canvas real (PreviewEngine): scoreboard, timer, pregunta.
 *   - un FX de canvas propio: ráfagas, confeti, destellos (bloques anim_*).
 *   - las tarjetas de datos: pantallas, NDI, quiz/scores, estado.
 *   - (opcional) ShapeEngine: formas animadas en #decorLayer si está cargado.
 * Nunca rompe la ejecución del modo (try/catch en el runtime).
 */
(function (global) {
  'use strict';

  const KIND = {
    display: /^display_|^screen_/,
    ndi: /^ndi_/,
    quiz: /^quiz_/,
    state: /^state_/,
    engine: /^engine_|^anim_/,
    physics: /^physics_/
  };
  const FX_PALETTE = ['#fbbf24', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#60a5fa'];

  function isKind(opcode, re) { return re.test(opcode); }
  function firstText(args) {
    if (!args) return '';
    for (const k of ['TXT', 'MSG', 'TEXT', 'CONTENT', 'DATA', 'HTML', 'SCENE', 'VALUE']) {
      if (args[k] !== undefined && args[k] !== null && args[k] !== '') return String(args[k]);
    }
    return JSON.stringify(args);
  }
  function colorVar(opcode) {
    if (isKind(opcode, KIND.ndi)) return 'var(--cat-ndi, #00B894)';
    if (isKind(opcode, KIND.quiz)) return 'var(--cat-motion, #FFD500)';
    if (isKind(opcode, KIND.engine)) return 'var(--cat-engine, #7c3aed)';
    if (isKind(opcode, KIND.display)) return 'var(--cat-displays, #4C97FF)';
    if (isKind(opcode, KIND.physics)) return 'var(--cat-physics, #6D4C41)';
    return 'var(--cat-control, #FF5E3A)';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(v) {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, 120); } catch (e) { return '[obj]'; } }
    return String(v).slice(0, 120);
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ---------- FX de canvas propio (ráfagas / confeti / destello) ---------- */
  function StageFX(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.flashColor = null;
    this.flashUntil = 0;
    this.running = false;
    this._raf = null;
    this.resize();
  }
  StageFX.prototype.resize = function () {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width);
    this.canvas.height = Math.max(1, r.height);
    this.w = this.canvas.width; this.h = this.canvas.height;
  };
  StageFX.prototype._loop = function () {
    if (!this.running) return;
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    if (this.flashColor && performance.now() < this.flashUntil) {
      ctx.globalAlpha = 0.45 * ((this.flashUntil - performance.now()) / 320);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    } else { this.flashColor = null; }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= 1;
      if (p.life <= 0 || p.y > h + 40) { this.particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(p.x, p.y, p.s, p.s);
      else if (p.shape === 'star') { this._star(p.x, p.y, p.s); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (this.particles.length || this.flashColor) this._raf = requestAnimationFrame(() => this._loop());
    else this.running = false;
  };
  StageFX.prototype._star = function (x, y, s) {
    const ctx = this.ctx; ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      const a2 = a + Math.PI / 5;
      ctx.lineTo(x + Math.cos(a2) * s * 0.45, y + Math.sin(a2) * s * 0.45);
    }
    ctx.closePath(); ctx.fill();
  };
  StageFX.prototype._ensure = function () {
    if (!this.running) { this.running = true; this._raf = requestAnimationFrame(() => this._loop()); }
  };
  StageFX.prototype.burst = function (color, n) {
    n = n || 18; color = color || pick(FX_PALETTE);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
      this.particles.push({ x: this.w / 2, y: this.h / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        g: 0.12, s: 2 + Math.random() * 4, color: color, shape: Math.random() < 0.5 ? 'circle' : 'star', life: 50 + Math.random() * 30, max: 80 });
    }
    this._ensure();
  };
  StageFX.prototype.confetti = function () {
    for (let i = 0; i < 80; i++) {
      this.particles.push({ x: Math.random() * this.w, y: -10 - Math.random() * 40, vx: (Math.random() - 0.5) * 2,
        vy: 2 + Math.random() * 3, g: 0.06, s: 3 + Math.random() * 4, color: pick(FX_PALETTE), shape: 'rect', life: 120 + Math.random() * 60, max: 180 });
    }
    this._ensure();
  };
  StageFX.prototype.flash = function (color) {
    this.flashColor = color || '#ffffff';
    this.flashUntil = performance.now() + 320;
    this._ensure();
  };
  StageFX.prototype.clear = function () { this.particles = []; this.flashColor = null; };

  /* ---------- Stage principal ---------- */
  const Stage = {
    el: null, mounted: false, openState: false,
    displays: {}, players: {}, ndi: {},
    question: '(sin preguntas)', answerRevealed: false, step: 0,
    preview: null, previewConfig: null, fx: null, shapeEngine: null, shapeStarted: false,

    mount(stageEl) {
      this.el = stageEl || document.getElementById('sbStageWrap');
      if (!this.el) return false;
      if (this.mounted) return true;
      this.el.innerHTML =
        '<div class="stage-inner">' +
          '<div class="stage-toolbar">' +
            '<span class="stage-title"><span class="stage-dot"></span> STAGE</span>' +
            '<div class="stage-tools">' +
              '<button class="stage-btn" data-stage="play" title="Ejecutar">&#9654;</button>' +
              '<button class="stage-btn" data-stage="pause" title="Detener">&#9209;</button>' +
              '<button class="stage-btn" data-stage="size" title="Tamaño">&#10530;</button>' +
              '<span class="stage-ndi" data-ndi>NDI: off</span>' +
            '</div>' +
          '</div>' +
          '<div class="stage-body">' +
            '<div class="stage-preview" data-preview>' +
              '<canvas class="stage-canvas" data-preview-canvas></canvas>' +
              '<canvas class="stage-fx" data-fx-canvas></canvas>' +
              '<div class="stage-decor" id="decorLayer" data-decor></div>' +
            '</div>' +
            '<div class="stage-row">' +
              '<div class="stage-displays" data-displays></div>' +
              '<div class="stage-side">' +
                '<div class="stage-card stage-quiz" data-quiz>' +
                  '<div class="stage-card-h">QUIZ</div>' +
                  '<div class="stage-question" data-question>(sin preguntas)</div>' +
                  '<div class="stage-players" data-players><em>scores:</em></div>' +
                '</div>' +
                '<div class="stage-card stage-state" data-state>' +
                  '<div class="stage-card-h">ESTADO</div>' +
                  '<div class="stage-state-body" data-statebody><em>vacío</em></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      this.el.querySelector('[data-stage="play"]').addEventListener('click', () => { if (global.scratchUI && global.scratchUI.run) global.scratchUI.run(); });
      this.el.querySelector('[data-stage="pause"]').addEventListener('click', () => { if (global.scratchUI && global.scratchUI.panic) global.scratchUI.panic(); });
      this.el.querySelector('[data-stage="size"]').addEventListener('click', () => this.cycleSize());

      const pvCanvas = this.el.querySelector('[data-preview-canvas]');
      const fxCanvas = this.el.querySelector('[data-fx-canvas]');
      if (global.PreviewEngine) { try { this.preview = new global.PreviewEngine(pvCanvas); } catch (e) { this.preview = null; } }
      try { this.fx = new StageFX(fxCanvas); } catch (e) { this.fx = null; }
      if (global.ShapeEngine) {
        try { this.shapeEngine = new global.ShapeEngine({ maxShapes: 18 }); } catch (e) { this.shapeEngine = null; }
      }
      this.previewConfig = { puntuaciones: {}, preguntas: [], pregunta_actual: 0, scoring: {}, visual: { animaciones: ['particles'] } };
      this.mounted = true;
      return true;
    },

    ensure() { return this.mounted || this.mount(); },

    open() {
      if (!this.ensure()) return;
      this.el.setAttribute('data-open', '1');
      this.openState = true;
      if (this.preview) { this.preview.resize(); this.preview.render(this.previewConfig); }
      if (this.fx) this.fx.resize();
      if (this.shapeEngine && !this.shapeStarted) { try { this.shapeEngine.start(); this.shapeStarted = true; } catch (e) {} }
    },
    close() {
      if (!this.el) return;
      this.el.setAttribute('data-open', '0');
      this.openState = false;
      if (this.preview && this.preview.stop) this.preview.stop();
      if (this.fx) this.fx.running = false;
      if (this.shapeEngine) {
        try {
          if (this.shapeEngine._spTm) clearInterval(this.shapeEngine._spTm);
          if (this.shapeEngine._burstTm) clearInterval(this.shapeEngine._burstTm);
        } catch (e) {}
        this.shapeStarted = false;
      }
    },
    toggle() { this.openState ? this.close() : this.open(); },
    isOpen() { return this.openState; },
    cycleSize() {
      if (!this.el) return;
      const cur = this.el.getAttribute('data-size') || 'normal';
      const next = cur === 'normal' ? 'compact' : cur === 'compact' ? 'wide' : 'normal';
      this.el.setAttribute('data-size', next);
      if (this.openState) { if (this.preview) { this.preview.resize(); this.preview.render(this.previewConfig); } if (this.fx) this.fx.resize(); }
    },

    reset() {
      this.displays = {}; this.players = {}; this.ndi = {};
      this.question = '(sin preguntas)'; this.answerRevealed = false; this.step = 0;
      this.previewConfig = { puntuaciones: {}, preguntas: [], pregunta_actual: 0, scoring: {}, visual: { animaciones: ['particles'] } };
      if (this.mounted) {
        const dd = this.el.querySelector('[data-displays]');
        const pl = this.el.querySelector('[data-players]');
        const st = this.el.querySelector('[data-statebody]');
        if (dd) dd.innerHTML = '';
        if (pl) pl.innerHTML = '<em>scores:</em>';
        if (st) st.innerHTML = '<em>vacío</em>';
        const q = this.el.querySelector('[data-question]');
        if (q) q.textContent = this.question;
        const ndi = this.el.querySelector('[data-ndi]');
        if (ndi) ndi.textContent = 'NDI: off';
        if (this.fx) this.fx.clear();
        if (this.preview && this.openState) this.preview.render(this.previewConfig);
      }
    },

    handle(opcode, args, ctx, res) {
      if (!this.ensure()) return;
      this.step++;
      const a = args || {};

      if (isKind(opcode, KIND.display)) {
        const id = a.DISP || a.SCREEN_ID || 'main';
        this.paintDisplay(id, firstText(a), colorVar(opcode), a);
        if (a.ACT === 'clear' || opcode === 'clear_all_displays') this.clearFx();
      } else if (opcode === 'announce') {
        this.paintDisplay('announce', firstText(a), colorVar(opcode), a);
      } else if (isKind(opcode, KIND.ndi)) {
        if (opcode === 'ndi_connect_source') this.ndi[a.OUT || 'out'] = a.SRC || '?';
        if (opcode === 'ndi_disconnect_source') delete this.ndi[a.OUT || 'out'];
        if (opcode === 'ndi_send_canvas_scene') this.paintDisplay('ndi:' + (a.OUT || 'out'), 'NDI ▶ ' + (a.SCENE || ''), colorVar(opcode), a);
        this.renderNdi();
      } else if (opcode === 'quiz_set_question') {
        this.question = a.TXT || this.question;
        this.answerRevealed = false;
        this.renderQuiz(); this.refreshPreview();
      } else if (opcode === 'quiz_add_score_to_player') {
        const p = a.PLAYER || '?';
        this.players[p] = (this.players[p] || 0) + (Number(a.PTS) || 0);
        this.renderQuiz(); this.refreshPreview();
        if (this.fx) this.fx.burst('#fbbf24', 16);
        if (this.shapeEngine && this.shapeEngine.burst) try { this.shapeEngine.burst(5); } catch (e) {}
      } else if (opcode === 'quiz_reveal_answer') {
        this.answerRevealed = true; this.renderQuiz();
      } else if (opcode === 'quiz_reset_scores') {
        this.players = {}; this.renderQuiz(); this.refreshPreview();
      } else if (isKind(opcode, KIND.engine)) {
        this.handleAnim(opcode, a);
      } else if (isKind(opcode, KIND.state) || (this.step % 50 === 0)) {
        if (ctx && ctx.state) this.renderState(ctx.state);
      }
    },

    handleAnim(opcode, a) {
      if (opcode === 'anim_mode') {
        if (this.shapeEngine && this.shapeEngine.setMode) try { this.shapeEngine.setMode(a.MODE || 'idle'); } catch (e) {}
        if (this.fx) this.fx.flash('#7c3aed');
      } else if (opcode === 'anim_burst') {
        if (this.fx) this.fx.burst(pick(FX_PALETTE), Number(a.N) || 6);
        if (this.shapeEngine && this.shapeEngine.burst) try { this.shapeEngine.burst(Number(a.N) || 6); } catch (e) {}
      } else if (opcode === 'anim_flash') {
        if (this.fx) this.fx.flash(a.COLOR || '#ffffff');
      } else if (opcode === 'anim_confetti') {
        if (this.fx) this.fx.confetti();
      } else if (opcode === 'anim_clear_fx') {
        this.clearFx();
      }
    },

    clearFx() {
      if (this.fx) this.fx.clear();
      if (this.shapeEngine && this.shapeEngine.setMode) try { this.shapeEngine.setMode('idle'); } catch (e) {}
    },

    refreshPreview() {
      this.previewConfig.puntuaciones = Object.assign({}, this.players);
      this.previewConfig.preguntas = this.question ? [{ texto: this.question, opciones: ['A', 'B', 'C', 'D'] }] : [];
      if (this.preview && this.openState) this.preview.render(this.previewConfig);
    },

    paintDisplay(id, text, color, args) {
      let tile = this.displays[id];
      const host = this.el.querySelector('[data-displays]');
      if (!host) return;
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'stage-tile';
        host.appendChild(tile);
        this.displays[id] = tile;
      }
      tile.style.borderTopColor = color;
      const label = (id === 'main') ? 'PANTALLA' : (id === 'announce') ? 'ANUNCIO' : String(id).toUpperCase();
      tile.innerHTML =
        '<div class="stage-tile-h" style="color:' + color + '">' + escapeHtml(label) + '</div>' +
        '<div class="stage-tile-b">' + escapeHtml(text) + '</div>';
    },

    renderNdi() {
      const el = this.el.querySelector('[data-ndi]');
      if (!el) return;
      const keys = Object.keys(this.ndi);
      el.textContent = keys.length ? ('NDI: ' + keys.length + ' ▶') : 'NDI: off';
    },

    renderQuiz() {
      const q = this.el.querySelector('[data-question]');
      const pl = this.el.querySelector('[data-players]');
      if (q) q.textContent = this.question + (this.answerRevealed ? '  ✓' : '');
      if (pl) {
        const rows = Object.keys(this.players)
          .sort((x, y) => this.players[y] - this.players[x])
          .map(p => '<div class="stage-player"><span>' + escapeHtml(p) + '</span><b>' + this.players[p] + '</b></div>')
          .join('') || '<em>sin scores</em>';
        pl.innerHTML = '<em>scores:</em>' + rows;
      }
    },

    renderState(state) {
      const body = this.el.querySelector('[data-statebody]');
      if (!body) return;
      const keys = Object.keys(state)
        .filter(k => !k.startsWith('__') && !k.startsWith('list_') && !k.startsWith('var_'))
        .slice(0, 40);
      if (!keys.length) { body.innerHTML = '<em>vacío</em>'; return; }
      body.innerHTML = keys.map(k =>
        '<div class="stage-var"><span>' + escapeHtml(k) + '</span><b>' + escapeHtml(fmt(state[k])) + '</b></div>'
      ).join('');
    }
  };

  global.ScratchStage = Stage;

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => Stage.mount());
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { Stage };
})(typeof window !== 'undefined' ? window : this);
