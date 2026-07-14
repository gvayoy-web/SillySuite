import { getAudioCtx, spawnParticle, clearParticlePool, adjustTextSize, typewriteText, adjustOptTextSize } from './display-utils.js';
import { rebuildGrupos, renderTimer as renderTimerOrig, renderScores, renderPodium } from './display-scores.js';
import { showPointAnim, resizeCelebCanvas, animCelebration, launchCelebration } from './display-anim.js';
import { iniciarRuletaCategoria, iniciarRuletaWheel, cerrarRuleta } from './display-roulette.js';
import { showHangman, showTiempo, showBattle, showSurvival, showQuizShow } from './display-modes.js';
import { SM } from './display-shapes2.js';
import { actualizarDisplayConfig, aplicarTema, aplicarTransicionModo, onHangmanError, onCorrectAnswer, onIncorrectAnswer, onRoundFinal, offRoundFinal, onPenalty, onStreak, offStreak, onTimerLow, offTimerLow, onTimerZero, onRecord, onHardQuestion, onEpicCorrect, onFreezeVisual } from './display-config.js';
import { applyScreenConfig } from './display-screens.js';
import { sfxNewQuestion, sfxCorrect, sfxIncorrect, sfxFinalRound, sfxPodium, sfxEliminado, sfxModeActivate, setMuted, SoundEngine } from './display-sound.js';

// Expose for quiz-renderer.js (regular script, not module)
window.adjustTextSize = adjustTextSize;
window.typewriteText = typewriteText;
window.adjustOptTextSize = adjustOptTextSize;

const API = window.location.origin + "/api";

window.__screenId = new URLSearchParams(window.location.search).get("screen") || "1";

window.CAT_NAMES = {};
window.CAT_COLORS = {};

async function loadCategories() {
    try {
        const res = await fetch(`${API}/config/categories`);
        const cats = await res.json();
        Object.keys(cats || {}).forEach(function(key) {
            const c = cats[key];
            window.CAT_NAMES[key] = c.name || c.nombre || key;
            window.CAT_COLORS[key] = c.color || '#800020';
        });
    } catch (e) {
        window.CAT_NAMES = { palabra: 'PALABRA', cantante: 'CANTANTE' };
        window.CAT_COLORS = { palabra: '#FF00FF', cantante: '#FF5500' };
    }
}

window.currentQId = null;
let lastAnimId = -1;
let _lastOverlayReset = 0;
let _localTimerTick = null;
window._lastOptionsKey = "";

window.GRUPOS = [];
window.prevPts = {};
window.streaks = {};
window._wasActive = false;
window._lastTimerSec = -1;
window._timerWasZero = false;
window._scoreFirstSync = true;

let _lastPreguntaId = null;
let _lastRespuesta = false;
let _lastFinalRound = false;
let _lastFinalResults = false;
let _lastMode = "";
let _lastEliminados = [];
window._lastConfettiFlag = null;

