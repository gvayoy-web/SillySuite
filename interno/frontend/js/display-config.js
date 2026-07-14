class ThemeEngine {
    constructor() {
        this._lastMode = 'default';
        this._eventTimers = {};
        this._currentTheme = null;
        this._transitioning = false;
    }

    apply(theme) {
        if (!theme) return;
        this._currentTheme = theme;
        const root = document.documentElement;
        const c = theme.colors || {};
        const t = theme.typography || {};
        const tm = theme.timer || {};
        const l = theme.layout || {};
        const s = theme.shapes || {};
        const e = theme.effects || {};

        this._setVar(root, '--custom-primary', c.primary);
        this._setVar(root, '--custom-secondary', c.secondary);
        this._setVar(root, '--custom-accent', c.accent);
        this._setVar(root, '--custom-surface', c.surface);
        this._setVar(root, '--custom-border', c.border);
        this._setVar(root, '--custom-glow', c.glow);
        this._setVar(root, '--custom-bg-gradient', c.bg_gradient);
        this._setVar(root, '--custom-brightness', e.intensity != null ? (e.intensity * 100) + '%' : null);
        this._setVar(root, '--custom-border-radius', l.scores_height ? Math.round(l.scores_height / 25) + 'px' : null);

        this._setVar(root, '--custom-font-heading', t.heading_font);
        this._setVar(root, '--custom-font-body', t.body_font);
        this._setVar(root, '--custom-font-timer', t.timer_font);
        this._setVar(root, '--custom-font-score', t.score_font);
        this._setVar(root, '--custom-font-size-scale', t.size_scale != null ? t.size_scale : null);
        this._setVar(root, '--custom-text-shadow', t.text_shadow ? '0 0 30px var(--accent)' : 'none');
        this._setVar(root, '--custom-text-glow', t.text_glow ? '0 0 20px var(--accent)' : 'none');

        this._setVar(root, '--custom-timer-style', tm.style);
        this._setVar(root, '--custom-timer-pos-x', tm.position_x != null ? tm.position_x + '%' : this._timerPosX(tm.position));
        this._setVar(root, '--custom-timer-pos-y', tm.position_y != null ? tm.position_y + '%' : this._timerPosY(tm.position));
        this._setVar(root, '--custom-timer-size', this._timerSize(tm.size));
        const tmc = tm.colors || {};
        this._setVar(root, '--custom-timer-color-bg', tmc.background);
        this._setVar(root, '--custom-timer-color-text', tmc.text);
        this._setVar(root, '--custom-timer-color-progress', tmc.progress);
        this._setVar(root, '--custom-timer-color-glow', tmc.glow);
        this._setVar(root, '--custom-timer-color-urgent', tmc.urgent);
        this._setVar(root, '--custom-timer-animation', tm.animation);

        this._setVar(root, '--custom-scores-position', l.scores_position);
        this._setVar(root, '--custom-header-display', l.header_style === 'hidden' ? 'none' : 'flex');
        this._setVar(root, '--custom-logo-display', l.logo_visible !== false ? 'block' : 'none');
        this._setVar(root, '--custom-decorations-display', l.decorations_visible !== false ? 'block' : 'none');
        this._setVar(root, '--custom-scores-height', l.scores_height ? l.scores_height + 'px' : null);

        this._setVar(root, '--custom-shape-opacity', s.opacity != null ? s.opacity : null);
        this._setVar(root, '--custom-shape-speed', s.spawn_rate ? Math.round(2500 / s.spawn_rate * 100) / 100 : null);
        this._setVar(root, '--custom-shape-count', s.max_count);
        this._setVar(root, '--custom-shape-behavior', s.behavior);

        document.body.classList.add('theme-custom');
    }

    applyLegacy(customTheme) {
        if (!customTheme) return;
        const root = document.documentElement;
        if (customTheme.primary) root.style.setProperty('--custom-primary', customTheme.primary);
        if (customTheme.secondary) root.style.setProperty('--custom-secondary', customTheme.secondary);
        if (customTheme.accent) root.style.setProperty('--custom-accent', customTheme.accent);
        if (customTheme.brightness !== undefined) root.style.setProperty('--custom-brightness', customTheme.brightness + '%');
        if (customTheme.saturation !== undefined) root.style.setProperty('--custom-saturation', customTheme.saturation + '%');
        if (customTheme.bg_opacity !== undefined) root.style.setProperty('--custom-bg-opacity', customTheme.bg_opacity + '%');
        if (customTheme.border_radius !== undefined) root.style.setProperty('--custom-border-radius', customTheme.border_radius + 'px');
        if (customTheme.animation_speed !== undefined) root.style.setProperty('--custom-animation-speed', customTheme.animation_speed);
        document.body.classList.add('theme-custom');
    }

    clear() {
        const root = document.documentElement;
        const props = [
            '--custom-primary', '--custom-secondary', '--custom-accent', '--custom-surface', '--custom-border', '--custom-glow', '--custom-bg-gradient',
            '--custom-brightness', '--custom-saturation', '--custom-bg-opacity', '--custom-border-radius', '--custom-animation-speed',
            '--custom-font-heading', '--custom-font-body', '--custom-font-timer', '--custom-font-score', '--custom-font-size-scale',
            '--custom-text-shadow', '--custom-text-glow',
            '--custom-timer-style', '--custom-timer-pos-x', '--custom-timer-pos-y', '--custom-timer-size',
            '--custom-timer-color-bg', '--custom-timer-color-text', '--custom-timer-color-progress', '--custom-timer-color-glow', '--custom-timer-color-urgent', '--custom-timer-animation',
            '--custom-scores-position', '--custom-header-display', '--custom-logo-display', '--custom-decorations-display', '--custom-scores-height',
            '--custom-shape-opacity', '--custom-shape-speed', '--custom-shape-count', '--custom-shape-behavior',
        ];
        props.forEach(p => root.style.removeProperty(p));
        this._currentTheme = null;
    }

    transitionTo(theme, duration) {
        if (this._transitioning) return;
        this._transitioning = true;
        const dur = duration || 600;

        document.body.classList.add('theme-transition');
        document.body.classList.add('theme-fade');

        if (theme) {
            this.apply(theme);
        } else {
            this.clear();
        }

        setTimeout(() => {
            document.body.classList.remove('theme-fade');
        }, dur);

        setTimeout(() => {
            document.body.classList.remove('theme-transition');
            this._transitioning = false;
        }, dur + 200);
    }

    applyTema(d) {
        document.body.className.split(/\s+/).forEach(cls => {
            if (cls.startsWith('theme-')) document.body.classList.remove(cls);
        });

        const theme = d.display_config?.theme || 'default';
        if (theme !== 'default') document.body.classList.add('theme-' + theme);

        const modo = d.modo_activo || 'default';
        if (modo !== 'default' && modo !== theme) {
            document.body.classList.add('theme-' + modo);
        }
        this._lastMode = modo;

        const cfg = d.display_config;
        if (!cfg) return;

        if (cfg.preview_theme) {
            this.apply(cfg.preview_theme);
        } else if (cfg.theme_slug) {
            this._fetchAndApply(cfg.theme_slug);
        } else if (cfg.custom_theme && (cfg.theme === 'default' || !cfg.theme)) {
            this.applyLegacy(cfg.custom_theme);
        }
    }

    _fetchAndApply(slug) {
        if (this._fetchingSlug === slug) return;
        this._fetchingSlug = slug;
        fetch(window.location.origin + '/api/themes/' + slug)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && data.colors) {
                    window.__themeData = data;
                    this.apply(data);
                }
                this._fetchingSlug = null;
            })
            .catch(() => { this._fetchingSlug = null; });
    }

    actualizarDisplayConfig(d) {
        if (!d.display_config) return;
        var cfg = d.display_config;

        var bs = document.getElementById("blackScreen");
        if (cfg.black_screen) { bs.classList.add("show"); } else { bs.classList.remove("show"); }

        var fi = document.getElementById("frozenIndicator");
        if (fi) fi.classList.toggle("show", !!cfg.frozen);

        document.body.classList.toggle("clean-mode", !!cfg.clean);
        document.body.classList.toggle("kiosko-mode", !!cfg.kiosko);
        document.body.classList.toggle("screen-shake-disabled", !cfg.screen_shake);

        var frb = document.getElementById("finalRoundBadge");
        if (frb) frb.style.display = cfg.final_round ? "" : "none";

        var fro = document.getElementById("finalResultsOverlay");
        if (fro) fro.classList.toggle("show", !!cfg.final_results);

        document.body.classList.toggle("scanline-on", !!cfg.scanline);

        document.querySelectorAll('.live-pip').forEach(function(p) {
            p.classList.toggle("on", cfg.sound !== false);
        });
    }

    onEvent(evento, duracion) {
        duracion = duracion || 1000;
        this._clearEvent(evento);
        document.body.classList.add('event-' + evento);
        this._eventTimers[evento] = setTimeout(() => {
            document.body.classList.remove('event-' + evento);
            delete this._eventTimers[evento];
        }, duracion);
    }

    _clearEvent(evento) {
        if (this._eventTimers[evento]) {
            clearTimeout(this._eventTimers[evento]);
            delete this._eventTimers[evento];
        }
        document.body.classList.remove('event-' + evento);
    }

    clearAllEvents() {
        Object.keys(this._eventTimers).forEach(ev => {
            clearTimeout(this._eventTimers[ev]);
        });
        this._eventTimers = {};
        var classes = document.body.className.split(/\s+/);
        var keep = classes.filter(c => !c.startsWith('event-'));
        document.body.className = keep.join(' ');
    }

    _setVar(root, name, value) {
        if (value !== undefined && value !== null && value !== '') {
            root.style.setProperty(name, String(value));
        }
    }

    _timerPosX(position) {
        const map = { tl: '5%', tr: 'auto', tc: '50%', bl: '5%', br: 'auto', bc: '50%', c: '50%' };
        return map[position] || 'auto';
    }

    _timerPosY(position) {
        const map = { tl: '5%', tr: '5%', tc: '5%', bl: 'auto', br: 'auto', bc: 'auto', c: '50%' };
        return map[position] || '5%';
    }

    _timerSize(size) {
        const map = { small: '60px', medium: '80px', large: '120px', xlarge: '160px' };
        return map[size] || size || '80px';
    }
}

