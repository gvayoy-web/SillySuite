let _ctx = null;
let _muted = false;

function ctx() {
    if (_muted) return null;
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

function play(freq, dur, type, vol, ramp) {
    const c = ctx();
    if (!c) return;
    try {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = type || 'sine'; o.frequency.value = freq;
        const start = c.currentTime;
        g.gain.setValueAtTime(vol || 0.15, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + (ramp || dur));
        o.start(start); o.stop(start + (ramp || dur));
    } catch (e) { console.warn('audio:', e); }
}

const TEAM_SFX = [
    { point: [523, 659, 784, 1047], penalty: [400, 350, 300, 250] },
    { point: [440, 554, 659, 880],   penalty: [350, 300, 250, 200] },
    { point: [392, 494, 587, 784],   penalty: [300, 250, 200, 150] },
    { point: [587, 740, 880, 1175],  penalty: [450, 400, 350, 300] },
];

function groupSfx(grupo) {
    const idx = window.GRUPOS ? window.GRUPOS.findIndex(g => g.key === grupo) : -1;
    return TEAM_SFX[idx >= 0 ? idx % TEAM_SFX.length : -1] || null;
}

function noise(dur, vol) {
    const c = ctx();
    if (!c) return;
    try {
        const sr = c.sampleRate, len = sr * dur;
        const buf = c.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource(), g = c.createGain();
        src.buffer = buf; src.connect(g); g.connect(c.destination);
        const start = c.currentTime;
        g.gain.setValueAtTime(vol || 0.1, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur);
        src.start(start); src.stop(start + dur);
    } catch (e) { console.warn('audio:', e); }
}

function freqRamp(f0, f1, dur, type, vol) {
    const c = ctx();
    if (!c) return;
    try {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = type || 'sawtooth';
        const start = c.currentTime;
        o.frequency.setValueAtTime(f0, start);
        o.frequency.exponentialRampToValueAtTime(f1, start + dur);
        g.gain.setValueAtTime(vol || 0.12, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur);
        o.start(start); o.stop(start + dur);
    } catch (e) { console.warn('audio:', e); }
}

// ── Procedural fallbacks (used when no custom audio is mapped) ──

function _proc_correct() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.value = f;
        const s = t + i * 0.1;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.12, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
        o.start(s); o.stop(s + 0.35);
    });
}

function _proc_incorrect() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [180, 140].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), f2 = c.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(f2); f2.connect(g); g.connect(c.destination);
        f2.type = 'lowpass'; f2.frequency.value = 400;
        const s = t + i * 0.25;
        g.gain.setValueAtTime(0.1, s);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.3);
        o.start(s); o.stop(s + 0.3);
    });
}

function _proc_point(grupo) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const sfx = groupSfx(grupo);
    const notes = sfx ? sfx.point : [1200, 1500, 1800];
    notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.value = f;
        const s = t + i * 0.06;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.1, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.2);
        o.start(s); o.stop(s + 0.2);
    });
}

function _proc_penalty(cantidad = 10, grupo) {
    const severity = Math.min(Math.abs(cantidad) / 10, 6);
    const sfx = groupSfx(grupo);
    const notes = sfx ? sfx.penalty : [200, 200, 200, 200];
    if (severity >= 3) {
        notes.forEach((f, i) => {
            setTimeout(() => freqRamp(f * 0.5, f * 0.3, 0.3, 'sawtooth', 0.1), i * 120);
        });
    } else if (severity >= 1.5) {
        notes.slice(0, 3).forEach((f, i) => {
            setTimeout(() => play(f * 0.6, 0.25, 'square', 0.08), i * 100);
        });
    } else {
        play(notes[0] * 0.5, 0.3, 'sawtooth', 0.1);
    }
}

function _proc_genericTone(freq, dur, type, vol) {
    play(freq, dur, type, vol);
}

function _proc_finalRound() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.value = f;
        const s = t + i * 0.15;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.13, s + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
        o.start(s); o.stop(s + 0.35);
    });
}

