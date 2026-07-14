// quiz-renderer.js — Dynamic categories from config
// Variables globales esperadas desde display.html:
//   currentQId, _lastOptionsKey, adjustTextSize, typewriteText, esc

const CAT_ICONS = {
  palabra: '📖',
  cantante: '🎤',
  quiensoy: '❓',
  libros: '📖',
  versiculos: '✝️',
};

function renderOptions(p, mostrarOpc, mostrarResp, opcionSeleccionada) {
  const container = document.getElementById('optionsContainer');
  const scores    = document.getElementById('scoresZone');
  if (!container) return;
  if (!mostrarOpc || !p || !p.opciones || p.opciones.length === 0) {
    container.innerHTML = '';
    container.classList.remove('show');
    _lastOptionsKey = '';
    if (scores) scores.classList.remove('scores-compact');
    return;
  }
  container.style.display = '';
  if (scores) scores.classList.add('scores-compact');
  const key = JSON.stringify(p.opciones);
  const sameContent = (key === _lastOptionsKey);
  _lastOptionsKey = key;

  function base(card) {
    card.style.cssText = 'display:flex;align-items:center;gap:20px;padding:30px 36px;border-radius:16px;font-size:26px;font-weight:800;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);border:2px solid #2e2e2e;background:#ffffff;color:#000000;transform:scale(1);box-shadow:none;opacity:1;text-shadow:none;filter:none';
  }
  function selPreview(card) {
    card.style.cssText = 'display:flex;align-items:center;gap:20px;padding:30px 36px;border-radius:16px;font-size:26px;font-weight:800;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);background:linear-gradient(135deg,#B45309,#D97706);border-color:#FBBF24;color:#fff;transform:scale(1.02);box-shadow:0 0 25px rgba(217,119,6,0.5);opacity:1;text-shadow:none;filter:none';
  }
  function correct(card) {
    card.style.cssText = 'display:flex;align-items:center;gap:20px;padding:30px 36px;border-radius:16px;font-size:26px;font-weight:800;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);background:linear-gradient(135deg,#059669,#10B981);border-color:#34D399;color:#fff;transform:scale(1.04);box-shadow:0 0 30px rgba(16,185,129,0.6),inset 0 0 15px rgba(255,255,255,0.2);opacity:1;text-shadow:0 2px 4px rgba(0,0,0,0.3);filter:none';
  }
  function wrong(card) {
    card.style.cssText = 'display:flex;align-items:center;gap:20px;padding:30px 36px;border-radius:16px;font-size:26px;font-weight:800;transition:all 0.4s cubic-bezier(0.175,0.885,0.32,1.275);background:linear-gradient(135deg,#991B1B,#DC2626);border-color:#F87171;color:rgba(255,255,255,0.85);transform:scale(0.97);box-shadow:0 0 15px rgba(220,38,38,0.2);opacity:0.75;text-shadow:none;filter:none';
  }

  if (!sameContent) {
    container.innerHTML = '';
    const labels = ['A', 'B', 'C'];
    p.opciones.forEach((opcion, index) => {
      const card = document.createElement('div');
      card.className = 'option-card';
      card.id = `opcion-box-${index}`;
      base(card);
      card.style.transitionDelay = mostrarResp ? '0ms' : `${index * 150}ms`;
      if (mostrarResp) {
        card.classList.add('answered');
        if (index === p.respuesta_correcta) { card.classList.add('correct'); correct(card); }
        else { card.classList.add('wrong'); wrong(card); }
      } else if (opcionSeleccionada !== null && opcionSeleccionada !== undefined && index === opcionSeleccionada) {
        if (index === p.respuesta_correcta) { card.classList.add('correct'); correct(card); }
        else { card.classList.add('wrong'); wrong(card); }
      }
      const catColor = window.CAT_COLORS && window.CAT_COLORS[p.categoria];
      if (catColor && !mostrarResp) card.style.borderColor = catColor;
      const l = document.createElement('div'); l.className = 'opt-letter'; l.textContent = labels[index];
      const t = document.createElement('div'); t.className = 'opt-text'; t.textContent = opcion;
      if (typeof window.adjustOptTextSize === 'function') window.adjustOptTextSize(t, opcion);
      card.appendChild(l); card.appendChild(t);
      if (mostrarResp) {
        const ck = document.createElement('div'); ck.className = 'opt-check';
        ck.textContent = index === p.respuesta_correcta ? '✓' : '✕'; card.appendChild(ck);
      }
      container.appendChild(card);
    });
    requestAnimationFrame(() => {
      container.classList.add('show');
      container.querySelectorAll('.option-card').forEach(el => el.classList.add('show'));
    });
  } else if (mostrarResp && container.classList.contains('show')) {
    container.querySelectorAll('.option-card').forEach((el, i) => {
      base(el); el.classList.add('answered'); el.classList.remove('correct', 'wrong', 'selected');
      el.style.transitionDelay = '0ms';
      if (i === p.respuesta_correcta) { el.classList.add('correct'); correct(el); }
      else { el.classList.add('wrong'); wrong(el); }
    });
  } else if (!mostrarResp) {
    container.querySelectorAll('.option-card').forEach((el, i) => {
      el.classList.remove('selected', 'correct', 'wrong');
      base(el);
      if (opcionSeleccionada !== null && opcionSeleccionada !== undefined && i === opcionSeleccionada) {
        if (i === p.respuesta_correcta) { el.classList.add('correct'); correct(el); }
        else { el.classList.add('wrong'); wrong(el); }
      }
    });
  }
}

