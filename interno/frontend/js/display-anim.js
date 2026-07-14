import { sfxPoint, sfxPenalty, sfxOvertake } from './display-sound.js';
import { SUBS, PENALTY_SUBS } from './display-scores.js';
import { SM } from './display-shapes2.js';

/** @param {HTMLElement} cardEl @param {string} color */
function spawnCardParticles(cardEl, color) {
    const rect = cardEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 12; i++) {
        const p = document.createElement("div");
        p.style.cssText = `
      position:fixed; z-index:390; pointer-events:none;
      width:${6 + Math.random() * 8}px; height:${6 + Math.random() * 8}px;
      background:${color}; border:2px solid #000;
      left:${cx}px; top:${cy}px;
    `;
        document.body.appendChild(p);
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 120;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 40;
        p.animate(
            [
                {
                    transform:
                        "translate(0,0) scale(1) rotate(0deg)",
                    opacity: 1,
                },
                {
                    transform: `translate(${dx}px,${dy}px) scale(0) rotate(${Math.random() * 360}deg)`,
                    opacity: 0,
                },
            ],
            {
                duration: 500 + Math.random() * 300,
                easing: "cubic-bezier(0.175,0.885,0.32,1.275)",
                fill: "forwards",
            },
        );
        setTimeout(() => p.remove(), 1000);
    }
}

/** @param {string} color */
function flashScreen(color) {
    const ov = document.getElementById("flashOverlay");
    if (!ov) return;
    ov.style.background = color;
    ov.style.opacity = "0.25";
    setTimeout(() => {
        ov.style.opacity = "0";
    }, 180);
}

/** @param {number} [cantidad] */
function spawnRedPenaltyParticles(cantidad = 10) {
    const severity = Math.min(Math.abs(cantidad) / 10, 5);
    const count = Math.round(20 + severity * 12);
    const shapes = ["square", "circle", "shard", "lightning"];
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const size = 4 + Math.random() * (6 + severity * 2);
        let css = `position:fixed; z-index:390; pointer-events:none;`;
        css += `left:${Math.random() * window.innerWidth}px; top:${-20 - Math.random() * 60}px;`;
        if (shape === "lightning") {
            const w = 8 + Math.random() * 6;
            const h = 20 + Math.random() * 20 * severity;
            css += `width:${w}px; height:${h}px; background:#ff4444;`;
            css += `clip-path: polygon(50% 0%, 65% 35%, 85% 25%, 70% 55%, 100% 50%, 60% 75%, 75% 100%, 40% 70%, 15% 80%, 30% 50%, 0% 45%, 35% 25%);`;
        } else if (shape === "shard") {
            css += `width:${size}px; height:${size * 2}px; background:#ff0000; border:2px solid #000;`;
            css += `clip-path: polygon(50% 0%, 100% 100%, 0% 100%);`;
        } else if (shape === "circle") {
            css += `width:${size}px; height:${size}px; background:#ff2222; border:2px solid #000; border-radius:50%;`;
        } else {
            css += `width:${size}px; height:${size}px; background:#ff0000; border:2px solid #000; transform:rotate(${Math.random() * 45}deg);`;
        }
        p.style.cssText = css;
        document.body.appendChild(p);
        const fallX = (Math.random() - 0.5) * (200 + severity * 40);
        const fallY = window.innerHeight + 50;
        const rot = Math.random() * 720 + severity * 180;
        p.animate(
            [
                { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
                { transform: `translate(${fallX}px,${fallY}px) rotate(${rot}deg)`, opacity: 0.2 },
            ],
            {
                duration: 1200 + Math.random() * 1000,
                easing: "ease-in",
                fill: "forwards",
            },
        );
        setTimeout(() => p.remove(), 3000);
    }
}

/** @param {string} grupo @param {boolean} esPenalizacion @param {number} absCant @param {Object} g */
function showAnimBoxFallback(grupo, esPenalizacion, absCant, g) {
    const box = document.getElementById("animBox");
    const label = document.getElementById("animLabel");
    const sub = document.getElementById("animSub");
    const pts = document.getElementById("animPts");
    if (!box || !label || !sub || !pts) return;
    label.textContent = g ? g.nombre : grupo || "PUNTO";
    label.style.color = g ? g.color2 : "#f5f5f5";
    sub.textContent = esPenalizacion
        ? PENALTY_SUBS[Math.floor(Math.random() * PENALTY_SUBS.length)]
        : SUBS[Math.floor(Math.random() * SUBS.length)];
    pts.textContent = esPenalizacion ? `−${absCant} pts` : `+${absCant} pts`;
    pts.style.fontSize = absCant >= 50 ? "50px" : "40px";
    box.classList.remove("in", "out", "penalty");
    if (esPenalizacion) box.classList.add("penalty");
    void box.offsetWidth;
    box.classList.add("in");
    clearTimeout(box._hideT);
    box._hideT = setTimeout(() => {
        box.classList.remove("in");
        box.classList.add("out");
        setTimeout(() => box.classList.remove("out"), 450);
    }, 2800);
}

