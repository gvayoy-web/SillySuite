/*
 * Template Gallery — Centro de ayuda y catálogo de plantillas del constructor.
 *
 * Sistema de documentación autónomo para el constructor de modos (ScratchUI).
 * No depende de un builder concreto: se auto-inicializa, inyecta su propio CSS
 * y crea un botón flotante "❓ Ayuda" + un panel deslizante con pestañas.
 *
 * Si se conecta un builder (ScratchUI) vía setBuilder(), el catálogo de
 * plantillas permite cargar directamente aquellas que traen formato `heads`.
 *
 * Dependencias: ninguna obligatoria. Usa fetch hacia /api/templates si existe.
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'template-gallery-styles';

  class TemplateGallery {
    constructor(opts) {
      opts = opts || {};
      this.builder = opts.builder || null;
      this.apiBase = opts.apiBase || '/api/templates';
      this.scratchBase = opts.scratchBase || '/api/templates/scratch';
      this.docsBase = opts.docsBase || '/docs/modo-builder';
      this.floatingBtn = null;
      this.panel = null;
      this.cache = { templates: null, categories: null };
    }

    setBuilder(builder) {
      this.builder = builder;
      // Si el panel de plantillas está abierto, refresca la acción "cargar".
      if (this.panel && this.panel.querySelector('.tg-tab.active')) {
        const sec = this.panel.querySelector('.tg-tab.active').dataset.sec;
        if (sec === 'templates') this.showSection('templates');
      }
    }

    /* ---------- Montaje ---------- */
    mount() {
      if (this.floatingBtn) return;

      const btn = document.createElement('button');
      btn.className = 'tg-help-btn';
      btn.type = 'button';
      btn.innerHTML = '❓ <span class="tg-help-label">Ayuda</span>';
      btn.setAttribute('aria-label', 'Abrir documentación y plantillas');
      btn.addEventListener('click', () => this.toggle());
      document.body.appendChild(btn);
      this.floatingBtn = btn;

      const panel = document.createElement('aside');
      panel.className = 'tg-panel';
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML = `
        <div class="tg-panel-header">
          <strong>📚 Centro de ayuda del Constructor</strong>
          <button class="tg-close" type="button" aria-label="Cerrar">✕</button>
        </div>
        <nav class="tg-tabs">
          <button class="tg-tab active" data-sec="quickstart">Inicio</button>
          <button class="tg-tab" data-sec="templates">Plantillas</button>
          <button class="tg-tab" data-sec="tutorials">Tutoriales</button>
          <button class="tg-tab" data-sec="examples">Ejemplos</button>
          <button class="tg-tab" data-sec="support">Soporte</button>
        </nav>
        <div class="tg-content"></div>`;
      document.body.appendChild(panel);
      this.panel = panel;

      panel.querySelector('.tg-close').addEventListener('click', () => this.close());
      panel.querySelectorAll('.tg-tab').forEach((t) => {
        t.addEventListener('click', () => this.showSection(t.dataset.sec));
      });
      this.injectStyles();
      this.showSection('quickstart');
    }

    toggle() { this.panel.classList.contains('open') ? this.close() : this.open(); }
    open() { this.mount(); this.panel.classList.add('open'); this.panel.setAttribute('aria-hidden', 'false'); }
    close() { if (this.panel) { this.panel.classList.remove('open'); this.panel.setAttribute('aria-hidden', 'true'); } }

    showSection(sec) {
      if (!this.panel) return;
      this.panel.querySelectorAll('.tg-tab').forEach((t) =>
        t.classList.toggle('active', t.dataset.sec === sec));
      const content = this.panel.querySelector('.tg-content');
      if (sec === 'quickstart') content.innerHTML = this.renderQuickStart();
      else if (sec === 'templates') this.renderTemplates(content);
      else if (sec === 'tutorials') content.innerHTML = this.renderTutorials();
      else if (sec === 'examples') content.innerHTML = this.renderExamples();
      else if (sec === 'support') content.innerHTML = this.renderSupport();
    }

    /* ---------- Secciones estáticas ---------- */
    renderQuickStart() {
      const steps = [
        ['1. Elige un tema', 'Usa el bloque "aplicar tema" o "tema custom" para definir los colores.'],
        ['2. Añade contenido', 'Arrastra bloques de texto, imagen, video o audio desde la paleta.'],
        ['3. Configura el quiz', 'Init engine → siguiente pregunta → verificar respuesta → puntuar.'],
        ['4. Previsualiza', 'Pulsa 👁 Vista para ver el resultado en tiempo real.'],
        ['5. Exporta', 'Pulsa 💾 Exportar para descargar tu modo como JSON.']
      ];
      return `
        <div class="tg-section">
          <h4>🚀 Inicio rápido</h4>
          <ol class="tg-steps">
            ${steps.map(([t, d]) => `<li><strong>${t}</strong><p>${d}</p></li>`).join('')}
          </ol>
          <p class="tg-hint">Atajos: <code>Ctrl+Z</code> deshacer · <code>Ctrl+S</code> guardar · <code>Ctrl+E</code> exportar · <code>Supr</code> borrar bloque · <code>Ctrl+rueda</code> zoom</p>
        </div>`;
    }

    renderTutorials() {
      const items = [
        ['Guía básica del constructor', 'Conceptos fundamentales del editor visual, ideal para empezar.'],
        ['Bloques de Eventos (Hat)', 'Los 8 eventos que disparan cadenas: modo init, pregunta, respuesta, timer...'],
        ['Bloques Visuales / Looks', 'Temas, texto, animaciones, partículas, transiciones.'],
        ['Bloques de Medios', 'Imágenes, videos, fuentes personalizadas y fondos.'],
        ['Temas y Estilos personalizados', 'Crea tus propios temas con colores, gradientes, filtros y bordes.'],
        ['Audio y efectos de sonido', 'Música de fondo, SFX, ducking y control de volumen.'],
        ['Quiz y lógica de juego', 'Engine de preguntas, verificación, puntuación y leaderboard.'],
        ['Estado y variables', 'Variables en RAM, persistencia SQLite y snapshots.'],
        ['Concursantes y jugadores', 'Slots, strikes, lockouts, avatares y rankings.'],
        ['Exportar e importar', 'Guarda tu modo como JSON y compártelo.'],
        ['Modo oscuro', 'Alterna la interfaz a tema oscuro para trabajar de noche.']
      ];
      return `
        <div class="tg-section">
          <h4>📖 Tutoriales</h4>
          <ul class="tg-list">
            ${items.map(([t, d]) => `<li><strong>${t}</strong><p>${d}</p></li>`).join('')}
          </ul>
          <a class="tg-link" href="${this.docsBase}/tutorial" target="_blank" rel="noopener">Abrir documentación completa →</a>
        </div>`;
    }

    renderExamples() {
      const items = [
        ['🎯 Bienvenida con Color', 'Plantilla básica de bienvenida con tema y animación.'],
        ['📚 Quiz de Capitales', 'Quiz completo con engine, preguntas y verificación de respuestas.'],
        ['✅ Trivia Si / No', 'Trivia rápida con solo dos opciones: verdadero o falso.'],
        ['📊 Encuesta de Satisfacción', 'Recopila opiniones de los participantes al final del evento.'],
        ['💀 Modo Supervivencia', 'Eliminación progresiva. Último en pie gana.'],
        ['⚔️ Batalla 1v1', 'Duelo directo entre dos jugadores con marcador en vivo.'],
        ['📺 Quiz Show TV', 'Estilo programa de televisión con efectos dramáticos.'],
        ['🔥 Rapid Fire Challenge', 'Ráfaga de preguntas rápidas contra el cronómetro.']
      ];
      return `
        <div class="tg-section">
          <h4>💡 Ejemplos populares</h4>
          <ul class="tg-list">
            ${items.map(([t, d]) => `<li><strong>${t}</strong><p>${d}</p></li>`).join('')}
          </ul>
        </div>`;
    }

    renderSupport() {
      return `
        <div class="tg-section">
          <h4>🆘 Centro de ayuda</h4>
          <ul class="tg-list">
            <li><strong>📚 Documentación</strong><p>Guía completa con referencias.</p></li>
            <li><strong>🎥 Vídeos</strong><p>Videoguías paso a paso.</p></li>
            <li><strong>💬 Comunidad</strong><p>Comparte y resuelve dudas.</p></li>
            <li><strong>🐛 Reportar</strong><p>Avisa de errores para mejorar.</p></li>
          </ul>
          <a class="tg-link" href="${this.docsBase}" target="_blank" rel="noopener">Visitar centro de soporte →</a>
        </div>`;
    }

    /* ---------- Catálogo de plantillas (API de bloques del builder) ---------- */
    renderTemplates(content) {
      content.innerHTML = `<div class="tg-loading">Cargando plantillas…</div>`;
      this.fetchScratchTemplates().then((data) => {
        if (!this.panel || this.panel.querySelector('.tg-tab.active').dataset.sec !== 'templates') return;
        const templates = (data && data.templates) || [];
        if (templates.length === 0) {
          content.innerHTML = `<div class="tg-empty">No hay plantillas disponibles.</div>`;
          return;
        }
        const diffs = Array.from(new Set(templates.map((t) => t.difficulty || 'fácil')));
        const filter = `<div class="tg-filter">
            <button class="tg-chip active" data-cat="">Todas</button>
            ${diffs.map((d) => `<button class="tg-chip" data-cat="${d}">${d}</button>`).join('')}
          </div>`;
        const grid = `<div class="tg-cards">${templates.map((t) => this.templateCard(t)).join('')}</div>`;
        content.innerHTML = filter + grid;
        content.querySelectorAll('.tg-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            content.querySelectorAll('.tg-chip').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            const cat = chip.dataset.cat;
            content.querySelectorAll('.tg-card').forEach((card) => {
              const show = !cat || card.dataset.cat === cat;
              card.style.display = show ? '' : 'none';
            });
          });
        });
        content.querySelectorAll('.tg-card .tg-load').forEach((b) => {
          b.addEventListener('click', () => this.loadTemplateIntoBuilder(b.dataset.id));
        });
      }).catch(() => {
        if (this.panel && this.panel.querySelector('.tg-tab.active') &&
            this.panel.querySelector('.tg-tab.active').dataset.sec === 'templates') {
          content.innerHTML = `<div class="tg-empty">No se pudo cargar el catálogo. Verifica la conexión con el servidor.</div>`;
        }
      });
    }

    templateCard(t) {
      const tags = (t.tags || []).map((x) => `<span class="tg-tag">#${x}</span>`).join('');
      return `
        <div class="tg-card" data-cat="${t.difficulty || 'fácil'}">
          <div class="tg-card-icon">🧩</div>
          <div class="tg-card-body">
            <h5>${t.title || t.id}</h5>
            <p>${t.description || ''}</p>
            <div class="tg-card-meta">
              <span>🎚 ${t.difficulty || 'fácil'}</span>
              ${tags}
            </div>
          </div>
          <div class="tg-card-actions">
            <button class="tg-btn tg-load" data-id="${t.id}" type="button">Cargar en constructor</button>
          </div>
        </div>`;
    }

    fetchScratchTemplates() {
      if (this.cache.scratch) return Promise.resolve(this.cache.scratch);
      return fetch(this.scratchBase, { headers: { 'Accept': 'application/json' } })
        .then((r) => r.json())
        .then((data) => {
          this.cache.scratch = data && data.success ? data : { templates: [] };
          return this.cache.scratch;
        });
    }

    loadTemplateIntoBuilder(id) {
      if (!this.builder || typeof this.builder.loadTemplate !== 'function') {
        this.toast('Abre el constructor para cargar esta plantilla.', 'warn');
        return;
      }
      fetch(`${this.scratchBase}/${id}`, { headers: { 'Accept': 'application/json' } })
        .then((r) => r.json())
        .then((res) => {
          const tpl = res && res.template;
          if (tpl && tpl.heads) {
            this.builder.loadTemplate(tpl.heads);
            this.toast('Plantilla cargada en el constructor.', 'success');
            this.close();
          } else {
            this.toast('Esta plantilla no tiene bloques para el constructor.', 'info');
          }
        })
        .catch(() => this.toast('Error al cargar la plantilla.', 'error'));
    }

    toast(msg, type) {
      const el = document.createElement('div');
      el.className = 'tg-toast tg-toast-' + (type || 'info');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.classList.add('show'), 10);
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
    }

    /* ---------- Estilos inyectados ---------- */
    injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .tg-help-btn {
          position: fixed; right: 18px; bottom: 18px; z-index: 9000;
          display: inline-flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg, #3b82f6, #0ea5e9);
          color: #fff; border: none; border-radius: 999px;
          padding: 10px 16px; font: 600 14px/1 var(--font-family-sans, sans-serif);
          box-shadow: 0 10px 25px rgba(0,0,0,.25); cursor: pointer;
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .tg-help-btn:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(0,0,0,.3); }
        .tg-panel {
          position: fixed; top: 0; right: 0; height: 100vh; width: 380px; max-width: 92vw;
          background: var(--bg-secondary, #1e293b); color: var(--text-primary, #f1f5f9);
          border-left: 1px solid var(--border-color, #334155);
          box-shadow: -10px 0 30px rgba(0,0,0,.35); z-index: 9001;
          transform: translateX(100%); transition: transform .25s ease;
          display: flex; flex-direction: column; font: 14px/1.5 var(--font-family-sans, sans-serif);
        }
        .tg-panel.open { transform: translateX(0); }
        .tg-panel-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid var(--border-color, #334155);
        }
        .tg-close { background: none; border: none; color: inherit; font-size: 18px; cursor: pointer; }
        .tg-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #334155); }
        .tg-tab {
          background: transparent; border: 1px solid transparent; color: var(--text-secondary, #94a3b8);
          padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 13px;
        }
        .tg-tab.active { background: var(--bg-tertiary, #334155); color: var(--text-primary, #f1f5f9); }
        .tg-content { padding: 14px 16px; overflow-y: auto; }
        .tg-section h4 { margin: 0 0 10px; }
        .tg-steps, .tg-list { margin: 0; padding-left: 18px; }
        .tg-steps li, .tg-list li { margin-bottom: 10px; }
        .tg-steps p, .tg-list p { margin: 2px 0 0; color: var(--text-secondary, #94a3b8); }
        .tg-hint { color: var(--text-muted, #64748b); font-size: 12px; }
        .tg-link { display: inline-block; margin-top: 8px; color: var(--info-color, #0ea5e9); text-decoration: none; }
        .tg-loading, .tg-empty { color: var(--text-secondary, #94a3b8); padding: 12px 0; }
        .tg-filter { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .tg-chip {
          background: var(--bg-tertiary, #334155); border: 1px solid var(--border-color, #334155);
          color: var(--text-secondary, #94a3b8); border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px;
        }
        .tg-chip.active { color: #fff; border-color: var(--primary-color, #3b82f6); }
        .tg-cards { display: grid; gap: 10px; }
        .tg-card {
          display: flex; gap: 10px; align-items: center; background: var(--bg-primary, #0f172a);
          border: 1px solid var(--border-color, #334155); border-radius: 10px; padding: 10px;
        }
        .tg-card-icon { font-size: 24px; }
        .tg-card-body { flex: 1; min-width: 0; }
        .tg-card-body h5 { margin: 0 0 2px; font-size: 14px; }
        .tg-card-body p { margin: 0; font-size: 12px; color: var(--text-secondary, #94a3b8);
          overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .tg-card-meta { display: flex; gap: 10px; font-size: 11px; color: var(--text-muted, #64748b); margin-top: 4px; }
        .tg-btn {
          background: var(--primary-color, #3b82f6); color: #fff; border: none; border-radius: 8px;
          padding: 6px 10px; cursor: pointer; font-size: 12px; white-space: nowrap;
        }
        .tg-btn:hover { filter: brightness(1.1); }
        .tg-toast {
          position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px);
          background: var(--bg-tertiary, #334155); color: #fff; padding: 10px 16px; border-radius: 10px;
          box-shadow: 0 10px 25px rgba(0,0,0,.3); opacity: 0; transition: opacity .25s ease, transform .25s ease; z-index: 9100;
        }
        .tg-toast.show { opacity: 1; transform: translate(-50%, 0); }
        .tg-toast-success { background: linear-gradient(135deg, #10b981, #059669); }
        .tg-toast-error { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .tg-toast-warn { background: linear-gradient(135deg, #f59e0b, #d97706); }
      `;
      document.head.appendChild(style);
    }
  }

  global.TemplateGallery = TemplateGallery;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TemplateGallery };

  /* Auto-inicialización: crea el botón y panel en cuanto el DOM esté listo. */
  function autoInit() {
    const gal = new TemplateGallery({ builder: global.scratchUI || null });
    global.templateGallery = gal;
    gal.mount();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
    else autoInit();
  }
})(typeof window !== 'undefined' ? window : this);
