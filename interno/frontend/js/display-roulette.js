import { sfxPoint } from './display-sound.js';

window._ruletaUltimoId = -1;
window._ruletaAnimPhase = "idle";
window._ruletaGirando = false;
window._gradosActualesRuleta = 0;
window._ruletaCategoryTimeouts = [];
window._ruletaGlowInterval = null;
window._ruletaTimerInterval = null;

function genColors(n) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        const hue = (i * 360 / n + 15) % 360;
        colors.push('hsl(' + hue + ',75%,55%)');
    }
    return colors;
}

function darken(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    if (isNaN(num)) return '#444';
    const r = Math.floor(((num >> 16) & 0xFF) * (1 - amount));
    const g = Math.floor(((num >> 8) & 0xFF) * (1 - amount));
    const b = Math.floor((num & 0xFF) * (1 - amount));
    return '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
}

/* ─── Phase 1: Category Duel with traveling glow ─── */
function _cleanCategoryTimeouts() {
    if (window._ruletaCategoryTimeouts.length) {
        window._ruletaCategoryTimeouts.forEach(function(t) { clearTimeout(t); });
        window._ruletaCategoryTimeouts = [];
    }
}

function iniciarCategoriaDuel(d) {
    const ru = d.ruleta;
    if (!ru || !ru.activa) return;
    if (window._ruletaAnimPhase !== "idle") return;

    const overlay = document.getElementById('ruletaOverlay');
    if (overlay) overlay.classList.add('show');

    // Show phase 1, hide phase 2
    const phase1 = document.getElementById('ruletaPhaseCategory');
    const phase2 = document.getElementById('ruletaPhaseWheel');
    if (phase1) phase1.classList.remove('hidden');
    if (phase2) phase2.classList.add('hidden');

    const catMeta = ru.categories || {};
    const allCats = ru.all_categories || {};
    const keys = Object.keys(catMeta);
    if (keys.length < 2) return;

    const arena = document.getElementById('ruletaDuelColumns');
    if (!arena) return;
    arena.innerHTML = '';
    _cleanCategoryTimeouts();

    keys.forEach(function(key, i) {
        const meta = catMeta[key];
        const full = allCats[key] || {};
        const items = full.items || [];
        const col = document.createElement('div');
        col.className = 'ruleta-duel-col';
        col.dataset.key = key;
        const color = meta.color || genColors(keys.length)[i];
        col.innerHTML =
            '<div class="ruleta-duel-circle" style="background:' + color + ';box-shadow:0 0 30px ' + color + '40, 0 0 60px ' + color + '20;">' +
                '<span class="ruleta-duel-circle-label">' + (meta.name || key).toUpperCase() + '</span>' +
            '</div>' +
            '<div class="ruleta-duel-items">' +
                items.slice(0, 5).map(function(item) {
                    return '<span class="ruleta-duel-item">' + item + '</span>';
                }).join('') +
                (items.length > 5 ? '<span class="ruleta-duel-item more">+' + (items.length - 5) + '</span>' : '') +
            '</div>';
        arena.appendChild(col);
    });

    // Glow animation: traveling spotlight
    window._ruletaAnimPhase = "glow";
    const circles = arena.querySelectorAll('.ruleta-duel-circle');
    let currentIdx = 0;
    let direction = 1;
    let glows = 0;
    const maxGlows = 3 + Math.floor(Math.random() * 2); // 3-4 full passes

    function clearGlows() {
        circles.forEach(function(c) { c.classList.remove('glow-active', 'glow-dim'); });
    }

    function stepGlow() {
        if (window._ruletaAnimPhase !== "glow") return;
        clearGlows();
        circles.forEach(function(c, i) {
            const dist = Math.abs(i - currentIdx);
            if (dist === 0) {
                c.classList.add('glow-active');
            } else if (dist <= 1) {
                c.classList.add('glow-dim');
            }
        });
        currentIdx += direction;
        if (currentIdx >= circles.length || currentIdx < 0) {
            direction *= -1;
            currentIdx += direction;
            glows++;
        }
        if (glows >= maxGlows && currentIdx === Math.floor(circles.length / 2)) {
            // Finale: settle on the selected category
            const selectedKey = ru.categoria_seleccionada;
            const finalIdx = keys.indexOf(selectedKey);
            if (finalIdx !== -1) {
                clearGlows();
                circles.forEach(function(c, i) {
                    if (i === finalIdx) {
                        c.classList.add('glow-active', 'glow-final');
                    } else {
                        c.classList.add('glow-dim');
                    }
                });
                // Show verdict banner
                const banner = document.getElementById('ruletaVerdictBanner');
                const bannerText = document.getElementById('verdictBannerText');
                const bannerIcon = document.getElementById('verdictBannerIcon');
                if (banner && bannerText) {
                    const meta = catMeta[selectedKey] || {};
                    bannerText.textContent = (meta.name || selectedKey).toUpperCase();
                    bannerIcon.textContent = '\uD83C\uDFC6';
                    banner.classList.add('show');
                }
                window._ruletaAnimPhase = "category_done";
                setTimeout(function() {
                    if (window._ruletaAnimPhase === "category_done") {
                        // Transition to wheel phase will be triggered by next state
                    }
                }, 2000);
                return;
            }
        }
        const delay = Math.max(80, 300 - glows * 30);
        window._ruletaCategoryTimeouts.push(setTimeout(stepGlow, delay));
    }

    stepGlow();

    // VS divider spark effect
    const divider = document.getElementById('ruletaDivider');
    if (divider) {
        divider.classList.add('pulse');
        setTimeout(function() { if (divider) divider.classList.remove('pulse'); }, 3000);
    }

    const statusText = document.getElementById('ruletaStatusText');
    if (statusText) statusText.textContent = '\uD83D\uDD25 Seleccionando categor\u00EDa\u2026';
}