function procesarEstado(d) {
    const pip = document.getElementById("livePip");
    const lbl = document.getElementById("liveLabel");
    if (pip) pip.className = "live-pip on";
    if (lbl) lbl.textContent = "EN VIVO";

    aplicarTema(d);
    if (SM && typeof SM.syncTheme === "function") SM.syncTheme();
    if (SM && typeof SM.setThemeMode === "function") {
        const modo = d.modo_activo || "default";
        if (modo && modo !== "default") SM.setThemeMode(modo);
        const sec = d.modo_secundario;
        if (sec && sec !== "default") SM.setThemeMode(sec);
    }

    applyScreenConfig(d.display_config, window.__screenId);

    showHangman(d);
    showTiempo(d);
    showBattle(d);
    showSurvival(d);
    showQuizShow(d);

    // ── Dynamic theme events ──
    if (d.hangman) {
        const maxAttempts = d.hangman.max_attempts || 6;
        const attemptsLeft = d.hangman.attempts_left || 0;
        const errorsUsed = maxAttempts - attemptsLeft;
        onHangmanError(errorsUsed);
    }

    if (d.mostrar_respuesta && !_lastRespuesta && d.pregunta_actual) {
        if (d.opcion_seleccionada !== undefined && d.opcion_seleccionada !== null &&
            d.opcion_seleccionada === d.pregunta_actual.respuesta_correcta) {
            onCorrectAnswer();
            if (window.streaks) {
                const grp = d.pregunta_actual.grupo || '';
                window.streaks[grp] = (window.streaks[grp] || 0) + 1;
                onStreak(window.streaks[grp]);
            }
        } else if (d.opcion_seleccionada !== undefined && d.opcion_seleccionada !== null) {
            onIncorrectAnswer();
            if (window.streaks) {
                const grp = d.pregunta_actual.grupo || '';
                window.streaks[grp] = 0;
                offStreak();
            }
        }
    }

    if (d.display_config) {
        const fr = !!d.display_config.final_round;
        if (fr && !_lastFinalRound) {
            onRoundFinal();
        } else if (!fr && _lastFinalRound) {
            offRoundFinal();
        }
    }

    if (d.temporizador && d.temporizador.segundos_restantes !== undefined) {
        if (d.temporizador.segundos_restantes <= 10 && d.temporizador.segundos_restantes > 0) {
            onTimerLow();
        } else {
            offTimerLow();
        }
        if (d.temporizador.segundos_restantes === 0 && !_timerWasZero) {
            onTimerZero();
        }
        _timerWasZero = d.temporizador.segundos_restantes === 0;
    }

    if (d.ultima_animacion && d.ultima_animacion.includes("PENALIZACIÓN")) {
        onPenalty();
    }

    if (d.puntos) {
        const prev = window.prevPts || {};
        for (const [key, val] of Object.entries(d.puntos)) {
            if (prev[key] && val > prev[key] * 1.5 && val > 100) {
                onRecord();
            }
        }
        window.prevPts = { ...d.puntos };
    }
    if (d.display_config) {
        document.body.classList.toggle(
            "kiosko-mode",
            d.display_config.kiosko,
        );
        localStorage.setItem(
            "kioskoMode",
            d.display_config.kiosko ? "true" : "false",
        );
        const animDisabled = d.display_config.animations_disabled;
        localStorage.setItem(
            "disableAnimations",
            animDisabled ? "true" : "false",
        );
        document.documentElement.classList.toggle(
            "no-animations",
            animDisabled,
        );
        if (d.display_config.overlay_reset > _lastOverlayReset) {
            _lastOverlayReset = d.display_config.overlay_reset;
            const wo = document.getElementById("winnerOverlay");
            if (wo) wo.classList.remove("show");
            const teo = document.getElementById("timerEndOverlay");
            if (teo) teo.style.opacity = "0";
            cerrarRuleta();
        }
        if (d.display_config.grupos_config) {
            rebuildGrupos(d.display_config.grupos_config);
        }
        document.body.classList.toggle('scanline-mode', !!d.display_config.scanline);
        document.body.classList.toggle('glow-fx', !!d.display_config.glow_fx);
        document.body.classList.toggle('ultra-glow', !!d.display_config.ultra_glow);
        document.body.classList.toggle('micro-particles-mode', !!d.display_config.micro_particles);
        // glass-morphism removed
        document.body.classList.toggle('dynamic-bg-mode', !!d.display_config.dynamic_bg);
        document.body.classList.toggle('fractal-animations', !!d.display_config.fractal_animations);
        document.body.classList.toggle('vignette-screen', !!d.display_config.vignette);
        document.body.classList.toggle('glow-pulse', !!d.display_config.glow_pulse);
        document.body.classList.toggle('score-breathe', !!d.display_config.score_breathe);
        document.body.classList.toggle('bg-breath', !!d.display_config.bg_breath);
        document.body.classList.toggle('theme-effects', !!d.display_config.theme_effects);
        document.body.classList.toggle('solo-scores', !!d.display_config.solo_scores);

        // New visual features
        document.body.classList.remove('score-anim-flip', 'score-anim-bounce', 'score-anim-glow');
        if (d.display_config.score_anim && d.display_config.score_anim !== 'none') {
            document.body.classList.add('score-anim-' + d.display_config.score_anim);
        }
        document.body.classList.toggle('crown-leader', !!d.display_config.crown_leader);
        document.body.classList.toggle('show-progress', !!d.display_config.show_progress);
        document.body.classList.toggle('dynamic-bars', !!d.display_config.dynamic_bars);
        document.body.classList.remove('edge-blend-cinemascope', 'edge-blend-vignette', 'edge-blend-crt');
        if (d.display_config.edge_blend && d.display_config.edge_blend !== 'none') {
            document.body.classList.add('edge-blend-' + d.display_config.edge_blend);
        }
        document.body.classList.toggle('welcome-screen', !!d.display_config.welcome_screen);
        document.body.classList.toggle('show-verse', !!d.display_config.show_verse);

        // Flash intensity — set CSS variable on body
        var fi = d.display_config.flash_intensity;
        if (fi === undefined) fi = 1;
        document.documentElement.style.setProperty('--flash-intensity', fi);

        // Ambient effects
        var ambientEffects = d.display_config.ambient_effects || [];
        ['stars', 'fog', 'lightning', 'golden', 'confetti', 'fireworks'].forEach(function(eff) {
            document.body.classList.toggle('ambient-' + eff, ambientEffects.includes('ambient-' + eff));
        });

        actualizarDisplayConfig(d);
        try {
            SoundEngine.setLibrary(d.sound_library || []);
            SoundEngine.setMode(d.modo_activo || d.modo || 'default');
            if (d.display_config && d.display_config.sound_map) {
                SoundEngine.setMap(d.display_config.sound_map);
            }
        } catch (e) {
            console.warn('SoundEngine:', e);
        }
        setMuted(!d.display_config.sound);
    }
    const confettiEnabled = d.display_config?.confetti;
    const prevConfetti = window._lastConfettiFlag;
    window._lastConfettiFlag = confettiEnabled;
    if (confettiEnabled && !prevConfetti && d.resultados_finales && document.getElementById('finalResultsOverlay')?.classList.contains('show')) {
        const winner = d.resultados_finales[0];
        if (winner) {
            const wg = window.GRUPOS.find(x => x.key === winner.grupo);
            if (wg) {
                setTimeout(() => launchCelebration(wg.color, wg.color2, 120), 600);
                setTimeout(() => launchCelebration(wg.color, wg.color2, 80), 1400);
            }
        }
    }
    // ── Two-phase roulette ──
    if (d.ruleta && d.ruleta.anim_id > window._ruletaUltimoId) {
        window._ruletaUltimoId = d.ruleta.anim_id;
        if (!d.ruleta.activa) { cerrarRuleta(); }
        else if (d.ruleta.fase === "category_select" && window._ruletaAnimPhase === "idle") {
            iniciarRuletaCategoria(d);
        } else if (d.ruleta.fase === "wheel" && !window._ruletaGirando) {
            iniciarRuletaWheel(d);
        } else if (d.ruleta.fase === "result" && !window._ruletaGirando) {
            iniciarRuletaWheel(d);
        }
    }
    if (d.ruleta && !d.ruleta.activa) {
        cerrarRuleta();
    }

    if (d.display_config) {
        const fr = d.display_config.final_round;
        document.body.classList.toggle("final-round", fr);
        const frBadge = document.getElementById("finalRoundBadge");
        if (frBadge) frBadge.style.display = fr ? "block" : "none";
        const frOv = document.getElementById("finalResultsOverlay");
        if (d.display_config.final_results) {
            if (d.resultados_finales && frOv) {
                frOv.classList.add("show");
                renderPodium(d.resultados_finales);
                const winner = d.resultados_finales[0];
                if (winner) {
                    const wg = window.GRUPOS.find(x => x.key === winner.grupo);
                    if (wg) {
                        setTimeout(() => launchCelebration(wg.color, wg.color2, 120), 600);
                        setTimeout(() => launchCelebration(wg.color, wg.color2, 80), 1400);
                    }
                }
            }
        } else if (frOv) {
            frOv.classList.remove("show");
        }
    }
    const bgStyle = d.display_config?.bg_style || 'default';
    document.body.classList.toggle('bg-gradient', bgStyle === 'gradient');
    document.body.classList.toggle('bg-particles', bgStyle === 'particles');
    document.body.classList.toggle('bg-none', bgStyle === 'none');
    document.body.classList.toggle('no-decorations', !d.display_config?.decorations);
    if (d.display_config?.particles) {
        if (!window._particleInterval) {
            function scheduleParticle() {
                if (document.getElementById('frozenIndicator')?.classList.contains('show')) return;
                spawnParticle();
                window._particleInterval = setTimeout(scheduleParticle, 800 + Math.random() * 400);
            }
            window._particleInterval = setTimeout(scheduleParticle, 300);
        }
    } else {
        if (window._particleInterval) {
            clearTimeout(window._particleInterval);
            window._particleInterval = null;
        }
        clearParticlePool();
    }
    const isFrozen = d.display_config && d.display_config.frozen;
    const frozenEl = document.getElementById('frozenIndicator');
    if (frozenEl) frozenEl.classList.toggle('show', !!isFrozen);

    if (!isFrozen) {
      if (d.pregunta_actual != null) {
          document.body.classList.toggle("modo-pregunta", true);
          document.body.classList.toggle("modo-opciones", !!d.mostrar_opciones);
          document.body.classList.toggle("modo-respuesta", !!d.mostrar_respuesta);
          window.renderQuestion(
              d.pregunta_actual,
              d.mostrar_respuesta,
              d.mostrar_opciones,
              d.opcion_seleccionada,
          );
      } else {
          document.body.classList.remove("modo-pregunta", "modo-opciones", "modo-respuesta");
          window.renderQuestion(null, false, false, null);
      }

      // Welcome screen overlay — siempre visible como pantalla de espera
      // cuando no hay pregunta activa (robustez: nunca queda en negro).
      var welcomeEl = document.getElementById("welcomeOverlay");
      if (welcomeEl) {
          var showWelcome = d.pregunta_actual == null;
          welcomeEl.classList.toggle("show", showWelcome);
      }

      // Verse reference on question
      var verseEl = document.getElementById("qVerse");
      if (verseEl) {
          if (d.pregunta_actual && d.display_config.show_verse && d.pregunta_actual.referencia) {
              verseEl.textContent = d.pregunta_actual.referencia;
              verseEl.style.display = "block";
          } else {
              verseEl.style.display = "none";
          }
      }

      // Dynamic bars — pass flag to renderScores
      window._dynamicBars = !!d.display_config.dynamic_bars;

      // Show progress always
      var qp = document.getElementById("qProgress");
      if (qp) {
          var shouldShow = d.display_config.show_progress || (d.pregunta_actual != null && window._questionCount > 0);
          qp.style.display = shouldShow ? "flex" : "none";
          qp.classList.toggle("active", shouldShow);
      }
      if (d.temporizador) renderTimerOrig(d.temporizador);
      if (d.puntos != null) {
          const elim = d.display_config ? d.display_config.eliminados : undefined;
          renderScores(d.puntos, elim);
      }

      if (d.ultima_animacion_id > lastAnimId) {
          lastAnimId = d.ultima_animacion_id;
          const animData = d.anim_data || {};
          if (d.ultima_animacion) {
              const grupKey = animData.grupo ||
                  window.GRUPOS.find((g) =>
                      d.ultima_animacion
                          .toUpperCase()
                          .includes(g.key.toUpperCase()),
                  )?.key || "";
              const esPena = animData.tipo === "penalizacion" ||
                  d.ultima_animacion.includes("PENALIZACIÓN");
              const cantidad = animData.cantidad || 0;
              showPointAnim(d.ultima_animacion, grupKey, esPena, cantidad);
          }
      }
    }

    if (d.pregunta_actual && d.pregunta_actual.id !== _lastPreguntaId) {
        _lastPreguntaId = d.pregunta_actual.id;
        if (!isFrozen) sfxNewQuestion();
    }
    if (d.mostrar_respuesta && !_lastRespuesta && d.pregunta_actual) {
        if (d.opcion_seleccionada !== undefined && d.opcion_seleccionada !== null &&
            d.opcion_seleccionada === d.pregunta_actual.respuesta_correcta) {
            if (!isFrozen) sfxCorrect();
        } else if (d.opcion_seleccionada !== undefined && d.opcion_seleccionada !== null) {
            if (!isFrozen) sfxIncorrect();
        }
    }
    _lastRespuesta = !!d.mostrar_respuesta;

    if (d.display_config) {
        const fr = !!d.display_config.final_round;
        if (fr && !_lastFinalRound) { if (!isFrozen) sfxFinalRound(); }
        _lastFinalRound = fr;

        const frr = !!d.display_config.final_results;
        if (frr && !_lastFinalResults && d.resultados_finales) { if (!isFrozen) sfxPodium(); }
        _lastFinalResults = frr;

        const elims = d.display_config.eliminados || [];
        for (const g of elims) {
            if (!_lastEliminados.includes(g)) { if (!isFrozen) sfxEliminado(); }
        }
        _lastEliminados = elims;
    }

    if (d.modo && d.modo !== _lastMode) {
        _lastMode = d.modo;
        if (d.modo !== "idle") {
            sfxModeActivate();
            aplicarTransicionModo('fade');
        }
    }
}

