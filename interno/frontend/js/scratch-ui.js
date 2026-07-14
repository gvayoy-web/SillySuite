/**
 * scratch-ui.js — Editor visual del Infinite Canvas Builder v2.1
 *
 * MVP funcional (los conectores puzzle y drag-drop avatar se añaden en la fase
 * de CSS/UX final). Construye la paleta desde ScratchBlocks, renderiza scripts
 * por evento Hat, edita argumentos inline, compila con ScratchAOT, ejecuta con
 * ScratchRuntime y muestra el Visual Stepper en vivo sobre #block-console.
 *
 * Dependencias: scratch-blocks.js, scratch-runtime.js (window globals).
 */
(function (global) {
  'use strict';

  const BLOCK_ICON = '🧩';

  class ScratchUI {
    constructor(root, opts) {
      opts = opts || {};
      this.root = root;
      this.providers = opts.providers || null; // inyectado por modo-builder-v2.js
      this.activeEvent = null;
      this.heads = {};            // eventOpcode -> ARRAY de stacks (cada stack = cadena de instancias)
      this.selected = null;
      this.domMap = {};           // _id -> elemento DOM
      this._idCounter = 0;
      this.snapshots = [];
      this.trace = [];
      this.runtime = null;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this._drag = null;
      this.init();
    }

    init() {
      this.buildSkeleton();
      this.collectHats();
      this.buildPalette();
      this.buildEventTabs();
      this.bindToolbar();
      this.bindKeys();
      this.bindDnD();
      this.bindContextMenu();
      const firstHat = Object.keys(this.heads)[0];
      if (firstHat) this.selectEvent(firstHat);
      this.pushSnapshot();
      const loaded = this.autoLoad();
      if (!loaded) this.ensureDefaultState();
    }

    /* ---- Estructura DOM ---- */
    buildSkeleton() {
      this.root.innerHTML = `
        <div class="scratch-app" role="application" aria-label="SillyQuiz Builder">
          <div class="scratch-toolbar" role="toolbar" aria-label="Herramientas">
            <span class="sb-brand"><span class="sb-logo" aria-hidden="true">◆</span> Modo&nbsp;Builder</span>
            <span class="sb-divider" aria-hidden="true"></span>
            <button class="toolbar-btn primary" data-act="run" aria-label="Ejecutar programa">▶ Ejecutar</button>
            <button class="toolbar-btn danger" data-act="panic" aria-label="Detener todo">⏹ Pánico</button>
            <button class="toolbar-btn" data-act="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↶ Deshacer</button>
            <button class="toolbar-btn" data-act="redo" title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">↷ Rehacer</button>
            <button class="toolbar-btn" data-act="clear" aria-label="Limpiar lienzo">🗑 Limpiar</button>
            <button class="toolbar-btn" data-act="preview" aria-label="Vista previa">👁 Vista</button>
            <span class="spacer"></span>
            <button class="toolbar-btn" data-act="context" aria-label="Menú">⋮</button>
          </div>
          <div class="scratch-body">
            <aside class="scratch-palette" id="sbPalette" role="region" aria-label="Paleta de bloques"></aside>
            <div class="scratch-canvas-wrap">
              <div class="event-tabs" id="sbTabs" role="tablist" aria-label="Eventos"></div>
              <div class="scratch-canvas" id="sbCanvas" role="region" aria-label="Lienzo de bloques" tabindex="0"></div>
              <div class="block-console" id="sbConsole" role="log" aria-label="Consola de depuración" aria-live="polite"></div>
              <div class="live-preview" id="sbPreview" data-open="0" role="region" aria-label="Vista previa"></div>
            </div>
            <div class="scratch-stage-wrap" id="sbStageWrap" role="region" aria-label="Stage Preview" data-open="0"></div>
            <aside class="scratch-inspector" id="sbInspector" role="region" aria-label="Inspector de bloques"></aside>
          </div>
        </div>`;
      this.elPalette = this.root.querySelector('#sbPalette');
      this.elTabs = this.root.querySelector('#sbTabs');
      this.elCanvas = this.root.querySelector('#sbCanvas');
      this.elConsole = this.root.querySelector('#sbConsole');
      this.elInspector = this.root.querySelector('#sbInspector');
      this.elPreview = this.root.querySelector('#sbPreview');
      this._previewTimer = null;
      this._currentCategory = null; // Para trackear la categoría seleccionada
      // Cualquier edición inline en el lienzo actualiza la vista previa en vivo.
      this.elCanvas.addEventListener('input', () => this.schedulePreview());
      this.elCanvas.addEventListener('change', () => this.schedulePreview());
    }

    collectHats() {
      ScratchBlocks.all().forEach(op => {
        const def = ScratchBlocks.get(op);
        if (def.type === 'hat') this.heads[op] = [ this.makeInst(op) ];
      });
    }

    /* Devuelve el stack "principal" de un evento: el primero que empieza por un Hat. */
    _mainStack(ev) {
      const stacks = this.heads[ev];
      if (!stacks || !stacks.length) return null;
      return stacks.find(s => s && ScratchBlocks.get(s.opcode) && ScratchBlocks.get(s.opcode).type === 'hat') || stacks[0];
    }

    makeInst(opcode) {
      const def = ScratchBlocks.get(opcode);
      const args = {};
      Object.keys(def.args).forEach(tok => {
        const s = def.args[tok];
        if (s.default !== undefined) args[tok] = s.default;
        else if (s.type === 'boolean') args[tok] = false;
        else if (s.type === 'number' || s.type === 'slider') args[tok] = 0;
        else args[tok] = '';
      });
      return { opcode, args, next: null, _id: ++this._idCounter };
    }

    /* ---- Paleta Mejorada con Dropdowns ---- */
    buildPalette() {
      const cats = ScratchBlocks.categoriesOrdered();
      const searchBox = `
        <div class="palette-search">
          <input type="search" id="sbPaletteSearch" placeholder="🔍 Buscar bloque…" autocomplete="off" />
        </div>`;
      const dropdownMenu = `
        <div class="palette-dropdown-container">
          <button class="dropdown-btn" data-toggle="palette-dropdown" aria-expanded="false" aria-haspopup="true">
            <span class="dropdown-icon">📦</span>
            <span class="dropdown-text">Categorías de bloques</span>
            <span class="dropdown-arrow">▼</span>
          </button>
          <div class="palette-dropdown" id="paletteDropdown">
            ${cats.map(cat => `
              <div class="dropdown-category-item" data-cat="${cat.id}" role="option" aria-label="${cat.label}">
                <span class="category-badge" style="background:var(${cat.colorVar})" aria-hidden="true"></span>
                <span class="category-label">${cat.label}</span>
                <span class="category-count">${ScratchBlocks.byCategory(cat.id).length}</span>
              </div>
            `).join('')
            }
          </div>
        </div>`;
      
      this.elPalette.innerHTML = searchBox + dropdownMenu;

      this.setupPaletteDropdown();

      const search = this.elPalette.querySelector('#sbPaletteSearch');
      if (search) {
        search.addEventListener('input', () => this.filterPalette(search.value));
        search.addEventListener('keydown', e => e.stopPropagation());
      }
    }

    /* Configurar menú desplegable para la paleta */
    setupPaletteDropdown() {
      const dropdownBtn = this.elPalette.querySelector('.dropdown-btn');
      const paletteDropdown = this.elPalette.querySelector('#paletteDropdown');
      
      if (!dropdownBtn || !paletteDropdown) return;
      
      // Toggle del menú desplegable
      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = dropdownBtn.getAttribute('aria-expanded') === 'true';
        dropdownBtn.setAttribute('aria-expanded', String(!isExpanded));
        paletteDropdown.classList.toggle('show');
      });
      
      // Cerrar el menú al hacer clic fuera
      document.addEventListener('click', () => {
        if (paletteDropdown.classList.contains('show')) {
          paletteDropdown.classList.remove('show');
          dropdownBtn.setAttribute('aria-expanded', 'false');
        }
      });
      
      // Seleccionar categoría desde el desplegable
      paletteDropdown.querySelectorAll('.dropdown-category-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const catId = item.dataset.cat;
          this.selectCategoryFromDropdown(catId);
          paletteDropdown.classList.remove('show');
          dropdownBtn.setAttribute('aria-expanded', 'false');
        });
        
        // Añadir soporte para teclado
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });
      
      // Cargar las categorías visibles inicialmente
      this.updatePaletteDisplay();
    }

    /* Seleccionar una categoría desde el dropdown */
    selectCategoryFromDropdown(catId) {
      // Guardar la categoría seleccionada
      this._currentCategory = catId;
      
      // Mover los bloques de la categoría seleccionada a la vista principal
      this.updatePaletteDisplay();
      
      // Log para debugging
      this.log('info', 'Categoría seleccionada: ' + ScratchBlocks.categoriesOrdered().find(c => c.id === catId)?.label || catId);
    }

    /* Actualizar el display de la paleta basado en la categoría seleccionada */
    updatePaletteDisplay() {
      const catId = this._currentCategory || 'all';
      let blocks;
      
      if (catId === 'all') {
        blocks = ScratchBlocks.all().filter(def => def.type !== 'hat');
        this.elPalette.classList.add('show-all');
      } else {
        blocks = ScratchBlocks.byCategory(catId);
        this.elPalette.classList.remove('show-all');
      }
      
      // Generar HTML de bloques con diseños específicos por tipo
      const items = blocks.map(def => {
        const category = ScratchBlocks.categoriesOrdered().find(c => c.id === catId) || {
          label: 'Other',
          colorVar: '--builder-primary'
        };
        
        const blockHtml = `
          <div class="palette-block block-${def.type} block-${def.category}" 
               data-op="${def.opcode}" 
               draggable="true" 
               style="--block-color:var(${category.colorVar})" 
               role="option" 
               aria-label="${this.humanize(def.opcode)} - ${def.type}"
               title="${def.type}: ${this.humanize(def.opcode)}">
            <span class="pb-icon" aria-hidden="true">${BLOCK_ICON}</span>
            <span class="pb-label">${this.humanize(def.opcode)}</span>
            <span class="pb-type ${def.type}">${this.getBlockTypeIcon(def.type)}</span>
            <span class="pb-category-tag">${def.category}</span>
            ${this.getBlockStyleIndicator(def.type)}
          </div>`;
        
        return blockHtml;
      }).join('');
      
      // Añadir el contenido al palette (si existe)
      if (this.elPalette) {
        // Obtener el contenedor de bloques, si existe
        const paletteContent = this.elPalette.querySelector('.palette-category-content') || this.elPalette;
        if (paletteContent) {
          paletteContent.innerHTML = items;
          
          // Añadir event listeners a los nuevos bloques
          paletteContent.querySelectorAll('.palette-block').forEach(b => {
            b.addEventListener('click', () => this.addBlock(b.dataset.op));
            b.addEventListener('dragstart', (e) => this.handleDragStart(e, b.dataset.op));
          });
        } else {
          this.elPalette.innerHTML = items;
        }
      }
    }

    /* Obtener icono para el tipo de bloque */
    getBlockTypeIcon(type) {
      const icons = {
        'hat': '🧢',
        'reporter': '📊',
        'boolean': '⭕',
        'command': '▶',
        'motion': '🚶',
        'looks': '🎨',
        'sound': '🔊',
        'pen': '✏️',
        'data': '📊',
        'event': '⚡',
        'control': '🔧',
        'sensing': '👁️',
        'operator': '⚙️',
        'variable': '📝',
        'list': '📋',
        'procedure': '📖'
      };
      return icons[type] || '📦';
    }

    /* Obtener indicador de estilo específico para el tipo de bloque */
    getBlockStyleIndicator(type) {
      const indicators = {
        'hat': '<div class="block-style-indicator hat-indicator" aria-hidden="true">H</div>',
        'reporter': '<div class="block-style-indicator reporter-indicator" aria-hidden="true">R</div>',
        'boolean': '<div class="block-style-indicator boolean-indicator" aria-hidden="true">○</div>',
        'command': '<div class="block-style-indicator command-indicator" aria-hidden="true">▶</div>',
        'control': '<div class="block-style-indicator control-indicator" aria-hidden="true">⚙️</div>',
        'operator': '<div class="block-style-indicator operator-indicator" aria-hidden="true">∑</div>',
        'event': '<div class="block-style-indicator event-indicator" aria-hidden="true">⚡</div>',
        'variable': '<div class="block-style-indicator variable-indicator" aria-hidden="true">?</div>',
        'list': '<div class="block-style-indicator list-indicator" aria-hidden="true">[]</div>',
        'reporter': '<div class="block-style-indicator reporter-indicator" aria-hidden="true">□</div>',
        'boolean': '<div class="block-style-indicator boolean-indicator" aria-hidden="true">⬚</div>'
      };
      return indicators[type] || '';
    }

    /* Manejar el inicio del arrastre para bloques */
    handleDragStart(e, opcode) {
      const blockEl = e.target.closest('.palette-block');
      if (blockEl) {
        const def = ScratchBlocks.get(opcode);
        e.dataTransfer.setData('text/plain', opcode);
        e.dataTransfer.effectAllowed = 'copy';
        
        // Añadir clases para estilos visuales específicos
        blockEl.classList.add('dragging', `dragging-${def.type}`);
        
        if (def.type === 'hat') {
          blockEl.classList.add('hat-dragging');
        } else if (def.type === 'reporter') {
          blockEl.classList.add('reporter-dragging');
        } else if (def.type === 'boolean') {
          blockEl.classList.add('boolean-dragging');
        }
        
        // Forzar la visibilidad del elemento para drag & drop
        blockEl.style.display = 'block';
        
        // Guardar el elemento para el dragend
        if (this._dragElementCleanup) clearTimeout(this._dragElementCleanup);
        this._dragElementCleanup = setTimeout(() => {
          blockEl.classList.remove('dragging', 'dragging-hat', 'dragging-reporter', 'dragging-boolean');
          blockEl.style.display = '';
        }, 100);
      }
    }

    /* Filtra la paleta por opcode o etiqueta legible en vivo. Soporte fuzzy. */
    filterPalette(q) {
      q = (q || '').toLowerCase().trim();
      this.elPalette.querySelectorAll('.palette-block').forEach(b => {
        const op = b.dataset.op;
        const label = this.humanize(op).toLowerCase();
        const hit = !q || this._fuzzyMatch(q, op.toLowerCase()) || this._fuzzyMatch(q, label);
        b.classList.toggle('hidden', !hit);
        if (hit && q) {
          b.style.order = this._fuzzyScore(q, label);
        } else {
          b.style.order = '';
        }
      });
      this.elPalette.querySelectorAll('.palette-category').forEach(cat => {
        const anyVisible = cat.querySelector('.palette-block:not(.hidden)');
        cat.classList.toggle('hidden', !anyVisible);
        if (anyVisible && q) {
          cat.classList.remove('collapsed');
        }
      });
    }

    _fuzzyMatch(query, target) {
      let qi = 0;
      for (let ti = 0; ti < target.length && qi < query.length; ti++) {
        if (target[ti] === query[qi]) qi++;
      }
      return qi === query.length;
    }

    _fuzzyScore(query, target) {
      let score = 0;
      let qi = 0;
      for (let ti = 0; ti < target.length && qi < query.length; ti++) {
        if (target[ti] === query[qi]) {
          score += (ti === 0 || target[ti - 1] === ' ') ? 10 : 1;
          qi++;
        }
      }
      return -score;
    }

    humanize(op) {
      return op.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /* ---- Pestañas de evento ---- */
    renderTabs() {
      this.elTabs.innerHTML = Object.keys(this.heads).map(ev => `
        <div class="event-tab" data-ev="${ev}" role="tab" tabindex="0" aria-selected="false" aria-label="${this.humanize(ev)}">${this.humanize(ev)}</div>`).join('');
      this.elTabs.querySelectorAll('.event-tab').forEach(t => {
        t.addEventListener('click', () => this.selectEvent(t.dataset.ev));
        t.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.selectEvent(t.dataset.ev);
          }
        });
      });
    }

    buildEventTabs() { this.renderTabs(); }

    selectEvent(ev) {
      this.activeEvent = ev;
      this.elTabs.querySelectorAll('.event-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.ev === ev);
      });
      this.renderCanvas();
    }

    /* ---- Añadir bloque (al final del stack principal del evento activo) ---- */
    addBlock(opcode) {
      const def = ScratchBlocks.get(opcode);
      if (!def) return;
      if (def.type === 'hat') { this.selectEvent(opcode); return; }
      const stacks = this.heads[this.activeEvent] || (this.heads[this.activeEvent] = []);
      let main = this._mainStack(this.activeEvent);
      if (!main) { main = this.makeInst(this._firstHatOpcode()); stacks.push(main); }
      let cur = main;
      while (cur.next) cur = cur.next;
      cur.next = this.makeInst(opcode);
      this._registerUIControl(cur.next);
      this.renderCanvas();
      this.pushSnapshot();
      this.log('info', 'Añadido: ' + opcode);
    }

    _firstHatOpcode() {
      const ops = ScratchBlocks.all();
      for (let i = 0; i < ops.length; i++) {
        if (ScratchBlocks.get(ops[i]).type === 'hat') return ops[i];
      }
      return null;
    }

    /* ---- Render del lienzo (varios stacks por evento) ---- */
    renderCanvas() {
      this.domMap = {};
      const stacks = this.heads[this.activeEvent] || [];
      if (!stacks.length) {
        this.elCanvas.innerHTML = '<div class="empty-hint">Arrastra bloques desde la paleta, o pulsa un bloque para añadirlo.</div>';
        return;
      }
      this.elCanvas.innerHTML = '';
      const inner = document.createElement('div');
      inner.className = 'scratch-canvas-inner';
      inner.style.transformOrigin = 'center center';
      stacks.forEach((stack, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'scratch-stack';
        wrap.dataset.stack = i;
        this.renderChain(stack, wrap, 0);
        inner.appendChild(wrap);
      });
      this.elCanvas.appendChild(inner);
      this.applyTransform();
    }

    renderChain(inst, container, depth) {
      const frag = document.createDocumentFragment();
      let cur = inst;
      while (cur) {
        const el = this.blockEl(cur, depth);
        frag.appendChild(el);
        if (cur._id != null) this.domMap[cur._id] = el;
        cur = cur.next;
      }
      container.appendChild(frag);
    }

    blockEl(inst, depth) {
      const def = ScratchBlocks.get(inst.opcode);
      if (!def) {
        const el = document.createElement('div');
        el.className = 'scratch-block block-custom block-error-block';
        el.style.marginLeft = (depth * 22) + 'px';
        el.dataset.bid = inst._id || 0;
        el.innerHTML = '<span style="color:#f7768e;">⚠ opcode inválido: ' + this._esc(inst.opcode || '?') + '</span>';
        return el;
      }
      const el = document.createElement('div');
      el.className = 'scratch-block block-' + def.category +
        (def.type === 'hat' ? ' block-hat' :
         def.type === 'reporter' ? ' block-reporter' :
         def.type === 'boolean' ? ' block-boolean' : '');
      el.style.marginLeft = (depth * 22) + 'px';
      el.dataset.bid = inst._id;
      el.dataset.op = inst.opcode;
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => {
        this._drag = { type: 'move', id: inst._id };
        try { e.dataTransfer.setData('text/plain', String(inst._id)); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
        el.classList.add('block-dragging');
      });
      el.addEventListener('dragend', () => { el.classList.remove('block-dragging'); this._clearDropMarkers(); });
      el.innerHTML = this.renderText(def, inst);
      el.setAttribute('role', 'listitem');
      el.setAttribute('aria-label', this.humanize(inst.opcode));
      el.setAttribute('aria-roledescription', def.type + ' block');
      el.querySelectorAll('[data-arg]').forEach(inp => {
        const handler = () => {
          const spec = def.args[inp.dataset.arg];
          let val;
          if (inp.type === 'checkbox') val = inp.checked;
          else if (spec.type === 'number' || spec.type === 'slider') val = inp.value === '' ? (spec.default || 0) : Number(inp.value);
          else val = inp.value;
          inst.args[inp.dataset.arg] = val;
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
      el.addEventListener('click', e => {
        if (['INPUT', 'SELECT', 'TEXTAREA'].indexOf(e.target.tagName) >= 0) return;
        this.selectBlock(inst);
      });
      // Cuerpos de contenedores — drop zones anidadas
      if (def.hasBody && def.bodies) {
        def.bodies.forEach(b => {
          const zone = document.createElement('div');
          zone.className = 'scratch-block-body-zone';
          zone.dataset.body = b;
          zone.dataset.parentId = inst._id;
          zone.style.marginLeft = ((depth + 1) * 22) + 'px';
          zone.style.borderLeft = '3px solid var(--border-secondary,#484f58)';
          zone.style.paddingLeft = '10px';
          zone.style.minHeight = '28px';
          zone.style.position = 'relative';

          const label = document.createElement('div');
          label.className = 'scratch-block-body-label';
          label.textContent = b === 'elseBody' ? 'si no:' : b === 'fallback' ? 'si falla:' : '';
          label.style.fontSize = '0.65rem';
          label.style.fontWeight = '800';
          label.style.textTransform = 'uppercase';
          label.style.letterSpacing = '0.08em';
          label.style.color = 'var(--text-muted,#8b949e)';
          label.style.marginBottom = '4px';
          zone.appendChild(label);

          const content = document.createElement('div');
          content.className = 'scratch-block-body-content';
          content.dataset.body = b;
          content.dataset.parentId = inst._id;
          content.style.minHeight = '20px';
          content.style.position = 'relative';

          // Render nested blocks if they exist
          const bodyData = inst[b];
          if (bodyData && ((Array.isArray(bodyData) && bodyData.length > 0) || (bodyData.opcode))) {
            this.renderChain(bodyData, content, depth + 2);
          } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'scratch-block-body-placeholder';
            placeholder.textContent = 'Arrastra bloques aquí';
            placeholder.style.color = 'var(--text-muted,#8b949e)';
            placeholder.style.fontSize = '0.7rem';
            placeholder.style.fontStyle = 'italic';
            placeholder.style.padding = '4px 0';
            content.appendChild(placeholder);
          }

          // Drop zone events
          content.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            content.classList.add('body-drop-active');
          });
          content.addEventListener('dragleave', () => {
            content.classList.remove('body-drop-active');
          });
          content.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            content.classList.remove('body-drop-active');
            const dragData = this._drag;
            if (!dragData) return;
            this._dropIntoBody(inst, b, dragData, content);
          });

          zone.appendChild(content);
          el.appendChild(zone);
        });
      }
      return el;
    }

    renderText(def, inst) {
      return def.text.replace(/\[([A-Z_]+)\]/g, (m, token) => {
        if (!def.args[token]) return m;
        return this.argInput(def.args[token], token, inst.args[token]);
      });
    }

    argInput(spec, token, value) {
      const v = value == null ? '' : value;
      if (spec.type === 'boolean') {
        return `<input class="arg" data-arg="${token}" type="checkbox" ${v ? 'checked' : ''}>`;
      }
      if (spec.type === 'textarea') {
        return `<textarea class="arg" data-arg="${token}" rows="2" style="width:160px">${v}</textarea>`;
      }
      if (spec.type === 'dropdown') {
        const opts = Array.isArray(spec.options) ? spec.options : ['auto'];
        return `<select class="arg" data-arg="${token}">` +
          opts.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${o}</option>`).join('') + `</select>`;
      }
      if (spec.type === 'slider') {
        return `<input class="arg" data-arg="${token}" type="range" min="0" max="100" value="${v}">`;
      }
      const inputType = (spec.type === 'number') ? 'number' : 'text';
      return `<input class="arg" data-arg="${token}" type="${inputType}" value="${v}" style="width:70px">`;
    }

    /* ---- Inspector + selección ---- */
    selectBlock(inst) {
      this.selected = inst;
      const def = ScratchBlocks.get(inst.opcode);
      const fields = Object.keys(def.args).map(tok => {
        const spec = def.args[tok];
        const label = this.humanize(tok) + (spec.port ? ` <span class="port-dot ${spec.port}"></span>` : '');
        return `<div class="inspector-field"><label>${label}</label><code>${JSON.stringify(inst.args[tok])}</code></div>`;
      }).join('');
      this.elInspector.innerHTML = `
        <h4>${this.humanize(inst.opcode)}</h4>
        <div class="inspector-meta">categoría: <code>${def.category}</code> · tipo: <code>${def.type}</code></div>
        ${fields || '<div class="inspector-empty">Sin argumentos</div>'}
        ${this._renderUIControlSummary(inst)}
        <button class="btn-sm" data-act="delete">🗑 Eliminar bloque</button>`;
      this.elInspector.querySelector('[data-act="delete"]').addEventListener('click', () => this.deleteSelected());
      this.elCanvas.querySelectorAll('.scratch-block').forEach(e => e.style.outline = '');
      const el = this.domMap[inst._id];
      if (el) el.style.outline = '2px solid var(--cat-control,#ff6b4a)';
    }

    deleteSelected() {
      if (!this.selected) return;
      const stacks = this.heads[this.activeEvent] || [];
      for (let s = 0; s < stacks.length; s++) {
        let cur = stacks[s];
        if (cur === this.selected) {
          // Borrar un stack entero (p.ej. un stack libre sin Hat)
          if (stacks.length > 1) stacks.splice(s, 1);
          this.selected = null; this.renderCanvas(); this.pushSnapshot(); return;
        }
        if (cur.opcode && ScratchBlocks.get(cur.opcode) && ScratchBlocks.get(cur.opcode).type === 'hat' && cur === this._mainStack(this.activeEvent)) {
          // No borrar la raíz Hat del stack principal
          if (this.selected === cur) return;
        }
        while (cur.next) {
          if (cur.next === this.selected) { cur.next = this.selected.next; break; }
          cur = cur.next;
        }
      }
      this.selected = null;
      this.renderCanvas();
      this.pushSnapshot();
    }

    _dropIntoBody(parentInst, bodyName, dragData, dropEl) {
      if (!dragData || !parentInst) return;
      let droppedInst = null;
      if (dragData.type === 'new') {
        droppedInst = this.newInstance(dragData.opcode);
      } else if (dragData.type === 'move') {
        droppedInst = this._findInstance(dragData.id);
        if (droppedInst) this._removeFromCurrentParent(droppedInst);
      }
      if (!droppedInst) return;
      if (!parentInst[bodyName] || !Array.isArray(parentInst[bodyName])) {
        parentInst[bodyName] = [];
      }
      parentInst[bodyName].push(droppedInst);
      this._drag = null;
      this.renderCanvas();
      this.pushSnapshot();
    }

    _findInstance(id) {
      const stacks = this.heads[this.activeEvent] || [];
      for (const stack of stacks) {
        const found = this._searchChain(stack, id);
        if (found) return found;
      }
      return null;
    }

    _searchChain(node, id) {
      if (!node) return null;
      if (node._id === id) return node;
      const def = node.opcode ? ScratchBlocks.get(node.opcode) : null;
      if (def && def.hasBody && def.bodies) {
        for (const b of def.bodies) {
          const body = node[b];
          if (Array.isArray(body)) {
            for (const child of body) {
              const found = this._searchChain(child, id);
              if (found) return found;
            }
          } else if (body && body._id === id) {
            return body;
          }
        }
      }
      return this._searchChain(node.next, id);
    }

    _removeFromCurrentParent(inst) {
      const stacks = this.heads[this.activeEvent] || [];
      for (const stack of stacks) {
        if (this._removeFromChain(stack, inst)) return;
      }
    }

    _removeFromChain(node, target) {
      if (!node) return false;
      const def = node.opcode ? ScratchBlocks.get(node.opcode) : null;
      if (def && def.hasBody && def.bodies) {
        for (const b of def.bodies) {
          const body = node[b];
          if (Array.isArray(body)) {
            const idx = body.indexOf(target);
            if (idx >= 0) { body.splice(idx, 1); return true; }
            for (const child of body) {
              if (this._removeFromChain(child, target)) return true;
            }
          }
        }
      }
      if (node.next === target) { node.next = target.next; target.next = null; return true; }
      return this._removeFromChain(node.next, target);
    }

    /* ---- Toolbar / teclado ---- */
    bindToolbar() {
      this.root.querySelector('.scratch-toolbar').addEventListener('click', e => {
        const act = e.target.dataset.act;
        if (!act) return;
        if (act === 'run') this.run();
        else if (act === 'panic') this.panic();
        else if (act === 'undo') this.undo();
        else if (act === 'redo') this.redo();
        else if (act === 'clear') this.clearCanvas();
        else if (act === 'preview') this.togglePreview();
        else if (act === 'context') this.toggleContextMenu();
      });
    }

    bindKeys() {
      this._boundKeydown = (e => {
        if (e.code === 'Space') { window.__sbSpaceDown = true; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); this.redo(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
        if (e.key === 'Delete' && this.selected) this.deleteSelected();
        if (e.key === 'Escape') {
          this._hideContextMenu();
        }
      });
      this._boundKeyup = (e => {
        if (e.code === 'Space') { window.__sbSpaceDown = false; }
      });
      document.addEventListener('keydown', this._boundKeydown);
      document.addEventListener('keyup', this._boundKeyup);
    }

    /* ---- Quick-Add Context Menu ---- */
    bindContextMenu() {
      this.elCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e.clientX, e.clientY);
      });
      this._boundDocClick = () => this._hideContextMenu();
      document.addEventListener('click', this._boundDocClick);
    }

    _showContextMenu(x, y) {
      this._hideContextMenu();
      const menu = document.createElement('div');
      menu.className = 'scratch-context-menu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';

      const recentBlocks = this._getRecentBlocks();
      const favorites = this._getFavoriteBlocks();

      let html = '';
      if (favorites.length > 0) {
        html += '<div class="context-menu-section"><div class="context-menu-label">⭐ Favoritos</div>';
        favorites.forEach(op => {
          html += `<div class="context-menu-item" data-op="${op}"><span class="context-menu-icon">🧩</span>${this.humanize(op)}</div>`;
        });
        html += '</div>';
      }
      if (recentBlocks.length > 0) {
        html += '<div class="context-menu-section"><div class="context-menu-label">🕐 Recientes</div>';
        recentBlocks.forEach(op => {
          html += `<div class="context-menu-item" data-op="${op}"><span class="context-menu-icon">🧩</span>${this.humanize(op)}</div>`;
        });
        html += '</div>';
      }
      html += '<div class="context-menu-section"><div class="context-menu-label">🔍 Buscar</div>';
      html += '<input type="text" class="context-menu-search" placeholder="Escribe para buscar..." autofocus />';
      html += '<div class="context-menu-search-results"></div>';
      html += '</div>';

      menu.innerHTML = html;
      document.body.appendChild(menu);
      this._contextMenu = menu;

      const searchInput = menu.querySelector('.context-menu-search');
      const resultsContainer = menu.querySelector('.context-menu-search-results');

      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        if (!q) {
          resultsContainer.innerHTML = '';
          return;
        }
        const allOps = ScratchBlocks.all();
        const matches = allOps.filter(op => {
          const label = this.humanize(op).toLowerCase();
          return this._fuzzyMatch(q, op.toLowerCase()) || this._fuzzyMatch(q, label);
        }).slice(0, 8);
        resultsContainer.innerHTML = matches.map(op =>
          `<div class="context-menu-item" data-op="${op}"><span class="context-menu-icon">🧩</span>${this.humanize(op)}</div>`
        ).join('');
        resultsContainer.querySelectorAll('.context-menu-item').forEach(item => {
          item.addEventListener('click', () => {
            this.addBlock(item.dataset.op);
            this._addRecentBlock(item.dataset.op);
            this._hideContextMenu();
          });
        });
      });

      menu.querySelectorAll('.context-menu-item[data-op]').forEach(item => {
        item.addEventListener('click', () => {
          this.addBlock(item.dataset.op);
          this._addRecentBlock(item.dataset.op);
          this._hideContextMenu();
        });
      });

      setTimeout(() => searchInput.focus(), 50);
    }

    _hideContextMenu() {
      if (this._contextMenu) {
        this._contextMenu.remove();
        this._contextMenu = null;
      }
    }

    toggleContextMenu() {
      if (this._contextMenu) {
        this._hideContextMenu();
      } else {
        this._showContextMenu(this._lastContextX, this._lastContextY);
      }
    }

    _getRecentBlocks() {
      try {
        return JSON.parse(localStorage.getItem('sillyquiz-recent-blocks') || '[]');
      } catch (e) { return []; }
    }

    _addRecentBlock(op) {
      let recent = this._getRecentBlocks();
      recent = recent.filter(r => r !== op);
      recent.unshift(op);
      if (recent.length > 8) recent = recent.slice(0, 8);
      localStorage.setItem('sillyquiz-recent-blocks', JSON.stringify(recent));
    }

    _getFavoriteBlocks() {
      try {
        return JSON.parse(localStorage.getItem('sillyquiz-favorite-blocks') || '[]');
      } catch (e) { return []; }
    }

    toggleFavorite(op) {
      let favs = this._getFavoriteBlocks();
      if (favs.includes(op)) {
        favs = favs.filter(f => f !== op);
      } else {
        favs.push(op);
      }
      localStorage.setItem('sillyquiz-favorite-blocks', JSON.stringify(favs));
      this.toast(favs.includes(op) ? '⭐ Añadido a favoritos' : '☆ Eliminado de favoritos', 'info');
    }

    /* ---- Transformación del lienzo (pan + zoom infinito) ---- */
    setZoom(z) {
      this.zoom = this._clampZoom(z);
      this.applyTransform();
    }

    _clampZoom(z) {
      return Math.max(0.3, Math.min(3, Math.round(z * 100) / 100));
    }

    applyTransform() {
      if (this.elZoom) this.elZoom.textContent = Math.round(this.zoom * 100) + '%';
      const inner = this.elCanvas && this.elCanvas.querySelector('.scratch-canvas-inner');
      if (inner) {
        inner.style.transform =
          'translate(' + this.panX + 'px,' + this.panY + 'px) scale(' + this.zoom + ')';
      }
    }

    resetView() {
      this.zoom = 1; this.panX = 0; this.panY = 0;
      this.applyTransform();
    }

    /* ---- Arrastrar y soltar (paleta -> lienzo, reordenar, stacks libres) ---- */
    bindDnD() {
      // Paleta: al arrastrar un bloque, prepara un bloque nuevo.
      this.elPalette.addEventListener('dragstart', (e) => {
        const pb = e.target.closest('.palette-block');
        if (!pb) return;
        this._drag = { type: 'new', opcode: pb.dataset.op };
        try { e.dataTransfer.setData('text/plain', pb.dataset.op); e.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
      });
      this.elPalette.addEventListener('dragend', () => { this._drag = null; });

      // Lienzo: soltar bloques.
      this.elCanvas.addEventListener('dragover', (e) => {
        if (!this._drag) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = this._drag.type === 'new' ? 'copy' : 'move'; } catch (_) {}
        if (!this._dragThrottle) {
          this._dragThrottle = true;
          requestAnimationFrame(() => { this._dragThrottle = false; });
          this._markDropTarget(e);
        }
      });
      this.elCanvas.addEventListener('dragleave', (e) => {
        if (e.target === this.elCanvas) this._clearDropMarkers();
      });
      this.elCanvas.addEventListener('drop', (e) => {
        if (!this._drag) return;
        e.preventDefault();
        this._dropBlock(e);
        this._clearDropMarkers();
        this._drag = null;
      });

      // Zoom con Ctrl+Rueda; pan con rueda normal (estética brutalista: sin smooth).
      this.elCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          this.setZoom(this.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        } else {
          this.panX -= e.deltaX;
          this.panY -= e.deltaY;
          this.applyTransform();
        }
      }, { passive: false });

      // Pan con ratón: Space+arrastrar o botón central. Pinch-zoom táctil.
      this._bindCanvasPan();
    }

    _bindCanvasPan() {
      const canvas = this.elCanvas;
      let panning = false, lastX = 0, lastY = 0;

      canvas.addEventListener('pointerdown', (e) => {
        const space = (window.__sbSpaceDown || e.button === 1);
        if (!space) return;
        panning = true;
        lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!panning) return;
        this.panX += e.clientX - lastX;
        this.panY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        this.applyTransform();
      });
      const end = () => { panning = false; canvas.style.cursor = ''; };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);

      // Gesto táctil: 1 dedo = pan, 2 dedos = pinch-zoom.
      let touchMode = 0, tLastX = 0, tLastY = 0, tStartDist = 0, tStartZoom = 1;
      const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchMode = 1;
          tLastX = e.touches[0].clientX; tLastY = e.touches[0].clientY;
        } else if (e.touches.length >= 2) {
          touchMode = 2;
          tStartDist = dist(e.touches[0], e.touches[1]);
          tStartZoom = this.zoom;
        }
      }, { passive: true });
      canvas.addEventListener('touchmove', (e) => {
        if (touchMode === 1 && e.touches.length === 1) {
          const t = e.touches[0];
          this.panX += t.clientX - tLastX;
          this.panY += t.clientY - tLastY;
          tLastX = t.clientX; tLastY = t.clientY;
          this.applyTransform();
        } else if (touchMode === 2 && e.touches.length >= 2) {
          const d = dist(e.touches[0], e.touches[1]);
          if (tStartDist > 0) this.setZoom(tStartZoom * (d / tStartDist));
        }
        e.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchend', (e) => {
        touchMode = e.touches.length === 1 ? 1 : (e.touches.length ? 2 : 0);
        if (e.touches.length === 1) { tLastX = e.touches[0].clientX; tLastY = e.touches[0].clientY; }
      });
    }

    _markDropTarget(e) {
      this._clearDropMarkers();
      const block = e.target.closest('.scratch-block');
      if (block) {
        const r = block.getBoundingClientRect();
        const after = (e.clientY - r.top) > r.height / 2;
        block.classList.add(after ? 'drop-after' : 'drop-before');
      } else {
        this.elCanvas.classList.add('drop-new');
      }
    }

    _clearDropMarkers() {
      const markers = this.elCanvas.querySelectorAll('.drop-before,.drop-after');
      for (let i = 0; i < markers.length; i++) {
        markers[i].classList.remove('drop-before', 'drop-after');
      }
      this.elCanvas.classList.remove('drop-new');
    }

    _dropBlock(e) {
      try {
        const target = e.target.closest('.scratch-block');
        const inst = this._makeDragInst();
        if (!inst) return;
        const stacks = this.heads[this.activeEvent] || (this.heads[this.activeEvent] = []);
        if (!target) {
          // Nuevo stack libre, salvo que sea un bloque sin Hat: se engancha al stack principal.
          const isHat = inst.opcode && ScratchBlocks.get(inst.opcode) && ScratchBlocks.get(inst.opcode).type === 'hat';
          if (this._drag.type === 'new' && !isHat) {
            const main = this._mainStack(this.activeEvent);
            if (main) { let t = main; while (t.next) t = t.next; t.next = inst; }
            else stacks.push(inst);
          } else {
            stacks.push(inst);
          }
        } else {
          const targetId = Number(target.dataset.bid);
          const after = target.classList.contains('drop-after');
          this._insertRelative(targetId, inst, after);
        }
        this.renderCanvas();
        this.pushSnapshot();
        this.schedulePreview();
      } catch (err) {
        this.log('error', 'No se pudo soltar: ' + err.message);
      }
    }

    _makeDragInst() {
      if (!this._drag) return null;
      if (this._drag.type === 'new') return this.makeInst(this._drag.opcode);
      // Mover un bloque existente: quitarlo de su ubicación actual.
      const inst = this._removeInst(this._drag.id);
      return inst;
    }

    _removeInst(id) {
      const stacks = this.heads[this.activeEvent] || [];
      for (let s = 0; s < stacks.length; s++) {
        let cur = stacks[s];
        if (cur._id === id) {
          // Stack entero (libre) -> quitar el stack.
          stacks.splice(s, 1);
          return cur;
        }
        while (cur.next) {
          if (cur.next._id === id) {
            const removed = cur.next;
            cur.next = removed.next;
            return removed;
          }
          cur = cur.next;
        }
      }
      return null;
    }

    _insertRelative(targetId, inst, after) {
      const stacks = this.heads[this.activeEvent] || [];
      for (let s = 0; s < stacks.length; s++) {
        let cur = stacks[s];
        if (cur._id === targetId) {
          if (after) { inst.next = cur.next; cur.next = inst; }
          else {
            // Insertar antes del objetivo: enganchar al inicio del stack.
            inst.next = cur;
            stacks[s] = inst;
          }
          return;
        }
        while (cur.next) {
          if (cur.next._id === targetId) {
            if (after) { inst.next = cur.next.next; cur.next.next = inst; }
            else { inst.next = cur.next; cur.next = inst; }
            return;
          }
          cur = cur.next;
        }
      }
      // Si no se encontró el objetivo, nuevo stack.
      stacks.push(inst);
    }

    /* ---- Ejecución + Visual Stepper ---- */
    buildMachine() {
      const scripts = {};
      Object.keys(this.heads).forEach(ev => {
        const main = this._mainStack(ev);
        if (main) scripts[ev] = main;
      });
      try {
        return ScratchAOT.compile(scripts);
      } catch (e) {
        this.log('error', e.message);
        this.elStatus.textContent = 'Compilación falló';
        throw e;
      }
    }

    run() {
      if (this._isRunning) return;
      this._isRunning = true;
      this.clearHighlights();
      this.trace = [];
      const machine = this.buildMachine();
      const v = ScratchAOT.validate(machine, { production: true });
      if (!v.valid) {
        v.errors.forEach(er => this.log('error', er));
        this.elStatus.textContent = 'Validación falló';
        this._isRunning = false;
        return;
      }
      this.runtime = new ScratchRuntime({
        state: {},
        providers: this.providers || ScratchRuntime.defaultProviders(),
        hooks: {
          onBlockStart: (n) => this.trace.push({ id: n._id, phase: 'start' }),
          onBlockEnd: (n) => this.trace.push({ id: n._id, phase: 'end' }),
          onError: (n, p, msg) => this.trace.push({ id: n._id, phase: 'error', msg }),
          onPanic: () => this.log('panic', 'PANIC — todos los hilos detenidos')
        }
      });
      this.runtime.setEngineScripts(machine.events);
      this._attachEngineEventSource();
      this.log('step', '▶ Ejecutando evento: ' + this.humanize(this.activeEvent));
      const execPromise = this.runtime.start(this.activeEvent, machine.events, {});
      if (execPromise && typeof execPromise.then === 'function') {
        execPromise.then(() => {
          this.replayStepper();
          this.elStatus.textContent = 'Ejecutado · bloques: ' + machine.blockCount;
          this._isRunning = false;
          this._detachEngineEventSource();
        }).catch(e => {
          this.log('error', e.opcode ? ('Bloque ' + e.opcode + ': ' + e.message) : e.message);
          this.replayStepper();
          this.elStatus.textContent = 'Error en ejecución';
          this._isRunning = false;
          this._detachEngineEventSource();
        });
      } else {
        this.replayStepper();
        this.elStatus.textContent = 'Ejecutado · bloques: ' + machine.blockCount;
        this._isRunning = false;
        this._detachEngineEventSource();
      }
    }

    // Alias de run() usado por el atajo Ctrl+E (el editor de bloques no tiene
    // un método execute() propio, así que delegamos a run()).
    execute() {
      return this.run();
    }

    _attachEngineEventSource() {
      if (this._engineWS) return;
      const wsUrl = (window.__SB_WS_URL || 'ws://' + location.hostname + ':8081');
      // Token de autenticación (se puede inyectar desde el backend o localStorage)
      const authToken = localStorage.getItem('sillyquiz-engine-token') || window.__SB_AUTH_TOKEN || '';
      const urlWithAuth = authToken ? (wsUrl + '?token=' + encodeURIComponent(authToken)) : wsUrl;
      try {
        const ws = new WebSocket(urlWithAuth);
        ws.binaryType = 'arraybuffer';

        // Wrapper EventEmitter para la fuente
        const source = {
          _handlers: {},
          on(event, handler) { (this._handlers[event] = this._handlers[event] || []).push(handler); },
          off(event, handler) {
            if (!handler) { this._handlers[event] = []; return; }
            const arr = this._handlers[event] || [];
            const i = arr.indexOf(handler);
            if (i >= 0) arr.splice(i, 1);
          },
          _emit(event, data) {
            (this._handlers[event] || []).forEach(h => h(data));
          }
        };

        ws.onopen = () => {
          this.log('info', 'Engine WS conectado → ' + wsUrl);
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'auth_required') {
              this.log('warn', 'Auth requerida para Engine WS');
              ws.close();
              return;
            }
            if (msg.type === 'auth_failed') {
              this.log('error', 'Engine WS auth falló: ' + (msg.reason || 'token inválido'));
              ws.close();
              return;
            }
            if (msg.type === 'engine_event' || msg.type === 'leaderboard_update') {
              source._emit('engine_event', {
                eventKey: msg.eventKey || 'engine_event',
                payload: msg.payload || msg.leaderboard || {},
                clientId: msg.client_id,
                metric: msg.metric,
                value: msg.value,
              });
            }
          } catch (_) {}
        };
        ws.onclose = () => {
          this._engineWS = null;
          this.log('warn', 'Engine WS desconectado');
        };
        ws.onerror = (e) => {
          this.log('warn', 'Engine WS error');
        };

        this._engineWS = ws;
        this.runtime.attachEngineEventSource(source);
      } catch (e) {
        this.log('warn', 'No se pudo conectar Engine WS: ' + e.message);
      }
    }

    _detachEngineEventSource() {
      if (this._engineWS) {
        this._engineWS.close();
        this._engineWS = null;
      }
      if (this.runtime && this.runtime.detachEngineEventSource) {
        this.runtime.detachEngineEventSource();
      }
    }

    replayStepper() {
      if (!this.trace.length) return;
      let i = 0;
      const batchSize = 5;
      const tick = () => {
        const end = Math.min(i + batchSize, this.trace.length);
        for (; i < end; i++) {
          const t = this.trace[i];
          const el = this.domMap[t.id];
          if (el) {
            if (t.phase === 'start') {
              el.classList.add('block-active');
              this.log('step', '▸ ' + this.opOf(t.id));
            } else if (t.phase === 'end') {
              el.classList.remove('block-active');
            } else if (t.phase === 'error') {
              el.classList.add('block-error');
              this.log('error', '✖ ' + this.opOf(t.id) + (t.msg ? ': ' + t.msg : ''));
            }
          }
        }
        if (i < this.trace.length) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    opOf(id) {
      const main = this._mainStack(this.activeEvent);
      let found = null;
      const walk = (inst) => { let c = inst; while (c) { if (c._id === id) found = c.opcode; c = c.next; } };
      walk(main);
      return found ? this.humanize(found) : '(nodo)';
    }

    panic() {
      if (this.runtime) this.runtime.panic();
      this._isRunning = false;
      this.log('panic', '⏹ Pánico manual');
      this.elStatus.textContent = 'Detenido por pánico';
    }

    clearHighlights() {
      Object.values(this.domMap).forEach(el => el.classList.remove('block-active', 'block-error'));
    }

    /* ---- Vista previa en vivo (monitor simulado) ---- */
    togglePreview() {
      if (!this.elPreview) return;
      const open = this.elPreview.dataset.open === '1' ? '0' : '1';
      this.elPreview.dataset.open = open;
      if (open === '1') this.schedulePreview();
    }

    schedulePreview() {
      if (!this.elPreview || this.elPreview.dataset.open !== '1') return;
      if (this._previewTimer) clearTimeout(this._previewTimer);
      this._previewTimer = setTimeout(() => this.renderLivePreview(), 400);
    }

    _esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    renderLivePreview() {
      const wrap = this.elPreview;
      if (!wrap || wrap.dataset.open !== '1') return;
      try {
        const head = this._mainStack(this.activeEvent);
        const state = {
          bg: '#0b0b0b', fg: '#f4f2ec', accent: '#FF5E3A', font: 'system-ui',
          gradient: null, bgImage: null,
          title: '', subtitle: '', body: '', footer: '',
          options: [], media: [], effects: [], audioIndicators: [],
          overlays: []
        };
        const steps = [];
        const MAX_BLOCKS = 50;

        if (head) {
          let cur = head.next;
          let safety = 0;
          while (cur && safety < MAX_BLOCKS) {
            safety++;
            const a = cur.args || {};
            this._interpretBlock(cur.opcode, a, state);
            const label = this.humanize(cur.opcode);
            const argStr = Object.keys(a)
              .filter(k => a[k] !== '' && a[k] != null)
              .map(k => this.humanize(k) + ': ' + (Array.isArray(a[k]) ? a[k].join(', ') : String(a[k]).substring(0, 40)))
              .join(' · ');
            steps.push('<div class="lp-step"><b>' + this._esc(label) + '</b>' +
              (argStr ? ' <span class="lp-args">' + this._esc(argStr) + '</span>' : '') + '</div>');
            cur = cur.next;
          }
        }

        /* ---- Construir pantalla visual ---- */
        let bgStyle = '';
        if (state.gradient) {
          bgStyle = 'background:' + this._esc(state.gradient);
        } else if (state.bgImage) {
          bgStyle = 'background:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)),url(' + this._esc(state.bgImage) + ') center/cover';
        } else {
          bgStyle = 'background:' + this._esc(state.bg);
        }
        bgStyle += ';color:' + this._esc(state.fg);
        if (state.font && state.font !== 'system-ui') bgStyle += ';font-family:' + this._esc(state.font);

        let body = '';

        /* Overlays (capas de fondo) */
        state.overlays.forEach(o => {
          body += '<div style="position:absolute;inset:0;border:2px dashed rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:0.7rem;opacity:0.5;">Overlay: ' + this._esc(o) + '</div>';
        });

        /* Imágenes de fondo */
        state.media.filter(m => m.type === 'bg-image').forEach(m => {
          body += '<div style="position:absolute;inset:0;background:url(' + this._esc(m.src) + ') center/cover;opacity:0.4;z-index:0;"></div>';
        });

        /* Título principal */
        if (state.title) {
          body += '<div style="font-size:2rem;font-weight:900;line-height:1.1;margin-bottom:8px;text-shadow:2px 2px 0 rgba(0,0,0,0.5);position:relative;z-index:1;">' + this._esc(state.title) + '</div>';
        }

        /* Subtítulo */
        if (state.subtitle) {
          body += '<div style="font-size:1.1rem;opacity:0.8;margin-bottom:16px;position:relative;z-index:1;">' + this._esc(state.subtitle) + '</div>';
        }

        /* Cuerpo / texto principal */
        if (state.body) {
          body += '<div style="font-size:1.4rem;font-weight:700;line-height:1.3;margin-bottom:16px;position:relative;z-index:1;">' + this._esc(state.body) + '</div>';
        }

        /* Imágenes inline */
        state.media.filter(m => m.type === 'image').forEach(m => {
          body += '<div style="background:rgba(255,255,255,0.08);border:2px dashed rgba(255,255,255,0.25);padding:16px;text-align:center;margin:8px 0;border-radius:4px;position:relative;z-index:1;">🖼️ ' + this._esc(m.src) + '</div>';
        });

        /* Videos */
        state.media.filter(m => m.type === 'video').forEach(m => {
          body += '<div style="background:rgba(0,0,0,0.5);border:2px solid rgba(255,255,255,0.2);padding:16px;text-align:center;margin:8px 0;border-radius:4px;position:relative;z-index:1;">▶️ ' + this._esc(m.src) + (m.loop ? ' 🔁' : '') + '</div>';
        });

        /* Opciones */
        if (state.options.length) {
          body += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;position:relative;z-index:1;">';
          state.options.forEach((o, i) => {
            const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
            body += '<div style="border:2px solid ' + this._esc(state.accent) + ';padding:10px 18px;font-weight:800;background:rgba(255,255,255,0.08);box-shadow:3px 3px 0 rgba(0,0,0,0.3);min-width:80px;text-align:center;">';
            body += '<span style="color:' + this._esc(state.accent) + ';margin-right:6px;">' + (letters[i] || (i+1)) + '</span>';
            body += this._esc(o);
            body += '</div>';
          });
          body += '</div>';
        }

        /* Footer */
        if (state.footer) {
          body += '<div style="margin-top:auto;padding-top:12px;font-size:0.8rem;opacity:0.6;position:relative;z-index:1;">' + this._esc(state.footer) + '</div>';
        }

        /* Indicadores de audio */
        if (state.audioIndicators.length) {
          body += '<div style="position:absolute;top:12px;right:12px;display:flex;gap:6px;z-index:2;">';
          state.audioIndicators.forEach(a => {
            body += '<span style="background:rgba(255,255,255,0.15);padding:4px 8px;font-size:0.7rem;border-radius:4px;">' + a + '</span>';
          });
          body += '</div>';
        }

        /* Efectos visuales */
        if (state.effects.length) {
          body += '<div style="position:absolute;bottom:12px;left:12px;display:flex;flex-wrap:wrap;gap:4px;z-index:2;">';
          state.effects.forEach(e => {
            body += '<span style="background:rgba(255,255,255,0.1);padding:3px 8px;font-size:0.65rem;border-radius:3px;">✦ ' + this._esc(e) + '</span>';
          });
          body += '</div>';
        }

        /* Indicador de theme */
        const themeBadge = state.currentTheme ? '<span style="position:absolute;top:12px;left:12px;background:rgba(255,255,255,0.15);padding:4px 10px;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;border-radius:4px;z-index:2;">🎨 ' + this._esc(state.currentTheme) + '</span>' : '';

        const screen = '<div class="lp-screen" style="' + bgStyle + ';position:relative;overflow:hidden;">' +
          themeBadge +
          '<div class="lp-screen-body" style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%;">' + body + '</div></div>';

        const list = '<div class="lp-steps">' +
          (steps.length ? steps.join('') : '<div class="lp-empty">Arrastra bloques al lienzo…</div>') + '</div>';
        wrap.innerHTML = screen + list;
      } catch (e) {
        wrap.innerHTML = '<div class="lp-empty">Vista previa no disponible: ' + this._esc(e.message) + '</div>';
      }
    }

    _interpretBlock(opcode, a, state) {
      switch (opcode) {
        /* ---- Looks / Visual ---- */
        case 'set_theme': {
          const themes = {
            neon:   { bg: '#0a0a2e', fg: '#00ff88', accent: '#ff00ff', name: 'Neon' },
            biblia: { bg: '#1a0f00', fg: '#d4a574', accent: '#8b6914', name: 'Retro' },
            retro:  { bg: '#2d1b69', fg: '#e0e0e0', accent: '#ff6b35', name: 'Retro' },
            oscuro: { bg: '#0b0b0b', fg: '#f4f2ec', accent: '#FF5E3A', name: 'Oscuro' }
          };
          const t = themes[a.THEME] || themes.oscuro;
          state.bg = t.bg; state.fg = t.fg; state.accent = t.accent;
          state.gradient = null; state.currentTheme = t.name;
          break;
        }
        case 'set_custom_theme':
          if (a.BG) state.bg = a.BG;
          if (a.TXT) state.fg = a.TXT;
          if (a.ACC) state.accent = a.ACC;
          if (a.FNT) state.font = a.FNT;
          state.gradient = null; state.currentTheme = 'Custom';
          break;
        case 'set_gradient_bg': {
          const dirs = { '→': 'to right', '↓': 'to bottom', '↗': 'to top right', '↘': 'to bottom right' };
          state.gradient = 'linear-gradient(' + (dirs[a.DIR] || 'to right') + ', ' + (a.C1 || '#000') + ', ' + (a.C2 || '#fff') + ')';
          state.bg = 'transparent';
          break;
        }
        case 'set_text_smooth':
          if (a.COMP && a.TXT) {
            const c = String(a.COMP).toLowerCase();
            if (/title|titulo|header|heading/.test(c)) state.title = a.TXT;
            else if (/sub|subtitle|bajada/.test(c)) state.subtitle = a.TXT;
            else if (/body|texto|content|pregunta|question/.test(c)) state.body = a.TXT;
            else if (/footer|pie|bottom/.test(c)) state.footer = a.TXT;
            else if (!state.title) state.title = a.TXT;
            else state.body = a.TXT;
          }
          break;
        case 'set_background_image':
          if (a.SRC) state.bgImage = a.SRC;
          break;
        case 'show_image':
          if (a.SRC) state.media.push({ type: 'image', src: a.SRC });
          break;
        case 'show_video':
          if (a.SRC) state.media.push({ type: 'video', src: a.SRC, loop: !!a.LOOP });
          break;
        case 'set_text_shadow':
          state.effects.push('Sombra ' + (a.X || 2) + 'px/' + (a.Y || 2) + 'px ' + (a.CLR || '#000'));
          break;
        case 'set_border':
          state.effects.push('Borde ' + (a.STY || 'solid') + ' ' + (a.W || 2) + 'px');
          break;
        case 'set_rounded_corners':
          state.effects.push('Esquinas ' + (a.R || 8) + 'px');
          break;
        case 'set_opacity_block':
          state.effects.push('Opacidad ' + (a.VAL || 100) + '%');
          break;
        case 'set_rotation':
          state.effects.push('Rotación ' + (a.DEG || 0) + '°');
          break;
        case 'set_scale':
          state.effects.push('Escala ' + (a.S || 100) + '%');
          break;
        case 'set_filter':
          state.effects.push('Filtro: ' + (a.FILTER || 'none'));
          break;
        case 'create_overlay':
          if (a.ID) state.overlays.push(a.ID);
          break;
        case 'move_component':
          state.effects.push('Mover ' + (a.COMP || '') + ' → ' + (a.X || 0) + ',' + (a.Y || 0));
          break;
        case 'set_position':
          state.effects.push('Posición ' + (a.POS || 'center'));
          break;
        case 'spawn_particle_emitter':
          state.effects.push('Partículas: ' + (a.KIND || 'confetti'));
          break;
        case 'play_css_animation':
          state.effects.push('Animación: ' + (a.ANIM || 'fade'));
          break;
        case 'trigger_scene_wipe':
          state.effects.push('Transición: ' + (a.WIPE || 'fade'));
          break;
        case 'set_component_property':
          state.effects.push((a.PROP || '') + ' = ' + (a.VAL || ''));
          break;
        case 'show_ui_component':
          state.effects.push('Mostrar: ' + (a.COMP || ''));
          break;
        case 'hide_ui_component':
          state.effects.push('Ocultar: ' + (a.COMP || ''));
          break;

        /* ---- Audio ---- */
        case 'play_bg_music':
          state.audioIndicators.push('♫ ' + (a.FILE || 'música'));
          break;
        case 'play_sfx':
          state.audioIndicators.push('🔊 ' + (a.FILE || 'sfx'));
          break;
        case 'stop_all_sounds':
          state.audioIndicators.push('🔇 Silencio');
          break;
        case 'stop_bg_music_fade':
          state.audioIndicators.push('🔇 Fade ' + (a.SEC || 2) + 's');
          break;
        case 'set_audio_category_volume':
          state.effects.push('Vol ' + (a.CAT || 'master') + ': ' + (a.VOL || 100) + '%');
          break;
        case 'trigger_audio_ducking':
          state.effects.push('Ducking ' + (a.PCT || 50) + '% ' + (a.SEC || 1) + 's');
          break;

        /* ---- Quiz ---- */
        case 'quiz_init_engine':
          state.footer = 'Quiz: ' + (a.N || '?') + ' preguntas · ' + (a.CAT || 'mix');
          break;
        case 'quiz_fetch_next_question':
          state.effects.push('📝 Siguiente pregunta');
          break;
        case 'quiz_lock_answers':
          state.effects.push('🔒 Respuestas bloqueadas');
          break;
        case 'quiz_verify_player_answer':
          state.effects.push('✓ Verificando ' + (a.PLAYER || 'jugador'));
          break;
        case 'quiz_add_score_to_player':
          state.effects.push('+' + (a.PTS || 10) + ' pts → ' + (a.PLAYER || ''));
          break;
        case 'quiz_get_current_question_text':
          if (!state.body) state.body = '(pregunta actual)';
          break;
        case 'quiz_get_answer_text':
          if (a.OPT) state.options.push(a.OPT);
          break;

        /* ---- Estado ---- */
        case 'state_init_memory_key':
          state.effects.push('Var: ' + (a.KEY || '') + ' = ' + (a.DEF || 0));
          break;
        case 'state_set_memory':
          state.effects.push((a.KEY || '') + ' = ' + (a.VAL || ''));
          break;
        case 'state_increment_memory':
          state.effects.push((a.KEY || '') + ' += ' + (a.BY || 1));
          break;
        case 'state_get_memory_value':
          state.effects.push('Leer: ' + (a.KEY || ''));
          break;

        /* ---- Players ---- */
        case 'players_set_active_slots':
          state.footer = (a.N || '?') + ' jugadores activos';
          break;
        case 'players_strike_penalize':
          state.effects.push('⚡ Strike → ' + (a.PLAYER || ''));
          break;
        case 'players_toggle_lockout':
          state.effects.push((a.ON ? '🔒 Lockout ' : '🔓 Unlock ') + (a.PLAYER || ''));
          break;
        case 'players_set_avatar':
          state.effects.push('Avatar → ' + (a.PLAYER || ''));
          break;
        case 'players_get_name':
          state.effects.push('Nombre: ' + (a.PLAYER || ''));
          break;

        /* ---- Control ---- */
        case 'wait_seconds':
          state.effects.push('⏱ Esperar ' + (a.SEC || 1) + 's');
          break;
        case 'if_then':
          state.effects.push('🔀 Si... entonces');
          break;
        case 'if_then_else':
          state.effects.push('🔀 Si... sino...');
          break;
        case 'repeat_times':
          state.effects.push('🔁 Repetir ' + (a.N || '?') + 'x');
          break;
        case 'repeat_until':
          state.effects.push('🔁 Repetir hasta que...');
          break;
        case 'break_stack':
          state.effects.push('⏹ Interrumpir');
          break;
        case 'global_panic_reset':
          state.effects.push('🚨 PANIC RESET');
          break;

        /* ---- DB ---- */
        case 'db_query_filter_difficulty':
          state.effects.push('Filtro: ' + (a.D || ''));
          break;
        case 'db_query_shuffle_answers':
          state.effects.push('🔀 Barajar respuestas');
          break;

        /* ---- Runtime ---- */
        case 'runtime_snapshot_take':
          state.effects.push('📸 Snapshot');
          break;
        case 'runtime_hot_reload':
          state.effects.push('🔄 Hot reload');
          break;

        default:
          break;
      }
    }

    /* ---- Historial (snapshot local de borrador) ---- */
    pushSnapshot() {
      try {
        const snap = JSON.stringify(this.heads);
        const last = this.snapshots[this.snapshots.length - 1];
        if (last !== snap) {
          this.snapshots.push(snap);
          if (this.snapshots.length > 30) this.snapshots.shift();
          this._redoStack = [];
          this.autoSave();
        }
      } catch (e) { /* ignore */ }
    }

    undo() {
      if (this.snapshots.length <= 1) return;
      const current = this.snapshots.pop();
      this._redoStack = this._redoStack || [];
      this._redoStack.push(current);
      const snap = this.snapshots[this.snapshots.length - 1];
      try {
        const restored = JSON.parse(snap);
        this.heads = {};
        this._idCounter = 0;
        Object.keys(restored).forEach(ev => {
          const v = restored[ev];
          this.heads[ev] = Array.isArray(v) ? v.map(s => this.rehydrate(s)) : this.rehydrate(v);
        });
        this.renderCanvas();
        this.log('info', '↶ Deshacer');
      } catch (e) { this.log('error', 'undo falló'); }
    }

    redo() {
      if (!this._redoStack || this._redoStack.length === 0) return;
      const snap = this._redoStack.pop();
      this.snapshots.push(snap);
      try {
        const restored = JSON.parse(snap);
        this.heads = {};
        this._idCounter = 0;
        Object.keys(restored).forEach(ev => {
          const v = restored[ev];
          this.heads[ev] = Array.isArray(v) ? v.map(s => this.rehydrate(s)) : this.rehydrate(v);
        });
        this.renderCanvas();
        this.log('info', '↷ Rehacer');
      } catch (e) { this.log('error', 'redo falló'); }
    }

    /* Carga una plantilla (heads: mapa evento -> cadena o array de stacks). */
    loadTemplate(data) {
      // Migrar plantilla a versión actual
      let tpl = data;
      if (global.TemplateMigration) {
        const migrated = global.TemplateMigration.migrateTemplate(tpl);
        if (migrated) {
          const validation = global.TemplateMigration.validateTemplate(migrated);
          if (!validation.valid) {
            this.log('warn', 'Plantilla con advertencias: ' + validation.errors.join(', '));
          }
          tpl = migrated;
        }
      }
      
      const heads = (tpl && tpl.heads) ? tpl.heads : tpl;
      if (!heads || typeof heads !== 'object') { this.log('error', 'plantilla inválida'); return; }
      this.heads = {};
      this._idCounter = 0;
      Object.keys(heads).forEach(ev => {
        if (!ScratchBlocks.exists(ev) || ScratchBlocks.get(ev).type !== 'hat') return;
        const v = heads[ev];
        const arr = Array.isArray(v) ? v : [v];
        this.heads[ev] = arr.map(s => this.rehydrate(s));
      });
      if (Object.keys(this.heads).length === 0) { this.log('error', 'la plantilla no tiene bloques Hat'); return; }
      this.activeEvent = Object.keys(this.heads)[0];
      // Registra la definición de control UI para cada bloque cargado.
      Object.keys(this.heads).forEach(ev => this._registerUIControlsForHead(this.heads[ev]));
      this.renderTabs();
      this.renderCanvas();
      this.pushSnapshot();
      this.log('info', 'Plantilla cargada v' + (tpl.version || 1) + ' (' + Object.keys(this.heads).length + ' eventos)');
    }

    /* Exporta el borrador actual como plantilla JSON (formato heads). */
    exportTemplate() {
      return { version: TemplateMigration.CURRENT_VERSION, type: 'scratch-mode', heads: this.heads };
    }

    rehydrate(node) {
      if (!node) return null;
      const inst = { opcode: node.opcode, args: node.args || {}, next: this.rehydrate(node.next), _id: ++this._idCounter };
      return inst;
    }

    clearCanvas() {
      const head = this._mainStack(this.activeEvent);
      if (head) head.next = null;
      this.selected = null;
      this.renderCanvas();
      this.pushSnapshot();
      this.log('info', 'Lienzo limpiado');
    }

    /* ---- Export / Import JSON ---- */
    exportToFile() {
      const data = this.exportTemplate();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sillyquiz-modo-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.toast('Plantilla exportada', 'success');
      this.log('info', '💾 Plantilla exportada a JSON');
    }

    importFromFile() {
      let input = this._importInput;
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const data = JSON.parse(reader.result);
              this.loadTemplate(data);
              this.toast('Plantilla importada: ' + (data.title || data.id || file.name), 'success');
              this.log('info', '📂 Plantilla importada desde archivo');
            } catch (err) {
              this.toast('Error al importar: ' + err.message, 'error');
              this.log('error', 'Import falló: ' + err.message);
            }
          };
          reader.readAsText(file);
          input.value = '';
        });
        this._importInput = input;
      }
      input.click();
    }

    saveToLocalStorage() {
      try {
        const data = this.exportTemplate();
        const key = 'sillyquiz-builder-draft';
        localStorage.setItem(key, JSON.stringify(data));
        this.toast('Borrador guardado en el navegador', 'success');
        this.log('info', '⬇ Guardado en localStorage');
      } catch (err) {
        this.toast('Error al guardar: ' + err.message, 'error');
        this.log('error', 'Save falló: ' + err.message);
      }
    }

    loadFromLocalStorage() {
      try {
        const raw = localStorage.getItem('sillyquiz-builder-draft');
        if (!raw) {
          this.toast('No hay borrador guardado', 'warn');
          return;
        }
        const data = JSON.parse(raw);
        this.loadTemplate(data);
        this.toast('Borrador cargado', 'success');
        this.log('info', '⬆ Borrador cargado desde localStorage');
      } catch (err) {
        this.toast('Error al cargar: ' + err.message, 'error');
        this.log('error', 'Load falló: ' + err.message);
      }
    }

    autoSave() {
      try {
        const data = this.exportTemplate();
        localStorage.setItem('sillyquiz-builder-autosave', JSON.stringify(data));
      } catch (_) { /* ignorar errores de auto-save */ }
    }

    autoLoad() {
      try {
        const raw = localStorage.getItem('sillyquiz-builder-autosave');
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.heads && Object.keys(data.heads).length > 0) {
            this.loadTemplate(data);
            this.log('info', '🔄 Borrador anterior restaurado automáticamente');
            return true;
          }
        }
      } catch (_) { /* ignorar */ }
      return false;
    }

    toast(msg, type) {
      const existing = document.querySelector('.sb-toast');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.className = 'sb-toast sb-toast-' + (type || 'info');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
        'padding:10px 20px;font-weight:800;font-size:0.85rem;z-index:10000;' +
        'border:2px solid var(--ink,#0a0a0a);box-shadow:4px 4px 0 var(--ink,#0a0a0a);' +
        'transition:opacity .3s;opacity:1;';
      if (type === 'success') el.style.background = '#10b981';
      else if (type === 'error') el.style.background = '#ef4444';
      else if (type === 'warn') el.style.background = '#f59e0b';
      else el.style.background = '#3b82f6';
      el.style.color = type === 'warn' ? '#000' : '#fff';
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
    }

    /* ---- Dark Mode ---- */
    toggleDarkMode() {
      const app = this.root.querySelector('.scratch-app');
      if (!app) return;
      const isDark = app.classList.toggle('dark-mode');
      localStorage.setItem('sillyquiz-builder-dark', isDark ? '1' : '0');
      this.toast(isDark ? 'Modo oscuro activado' : 'Modo claro activado', 'info');
    }

    _applySavedDarkMode() {
      const saved = localStorage.getItem('sillyquiz-builder-dark');
      if (saved === '1') {
        const app = this.root.querySelector('.scratch-app');
        if (app) app.classList.add('dark-mode');
      }
    }

    /* ---- Definición de control UI (scratch-ui-control-definition) ---- */
    _registerUIControl(inst) {
      const reg = global.uiControlRegistry;
      if (!reg || !inst) return;
      try {
        inst._uiControl = reg.defineComponent(inst);
      } catch (e) { /* definición opcional: ignorar si falla */ }
    }

    _registerUIControlsForHead(headOrStacks) {
      if (Array.isArray(headOrStacks)) { headOrStacks.forEach(s => this._registerUIControlsForHead(s)); return; }
      let cur = headOrStacks;
      while (cur) { this._registerUIControl(cur); cur = cur.next; }
    }

    _renderUIControlSummary(inst) {
      const def = inst._uiControl;
      if (!def || !def.definition) return '';
      const d = def.definition;
      const props = (d.properties || []).map((p) => `<li><code>${p.key}</code>: ${p.label}</li>`).join('');
      const state = Object.keys(d.state || {}).map((k) => `<li><code>${k}</code></li>`).join('');
      return `
        <div class="inspector-ui-control">
          <h5>🎛 Definición de control UI</h5>
          ${props ? `<div class="inspector-meta">Propiedades</div><ul class="inspector-list">${props}</ul>` : ''}
          ${state ? `<div class="inspector-meta">Estado</div><ul class="inspector-list">${state}</ul>` : ''}
        </div>`;
    }

    /* ---- Estado por defecto ---- */
    /* Garantiza que el lienzo no quede vacío: si el evento activo solo tiene el
       bloque Hat (sin bloques de usuario), inserta un bloque de inicio y lo
       selecciona. Equivalente a ensureDefaultState/_addDefaultHeader del diseño. */
    ensureDefaultState() {
      const main = this._mainStack(this.activeEvent);
      if (!main) return;
      if (!main.next) this._addDefaultHeader();
      if (this.selected == null && main.next) {
        this.selected = main.next;
        this.selectBlock(this.selected);
      }
    }

    _addDefaultHeader() {
      const op = ScratchBlocks.exists('set_text_smooth')
        ? 'set_text_smooth'
        : this._firstStackOpcode();
      if (!op) return;
      this.addBlock(op);
      const main = this._mainStack(this.activeEvent);
      const added = main && main.next;
      if (added) {
        this.selected = added;
        this.selectBlock(added);
        this.log('info', 'Bloque de inicio añadido: ' + this.humanize(op));
      }
    }

    _firstStackOpcode() {
      const ops = ScratchBlocks.all();
      for (let i = 0; i < ops.length; i++) {
        if (ScratchBlocks.get(ops[i]).type === 'stack') return ops[i];
      }
      return null;
    }

    /* ---- Panel de Personalización ---- */
    openCustomizer() {
      if (this._customizerOpen) return;
      this._customizerOpen = true;
      const modal = document.createElement('div');
      modal.className = 'scratch-customizer-modal';
      modal.innerHTML = `
        <div class="scratch-customizer-backdrop"></div>
        <div class="scratch-customizer-panel">
          <div class="scratch-customizer-header">
            <h3>⚙ Personalización Extrema</h3>
            <button class="scratch-customizer-close" data-act="close">✕</button>
          </div>
          <div class="scratch-customizer-body">
            <div class="customizer-section">
              <h4>🎨 Colores de Categorías</h4>
              <div class="customizer-grid" id="catColorGrid"></div>
            </div>
            <div class="customizer-section">
              <h4>🔤 Tipografía</h4>
              <div class="customizer-row">
                <label>Fuente del bloque:</label>
                <select id="fontBlock">
                  <option value="'Inter', 'Segoe UI', system-ui, sans-serif">Inter (Default)</option>
                  <option value="'Segoe UI', Roboto, system-ui, sans-serif">Segoe UI</option>
                  <option value="'SF Pro Text', -apple-system, sans-serif">SF Pro</option>
                  <option value="'JetBrains Mono', 'SF Mono', monospace">JetBrains Mono</option>
                  <option value="'Fira Code', monospace">Fira Code</option>
                  <option value="monospace">Monospace</option>
                </select>
              </div>
              <div class="customizer-row">
                <label>Tamaño de fuente:</label>
                <input type="range" id="fontSizeRange" min="10" max="20" value="14">
                <span id="fontSizeLabel">14px</span>
              </div>
              <div class="customizer-row">
                <label>Peso de fuente:</label>
                <select id="fontWeight">
                  <option value="500">Medium (500)</option>
                  <option value="700" selected>Bold (700)</option>
                  <option value="800">Extra Bold (800)</option>
                  <option value="900">Black (900)</option>
                </select>
              </div>
            </div>
            <div class="customizer-section">
              <h4>📐 Layout del Canvas</h4>
              <div class="customizer-row">
                <label>Tamaño de grid:</label>
                <input type="number" id="gridSize" min="12" max="48" value="24" step="6">
              </div>
              <div class="customizer-row">
                <label>Espaciado de bloques:</label>
                <input type="number" id="blockGap" min="4" max="40" value="22" step="2">
              </div>
              <div class="customizer-row">
                <label>Sombra de bloques:</label>
                <select id="shadowIntensity">
                  <option value="2px 2px 0">Sutil (2px)</option>
                  <option value="4px 4px 0" selected>Normal (4px)</option>
                  <option value="6px 6px 0">Fuerte (6px)</option>
                  <option value="8px 8px 0">Brutal (8px)</option>
                  <option value="12px 12px 0">Mega (12px)</option>
                </select>
              </div>
            </div>
            <div class="customizer-section">
              <h4>🎭 Layout Presets</h4>
              <div class="customizer-themes" id="layoutPresets"></div>
            </div>
            <div class="customizer-section">
              <h4>🎭 Temas Predefinidos</h4>
              <div class="customizer-themes" id="themePresets"></div>
            </div>
            <div class="customizer-section">
              <h4>⚙ Comportamiento</h4>
              <div class="customizer-row">
                <label>
                  <input type="checkbox" id="autoSaveEnabled" checked> Auto-guardar
                </label>
              </div>
              <div class="customizer-row">
                <label>
                  <input type="checkbox" id="snapToGrid" checked> Ajustar a grid
                </label>
              </div>
              <div class="customizer-row">
                <label>
                  <input type="checkbox" id="showAnimations" checked> Animaciones
                </label>
              </div>
            </div>
            <div class="customizer-section">
              <h4>📦 Exportar/Importar Config</h4>
              <div class="customizer-row">
                <button class="toolbar-btn" id="exportConfig">💾 Exportar Config</button>
                <button class="toolbar-btn" id="importConfig">📂 Importar Config</button>
                <button class="toolbar-btn danger" id="resetConfig">🔄 Restablecer</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      this._initCustomizer(modal);
      modal.querySelector('.scratch-customizer-backdrop').addEventListener('click', () => this.closeCustomizer());
      modal.querySelector('[data-act="close"]').addEventListener('click', () => this.closeCustomizer());
    }

    closeCustomizer() {
      const modal = document.querySelector('.scratch-customizer-modal');
      if (modal) modal.remove();
      this._customizerOpen = false;
    }

    _initCustomizer(modal) {
      const categories = ScratchBlocks.categoriesOrdered();
      const catGrid = modal.querySelector('#catColorGrid');
      categories.forEach(cat => {
        const currentColor = getComputedStyle(document.documentElement).getPropertyValue(cat.colorVar).trim();
        const item = document.createElement('div');
        item.className = 'customizer-color-item';
        item.innerHTML = `
          <label>${cat.label}</label>
          <input type="color" value="${currentColor || '#888888'}" data-var="${cat.colorVar}">
          <span class="color-hex">${currentColor}</span>`;
        item.querySelector('input').addEventListener('input', (e) => {
          document.documentElement.style.setProperty(cat.colorVar, e.target.value);
          item.querySelector('.color-hex').textContent = e.target.value;
          this._saveCustomConfig();
        });
        catGrid.appendChild(item);
      });

      const layoutPresets = modal.querySelector('#layoutPresets');
      const layouts = [
        { name: 'Compacto', gap: '12px', grid: '18px', shadow: '2px 2px 0' },
        { name: 'Normal', gap: '22px', grid: '24px', shadow: '4px 4px 0' },
        { name: 'Espacioso', gap: '32px', grid: '32px', shadow: '6px 6px 0' },
        { name: 'Brutal', gap: '24px', grid: '24px', shadow: '8px 8px 0' },
      ];
      layouts.forEach(layout => {
        const btn = document.createElement('button');
        btn.className = 'toolbar-btn theme-preset-btn';
        btn.textContent = layout.name;
        btn.addEventListener('click', () => {
          document.documentElement.style.setProperty('--block-gap', layout.gap);
          document.documentElement.style.setProperty('--grid-size', layout.grid);
          document.documentElement.style.setProperty('--hard', layout.shadow + ' var(--ink)');
          modal.querySelector('#blockGap').value = parseInt(layout.gap);
          modal.querySelector('#gridSize').value = parseInt(layout.grid);
          modal.querySelector('#shadowIntensity').value = layout.shadow;
          this._saveCustomConfig();
          this.log('info', 'Layout aplicado: ' + layout.name);
        });
        layoutPresets.appendChild(btn);
      });

      const themePresets = modal.querySelector('#themePresets');
      const themes = [
        { name: 'Clásico', colors: { '--paper': '#ECEAE3', '--ink': '#0a0a0a', '--cat-control': '#FF5E3A' }},
        { name: 'Oscuro', colors: { '--paper': '#1a1a2e', '--ink': '#e8e8e8', '--cat-control': '#ff6b6b' }},
        { name: 'Neón', colors: { '--paper': '#0a0a0a', '--ink': '#00ff88', '--cat-control': '#ff00ff' }},
        { name: 'Ocean', colors: { '--paper': '#0c1445', '--ink': '#e0f7fa', '--cat-control': '#00bcd4' }},
        { name: 'Fire', colors: { '--paper': '#1a0000', '--ink': '#ffcc02', '--cat-control': '#ff3d00' }},
        { name: 'Forest', colors: { '--paper': '#0d1f0d', '--ink': '#a8d5a2', '--cat-control': '#4caf50' }},
      ];
      themes.forEach(theme => {
        const btn = document.createElement('button');
        btn.className = 'toolbar-btn theme-preset-btn';
        btn.textContent = theme.name;
        btn.addEventListener('click', () => {
          Object.entries(theme.colors).forEach(([varName, value]) => {
            document.documentElement.style.setProperty(varName, value);
          });
          this._saveCustomConfig();
          this.log('info', 'Tema aplicado: ' + theme.name);
        });
        themePresets.appendChild(btn);
      });

      const fontSelect = modal.querySelector('#fontBlock');
      fontSelect.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--font-body', e.target.value);
        document.documentElement.style.setProperty('--font-display', e.target.value);
        this._saveCustomConfig();
      });

      const fontRange = modal.querySelector('#fontSizeRange');
      const fontLabel = modal.querySelector('#fontSizeLabel');
      fontRange.addEventListener('input', (e) => {
        const size = e.target.value + 'px';
        fontLabel.textContent = size;
        document.documentElement.style.setProperty('--block-font-size', size);
        this._saveCustomConfig();
      });

      const fontWeight = modal.querySelector('#fontWeight');
      if (fontWeight) {
        fontWeight.addEventListener('change', (e) => {
          document.documentElement.style.setProperty('--fw-bold', e.target.value);
          this._saveCustomConfig();
        });
      }

      const gridInput = modal.querySelector('#gridSize');
      gridInput.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--grid-size', e.target.value + 'px');
        this._saveCustomConfig();
      });

      const gapInput = modal.querySelector('#blockGap');
      gapInput.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--block-gap', e.target.value + 'px');
        this._saveCustomConfig();
      });

      const shadowSelect = modal.querySelector('#shadowIntensity');
      if (shadowSelect) {
        shadowSelect.addEventListener('change', (e) => {
          document.documentElement.style.setProperty('--hard', e.target.value + ' var(--ink)');
          this._saveCustomConfig();
        });
      }

      const autoSave = modal.querySelector('#autoSaveEnabled');
      if (autoSave) {
        autoSave.addEventListener('change', (e) => {
          localStorage.setItem('sillyquiz-autosave', e.target.checked ? '1' : '0');
        });
      }

      const snapGrid = modal.querySelector('#snapToGrid');
      if (snapGrid) {
        snapGrid.addEventListener('change', (e) => {
          localStorage.setItem('sillyquiz-snap-grid', e.target.checked ? '1' : '0');
        });
      }

      const showAnims = modal.querySelector('#showAnimations');
      if (showAnims) {
        showAnims.addEventListener('change', (e) => {
          document.documentElement.style.setProperty('--animations', e.target.checked ? '1' : '0');
          localStorage.setItem('sillyquiz-animations', e.target.checked ? '1' : '0');
        });
      }

      modal.querySelector('#exportConfig').addEventListener('click', () => this._exportCustomConfig());
      modal.querySelector('#importConfig').addEventListener('click', () => this._importCustomConfig());
      modal.querySelector('#resetConfig').addEventListener('click', () => {
        if (confirm('¿Restablecer toda la configuración?')) {
          localStorage.removeItem('sillyquiz-custom-config');
          location.reload();
        }
      });
    }

    _saveCustomConfig() {
      const config = {};
      const styles = document.documentElement.style;
      for (let i = 0; i < styles.length; i++) {
        const prop = styles[i];
        if (prop.startsWith('--cat-') || prop.startsWith('--block-') || prop.startsWith('--grid-') || prop.startsWith('--paper') || prop.startsWith('--ink')) {
          config[prop] = styles.getPropertyValue(prop);
        }
      }
      localStorage.setItem('sillyquiz-custom-config', JSON.stringify(config));
    }

    _loadCustomConfig() {
      try {
        const raw = localStorage.getItem('sillyquiz-custom-config');
        if (!raw) return;
        const config = JSON.parse(raw);
        Object.entries(config).forEach(([prop, value]) => {
          document.documentElement.style.setProperty(prop, value);
        });
      } catch (e) { /* ignore */ }
    }

    _exportCustomConfig() {
      const config = {};
      const styles = document.documentElement.style;
      for (let i = 0; i < styles.length; i++) {
        const prop = styles[i];
        if (prop.startsWith('--cat-') || prop.startsWith('--block-') || prop.startsWith('--grid-') || prop.startsWith('--paper') || prop.startsWith('--ink')) {
          config[prop] = styles.getPropertyValue(prop);
        }
      }
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sillyquiz-config-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      this.toast('Config exportada', 'success');
    }

    _importCustomConfig() {
      let input = this._importConfigInput;
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const config = JSON.parse(reader.result);
              Object.entries(config).forEach(([prop, value]) => {
                document.documentElement.style.setProperty(prop, value);
              });
              this._saveCustomConfig();
              this.toast('Config importada', 'success');
              this.log('info', 'Config importada desde archivo');
            } catch (err) {
              this.toast('Error al importar config: ' + err.message, 'error');
            }
          };
          reader.readAsText(file);
          input.value = '';
        });
        this._importConfigInput = input;
      }
      input.click();
    }

    /* ---- Quick Help ---- */
    openQuickHelp() {
      if (this._helpOpen) return;
      this._helpOpen = true;
      const modal = document.createElement('div');
      modal.className = 'scratch-customizer-modal';
      modal.innerHTML = `
        <div class="scratch-customizer-backdrop"></div>
        <div class="scratch-customizer-panel" style="max-width: 600px;">
          <div class="scratch-customizer-header">
            <h3>❓ Quick Help</h3>
            <button class="scratch-customizer-close" data-act="close">✕</button>
          </div>
          <div class="scratch-customizer-body">
            <div class="customizer-section">
              <h4>🎮 Basic Controls</h4>
              <div class="shortcut-list">
                <div class="shortcut-item"><span class="shortcut-key">Click</span><span class="shortcut-action">Select block</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Drag</span><span class="shortcut-action">Move block</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Right Click</span><span class="shortcut-action">Context menu</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Scroll</span><span class="shortcut-action">Zoom in/out</span></div>
              </div>
            </div>
            <div class="customizer-section">
              <h4>⌨ Keyboard Shortcuts</h4>
              <div class="shortcut-list">
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+Z</span><span class="shortcut-action">Undo</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+Shift+Z</span><span class="shortcut-action">Redo</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+S</span><span class="shortcut-action">Save</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+E</span><span class="shortcut-action">Execute</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+.</span><span class="shortcut-action">Customizer</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Ctrl+,</span><span class="shortcut-action">Performance</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Delete</span><span class="shortcut-action">Delete selected</span></div>
                <div class="shortcut-item"><span class="shortcut-key">Escape</span><span class="shortcut-action">Close panel</span></div>
              </div>
            </div>
            <div class="customizer-section">
              <h4>💡 Tips</h4>
              <div class="shortcut-list">
                <div class="shortcut-item"><span class="shortcut-key">★</span><span class="shortcut-action">Drag blocks from palette to canvas</span></div>
                <div class="shortcut-item"><span class="shortcut-key">★</span><span class="shortcut-action">Connect blocks by snapping them together</span></div>
                <div class="shortcut-item"><span class="shortcut-key">★</span><span class="shortcut-action">Use C-blocks for loops and conditionals</span></div>
                <div class="shortcut-item"><span class="shortcut-key">★</span><span class="shortcut-action">Right-click canvas for quick add menu</span></div>
                <div class="shortcut-item"><span class="shortcut-key">★</span><span class="shortcut-action">Use ⚙ to customize colors, fonts, layout</span></div>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.scratch-customizer-backdrop').addEventListener('click', () => this.closeQuickHelp());
      modal.querySelector('[data-act="close"]').addEventListener('click', () => this.closeQuickHelp());
    }

    closeQuickHelp() {
      const modal = document.querySelector('.scratch-customizer-modal');
      if (modal) modal.remove();
      this._helpOpen = false;
    }

    /* ---- Performance Dashboard ---- */
    openPerformanceDashboard() {
      if (this._perfDashOpen) return;
      this._perfDashOpen = true;
      const modal = document.createElement('div');
      modal.className = 'scratch-customizer-modal';
      modal.innerHTML = `
        <div class="scratch-customizer-backdrop"></div>
        <div class="scratch-customizer-panel" style="max-width: 500px;">
          <div class="scratch-customizer-header">
            <h3>📊 Performance Dashboard</h3>
            <button class="scratch-customizer-close" data-act="close">✕</button>
          </div>
          <div class="scratch-customizer-body">
            <div class="customizer-section">
              <h4>⏱ Metrics</h4>
              <div class="perf-metrics" id="perfMetrics"></div>
            </div>
            <div class="customizer-section">
              <h4>🧠 Memory</h4>
              <div class="perf-metrics" id="memoryMetrics"></div>
            </div>
            <div class="customizer-section">
              <h4>📦 Blocks</h4>
              <div class="perf-metrics" id="blockMetrics"></div>
            </div>
            <div class="customizer-section">
              <h4>⚡ Actions</h4>
              <div class="customizer-row">
                <button class="toolbar-btn" id="refreshPerf">🔄 Refresh</button>
                <button class="toolbar-btn danger" id="clearPerf">🗑️ Clear History</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      this._updatePerfDashboard(modal);
      modal.querySelector('.scratch-customizer-backdrop').addEventListener('click', () => this.closePerformanceDashboard());
      modal.querySelector('[data-act="close"]').addEventListener('click', () => this.closePerformanceDashboard());
      modal.querySelector('#refreshPerf').addEventListener('click', () => this._updatePerfDashboard(modal));
      modal.querySelector('#clearPerf').addEventListener('click', () => {
        if (this._runtime && this._runtime._perfMetrics) {
          this._runtime._perfMetrics = { blocksExecuted: 0, totalTime: 0, slowBlocks: [], executionTimes: [] };
        }
        this._updatePerfDashboard(modal);
        this.toast('Performance history cleared', 'success');
      });
    }

    closePerformanceDashboard() {
      const modal = document.querySelector('.scratch-customizer-modal');
      if (modal) modal.remove();
      this._perfDashOpen = false;
    }

    _updatePerfDashboard(modal) {
      const metricsEl = modal.querySelector('#perfMetrics');
      const memoryEl = modal.querySelector('#memoryMetrics');
      const blockEl = modal.querySelector('#blockMetrics');

      if (!metricsEl) return;

      const perf = this._runtime?._perfMetrics || { blocksExecuted: 0, totalTime: 0, slowBlocks: [] };
      const mem = performance.memory || {};

      metricsEl.innerHTML = `
        <div class="perf-item"><span class="perf-label">Blocks Executed</span><span class="perf-value">${perf.blocksExecuted}</span></div>
        <div class="perf-item"><span class="perf-label">Total Time</span><span class="perf-value">${(perf.totalTime / 1000).toFixed(2)}s</span></div>
        <div class="perf-item"><span class="perf-label">Avg per Block</span><span class="perf-value">${perf.blocksExecuted > 0 ? (perf.totalTime / perf.blocksExecuted).toFixed(1) : 0}ms</span></div>
        <div class="perf-item"><span class="perf-label">Slow Blocks (>100ms)</span><span class="perf-value">${perf.slowBlocks.length}</span></div>`;

      memoryEl.innerHTML = mem.totalJSHeapSize ? `
        <div class="perf-item"><span class="perf-label">Used JS Heap</span><span class="perf-value">${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB</span></div>
        <div class="perf-item"><span class="perf-label">Total JS Heap</span><span class="perf-value">${(mem.totalJSHeapSize / 1048576).toFixed(1)}MB</span></div>
        <div class="perf-item"><span class="perf-label">Heap Limit</span><span class="perf-value">${(mem.jsHeapSizeLimit / 1048576).toFixed(1)}MB</span></div>`
        : '<div class="perf-item"><span class="perf-label">Memory API not available</span><span class="perf-value">—</span></div>';

      const totalBlocks = this._countAllBlocks();
      const categories = this._countBlocksByCategory();
      blockEl.innerHTML = `
        <div class="perf-item"><span class="perf-label">Total Blocks</span><span class="perf-value">${totalBlocks}</span></div>
        <div class="perf-item"><span class="perf-label">Categories</span><span class="perf-value">${Object.keys(categories).length}</span></div>
        ${Object.entries(categories).slice(0, 8).map(([cat, count]) => 
          `<div class="perf-item"><span class="perf-label">${cat}</span><span class="perf-value">${count}</span></div>`
        ).join('')}`;
    }

    _countAllBlocks() {
      let count = 0;
      const events = this.project.events || [];
      for (const ev of events) {
        const main = this._mainStack(ev);
        if (!main) continue;
        let current = main;
        while (current) { count++; current = current.next; }
      }
      return count;
    }

    _countBlocksByCategory() {
      const cats = {};
      const events = this.project.events || [];
      for (const ev of events) {
        const main = this._mainStack(ev);
        if (!main) continue;
        let current = main;
        while (current) {
          const def = ScratchBlocks.get(current.op);
          const cat = def ? def.category : 'other';
          cats[cat] = (cats[cat] || 0) + 1;
          current = current.next;
        }
      }
      return cats;
    }

    /* ---- Keyboard Shortcut Manager ---- */
    openShortcutManager() {
      if (this._shortcutsOpen) return;
      this._shortcutsOpen = true;
      const shortcuts = [
        { key: 'Ctrl+N', action: 'Nuevo Evento', fn: () => this.newEvent() },
        { key: 'Ctrl+S', action: 'Guardar', fn: () => this.save() },
        { key: 'Ctrl+Z', action: 'Deshacer', fn: () => this.undo() },
        { key: 'Ctrl+Shift+Z', action: 'Rehacer', fn: () => this.redo() },
        { key: 'Ctrl+E', action: 'Ejecutar', fn: () => this.execute() },
        { key: 'Ctrl+P', action: 'Pantalla Completa', fn: () => this.toggleFullscreen() },
        { key: 'Ctrl+/', action: 'Ayuda Rápida', fn: () => this.openQuickHelp() },
        { key: 'Ctrl+K', action: 'Paleta de Bloques', fn: () => { if (this._paletteSearch) this._paletteSearch.focus(); }},
        { key: 'Ctrl+.', action: 'Personalización', fn: () => this.openCustomizer() },
        { key: 'Ctrl+,', action: 'Performance', fn: () => this.openPerformanceDashboard() },
        { key: 'Ctrl+Shift+K', action: 'Gestor de Atajos', fn: () => this.openShortcutManager() },
        { key: 'Delete', action: 'Eliminar Bloque', fn: () => { if (this.selected) this.deleteSelected(); }},
        { key: 'Escape', action: 'Cerrar Panel', fn: () => { this.closeCustomizer(); this.closePerformanceDashboard(); }},
      ];
      const modal = document.createElement('div');
      modal.className = 'scratch-customizer-modal';
      modal.innerHTML = `
        <div class="scratch-customizer-backdrop"></div>
        <div class="scratch-customizer-panel" style="max-width: 600px;">
          <div class="scratch-customizer-header">
            <h3>⌨ Keyboard Shortcuts</h3>
            <button class="scratch-customizer-close" data-act="close">✕</button>
          </div>
          <div class="scratch-customizer-body">
            <div class="customizer-section">
              <h4>Available Shortcuts</h4>
              <div class="shortcut-list">
                ${shortcuts.map(s => `
                  <div class="shortcut-item">
                    <span class="shortcut-key">${s.key}</span>
                    <span class="shortcut-action">${s.action}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.scratch-customizer-backdrop').addEventListener('click', () => this.closeShortcutManager());
      modal.querySelector('[data-act="close"]').addEventListener('click', () => this.closeShortcutManager());
    }

    closeShortcutManager() {
      const modal = document.querySelector('.scratch-customizer-modal');
      if (modal) modal.remove();
      this._shortcutsOpen = false;
    }

    /* ---- Limpieza completa al cerrar/descartar ---- */
    destroy() {
      // Cerrar WebSocket del engine
      if (this._engineWS) {
        this._engineWS.close();
        this._engineWS = null;
      }
      // Detach engine event source
      if (this.runtime && this.runtime.detachEngineEventSource) {
        this.runtime.detachEngineEventSource();
      }
      // Limpiar timeouts/intervals
      if (this._previewTimer) {
        clearTimeout(this._previewTimer);
        this._previewTimer = null;
      }
      // Remover listeners globales
      document.removeEventListener('keydown', this._boundKeydown);
      document.removeEventListener('keyup', this._boundKeyup);
      document.removeEventListener('click', this._boundDocClick);
      // Limpiar modales abiertos
      this.closeCustomizer();
      this.closePerformanceDashboard();
      this.closeQuickHelp();
      this.closeShortcutManager();
      // Limpiar referencias DOM
      this.domMap = {};
      this.heads = {};
      this.snapshots = [];
      this.trace = [];
      this.selected = null;
      this._drag = null;
      this._contextMenu = null;
      this._importInput = null;
      this._importConfigInput = null;
      // Detener runtime
      if (this.runtime) {
        this.runtime.panic();
        this.runtime = null;
      }
      // Limpiar NDI/Display managers
      if (this._dm) {
        this._dm.disconnectAll?.();
        this._dm = null;
      }
      if (this._ndi) {
        this._ndi.stopDiscoveryWorker?.();
        this._ndi = null;
      }
    }
  }

  global.ScratchUI = ScratchUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ScratchUI };
})(typeof window !== 'undefined' ? window : this);