const themeEngine = new ThemeEngine();

function aplicarTema(d) { themeEngine.applyTema(d); }
function actualizarDisplayConfig(d) { themeEngine.actualizarDisplayConfig(d); }
function aplicarCustomTheme(t) { themeEngine.applyLegacy(t); }
function clearCustomTheme() { themeEngine.clear(); }
function aplicarEventoTema(evento, duracion) { themeEngine.onEvent(evento, duracion); }
function limpiarEventoTema(evento) { themeEngine._clearEvent(evento); }
function limpiarTodosLosEventos() { themeEngine.clearAllEvents(); }
function aplicarTransicionTema(tipo) { themeEngine.transitionTo(null); }
function aplicarTransicionModo(tipo) { document.body.classList.add('mode-transition'); document.body.classList.add('mode-' + tipo); setTimeout(() => { document.body.classList.remove('mode-' + tipo); }, 800); setTimeout(() => { document.body.classList.remove('mode-transition'); }, 1000); }

function onHangmanError(intentosUsados) {
    for (let i = 1; i <= 6; i++) themeEngine._clearEvent('hangman-' + i);
    for (let i = 1; i <= intentosUsados; i++) themeEngine.onEvent('hangman-' + i, 999999);
}
function onCorrectAnswer() { themeEngine.onEvent('correct', 800); if (window.SM && window.SM.emitEvent) window.SM.emitEvent('correct', 6); }
function onIncorrectAnswer() { themeEngine.onEvent('incorrect', 500); if (window.SM && window.SM.emitEvent) window.SM.emitEvent('incorrect', 5); }
function onRoundFinal() { document.body.classList.add('event-round-final'); }
function offRoundFinal() { document.body.classList.remove('event-round-final'); }
function onPenalty() { themeEngine.onEvent('penalty', 1000); }
function onStreak(count) { themeEngine._clearEvent('streak-3'); themeEngine._clearEvent('streak-5'); if (count >= 5) { document.body.classList.add('event-streak-5'); } else if (count >= 3) { document.body.classList.add('event-streak-3'); } }
function offStreak() { themeEngine._clearEvent('streak-3'); themeEngine._clearEvent('streak-5'); }
function onTimerLow() { document.body.classList.add('event-timer-low'); }
function offTimerLow() { document.body.classList.remove('event-timer-low'); }
function onTimerZero() { themeEngine.onEvent('timer-zero', 2000); }
function onRecord() { themeEngine.onEvent('record', 3000); if (window.SM && window.SM.emitEvent) window.SM.emitEvent('record', 8); }
function onHardQuestion() { themeEngine.onEvent('hard-question', 2500); var banner = document.getElementById('hardQuestionBanner'); if (banner) { banner.classList.add('show'); setTimeout(function() { banner.classList.remove('show'); }, 2500); } }
function onEpicCorrect() { var overlay = document.getElementById('epicCorrectOverlay'); if (overlay) { overlay.classList.add('show'); setTimeout(function() { overlay.classList.remove('show'); }, 1200); } }
function onFreezeVisual() { themeEngine.onEvent('freeze-visual', 2000); var text = document.getElementById('freezeText'); if (text) { text.classList.add('show'); setTimeout(function() { text.classList.remove('show'); }, 2000); } }
function setThemeData(themeObj) { window.__themeData = themeObj; }

