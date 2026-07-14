import { esc } from './display-utils.js';

const _hmBodyParts = ['hm-head', 'hm-body', 'hm-arm-l', 'hm-arm-r', 'hm-leg-l', 'hm-leg-r'];

function showHangman(d) {
    const ov = document.getElementById('hangmanOverlay');
    const isActive = d.hangman && d.hangman.activo;
    document.body.classList.toggle('modo-hangman', !!isActive);
    if (!isActive) {
        if (ov) { ov.style.display = 'none'; }
        return;
    }
    ov.style.display = 'flex';
    const wd = document.getElementById('hmWordDisplay');
    const wl = document.getElementById('hmWrongLetters');
    const hr = document.getElementById('hmHearts');
    const rs = document.getElementById('hmResult');
    const catHint = document.getElementById('hmCategoryHint');
    if (catHint) {
        catHint.textContent = (d.hangman.length || 0) + ' letras';
    }
    if (wd) {
        let wordState = d.hangman.word_state || '';
        let letters = wordState.split(' ');
        if (letters.length === 1 && wordState.length > 0) {
            letters = wordState.split('');
        }
        let html = '';
        for (let i = 0; i < letters.length; i++) {
            const l = letters[i];
            const isRevealed = l !== '_' && l !== '';
            const cls = 'hm-letter-box' + (isRevealed ? ' revealed' : ' empty');
            html += '<span class="' + cls + '">' + (isRevealed ? esc(l) : '') + '</span>';
        }
        wd.innerHTML = html || '<span class="hm-letter-box empty"></span>';
    }
    if (wl) {
        const letters = d.hangman.wrong_letters || [];
        const won = d.hangman.word_state && d.hangman.word_state.indexOf('_') === -1;
        if (letters.length && !won) {
            wl.innerHTML = '\u2717 ' + letters.map(function(l) { return '<span class="ink-drip">' + esc(l) + '</span>'; }).join(' ');
        } else {
            wl.innerHTML = '';
        }
    }
    if (hr) {
        const vidas = d.hangman.attempts_left || 0;
        const total = d.hangman.max_attempts || 6;
        hr.innerHTML = '';
        for (var i = 0; i < total; i++) {
            var h = document.createElement('span');
            h.className = 'hm-heart' + (i >= vidas ? ' break' : '');
            h.textContent = '\u2764\uFE0F';
            hr.appendChild(h);
        }
    }
    const errores = (d.hangman.max_attempts || 6) - (d.hangman.attempts_left || 0);
    const totalErrores = d.hangman.max_attempts || 6;
    const lost = d.hangman.attempts_left <= 0;
    const darkenPct = errores / totalErrores;
    ov.classList.toggle('darken', darkenPct > 0.4);
    ov.classList.toggle('very-dark', darkenPct > 0.7);

    // Show body parts — ALL on loss
    _hmBodyParts.forEach(function(id, i) {
        const el = document.getElementById(id);
        if (el) {
            if (lost) {
                el.classList.add('show');
                el.style.opacity = '1';
            } else {
                el.classList.toggle('show', i < errores);
                el.style.opacity = i < errores ? '1' : '0';
            }
        }
    });

    if (rs) {
        const won = d.hangman.word_state && d.hangman.word_state.indexOf('_') === -1;
        rs.className = 'hm-result';
        if (won) {
            rs.textContent = '\u00A1GANASTE! \uD83C\uDF89';
            rs.classList.add('win');
            document.body.classList.add('hm-won');
        } else if (lost) {
            rs.textContent = 'PERDISTE \uD83D\uDC80';
            rs.classList.add('lose');
            document.body.classList.add('hm-lost');
        } else {
            document.body.classList.remove('hm-won', 'hm-lost');
        }
    }

    // Progressive animations
    document.body.classList.toggle('hm-shake', darkenPct > 0.6 && !lost && !(d.hangman.word_state && d.hangman.word_state.indexOf('_') === -1));

    const letterGrid = document.getElementById('hmLetterGrid');
    if (letterGrid) {
        const wrong = new Set(d.hangman.wrong_letters || []);
        const wordState = d.hangman.word_state || '';
        const correct = new Set(wordState.replace(/ /g, '').replace(/_/g, ''));
        const abecedario = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
        const won = d.hangman.word_state && d.hangman.word_state.indexOf('_') === -1;
        const disabled = won || lost;
        let html = '';
        for (let i = 0; i < abecedario.length; i++) {
            const l = abecedario[i];
            let cls = 'hm-key';
            if (wrong.has(l)) cls += ' wrong';
            else if (correct.has(l)) cls += ' correct';
            html += '<span class="' + cls + '">' + l + '</span>';
        }
        letterGrid.innerHTML = html;
        letterGrid.style.display = disabled ? 'none' : '';
    }
}

