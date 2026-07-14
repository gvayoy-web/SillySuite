import { animateCounter, esc } from './display-utils.js';
import { sfxTimerStart, sfxUrgentTick, sfxTimeOut, sfxOvertake } from './display-sound.js';
import { spawnCardParticles, triggerOvertake } from './display-anim.js';

function abbreviateName(name, maxLen) {
    if (!name || name.length <= maxLen) return name || '';
    var words = name.split(/\s+/);
    if (words.length <= 1) return name.slice(0, maxLen - 1) + '\u2026';
    return words.map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 6);
}

function isLightColor(hex) {
    if (!hex) return true;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length !== 6) return true;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 140;
}

let _gruposStyleEl = null;

function rebuildGrupos(gc) {
    if (!gc || !gc.length) return;
    const same = (a, b) => a.key === b.key && (a.nombre || a.key) === (b.nombre || b.key) && a.color === b.color && (a.color2 || a.color) === (b.color2 || b.color);
    if (gc.length === window.GRUPOS.length && gc.every((g, i) => same(g, window.GRUPOS[i]))) return;
    const newGrupos = gc.map((g, i) => ({
        key: g.key,
        cls: "c-grp-" + i,
        nombre: g.nombre || g.key,
        color: g.color,
        color2: g.color2 || g.color,
    }));
    const legacy = ["jovenes", "damas", "caball", "ninos"];
    let css = ":root {\n";
    newGrupos.forEach((g, i) => {
        css += `  --grp-${i}: ${g.color};\n`;
        css += `  --grp2-${i}: ${g.color2};\n`;
        if (i < legacy.length) {
            css += `  --${legacy[i]}: var(--grp-${i});\n`;
        }
    });
    css += "}\n";
    newGrupos.forEach((g, i) => {
        css += `.c-grp-${i} { background: var(--grp-${i}); }\n`;
    });
    css += `#scoresZone { display: flex !important; flex-wrap: nowrap; gap: 8px; overflow-x: auto; padding-bottom: 8px; max-height: none !important; align-items: stretch; }\n`;
    css += `#scoresZone .score-card { flex: 1 1 ${100 / Math.max(newGrupos.length, 1)}%; min-width: 120px; max-width: 300px; height: auto; min-height: 190px; }\n`;
    if (!_gruposStyleEl) {
        _gruposStyleEl = document.createElement("style");
        _gruposStyleEl.id = "dynamic-grupos-css";
        document.head.appendChild(_gruposStyleEl);
    }
    _gruposStyleEl.textContent = css;
    window.GRUPOS.splice(0, window.GRUPOS.length, ...newGrupos);
}

function renderTimer(t) {
    const numEl = document.getElementById("timerNum");
    const badge = document.getElementById("timerBadge");
    const s = t.segundos_restantes;
    const urgent = s <= 5 && t.activo;

    if (t.activo && !window._wasActive) {
        sfxTimerStart();
    }
    if (urgent && window._wasActive && s !== window._lastTimerSec) {
        sfxUrgentTick();
    }
    if (!t.activo && window._wasActive && s === 0 && !window._timerWasZero) {
        sfxTimeOut();
        window._timerWasZero = true;
    }
    if (t.activo) window._timerWasZero = false;

    window._wasActive = t.activo;
    window._lastTimerSec = s;

    if (t.activo || s > 0) {
        numEl.textContent = s < 10 ? "0" + s : String(s);
        numEl.className =
            "timer-num" + (urgent ? " urgent" : " active");
        if (badge) badge.classList.toggle("urgent", urgent);
    } else {
        numEl.textContent = "—";
        numEl.className = "timer-num stopped";
        if (badge) badge.classList.remove("urgent");
    }
}

const RANK_ICONS = {0:"🥇",1:"🥈",2:"🥉",3:"🏅"};
const RANK_CROWNS = {0:"👑",1:"",2:"",3:""};

