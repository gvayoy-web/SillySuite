/**
 * mod-sdk.d.ts — Contrato público del SDK para creadores de mods.
 *
 * Tipos de alto nivel que un creador de mod usa para declarar su paquete,
 * su programa AOT y validarlo contra el runtime. Coherente con la semántica
 * de scratch-blocks.js (def()/REGISTRY) y opcodes.d.ts.
 *
 * No es generado; es el contrato estable del SDK.
 */

import type { BlockDef } from './opcodes';

/** Resultado de validar un programa AOT contra el runtime. */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/** Contexto en vivo de un concursante (jugador). */
export interface PlayerContext {
  id: string;
  name: string;
  score: number;
}

/**
 * Programa AOT: grafo de nodos planos referenciados por id.
 * `hats` son los disparadores (type 'hat'); `nodes` el resto de la pila.
 * `next`/`body` apuntan a otros nodos por su id (o null).
 */
export interface AotProgram {
  hats: Record<string, AotNode>;
  nodes: Record<string, AotNode>;
}

/** Paquete de mod completo que se registra en el runtime. */
export interface ModPackage {
  name: string;
  version: string;
  author?: string;
  description?: string;
  blocks: BlockDef[];
  program: AotProgram;
}

/** Superficie del SDK expuesta a los creadores de mods. */
export interface ModSDK {
  /** Registra un bloque custom en el registro del runtime. */
  registerBlock(block: BlockDef): void;
  /** Valida un programa AOT (opcodes, puertos, bodies). */
  validate(program: AotProgram): ValidationResult;
  /** Devuelve el contexto del concursante o null si no existe. */
  getPlayer(id: string): PlayerContext | null;
  /** Emite un evento de broadcast a todas las pantallas/scripts. */
  broadcast(event: string, payload?: unknown): void;
}

export type { AotNode, BlockDef };