window.addEventListener("resize", () => {
    resizeCelebCanvas();
});

function setDesconectado() {
    const pip = document.getElementById("livePip");
    const lbl = document.getElementById("liveLabel");
    if (pip) pip.className = "live-pip";
    if (lbl) lbl.textContent = "Sin conexión";
}

// Estado de conexión visible (pastilla + overlay). Usa el monitor inline si
// existe; si no, actualiza los elementos directamente.
function setConexion(estado, texto, detalle) {
    if (typeof window.__setConn === "function") {
        window.__setConn(estado, texto, detalle);
    } else {
        const p = document.getElementById("connPill");
        const t = document.getElementById("connText");
        if (p) p.className = "conn-pill conn-" + estado;
        if (t && texto) t.textContent = texto;
        if (p && detalle) p.title = detalle;
    }
    const ro = document.getElementById("reconnectOverlay");
    if (ro) {
        const show = estado === "reconnect" || estado === "down";
        ro.classList.toggle("show", show);
        if (show) {
            const sub = ro.querySelector(".rc-sub");
            if (sub && detalle) sub.textContent = detalle;
        }
    }
}

let _sseRetardo = 1000;
let _sseReconnecting = false;
let _sseSource = null;

function _abortFetchStream() {
    if (window._sseFetchCtrl) {
        try { window._sseFetchCtrl.abort(); } catch (e) {}
        window._sseFetchCtrl = null;
    }
}