function renderQuestion(p, mostrarResp, mostrarOpc, opcionSeleccionada) {
  const qText = document.getElementById('qText');
  const qEye = document.getElementById('qEyebrow');
  const qCatBadge = document.getElementById('qCatBadge');
  const ansBlock = document.getElementById('ansBlock');
  const ansText = document.getElementById('ansText');
  const attachedIds = ['atTL','atTR','atBL','atBR','atUnder','atOver','atDotL','atDotR'];

  function showAttached(show) {
    attachedIds.forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('show', show); });
  }

  if (p && p.id) {
    const catName = window.CAT_NAMES && window.CAT_NAMES[p.categoria];
    const catColor = window.CAT_COLORS && window.CAT_COLORS[p.categoria];
    if (catName && catColor) {
      const icon = CAT_ICONS[p.categoria] || '📌';
      qCatBadge.innerHTML = '<span class="cat-icon">' + icon + '</span><span></span>';
      qCatBadge.lastElementChild.textContent = catName;
      qCatBadge.style.background = catColor;
      qCatBadge.classList.add('show');
      qEye.textContent = catName;
    } else if (p.category && window.CAT_NAMES && window.CAT_NAMES[p.category]) {
      const icon = CAT_ICONS[p.category] || '📌';
      qCatBadge.innerHTML = '<span class="cat-icon">' + icon + '</span><span></span>';
      qCatBadge.lastElementChild.textContent = window.CAT_NAMES[p.category];
      qCatBadge.style.background = window.CAT_COLORS[p.category] || '#800020';
      qCatBadge.classList.add('show');
      qEye.textContent = window.CAT_NAMES[p.category];
    } else {
      qCatBadge.classList.remove('show');
      qCatBadge.innerHTML = '';
      qEye.textContent = 'Pregunta';
    }

    if (p.id !== currentQId) {
      currentQId = p.id;
      window._questionCount = (window._questionCount || 0) + 1;
      const qProgress = document.getElementById('qProgress');
      const qProgressBar = document.getElementById('qProgressBar');
      const qProgressText = document.getElementById('qProgressText');
      if (qProgress && qProgressBar && qProgressText) {
        qProgress.style.display = 'flex';
        qProgress.classList.add('active');
        qProgress.style.setProperty('--pct', Math.min((window._questionCount / 15) * 100, 100) + '%');
        qProgressText.textContent = window._questionCount + '/15';
      }
      qText.classList.remove('visible');
      qEye.classList.remove('visible');
      ansBlock.classList.remove('visible');
      showAttached(false);
      const optCont = document.getElementById('optionsContainer');
      optCont.innerHTML = '';
      optCont.classList.remove('show');
      _lastOptionsKey = '';
      setTimeout(() => {
        qText.classList.remove('empty');
        qText.textContent = p.texto;
        adjustTextSize(qText, p.texto);
        void qText.offsetWidth;
        if (typeof window._beforeQuestionVisible === 'function') window._beforeQuestionVisible(qText);
        qText.classList.add('visible');
        qEye.classList.add('visible');
        showAttached(true);
        renderOptions(p, mostrarOpc, mostrarResp, opcionSeleccionada);
      }, 360);
    } else {
      renderOptions(p, mostrarOpc, mostrarResp, opcionSeleccionada);
    }
    const resp = p.respuesta || '';
    adjustTextSize(ansText, resp);
    if (mostrarResp && resp) {
      if (!ansBlock.classList.contains('visible')) {
        ansBlock.classList.add('visible');
        setTimeout(() => typewriteText(ansText, resp, 300), 100);
      } else {
        ansText.textContent = resp;
      }
    } else {
      ansBlock.classList.remove('visible');
      ansText.textContent = '';
    }
  } else {
    if (currentQId !== null) {
      currentQId = null;
      qText.classList.remove('visible');
      qEye.classList.remove('visible');
      ansBlock.classList.remove('visible');
      showAttached(false);
      const optCont = document.getElementById('optionsContainer');
      optCont.innerHTML = '';
      optCont.classList.remove('show');
      document.getElementById('scoresZone')?.classList.remove('scores-compact');
      setTimeout(() => {
        qText.classList.add('empty');
        qText.textContent = 'Esperando pregunta…';
        adjustTextSize(qText, 'Esperando pregunta…');
        void qText.offsetWidth;
        if (typeof window._beforeQuestionVisible === 'function') window._beforeQuestionVisible(qText);
        qText.classList.add('visible');
      }, 380);
    }
  }
}