/** @param {string} grupo @param {boolean} esPenalizacion @param {number} absCant @param {Object} g @param {number} intensity */
function showScoreEruption(grupo, esPenalizacion, absCant, g, intensity) {
    showAnimBoxFallback(grupo, esPenalizacion, absCant, g);
    if (g) {
        const card = document.getElementById("sc-" + g.cls);
        if (card) {
            const rect = card.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const color = esPenalizacion ? "#FF0000" : g.color;
            for (let i = 0; i < 20 + absCant; i++) {
                const p = document.createElement("div");
                const size = 4 + Math.random() * 8;
                p.style.cssText = `
                    position:fixed; z-index:390; pointer-events:none;
                    width:${size}px; height:${size}px;
                    background:${color}; border:2px solid #000;
                    left:${cx}px; top:${cy}px;
                `;
                document.body.appendChild(p);
                const angle = Math.random() * Math.PI * 2;
                const dist = 80 + Math.random() * 200 + absCant * 3;
                const dx = Math.cos(angle) * dist;
                const dy = Math.sin(angle) * dist - 60;
                p.animate([
                    { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
                    { transform: `translate(${dx}px,${dy}px) scale(0) rotate(${Math.random()*720}deg)`, opacity: 0 }
                ], { duration: 600 + Math.random() * 400, easing: "cubic-bezier(0.175,0.885,0.32,1.275)", fill: "forwards" });
                setTimeout(() => p.remove(), 1200);
            }
        }
    }
}

/** @param {string} grupo @param {boolean} esPenalizacion @param {number} absCant @param {Object} g */
function showFullscreenTakeover(grupo, esPenalizacion, absCant, g) {
    const ov = document.getElementById("fullscreenTakeover");
    const bg = document.getElementById("ftBg");
    const subEl = document.getElementById("ftSub");
    const labelEl = document.getElementById("ftLabel");
    const ptsEl = document.getElementById("ftPts");
    if (!ov || !bg || !subEl || !labelEl || !ptsEl) return;
    const teamColor = g ? g.color : (esPenalizacion ? "#FF0000" : "#FF00FF");
    bg.style.background = esPenalizacion
        ? `linear-gradient(135deg, #2a0000, ${teamColor})`
        : `linear-gradient(135deg, ${teamColor}, ${g ? g.color2 : '#fff'})`;
    subEl.textContent = esPenalizacion
        ? PENALTY_SUBS[Math.floor(Math.random() * PENALTY_SUBS.length)]
        : SUBS[Math.floor(Math.random() * SUBS.length)];
    subEl.style.background = esPenalizacion ? "#ff0000" : "var(--border)";
    labelEl.textContent = g ? g.nombre : grupo || "PUNTO";
    labelEl.style.color = "#fff";
    ptsEl.textContent = esPenalizacion ? `−${absCant} pts` : `+${absCant} pts`;
    ptsEl.style.color = esPenalizacion ? "#ff4444" : "#fff";
    ov.classList.remove("in", "out");
    void ov.offsetWidth;
    ov.classList.add("in");
    clearTimeout(ov._hideT);
    ov._hideT = setTimeout(() => {
        ov.classList.remove("in");
        ov.classList.add("out");
        setTimeout(() => ov.classList.remove("out"), 500);
    }, 2400);
}

/** @param {string} grupo @param {boolean} esPenalizacion @param {number} absCant @param {Object} g @param {number} intensity */
function showCardDomination(grupo, esPenalizacion, absCant, g, intensity) {
    if (!g) { showAnimBoxFallback(grupo, esPenalizacion, absCant, g); return; }
    const card = document.getElementById("sc-" + g.cls);
    if (!card) { showAnimBoxFallback(grupo, esPenalizacion, absCant, g); return; }
    const subText = esPenalizacion
        ? PENALTY_SUBS[Math.floor(Math.random() * PENALTY_SUBS.length)]
        : SUBS[Math.floor(Math.random() * SUBS.length)];
    const ptsText = esPenalizacion ? `−${absCant} pts` : `+${absCant} pts`;
    const domPts = document.createElement("div");
    domPts.className = "card-dom-pts";
    domPts.textContent = ptsText;
    domPts.style.color = esPenalizacion ? "#ff4444" : "#fff";
    card.appendChild(domPts);
    const origTransition = card.style.transition;
    const origZ = card.style.zIndex;
    card.classList.add("dominating");
    card.style.setProperty("--team-color", g.color);
    if (esPenalizacion) card.style.background = "#2a0000";
    const subBadge = document.createElement("div");
    subBadge.style.cssText = `
        position:absolute; top:5%; left:50%; transform:translateX(-50%);
        font-size:clamp(1.5rem,3vw,2.5rem); font-weight:900;
        background:${esPenalizacion ? "#ff0000" : "var(--border)"};
        color:#fff; padding:6px 24px; z-index:2;
        letter-spacing:0.08em;
    `;
    subBadge.textContent = subText;
    card.appendChild(subBadge);
    clearTimeout(card._domT);
    card._domT = setTimeout(() => {
        card.classList.remove("dominating");
        card.style.background = "";
        card.style.transition = origTransition;
        if (domPts.parentNode) domPts.parentNode.removeChild(domPts);
        if (subBadge.parentNode) subBadge.parentNode.removeChild(subBadge);
    }, 2000);
}

/** */
function triggerCrackEffect() {
    const ov = document.getElementById("crackOverlay");
    if (!ov) return;
    const cx = 30 + Math.random() * 40;
    const cy = 20 + Math.random() * 30;
    const branches = [];
    function branch(x, y, angle, depth, maxDepth) {
        if (depth > maxDepth) return;
        const len = 5 + Math.random() * 15;
        const nx = x + Math.cos(angle) * len;
        const ny = y + Math.sin(angle) * len;
        branches.push(`M${x},${y} L${nx},${ny}`);
        if (depth < maxDepth && Math.random() < 0.7) {
            const forkAngle = angle + (Math.random() - 0.5) * 1.2;
            branch(nx, ny, forkAngle, depth + 1, maxDepth);
        }
        if (Math.random() < 0.4) {
            branch(nx, ny, angle + (Math.random() - 0.5) * 0.8, depth + 1, maxDepth);
        }
    }
    for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
        branch(cx, cy, angle, 0, 4 + Math.floor(Math.random() * 3));
    }
    document.getElementById("crackPath").setAttribute("d", branches.slice(0, 5).join(" "));
    document.getElementById("crackPath2").setAttribute("d", branches.slice(5, 10).join(" "));
    document.getElementById("crackPath3").setAttribute("d", branches.slice(10).join(" "));
    ov.classList.add("active");
    clearTimeout(ov._t);
    ov._t = setTimeout(() => ov.classList.remove("active"), 800);
}