// Fallback de recepción vía fetch + ReadableStream. El heartbeat del panel de
// control ya usa fetch al mismo servidor y funciona en el navegador, así que
// este camino es fiable incluso cuando EventSource falla (webviews, proxies,
// cabeceras Connection: close, etc.).
function startFetchStream() {
    _abortFetchStream();
    if (window._sseSwitched !== true) window._sseSwitched = true;
    const ctrl = ("AbortController" in window) ? new AbortController() : null;
    window._sseFetchCtrl = ctrl;
    setConexion("reconnect", "Reconectando (datos)");
    const opts = { cache: "no-store", headers: { "Accept": "text/event-stream" } };
    if (ctrl) opts.signal = ctrl.signal;
    fetch(`${API}/stream`, opts)
        .then(function (resp) {
            if (!resp.ok || !resp.body) throw new Error("status " + resp.status);
            window.__sseConnected = true;
            setConexion("live", "En vivo", "");
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            function pump() {
                return reader.read().then(function (r) {
                    if (r.done) throw new Error("stream cerrado");
                    buf += decoder.decode(r.value, { stream: true });
                    let idx;
                    while ((idx = buf.indexOf("\n\n")) >= 0) {
                        const chunk = buf.slice(0, idx);
                        buf = buf.slice(idx + 2);
                        let ev = "message", data = "";
                        chunk.split("\n").forEach(function (line) {
                            if (line.startsWith("event:")) ev = line.slice(6).trim();
                            else if (line.startsWith("data:")) data += line.slice(5).trim();
                        });
                        if (!data) continue;
                        try {
                            const d = JSON.parse(data);
                            try {
                                procesarEstado(d);
                                setConexion("live", "En vivo", "");
                            } catch (err) {
                                console.error("fetch-SSE procesarEstado error:", err);
                                setConexion("live", "En vivo", "Error al renderizar: " + (err && err.message ? err.message : err));
                            }
                        } catch (e) { console.warn("fetch-SSE parse:", e); }
                    }
                    return pump();
                });
            }
            return pump();
        })
        .catch(function (err) {
            window._sseFetchCtrl = null;
            if (ctrl && ctrl.signal.aborted) return;
            setConexion("down", "Sin conexión", "Fallo de recepción (fetch): " + (err && err.message ? err.message : err));
            setTimeout(startFetchStream, 2500);
        });
}