function renderPodium(resultados) {
    const container = document.getElementById("frPodium");
    if (!container) return;
    if (!resultados || !resultados.length) { container.innerHTML = ""; return; }

    const top3 = resultados.slice(0, 3);
    const rest = resultados.slice(3);

    const podiumOrder = top3.length === 3
        ? [top3[1], top3[0], top3[2]]
        : top3;

    let html = '<div class="fr-podium-3d">';
    var isCrownEnabled = document.body.classList.contains('crown-leader');
    podiumOrder.forEach((r, i) => {
        const rankIn = top3.indexOf(r);
        const realRank = resultados.indexOf(r) + 1;
        const isTop3 = realRank <= 3;
        var crownIcon = (isCrownEnabled && realRank === 1) ? '👑 ' : (RANK_CROWNS[rankIn] || "");
        html += `
            <div class="fr-podium-step rank-${realRank}">
                <div class="fr-step-body">
                    <span class="fr-step-crown">${crownIcon}</span>
                    <div class="fr-step-name" title="${esc(r.grupo)}">${RANK_ICONS[rankIn] || "🏅"} ${esc(abbreviateName(r.grupo, 22))}</div>
                    <div class="fr-step-pts">${r.puntos} pts</div>
                </div>
                ${isTop3 ? '<div class="fr-step-base"></div>' : ''}
            </div>`;
    });
    html += '</div>';

    if (rest.length) {
        html += '<div class="fr-podium-flat">';
        rest.forEach((r, i) => {
            html += `
                <div class="fr-flat-card">
                    <div class="fr-flat-rank">#${i + 4}</div>
                    <div class="fr-flat-name" title="${esc(r.grupo)}">${esc(abbreviateName(r.grupo, 22))}</div>
                    <div class="fr-flat-pts">${r.puntos} pts</div>
                </div>`;
        });
        html += '</div>';
    }

    container.innerHTML = html;
}

