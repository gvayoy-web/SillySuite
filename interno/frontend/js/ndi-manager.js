/**
 * ndi-manager.js — Abstracion NDI (SillyQuiz)
 *
 * En producción real se apoya en un Background Worker (Electron/Tauri o backend
 * Python/NDI) que no bloquea el ciclo de juego (§1.1A). En entorno 100% offline
 * sin librería NDI, corre en MODO SIMULACIÓN: mantiene un caché reactivo de
 * fuentes (ndiSourcesCache) y responde con latencia/estado para los bloques.
 *
 * Provee primitivas para: ndi_start_discovery_worker, ndi_connect_source,
 * ndi_disconnect_source, ndi_send_canvas_scene, ndi_set_frame_rate,
 * ndi_toggle_failover_image, get_ndi_latency, is_ndi_source_online.
 */
(function (global) {
  'use strict';

  class NDIManager {
    constructor() {
      this.cache = [];          // ndiSourcesCache: fuentes detectadas
      this.workerActive = false;
      this.frameRate = '30fps';
      this.failover = { image: null, on: false };
      this.connections = {};    // outputId -> sourceName
      this._updateHandlers = [];
    }

    /* Discovery en Background Worker (no bloquea UI). */
    startDiscoveryWorker(sources) {
      this.workerActive = true;
      this.cache = (sources || [
        { name: 'vMix-Output', online: true, latency: 12 },
        { name: 'OBS-Cam1', online: true, latency: 20 },
        { name: 'Tricaster-PGM', online: false, latency: 0 }
      ]).map(s => Object.assign({ online: true, latency: 15 }, s));
      this._emit();
      return true;
    }

    getSources() { return this.cache.slice(); }

    _find(name) { return this.cache.find(c => c.name === name); }

    connect(source, output) {
      const s = this._find(source);
      if (!s) return { ok: false, error: 'fuente no encontrada: ' + source };
      if (!s.online) return { ok: false, error: 'fuente fuera de línea: ' + source };
      this.connections[output] = source;
      this._emit();
      return { ok: true };
    }

    disconnect(output) {
      delete this.connections[output];
      this._emit();
      return { ok: true };
    }

    sendCanvasScene(scene, withAlpha) {
      // En producción: transmitir la web (con/sin alpha) a OBS/vMix vía NDI.
      return { ok: true, scene: scene, alpha: !!withAlpha };
    }

    setFrameRate(fps) { this.frameRate = fps; return { ok: true }; }

    toggleFailover(image, on) {
      this.failover = { image: image || this.failover.image, on: !!on };
      return { ok: true };
    }

    getLatency(source) { const s = this._find(source); return s ? s.latency : 0; }
    isOnline(source) { const s = this._find(source); return !!(s && s.online); }

    onUpdate(fn) { if (typeof fn === 'function') this._updateHandlers.push(fn); }
    _emit() { this._updateHandlers.forEach(h => h(this.cache, this.connections)); }
  }

  global.NDIManager = NDIManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = { NDIManager };
})(typeof window !== 'undefined' ? window : this);
