// control-personalizar.js
// Personalización extrema del panel de control (SILLYQUIZ).
// Acento, color secundario, tipografía, densidad, tinte de fondo,
// CSS libre, perfiles nombrados y export/import. Se aplica en vivo
// y persiste en localStorage.
(function () {
  "use strict";

  const KEY = "lq-personalizacion";
  const PROFILES_KEY = "lq-personalizacion-perfiles";
  const DEFAULTS = {
    accent: "#2b50ff",
    accent2: "#ffd400",
    font: "'Space Mono','Courier New',monospace",
    density: "comfortable",
    bgTint: 0,
    tintColor: "#2b50ff",
    css: "",
  };

  const ACCENT_PRESETS = ["#2b50ff","#ff3b3b","#2ec26a","#ff4dd2","#ffd400","#00c2ff","#ff7a00","#f2f2f2"];
  const ACCENT2_PRESETS = ["#ffd400","#2b50ff","#ff4dd2","#2ec26a","#00c2ff","#ff3b3b","#f2f2f2"];

  let cfg = Object.assign({}, DEFAULTS);

  function hexToRgb(hex) {
    hex = (hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = v => Math.max(0, Math.min(255, Math.round(v + amt)));
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }

  function apply() {
    const root = document.documentElement;
    root.style.setProperty("--accent", cfg.accent);
    root.style.setProperty("--primary", cfg.accent);
    root.style.setProperty("--gold", cfg.accent);
    root.style.setProperty("--accent2", cfg.accent2);
    root.style.setProperty("--gold2", cfg.accent2);
    root.style.setProperty("--primary-strong", shade(cfg.accent, -40));
    root.style.setProperty("--font", cfg.font);
    root.style.setProperty("--font-display", cfg.font);
    document.body.classList.toggle("density-compact", cfg.density === "compact");

    let ov = document.getElementById("persTintOverlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "persTintOverlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:0;pointer-events:none;";
      document.body.prepend(ov);
    }
    const a = (cfg.bgTint / 100) * 0.28;
    const [r, g, b] = hexToRgb(cfg.tintColor);
    ov.style.background = "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";

    let st = document.getElementById("persCustomCss");
    if (!st) {
      st = document.createElement("style");
      st.id = "persCustomCss";
      document.head.appendChild(st);
    }
    st.textContent = cfg.css || "";
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) cfg = Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {}
    apply();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function getProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function setProfiles(p) {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch (e) {}
  }

  function renderSwatches() {
    const a = document.getElementById("persAccentSwatches");
    const a2 = document.getElementById("persAccent2Swatches");
    if (a) {
      a.innerHTML = "";
      ACCENT_PRESETS.forEach(c => {
        const b = document.createElement("button");
        b.className = "pers-swatch";
        b.style.background = c; b.title = c;
        if (c.toLowerCase() === cfg.accent.toLowerCase()) b.classList.add("active");
        b.onclick = () => { cfg.accent = c; document.getElementById("persAccentCustom").value = c; renderSwatches(); apply(); };
        a.appendChild(b);
      });
    }
    if (a2) {
      a2.innerHTML = "";
      ACCENT2_PRESETS.forEach(c => {
        const b = document.createElement("button");
        b.className = "pers-swatch";
        b.style.background = c; b.title = c;
        if (c.toLowerCase() === cfg.accent2.toLowerCase()) b.classList.add("active");
        b.onclick = () => { cfg.accent2 = c; document.getElementById("persAccent2Custom").value = c; renderSwatches(); apply(); };
        a2.appendChild(b);
      });
    }
  }

  function renderProfiles() {
    const sel = document.getElementById("persPerfilSelect");
    if (!sel) return;
    const p = getProfiles();
    sel.innerHTML = '<option value="">— perfiles guardados —</option>' +
      Object.keys(p).map(n => '<option value="' + n.replace(/"/g, "&quot;") + '">' + n + "</option>").join("");
  }

  function syncInputs() {
    const ac = document.getElementById("persAccentCustom");
    const ac2 = document.getElementById("persAccent2Custom");
    const fnt = document.getElementById("persFont");
    const tint = document.getElementById("persBgTint");
    const css = document.getElementById("persCss");
    if (ac) ac.value = cfg.accent;
    if (ac2) ac2.value = cfg.accent2;
    if (fnt) fnt.value = cfg.font;
    if (tint) tint.value = cfg.bgTint;
    if (css) css.value = cfg.css || "";
    document.querySelectorAll("[data-density]").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-density") === cfg.density);
    });
  }

  function open() {
    const bk = document.getElementById("personalizarBackdrop");
    if (bk) bk.style.display = "flex";
    renderSwatches(); renderProfiles(); syncInputs();
  }
  function close() {
    const bk = document.getElementById("personalizarBackdrop");
    if (bk) bk.style.display = "none";
  }
  function msg(t) { const m = document.getElementById("persMsg"); if (m) m.textContent = t; }

  function wire() {
    const btn = document.getElementById("btnPersonalizar");
    if (btn) btn.addEventListener("click", open);
    const cerrar = document.getElementById("personalizarCerrar");
    if (cerrar) cerrar.addEventListener("click", close);
    const bk = document.getElementById("personalizarBackdrop");
    if (bk) bk.addEventListener("click", e => { if (e.target === bk) close(); });

    const ac = document.getElementById("persAccentCustom");
    if (ac) ac.addEventListener("input", () => { cfg.accent = ac.value; renderSwatches(); apply(); });
    const ac2 = document.getElementById("persAccent2Custom");
    if (ac2) ac2.addEventListener("input", () => { cfg.accent2 = ac2.value; renderSwatches(); apply(); });
    const fnt = document.getElementById("persFont");
    if (fnt) fnt.addEventListener("change", () => { cfg.font = fnt.value; apply(); });
    const tint = document.getElementById("persBgTint");
    if (tint) tint.addEventListener("input", () => { cfg.bgTint = +tint.value; apply(); });
    const css = document.getElementById("persCss");
    if (css) css.addEventListener("input", () => { cfg.css = css.value; apply(); });

    document.querySelectorAll("[data-density]").forEach(b => {
      b.addEventListener("click", () => { cfg.density = b.getAttribute("data-density"); syncInputs(); apply(); });
    });

    const guardar = document.getElementById("persGuardar");
    if (guardar) guardar.addEventListener("click", () => { save(); msg("✔ Configuración guardada (persiste al recargar)."); });
    const restaurar = document.getElementById("persRestaurar");
    if (restaurar) restaurar.addEventListener("click", () => {
      cfg = Object.assign({}, DEFAULTS); save(); renderSwatches(); renderProfiles(); syncInputs(); apply();
      msg("↺ Restaurado a valores por defecto.");
    });

    // Perfiles
    const pg = document.getElementById("persPerfilGuardar");
    if (pg) pg.addEventListener("click", () => {
      const nom = (document.getElementById("persPerfilNombre").value || "").trim();
      if (!nom) { msg("⚠ Escribe un nombre para el perfil."); return; }
      const p = getProfiles(); p[nom] = Object.assign({}, cfg); setProfiles(p);
      renderProfiles(); document.getElementById("persPerfilSelect").value = nom;
      msg("✔ Perfil '" + nom + "' guardado.");
    });
    const pc = document.getElementById("persPerfilCargar");
    if (pc) pc.addEventListener("click", () => {
      const nom = document.getElementById("persPerfilSelect").value;
      if (!nom) return;
      const p = getProfiles();
      if (p[nom]) { cfg = Object.assign({}, DEFAULTS, p[nom]); save(); renderSwatches(); syncInputs(); apply(); msg("✔ Perfil '" + nom + "' cargado."); }
    });
    const pd = document.getElementById("persPerfilEliminar");
    if (pd) pd.addEventListener("click", () => {
      const nom = document.getElementById("persPerfilSelect").value;
      if (!nom) return;
      const p = getProfiles(); delete p[nom]; setProfiles(p); renderProfiles();
      msg("🗑 Perfil '" + nom + "' eliminado.");
    });

    // Export / Import
    const ex = document.getElementById("persExportar");
    if (ex) ex.addEventListener("click", () => {
      const data = { version: 1, active: cfg, profiles: getProfiles() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "sillyquiz-personalizacion.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      msg("⬇ Perfil exportado.");
    });
    const im = document.getElementById("persImportar");
    const fi = document.getElementById("persImportFile");
    if (im && fi) im.addEventListener("click", () => fi.click());
    if (fi) fi.addEventListener("change", () => {
      const file = fi.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          if (d.active) { cfg = Object.assign({}, DEFAULTS, d.active); save(); }
          if (d.profiles) setProfiles(d.profiles);
          renderSwatches(); renderProfiles(); syncInputs(); apply();
          msg("✔ Personalización importada.");
        } catch (e) { msg("✗ JSON inválido."); }
      };
      reader.readAsText(file);
      fi.value = "";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { load(); wire(); });
  } else { load(); wire(); }

  window.abrirPersonalizar = open;
})();