function showTiempo(d) {
    const ov = document.getElementById('tiempoOverlay');
    if (!d.verses || !d.verses.activo) {
        if (ov) { ov.classList.add('hidden'); }
        return;
    }
    ov.classList.remove('hidden');

    // Progress bar
    const fill = document.getElementById('tiempoProgressFill');
    if (fill && d.verses.timer_totales > 0) {
        const pct = Math.max(0, (d.verses.timer_segundos / d.verses.timer_totales) * 100);
        fill.style.width = pct + '%';
        fill.classList.toggle('urgent', d.verses.timer_segundos <= 10);
    }

    // Clock
    const clockNum = document.getElementById('tiempoClockNumber');
    const clockBox = document.getElementById('tiempoClockBox');
    if (clockNum) {
        const s = d.verses.timer_segundos || 0;
        const display = s < 10 ? '0' + s : String(s);
        if (clockNum.textContent !== display) {
            clockNum.textContent = display;
            clockNum.classList.remove('flash');
            void clockNum.offsetWidth;
            clockNum.classList.add('flash');
        }
        clockNum.className = 'versos-clock-number';
        if (clockBox) clockBox.className = 'versos-clock-box';
        if (s <= 5) {
            clockNum.classList.add('critical');
            if (clockBox) clockBox.classList.add('critical');
        } else if (s <= 10) {
            clockNum.classList.add('urgent');
            if (clockBox) clockBox.classList.add('urgent');
        } else if (s <= 20) {
            clockNum.classList.add('tension');
            if (clockBox) clockBox.classList.add('tension');
        }
    }

    // Leaderboard
    const lb = document.getElementById('tiempoLeaderboard');
    if (lb && d.puntos) {
        const grupos = window.GRUPOS || [];
        const sorted = grupos
            .map(function(g) { return { key: g.key, nombre: g.nombre, color: g.color, color2: g.color2, puntos: (d.puntos[g.key] || 0) }; })
            .sort(function(a, b) { return b.puntos - a.puntos; });
        lb.innerHTML = '<div class="versos-lb-title">CLASIFICACI\u00d3N</div>';
        sorted.forEach(function(g, i) {
            const card = document.createElement('div');
            card.className = 'versos-team-card';
            card.style.setProperty('--v-accent', g.color || '#fff');
            const rank = i + 1;
            const nombreDisplay = abbreviateName(g.nombre, 20);
            card.innerHTML = '<span class="v-rank">#' + rank + '</span>' +
                '<span class="v-team-name" title="' + esc(g.nombre) + '">' + esc(nombreDisplay) + '</span>' +
                '<span class="v-team-score">' + g.puntos + ' pts</span>';
            lb.appendChild(card);
        });
    }
}

function abbreviateName(name, maxLen) {
    if (!name || name.length <= maxLen) return name || '';
    const words = name.split(/\s+/);
    if (words.length <= 1) return name.slice(0, maxLen - 1) + '\u2026';
    return words.map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 6);
}
window.abbreviateName = abbreviateName;

