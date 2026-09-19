/**
 * display-manager.js — Cliente de sincronización multi-display (SillyQuiz)
 *
 * Conecta al servidor WebSocket独立iente (interno/websocket_server.py, puerto 8081)
 * y provee las primitivas usadas por los bloques de la categoría "displays":
 *   - display_broadcast_payload  -> DisplayManager.broadcastPayload
 *   - display_sync_clocks        -> DisplayManager.syncClocks
 *   - get_display_connection_count -> DisplayManager.getConnectionCount
 *   - on_player_buzz / on_player_answer -> consume la cola FIFO de hardware
 *
 * Al consumir eventos de hardware, respeta el orden FIFO del servidor (§7.2).
 */
(function (global) {
  'use strict';

  class DisplayManager {
    constructor(opts) {
      opts = opts || {};
      this.url = opts.url || ('ws://' + (global.location ? global.location.hostname : '127.0.0.1') + ':8081');
      this.ws = null;
      this.connected = false;
      this.connectionCount = 0;
      this._hwHandlers = [];
      this._clockHandlers = [];
      this._statusHandlers = [];
      if (opts.autoconnect !== false) this.connect();
    }

    connect() {
      if (typeof global.WebSocket === 'undefined') {
        this._log('WebSocket no disponible en este entorno (modo simulación).');
        return false;
      }
      try {
        this.ws = new global.WebSocket(this.url);
        this.ws.onopen = () => {
          this.connected = true;
          this.send({ type: 'register', display_id: getDisplayId() });
          this._emitStatus();
          this._log('Conectado a sync WS: ' + this.url);
        };
        this.ws.onmessage = (ev) => this._onMessage(ev);
        this.ws.onclose = () => { this.connected = false; this._emitStatus(); };
        this.ws.onerror = () => { this.connected = false; this._emitStatus(); };
        return true;
      } catch (e) {
        this._log('Error WS: ' + e.message);
        return false;
      }
    }

    _onMessage(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      if (msg.type === 'display_count') { this.connectionCount = msg.count; this._emitStatus(); }
      else if (msg.type === 'clock' && msg.server_unix != null) { this._clockHandlers.forEach(h => h(msg.server_unix)); }
      else if (msg.type === 'hardware_event' && msg.event) { this._hwHandlers.forEach(h => h(msg.event)); }
    }

    send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
      }
      return false;
    }

    broadcastPayload(displayId, action, data) {
      return this.send({ type: 'payload', display_id: displayId || 'all', data: { action: action, data: data } });
    }

    syncClocks(cb) {
      if (cb) this._clockHandlers.push(cb);
      return this.send({ type: 'sync_clock' });
    }

    getConnectionCount() { return this.connectionCount; }

    onHardwareEvent(fn) { if (typeof fn === 'function') this._hwHandlers.push(fn); }
    onStatus(fn) { if (typeof fn === 'function') this._statusHandlers.push(fn); }
    _emitStatus() { this._statusHandlers.forEach(h => h(this.connected, this.connectionCount)); }

    _log(m) { if (global.console) global.console.info('[DisplayManager] ' + m); }
  }

  function getDisplayId() { return 'control_' + (global.location ? global.location.hostname : 'local'); }

  global.DisplayManager = DisplayManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DisplayManager };
})(typeof window !== 'undefined' ? window : this);
