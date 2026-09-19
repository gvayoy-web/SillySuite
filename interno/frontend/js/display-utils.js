/** @param {string} s @returns {string} */
function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

let _audioCtx = null;
/** @returns {AudioContext} */
function getAudioCtx() {
    if (!_audioCtx) {
        try {
            _audioCtx = new (
                window.AudioContext || window.webkitAudioContext
            )();
        } catch (e) {
            console.warn('display: no audio context disponible', e);
        }
    }
    return _audioCtx;
}

/** */
/** @param {HTMLElement} el @param {string} text */
function adjustTextSize(el, text) {
    const len = (text || "").length;
    let fs;
    if (len <= 30) fs = "clamp(4rem, 8vw, 11rem)";
    else if (len <= 50) fs = "clamp(3.2rem, 6.5vw, 8rem)";
    else if (len <= 80) fs = "clamp(2.6rem, 5vw, 6rem)";
    else if (len <= 120) fs = "clamp(2rem, 4vw, 4.8rem)";
    else if (len <= 180) fs = "clamp(1.6rem, 3.2vw, 3.8rem)";
    else fs = "clamp(1.3rem, 2.6vw, 3rem)";
    el.style.fontSize = fs;
}

/** @param {HTMLElement} el @param {string} text */
function adjustOptTextSize(el, text) {
    const len = (text || "").length;
    let fs;
    if (len <= 20) fs = "clamp(24px, 4vw, 52px)";
    else if (len <= 35) fs = "clamp(20px, 3.2vw, 40px)";
    else if (len <= 55) fs = "clamp(17px, 2.6vw, 32px)";
    else if (len <= 80) fs = "clamp(14px, 2.2vw, 26px)";
    else fs = "clamp(12px, 1.8vw, 20px)";
    el.style.fontSize = fs;
}

let _typewriteTimer = null;
/** @param {HTMLElement} el @param {string} text @param {number} [speed] @param {Function} [callback] */
function typewriteText(el, text, speed = 120, callback) {
    if (_typewriteTimer) {
        clearTimeout(_typewriteTimer);
        _typewriteTimer = null;
    }
    if (!text) {
        el.textContent = "";
        el.classList.remove("typing");
        if (callback) callback();
        return;
    }
    el.textContent = "";
    el.classList.add("typing");
    el.style.textShadow = '0 0 10px rgba(255,255,255,0.3)';
    var total = text.length;
    var mid = Math.floor(total * 0.6);
    var i = 0;
    function tick() {
        if (i < total) {
            el.textContent += text.charAt(i);
            var prog = i / total;
            var spd;
            if (prog < 0.5) {
                spd = Math.max(20, speed * (1 - prog * 0.6));
            } else if (prog < 0.8) {
                spd = speed;
            } else {
                spd = speed + (prog - 0.8) * 3 * speed;
            }
            spd = Math.min(spd, 500);
            i++;
            if (i === mid) {
                el.style.transition = 'text-shadow 0.5s ease';
                el.style.textShadow = '0 0 20px rgba(255,255,255,0.5), 0 0 40px var(--glow)';
            }
            _typewriteTimer = setTimeout(tick, spd);
        } else {
            el.classList.remove("typing");
            el.style.textShadow = '';
            el.style.transition = '';
            _typewriteTimer = null;
            if (callback) callback();
        }
    }
    tick();
}

/** @param {HTMLElement} el @param {number} from @param {number} to @param {number} [duration] */
function animateCounter(el, from, to, duration = 500) {
    if (from === to) {
        el.textContent = to;
        return;
    }
    const start = performance.now();
    const delta = to - from;
    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + delta * eased);
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = to;
    }
    requestAnimationFrame(step);
  }

/** */
const PARTICLE_ICONS = ['✦','✧','◇','◆','+','·','⋆','⋅','✨','🙏','📖','🕊️','⭐'];

/** Rendimiento 3D acelerado con movimiento de partículas */
let _animFrameId = null;
let _lastTime = 0;
let _deltaTime = 0;
let _fps = 60;
let _frameTime = 1000 / _fps;
let _accumulatedTime = 0;


let _particlePool = [];
const MAX_PARTICLES = 500;

function spawnParticle() {
    if (_particlePool.length >= MAX_PARTICLES) return;
    const el = document.createElement('div');
    const size = 8 + Math.random() * 14;
    const left = Math.random() * 100;
    const duration = 6 + Math.random() * 5;
    const delay = Math.random() * 2;
    const swayAmount = 20 + Math.random() * 40;
    const icon = PARTICLE_ICONS[Math.floor(Math.random() * PARTICLE_ICONS.length)];
    el.style.cssText = `position:fixed;bottom:-30px;z-index:5;pointer-events:none;font-size:${size}px;opacity:0;left:${left}vw;animation:particleRise2 ${duration}s ease-in-out ${delay}s forwards;--sway:${swayAmount}px;`;
    el.textContent = icon;
    document.body.appendChild(el);
    _particlePool.push(el);
    const removeId = setTimeout(() => {
        el.remove();
        const idx = _particlePool.indexOf(el);
        if (idx >= 0) _particlePool.splice(idx, 1);
    }, (duration + delay) * 1000 + 500);
    el._removeT = removeId;
}

function clearParticlePool() {
    _particlePool.forEach(el => {
        if (el._removeT) clearTimeout(el._removeT);
        el.remove();
    });
    _particlePool = [];
}

(function() {
    var style = document.createElement('style');
    style.textContent = '@keyframes particleRise{0%{transform:translateY(0) rotate(0deg);opacity:0}10%{opacity:1}90%{opacity:0.5}100%{transform:translateY(-100vh) rotate(360deg);opacity:0}} @keyframes particleRise2{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0}10%{opacity:0.25}30%{transform:translateY(-33vh) translateX(calc(var(--sway,30px) * 0.3)) rotate(120deg);opacity:0.35}60%{transform:translateY(-66vh) translateX(calc(var(--sway,30px) * -0.4)) rotate(240deg);opacity:0.25}100%{transform:translateY(-105vh) translateX(calc(var(--sway,30px) * 0.2)) rotate(360deg);opacity:0}}';
    document.head.appendChild(style);
})();

export {
    esc,
    getAudioCtx,
    adjustTextSize,
    adjustOptTextSize,
    typewriteText,
    animateCounter,
    spawnParticle,
    clearParticlePool,
    showToast,
};

/** @param {string} msg @param {number} [duration] */
function showToast(msg, duration = 3000) {
    let el = document.getElementById("displayToast");
    if (!el) {
        el = document.createElement("div");
        el.id = "displayToast";
        el.style.cssText = "position:fixed;bottom:40px;left:50%;transform:translateX(-50%) translateY(20px);z-index:9999;background:#000;color:#fff;padding:14px 28px;border:4px solid #fff;font-weight:900;font-size:1.2rem;text-transform:uppercase;opacity:0;transition:all 0.35s cubic-bezier(0.34,1.56,0.64,1);box-shadow:8px 8px 0 #000;";
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.transform = "translateX(-50%) translateY(0)";
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
        el.style.transform = "translateX(-50%) translateY(20px)";
        el.style.opacity = "0";
    }, duration);
}
