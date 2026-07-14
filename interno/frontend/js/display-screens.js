const SCREEN_ELEMENT_MAP = {
    timer: ["#timerBadge", "#timerEndOverlay"],
    question: [".question-zone", "#optionsContainer"],
    scores: ["#scoresZone"],
    shapes: ["#decorLayer"],
    overlays: [
        "#ruletaOverlay", "#hangmanOverlay",
        "#tiempoOverlay", "#battleOverlay", "#survivalOverlay",
        "#quizshowOverlay", "#finalResultsOverlay", "#winnerOverlay",
        "#fullscreenTakeover", "#anim-overlay", "#flashOverlay",
    ],
};

function _getScreenParam() {
    const p = new URLSearchParams(window.location.search).get("screen");
    return p ? String(p) : "1";
}

function _screenConfig(dc, sid) {
    const screens = (dc && dc.screens) || {};
    return screens[sid] || null;
}

/* ── Homography (4-point projective) solver → CSS matrix3d ── */
function _solveHomography(src, dst) {
    const eqs = [];
    for (let i = 0; i < 4; i++) {
        const [sx, sy] = src[i];
        const [dx, dy] = dst[i];
        eqs.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
        eqs.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
    }
    const h = _solve9(eqs);
    if (!h) return null;
    const [a, b, c, d, e, f, g, hh] = h;
    return [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];
}

function _solve9(m) {
    const A = m.map(r => r.slice(0, 9));
    const bx = m.map(r => r[8]);
    const x = _gauss(A, bx);
    return x;
}

function _gauss(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        }
        if (Math.abs(M[piv][col]) < 1e-9) return null;
        [M[col], M[piv]] = [M[piv], M[col]];
        const dv = M[col][col];
        for (let j = col; j <= n; j++) M[col][j] /= dv;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col];
            if (f === 0) continue;
            for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
        }
    }
    return M.map(r => r[n]);
}

function _applyLayout(layout) {
    for (const key of Object.keys(SCREEN_ELEMENT_MAP)) {
        const cfg = (layout && layout[key]) || {};
        for (const sel of SCREEN_ELEMENT_MAP[key]) {
            const node = document.querySelector(sel);
            if (!node) continue;
            node.style.position = "fixed";
            if (cfg.x != null) node.style.left = cfg.x + "%";
            else node.style.removeProperty("left");
            if (cfg.y != null) node.style.top = cfg.y + "%";
            else node.style.removeProperty("top");
            if (cfg.w != null) node.style.width = cfg.w + "%";
            else node.style.removeProperty("width");
            if (cfg.h != null) node.style.height = cfg.h + "%";
            else node.style.removeProperty("height");
        }
    }
}

let _blendRAF = null;
let _blendTime = 0;
let _blendOpacityBase = 0.96;

function _ensureBlendLayer() {
    let layer = document.getElementById("screenBlendLayer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "screenBlendLayer";
        layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9998;";
        document.body.appendChild(layer);
    }
    return layer;
}

function _softFeatherStops(dir) {
    return [
        "rgba(0,0,0,0.98) 0%",
        "rgba(0,0,0,0.93) 6%",
        "rgba(0,0,0,0.82) 15%",
        "rgba(0,0,0,0.64) 28%",
        "rgba(0,0,0,0.42) 45%",
        "rgba(0,0,0,0.24) 60%",
        "rgba(0,0,0,0.11) 76%",
        "rgba(0,0,0,0.04) 90%",
        "transparent 100%"
    ].join(",");
}

function _applyEdgeBlend(eb) {
    const layer = _ensureBlendLayer();
    const existing = _blendRAF;
    if (existing) { cancelAnimationFrame(existing); _blendRAF = null; }
    layer.innerHTML = "";
    if (!eb) { layer.style.display = "none"; return; }
    if (typeof eb === "object" && !eb.enabled && Object.values(eb).every(v => typeof v === "number" || v == null)) {
        eb = { enabled: true, top: eb.top, bottom: eb.bottom, left: eb.left, right: eb.right, blur: 1.5 };
    }
    if (!eb.enabled && eb.enabled !== undefined) {
        layer.style.display = "none"; return;
    }
    layer.style.display = "block";
    _blendOpacityBase = eb.opacity != null ? eb.opacity : 0.96;
    const sides = {
        top:    ["top:0;left:0;right:0;height:VAR", "to bottom", "blend-top"],
        bottom: ["bottom:0;left:0;right:0;height:VAR", "to top", "blend-bottom"],
        left:   ["top:0;bottom:0;left:0;width:VAR", "to right", "blend-left"],
        right:  ["top:0;bottom:0;right:0;width:VAR", "to left", "blend-right"],
    };
    for (const side of Object.keys(sides)) {
        const w = eb[side];
        if (!w || w <= 0) continue;
        const [pos, dir, key] = sides[side];
        const div = document.createElement("div");
        div.className = "blend-edge blend-" + key;
        const blur = eb.blur || 1.5;
        div.style.cssText = "position:fixed;" + pos.replace("VAR", w + "px") +
            ";pointer-events:none;z-index:9998;" +
            `background:linear-gradient(${dir},${_softFeatherStops(dir)});` +
            `opacity:${_blendOpacityBase};filter:blur(${blur}px);` +
            `will-change:opacity;`;
        layer.appendChild(div);
    }
    if (eb.breathing) {
        _blendTime = 0;
        function _breathLoop(t) {
            if (!_blendTime) _blendTime = t;
            const dt = (t - _blendTime) / 1000;
            _blendTime = t;
            const rate = eb.breath_rate || 0.3;
            const amp = eb.breath_amp || 0.08;
            const phase = Math.sin(t * rate * 0.001 * Math.PI * 2);
            const breathOpacity = Math.max(0.3, Math.min(1, _blendOpacityBase + phase * amp));
            const edges = layer.querySelectorAll(".blend-edge");
            for (const el of edges) el.style.opacity = String(breathOpacity);
            _blendRAF = requestAnimationFrame(_breathLoop);
        }
        _blendRAF = requestAnimationFrame(_breathLoop);
    }
}