/** */
function triggerStrikeEffect() {
    const ov = document.getElementById("strikeOverlay");
    if (!ov) return;
    ov.classList.remove("active");
    void ov.offsetWidth;
    ov.classList.add("active");
    clearTimeout(ov._t);
    ov._t = setTimeout(() => ov.classList.remove("active"), 600);
}

/** @param {Object} g @param {number} absCant */
function showPenaltyFall(g, absCant) {
    if (!g) return;
    const card = document.getElementById("sc-" + g.cls);
    if (!card) return;
    const el = document.createElement("div");
    el.className = "penalty-fall";
    el.textContent = "▼ −" + absCant;
    el.style.setProperty("--fall-color", "#ff2222");
    card.appendChild(el);
    clearTimeout(el._fallT);
    el._fallT = setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 1800);
    card.classList.add("penalized");
    clearTimeout(card._penaltyT);
    card._penaltyT = setTimeout(() => {
        card.classList.remove("penalized");
        card._penaltyT = null;
    }, 1200);
}

/** @param {string} grupo @param {Object} g */
function triggerChainEffect(grupo, g) {
    if (!g) return;
    const card = document.getElementById("sc-" + g.cls);
    if (!card) return;
    card.classList.remove("chain-break");
    void card.offsetWidth;
    card.classList.add("chain-break");
    clearTimeout(card._chainT);
    card._chainT = setTimeout(() => card.classList.remove("chain-break"), 1400);
}