function _proc_podium() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const fanfare = [[523,0.25,0],[659,0.25,0.2],[784,0.25,0.4],[1047,0.5,0.6],[784,0.2,1.0],[1047,0.6,1.15]];
    fanfare.forEach(([f, dur, delay]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'triangle'; o.frequency.value = f;
        const s = t + delay;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.12, s + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, s + dur);
        o.start(s); o.stop(s + dur);
    });
}

function _proc_eliminado() {
    freqRamp(600, 100, 0.8, 'sawtooth', 0.12);
    setTimeout(() => freqRamp(400, 60, 0.6, 'square', 0.08), 100);
}

function _proc_overtake() {
    const c = ctx(); if (!c) return;
    [400, 600, 800, 1000, 1200].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'triangle'; o.frequency.value = f;
        const s = c.currentTime + i * 0.04;
        g.gain.setValueAtTime(0.08, s);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.15);
        o.start(s); o.stop(s + 0.15);
    });
}

function _proc_roundStart() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [440, 554, 659, 880].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'triangle'; o.frequency.value = f;
        const s = t + i * 0.2;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.1, s + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.3);
        o.start(s); o.stop(s + 0.3);
    });
}

function _proc_modeActivate() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    [440, 554, 880].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.value = f;
        const s = t + i * 0.1;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.1, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.25);
        o.start(s); o.stop(s + 0.25);
    });
}

function _proc_urgentTick() {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = 'triangle'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.start(t); o.stop(t + 0.06);
    noise(0.04, 0.04);
}

const _FALLBACKS = {
    new_question: () => { play(660, 0.12, 'sine', 0.08); setTimeout(() => play(880, 0.1, 'sine', 0.06), 80); },
    correct: _proc_correct,
    incorrect: _proc_incorrect,
    point: (a) => _proc_point(a && a[0]),
    penalty: (a) => _proc_penalty(a && a[0], a && a[1]),
    timer_start: () => { play(880, 0.15, 'sine', 0.12); setTimeout(() => play(1100, 0.12, 'sine', 0.08), 100); },
    tick: () => play(1000, 0.04, 'sine', 0.06),
    urgent_tick: _proc_urgentTick,
    timeout: () => freqRamp(440, 80, 0.6, 'sawtooth', 0.15),
    final_round: _proc_finalRound,
    podium: _proc_podium,
    eliminado: _proc_eliminado,
    overtake: _proc_overtake,
    round_start: _proc_roundStart,
    mode_activate: _proc_modeActivate,
    countdown_3: () => play(523, 0.2, 'sine', 0.1),
    countdown_2: () => play(659, 0.2, 'sine', 0.1),
    countdown_1: () => play(784, 0.2, 'sine', 0.12),
    countdown_go: () => { const c = ctx(); if (!c) return; const t = c.currentTime; [1047,1319,1568].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.type='sine';o.frequency.value=f;const s=t+i*0.05;g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(0.15,s+0.02);g.gain.exponentialRampToValueAtTime(0.001,s+0.3);o.start(s);o.stop(s+0.3);}); },
};

// ── SoundEngine: mixer + custom audio mapping + procedural fallback ──

