/**
 * scratch-aot.js — Compilador AOT (Ahead-Of-Time) para el Infinite Canvas Builder
 *
 * Convierte el árbol de instancias de bloques en una máquina de estados
 * JSON pura y validada. Sin dependencias externas.
 *
 * Dependencias: scratch-blocks.js (para REGISTRY, CATEGORIES, PORT)
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks
    || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);

  const REGISTRY = ScratchBlocks ? ScratchBlocks.registry : null;

  if (!REGISTRY) {
    throw new Error('ScratchAOT requiere ScratchBlocks.registry (carga scratch-blocks.js primero)');
  }

  const ScratchAOT = {
    VERSION: 2,

    MAX_CHAIN: 1000,
    MAX_NESTING: 8,

    _coerce(token, spec, raw) {
      if (spec == null) return raw;
      switch (spec.type) {
        case 'number':
        case 'slider': {
          if (raw === '' || raw == null) return spec.default || 0;
          const num = Number(raw);
          return Number.isNaN(num) ? (spec.default || 0) : num;
        }
        case 'boolean':
          return raw === true || raw === 'true' || raw === 1 || raw === '1';
        case 'dropdown':
          if (Array.isArray(spec.options) && !spec.options.includes(raw) && raw !== '@ndi_sources' && raw !== '@context') {
            return spec.options[0];
          }
          return raw;
        case 'textarea':
        case 'string':
        case 'input':
        case 'id':
        case 'display_id':
        case 'output_id':
        case 'source_id':
        case 'player_id':
        case 'audio_file':
        case 'image_file':
        default:
          return raw == null ? (spec.default != null ? spec.default : '') : raw;
      }
    },

    _validateBlock(block, depth, errors) {
      if (!block) return true;
      if (depth > this.MAX_NESTING) {
        errors.push('Anidación máxima de ' + this.MAX_NESTING + ' niveles excedida');
        return false;
      }
      if (!block.opcode || !ScratchBlocks.exists(block.opcode)) {
        errors.push('Opcode inválido: ' + (block.opcode || 'null'));
        return false;
      }
      const defn = REGISTRY[block.opcode];
      if (!defn) {
        errors.push('Opcode no registrado: ' + block.opcode);
        return false;
      }
      Object.keys(defn.args).forEach(token => {
        const spec = defn.args[token];
        const val = (block.args || {})[token];
        if (val === undefined || val === null || val === '') {
          if (spec.default === undefined && spec.type !== 'boolean') {
            errors.push('Argumento requerido faltante: ' + token + ' en ' + block.opcode);
          }
        }
      });
      return true;
    },

    _serialize(block, depth) {
      if (!block || !ScratchBlocks.exists(block.opcode)) return null;
      depth = depth || 0;
      if (depth >= ScratchAOT.MAX_CHAIN) {
        throw new Error('AOT: cadena supera el máximo de ' + ScratchAOT.MAX_CHAIN + ' bloques');
      }
      const defn = REGISTRY[block.opcode];
      const args = {};
      Object.keys(defn.args).forEach(token => {
        args[token] = this._coerce(token, defn.args[token], (block.args || {})[token]);
      });
      const node = { opcode: block.opcode, args };
      if (defn.hasBody) {
        defn.bodies.forEach(b => {
          node[b] = this._serializeChain(block[b], depth + 1);
        });
      }
      if (block.next) {
        node.next = Array.isArray(block.next)
          ? this._serializeChain(block.next, depth + 1)
          : [this._serialize(block.next, depth + 1)];
      }
      if (block._id != null) node._id = block._id;
      return node;
    },

    _serializeChain(head, depth) {
      depth = depth || 0;
      if (Array.isArray(head)) {
        return head.map(h => this._serialize(h, depth)).filter(Boolean);
      }
      return [this._serialize(head, depth)];
    },

    compile(scripts, opts) {
      opts = opts || {};
      const events = {};
      let blockCount = 0;
      const errors = [];
      Object.keys(scripts || {}).forEach(eventOpcode => {
        const defn = REGISTRY[eventOpcode];
        if (!defn || defn.type !== 'hat') {
          throw new Error('AOT: "' + eventOpcode + '" no es un bloque Hat válido');
        }
        events[eventOpcode] = this._serializeChain(scripts[eventOpcode]);
        blockCount += this._countChain(scripts[eventOpcode]);
      });
      const machine = {
        version: this.VERSION,
        compiledAt: new Date().toISOString(),
        engine: 'scratch-aot',
        blockCount,
        events,
        hotReload: !!opts.hotReload,
        preserveState: opts.preserve || null,
        snapshotRef: opts.snapshot || null
      };
      if (opts.previousCompiledAt) machine.previousCompiledAt = opts.previousCompiledAt;
      return machine;
    },

    hotReload(prevMachine, scripts, opts) {
      opts = opts || {};
      const merged = Object.assign({}, opts, {
        hotReload: true,
        previousCompiledAt: prevMachine && prevMachine.compiledAt,
        snapshot: opts.snapshot || (prevMachine && prevMachine.snapshotRef) || null
      });
      return this.compile(scripts, merged);
    },

    _countChain(head) {
      if (Array.isArray(head)) {
        return head.reduce((acc, h) => acc + this._countChain(h), 0);
      }
      let n = 0, cur = head;
      while (cur) {
        const d = REGISTRY[cur.opcode];
        n++;
        if (d && d.hasBody && d.bodies) {
          d.bodies.forEach(b => { n += this._countChain(cur[b]); });
        }
        cur = cur.next;
      }
      return n;
    },

    validate(machine, opts) {
      opts = opts || {};
      const errors = [];
      const walk = (chain, inProd) => {
        (chain || []).forEach(node => {
          const d = REGISTRY[node.opcode];
          if (!d) { errors.push('opcode desconocido: ' + node.opcode); return; }
          if (inProd && d.disabledInProd) {
            errors.push('bloque inseguro en producción: ' + node.opcode);
          }
          Object.keys(d.args).forEach(tok => {
            const spec = d.args[tok];
            if ((spec.type === 'reporter' || spec.type === 'boolean') && node.args[tok] != null) {
              const child = node.args[tok];
              if (child && child.opcode) {
                const cd = REGISTRY[child.opcode];
                if (cd && cd.returns && spec.returns && spec.returns !== 'any' && cd.returns !== 'any') {
                  if (spec.returns !== cd.returns) {
                    errors.push(node.opcode + '.' + tok + ': tipo ' + cd.returns + ' no compatible con ' + spec.returns);
                  }
                }
              }
            }
          });
          if (d.hasBody && d.bodies) d.bodies.forEach(b => walk(node[b], inProd));
        });
      };
      Object.keys(machine.events).forEach(ev => walk(machine.events[ev], opts.production));
      return { valid: errors.length === 0, errors };
    }
  };

  global.ScratchAOT = ScratchAOT;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScratchAOT };
  }
})(typeof window !== 'undefined' ? window : this);