/** @param {string} texto @param {string} grupo @param {boolean} [esPenalizacion] @param {number} [cantidad] */
function showPointAnim(texto, grupo, esPenalizacion = false, cantidad = 0) {
    const g = window.GRUPOS.find((x) => x.key === grupo);
    const absCant = Math.abs(cantidad);
    const intensity = Math.min(absCant / 10, 5);
    const animDisabled = localStorage.getItem("disableAnimations") === "true";

    if (!esPenalizacion) {
        flashScreen(g ? g.color : "#FF00FF");
        sfxPoint(grupo);
        if (g) {
            const count = Math.round(60 + intensity * 20);
            launchCelebration(g.color, g.color2, count);
            SM.setTeamColor(g.color);
        }
    } else {
        flashScreen("#FF0000");
        sfxPenalty(absCant, grupo);
        spawnRedPenaltyParticles(absCant);
        showPenaltyFall(g, absCant);
        const penaltyModes = [];
        penaltyModes.push("shake");
        if (absCant >= 10) penaltyModes.push("crack");
        if (absCant >= 15) penaltyModes.push("strike");
        if (absCant >= 20) penaltyModes.push("chain");
        const pMode = penaltyModes[Math.floor(Math.random() * penaltyModes.length)];
        if (pMode === "crack") {
            triggerCrackEffect();
            if (g) {
                const card = document.getElementById("sc-" + g.cls);
                if (card) {
                    card.classList.add("card-flash-red");
                    setTimeout(() => card.classList.remove("card-flash-red"), 500);
                }
            }
        } else if (pMode === "strike") {
            triggerStrikeEffect();
            if (g) {
                const card = document.getElementById("sc-" + g.cls);
                if (card) {
                    card.classList.add("shake", "card-flash-red");
                    setTimeout(() => card.classList.remove("shake", "card-flash-red"), 800);
                }
            }
        } else if (pMode === "chain") {
            triggerChainEffect(grupo, g);
        } else {
            if (g) {
                const card = document.getElementById("sc-" + g.cls);
                if (card) {
                    card.classList.add("shake", "card-flash-red");
                    setTimeout(() => card.classList.remove("shake", "card-flash-red"), 800);
                }
            }
        }
        document.body.classList.add("screen-shake");
        setTimeout(() => {
            document.body.classList.remove("screen-shake");
        }, 300 + intensity * 100);
        const flashOv = document.getElementById("flashOverlay");
        if (flashOv) {
            flashOv.style.background = "#FF0000";
            flashOv.style.opacity = String(0.15 + intensity * 0.05);
            setTimeout(() => {
                flashOv.style.opacity = "0";
            }, 300 + intensity * 80);
        }
    }

    if (animDisabled || absCant < 5) {
        showAnimBoxFallback(grupo, esPenalizacion, absCant, g);
        return;
    }

    let mode;
    if (absCant >= 50) {
        mode = Math.random() < 0.6 ? "takeover" : "domination";
    } else if (absCant >= 20) {
        mode = ["eruption", "takeover", "domination"][Math.floor(Math.random() * 3)];
    } else if (absCant >= 10) {
        mode = Math.random() < 0.6 ? "eruption" : (Math.random() < 0.5 ? "takeover" : "domination");
    } else {
        mode = "eruption";
    }
    if (esPenalizacion && absCant < 15) mode = "eruption";

    if (mode === "takeover") {
        showFullscreenTakeover(grupo, esPenalizacion, absCant, g);
    } else if (mode === "domination") {
        showCardDomination(grupo, esPenalizacion, absCant, g, intensity);
    } else {
        showScoreEruption(grupo, esPenalizacion, absCant, g, intensity);
    }
}

const celebCanvas = document.getElementById("celebCanvas");
const cCtx = celebCanvas ? celebCanvas.getContext("2d") : null;
let confetti = [];
let confettiShapes = ["rect", "circle", "star", "ribbon"];