function conectarSSE() {
    try {
        if (window._ruletaGlowInterval) { clearInterval(window._ruletaGlowInterval); window._ruletaGlowInterval = null; }
    } catch (e) { console.warn("SSE cleanup glow:", e); }
    try {
        if (window._ruletaDecelTimer) { clearTimeout(window._ruletaDecelTimer); window._ruletaDecelTimer = null; }
    } catch (e) { console.warn("SSE cleanup decel:", e); }
    try {
        if (window._ruletaCategoryTimeouts && window._ruletaCategoryTimeouts.length) {
            window._ruletaCategoryTimeouts.forEach(function(t) { clearTimeout(t); });
            window._ruletaCategoryTimeouts = [];
        }
    } catch (e) { console.warn("SSE cleanup category:", e); }
    try {
        if (window._ruletaLocalTimer) { clearInterval(window._ruletaLocalTimer); window._ruletaLocalTimer = null; }
    } catch (e) { console.warn("SSE cleanup local timer:", e); }
    try {
        if (window._ruletaResultTimeout) { clearTimeout(window._ruletaResultTimeout); window._ruletaResultTimeout = null; }
    } catch (e) { console.warn("SSE cleanup result:", e); }
    try {
        if (window._ruletaWordOverlayTimer) { clearTimeout(window._ruletaWordOverlayTimer); window._ruletaWordOverlayTimer = null; }
    } catch (e) { console.warn("SSE cleanup word overlay:", e); }
    try {
        if (window._pulseDividerT) { clearTimeout(window._pulseDividerT); window._pulseDividerT = null; }
    } catch (e) { console.warn("SSE cleanup pulse:", e); }
    try {
        if (window._verdictBannerTimer) { clearTimeout(window._verdictBannerTimer); window._verdictBannerTimer = null; }
    } catch (e) { console.warn("SSE cleanup verdict:", e); }
    window._ruletaInitialSync = true;
    window._ruletaUltimoId = -1;
    window._ruletaAnimPhase = "idle";
    window._ruletaGirando = false;
    _abortFetchStream();
    if (_sseSource) {
        try { _sseSource.close(); } catch (e) { console.warn("SSE close old:", e); }
        _sseSource = null;
    }
    let opened = false;
    let switched = false;
    const switchToFetch = () => {
        if (switched || opened) return;
        switched = true;
        try { src.close(); } catch (e) {}
        _sseSource = null;
        startFetchStream();
    };
    const src = new EventSource(`${API}/stream`);
    _sseSource = src;
    // Si EventSource no abre en 4s, usar el fallback fetch-stream.
    const fbTimer = setTimeout(() => { if (!opened) switchToFetch(); }, 4000);
    src.onopen = () => {
        opened = true;
        clearTimeout(fbTimer);
        _sseRetardo = 1000;
        window.__sseConnected = true;
        setConexion("live", "En vivo", "");
    };
    src.onmessage = (e) => {
        try {
            const d = JSON.parse(e.data);
            try {
                procesarEstado(d);
                if (window.__sseConnected) setConexion("live", "En vivo", "");
            } catch (err) {
                console.error("SSE procesarEstado error:", err);
                if (window.__sseConnected) setConexion("live", "En vivo", "Error al renderizar: " + (err && err.message ? err.message : err));
            }
        } catch (err) {
            console.warn("SSE parse:", err);
        }
    };
    src.addEventListener('state:snapshot', (e) => {
        try {
            const d = JSON.parse(e.data);
            try {
                procesarEstado(d);
                if (window.__sseConnected) setConexion("live", "En vivo", "");
            } catch (err) {
                console.error("SSE snapshot procesarEstado error:", err);
                if (window.__sseConnected) setConexion("live", "En vivo", "Error al renderizar: " + (err && err.message ? err.message : err));
            }
        } catch (err) {
            console.warn("SSE snapshot parse:", err);
        }
    });
    src.onerror = () => {
        if (_sseReconnecting) return;
        _sseReconnecting = true;
        const wasOpen = src.readyState > 0;
        src.close();
        if (_sseSource === src) _sseSource = null;
        if (wasOpen) setDesconectado();
        setConexion(wasOpen ? "reconnect" : "down", wasOpen ? "Reconectando" : "Sin conexión",
            wasOpen ? "Conexión perdida. Reintentando…" : "EventSource no conectó; usando fetch-stream.");
        // Si nunca llegó a abrir, cambiar directamente al fallback fetch.
        if (!wasOpen) { switchToFetch(); return; }
        const baseDelay = _sseRetardo;
        _sseRetardo = Math.min(_sseRetardo * 2, 30_000);
        const jitter = baseDelay * (0.8 + Math.random() * 0.4);
        setTimeout(() => { _sseReconnecting = false; conectarSSE(); }, jitter);
    };
}