function renderScores(puntos, eliminados) {
    const firstSyncDelta = Object.keys(puntos).length > 0 && window._scoreFirstSync;
    window._scoreFirstSync = false;
    if (!window._prevRank) window._prevRank = {};
    const sorted = [...window.GRUPOS]
        .map((g) => ({ ...g, pts: puntos[g.key] ?? 0 }))
        .sort((a, b) => b.pts - a.pts);
    const maxPts = Math.max(sorted[0]?.pts || 0, 1);
    const zone = document.getElementById("scoresZone");

    const activeIds = new Set(sorted.map((g) => "sc-" + g.cls));
    Array.from(zone.children).forEach((child) => {
        if (!activeIds.has(child.id)) child.remove();
    });

    const prevRanks = {};
    sorted.forEach((g, i) => {
        const rankEl = document.getElementById("rank-" + g.cls);
        if (rankEl) {
            const num = parseInt(rankEl.textContent.replace('#', ''));
            if (!isNaN(num)) prevRanks[g.key] = num;
        }
    });

    sorted.forEach((g, i) => {
        const cardId = "sc-" + g.cls;
        let card = document.getElementById(cardId);

        var scoreAnim = document.body.classList.contains('score-anim-flip') ? 'flip' :
            document.body.classList.contains('score-anim-bounce') ? 'bounce' :
            document.body.classList.contains('score-anim-glow') ? 'glow' : 'none';
        var isCrown = document.body.classList.contains('crown-leader') && i === 0;
        var isDynamic = !!window._dynamicBars;

        if (!card) {
            card = document.createElement("div");
            card.id = cardId;
            const nameCls = isLightColor(g.color) ? 'name-dark' : 'name-light';
            card.className = `score-card ${g.cls} ${nameCls}` + (isCrown ? ' crowned' : '');
            card.style.setProperty("--team-color", g.color);
            var nombreDisplay = abbreviateName(g.nombre, 20);
            var crownHtml = isCrown ? '<span class="crown-badge">👑</span>' : '';
            var barHtml = isDynamic
                ? '<div class="card-dynamic-bar" id="bar-' + g.cls + '"><div class="card-dynamic-fill" style="height:0%"></div></div>'
                : '<div class="card-bar-wrap"><div class="card-bar-inner" id="bar-' + g.cls + '" style="width:0%"></div></div>';
            card.innerHTML = `
        <div class="card-top">
          <div class="card-name" title="${esc(g.nombre)}">${crownHtml}${esc(nombreDisplay)}</div>
          <div class="card-rank" id="rank-${g.cls}">#${i + 1}</div>
        </div>
        <div class="card-pts-wrap">
          <div class="card-pts" id="pts-${g.cls}">0</div>
        </div>
        <div class="card-streak hidden" id="streak-${g.cls}"></div>
        ${barHtml}`;
            zone.appendChild(card);
            window.prevPts[g.key] = 0;
        }

        const ptsEl = document.getElementById("pts-" + g.cls);
        const rankEl = document.getElementById("rank-" + g.cls);
        const streakEl = document.getElementById("streak-" + g.cls);
        const pct = maxPts ? g.pts / maxPts : 0;

        // Dynamic bars use vertical fill, normal bars use width
        if (isDynamic) {
            var barFill = document.querySelector("#bar-" + g.cls + " .card-dynamic-fill");
            if (barFill) barFill.style.height = (pct * 100) + "%";
        } else {
            var barEl = document.getElementById("bar-" + g.cls);
            if (barEl) barEl.style.width = (pct * 100) + "%";
        }

        // Crown leader
        card.classList.toggle("crowned", isCrown);
        var existingCrown = card.querySelector(".crown-badge");
        if (isCrown && !existingCrown) {
            var nameEl = card.querySelector(".card-name");
            if (nameEl) {
                var crownSpan = document.createElement("span");
                crownSpan.className = "crown-badge";
                crownSpan.textContent = "👑";
                nameEl.insertBefore(crownSpan, nameEl.firstChild);
            }
        } else if (!isCrown && existingCrown) {
            existingCrown.remove();
        }

        const prev = window.prevPts[g.key] ?? 0;
        if (prev !== g.pts) {
            const diff = g.pts - prev;
            if (firstSyncDelta) {
                ptsEl.textContent = g.pts;
            } else {
                animateCounter(ptsEl, prev, g.pts, 480);
                card.classList.remove("bump");
                void card.offsetWidth;
                card.classList.add("bump");
                card.style.transition =
                    "box-shadow 0.15s, transform 0.15s";
                if (diff < 0) {
                    card.style.boxShadow = `0 0 40px #FF0000, 12px 12px 0 var(--border)`;
                    spawnCardParticles(card, "#FF0000");
                } else {
                    card.style.boxShadow = `0 0 40px ${g.color}, 12px 12px 0 var(--border)`;
                    spawnCardParticles(card, g.color);
                }

                // Score animations
                if (scoreAnim === 'flip') {
                    ptsEl.classList.remove('anim-flip');
                    void ptsEl.offsetWidth;
                    ptsEl.classList.add('anim-flip');
                } else if (scoreAnim === 'bounce') {
                    card.classList.remove('anim-bounce');
                    void card.offsetWidth;
                    card.classList.add('anim-bounce');
                } else if (scoreAnim === 'glow') {
                    card.classList.remove('anim-glow');
                    void card.offsetWidth;
                    card.classList.add('anim-glow');
                }
            }

            if (diff > 0) {
                if (!firstSyncDelta) window.streaks[g.key] = (window.streaks[g.key] || 0) + 1;
                if (streakEl) {
                    if ((window.streaks[g.key] || 0) >= 2) {
                        streakEl.textContent = `🔥×${window.streaks[g.key]}`;
                        streakEl.style.display = "inline-block";
                    } else {
                        streakEl.style.display = "none";
                    }
                }
            } else if (diff < 0) {
                window.streaks[g.key] = 0;
                if (streakEl) streakEl.style.display = "none";
            }

            if (!firstSyncDelta) {
                if (card._bumpT) clearTimeout(card._bumpT);
                card._bumpT = setTimeout(() => {
                    card.classList.remove("bump", "anim-bounce", "anim-glow");
                    card.style.boxShadow = "";
                card._bumpT = null;
            }, 800);
            }
        }

        if (rankEl) rankEl.textContent = "#" + (i + 1);
        card.classList.toggle("rank-1", i === 0);
        if (eliminados) card.classList.toggle("eliminado", eliminados.includes(g.key));

        if (!firstSyncDelta && prevRanks[g.key] !== undefined && prevRanks[g.key] > (i + 1)) {
            triggerOvertake(g.key, g.cls, g.color, g.nombre);
        }

        zone.appendChild(card);
    });

    Object.keys(window.prevPts).forEach(k => delete window.prevPts[k]);
    Object.assign(window.prevPts, puntos);
    sorted.forEach((g, i) => { window._prevRank[g.key] = i + 1; });
}

const SUBS = [
    "¡EXCELENTE!",
    "¡CORRECTO!",
    "¡BRILLANTE!",
    "¡ASÍ SE HACE!",
    "¡PUNTO!",
];

const PENALTY_SUBS = [
    "¡PENALIZACIÓN!",
    "¡INCORRECTO!",
    "¡RESPUESTA ERRÓNEA!",
    "¡FALLA!",
    "¡PIERDE PUNTOS!",
    "¡QUITA PUNTAJE!",
];

export {
    rebuildGrupos,
    renderTimer,
    RANK_ICONS,
    RANK_CROWNS,
    renderPodium,
    renderScores,
    SUBS,
    PENALTY_SUBS,
};