function genStarPath(ctx, cx, cy, r, points) {
    const step = Math.PI / points;
    ctx.beginPath();
    for (let i = 0; i < 2 * points; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const angle = i * step - Math.PI / 2;
        const x = cx + Math.cos(angle) * rad;
        const y = cy + Math.sin(angle) * rad;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
}

/** */
function resizeCelebCanvas() {
    if (!celebCanvas) return;
    celebCanvas.width = window.innerWidth;
    celebCanvas.height = window.innerHeight;
}

/** @param {string} c1 @param {string} c2 @param {number} [count] */
function launchCelebration(c1, c2, count) {
    if (window._lastConfettiFlag === false) return;
    count = count || 100;
    const palette = [c1, c2, "#f5f5f5", "#f59e0b", c1, "#ffd700", "#fff"];
    for (let i = 0; i < count; i++) {
        const shape = confettiShapes[Math.floor(Math.random() * confettiShapes.length)];
        const isRibbon = shape === "ribbon";
        confetti.push({
            x: Math.random() * celebCanvas.width,
            y: -20 - Math.random() * 80,
            vx: (Math.random() - 0.5) * 6,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            vr: (Math.random() - 0.5) * 12,
            w: isRibbon ? Math.random() * 6 + 3 : Math.random() * 10 + 5,
            h: isRibbon ? Math.random() * 18 + 10 : Math.random() * 5 + 3,
            col: palette[Math.floor(Math.random() * palette.length)],
            life: 1,
            shape: shape,
            swingPhase: Math.random() * Math.PI * 2,
            swingAmp: Math.random() * 1.5 + 0.5,
            gravity: 0.08 + Math.random() * 0.06,
        });
    }
    if (confetti.length > 0) requestAnimationFrame(animCelebration);
}

/** */
function animCelebration() {
    cCtx.clearRect(0, 0, celebCanvas.width, celebCanvas.height);
    confetti = confetti.filter((p) => p.life > 0.02);
    const wind = Math.sin(Date.now() / 4000) * 0.3;
    confetti.forEach((p) => {
        p.vx += wind * 0.1;
        p.vx *= 0.995;
        p.x += p.vx + Math.sin(p.swingPhase) * p.swingAmp * 0.3;
        p.y += p.vy;
        p.rot += p.vr;
        p.swingPhase += 0.04;
        p.vy += p.gravity;
        p.life *= 0.993;
        cCtx.save();
        cCtx.globalAlpha = p.life;
        cCtx.translate(p.x, p.y);
        cCtx.rotate((p.rot * Math.PI) / 180);
        cCtx.fillStyle = p.col;
        const hw = p.w / 2, hh = p.h / 2;
        if (p.shape === "circle") {
            cCtx.beginPath();
            cCtx.arc(0, 0, hw, 0, Math.PI * 2);
            cCtx.fill();
        } else if (p.shape === "star") {
            genStarPath(cCtx, 0, 0, hw, 5);
            cCtx.fill();
        } else if (p.shape === "ribbon") {
            const grad = cCtx.createLinearGradient(-hw, -hh, hw, hh);
            grad.addColorStop(0, p.col);
            grad.addColorStop(0.5, "#fff");
            grad.addColorStop(1, p.col);
            cCtx.fillStyle = grad;
            cCtx.fillRect(-hw, -hh, p.w, p.h);
            cCtx.strokeStyle = "rgba(0,0,0,0.15)";
            cCtx.lineWidth = 0.5;
            cCtx.strokeRect(-hw, -hh, p.w, p.h);
        } else {
            cCtx.fillRect(-hw, -hh, p.w, p.h);
        }
        cCtx.restore();
    });
    if (confetti.length > 0) requestAnimationFrame(animCelebration);
}

/** @param {string} grupoKey */
function showWinner(grupoKey) {
    const g = window.GRUPOS.find((x) => x.key === grupoKey);
    if (!g) return;
    const ov = document.getElementById("winnerOverlay");
    const nameEl = document.getElementById("winnerName");
    const box = document.getElementById("winnerBox");
    if (!ov || !nameEl) return;
    nameEl.textContent = g.nombre;
    nameEl.style.color = g.color2;
    box.style.background = g.color;
    box.style.borderColor = "#000";
    ov.classList.add("show");
    for (let i = 0; i < 5; i++) {
        setTimeout(
            () => launchCelebration(g.color, g.color2),
            i * 400,
        );
    }
    sfxPoint();
    setTimeout(sfxPoint, 600);
    setTimeout(sfxPoint, 1200);
}

/** @param {string} grupoKey @param {string} cls @param {string} color @param {string} nombre */
function triggerOvertake(grupoKey, cls, color, nombre) {
    const card = document.getElementById("sc-" + cls);
    if (!card) return;
    card.classList.remove("overtake");
    void card.offsetWidth;
    card.classList.add("overtake");
    card.style.setProperty("--overtake-color", color);
    clearTimeout(card._overtakeT);
    card._overtakeT = setTimeout(() => {
        card.classList.remove("overtake");
        card._overtakeT = null;
    }, 2000);
    sfxOvertake();
}

export {
    spawnCardParticles,
    flashScreen,
    spawnRedPenaltyParticles,
    showAnimBoxFallback,
    showScoreEruption,
    showFullscreenTakeover,
    showCardDomination,
    triggerCrackEffect,
    triggerStrikeEffect,
    triggerChainEffect,
    showPointAnim,
    celebCanvas,
    cCtx,
    confetti,
    resizeCelebCanvas,
    launchCelebration,
    animCelebration,
    showWinner,
    triggerOvertake,
    showPenaltyFall,
};