/* ─── Phase 2: Wheel spin ─── */
function dibujarRuletaCanvas(categories, categoriaSeleccionada) {
    const canvas = document.getElementById('ruletaCanvas');
    if (!canvas) return;
    const container = document.getElementById('wheelContainer');
    const containerW = container ? container.clientWidth : 500;
    const containerH = container ? container.clientHeight : 500;
    const size = Math.max(300, Math.min(containerW, containerH, 700));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const catConfig = categories || {};
    const entries = Object.entries(catConfig);
    const n = entries.length;
    if (n < 2) return;

    const centro = size / 2;
    const radio = centro - 15;
    const anguloSector = (2 * Math.PI) / n;
    ctx.clearRect(0, 0, size, size);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    entries.forEach(function(e, i) {
        const [key, cat] = e;
        const angInicio = i * anguloSector - Math.PI / 2;
        const angFin = angInicio + anguloSector;
        ctx.beginPath();
        ctx.moveTo(centro, centro);
        ctx.arc(centro, centro, radio, angInicio, angFin);
        ctx.closePath();
        const color = cat.color || genColors(n)[i];
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();
        ctx.save();
        ctx.translate(centro, centro);
        ctx.rotate(angInicio + anguloSector / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + (size * 0.045) + 'px "Space Grotesk", sans-serif';
        ctx.fillText((cat.name || key).toUpperCase(), size * 0.25, 0);
        ctx.restore();
    });

    // Center pin
    ctx.beginPath();
    ctx.arc(centro, centro, centro * 0.08, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(centro, centro, 0, centro, centro, centro * 0.08);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, '#888');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function iniciarRueda(d) {
    if (window._ruletaGirando) return;
    const ru = d.ruleta;
    if (!ru || !ru.activa || !ru.resultado || !ru.categoria_seleccionada) return;

    const phase1 = document.getElementById('ruletaPhaseCategory');
    const phase2 = document.getElementById('ruletaPhaseWheel');
    if (phase1) phase1.classList.add('hidden');
    if (phase2) phase2.classList.remove('hidden');

    const catKeys = Object.keys(ru.categories || {});
    if (catKeys.length < 2) return;

    dibujarRuletaCanvas(ru.categories, ru.categoria_seleccionada);

    const winIdx = catKeys.indexOf(ru.categoria_seleccionada);
    if (winIdx === -1) return;

    window._ruletaGirando = true;
    window._ruletaAnimPhase = "spinning";
    const canvas = document.getElementById('ruletaCanvas');
    const gradosPorSector = 360 / catKeys.length;
    const angDestino = winIdx * gradosPorSector + gradosPorSector / 2;
    const angParada = (270 - angDestino + 360) % 360;

    // Physics-like spin: multiple full rotations + deceleration
    window._gradosActualesRuleta += 8 * 360 + angParada;
    canvas.style.transition = 'transform 8s cubic-bezier(0.08, 0.82, 0.12, 1)';
    canvas.style.transform = 'rotate(' + window._gradosActualesRuleta + 'deg)';

    const status = document.getElementById('wheelStatus');
    if (status) status.textContent = '\uD83C\uDFB2 Girando\u2026';

    document.getElementById('wheelWordDisplay').style.display = 'none';
    document.getElementById('wheelTimer').style.display = 'none';

    setTimeout(function() {
        window._ruletaGirando = false;
        window._ruletaAnimPhase = "result";
        const catMeta = ru.categories[ru.categoria_seleccionada] || {};
        const catName = catMeta.name || ru.categoria_seleccionada;
        if (status) status.textContent = '\uD83C\uDFC6 ' + catName.toUpperCase() + '!';
        const ws = document.getElementById('wheelWordDisplay');
        if (ws) {
            document.getElementById('wheelWord').textContent = ru.resultado;
            ws.style.display = 'block';
        }
        sfxPoint();
        // Show timer
        const timerSec = ru.timer_segundos || 15;
        iniciarTimerRuleta(timerSec);
    }, 7200);
}

function iniciarTimerRuleta(segundos) {
    const tw = document.getElementById('wheelTimer');
    if (tw) tw.style.display = 'flex';
    const tv = document.getElementById('wheelTimerValue');
    if (tv) tv.textContent = segundos;
    let left = segundos;
    if (window._ruletaTimerInterval) clearInterval(window._ruletaTimerInterval);
    window._ruletaTimerInterval = setInterval(function() {
        left--;
        if (tv) tv.textContent = Math.max(0, left);
        if (tw) tw.classList.toggle('urgent', left <= 5);
        if (left <= 0) {
            clearInterval(window._ruletaTimerInterval);
            window._ruletaTimerInterval = null;
            const tp = document.getElementById('wheelTiempoPerdido');
            if (tp) tp.classList.remove('hidden');
        }
    }, 1000);
}

function cerrarRuleta() {
    window._ruletaAnimPhase = "idle";
    window._ruletaGirando = false;
    _cleanCategoryTimeouts();
    if (window._ruletaGlowInterval) { clearInterval(window._ruletaGlowInterval); window._ruletaGlowInterval = null; }
    if (window._ruletaTimerInterval) { clearInterval(window._ruletaTimerInterval); window._ruletaTimerInterval = null; }
    const overlay = document.getElementById('ruletaOverlay');
    if (overlay) overlay.classList.remove('show');
    const banner = document.getElementById('ruletaVerdictBanner');
    if (banner) banner.classList.remove('show');
    const tp = document.getElementById('wheelTiempoPerdido');
    if (tp) tp.classList.add('hidden');
    const phase1 = document.getElementById('ruletaPhaseCategory');
    const phase2 = document.getElementById('ruletaPhaseWheel');
    if (phase1) phase1.classList.add('hidden');
    if (phase2) phase2.classList.add('hidden');
}

export {
    iniciarCategoriaDuel as iniciarRuletaCategoria,
    iniciarRueda as iniciarRuletaWheel,
    cerrarRuleta,
};
