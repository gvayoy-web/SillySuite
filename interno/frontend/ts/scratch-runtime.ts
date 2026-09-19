import { Runtime } from './shared-types';

const MAX_STEPS = 2000000;
const PERF_LOG_THRESHOLD_MS = 50;

export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

export function toNum(v: unknown, d?: number): number {
  if (v === '' || v == null || isNaN(Number(v))) return d ?? 0;
  return Number(v);
}

export function _rankOf(ctx: { state: Record<string, unknown> }, score: number): number {
  const s = toNum(score);
  let rank = 1;
  Object.keys(ctx.state || {}).forEach(k => {
    if (k.startsWith('score_') && toNum(ctx.state[k]) > s) rank++;
  });
  return rank;
}

export class BlockError extends Error {
  opcode: string;
  name = 'BlockError';
  constructor(opcode: string, message: string) {
    super(message);
    this.opcode = opcode;
  }
}

export class BreakSignal extends Error {
  name = 'BreakSignal';
  constructor() { super('break'); }
}

export class ContinueSignal extends Error {
  name = 'ContinueSignal';
  constructor() { super('continue'); }
}

export class ScratchRuntime {
  providers: any;
  hooks: Record<string, unknown>;
  state: Record<string, unknown>;
  killed: boolean;
  activeCount: number;
  _delayQueue: unknown[];
  _isPaused: boolean;
  _perfMetrics: { blocks: number; totalTime: number; slowBlocks: unknown[]; };
  _callStack: unknown[];

  constructor(opts: Partial<{ providers: any; hooks: Record<string, unknown>; state: Record<string, unknown> }>) {
    opts = opts || {};
    this.providers = opts.providers || {};
    this.hooks = opts.hooks || {};
    this.state = opts.state || {};
    this.killed = false;
    this.activeCount = 0;
    this._delayQueue = [];
    this._isPaused = false;
    this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
    this._callStack = [];
  }

  panic() { this.killed = true; }
  reset() {
    this.killed = false;
    this.activeCount = 0;
    this._perfMetrics = { blocks: 0, totalTime: 0, slowBlocks: [] };
  }

  stepPhysics(dt: number) {
    const physics = this.state.__physics;
    if (!physics || !physics.bodies) return;
    const world = physics.world || {};
    const gravity = world.gravity || { x: 0, y: 9.8 };
    Object.values(physics.bodies).forEach(b => {
      if (b.type === 'static' || b.mass === 0) return;
      b.vy = (b.vy || 0) + gravity.y * (b.gravityScale ?? 1) * dt;
      b.vx = (b.vx || 0) + gravity.x * (b.gravityScale ?? 1) * dt;
    });
  }

  executeChain(chain: unknown[], ctx: unknown): unknown {
    return undefined;
  }
}

export { type CaseContainer } from './shared-types';