if (localStorage.getItem("disableAnimations") === "true") {
    document.documentElement.classList.add("no-animations");
}
if (localStorage.getItem("kioskoMode") === "true") {
    document.body.classList.add("kiosko-mode");
}
window.addEventListener("storage", (e) => {
    if (e.key === "disableAnimations") {
        document.documentElement.classList.toggle(
            "no-animations",
            e.newValue === "true",
        );
    }
    if (e.key === "kioskoMode") {
        document.body.classList.toggle(
            "kiosko-mode",
            e.newValue === "true",
        );
    }
});
resizeCelebCanvas();
animCelebration();
(async () => {
    await loadCategories();
    conectarSSE();
})();

window.addEventListener("beforeunload", () => {
    if (_sseSource) {
        _sseSource.close();
        _sseSource = null;
    }
    if (window._ruletaResultTimeout)
        clearTimeout(window._ruletaResultTimeout);
    if (window._ruletaWordOverlayTimer)
        clearTimeout(window._ruletaWordOverlayTimer);
});

document.addEventListener(
    "click",
    () => {
        try {
            getAudioCtx().resume();
        } catch (e) { console.warn("display: audio resume error", e); }
    },
    { once: true },
);

const _Q_ANIMS = [
  { name: 'qSlideUp', weight: 30 },
  { name: 'qFlip3D', weight: 25 },
  { name: 'qScaleBounce', weight: 20 },
  { name: 'qSlideFromLeft', weight: 15 },
  { name: 'qGlitchReveal', weight: 10 },
];
const _Q_TOTAL_WEIGHT = _Q_ANIMS.reduce(function(s, a) { return s + a.weight; }, 0);
window._beforeQuestionVisible = function(qText) {
  if (qText.classList.contains('empty')) return;
  var r = Math.random() * _Q_TOTAL_WEIGHT, i = 0;
  for (var cum = 0; i < _Q_ANIMS.length; i++) {
    cum += _Q_ANIMS[i].weight;
    if (r <= cum) break;
  }
  var anim = _Q_ANIMS[i % _Q_ANIMS.length].name;
  qText.style.transition = 'none';
  qText.style.animation = anim + ' 0.7s ease-out forwards';
  qText.addEventListener('animationend', function _qEnd() {
    qText.style.animation = '';
    qText.style.transition = '';
    qText.removeEventListener('animationend', _qEnd);
  });
};