function _applyMapping(mapping) {
    document.body.style.removeProperty("transform");
    document.body.style.removeProperty("transform-origin");
    document.body.style.removeProperty("clip-path");
    document.body.style.removeProperty("box-shadow");
    document.body.style.removeProperty("padding");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("filter");
    document.body.style.removeProperty("margin");
    document.body.classList.remove("screen-bezel");
    document.body.dataset.group = "";
    _applyEdgeBlend(null);
    if (!mapping || Object.keys(mapping).length === 0) return;

    const W = window.innerWidth, H = window.innerHeight;
    const persp = mapping.perspective != null ? mapping.perspective : 1200;
    const zoom = mapping.zoom != null ? mapping.zoom : 1;
    const rot = mapping.rotation != null ? mapping.rotation : 0;
    const offX = mapping.offset_x != null ? mapping.offset_x : 0;
    const offY = mapping.offset_y != null ? mapping.offset_y : 0;
    const bezel = mapping.bezel != null ? mapping.bezel : 0;

    const def = {
        tl: [0, 0], tr: [W, 0], br: [W, H], bl: [0, H],
    };
    const corners = mapping.corners || {};
    const dst = {
        tl: [def.tl[0] + (corners.tl ? corners.tl[0] * W / 100 : 0), def.tl[1] + (corners.tl ? corners.tl[1] * H / 100 : 0)],
        tr: [def.tr[0] + (corners.tr ? corners.tr[0] * W / 100 : 0), def.tr[1] + (corners.tr ? corners.tr[1] * H / 100 : 0)],
        br: [def.br[0] + (corners.br ? corners.br[0] * W / 100 : 0), def.br[1] + (corners.br ? corners.br[1] * H / 100 : 0)],
        bl: [def.bl[0] + (corners.bl ? corners.bl[0] * W / 100 : 0), def.bl[1] + (corners.bl ? corners.bl[1] * H / 100 : 0)],
    };
    const src = [def.tl, def.tr, def.br, def.bl];
    const dpts = [dst.tl, dst.tr, dst.br, dst.bl];

    if (corners && Object.keys(corners).length === 4) {
        const m = _solveHomography(src, dpts);
        if (m) {
            const flat = m.map(v => Math.abs(v) < 1e-7 ? 0 : +v.toFixed(6));
            document.body.style.transformOrigin = "0 0";
            document.body.style.transform = `perspective(${persp}px) matrix3d(${flat.join(",")})`;
        } else {
            document.body.style.transform = `perspective(${persp}px) rotate(${rot}deg) scale(${zoom}) translate(${offX}%,${offY}%)`;
        }
    } else {
        document.body.style.transformOrigin = "center center";
        document.body.style.transform = `perspective(${persp}px) rotate(${rot}deg) scale(${zoom}) translate(${offX}%,${offY}%)`;
    }

    if (bezel > 0) {
        document.body.classList.add("screen-bezel");
        document.body.style.padding = bezel + "px";
        document.body.style.overflow = "hidden";
        document.body.style.boxSizing = "border-box";
    }
    if (mapping.edge_blend) _applyEdgeBlend(mapping.edge_blend);
    if (mapping.group) document.body.dataset.group = mapping.group;
}

function applyScreenConfig(dc, sid) {
    sid = sid || _getScreenParam();
    const cfg = _screenConfig(dc, sid);
    document.body.setAttribute("data-screen", sid);
    for (const key of Object.keys(SCREEN_ELEMENT_MAP)) {
        document.body.classList.remove("screen-hide-" + key);
        for (const sel of SCREEN_ELEMENT_MAP[key]) {
            const node = document.querySelector(sel);
            if (node) {
                node.style.removeProperty("position");
                node.style.removeProperty("left");
                node.style.removeProperty("top");
                node.style.removeProperty("width");
                node.style.removeProperty("height");
            }
        }
    }
    document.body.style.transform = "";
    document.body.style.clipPath = "none";
    document.body.style.boxShadow = "";
    document.body.style.padding = "";
    document.body.style.overflow = "";
    document.body.dataset.group = "";
    if (!cfg) {
        document.body.classList.remove("screen-restricted");
        return;
    }
    document.body.classList.add("screen-restricted");
    if (cfg.role) document.body.setAttribute("data-screen-role", cfg.role);
    const els = cfg.elements || {};
    for (const key of Object.keys(SCREEN_ELEMENT_MAP)) {
        if (els[key] === false) document.body.classList.add("screen-hide-" + key);
    }
    _applyLayout(cfg.layout);
    _applyMapping(cfg.mapping);
}

function getCurrentScreen() {
    return _getScreenParam();
}

if (typeof window !== "undefined") {
    window.applyScreenConfig = applyScreenConfig;
    window.getCurrentScreen = getCurrentScreen;
    window._solveHomography = _solveHomography;
}

export { applyScreenConfig, getCurrentScreen, SCREEN_ELEMENT_MAP };
