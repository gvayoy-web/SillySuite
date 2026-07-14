// control-api.js
// Punto de entrada de la API para el panel de control. Re-exporta los
// helpers definidos en sillycontrol-api.js para mantener la ruta de
// importación './control-api.js' usada por sillycontrol-core.js.
export {
  API,
  fetchRetry,
  apiPost,
  apiPut,
  connectSSE,
  disconnectSSE,
} from './sillycontrol-api.js';