export const SoundEngine = {
    _library: {},
    _map: { events: {}, modes: {}, background: null, channels: { sfx: 1, music: 1, ambient: 1, voice: 1 }, muted: false, enabled: true },
    _mode: 'default',
    _bgAudio: null,
    _bgKey: null,

    setLibrary(list) {
        this._library = {};
        (list || []).forEach(m => { this._library[m.id] = '/api/sounds/' + m.id; });
    },

    setMap(map) {
        if (!map) return;
        this._map = Object.assign({
            events: {}, modes: {}, background: null,
            channels: { sfx: 1, music: 1, ambient: 1, voice: 1 }, muted: false, enabled: true
        }, map);
        this._applyMuted();
        this._applyBackground();
    },

    setMode(mode) { this._mode = mode || 'default'; },

    setMuted(v) {
        _muted = !!v;
        this._map.muted = _muted;
        this._applyMuted();
    },

    isMuted() { return _muted; },

    setChannelVolume(ch, vol) {
        if (this._map.channels && ch in this._map.channels) {
            this._map.channels[ch] = vol;
            if (ch === 'music' && this._bgAudio) this._bgAudio.volume = vol * (this._map.background ? this._map.background.volume : 1);
        }
    },

    _applyMuted() {
        if (this._map.muted) this._stopBackground();
    },

    _stopBackground() {
        if (this._bgAudio) {
            try { this._bgAudio.pause(); this._bgAudio.src = ''; } catch (e) {}
            this._bgAudio = null;
        }
        this._bgKey = null;
    },

    _applyBackground() {
        const bg = this._map.background;
        const key = bg && bg.id ? (bg.id + '|' + (bg.loop !== false)) : null;
        if (key === this._bgKey && this._bgAudio) {
            this._bgAudio.volume = (this._map.channels.music || 1) * (bg.volume != null ? bg.volume : 1);
            return;
        }
        this._stopBackground();
        this._bgKey = key;
        if (!bg || !bg.id || this._map.muted || !this._map.enabled) return;
        const url = this._library[bg.id];
        if (!url) return;
        const a = new Audio(url);
        a.loop = bg.loop !== false;
        a.volume = (this._map.channels.music || 1) * (bg.volume != null ? bg.volume : 1);
        a.addEventListener('error', () => { this._bgAudio = null; });
        a.play().then(() => { this._bgAudio = a; }).catch(() => { this._bgAudio = a; });
    },

    _resolveId(eventKey) {
        let id = this._map.events ? this._map.events[eventKey] : null;
        const modeMap = this._map.modes ? this._map.modes[this._mode] : null;
        if (modeMap && modeMap[eventKey]) id = modeMap[eventKey];
        return id || null;
    },

    play(eventKey, args) {
        if (!this._map.enabled) {
            const fb = _FALLBACKS[eventKey];
            if (fb) fb(args);
            return;
        }
        if (this._map.muted) return;
        const id = this._resolveId(eventKey);
        const url = id ? this._library[id] : null;
        if (url) {
            try {
                const a = new Audio(url);
                a.volume = this._map.channels.sfx != null ? this._map.channels.sfx : 1;
                a.play().catch(() => {});
            } catch (e) {}
        } else {
            const fb = _FALLBACKS[eventKey];
            if (fb) fb(args);
        }
    },
};

export function setMuted(v) { SoundEngine.setMuted(v); }
export function isMuted() { return SoundEngine.isMuted(); }

// ── Public sfx* API (kept for existing callers) ──

export function sfxNewQuestion() { SoundEngine.play('new_question'); }
export function sfxCorrect() { SoundEngine.play('correct'); }
export function sfxIncorrect() { SoundEngine.play('incorrect'); }
export function sfxPoint(grupo) { SoundEngine.play('point', [grupo]); }
export function sfxPenalty(cantidad = 10, grupo) { SoundEngine.play('penalty', [cantidad, grupo]); }
export function sfxTimerStart() { SoundEngine.play('timer_start'); }
export function sfxTick() { SoundEngine.play('tick'); }
export function sfxUrgentTick() { SoundEngine.play('urgent_tick'); }
export function sfxTimeOut() { SoundEngine.play('timeout'); }
export function sfxFinalRound() { SoundEngine.play('final_round'); }
export function sfxPodium() { SoundEngine.play('podium'); }
export function sfxEliminado() { SoundEngine.play('eliminado'); }
export function sfxOvertake() { SoundEngine.play('overtake'); }
export function sfxRoundStart() { SoundEngine.play('round_start'); }
export function sfxModeActivate() { SoundEngine.play('mode_activate'); }
export function sfxCountdown3() { SoundEngine.play('countdown_3'); }
export function sfxCountdown2() { SoundEngine.play('countdown_2'); }
export function sfxCountdown1() { SoundEngine.play('countdown_1'); }
export function sfxCountdownGo() { SoundEngine.play('countdown_go'); }
