# Sandbox de ejecución (Web Worker)

## Por qué existe
Hoy `scratch-runtime.js` corre en el **hilo principal**. Un mod mal escrito
(bucle infinito, recursión sin freno, cómputo pesado) puede **congelar la
pestaña** del navegador. El Sandbox resuelve eso ejecutando el programa AOT
dentro de un **Web Worker**: si se descontrola, el hilo principal lo mata con
`worker.terminate()` y la UI sigue viva.

## Estado (opt-in)
- `SANDBOX_ENABLED = false` en `sandbox-executor.js`.
- **NO está cableado al path en vivo**: la app sigue usando `scratch-runtime.js`.
- Es aditivo: no se tocó ningún archivo existente.

## Archivos nuevos
- `sandbox-worker.js` — Entrada del Worker (`self.onmessage`). Caminata AOT
  autocontenida, **sin DOM** (no usa `document`/`window`). Cómputo puro
  (variables, listas, operadores, cadenas, control de flujo) muta un estado
  serializable; los efectos de display/audio/ui/looks/ndi/red se recogen como
  `intents`. Guarda dura: presupuesto de nodos + timeout de reloj.
- `sandbox-executor.js` — ES Module del hilo principal. Exporta
  `SANDBOX_ENABLED` y `executeInSandbox(program, initialState, opts)`.
  Lanza el worker, escucha `result`/`error`/`intents` y **lo terminatea** en
  timeout/error.
- `SANDBOX.md` — Este documento.

## Cómo habilitarlo
1. En `sandbox-executor.js` cambia `export const SANDBOX_ENABLED = true;`
2. Reemplaza la llamada a `ScratchRuntime` por `executeInSandbox(...)` en el
   punto donde hoy se ejecuta el programa, y aplica los `intents` devueltos
   contra el DOM/canvas/red reales en el hilo principal.

## Contrato de intents (hand-off)
El worker **no** toca display/audio/red. Para cada efecto secundario externo
devuelve un intent:
```js
{ opcode: string, args: object }   // args ya resueltos (reporters/booleans evaluados)
```
El hilo principal debe reenviar cada intent al provider `sideEffect` real
(contra el DOM/canvas/WebSocket). El worker SÍ ejecuta los efectos que sólo
mutan estado serializable (`variable_*`, `list_*`, `state_*`, `quiz_*`,
`players_*`, física/sprites en RAM, timers). El resultado final es:
```js
{ ok: true, state: <estado serializable>, intents: [ ... ] }
// o en fallo:
{ ok: false, error: string }
```

## Seguridad
- Bloqueo duro de `execute_raw_javascript` e `inject_css_raw`.
- Presupuesto `MAX_STEPS` y `timeoutMs` (def. 2000 ms) con reporte de timeout.
- El worker es matado por el hilo principal en cualquier error/timeout.
