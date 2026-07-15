/**
 * scratch-runtime.js — Ejecutor de la máquina de estados AOT (SillyQuiz Builder v3.0)
 *
 * Consume el JSON producido por ScratchAOT.compile() y lo ejecuta de forma
 * determinista y segura:
 *   - Control de flujo: if_then, if_then_else, repeat_times, repeat_until,
 *     try_catch_fallback, break_stack.
 *   - Kill switch global (global_panic_reset / runtime.panic()).
 *   - Visual Stepper: callbacks onBlockStart / onBlockEnd / onError para resaltar
 *     el bloque activo en vivo (#block-console).
 *   - Providers inyectables: reporter / boolean / sideEffect (el backend real
 *     conecta la lógica de juego; aquí hay defaults seguros para testing).
 *   - Performance monitoring: mide tiempo de ejecución por bloque y global.
 *   - Error boundaries: captura errores sin detener el show.
 *
 * Sin dependencias de DOM. Expone window.ScratchRuntime y module.exports.
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks
    || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);
  const DynamicBlocks = global.DynamicBlocks || (typeof require !== 'undefined' ? require('./dynamic-blocks.js').DynamicBlocks : null);

  const SandboxedJS = global.SandboxedJS
    || (typeof require !== 'undefined' ? require('./scratch-sandbox.js').SandboxedJS : null);

  const MAX_STEPS = 2000000;
  const PERF_LOG_THRESHOLD_MS = 50;

  class BlockError extends Error {
    constructor(opcode, message) {
      super(message);
      this.opcode = opcode;
      this.name = 'BlockError';
    }
  }
  class BreakSignal extends Error {
    constructor() { super('break'); this.name = 'BreakSignal'; }
  }
  class ContinueSignal extends Error {
    constructor() { super('continue'); this.name = 'ContinueSignal'; }
  }

  function truthy(v) {
    return v === true || v === 1 || v === 'true' || v === '1';
  }

  function toNum(v, d) {
    if (v === '' || v == null || isNaN(Number(v))) return (d || 0);
    return Number(v);
  }

  function _rankOf(ctx, score) {
    const s = toNum(score);
    let rank = 1;
    Object.keys(ctx.state || {}).forEach(k => {
      if (k.indexOf('score_') === 0 && toNum(ctx.state[k]) > s) rank++;
    });
    return rank;
  }

  class ScratchRuntime {
    constructor(opts) {
      opts = opts || {};
      this.providers = opts.providers || ScratchRuntime.defaultProviders();
      this.hooks = opts.hooks || {};
      this.state = opts.state || {};
      this.killed = false;
      this.activeCount = 0;
      this._delayQueue = [];
      this._isPaused = false;
      this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
      this._callStack = [];
    }

    panic() {
      this.killed = true;
      if (this.hooks.onPanic) this.hooks.onPanic();
    }

    reset() {
      this.killed = false;
      this.activeCount = 0;
      this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
    }

    /** Avanza la simulación física un paso (dt = 1/60s ≈ 16.67ms). */
    stepPhysics(dt) {
      const physics = this.state.__physics;
      if (!physics || !physics.bodies) return;
      dt = dt || (1/60);
      const gravity = physics.world?.gravity || { x: 0, y: 9.8 };
      
      // 1. Aplicar gravedad a cuerpos dinámicos
      Object.values(physics.bodies).forEach(b => {
        if (b.type !== 'static' && b.mass > 0) {
          const scale = b.gravityScale ?? 1;
          b.vy = (b.vy || 0) + gravity.y * scale * dt;
          b.vx = (b.vx || 0) + gravity.x * scale * dt;
        }
      });

      // 2. Integrar velocidades -> posiciones
      Object.values(physics.bodies).forEach(b => {
        if (b.type !== 'static') {
          b.x = (b.x || 0) + (b.vx || 0) * dt * 100; // factor de escala para pixeles
          b.y = (b.y || 0) + (b.vy || 0) * dt * 100;
        }
      });

      // 3. Colisiones simples AABB (resolución básica)
      this._resolveCollisions(physics.bodies);

      // 4. Resetear fuerzas acumuladas
      Object.values(physics.bodies).forEach(b => {
        b.fx = 0;
        b.fy = 0;
      });

      physics.stepCount = (physics.stepCount || 0) + 1;
    }

    // ===================================================================
    // DEBUGGING SUPPORT
    // ===================================================================

    /** Registra un breakpoint en un bloque por su _id */
    setBreakpoint(blockId, enabled = true) {
      if (!this._breakpoints) this._breakpoints = new Set();
      if (enabled) this._breakpoints.add(blockId);
      else this._breakpoints.delete(blockId);
    }

    /** Elimina un breakpoint */
    clearBreakpoint(blockId) {
      if (this._breakpoints) this._breakpoints.delete(blockId);
    }

    /** Limpia todos los breakpoints */
    clearAllBreakpoints() {
      if (this._breakpoints) this._breakpoints.clear();
    }

    /** Verifica si un bloque tiene breakpoint activo */
    _hasBreakpoint(blockId) {
      return this._breakpoints && this._breakpoints.has(blockId);
    }

    /** Configura el modo debug */
    setDebugMode(enabled) {
      this._debugMode = enabled;
      this._paused = false;
      this._stepMode = null; // 'over' | 'into' | 'out'
      this._callStack = [];
      this._watchExpressions = [];
    }

    /** Pausa la ejecución en el siguiente bloque */
    pause() {
      this._paused = true;
    }

    /** Reanuda la ejecución */
    resume() {
      this._paused = false;
      this._stepMode = null;
    }

    /** Step into - entra en el siguiente bloque */
    stepInto() {
      this._paused = false;
      this._stepMode = 'into';
    }

    /** Step over - salta sobre contenedores */
    stepOver() {
      this._paused = false;
      this._stepMode = 'over';
      // Track stack depth for step over
      this._stepOverDepth = this._callStack.length;
    }

    /** Step out - sale del contenedor actual */
    stepOut() {
      this._paused = false;
      this._stepMode = 'out';
      this._stepOutDepth = this._callStack.length - 1;
    }

    /** Añade una expresión watch */
    addWatchExpression(expr) {
      this._watchExpressions.push(expr);
    }

    /** Elimina una expresión watch */
    removeWatchExpression(index) {
      this._watchExpressions.splice(index, 1);
    }

    /** Evalúa todas las expresiones watch en el contexto actual */
    _evalWatchExpressions(ctx) {
      if (!this._watchExpressions || this._watchExpressions.length === 0) return {};
      const results = {};
      for (const expr of this._watchExpressions) {
        try {
          // Simple evaluation - in production would use a proper sandbox
          results[expr] = this._evalWatchExpr(expr, ctx);
        } catch (e) {
          results[expr] = { error: e.message };
        }
      }
      return results;
    }

    /** Evalúa una expresión watch simple */
    _evalWatchExpr(expr, ctx) {
      // Very simple evaluator for common patterns
      // In production, use a proper expression parser
      const state = ctx.state || {};
      try {
        // Allow simple property access like "state.var_score"
        return Function('s', 'return ' + expr.replace(/\bstate\./g, 's.'))(state);
      } catch {
        return undefined;
      }
    }

    /** Verifica si debe pausar antes de ejecutar un bloque */
    _checkPause(node, ctx) {
      if (!this._debugMode || !this._paused) return false;
      
      // Check breakpoint
      if (node._id && this._hasBreakpoint(node._id)) {
        this._paused = true;
        return true;
      }
      
      // Check step modes
      if (this._stepMode === 'into') {
        this._paused = true;
        this._stepMode = null;
        return true;
      }
      
      if (this._stepMode === 'over') {
        if (this._callStack.length <= (this._stepOverDepth || 0)) {
          this._paused = true;
          this._stepMode = null;
          return true;
        }
      }
      
      if (this._stepMode === 'out') {
        if (this._callStack.length <= (this._stepOutDepth || 0)) {
          this._paused = true;
          this._stepMode = null;
          return true;
        }
      }
      
      return false;
    }

    /** Espera hasta que se reanude (para modo debug) */
    async _waitForResume() {
      if (!this._paused) return;
      
      return new Promise(resolve => {
        this._resumeResolver = resolve;
        // Poll for resume
        const check = () => {
          if (!this._paused) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    }

    /** Notifica al hook de debug que se ha pausado */
    _notifyDebugPause(node, ctx, reason) {
      if (this.hooks.onDebugPause) {
        this.hooks.onDebugPause(node, ctx, reason, {
          callStack: [...this._callStack],
          watchValues: this._evalWatchExpressions(ctx)
        });
      }
    }

    _resumeFromPause() {
      this._paused = false;
      if (this._resumeResolver) {
        this._resumeResolver();
        this._resumeResolver = null;
      }
    }

    /** Resolución simple de colisiones AABB entre cuerpos. */
    _resolveCollisions(bodies) {
      const ids = Object.keys(bodies);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = bodies[ids[i]];
          const b = bodies[ids[j]];
          if (a.type === 'static' && b.type === 'static') continue;
          
          // AABB simple (asumimos cajas de 1x1 unidad = 50px)
          const size = 0.5;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distX = Math.abs(dx);
          const distY = Math.abs(dy);
          const overlapX = size - distX;
          const overlapY = size - distY;
          
          if (overlapX > 0 && overlapY > 0) {
            // Separar en el eje de menor penetración
            if (overlapX < overlapY) {
              const sign = dx >= 0 ? 1 : -1;
              if (a.type !== 'static') a.x += overlapX * 0.5 * sign;
              if (b.type !== 'static') b.x -= overlapX * 0.5 * sign;
              // Rebote simple
              const vxRel = (a.vx || 0) - (b.vx || 0);
              const restitution = 0.3;
              if (a.type !== 'static') a.vx = (a.vx || 0) - vxRel * restitution * (b.mass / (a.mass + b.mass));
              if (b.type !== 'static') b.vx = (b.vx || 0) + vxRel * restitution * (a.mass / (a.mass + b.mass));
            } else {
              const sign = dy >= 0 ? 1 : -1;
              if (a.type !== 'static') a.y += overlapY * 0.5 * sign;
              if (b.type !== 'static') b.y -= overlapY * 0.5 * sign;
              const vyRel = (a.vy || 0) - (b.vy || 0);
              const restitution = 0.3;
              if (a.type !== 'static') a.vy = (a.vy || 0) - vyRel * restitution * (b.mass / (a.mass + b.mass));
              if (b.type !== 'static') b.vy = (b.vy || 0) + vyRel * restitution * (a.mass / (a.mass + b.mass));
            }
          }
        }
      }
    }

    getMetrics() {
      return { ...this._perfMetrics };
    }

    /* Conecta una fuente de eventos del Game Engine (WebSocket al sync_server).
       La fuente debe tener .on(eventName, handler) y .off(eventName, handler).
       Cuando emite 'engine_event' con { eventKey, payload }, dispara el Hat
       engine_on_client_event filtrando por eventKey. */
    attachEngineEventSource(source) {
      this._engineEventSource = source;
      const self = this;
      source.on('engine_event', (data) => {
        if (!data || !data.eventKey) return;
        // Busca scripts que tengan el Hat engine_on_client_event con ese eventKey
        const scripts = self._engineScripts || {};
        const chain = scripts['engine_on_client_event'];
        if (Array.isArray(chain) && chain.length) {
          self.start('engine_on_client_event', scripts, {
            eventKey: data.eventKey,
            payload: data.payload || {},
            clientId: data.clientId,
            metric: data.metric,
            value: data.value,
          });
        }
      });
    }

    detachEngineEventSource() {
      if (this._engineEventSource) {
        this._engineEventSource.off('engine_event');
        this._engineEventSource = null;
      }
    }

    /* Guarda referencia a los scripts compilados para que attachEngineEventSource
       pueda acceder a la cadena del Hat engine_on_client_event. */
    setEngineScripts(scripts) {
      this._engineScripts = scripts;
    }

    /* Ejecuta la cadena de un evento Hat. ctx adicional (p.ej. player_id).
     * Retorna una Promise que se resuelve cuando la cadena completa termina
     * (incluyendo delays de wait_seconds). */
    start(eventOpcode, scripts, eventCtx) {
      const chain = scripts && scripts[eventOpcode];
      if (!Array.isArray(chain)) return Promise.resolve();
      const ctx = {
        state: this.state,
        eventCtx: eventCtx || {},
        runtime: this,
        killedRef: this,
        // Local variable scope stack (each frame is a Map of varName -> value)
        scopeStack: []
      };
      ctx.runtime.steps = 0;
      return this.executeChain(chain, ctx);
    }

    /* Recorrido ITERATIVO con cola explícita (sin recursión -> sin stack overflow
       aunque las cadenas sean enormes o estén profundamente anidadas). Respeta
       el orden asíncrono: cada nodo encola su 'next' y sus cuerpos de contenedor,
       y se drenan en secuencia. */
    executeChain(chain, ctx) {
      if (!Array.isArray(chain)) return Promise.resolve();
      const queue = [];
      chain.forEach(node => queue.push({ node, next: node.next || null, scope: null }));
      const drain = () => {
        if (ctx.runtime.killed) return Promise.resolve();
        const frame = queue.shift();
        if (!frame) return Promise.resolve();
        // Pop scope if this frame has one
        if (frame.scope && ctx.scopeStack.length) {
          ctx.scopeStack.pop();
        }
        return Promise.resolve()
          .then(() => this.runBlock(frame.node, ctx))
          .then(() => {
            if (ctx.runtime.killed) return;
            if (frame.next) queue.unshift({ node: frame.next, next: frame.next.next || null, scope: frame.scope });
            return drain();
          });
      };
      return drain();
    }

    /* Resuelve argumentos: evalúa reporters/booleans anidados a valores concretos. */
    resolveArgs(node, ctx) {
      const def = ScratchBlocks.get(node.opcode);
      if (!def) return node.args || {};
      const out = {};
      const defArgs = def.args || {};
      Object.keys(node.args || {}).forEach(tok => {
        const spec = defArgs[tok];
        const raw = node.args[tok];
        if (spec && (spec.type === 'reporter' || spec.type === 'boolean') && raw && raw.opcode) {
          out[tok] = this.evalNode(raw, ctx);
        } else {
          out[tok] = raw;
        }
      });
      return out;
    }

    /* Evalúa un nodo anidado (reporter/boolean) y devuelve su valor.
       Usa providers.reporter / providers.boolean según el tipo de bloque. */
    evalNode(node, ctx) {
      if (!node || !node.opcode) return null;
      const def = ScratchBlocks.get(node.opcode);
      if (!def && DynamicBlocks) {
        const dynDef = DynamicBlocks.get(node.opcode);
        if (dynDef) return this._evalNodeWithDef(node, dynDef, ctx);
      }
      if (!def) return null;
      return this._evalNodeWithDef(node, def, ctx);
    }

    _evalNodeWithDef(node, def, ctx) {
      const resolved = this.resolveArgs(node, ctx);
      node._resolved = resolved;
      if (def.type === 'reporter') {
        return this.providers.reporter(node.opcode, resolved, ctx);
      }
      if (def.type === 'boolean') {
        return this.providers.boolean(node.opcode, resolved, ctx);
      }
      if (def.hasBody) {
        this._pushScope(ctx);
        try {
          this.executeChain(node.body, ctx);
        } finally {
          this._popScope(ctx);
        }
        return null;
      }
      return null;
    }

    runBlock(node, ctx) {
      // Null/undefined protection
      if (!node || !node.opcode) {
        this.stepper('error', node, ctx, 'nodo inválido: opcode faltante');
        return Promise.resolve();
      }

      let def = ScratchBlocks.get(node.opcode);
      if (!def && DynamicBlocks) {
        def = DynamicBlocks.get(node.opcode);
      }
      if (!def) {
        this.stepper('error', node, ctx, 'opcode desconocido: ' + node.opcode);
        return Promise.resolve();
      }

      // Presupuesto de ejecución (anti-hang): frena el show si se agota.
      ctx.runtime.steps = (ctx.runtime.steps || 0) + 1;
      if (ctx.runtime.steps > MAX_STEPS) {
        this.panic();
        this.stepper('error', node, ctx, 'presupuesto de ejecución agotado (' + MAX_STEPS + ')');
        return Promise.resolve();
      }

      // DEBUG: Check for breakpoints / step modes
      if (this._debugMode && this._paused) {
        if (this._checkPause(node, ctx)) {
          this._notifyDebugPause(node, ctx, 'breakpoint');
          return this._waitForResume().then(() => this.runBlock(node, ctx));
        }
      }

      // Track call stack for step debugging
      if (def.hasBody) {
        this._callStack.push({ opcode: node.opcode, id: node._id, depth: this._callStack.length });
      }

      this.stepper('start', node, ctx);
      const startTime = performance.now();
      try {
        if (def.hasBody) {
          return this.runContainer(node, def, ctx);
        } else if (def.type === 'hat') {
          return Promise.resolve();
        } else {
          const resolved = this.resolveArgs(node, ctx);
          node._resolved = resolved;
          const res = this.providers.sideEffect(node.opcode, resolved, ctx);
          this._emitStage(node.opcode, resolved, ctx, res);
          if (res && res.ok === false) {
            this.stepper('error', node, ctx, res.error || 'fallo');
            throw new BlockError(node.opcode, res.error || 'sideEffect falló');
          }
          if (res && res.delay) {
            return new Promise(resolve => setTimeout(resolve, res.delay));
          }
          return Promise.resolve();
        }
      } catch (e) {
        if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
        this.stepper('error', node, ctx, e.message);
        throw e;
      } finally {
        // Pop call stack for container blocks
        if (def.hasBody && this._callStack.length > 0) {
          this._callStack.pop();
        }
        const elapsed = performance.now() - startTime;
        this._perfMetrics.blocks++;
        this._perfMetrics.totalTime += elapsed;
        if (elapsed > PERF_LOG_THRESHOLD_MS) {
          this._perfMetrics.slowBlocks.push({ opcode: node.opcode, ms: elapsed });
          if (this._perfMetrics.slowBlocks.length > 50) this._perfMetrics.slowBlocks.shift();
        }
        this.stepper('end', node, ctx);
        // Avanzar simulación física después de cada bloque (si está activa)
        if (this.state.__physics) this.stepPhysics(1/60);
      }
    }

    runContainer(node, def, ctx) {
      // Null protection for container node
      if (!node || !node.opcode) {
        this.stepper('error', node, ctx, 'contenedor inválido: opcode faltante');
        return Promise.resolve();
      }

      const a = this.resolveArgs(node, ctx);
      node._resolved = a;
      try {
        switch (node.opcode) {
          case 'if_then': {
            if (truthy(a.COND)) {
              this._pushScope(ctx);
              return this.executeChain(node.body, ctx).finally(() => this._popScope(ctx));
            }
            return Promise.resolve();
          }
          case 'if_then_else': {
            if (truthy(a.COND)) {
              this._pushScope(ctx);
              return this.executeChain(node.body, ctx).finally(() => this._popScope(ctx));
            } else {
              this._pushScope(ctx);
              return this.executeChain(node.elseBody, ctx).finally(() => this._popScope(ctx));
            }
          }
          case 'repeat_times': {
            const n = Math.max(0, Math.floor(Number(a.N) || 0));
            let chain = [];
            for (let i = 0; i < n && !ctx.runtime.killed; i++) {
              this._pushScope(ctx);
              // Ensure body is an array
              const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
              chain.push(...body);
            }
            return this.executeChain(chain, ctx).finally(() => {
              for (let i = 0; i < n; i++) this._popScope(ctx);
            });
          }
          case 'repeat_until': {
            const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
            const condNode = node.args && node.args.COND;
            this._pushScope(ctx);
            const step = () => {
              // Check killed flag and step limit
              if (ctx.runtime.killed || ctx.runtime.steps > MAX_STEPS) return Promise.resolve();
              const condVal = condNode ? this.evalNode(condNode, ctx) : a.COND;
              if (truthy(condVal)) return Promise.resolve();
              return this.executeChain(body, ctx).then(() => step());
            };
            return step().finally(() => this._popScope(ctx));
          }
          case 'for_each_in_list': {
            const list = ctx.state['list_' + a.NAME];
            if (!Array.isArray(list)) return Promise.resolve();
            const chains = [];
            for (let i = 0; i < list.length && !ctx.runtime.killed; i++) {
              this._pushScope(ctx);
              ctx.state['var_' + a.VAR] = list[i];
              const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
              chains.push(...body);
            }
            return this.executeChain(chains, ctx).finally(() => {
              for (let i = 0; i < list.length; i++) this._popScope(ctx);
            });
          }
          case 'repeat_for_range': {
            const from = Math.floor(toNum(a.FROM, 0));
            const to = Math.floor(toNum(a.TO, 0));
            const step = toNum(a.STEP, 1) || 1;
            const chains = [];
            let count = 0;
            if (step > 0) {
              for (let v = from; v <= to && !ctx.runtime.killed; v += step) {
                this._pushScope(ctx);
                ctx.state['var_' + a.VAR] = v;
                const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
                chains.push(...body);
                count++;
              }
            } else {
              for (let v = from; v >= to && !ctx.runtime.killed; v += step) {
                this._pushScope(ctx);
                ctx.state['var_' + a.VAR] = v;
                const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
                chains.push(...body);
                count++;
              }
            }
            return this.executeChain(chains, ctx).finally(() => {
              for (let i = 0; i < count; i++) this._popScope(ctx);
            });
          }
          case 'for_each_with_index': {
            const list = ctx.state['list_' + a.LIST];
            if (!Array.isArray(list)) return Promise.resolve();
            const chains = [];
            for (let i = 0; i < list.length && !ctx.runtime.killed; i++) {
              this._pushScope(ctx);
              ctx.state['var_' + a.VAR] = list[i];
              ctx.state['var_' + a.IDX] = i;
              const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
              chains.push(...body);
            }
            return this.executeChain(chains, ctx).finally(() => {
              for (let i = 0; i < list.length; i++) this._popScope(ctx);
            });
          }
          case 'while_loop': {
            const condNode = node.args && node.args.COND;
            const cond = () => truthy(condNode ? this.evalNode(condNode, ctx) : a.COND);
            const step = () => {
              if (!cond() || ctx.runtime.killed || ctx.runtime.steps > MAX_STEPS) return Promise.resolve();
              this._pushScope(ctx);
              const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
              return this.executeChain(body, ctx).then(() => {
                this._popScope(ctx);
                return step();
              });
            };
            return step();
          }
          case 'try_catch_fallback':
            this._pushScope(ctx);
            const body = Array.isArray(node.body) ? node.body : (node.body ? [node.body] : []);
            const fallback = Array.isArray(node.fallback) ? node.fallback : (node.fallback ? [node.fallback] : []);
            return this.executeChain(body, ctx).finally(() => this._popScope(ctx)).catch(e => {
              if (e instanceof BreakSignal || e instanceof ContinueSignal) throw e;
              this.stepper('catch', node, ctx, e.message);
              this._pushScope(ctx);
              return this.executeChain(fallback, ctx).finally(() => this._popScope(ctx));
            });
          default:
            return Promise.resolve();
        }
      } catch (e) {
        this.stepper('error', node, ctx, 'Error en contenedor ' + node.opcode + ': ' + e.message);
        throw e;
      }
    }

    _pushScope(ctx) {
      ctx.scopeStack.push(new Map());
    }

    _popScope(ctx) {
      if (ctx.scopeStack.length > 0) ctx.scopeStack.pop();
    }

    _getFromScope(ctx, name) {
      // Search from innermost to outermost scope
      for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
        const scope = ctx.scopeStack[i];
        if (scope.has(name)) return scope.get(name);
      }
      // Fall back to global state
      return ctx.state[name];
    }

    _setInScope(ctx, name, value) {
      // Set in innermost scope if exists, AND always in global state for persistence
      if (ctx.scopeStack.length > 0) {
        ctx.scopeStack[ctx.scopeStack.length - 1].set(name, value);
      }
      ctx.state[name] = value;
    }

    stepper(phase, node, ctx, msg) {
      const h = this.hooks;
      if (phase === 'start' && h.onBlockStart) h.onBlockStart(node, ctx);
      else if (phase === 'end' && h.onBlockEnd) h.onBlockEnd(node, ctx);
      else if ((phase === 'error' || phase === 'catch') && h.onError) h.onError(node, phase, msg, ctx);
    }

    /* Reenvía cada sideEffect/reporter al Stage (si existe) para preview en vivo.
       Envuelto en try/catch: el Stage NUNCA debe romper la ejecución del modo. */
    _emitStage(opcode, args, ctx, res) {
      const s = global.ScratchStage;
      if (s && typeof s.handle === 'function') {
        try { s.handle(opcode, args, ctx, res); } catch (e) { /* ignore */ }
      }
    }

    /** Avanza la simulación física un paso (Euler semi-implícito simplificado). */
    stepPhysics(dt) {
      const physics = this.state.__physics;
      if (!physics || !physics.bodies) return;
      const gx = physics.world?.gravity?.x || 0;
      const gy = physics.world?.gravity?.y || 9.8;
      
      Object.values(physics.bodies).forEach(b => {
        if (b.type === 'static' || b.mass === 0) return;
        // Gravedad (con escala opcional)
        const scale = b.gravityScale ?? 1;
        b.vy = (b.vy || 0) + gy * scale * dt;
        b.vx = (b.vx || 0) + gx * scale * dt;
        // Fuerzas acumuladas
        if (b.fx || b.fy) {
          b.vx += (b.fx / b.mass) * dt;
          b.vy += (b.fy / b.mass) * dt;
          b.fx = 0; b.fy = 0;
        }
        // Integrar posición
        b.x = (b.x || 0) + b.vx * dt * 50; // factor de escala para visualización
        b.y = (b.y || 0) + b.vy * dt * 50;
        
        // Suelo simple (y = 0)
        if (b.y < 0.5) {
          b.y = 0.5;
          b.vy = Math.abs(b.vy) * 0.3; // restitución
        }
        // Techo (y = 100)
        if (b.y > 99.5) {
          b.y = 99.5;
          b.vy = -Math.abs(b.vy) * 0.3;
        }
        // Paredes (x = 0, x = 100)
        if (b.x < 0.5) {
          b.x = 0.5;
          b.vx = Math.abs(b.vx) * 0.3;
        }
        if (b.x > 99.5) {
          b.x = 99.5;
          b.vx = -Math.abs(b.vx) * 0.3;
        }
      });
      
      // Joints de distancia (muy simplificado)
      if (physics.joints) {
        Object.values(physics.joints).forEach(j => {
          if (j.type !== 'distance') return;
          const a = physics.bodies[j.bodyA];
          const b = physics.bodies[j.bodyB];
          if (!a || !b) return;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist === 0) return;
          const diff = (dist - j.length) / dist * 0.5;
          const ox = dx * diff;
          const oy = dy * diff;
          if (a.type !== 'static') { a.x += ox; a.y += oy; }
          if (b.type !== 'static') { b.x -= ox; b.y -= oy; }
        });
      }
      
      physics.stepCount = (physics.stepCount || 0) + 1;
    }
  }

  /* ===================================================================
   * PROVIDERS POR DEFECTO (seguros para testing / sin backend)
   * El backend real sobreescribe reporter/boolean/sideEffect con la lógica
   * de juego, NDI, displays y estado persistente.
   * =================================================================== */
  ScratchRuntime.defaultProviders = function () {
    const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? (d || 0) : Number(v));
    // Estado de juego local (RAM del runtime). La vía de red server-authoritative
    // (Flask -> sync_server) es el equivalente en producción.
    const game = { sessions: {}, sprites: {}, leaderboards: {} };
    return {
      reporter(opcode, args, ctx) {
        switch (opcode) {
          case 'math_calc': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === '+') return A + B;
            if (args.OP === '-') return A - B;
            if (args.OP === '*') return A * B;
            if (args.OP === '÷') return B === 0 ? 0 : A / B;
            return 0;
          }
          case 'get_random_number':
            return Math.floor(Math.random() * (num(args.MAX) - num(args.MIN) + 1)) + num(args.MIN);
          case 'math_unary': {
            const x = num(args.A);
            switch (args.OP) {
              case 'sqrt': return Math.sqrt(x);
              case 'abs': return Math.abs(x);
              case 'round': return Math.round(x);
              case 'floor': return Math.floor(x);
              case 'ceil': return Math.ceil(x);
              case 'sin': return Math.sin(x);
              case 'cos': return Math.cos(x);
              case 'tan': return Math.tan(x);
              case 'ln': return Math.log(x);
              case 'log10': return Math.log10(x);
              default: return x;
            }
          }
          case 'math_binary': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === 'pow') return Math.pow(A, B);
            if (args.OP === 'mod') return B === 0 ? 0 : A % B;
            if (args.OP === 'min') return Math.min(A, B);
            if (args.OP === 'max') return Math.max(A, B);
            return 0;
          }
          case 'string_length': return String(args.TXT || '').length;
          case 'string_case': {
            const s = String(args.TXT || '');
            if (args.OP === 'upper') return s.toUpperCase();
            if (args.OP === 'lower') return s.toLowerCase();
            if (args.OP === 'title') return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
            return s;
          }
          case 'string_replace': return String(args.TXT || '').split(String(args.OLD || '')).join(String(args.NEW || ''));
          case 'string_slice': {
            const s = String(args.TXT || '');
            const start = num(args.START, 0);
            const end = num(args.END, -1);
            return end < 0 ? s.slice(start) : s.slice(start, end);
          }
          case 'engine_get_leaderboard_data': {
            const sid = ctx.state['__active_session'];
            const metric = args.METRIC || 'kills';
            const sess = (ctx.runtime._gameSessions || {})[sid];
            if (!sess) return { leaderboard: [] };
            // Construye el ranking desde state['player_<cid>_kills'] estilo AOT.
            const board = [];
            sess.players.forEach(cid => {
              const k = 'player_' + cid + '_' + metric;
              board.push({ client_id: cid, value: num(ctx.state[k]) });
            });
            board.sort((a, b) => b.value - a.value);
            return { leaderboard: board };
          }
          case 'list_index_of': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l)) return 0;
            const idx = l.indexOf(args.VAL);
            return idx < 0 ? 0 : idx + 1;
          }
          case 'list_get_random_item': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l) || !l.length) return '';
            return l[Math.floor(Math.random() * l.length)];
          }
          case 'list_join': {
            const l = ctx.state['list_' + args.NAME];
            return Array.isArray(l) ? l.join(String(args.SEP == null ? ', ' : args.SEP)) : '';
          }
          case 'list_count': {
            const l = ctx.state['list_' + args.NAME];
            if (!Array.isArray(l)) return 0;
            return l.filter(x => x === args.VAL).length;
          }
          case 'quiz_get_score': return num(ctx.state['score_' + args.PLAYER]);
          case 'quiz_get_player_rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
          case 'quiz_get_question_category': return 'mixed';
          case 'quiz_get_option_count': return 4;
          case 'players_get_points': return num(ctx.state['score_' + args.PLAYER]);
          case 'players_get_count': return num(ctx.state['player_count'], 0);
          case 'players_get_all_names': return JSON.stringify(['Jugador 1', 'Jugador 2']);
          case 'players_get_rank': return _rankOf(ctx, ctx.state['score_' + args.PLAYER]);
          case 'players_get_var': return ctx.state['player_' + args.PLAYER + '_' + args.VAR];
          case 'state_get_persistent': return ctx.state['persist_' + args.KEY];
          // Power Pack 2 — reporters
          case 'get_timer_remaining': return num(ctx.state['timer_remaining'], 0);
          case 'quiz_get_correct_option': return 1;
          case 'quiz_get_question_image': return '(img)';
          case 'quiz_get_difficulty': return 'media';
          case 'quiz_get_total_questions': return num(ctx.state['total_questions'], 0);
          case 'players_get_top_n': return JSON.stringify(['Jugador 1', 'Jugador 2', 'Jugador 3'].slice(0, Math.max(1, num(args.N, 3))));
          case 'list_pop': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) && l.length ? l.pop() : ''; }
          case 'list_to_json': { const l = ctx.state['list_' + args.NAME]; return JSON.stringify(Array.isArray(l) ? l : []); }
          case 'string_trim': return String(args.TXT || '').trim();
          case 'string_repeat': { const s = String(args.TXT || ''); const n = Math.max(0, Math.floor(num(args.N, 1))); let o = ''; for (let i = 0; i < n; i++) o += s; return o; }
          case 'string_split': { const s = String(args.TXT || ''); const sep = args.SEP === '' || args.SEP == null ? ',' : args.SEP; return JSON.stringify(s.split(sep)); }
          case 'string_to_number': { const n = Number(args.TXT); return isNaN(n) ? 0 : n; }
          case 'math_const': { if (args.C === 'E') return Math.E; if (args.C === 'TAU') return Math.PI * 2; if (args.C === 'PHI') return 1.618033988749895; return Math.PI; }
          case 'math_round_to': { const f = Math.pow(10, Math.max(0, Math.floor(num(args.DEC, 2)))); return Math.round(num(args.A) * f) / f; }
          case 'json_parse': { try { return JSON.parse(args.S || 'null'); } catch (e) { return null; } }
          case 'json_stringify': { try { return JSON.stringify(args.V); } catch (e) { return '""'; } }
          case 'get_timestamp': return (typeof Date !== 'undefined') ? Date.now() : 0;
          case 'get_current_time': {
            const d = new Date();
            const p = n => String(n).padStart(2, '0');
            if (args.FMT === 'HH:MM') return p(d.getHours()) + ':' + p(d.getMinutes());
            if (args.FMT === 'DD/MM') return p(d.getDate()) + '/' + p(d.getMonth() + 1);
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
          }
          case 'random_choice': { const l = ctx.state['list_' + args.NAME]; if (!Array.isArray(l) || !l.length) return ''; return l[Math.floor(Math.random() * l.length)]; }
          case 'string_join':
            return String(args.A == null ? '' : args.A) + String(args.B == null ? '' : args.B);
          case 'parse_json_key':
            try { return JSON.parse(args.J || '{}')[args.K]; } catch (e) { return null; }
          case 'state_get_memory_value':
            return ctx.state[args.KEY];
          case 'quiz_get_current_question_text': return ctx.state['current_question'] || '(pregunta)';
          case 'quiz_get_answer_text': return ctx.state['answer_' + args.OPT] || '(respuesta ' + args.OPT + ')';
          case 'quiz_get_leaderboard_json': return JSON.stringify(ctx.state['leaderboard'] || []);
          case 'get_ndi_latency': return num(ctx.state['ndi_latency_' + args.SRC], 12);
          case 'players_get_name': return ctx.state['player_name_' + args.PLAYER] || args.PLAYER || 'Jugador';
          case 'players_get_fastest_buzzer': return ctx.state['fastest_buzzer'] || '';
          case 'db_query_get_unanswered_count': return num(ctx.state['db_unanswered_count'], 10);
          case 'db_query_search_by_keyword': return num(ctx.state['db_search_' + args.KW], 0);
          case 'db_query_get_hint_text': return ctx.state['db_hint_' + args.QID] || '(pista)';
          case 'list_get_item_at': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? (l[num(args.IDX) - 1] || '') : ''; }
          case 'list_get_length': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? l.length : 0; }
          case 'list_get_item': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? (l[num(args.IDX) - 1] || '') : ''; }
          case 'list_length': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) ? l.length : 0; }
          case 'get_display_connection_count': return 1;
          case 'variable_get': {
            // Use scope stack if available
            if (ctx.runtime && typeof ctx.runtime._getFromScope === 'function') {
              return ctx.runtime._getFromScope(ctx, 'var_' + args.VAR);
            }
            return ctx.state['var_' + args.VAR];
          }
          case 'get_x': return 0;
          case 'get_y': return 0;
          case 'get_answer': return '';
          case 'mouse_x': return 0;
          case 'mouse_y': return 0;
          case 'physics_get_position': {
            const physics = ctx.state.__physics;
            const b = physics && physics.bodies && physics.bodies[args.BID];
            if (!b) return { x: 0, y: 0 };
            return { x: b.x, y: b.y };
          }
          case 'physics_get_velocity': {
            const physics = ctx.state.__physics;
            const b = physics && physics.bodies && physics.bodies[args.BID];
            if (!b) return { vx: 0, vy: 0 };
            return { vx: b.vx, vy: b.vy };
          }
          case 'math_clamp': {
            const v = num(args.VAL), lo = num(args.MIN), hi = num(args.MAX);
            return Math.max(lo, Math.min(hi, v));
          }
          case 'type_of': {
            const v = args.VAL;
            if (v === null || v === undefined) return 'null';
            if (typeof v === 'number') return 'number';
            if (typeof v === 'string') return 'string';
            if (typeof v === 'boolean') return 'boolean';
            if (Array.isArray(v)) return 'list';
            if (typeof v === 'object') return 'json';
            return 'string';
          }
          case 'math_lerp': {
            const a = num(args.A), b = num(args.B), t = num(args.T);
            return a + (b - a) * Math.max(0, Math.min(1, t));
          }
          case 'quiz_get_round': return num(ctx.state['quiz_round'], 1);
          case 'players_get_score_of': return num(ctx.state['score_' + args.PLAYER]);
          case 'event_data': return ctx.eventCtx || null;
          case 'physics_raycast': {
            const physics = ctx.state.__physics;
            if (!physics || !physics.bodies) return { hit: false };
            const rx = num(args.X), ry = num(args.Y);
            const rdx = num(args.DX), rdy = num(args.DY);
            const maxDist = num(args.MAXDIST, 1000);
            const filter = args.FILTER || null;
            const rdist = Math.hypot(rdx, rdy);
            if (rdist === 0) return { hit: false };
            const rux = rdx / rdist, ruy = rdy / rdist;
            let closestHit = null, closestDist = maxDist;
            for (const [bid, body] of Object.entries(physics.bodies)) {
              if (filter && body.collisionFilter !== filter) continue;
              const radius = body.radius || 0.5;
              const fx = body.x - rx, fy = body.y - ry;
              const proj = fx * rux + fy * ruy;
              if (proj < 0 || proj > closestDist) continue;
              const ppx = fx - proj * rux, ppy = fy - proj * ruy;
              const perpDist = Math.hypot(ppx, ppy);
              if (perpDist <= radius) {
                const offset = Math.sqrt(Math.max(0, radius * radius - perpDist * perpDist));
                const hitDist = proj - offset;
                if (hitDist >= 0 && hitDist < closestDist) {
                  closestDist = hitDist;
                  closestHit = { bodyId: bid, point: { x: rx + rux * hitDist, y: ry + ruy * hitDist }, normal: { x: perpDist > 0 ? -ppx / perpDist : 0, y: perpDist > 0 ? -ppy / perpDist : 0 }, distance: hitDist };
                }
              }
            }
            return { hit: !!closestHit, bodyId: closestHit?.bodyId || null, point: closestHit?.point || { x: 0, y: 0 }, normal: closestHit?.normal || { x: 0, y: 0 }, distance: closestHit?.distance || 0 };
          }
          case 'physics_query_aabb': {
            const physics = ctx.state.__physics;
            if (!physics || !physics.bodies) return [];
            const filter = args.FILTER || null;
            const results = [];
            for (const [bid, body] of Object.entries(physics.bodies)) {
              if (filter && body.collisionFilter !== filter) continue;
              const radius = body.radius || 0.5;
              if (body.x + radius >= num(args.MINX) && body.x - radius <= num(args.MAXX) &&
                  body.y + radius >= num(args.MINY) && body.y - radius <= num(args.MAXY)) {
                results.push({ bodyId: bid, x: body.x, y: body.y, vx: body.vx || 0, vy: body.vy || 0, type: body.type });
              }
            }
            return results;
          }
          case 'physics_query_point': {
            const physics = ctx.state.__physics;
            if (!physics || !physics.bodies) return [];
            const px = num(args.X), py = num(args.Y);
            const filter = args.FILTER || null;
            const results = [];
            for (const [bid, body] of Object.entries(physics.bodies)) {
              if (filter && body.collisionFilter !== filter) continue;
              const radius = body.radius || 0.5;
              const d = Math.hypot(body.x - px, body.y - py);
              if (d <= radius) {
                results.push({ bodyId: bid, x: body.x, y: body.y, distance: d });
              }
            }
            return results;
          }
          case 'proc_param': {
            const params = ctx._procParams || {};
            return params[args.NAME] != null ? params[args.NAME] : null;
          }
          case 'proc_call_reporter': {
            const scripts = ctx.runtime._engineScripts || {};
            const procName = 'proc_def_' + args.NAME;
            const chain = scripts[procName];
            if (Array.isArray(chain) && chain.length) {
              const prevParams = ctx._procParams;
              ctx._procParams = ctx._procParams || {};
              this._pushScope(ctx);
              try {
                this.executeChain(chain, ctx);
              } finally {
                this._popScope(ctx);
                ctx._procParams = prevParams;
              }
            }
            return ctx._procReturnValue || null;
          }
          default: return null;
        }
      },
      boolean(opcode, args, ctx) {
        switch (opcode) {
          case 'logic_compare': {
            const A = num(args.A), B = num(args.B);
            if (args.OP === '==') return A === B;
            if (args.OP === '!=') return A !== B;
            if (args.OP === '>') return A > B;
            if (args.OP === '<') return A < B;
            if (args.OP === '>=') return A >= B;
            if (args.OP === '<=') return A <= B;
            return false;
          }
          case 'logic_and_or': {
            const r = args.OP === 'AND' ? (truthy(args.A) && truthy(args.B)) : (truthy(args.A) || truthy(args.B));
            return r;
          }
          case 'logic_not': return !truthy(args.A);
          case 'logic_xor': return truthy(args.A) !== truthy(args.B);
          case 'logic_between': {
            const v = num(args.VAL), lo = num(args.MIN), hi = num(args.MAX);
            return v >= lo && v <= hi;
          }
          case 'string_contains':
            return String(args.TXT || '').indexOf(String(args.SUB || '')) >= 0;
          case 'string_starts_with':
            return String(args.TXT || '').indexOf(String(args.SUB || '')) === 0;
          case 'string_ends_with':
            return String(args.TXT || '').lastIndexOf(String(args.SUB || '')) === (String(args.TXT || '').length - String(args.SUB || '').length);
          case 'string_matches': {
            try { return new RegExp(String(args.PAT || '')).test(String(args.TXT || '')); } catch (e) { return false; }
          }
          case 'is_ndi_source_online': return false;
          case 'players_is_alive': return ctx.state['alive_' + args.PLAYER] !== false;
          case 'key_pressed': return false;
          case 'list_contains': { const l = ctx.state['list_' + args.NAME]; return Array.isArray(l) && l.indexOf(args.VAL) >= 0; }
          case 'quiz_is_paused': return truthy(ctx.state['quiz_paused']);
          case 'timer_is_paused': return truthy(ctx.state['timer_paused']);
          case 'sprite_is_touching': {
            const sprites = ctx.state.__sprites || {};
            const sa = sprites[args.A], sb = sprites[args.B];
            if (!sa || !sb) return false;
            const dx = (sa.x || 0) - (sb.x || 0), dy = (sa.y || 0) - (sb.y || 0);
            return Math.hypot(dx, dy) < 2;
          }
          case 'proc_call_boolean': {
            const scripts = ctx.runtime._engineScripts || {};
            const chain = scripts['proc_def_' + args.NAME];
            if (Array.isArray(chain) && chain.length) {
              this._pushScope(ctx);
              try { this.executeChain(chain, ctx); } finally { this._popScope(ctx); }
            }
            return truthy(ctx._procReturnValue);
          }
          default: return false;
        }
      },
      sideEffect(opcode, args, ctx) {
        // SECURITY: bloqueo duro de opcodes peligrosos ANTES de cualquier
        // allow-list por prefijo (p.ej. 'inject_') para evitar que se aprueben.
        if (opcode === 'execute_raw_javascript' || opcode === 'inject_css_raw') {
          return { ok: false, error: 'SECURITY: ' + opcode + ' está bloqueado por razones de seguridad.' };
        }
        // ---- Local Game Engine (RAM local del runtime) ----
        if (opcode === 'engine_create_player_client') {
          const base = args.BASE || 'persona';
          const n = num(args.SLOTS, 4);
          const players = [];
          for (let i = 1; i <= n; i++) players.push(base + i);
          ctx.runtime._gameSessions = ctx.runtime._gameSessions || {};
          const sid = 'local_' + (args.BASE || 'persona');
          ctx.runtime._gameSessions[sid] = { players: players, template: null };
          ctx.state['__active_session'] = sid;
          return { ok: true, players: players };
        }
        if (opcode === 'engine_load_game_template') {
          const sid = ctx.state['__active_session'];
          if (sid && ctx.runtime._gameSessions) ctx.runtime._gameSessions[sid].template = args.TPL;
          return { ok: true };
        }
        if (opcode === 'render_update_proyector_leaderboard') {
          // json_data puede ser reporter engine_get_leaderboard_data o un objeto.
          const data = args.JSON && args.JSON.leaderboard ? args.JSON : (args.JSON || null);
          if (data && Array.isArray(data.leaderboard)) {
            ctx.state['leaderboard_' + (args.COMP || 'ranking')] = data.leaderboard;
          }
          return { ok: true };
        }
        // ---- Engine Sprites (Canvas 2D local) ----
        if (opcode === 'sprite_spawn') {
          ctx.state.__sprites = ctx.state.__sprites || {};
          ctx.state.__sprites[args.SID] = { asset: args.ASSET, x: num(args.X), y: num(args.Y), vx: 0, vy: 0, anim: null };
          return { ok: true };
        }
        if (opcode === 'sprite_destroy') {
          if (ctx.state.__sprites) delete ctx.state.__sprites[args.SID];
          return { ok: true };
        }
        if (opcode === 'sprite_set_animation') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) ctx.state.__sprites[args.SID].anim = args.ANIM;
          return { ok: true };
        }
        if (opcode === 'sprite_move_to') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) {
            const s = ctx.state.__sprites[args.SID];
            s.x = num(args.TX); s.y = num(args.TY); s.motionMs = num(args.MS); s.ease = args.EASE;
          }
          return { ok: true };
        }
        if (opcode === 'sprite_set_velocity') {
          if (ctx.state.__sprites && ctx.state.__sprites[args.SID]) {
            const s = ctx.state.__sprites[args.SID];
            s.vx = num(args.VX); s.vy = num(args.VY);
          }
          return { ok: true };
        }
        // Estado en RAM (seguro, instantáneo)
        if (opcode === 'state_set_memory') { ctx.state[args.KEY] = args.VAL; return { ok: true }; }
        if (opcode === 'state_init_memory_key') { if (!(args.KEY in ctx.state)) ctx.state[args.KEY] = args.DEF; return { ok: true }; }
        if (opcode === 'state_increment_memory') { ctx.state[args.KEY] = num(ctx.state[args.KEY]) + num(args.BY); return { ok: true }; }
        if (opcode === 'state_commit_to_sqlite') { return { ok: true }; }
        if (opcode === 'state_clear_volatile_cache') { ctx.state = {}; return { ok: true }; }
        // Quiz
        if (opcode === 'quiz_add_score_to_player') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
        if (opcode === 'quiz_verify_player_answer') { return { ok: true }; }
        if (opcode === 'quiz_lock_answers') { return { ok: true }; }
        if (opcode === 'quiz_fetch_next_question') { return { ok: true }; }
        if (opcode === 'quiz_init_engine') { return { ok: true }; }
        // Players
        if (opcode === 'players_strike_penalize' || opcode === 'players_toggle_lockout' ||
            opcode === 'players_set_active_slots' || opcode === 'players_swap_positions' ||
            opcode === 'players_set_avatar') { return { ok: true }; }
        if (opcode === 'players_set_var') { ctx.state['player_' + args.PLAYER + '_' + args.VAR] = args.VAL; return { ok: true }; }
        if (opcode === 'players_send_message') { return { ok: true, message: args.MSG, target: args.PLAYER }; }
        if (opcode === 'players_show_effect') { return { ok: true, effect: args.EFFECT, target: args.PLAYER }; }
        // DB
        if (opcode === 'db_query_filter_difficulty' || opcode === 'db_query_exclude_last_questions' ||
            opcode === 'db_query_mark_as_burned' || opcode === 'db_query_shuffle_answers') { return { ok: true }; }
        // NDI / displays / looks / audio / movement / effects
        if (opcode.indexOf('ndi_') === 0 || opcode.indexOf('display_') === 0 ||
            opcode.indexOf('set_') === 0 || opcode.indexOf('play_') === 0 ||
            opcode.indexOf('hide_') === 0 || opcode.indexOf('show_') === 0 ||
            opcode.indexOf('trigger_') === 0 || opcode.indexOf('inject_') === 0 ||
            opcode.indexOf('spawn_') === 0 || opcode.indexOf('toggle_') === 0 ||
            opcode.indexOf('clear_') === 0 || opcode === 'stop_all_sounds' ||
            opcode.indexOf('stop_bg_') === 0 ||
            opcode === 'go_to_xy' || opcode === 'glide_to_xy' ||
            opcode === 'change_x' || opcode === 'change_y' ||
            opcode === 'set_x' || opcode === 'set_y' ||
            opcode === 'say' || opcode === 'think' ||
            opcode === 'change_size' || opcode === 'set_size' ||
            opcode === 'change_color_effect' ||
            opcode === 'create_clone' || opcode === 'delete_clone' ||
            opcode === 'ask_and_wait' ||
            opcode === 'broadcast' || opcode === 'broadcast_and_wait') { return { ok: true }; }
        // Variables
        if (opcode === 'variable_set') {
            if (ctx.runtime && typeof ctx.runtime._setInScope === 'function') {
              ctx.runtime._setInScope(ctx, 'var_' + args.VAR, args.VAL);
            } else {
              ctx.state['var_' + args.VAR] = args.VAL;
            }
            return { ok: true };
          }
          if (opcode === 'variable_change') {
            if (ctx.runtime && typeof ctx.runtime._getFromScope === 'function' && typeof ctx.runtime._setInScope === 'function') {
              const current = ctx.runtime._getFromScope(ctx, 'var_' + args.VAR) || 0;
              ctx.runtime._setInScope(ctx, 'var_' + args.VAR, num(current) + num(args.VAL));
            } else {
              ctx.state['var_' + args.VAR] = num(ctx.state['var_' + args.VAR]) + num(args.VAL);
            }
            return { ok: true };
          }
        // Listas Pro
        if (opcode === 'list_set_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l[num(args.IDX) - 1] = args.VAL; return { ok: true }; }
        if (opcode === 'list_shuffle') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = l[i]; l[i] = l[j]; l[j] = t; } } return { ok: true }; }
        if (opcode === 'list_sort') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.sort((a, b) => args.OP === 'desc' ? (b > a ? 1 : -1) : (a > b ? 1 : -1)); return { ok: true }; }
        // Control avanzado
        if (opcode === 'exit_loop') { throw new BreakSignal(); }
        if (opcode === 'continue_loop') { throw new ContinueSignal(); }
        // Quiz Pro
        if (opcode === 'quiz_set_question') { ctx.state['current_question'] = args.TXT; return { ok: true }; }
        if (opcode === 'quiz_reveal_answer') { ctx.state['answer_revealed'] = true; return { ok: true }; }
        if (opcode === 'quiz_reset_scores') { Object.keys(ctx.state).forEach(k => { if (k.indexOf('score_') === 0) delete ctx.state[k]; }); return { ok: true }; }
        if (opcode === 'quiz_shuffle_options') { return { ok: true }; }
        // Concursantes Pro
        if (opcode === 'players_eliminate') { ctx.state['alive_' + args.PLAYER] = false; return { ok: true }; }
        if (opcode === 'players_revive') { ctx.state['alive_' + args.PLAYER] = true; return { ok: true }; }
        // Estado persistente
        if (opcode === 'state_set_persistent') { ctx.state['persist_' + args.KEY] = args.VAL; return { ok: true }; }
        if (opcode === 'state_load_persistent') { ctx.state['var_' + (args.RAMKEY || args.KEY)] = ctx.state['persist_' + args.KEY]; return { ok: true }; }
        // Looks / Efectos Pro
        if (opcode.indexOf('screen_') === 0 || opcode === 'announce' || opcode === 'display_set_timer') { return { ok: true }; }
        // Audio / Runtime Pro
        if (opcode === 'play_sfx_by_name') { return { ok: true }; }
        if (opcode === 'set_master_volume') { ctx.state['master_volume'] = num(args.VOL, 100); return { ok: true }; }
        if (opcode === 'runtime_debug_log') { if (typeof console !== 'undefined') console.log('[builder]', args.MSG); return { ok: true }; }
        if (opcode === 'runtime_export_json') { if (typeof console !== 'undefined') console.log('[builder:export]', JSON.stringify(ctx.state)); return { ok: true }; }
        // Power Pack 2 — sideEffects
        if (opcode === 'set_timer_duration') { ctx.state['timer_remaining'] = num(args.SEC, 30); return { ok: true }; }
        if (opcode === 'timer_pause' || opcode === 'timer_resume') { return { ok: true }; }
        if (opcode === 'players_sort_by_score') { return { ok: true }; }
        if (opcode === 'players_award_bonus') { ctx.state['score_' + args.PLAYER] = num(ctx.state['score_' + args.PLAYER]) + num(args.PTS); return { ok: true }; }
        if (opcode === 'list_reverse') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.reverse(); return { ok: true }; }
        if (opcode === 'list_unique') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) { const seen = {}; ctx.state['list_' + args.NAME] = l.filter(x => { const k = JSON.stringify(x); if (seen[k]) return false; seen[k] = 1; return true; }); } return { ok: true }; }
        // Listas
        if (opcode === 'list_create') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
        if (opcode === 'list_add_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.push(args.VAL); return { ok: true }; }
        if (opcode === 'list_delete_item' || opcode === 'list_remove_index') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 1); return { ok: true }; }
        if (opcode === 'list_insert_item') { const l = ctx.state['list_' + args.NAME]; if (Array.isArray(l)) l.splice(num(args.IDX) - 1, 0, args.VAL); return { ok: true }; }
        if (opcode === 'list_delete_all') { ctx.state['list_' + args.NAME] = []; return { ok: true }; }
        // Runtime / sistema
        if (opcode === 'runtime_snapshot_take') { ctx.runtime._snapshot = JSON.parse(JSON.stringify(ctx.state)); return { ok: true }; }
        if (opcode === 'runtime_hot_reload') { return { ok: true }; }
        if (opcode === 'system_replicate_state_to_node') { return { ok: true }; }
        if (opcode === 'global_panic_reset') { ctx.runtime.panic(); return { ok: true }; }
        if (opcode === 'break_stack') { throw new BreakSignal(); }
        if (opcode === 'wait_seconds') {
          const sec = num(args.SEC, 1);
          return { ok: true, delay: Math.max(0, Math.min(sec * 1000, 30000)) };
        }
        if (opcode === 'wait_until_timestamp') { return { ok: true }; }
        // Physics / Física
        if (opcode === 'physics_enable') {
          ctx.state.__physics = ctx.state.__physics || { world: { gravity: { x: num(args.GX), y: num(args.GY) } }, bodies: {}, stepCount: 0 };
          return { ok: true };
        }
        if (opcode === 'physics_disable') {
          ctx.state.__physics = null;
          return { ok: true };
        }
        if (opcode === 'physics_create_body') {
          const physics = ctx.state.__physics;
          if (!physics) return { ok: false, error: 'Física no activada. Usa physics_enable primero.' };
          physics.bodies = physics.bodies || {};
          const type = args.TYPE || 'dynamic';
          const mass = type === 'static' ? 0 : 1;
          physics.bodies[args.BID] = {
            type,
            mass,
            x: num(args.X), y: num(args.Y),
            vx: 0, vy: 0,
            fx: 0, fy: 0,
            angle: 0, angularVel: 0,
            fixtures: []
          };
          return { ok: true };
        }
        if (opcode === 'physics_destroy_body') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies) delete physics.bodies[args.BID];
          return { ok: true };
        }
        if (opcode === 'physics_set_velocity') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies && physics.bodies[args.BID]) {
            const b = physics.bodies[args.BID];
            b.vx = num(args.VX);
            b.vy = num(args.VY);
          }
          return { ok: true };
        }
        if (opcode === 'physics_apply_force') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies && physics.bodies[args.BID]) {
            const b = physics.bodies[args.BID];
            const px = num(args.X);
            const py = num(args.Y);
            b.fx = (b.fx || 0) + num(args.FX);
            b.fy = (b.fy || 0) + num(args.FY);
            // Para aplicación puntual, actualizamos velocidad inmediatamente (simplificado)
            b.vx = (b.vx || 0) + num(args.FX) / (b.mass || 1) * 0.016;
            b.vy = (b.vy || 0) + num(args.FY) / (b.mass || 1) * 0.016;
          }
          return { ok: true };
        }
        if (opcode === 'physics_apply_impulse') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies && physics.bodies[args.BID]) {
            const b = physics.bodies[args.BID];
            b.vx = (b.vx || 0) + num(args.IX) / (b.mass || 1);
            b.vy = (b.vy || 0) + num(args.IY) / (b.mass || 1);
          }
          return { ok: true };
        }
        if (opcode === 'physics_set_gravity_scale') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies && physics.bodies[args.BID]) {
            physics.bodies[args.BID].gravityScale = num(args.SCALE);
          }
          return { ok: true };
        }
        if (opcode === 'physics_create_distance_joint') {
          const physics = ctx.state.__physics;
          if (!physics) return { ok: false, error: 'Física no activada' };
          physics.joints = physics.joints || {};
          physics.joints[args.JID] = {
            type: 'distance',
            bodyA: args.A,
            bodyB: args.B,
            length: num(args.LEN)
          };
          return { ok: true };
        }
        // ===== ADVANCED PHYSICS =====
        if (opcode === 'physics_raycast') {
          const physics = ctx.state.__physics;
          if (!physics || !physics.bodies) return { ok: false, error: 'Física no activada' };
          const x1 = num(args.X), y1 = num(args.Y);
          const maxDist = num(args.MAXDIST, 1000);
          const filter = args.FILTER || null;
          const dx = num(args.DX), dy = num(args.DY);
          
          const dist = Math.hypot(dx, dy);
          if (dist === 0) return { ok: true, hit: false };
          
          const ux = dx / dist;
          const uy = dy / dist;
          
          let closestHit = null;
          let closestDist = maxDist;
          
          for (const [bid, body] of Object.entries(physics.bodies)) {
            if (filter && body.collisionFilter !== filter) continue;
            if (body.type === 'static') continue;
            
            // Simple AABB ray intersection
            const radius = body.radius || 0.5;
            const cx = body.x;
            const cy = body.y;
            
            // Vector from ray start to circle center
            const fx = cx - x1;
            const fy = cy - y1;
            
            // Project onto ray
            const proj = fx * ux + fy * uy;
            if (proj < 0 || proj > closestDist) continue;
            
            // Perpendicular distance
            const px = fx - proj * ux;
            const py = fy - proj * uy;
            const perpDist = Math.hypot(px, py);
            
            if (perpDist <= radius) {
              // Hit!
              const offset = Math.sqrt(Math.max(0, radius * radius - perpDist * perpDist));
              const hitDist = proj - offset;
              if (hitDist >= 0 && hitDist < closestDist) {
                closestDist = hitDist;
                closestHit = {
                  bodyId: bid,
                  point: { x: x1 + ux * hitDist, y: y1 + uy * hitDist },
                  normal: { x: -px / perpDist || 0, y: -py / perpDist || 0 },
                  distance: hitDist
                };
              }
            }
          }
          
          return { 
            ok: true, 
            hit: !!closestHit, 
            bodyId: closestHit?.bodyId || null,
            point: closestHit?.point || { x: 0, y: 0 },
            normal: closestHit?.normal || { x: 0, y: 0 },
            distance: closestHit?.distance || 0
          };
        }
        if (opcode === 'physics_query_aabb') {
          const physics = ctx.state.__physics;
          if (!physics || !physics.bodies) return { ok: true, bodies: [] };
          const minX = num(args.MINX), minY = num(args.MINY);
          const maxX = num(args.MAXX), maxY = num(args.MAXY);
          const filter = args.FILTER || null;
          
          const results = [];
          for (const [bid, body] of Object.entries(physics.bodies)) {
            if (filter && body.collisionFilter !== filter) continue;
            const radius = body.radius || 0.5;
            const bx = body.x, by = body.y;
            if (bx + radius >= minX && bx - radius <= maxX &&
                by + radius >= minY && by - radius <= maxY) {
              results.push({
                bodyId: bid,
                x: bx, y: by,
                vx: body.vx || 0, vy: body.vy || 0,
                type: body.type
              });
            }
          }
          return { ok: true, bodies: results };
        }
        if (opcode === 'physics_set_collision_filter') {
          const physics = ctx.state.__physics;
          if (physics && physics.bodies && physics.bodies[args.BID]) {
            physics.bodies[args.BID].collisionFilter = args.FILTER || 'default';
          }
          return { ok: true };
        }
        if (opcode === 'physics_add_fixture') {
          const physics = ctx.state.__physics;
          if (!physics || !physics.bodies || !physics.bodies[args.BID]) {
            return { ok: false, error: 'Cuerpo no encontrado' };
          }
          const body = physics.bodies[args.BID];
          body.fixtures = body.fixtures || [];
          const fixture = {
            shape: args.SHAPE || 'circle',
            radius: num(args.RAD, 0.5),
            width: num(args.W, 1),
            height: num(args.H, 1),
            density: num(args.DEN, 1),
            friction: num(args.FRIC, 0.3),
            restitution: num(args.REST, 0.5),
            isSensor: !!args.ISENSOR,
            offsetX: num(args.OX, 0),
            offsetY: num(args.OY, 0)
          };
          body.fixtures.push(fixture);
          return { ok: true };
        }
        if (opcode === 'physics_create_revolute_joint') {
          const physics = ctx.state.__physics;
          if (!physics) return { ok: false, error: 'Física no activada' };
          physics.joints = physics.joints || {};
          physics.joints[args.JID] = {
            type: 'revolute',
            bodyA: args.A,
            bodyB: args.B,
            anchorX: num(args.AX, 0),
            anchorY: num(args.AY, 0),
            enableMotor: !!args.MOTOR,
            motorSpeed: num(args.MSPEED, 0),
            maxMotorTorque: num(args.MTORQUE, 1000),
            enableLimit: !!args.LIMITS,
            lowerAngle: num(args.MINA, -Math.PI),
            upperAngle: num(args.MAXA, Math.PI)
          };
          return { ok: true };
        }
        if (opcode === 'physics_create_prismatic_joint') {
          const physics = ctx.state.__physics;
          if (!physics) return { ok: false, error: 'Física no activada' };
          physics.joints = physics.joints || {};
          physics.joints[args.JID] = {
            type: 'prismatic',
            bodyA: args.A,
            bodyB: args.B,
            anchorX: num(args.AX, 0),
            anchorY: num(args.AY, 0),
            axisX: num(args.AXISX, 1),
            axisY: num(args.AXISY, 0),
            enableMotor: !!args.MOTOR,
            motorSpeed: num(args.MSPEED, 0),
            maxMotorForce: num(args.MFUERZA, 1000),
            enableLimit: !!args.LIMITS,
            lowerTranslation: num(args.MIN, 0),
            upperTranslation: num(args.MAX, 10)
          };
          return { ok: true };
        }
        if (opcode === 'physics_destroy_joint') {
          const physics = ctx.state.__physics;
          if (physics && physics.joints) {
            delete physics.joints[args.JID];
          }
          return { ok: true };
        }
        // ===== END ADVANCED PHYSICS =====
        
        if (opcode === 'physics_get_position') {
          const physics = ctx.state.__physics;
          const b = physics && physics.bodies && physics.bodies[args.BID];
          if (!b) return { x: 0, y: 0 };
          return { ok: true, x: b.x, y: b.y };
        }
        if (opcode === 'physics_get_velocity') {
          const physics = ctx.state.__physics;
          const b = physics && physics.bodies && physics.bodies[args.BID];
          if (!b) return { vx: 0, vy: 0 };
          return { ok: true, vx: b.vx, vy: b.vy };
        }
        // ===== CUSTOM EVENTS =====
        if (opcode === 'emit_event') {
          const scripts = ctx.runtime._engineScripts || {};
          const chain = scripts['on_custom_event'];
          if (Array.isArray(chain) && chain.length) {
            ctx.runtime.start('on_custom_event', scripts, { eventName: args.NAME, eventData: args.DATA });
          }
          return { ok: true };
        }
        // ===== ANIMATION / ENGINE FX =====
        if (opcode === 'anim_mode' || opcode === 'anim_burst' || opcode === 'anim_flash' ||
            opcode === 'anim_confetti' || opcode === 'anim_clear_fx') {
          return { ok: true };
        }
        // ===== PROCEDURES =====
        if (opcode === 'proc_call') {
          const scripts = ctx.runtime._engineScripts || {};
          const chain = scripts['proc_def_' + args.NAME];
          if (Array.isArray(chain) && chain.length) {
            ctx.runtime.start('proc_def_' + args.NAME, scripts, {});
          }
          return { ok: true };
        }
        if (opcode === 'proc_return') {
          ctx._procReturnValue = args.VAL;
          return { ok: true };
        }
        // ===== LOOKS / UI (local) =====
        if (opcode === 'load_font') {
          if (typeof document !== 'undefined' && args.URL && args.NAME) {
            try {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = args.URL;
              document.head.appendChild(link);
            } catch (e) { /* ignore */ }
          }
          return { ok: true };
        }
        if (opcode === 'create_overlay' || opcode === 'create_tween') {
          return { ok: true };
        }
        if (opcode === 'move_component') {
          return { ok: true };
        }
        // ===== VARIABLES =====
        if (opcode === 'variable_init') {
          if (!(('var_' + args.VAR) in ctx.state)) {
            if (ctx.runtime && typeof ctx.runtime._setInScope === 'function') {
              ctx.runtime._setInScope(ctx, 'var_' + args.VAR, args.VAL);
            } else {
              ctx.state['var_' + args.VAR] = args.VAL;
            }
          }
          return { ok: true };
        }
        return { ok: true };
      }
    };
  };

  ScratchRuntime.BlockError = BlockError;
  ScratchRuntime.BreakSignal = BreakSignal;
  ScratchRuntime.ContinueSignal = ContinueSignal;

  global.ScratchRuntime = ScratchRuntime;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScratchRuntime, BlockError, BreakSignal };
  }
})(typeof window !== 'undefined' ? window : this);
