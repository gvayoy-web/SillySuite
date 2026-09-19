export type Flag = boolean;
export type Int = number;
export type Json = unknown;

export interface Coord2D {
  x: number;
  y: number;
}

export interface ShapeState extends Record<string, Json> {
  __physics?: {
    world?: { gravity?: Coord2D };
    bodies?: Record<string, {
      type?: 'static' | 'dynamic';
      mass?: number;
      x?: number;
      y?: number;
      vx?: number;
      vy?: number;
    }>;
  };

  __sprites?: Record<string, Coord2D & { asset?: string } & Partial<Record<'vx' | 'vy' | 'anim', Json>>>;

  player_count?: Int;
  score_{playerId}?: Int;

  db_unanswered_count?: Int;
  db_search_{keyword}?: Int;
  db_hint_{qid}?: string;

  total_questions?: Int;
  timer_remaining?: Int;
  quiz_paused?: Flag;
  timer_paused?: Flag;
  answer_revealed?: Flag;
  master_volume?: Int;

  ndi_latency_{source}?: Int;
  fastest_buzzer?: string;
  leaderboard_{ranking}?: Array<{ client_id: string; value: Int; }>;

  __active_session?: string;
  __level?: string;
}

export interface AotNode {
  opcode: string;
  args?: Record<string, AotNode | Json>;
  body?: AotNode;
  elseBody?: AotNode;
  next?: AotNode;
  bodyIds?: string[];
  bodies?: string[] | null;
  _resolved?: Record<string, Json>;
  scope?: string | null;
}

export interface Intent {
  opcode: string;
  args: Record<string, Json>;
}

export interface Runtime {
  providers: Providers;
  state: ShapeState;
  killed: boolean;
  steps: Int;
  intents: Intent[];
  _gameSessions: Record<string, { players: string[]; template?: Json; }>;
  _snapshot: ShapeState | null;
  scopeStack: Array<Map<string, Json>>;
  startTime: Int;
  timeoutMs: Int;

  _pushScope(ctx: ExecutionContext): void;
  _popScope(ctx: ExecutionContext): void;
  _getFromScope(ctx: ExecutionContext, name: string): Json;
  _setInScope(ctx: ExecutionContext, name: string, value: Json): void;
  panic(): void;
}

export interface ExecutionContext {
  state: ShapeState;
  eventCtx?: Record<string, Json>;
  runtime: Runtime;
  scopeStack: Array<Map<string, Json>>;
}

export type MathUnaryOp = 'sqrt' | 'abs' | 'round' | 'floor' | 'ceil' | 'sin' | 'cos' | 'tan' | 'ln' | 'log10';
export type MathBinaryOp = 'pow' | 'mod' | 'min' | 'max';
export type MathCalcOp = '+' | '-' | '*' | '/' | '∗' | '÷';

export interface MathUnaryArgs { OP: MathUnaryOp; A: number; }
export interface MathBinaryArgs { OP: MathBinaryOp; A: number; B: number; }
export interface MathCalcArgs { OP: MathCalcOp; A: number; B: number; }

export function isMathUnaryOpcode(opcode: string): opcode is 'math_unary' { return opcode === 'math_unary'; }
export function isMathBinaryOpcode(opcode: string): opcode is 'math_binary' { return opcode === 'math_binary'; }
export function isMathCalcOpcode(opcode: string): opcode is 'math_calc' { return opcode === 'math_calc'; }

export interface Providers {
  reporter(opcode: string, args: Record<string, Json>, ctx: ExecutionContext): Json;
  boolean(opcode: string, args: Record<string, Json>, ctx: ExecutionContext): boolean;
  sideEffect(opcode: string, args: Record<string, Json>, ctx: ExecutionContext): SideEffectResult;
}

export type SideEffectResult = { ok: true; intent?: true; } | { ok: false; error: string; };