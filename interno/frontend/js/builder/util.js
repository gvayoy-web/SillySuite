/**
 * builder/util.js — Utilidades puras del Builder (sin estado de instancia)
 *
 * Extraído de scratch-ui.js (Fase 2c, mantenibilidad) para reducir el
 * tamaño del monolito y centralizar helpers reutilizables.
 *
 * Superficie pública: window.ScratchBuilder.util
 *   - BLOCK_ICON
 *   - humanize(op)
 *   - fuzzyMatch(query, target)
 *   - fuzzyScore(query, target)
 *   - esc(s)
 *   - getBlockTypeLabel(type)
 *   - getBlockStyleIndicator(type)
 *
 * También exporta vía CommonJS (module.exports) para poder migrar a ES Modules
 * en el futuro sin reescribir los consumidores.
 */
(function (global) {
  'use strict';

  const BLOCK_ICON = '🧩';

  /** Convierte un opcode en etiqueta legible: "move_10_steps" -> "Move 10 Steps". */
  function humanize(op) {
    return String(op)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /** Coincidencia difusa (subsecuencia) entre query y target. */
  function fuzzyMatch(query, target) {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  /** Puntuación de coincidencia difusa (negativa = mejor prioridad en flex order). */
  function fuzzyScore(query, target) {
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

  /** Escapado HTML seguro para valores inyectados en innerHTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Etiqueta legible para el tipo de bloque. */
  function getBlockTypeLabel(type) {
    const labels = {
      'hat': 'HAT',
      'reporter': 'REPORTER',
      'boolean': 'BOOLEAN',
      'command': 'STACK',
      'c': 'C-BLOCK',
      'stack': 'STACK',
      'motion': 'MOTION',
      'looks': 'LOOKS',
      'sound': 'SOUND',
      'pen': 'PEN',
      'data': 'DATA',
      'event': 'EVENT',
      'control': 'CONTROL',
      'sensing': 'SENSING',
      'operator': 'OPERATOR',
      'variable': 'VARIABLE',
      'list': 'LIST',
      'procedure': 'PROCEDURE'
    };
    return labels[type] || String(type).toUpperCase();
  }

  /** Indicador visual (HTML) para el tipo de bloque. */
  function getBlockStyleIndicator(type) {
    const indicators = {
      'hat': '<span class="block-style-indicator hat-indicator" aria-hidden="true">HAT</span>',
      'reporter': '<span class="block-style-indicator reporter-indicator" aria-hidden="true">REPORTER</span>',
      'boolean': '<span class="block-style-indicator boolean-indicator" aria-hidden="true">BOOLEAN</span>',
      'command': '<span class="block-style-indicator command-indicator" aria-hidden="true">STACK</span>',
      'c': '<span class="block-style-indicator c-indicator" aria-hidden="true">C-BLOCK</span>',
      'stack': '<span class="block-style-indicator stack-indicator" aria-hidden="true">STACK</span>',
      'control': '<span class="block-style-indicator control-indicator" aria-hidden="true">CONTROL</span>',
      'operator': '<span class="block-style-indicator operator-indicator" aria-hidden="true">OPERATOR</span>',
      'event': '<span class="block-style-indicator event-indicator" aria-hidden="true">EVENT</span>',
      'variable': '<span class="block-style-indicator variable-indicator" aria-hidden="true">VAR</span>',
      'list': '<span class="block-style-indicator list-indicator" aria-hidden="true">LIST</span>'
    };
    return indicators[type] || '';
  }

  const Util = {
    BLOCK_ICON,
    humanize,
    fuzzyMatch,
    fuzzyScore,
    esc,
    getBlockTypeLabel,
    getBlockStyleIndicator
  };

  // Exponer en el namespace global del Builder (consumido por scratch-ui.js clásico).
  global.ScratchBuilder = global.ScratchBuilder || {};
  global.ScratchBuilder.util = Util;

  // Interop CommonJS/ESM-ready.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Util;
  }
})(typeof window !== 'undefined' ? window : this);
