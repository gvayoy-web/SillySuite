/**
 * modo-builder-v2.js — Orquestador del Infinite Canvas Builder v2.1
 *
 * Une los managers (DisplayManager, NDIManager) con el registro de bloques
 * (ScratchBlocks), el compilador AOT (ScratchAOT), el ejecutor (ScratchRuntime)
 * y el editor (ScratchUI). Construye los providers fusionando los defaults con
 * las fábricas de NDI / Display / Game, y arranca la UI dentro del contenedor.
 */
(function (global) {
  'use strict';

  function mergeInto(target, src) {
    if (!src) return;
    Object.keys(src).forEach(k => { target[k] = src[k]; });
  }

  /**
   * Une los defaults seguros (ScratchRuntime.defaultProviders) con las
   * implementaciones específicas de NDI / Display / Game. El runtime espera
   * que sideEffect / reporter / boolean sean FUNCIONES (opcode, args, ctx),
   * por eso envolvemos los mapas de overrides en disptachers que prefieren
   * el override y, si no existe, delegan al default seguro.
   */
  function buildProviders(dm, ndi) {
    const base = global.ScratchRuntime.defaultProviders();
    const override = { reporter: {}, boolean: {}, sideEffect: {} };
    const factories = global.ScratchProviderFactories || {};
    const sets = [];
    if (factories.ndi) sets.push(factories.ndi(ndi));
    if (factories.display) sets.push(factories.display(dm));
    if (factories.game) sets.push(factories.game({ dm: dm, ndi: ndi }));
    sets.forEach(set => {
      mergeInto(override.reporter, set.reporter);
      mergeInto(override.boolean, set.boolean);
      mergeInto(override.sideEffect, set.sideEffect);
    });
    return {
      reporter(opcode, args, ctx) {
        return (opcode in override.reporter) ? override.reporter[opcode](args, ctx) : base.reporter(opcode, args, ctx);
      },
      boolean(opcode, args, ctx) {
        return (opcode in override.boolean) ? !!override.boolean[opcode](args, ctx) : base.boolean(opcode, args, ctx);
      },
      sideEffect(opcode, args, ctx) {
        return (opcode in override.sideEffect) ? override.sideEffect[opcode](args, ctx) : base.sideEffect(opcode, args, ctx);
      }
    };
  }

  global.scratchBuildProviders = buildProviders;

  function boot() {
    const root = document.getElementById('scratchBuilder');
    if (!root) return;
    const dm = new global.DisplayManager({ autoconnect: true });
    const ndi = new global.NDIManager();
    ndi.startDiscoveryWorker();
    const providers = buildProviders(dm, ndi);
    global.scratchUI = new global.ScratchUI(root, { providers: providers });
    global.scratchUI._dm = dm;
    global.scratchUI._ndi = ndi;
    if (global.templateGallery) global.templateGallery.setBuilder(global.scratchUI);
    else if (global.TemplateGallery) global.templateGallery = new global.TemplateGallery({ builder: global.scratchUI });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  global.ModoBuilderV2 = { buildProviders: buildProviders, boot: boot };
})(typeof window !== 'undefined' ? window : this);
