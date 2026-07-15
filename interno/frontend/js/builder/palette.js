/**
 * builder/palette.js — Construcción de la paleta y búsqueda de bloques
 *
 * Extraído de scratch-ui.js (Fase 2c, mantenibilidad) junto con la lógica de
 * filtrado fuzzy de la paleta (antes filterPalette / _fuzzyMatch / _fuzzyScore).
 *
 * Superficie pública: window.ScratchBuilder.palette
 *   Métodos (se adjuntan a ScratchUI.prototype y usan `this` = instancia UI):
 *     - collectHats()
 *     - _mainStack(ev)
 *     - makeInst(opcode)
 *     - buildPalette()
 *     - _paletteBlockHtml(d, cat)
 *     - _bindPaletteBlocks()
 *     - handleDragStart(e, opcode)
 *     - filterPalette(q)
 *
 * Mejoras de accesibilidad (Fase 5) incluidas en este módulo:
 *   - role="search" + aria-label en el input de búsqueda.
 *   - Las cabeceras de categoría son operables por teclado (role="button",
 *     tabindex="0", aria-expanded, Enter/Espacio para colapsar/expandir).
 *   - Los bloques de paleta son enfocables (tabindex="0") y activables con
 *     Enter/Espacio.
 */
(function (global) {
  'use strict';

  const SB = (global.ScratchBuilder = global.ScratchBuilder || {});

  const PaletteMixin = {
    collectHats() {
      ScratchBlocks.all().forEach(op => {
        const def = ScratchBlocks.get(op);
        if (def.type === 'hat') this.heads[op] = [ this.makeInst(op) ];
      });
    },

    /* Devuelve el stack "principal" de un evento: el primero que empieza por un Hat. */
    _mainStack(ev) {
      const stacks = this.heads[ev];
      if (!stacks || !stacks.length) return null;
      return stacks.find(s => s && ScratchBlocks.get(s.opcode) && ScratchBlocks.get(s.opcode).type === 'hat') || stacks[0];
    },

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
    },

    /* ---- Paleta Mejorada con Dropdowns ---- */
    buildPalette() {
      const cats = ScratchBlocks.categoriesOrdered();
      let sectionsHtml = cats.map(cat => {
        const list = ScratchBlocks.all()
          .map(op => ScratchBlocks.get(op))
          .filter(d => d && d.type !== 'hat' && d.category === cat.id)
          .map(d => this._paletteBlockHtml(d, cat))
          .join('');
        const count = ScratchBlocks.byCategory(cat.id).filter(d => d.type !== 'hat').length;
        const collapsed = (cat.id === 'debug' || cat.id === 'engine') ? ' collapsed' : '';
        return (
          '<div class="palette-category' + collapsed + '" data-cat="' + cat.id + '" style="--block-color:var(' + cat.colorVar + ')">' +
            '<div class="palette-category-header" data-toggle-cat="' + cat.id + '">' +
              '<span class="swatch"></span>' +
              '<span class="cat-name">' + cat.label + '</span>' +
              '<span class="cat-count">' + count + '</span>' +
              '<span class="cat-chevron">▾</span>' +
            '</div>' +
            '<div class="palette-category-content">' + list + '</div>' +
          '</div>'
        );
      }).join('');
      this.elPalette.innerHTML =
        '<div class="palette-search" role="search">' +
          '<input type="search" id="sbPaletteSearch" placeholder="🔍 Buscar bloque…" autocomplete="off" aria-label="Buscar bloque en la paleta" />' +
        '</div>' +
        '<div class="palette-sections">' + sectionsHtml + '</div>';

      const search = this.elPalette.querySelector('#sbPaletteSearch');
      if (search) {
        search.addEventListener('input', () => this.filterPalette(search.value));
        search.addEventListener('keydown', (e) => e.stopPropagation());
      }
      this.elPalette.querySelectorAll('.palette-category-header').forEach(h => {
        const cat = h.closest('.palette-category');
        h.setAttribute('role', 'button');
        h.setAttribute('tabindex', '0');
        h.setAttribute('aria-expanded', cat.classList.contains('collapsed') ? 'false' : 'true');
        h.addEventListener('click', () => {
          cat.classList.toggle('collapsed');
          h.setAttribute('aria-expanded', cat.classList.contains('collapsed') ? 'false' : 'true');
        });
        h.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cat.classList.toggle('collapsed');
            h.setAttribute('aria-expanded', cat.classList.contains('collapsed') ? 'false' : 'true');
          }
        });
      });
      this._bindPaletteBlocks();
    },

    _paletteBlockHtml(d, cat) {
      const colorVar = (cat && cat.colorVar) || '--sq-cat-control';
      const catIcon = (cat && cat.icon) || '🧩';
      return (
        '<div class="palette-block block-' + d.type + '" data-op="' + d.opcode + '" draggable="true" ' +
          'style="--block-color:var(' + colorVar + ')" ' +
          'role="option" tabindex="0" aria-label="' + this.humanize(d.opcode) + '" title="' + this.humanize(d.opcode) + ' · ' + this.getBlockTypeLabel(d.type) + '">' +
          '<span class="pb-icon">' + catIcon + '</span>' +
          '<span class="pb-label">' + this.humanize(d.opcode) + '</span>' +
          '<span class="pb-type ' + d.type + '">' + this.getBlockTypeLabel(d.type) + '</span>' +
        '</div>'
      );
    },

    _bindPaletteBlocks() {
      this.elPalette.querySelectorAll('.palette-block').forEach(b => {
        b.addEventListener('click', () => this.addBlock(b.dataset.op));
        b.addEventListener('dragstart', (e) => this.handleDragStart(e, b.dataset.op));
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.addBlock(b.dataset.op);
            return;
          }
          // Navegación por flechas (roving) entre bloques de la paleta.
          const navKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
          if (navKeys.indexOf(e.key) < 0) return;
          e.preventDefault();
          const blocks = Array.prototype.slice.call(this.elPalette.querySelectorAll('.palette-block:not(.hidden)'));
          const idx = blocks.indexOf(b);
          let next = null;
          if (e.key === 'ArrowDown') next = blocks[idx + 1];
          else if (e.key === 'ArrowUp') next = blocks[idx - 1];
          else if (e.key === 'ArrowRight') next = blocks[Math.min(blocks.length - 1, idx + 1)];
          else if (e.key === 'ArrowLeft') next = blocks[Math.max(0, idx - 1)];
          else if (e.key === 'Home') next = blocks[0];
          else if (e.key === 'End') next = blocks[blocks.length - 1];
          if (next) next.focus();
        });
      });
    },

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
    },

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
  };

  SB.palette = PaletteMixin;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaletteMixin;
  }
})(typeof window !== 'undefined' ? window : this);
