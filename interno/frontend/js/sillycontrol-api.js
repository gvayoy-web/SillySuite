export const API = window.location.origin + '/api';
window.API = API;

// CSRF token: extracted from X-CSRF-Token header on page load
let _csrfToken = '';

export function setCsrfToken(token) {
  _csrfToken = token;
  window.__csrfToken = token;
}

// Try to extract CSRF from meta tag or last response header
(function initCsrf() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) _csrfToken = meta.content;
})();

function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (_csrfToken) h['X-CSRF-Token'] = _csrfToken;
  return h;
}

export async function fetchRetry(url, opts = {}, retries = 2, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, opts);
      // Capture CSRF token from response headers
      const token = r.headers.get('X-CSRF-Token');
      if (token) setCsrfToken(token);

      // If auth required, redirect to login
      if (r.status === 401) {
        const data = await r.clone().json().catch(() => ({}));
        if (data.auth_required) {
          window.location.href = '/login';
          return;
        }
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

export function apiPost(endpoint, body) {
  return fetchRetry(API + endpoint, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
}

export function apiPut(endpoint, body) {
  return fetchRetry(API + endpoint, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
}

export function apiDelete(endpoint) {
  return fetchRetry(API + endpoint, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'same-origin',
  });
}

let sse = null;
let sseRetry = 1000;
let sseReconnecting = false;
let _sseOpened = false;
let _sseStopped = false;
let _sseFetchCtrl = null;

function sseHandlePayload(payload, onMessage) {
  if (!payload || payload === '[KEEPALIVE]') return;
  try {
    const d = JSON.parse(payload);
    if (onMessage) onMessage(d);
    sseRetry = 1000;
  } catch (err) { /* ignore malformed frame */ }
}

function startSseFetch({ onMessage, onStatusChange }) {
  if (_sseFetchCtrl) return;
  const ctrl = new AbortController();
  _sseFetchCtrl = ctrl;
  (async () => {
    try {
      const res = await fetch(API + '/stream', {
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok || !res.body) throw new Error('status ' + res.status);
      if (onStatusChange) onStatusChange(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line.startsWith('data:')) {
            sseHandlePayload(line.slice(5).trim(), onMessage);
          }
        }
      }
      if (onStatusChange) onStatusChange(false);
    } catch (e) {
      if (!ctrl.signal.aborted && onStatusChange) onStatusChange(false);
    } finally {
      _sseFetchCtrl = null;
    }
    if (!_sseStopped) {
      const delay = sseRetry;
      sseRetry = Math.min(sseRetry * 2, 20000);
      setTimeout(() => { if (!_sseStopped) startSseFetch({ onMessage, onStatusChange }); }, delay);
    }
  })();
}

export function connectSSE({ onMessage, onStatusChange }) {
  if (_sseStopped) return;
  if (sse) { sse.close(); sse = null; }
  _sseOpened = false;
  const src = new EventSource(API + '/stream');
  sse = src;

  src.onopen = () => { _sseOpened = true; sseRetry = 1000; };

  src.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (onMessage) onMessage(d);
      if (onStatusChange) onStatusChange(true);
      sseRetry = 1000;
    } catch (err) { console.warn('SSE parse error', err); }
  };
  src.addEventListener('state:snapshot', e => {
    try {
      const d = JSON.parse(e.data);
      if (onMessage) onMessage(d);
      if (onStatusChange) onStatusChange(true);
      sseRetry = 1000;
    } catch (err) { console.warn('SSE snapshot parse error', err); }
  });
  src.onerror = () => {
    if (_sseOpened) {
      if (sseReconnecting) return;
      sseReconnecting = true;
      const delay = sseRetry;
      sseRetry = Math.min(sseRetry * 2, 20000);
      setTimeout(() => {
        if (sse !== src) return;
        try { src.close(); } catch (e) {}
        sse = null;
        sseReconnecting = false;
        connectSSE({ onMessage, onStatusChange });
      }, delay);
      return;
    }
    try { src.close(); } catch (e) {}
    sse = null;
    startSseFetch({ onMessage, onStatusChange });
  };

  setTimeout(() => {
    if (!_sseOpened && sse === src && !_sseStopped) {
      try { src.close(); } catch (e) {}
      sse = null;
      startSseFetch({ onMessage, onStatusChange });
    }
  }, 4000);
}

export function disconnectSSE() {
  _sseStopped = true;
  if (_sseFetchCtrl) { try { _sseFetchCtrl.abort(); } catch (e) {} _sseFetchCtrl = null; }
  if (sse) { try { sse.close(); } catch (e) {} sse = null; }
}