function showBattle(d) {
    const ov = document.getElementById('battleOverlay');
    const isActive = d.battle && d.battle.activo;
    if (!isActive) { if (ov) ov.classList.add('hidden'); return; }
    if (ov) ov.classList.remove('hidden');
    const bd = d.battle;
    const hdr = ov?.querySelector('.battle-header');
    if (hdr) hdr.textContent = '\u2694\ufe0f BATALLA \u2014 Ronda ' + (bd.ronda_actual || 0) + '/' + (bd.total_rondas || 0);
    const teams = ov?.querySelectorAll('.battle-team');
    if (teams && teams.length >= 2) {
        const grupos = window.GRUPOS || [];
        const g1 = grupos.find(function(g) { return g.key === bd.equipo1; });
        const g2 = grupos.find(function(g) { return g.key === bd.equipo2; });
        teams[0].querySelector('.battle-team-name').textContent = g1?.nombre || bd.equipo1 || '';
        teams[0].querySelector('.battle-team-pts').textContent = bd.puntos_eq1 || 0;
        teams[1].querySelector('.battle-team-name').textContent = g2?.nombre || bd.equipo2 || '';
        teams[1].querySelector('.battle-team-pts').textContent = bd.puntos_eq2 || 0;
    }
    const qEl = ov?.querySelector('.battle-question');
    if (qEl && bd.pregunta_actual) qEl.textContent = bd.pregunta_actual.pregunta || '';
    const tEl = ov?.querySelector('.battle-timer');
    if (tEl) tEl.textContent = (bd.timer_restante || 0) + 's';
}

function showSurvival(d) {
    const ov = document.getElementById('survivalOverlay');
    const isActive = d.survival && d.survival.activo;
    if (!isActive) { if (ov) ov.classList.add('hidden'); return; }
    if (ov) ov.classList.remove('hidden');
    const sd = d.survival;
    const hdr = ov?.querySelector('.survival-header');
    if (hdr) hdr.textContent = '\uD83D\uDC80 SUPERVIVENCIA \u2014 Ronda ' + (sd.ronda || 0) + ' \u2014 Vivos: ' + (sd.equipos_vivos?.length || 0);
    const vivosEl = ov?.querySelector('.survival-vivos');
    if (vivosEl) {
        const grupos = window.GRUPOS || [];
        let html = '';
        (sd.equipos_vivos || []).forEach(function(eq) {
            const g = grupos.find(function(x) { return x.key === eq; });
            html += '<div class="survival-team">' + esc(g?.nombre || eq) + '</div>';
        });
        (sd.equipos_eliminados || []).forEach(function(eq) {
            const g = grupos.find(function(x) { return x.key === eq; });
            html += '<div class="survival-team eliminado">' + esc(g?.nombre || eq) + '</div>';
        });
        vivosEl.innerHTML = html;
    }
    const qEl = ov?.querySelector('.survival-question');
    if (qEl && sd.pregunta_actual) qEl.textContent = sd.pregunta_actual.pregunta || '';
    const tEl = ov?.querySelector('.survival-timer');
    if (tEl) tEl.textContent = (sd.timer_restante || 0) + 's';
}

function showQuizShow(d) {
    const ov = document.getElementById('quizshowOverlay');
    const isActive = d.quizshow && d.quizshow.activo;
    if (!isActive) { if (ov) ov.classList.add('hidden'); return; }
    if (ov) ov.classList.remove('hidden');
    const qd = d.quizshow;
    const hdr = ov?.querySelector('.quizshow-header');
    if (hdr) hdr.textContent = '\uD83C\uDFAC QUIZ SHOW \u2014 Ronda ' + (qd.ronda_actual || 0) + '/' + (qd.total_rondas || 0);
    const qEl = ov?.querySelector('.quizshow-question');
    if (qEl && qd.pregunta_actual) qEl.textContent = qd.pregunta_actual.pregunta || '';
    const scoresEl = ov?.querySelector('.quizshow-scores');
    if (scoresEl && qd.puntos_equipos) {
        const grupos = window.GRUPOS || [];
        let html = '';
        Object.entries(qd.puntos_equipos).forEach(function(entry) {
            const g = grupos.find(function(x) { return x.key === entry[0]; });
            html += '<div class="quizshow-score">' + esc(g?.nombre || entry[0]) + ': ' + entry[1] + ' pts</div>';
        });
        scoresEl.innerHTML = html;
    }
    const tEl = ov?.querySelector('.quizshow-timer');
    if (tEl) tEl.textContent = (qd.timer_restante || 0) + 's';
}

export {
    showHangman,
    showTiempo,
    showBattle,
    showSurvival,
    showQuizShow,
};