const MODE_THEMES = {
    default: { bg: '#0038ff', surface: '#fff', accent: '#7C3AED', glow: 'rgba(124,58,237,0.3)' },
    roulette: { bg: '#1a0000', surface: '#2a0000', accent: '#ffd700', glow: 'rgba(255,215,0,0.4)' },
    versos: { bg: '#000033', surface: '#000044', accent: '#ffd700', glow: 'rgba(255,215,0,0.3)' },
    hangman: { bg: '#1a1a2e', surface: '#16213e', accent: '#e94560', glow: 'rgba(233,69,96,0.5)' },
    battle: { bg: '#1a0a00', surface: '#2a1500', accent: '#ff4400', glow: 'rgba(255,68,0,0.5)' },
    survival: { bg: '#0a1a0a', surface: '#152a15', accent: '#00ff44', glow: 'rgba(0,255,68,0.4)' },
    quizshow: { bg: '#1a0a1a', surface: '#2a152a', accent: '#ff00ff', glow: 'rgba(255,0,255,0.4)' },
};
const CUSTOM_PRESETS = {
    starry: { primary: '#0a0e27', secondary: '#e0e7ff', accent: '#818cf8', brightness: 60 },
    forest: { primary: '#064e3b', secondary: '#d1fae5', accent: '#34d399', brightness: 70 },
    sunset: { primary: '#7c2d12', secondary: '#fef3c7', accent: '#f59e0b', brightness: 80 },
    rain: { primary: '#1e293b', secondary: '#cbd5e1', accent: '#64748b', brightness: 50 },
    bluefire: { primary: '#1e3a5f', secondary: '#bfdbfe', accent: '#3b82f6', brightness: 75 },
    royalty: { primary: '#4c1d95', secondary: '#ede9fe', accent: '#a78bfa', brightness: 65 },
    neon: { primary: '#000000', secondary: '#00ff00', accent: '#ff00ff', brightness: 100 },
    paper: { primary: '#fefce8', secondary: '#1c1917', accent: '#dc2626', brightness: 90 },
};

if (typeof window !== 'undefined') {
    window.themeEngine = themeEngine;
}

export {
    themeEngine, ThemeEngine,
    actualizarDisplayConfig, MODE_THEMES, CUSTOM_PRESETS,
    aplicarTema, aplicarCustomTheme, clearCustomTheme,
    aplicarEventoTema, limpiarEventoTema, limpiarTodosLosEventos,
    aplicarTransicionTema, aplicarTransicionModo,
    onHangmanError, onCorrectAnswer, onIncorrectAnswer,
    onRoundFinal, offRoundFinal, onPenalty, onStreak, offStreak,
    onTimerLow, offTimerLow, onTimerZero, onRecord,
    onHardQuestion, onEpicCorrect, onFreezeVisual,
    setThemeData
};
