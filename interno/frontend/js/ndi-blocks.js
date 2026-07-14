/**
 * ndi-blocks.js — Proveedores de ejecución para los bloques NDI (categoría ndi).
 * Se fusionan sobre ScratchRuntime.defaultProviders en modo-builder-v2.js.
 */
(function (global) {
  'use strict';
  global.ScratchProviderFactories = global.ScratchProviderFactories || {};
  global.ScratchProviderFactories.ndi = function (ndi) {
    ndi = ndi || new (global.NDIManager || function () {})();
    return {
      sideEffect: {
        ndi_start_discovery_worker: function () { ndi.startDiscoveryWorker(); return { ok: true }; },
        ndi_connect_source: function (a) { return ndi.connect(a.SRC, a.OUT); },
        ndi_disconnect_source: function (a) { return ndi.disconnect(a.OUT); },
        ndi_send_canvas_scene: function (a) { return ndi.sendCanvasScene(a.SCENE, a.A); },
        ndi_set_frame_rate: function (a) { return ndi.setFrameRate(a.FPS); },
        ndi_toggle_failover_image: function (a) { return ndi.toggleFailover(a.IMG, a.ON); }
      },
      reporter: {
        get_ndi_latency: function (a) { return ndi.getLatency(a.SRC); }
      },
      boolean: {
        is_ndi_source_online: function (a) { return ndi.isOnline(a.SRC); }
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
