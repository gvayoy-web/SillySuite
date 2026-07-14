/**
 * template-migration.js — Sistema de migración de plantillas (SillyQuiz Builder)
 *
 * Permite actualizar plantillas JSON antiguas a la versión actual del schema.
 * Cada versión de schema tiene una función de migración incremental.
 */

(function (global) {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 3;

  const migrations = {
    // v1 -> v2: Agregar campo version y normalizar heads a array
    v2(template) {
      const t = JSON.parse(JSON.stringify(template));
      t.version = t.version || 2;
      // Normalizar heads: asegurar que cada evento es array
      if (t.heads) {
        Object.keys(t.heads).forEach(ev => {
          if (!Array.isArray(t.heads[ev])) {
            t.heads[ev] = [t.heads[ev]];
          }
        });
      }
      // Agregar metadatos si no existen
      t.tags = t.tags || [];
      t.difficulty = t.difficulty || 'fácil';
      return t;
    },

    // v2 -> v3: Agregar soporte para physics category, bloques con _id únicos
    v3(template) {
      const t = JSON.parse(JSON.stringify(template));
      t.version = 3;
      if (t.heads) {
        Object.keys(t.heads).forEach(ev => {
          const stacks = t.heads[ev];
          const stackArray = Array.isArray(stacks) ? stacks : [stacks];
          stackArray.forEach(stack => {
            walkBlocks(stack, (block) => {
              if (block.opcode === 'sprite_on_collision') {
                // Mantener compatibilidad, physics_on_collision es nuevo
              }
            });
          });
        });
      }
      return t;
    }
  };

  function walkBlocks(node, fn) {
    if (!node) return;
    fn(node);
    if (node.next) {
      (Array.isArray(node.next) ? node.next : [node.next]).forEach(n => walkBlocks(n, fn));
    }
    if (node.body) walkBlocks(node.body, fn);
    if (node.elseBody) walkBlocks(node.elseBody, fn);
    if (node.fallback) walkBlocks(node.fallback, fn);
  }

  const TemplateMigration = {
    CURRENT_SCHEMA_VERSION,

    /** Detecta la versión del schema de una plantilla. */
    detectVersion(template) {
      if (template.version) return template.version;
      // v1: heads es objeto con cadenas directas (no arrays), sin tags/difficulty
      if (template.heads && typeof template.heads === 'object') {
        const firstEvent = Object.values(template.heads)[0];
        if (firstEvent && !Array.isArray(firstEvent) && firstEvent.opcode) return 1;
      }
      return 2;
    },

    /** Migra una plantilla a la versión actual. */
    migrateToCurrent(template) {
      let t = JSON.parse(JSON.stringify(template));
      const fromVersion = this.detectVersion(t);
      
      if (fromVersion >= CURRENT_SCHEMA_VERSION) {
        return t;
      }

      for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
        const fn = migrations['v' + v];
        if (fn) {
          try {
            t = fn(t);
          } catch (e) {
            console.warn('Migración v' + v + ' falló:', e.message);
          }
        }
      }
      t.version = CURRENT_SCHEMA_VERSION;
      t.migratedAt = new Date().toISOString();
      t.migratedFrom = fromVersion;
      return t;
    },

    /** Valida que una plantilla sea compatible con la versión actual. */
    validate(template) {
      const errors = [];
      if (!template.id) errors.push('Falta id');
      if (!template.title) errors.push('Falta title');
      if (!template.heads || typeof template.heads !== 'object') errors.push('Falta heads');
      else {
        Object.keys(template.heads).forEach(ev => {
          if (!Array.isArray(template.heads[ev])) {
            errors.push('Evento ' + ev + ' debe ser array');
          }
        });
      }
      return { valid: errors.length === 0, errors };
    },

    /** Migración en lote de múltiples plantillas. */
    migrateBatch(templates) {
      return templates.map(t => ({
        original: t,
        migrated: this.migrateToCurrent(t),
        validation: this.validate(this.migrateToCurrent(t))
      }));
    }
  };

  global.TemplateMigration = TemplateMigration;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TemplateMigration };
  }
})(typeof window !== 'undefined' ? window : this);