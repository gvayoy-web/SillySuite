class ShapeEngine {
    constructor(opts = {}) {
        this.maxShapes = opts.maxShapes || 18;
        this.active = [];
        this.mode = "idle";
        this._phLoop = null;
        this._spTm = null;
        this._burstTm = null;
        this._modeTo = null;
        this._urgent = false;
        this._activeTeamColor = null;
        this._palette = null;
        this._themeMode = null;

        this.modes = opts.modes || {
            idle: { spawnMs: 2500, burstEveryMs: 12000, burstCount: 2 },
            textAppear: { spawnMs: 350, burstCount: 5, durMs: 2500 },
            timerEnd: { spawnMs: 150, burstCount: 10, durMs: 3000 },
            answerShow: { spawnMs: 400, burstCount: 4, durMs: 2000 },
        };

        this._categories = {
            geometric: [
                "shape-star", "shape-cross", "shape-shield", "shape-tower",
                "shape-key", "shape-seal", "shape-spikeball", "shape-spikeball-2",
                "shape-stone", "shape-ark",
            ],
            organic: [
                "shape-dove", "shape-hand", "shape-heart", "shape-lamp",
                "shape-wings", "shape-lamb", "shape-fish", "shape-scroll",
                "shape-pray", "shape-cup",
            ],
            abstract: [
                "shape-spikeball", "shape-spikeball-2", "shape-crown",
                "shape-mountain", "shape-anchor", "shape-bread",
                "shape-trumpet", "shape-tower",
            ],
        };

        this._modeShapes = {
            roulette: ["shape-flame", "shape-star", "shape-crown", "shape-scroll"],
            fuego: ["shape-flame", "shape-hand", "shape-star", "shape-cup"],
            oceano: ["shape-fish", "shape-anchor", "shape-dove", "shape-stone"],
            battle: ["shape-sword", "shape-shield", "shape-crown", "shape-key"],
            survival: ["shape-anchor", "shape-shield", "shape-stone", "shape-mountain"],
            versos: ["shape-scroll", "shape-lamp", "shape-lamb", "shape-trumpet"],
            hangman: ["shape-hand", "shape-pray", "shape-heart", "shape-dove"],
            quizshow: ["shape-crown", "shape-star", "shape-trumpet", "shape-scroll"],
        };

        this._eventShapes = {
            correct: ["shape-star", "shape-crown", "shape-shield", "shape-key"],
            incorrect: ["shape-stone", "shape-anchor", "shape-spikeball"],
            record: ["shape-crown", "shape-star", "shape-seal", "shape-tower"],
            point: ["shape-star", "shape-scroll", "shape-cup"],
        };

        this._catWeights = { geometric: 0.34, organic: 0.33, abstract: 0.33 };
    }

    _readPalette() {
        try {
            const d = window.__themeData;
            let colors = [];
            if (d && d.colors) {
                const c = d.colors;
                colors = [c.primary, c.secondary, c.accent, c.surface, c.border, c.glow]
                    .filter(Boolean);
            }
            const cs = getComputedStyle(document.documentElement);
            const pickVar = (v, fb) => {
                const val = cs.getPropertyValue(v).trim();
                return val && val !== "initial" && val !== "none" ? val : fb;
            };
            if (!colors.length) {
                colors = [
                    pickVar("--custom-primary", null),
                    pickVar("--custom-accent", null),
                    pickVar("--custom-secondary", null),
                    pickVar("--accent", "#7c3aed"),
                    pickVar("--custom-glow", null),
                ].filter(Boolean);
            }
            if (!colors.length) colors = ["#7c3aed", "#db2777", "#0284c7", "#059669"];

            const root = this._hexToRgb(colors[0]) || [124, 58, 237];
            const auto = this._harmonize(root);
            this._palette = colors.concat(auto);
        } catch (e) {
            this._palette = ["#7c3aed", "#db2777", "#0284c7", "#059669"];
        }
    }

    _hexToRgb(hex) {
        if (!hex) return null;
        hex = hex.replace("#", "");
        if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
        if (hex.length !== 6) return null;
        const n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    _rgbToHex(r, g, b) {
        const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
        return "#" + h(r) + h(g) + h(b);
    }

    _hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        const f = (n) => {
            const k = (n + h * 12) % 12;
            const a = s * Math.min(l, 1 - l);
            return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
        };
        return [f(0) * 255, f(8) * 255, f(4) * 255];
    }

    _rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0; const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                default: h = (r - g) / d + 4;
            }
            h *= 60;
        }
        return [h, s * 100, l * 100];
    }

    _harmonize(rgb) {
        const [h, s, l] = this._rgbToHsl(rgb[0], rgb[1], rgb[2]);
        const out = [];
        const schemes = [-30, 30, 180, 120, -120, 210, -210];
        for (const off of schemes) {
            const c = this._hslToRgb((h + off + 360) % 360, Math.min(95, s + 8), Math.min(70, l + 12));
            out.push(this._rgbToHex(c[0], c[1], c[2]));
        }
        return out;
    }

    syncTheme() {
        const prev = this._palette ? this._palette.slice() : null;
        this._readPalette();
        const next = this._palette;
        if (!prev) return;
        for (const s of this.active) {
            if (s._teamLocked) continue;
            const idx = s._palIdx != null ? s._palIdx % next.length : 0;
            if (s.inner) s.inner.style.setProperty("background", next[idx], "important");
            s._palIdx = idx;
        }
    }

    setMode(mode) {
        if (this._modeTo) { clearTimeout(this._modeTo); this._modeTo = null; }
        this.mode = mode;
        const cfg = this.modes[mode] || this.modes.idle;
        if (mode === "idle") {
            this._respawn();
        } else {
            const guaranteed = mode === "textAppear" || mode === "timerEnd";
            this.burst(cfg.burstCount || 5, guaranteed);
            this._modeTo = setTimeout(() => this.setMode("idle"), cfg.durMs || 3000);
        }
        this._updateIntervals();
    }

    setTeamColor(color) {
        this._activeTeamColor = color;
        this.burst(8);
        this.active.forEach((s) => {
            if (s.inner) {
                s.inner.style.setProperty("background", color, "important");
                s._teamLocked = true;
            }
        });
    }

    triggerTextAppear() { this.setMode("textAppear"); }
    triggerTimerEnd() {
        this.setMode("timerEnd");
        const ov = document.getElementById("timerEndOverlay");
        if (ov) {
            const box = ov.querySelector(".timer-end-box");
            ov.classList.remove("show");
            void ov.offsetWidth;
            ov.classList.add("show");
            ov.style.opacity = "1";
            clearTimeout(ov._hideT);
            ov._hideT = setTimeout(() => {
                ov.classList.remove("show");
                ov.style.opacity = "0";
            }, 3500);
        }
    }
    triggerAnswerShow() { this.setMode("answerShow"); }

    triggerUrgent() {
        this._urgent = true;
        this.burst(5);
        this.active.forEach((s) => {
            if (s.inner && !s._urgentPulse) {
                s._origBg = s.inner.style.background || s.inner.style.backgroundColor || "";
                s.inner.style.transition = "background 0.2s";
                s.inner.style.background = "var(--red)";
                s._urgentPulse = true;
                setTimeout(() => {
                    if (s.inner) {
                        s.inner.style.background = s._origBg || "";
                        s._urgentPulse = false;
                    }
                }, 1000);
            }
        });
    }

    _pickShapeClass(kind, eventName) {
        if (kind === "mode" && this._themeMode) {
            const arr = this._modeShapes[this._themeMode];
            if (arr && arr.length) return arr[Math.floor(Math.random() * arr.length)];
        }
        if (kind === "event" && eventName && this._eventShapes[eventName]) {
            const arr = this._eventShapes[eventName];
            return arr[Math.floor(Math.random() * arr.length)];
        }
        const total = this._catWeights.geometric + this._catWeights.organic + this._catWeights.abstract;
        let r = Math.random() * total;
        let cat = "geometric";
        if ((r -= this._catWeights.geometric) < 0) cat = "geometric";
        else if ((r -= this._catWeights.organic) < 0) cat = "organic";
        else cat = "abstract";
        const arr = this._categories[cat];
        return arr[Math.floor(Math.random() * arr.length)];
    }

    spawn(opts = {}) {
        if (this.active.length >= this.maxShapes) return;
        if (!this._palette) this._readPalette();

        const el = document.createElement("div");
        el.className = "decor-item";

        const cls = opts.shapeClass || this._pickShapeClass(opts.kind, opts.event);
        const inner = document.createElement("div");
        inner.className = cls;

        const pal = this._palette;
        let color;
        if (opts.color) {
            color = opts.color;
        } else {
            const idx = Math.floor(Math.random() * pal.length);
            color = pal[idx];
            el._palIdx = idx;
        }
        if (color && inner.style) {
            inner.style.setProperty("background", color, "important");
        }

        el.appendChild(inner);

        let l, t;
        if (opts.force) {
            l = opts.force.l; t = opts.force.t;
        } else {
            for (let attempt = 0; attempt < 30; attempt++) {
                l = 2 + Math.random() * 86;
                t = 2 + Math.random() * 86;
                const lp = l / 100, tp = t / 100;
                const inTextArea = lp >= 0.05 && lp <= 0.95 && tp >= 0.22 && tp <= 0.68;
                const inScoreArea = tp >= 0.78;
                if (!inTextArea && !inScoreArea) break;
                if (attempt === 29) { l = 50; t = 5; }
            }
        }
        el.style.left = l + "%";
        el.style.top = t + "%";

        const mX = Math.random() * 200 - 100 + "px";
        const mY = Math.random() * -200 - 50 + "px";
        const rot = Math.random() * 360 - 180 + "deg";
        const scale = 0.4 + Math.random() * 0.7;

        el.style.setProperty("--moveX", mX);
        el.style.setProperty("--moveY", mY);
        el.style.setProperty("--rot", rot);
        el.style.setProperty("--scale", scale);

        const edge = Math.floor(Math.random() * 4);
        let eX, eY;
        const off = 300 + Math.random() * 400;
        switch (edge) {
            case 0: eX = `${(Math.random() - 0.5) * 60}px`; eY = `${-off}px`; break;
            case 1: eX = `${off}px`; eY = `${(Math.random() - 0.5) * 60}px`; break;
            case 2: eX = `${(Math.random() - 0.5) * 60}px`; eY = `${off}px`; break;
            default: eX = `${-off}px`; eY = `${(Math.random() - 0.5) * 60}px`;
        }
        el.style.setProperty("--enterX", eX);
        el.style.setProperty("--enterY", eY);

        const parent = document.getElementById("decorLayer") ||
            document.querySelector(".screen") || document.body;
        parent.appendChild(el);

        const life = 2500 + Math.random() * 3500;

        const obj = {
            el, inner, born: performance.now(), entryDone: false,
            phaseX: Math.random() * Math.PI * 2, phaseY: Math.random() * Math.PI * 2,
            phaseR: Math.random() * Math.PI * 2,
            freqX: 0.3 + Math.random() * 0.7, freqY: 0.3 + Math.random() * 0.7,
            freqR: 0.1 + Math.random() * 0.5,
            ampX: 2 + Math.random() * 6, ampY: 1 + Math.random() * 4, ampR: 1 + Math.random() * 4,
            baseTX: mX, baseTY: mY, baseRot: rot, baseScale: scale,
            _dead: false, _lifeTm: life, _palIdx: el._palIdx,
        };
        this.active.push(obj);
        if (!this._phLoop) this._phLoop = requestAnimationFrame(() => this._physics());

        requestAnimationFrame(() => el.classList.add("show"));

        const onAnimEnd = () => {
            el.removeEventListener("animationend", onAnimEnd);
            obj.entryDone = true;
            el.classList.add("show-done");
        };
        el.addEventListener("animationend", onAnimEnd);

        setTimeout(() => {
            obj._dead = true;
            el.style.opacity = "0";
            el.style.transition = "opacity 0.6s ease";
            setTimeout(() => el.remove(), 700);
            this.active = this.active.filter((x) => x !== obj);
        }, life);
    }

    burst(n, guaranteed = false, opts = {}) {
        if (guaranteed) {
            const maxBak = this.maxShapes;
            this.maxShapes += n + 10;
            for (let i = 0; i < n; i++) setTimeout(() => this.spawn(opts), i * 80);
            setTimeout(() => { this.maxShapes = maxBak; }, n * 80 + 100);
            return;
        }
        const limit = Math.min(n, this.maxShapes - this.active.length);
        for (let i = 0; i < limit; i++) setTimeout(() => this.spawn(opts), i * 80);
    }

    emitEvent(eventName, count = 6) {
        const cls = this._pickShapeClass("event", eventName);
        this.burst(count, true, { shapeClass: cls, kind: "event", event: eventName });
    }

    setThemeMode(modeKey) {
        this._themeMode = modeKey;
        if (modeKey) {
            const arr = this._modeShapes[modeKey];
            if (arr && arr.length) {
                const cls = arr[Math.floor(Math.random() * arr.length)];
                this.burst(4, true, { shapeClass: cls, kind: "mode" });
            }
        }
    }

    clearAll() {
        this.active.forEach((s) => {
            s._dead = true;
            s.el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
            s.el.style.opacity = "0";
            s.el.style.transform += " scale(0.1)";
            setTimeout(() => s.el.remove(), 400);
        });
        this.active = [];
    }

    _physics() {
        try {
            const now = performance.now();
            for (const s of this.active) {
                if (s._dead) continue;
                const age = (now - s.born) / 1000;
                const dx = Math.sin(age * s.freqX + s.phaseX) * s.ampX;
                const dy = Math.cos(age * s.freqY + s.phaseY) * s.ampY;
                const dr = Math.sin(age * s.freqR + s.phaseR) * s.ampR;
                const floatY = -Math.abs(Math.sin(age * 0.4)) * 6;
                if (s.entryDone) {
                    s.el.style.transform =
                        `translate(${s.baseTX}, ${s.baseTY}) ` +
                        `scale(${s.baseScale}) rotate(${s.baseRot}) ` +
                        `translate(${dx.toFixed(1)}px, ${(dy + floatY).toFixed(1)}px) rotate(${dr.toFixed(1)}deg)`;
                }
            }
            if (this.active.length > 0) {
                this._phLoop = requestAnimationFrame(() => this._physics());
            } else {
                this._phLoop = null;
            }
        } catch (e) {
            console.warn("ShapeEngine._physics:", e);
            if (this._phLoop) { cancelAnimationFrame(this._phLoop); this._phLoop = null; }
        }
    }

    _updateIntervals() {
        if (this._spTm) { clearInterval(this._spTm); this._spTm = null; }
        if (this._burstTm) { clearInterval(this._burstTm); this._burstTm = null; }
        const cfg = this.modes[this.mode] || this.modes.idle;
        this._spTm = setInterval(() => this.spawn(), cfg.spawnMs || 1200);
        if (cfg.burstEveryMs && cfg.burstCount) {
            this._burstTm = setInterval(() => this.burst(cfg.burstCount), cfg.burstEveryMs);
        }
    }

    _respawn() {
        const deficit = Math.floor(this.maxShapes * 0.4) - this.active.length;
        if (deficit > 0) this.burst(Math.min(deficit, 8));
    }

    start() {
        this._readPalette();
        this._updateIntervals();
        this._physics();
        this.burst(6);
    }
}

const SM = new ShapeEngine();
SM.start();

if (typeof window !== "undefined") {
    window.SM = SM;
}

export { ShapeEngine, SM };