const _qIdTracker = { current: null };

const _origRQ = window.renderQuestion;
window.renderQuestion = function (
    p,
    mostrarResp,
    mostrarOpc,
    opcionSeleccionada,
) {
    if (typeof _origRQ !== 'function') {
        console.warn('quiz-renderer.js not loaded, skipping render');
        return;
    }
    const prevId = _qIdTracker.current;
    _origRQ(p, mostrarResp, mostrarOpc, opcionSeleccionada);
    const newId = window.currentQId;

    if (p && p.id && newId !== prevId) {
        setTimeout(() => {
            SM.triggerTextAppear();
            const scr = document.querySelector(".screen");
            if (scr) {
                scr.classList.remove("screen-glow");
                void scr.offsetWidth;
                scr.classList.add("screen-glow");
            }
        }, 420);
    }
    if (mostrarResp && p && p.respuesta) {
        setTimeout(() => SM.triggerAnswerShow(), 100);
    }
    _qIdTracker.current = newId;
};

const _origRT = renderTimerOrig;
window.renderTimer = function (t) {
    const prevActive = window._wasActive;
    const prevSec = window._lastTimerSec;
    _origRT(t);

    if (
        prevActive &&
        !t.activo &&
        prevSec <= 1 &&
        t.segundos_restantes === 0
    ) {
        SM.triggerTimerEnd();
    }

    if (
        t.activo &&
        t.segundos_restantes <= 5 &&
        t.segundos_restantes > 0
    ) {
        SM.triggerUrgent();
    }

    if (_localTimerTick) {
        clearInterval(_localTimerTick);
        _localTimerTick = null;
    }
    if (t.activo && t.segundos_restantes > 0) {
        let left = t.segundos_restantes;
        _localTimerTick = setInterval(() => {
            left--;
            const numEl = document.getElementById('timerNum');
            const badge = document.getElementById('timerBadge');
            if (numEl) {
                const urgent = left <= 5 && left > 0;
                numEl.textContent = left < 10 ? '0' + left : String(left);
                numEl.className = 'timer-num' + (urgent ? ' urgent' : ' active');
                if (badge) badge.classList.toggle('urgent', urgent);
            }
            if (left <= 5 && left > 0) {
                SM.triggerUrgent();
            }
            if (left <= 0 && _localTimerTick) {
                clearInterval(_localTimerTick);
                _localTimerTick = null;
            }
        }, 1000);
    }
};

console.log(
    "🔥 ShapeManager activo — 18 formas, 4 modos, entrada stamp, sombra drop-shadow",
);

export {
    API,
    loadCategories,
    lastAnimId,
    _lastOverlayReset,
    _localTimerTick,
    procesarEstado,
    conectarSSE,
};

