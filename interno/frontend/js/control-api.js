// control-api.js
// API entry point for the control panel. Re-exports helpers from sillycontrol-api.js.
export {
  API,
  fetchRetry,
  apiPost,
  apiPut,
  apiDelete,
  setCsrfToken,
  connectSSE,
  disconnectSSE,
} from './sillycontrol-api.js';
