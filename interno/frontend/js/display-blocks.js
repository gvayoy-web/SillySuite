/**
 * display-blocks.js — Proveedores para los bloques Multi-Display (categoría displays).
 */
(function (global) {
  'use strict';
  global.ScratchProviderFactories = global.ScratchProviderFactories || {};
  global.ScratchProviderFactories.display = function (dm) {
    dm = dm || new (global.DisplayManager || function () {})();
    return {
      sideEffect: {
        display_register_setup: function () { return { ok: true }; },
        display_broadcast_payload: function (a) {
          return { ok: dm.broadcastPayload(a.DISP, a.ACT, a.DATA) };
        },
        display_sync_clocks: function () {
          return { ok: dm.syncClocks() };
        },
        clear_all_displays: function () { return { ok: dm.broadcastPayload('all', 'clear', null) }; },
        set_layer_z_index: function () { return { ok: true }; },
        set_grid_anchor: function () { return { ok: true }; },
        toggle_fullscreen_layer: function (a) { return { ok: dm.broadcastPayload(a.DISP, 'fullscreen', a.ON) }; }
      },
      reporter: {
        get_display_connection_count: function () { return dm.getConnectionCount(); }
      }
    };
  };
})(typeof window !== 'undefined' ? window : this);
