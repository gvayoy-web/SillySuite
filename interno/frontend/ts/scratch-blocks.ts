// README: TypeScript files created in /interno/frontend/ts/
// - shared-types.ts: 3310 chars, contratos puros (sin DOM)
// - scratch-runtime.ts: 3773 chars, shell type-safe (no DOM)
// - sandbox-worker.ts: 4802 chars, worker type-safe (no DOM)

// Próxima: reescribir scratch-blocks.js → scratch-blocks.ts

import { ScratchBlocks } from './opcodes';
import { Runtime } from './shared-types';
import type { DynamicBlocks } from './dynamic-blocks';
import type { SandboxedJS } from './scratch-sandbox';

// Define utilidades puras inmediatamente siguientes aquí...

const MAX_STEPS = 2000000;
const PERF_LOG_THRESHOLD_MS = 50;
