import { type Providers, type SideEffectResult, type ExecutionContext, type Runtime } from './shared-types';

export const MAX_STEPS = 2000000;
export const BOOLEAN_OPCODES = new Set<string>([
  'logic_compare', 'logic_and_or', 'logic_not', 'logic_xor', 'logic_between',
  'string_contains', 'string_starts_with', 'string_ends_with', 'string_matches',
  'is_ndi_source_online', 'players_is_alive', 'key_pressed', 'list_contains',
  'quiz_is_paused', 'timer_is_paused', 'sprite_is_touching', 'proc_call_boolean'
]);

export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

export function num(v: unknown, d?: number): number {
  if (v === '' || v == null || isNaN(Number(v))) return d ?? 0;
  return Number(v);
}

export function _rankOf(ctx: ExecutionContext, score: number): number {
  const s = num(score);
  let rank = 1;
  Object.keys(ctx.state || {}).forEach(k => {
    if (k.startsWith('score_') && num(ctx.state[k]) > s) rank++;
  });
  return rank;
}

export class BlockError extends Error {
  opcode?: string;
  name = 'BlockError';
  constructor(opcode?: string, message?: string) {
    super(message);
    this.opcode = opcode;
  }
}
export class BreakSignal extends Error { name = 'BreakSignal'; constructor() { super('break'); } }
export class ContinueSignal extends Error { name = 'ContinueSignal'; constructor() { super('continue'); } }
export class TimeoutSignal extends Error { name = 'TimeoutSignal'; constructor(ms?: number) { super('timeout:' + ms); } }

export function buildProviders(): Providers {
  function reporter(opcode: string, args: Record<string, unknown>, ctx: ExecutionContext): unknown { return null; }
  function boolean(opcode: string, args: Record<string, unknown>, ctx: ExecutionContext): boolean { return false; }
  function sideEffect(opcode: string, args: Record<string, unknown>, ctx: ExecutionContext) { return { ok: false, error: `Efecto secundario desconocido: ${opcode}` }; }
  return { reporter, boolean, sideEffect };
}

export function createRuntime(initialState?: Record<string, unknown>, timeoutMs?: number) {
  const providers = buildProviders();
  const runtime = {
    providers,
    state: initialState || {},
    killed: false,
    steps: 0,
    intents: [],
    _gameSessions: {},
    _snapshot: null,
    scopeStack: [],
    startTime: Date.now(),
    timeoutMs: timeoutMs ?? 2000,
    _pushScope: (ctx: ExecutionContext) => { ctx.scopeStack.push(new Map()); },
    _popScope: (ctx: ExecutionContext) => { if (ctx.scopeStack.length > 0) ctx.scopeStack.pop(); },
    _getFromScope: (ctx: ExecutionContext, name: string) => {
      for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
        if (ctx.scopeStack[i].has(name)) return ctx.scopeStack[i].get(name);
      }
      return ctx.state[name];
    },
    _setInScope: (ctx: ExecutionContext, name: string, value: unknown) => {
      if (ctx.scopeStack.length > 0) ctx.scopeStack[ctx.scopeStack.length - 1].set(name, value);
      ctx.state[name] = value;
    },
    panic: () => { runtime.killed = true; },
  };
  return runtime;
}

export function resolveArgs(node: any, ctx: any): Record<string, unknown> {
  return {};
}

export function evalNode(node: any, ctx: any): unknown {
  return null;
}

export function execute(program: any, initialState?: any, timeoutMs?: number) {
  const runtime = createRuntime(initialState, timeoutMs);
  const ctx: ExecutionContext = {
    state: runtime.state,
    eventCtx: (program && program.eventCtx) || {},
    runtime,
    scopeStack: runtime.scopeStack,
  };

  const scripts = program && program.scripts ? program.scripts : (program && Array.isArray(program) ? program : {});
  if (Array.isArray(scripts)) {
    return executeChain(scripts, ctx);
  } else {
    Object.keys(scripts).forEach(hat => {
      const chain = (scripts as Record<string, unknown>)[hat];
      if (Array.isArray(chain)) executeChain(chain, ctx);
    });
  }
  return { state: ctx.state, intents: runtime.intents };
}

function executeChain(chain: unknown[], ctx: ExecutionContext) {}

export { type BlockError, type BreakSignal, type ContinueSignal, type TimeoutSignal, type Providers };