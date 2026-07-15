// sillybuild-fallback.js — si buildsilly-v2.js no llegó a instanciar el editor
// (p.ej. falló DisplayManager/NDIManager), lo creamos sin providers para que
// al menos se vea el lienzo de bloques.
window.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    if (window.scratchUI || !window.ScratchUI) return;
    var root = document.getElementById('scratchBuilder');
    if (root && !root.querySelector('.scratch-app')) {
      try {
        window.scratchUI = new window.ScratchUI(root);
        console.warn('[SillyBuild] editor iniciado en modo fallback (sin providers).');
      } catch (e) {
        console.error('[SillyBuild] no se pudo iniciar el editor:', e);
      }
    }
  }, 400);
});
