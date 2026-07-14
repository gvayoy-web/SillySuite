from flask import Blueprint, jsonify, request, send_from_directory
from silly.globals import container
from silly.services.sse import EVENT_DISPLAY_UPDATE
from copy import deepcopy
import os

display_bp = Blueprint("display", __name__)


def _get_frontend_path(filename):
    frontend_dir = container.BASE_DIR
    return os.path.join(frontend_dir, "frontend", filename)


@display_bp.route("/", methods=["GET"])
def index():
    """Pantalla principal del display - Displaysilly"""
    display_html_path = _get_frontend_path("displaysilly.html")
    try:
        with open(display_html_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"Error al cargar displaysilly.html: {e}")
        return f"Error al cargar la página de display. Ruta intentada: {display_html_path}", 500


@display_bp.route("/theme", methods=["POST"])
def set_display_theme():
    data = request.get_json(silent=True) or {}
    theme = data.get("theme", "default")
    valid = {"default", "light", "dark", "fire", "ocean", "brutalist"}
    if theme not in valid:
        return jsonify({"error": f"Tema inválido. Válidos: {', '.join(valid)}"}), 400
    with container.state.lock:
        container.state.display_config["theme"] = theme
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "theme": theme})



@display_bp.route("/kiosko", methods=["POST"])
def toggle_kiosko():
    data = request.get_json(silent=True) or {}
    active = data.get("active")
    with container.state.lock:
        if active is not None:
            container.state.display_config["kiosko"] = bool(active)
        else:
            container.state.display_config["kiosko"] = not container.state.display_config.get("kiosko", False)
        k = container.state.display_config["kiosko"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "kiosko": k})



@display_bp.route("/animations", methods=["POST"])
def toggle_animations():
    data = request.get_json(silent=True) or {}
    disabled = data.get("disabled")
    with container.state.lock:
        if disabled is not None:
            container.state.display_config["animations_disabled"] = bool(disabled)
        else:
            container.state.display_config["animations_disabled"] = not container.state.display_config.get("animations_disabled", False)
        d = container.state.display_config["animations_disabled"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "disabled": d})



@display_bp.route("/reset-overlays", methods=["POST"])
def reset_overlays():
    with container.state.lock:
        container.state.display_config["overlay_reset"] += 1
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True})



@display_bp.route("/black-screen", methods=["POST"])
def toggle_black_screen():
    data = request.get_json(silent=True) or {}
    active = data.get("active")
    with container.state.lock:
        if active is not None:
            container.state.display_config["black_screen"] = bool(active)
        else:
            container.state.display_config["black_screen"] = not container.state.display_config.get("black_screen", False)
        bs = container.state.display_config["black_screen"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "black_screen": bs})



@display_bp.route("/freeze", methods=["POST"])
def toggle_freeze():
    data = request.get_json(silent=True) or {}
    active = data.get("active")
    with container.state.lock:
        if active is not None:
            container.state.display_config["frozen"] = bool(active)
        else:
            container.state.display_config["frozen"] = not container.state.display_config.get("frozen", False)
        fz = container.state.display_config["frozen"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "frozen": fz})



@display_bp.route("/clean", methods=["POST"])
def display_clean():
    with container.state.lock:
        container.state.display_config["clean"] = not container.state.display_config.get("clean", False)
        c = container.state.display_config["clean"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "clean": c})



@display_bp.route("/bg-style", methods=["POST"])
def set_bg_style():
    data = request.get_json(silent=True) or {}
    style = data.get("style", "default")
    valid = {"default", "gradient", "particles", "none"}
    if style not in valid:
        return jsonify({"error": f"Estilo inválido. Válidos: {', '.join(valid)}"}), 400
    with container.state.lock:
        container.state.display_config["bg_style"] = style
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "bg_style": style})



@display_bp.route("/decorations", methods=["POST"])
def toggle_decorations():
    with container.state.lock:
        container.state.display_config["decorations"] = not container.state.display_config.get("decorations", True)
        d = container.state.display_config["decorations"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "decorations": d})



@display_bp.route("/particles", methods=["POST"])
def toggle_particles():
    with container.state.lock:
        container.state.display_config["particles"] = not container.state.display_config.get("particles", False)
        p = container.state.display_config["particles"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "particles": p})



@display_bp.route("/final-round", methods=["POST"])
def toggle_final_round():
    with container.state.lock:
        container.state.display_config["final_round"] = not container.state.display_config.get("final_round", False)
        fr = container.state.display_config["final_round"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "final_round": fr})



@display_bp.route("/eliminar", methods=["POST"])
def toggle_eliminar():
    data = request.get_json(silent=True) or {}
    grupo = data.get("grupo")
    with container.state.lock:
        validos = {g["key"] for g in container.state.display_config.get("grupos_config", [])}
    if not isinstance(grupo, str) or grupo not in validos:
        return jsonify({"error": "Grupo inválido"}), 400
    with container.state.lock:
        elim = container.state.display_config.setdefault("eliminados", [])
        if grupo in elim:
            elim.remove(grupo)
        else:
            elim.append(grupo)
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "eliminados": container.state.display_config.get("eliminados", [])})



@display_bp.route("/final-results", methods=["POST"])
def show_final_results():
    with container.state.lock:
        container.state.display_config["final_results"] = True
        container.state.display_config["overlay_reset"] += 1
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True})



@display_bp.route("/final-results/hide", methods=["POST"])
def hide_final_results():
    with container.state.lock:
        container.state.display_config["final_results"] = False
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True})



@display_bp.route("/screen-shake", methods=["POST"])
def toggle_screen_shake():
    with container.state.lock:
        container.state.display_config["screen_shake"] = not container.state.display_config.get("screen_shake", False)
        v = container.state.display_config["screen_shake"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "screen_shake": v})



@display_bp.route("/confetti", methods=["POST"])
def toggle_confetti():
    with container.state.lock:
        container.state.display_config["confetti"] = not container.state.display_config.get("confetti", False)
        v = container.state.display_config["confetti"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "confetti": v})



@display_bp.route("/sound", methods=["POST"])
def toggle_sound():
    with container.state.lock:
        container.state.display_config["sound"] = not container.state.display_config.get("sound", True)
        v = container.state.display_config["sound"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "sound": v})



@display_bp.route("/scanline", methods=["POST"])
def toggle_scanline():
    with container.state.lock:
        container.state.display_config["scanline"] = not container.state.display_config.get("scanline", False)
        v = container.state.display_config["scanline"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "scanline": v})



@display_bp.route("/glow-fx", methods=["POST"])
def toggle_glow_fx():
    with container.state.lock:
        container.state.display_config["glow_fx"] = not container.state.display_config.get("glow_fx", False)
        v = container.state.display_config["glow_fx"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "glow_fx": v})



@display_bp.route("/ultra-glow", methods=["POST"])
def toggle_ultra_glow():
    with container.state.lock:
        container.state.display_config["ultra_glow"] = not container.state.display_config.get("ultra_glow", False)
        v = container.state.display_config["ultra_glow"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "ultra_glow": v})



@display_bp.route("/micro-particles", methods=["POST"])
def toggle_micro_particles():
    with container.state.lock:
        container.state.display_config["micro_particles"] = not container.state.display_config.get("micro_particles", False)
        v = container.state.display_config["micro_particles"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "micro_particles": v})



@display_bp.route("/glass-morphism", methods=["POST"])
def toggle_glass_morphism():
    with container.state.lock:
        container.state.display_config["glass_morphism"] = not container.state.display_config.get("glass_morphism", False)
        v = container.state.display_config["glass_morphism"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "glass_morphism": v})



@display_bp.route("/dynamic-bg", methods=["POST"])
def toggle_dynamic_bg():
    with container.state.lock:
        container.state.display_config["dynamic_bg"] = not container.state.display_config.get("dynamic_bg", False)
        v = container.state.display_config["dynamic_bg"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "dynamic_bg": v})



@display_bp.route("/fractal-animations", methods=["POST"])
def toggle_fractal_animations():
    with container.state.lock:
        container.state.display_config["fractal_animations"] = not container.state.display_config.get("fractal_animations", False)
        v = container.state.display_config["fractal_animations"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "fractal_animations": v})



@display_bp.route("/vignette", methods=["POST"])
def toggle_vignette():
    with container.state.lock:
        container.state.display_config["vignette"] = not container.state.display_config.get("vignette", False)
        v = container.state.display_config["vignette"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "vignette": v})



@display_bp.route("/glow-pulse", methods=["POST"])
def toggle_glow_pulse():
    with container.state.lock:
        container.state.display_config["glow_pulse"] = not container.state.display_config.get("glow_pulse", False)
        v = container.state.display_config["glow_pulse"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "glow_pulse": v})



@display_bp.route("/score-breathe", methods=["POST"])
def toggle_score_breathe():
    with container.state.lock:
        container.state.display_config["score_breathe"] = not container.state.display_config.get("score_breathe", False)
        v = container.state.display_config["score_breathe"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "score_breathe": v})



@display_bp.route("/bg-breath", methods=["POST"])
def toggle_bg_breath():
    with container.state.lock:
        container.state.display_config["bg_breath"] = not container.state.display_config.get("bg_breath", False)
        v = container.state.display_config["bg_breath"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "bg_breath": v})



@display_bp.route("/theme-effects", methods=["POST"])
def toggle_theme_effects():
    with container.state.lock:
        container.state.display_config["theme_effects"] = not container.state.display_config.get("theme_effects", True)
        v = container.state.display_config["theme_effects"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "theme_effects": v})



@display_bp.route("/solo-scores", methods=["POST"])
def toggle_solo_scores():
    with container.state.lock:
        container.state.display_config["solo_scores"] = not container.state.display_config.get("solo_scores", False)
        v = container.state.display_config["solo_scores"]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "solo_scores": v})



SCORE_ANIMS = ("none", "flip", "bounce", "glow")
EDGE_BLENDS = ("none", "cinemascope", "vignette", "crt")


@display_bp.route("/score-anim", methods=["POST"])
def set_score_anim():
    data = request.get_json(silent=True) or {}
    anim = data.get("anim", "none")
    if anim not in SCORE_ANIMS:
        return jsonify({"error": f"Anim invalida. Validas: {', '.join(SCORE_ANIMS)}"}), 400
    with container.state.lock:
        container.state.display_config["score_anim"] = anim
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "score_anim": anim})



@display_bp.route("/crown-leader", methods=["POST"])
def toggle_crown_leader():
    with container.state.lock:
        v = container.state.display_config.get("crown_leader", False)
        container.state.display_config["crown_leader"] = not v
        v = not v
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "crown_leader": v})



@display_bp.route("/flash-intensity", methods=["POST"])
def set_flash_intensity():
    data = request.get_json(silent=True) or {}
    intensity = int(data.get("intensity", 1))
    if intensity not in (0, 1, 2, 3):
        return jsonify({"error": "Intensidad debe ser 0-3"}), 400
    with container.state.lock:
        container.state.display_config["flash_intensity"] = intensity
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "flash_intensity": intensity})



@display_bp.route("/show-progress", methods=["POST"])
def toggle_show_progress():
    with container.state.lock:
        v = container.state.display_config.get("show_progress", False)
        container.state.display_config["show_progress"] = not v
        v = not v
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "show_progress": v})



@display_bp.route("/edge-blend", methods=["POST"])
def set_edge_blend():
    data = request.get_json(silent=True) or {}
    preset = data.get("preset", "none")
    if preset not in EDGE_BLENDS:
        return jsonify({"error": f"Preset invalido. Validos: {', '.join(EDGE_BLENDS)}"}), 400
    with container.state.lock:
        container.state.display_config["edge_blend"] = preset
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "edge_blend": preset})



@display_bp.route("/welcome-screen", methods=["POST"])
def toggle_welcome_screen():
    with container.state.lock:
        v = container.state.display_config.get("welcome_screen", False)
        container.state.display_config["welcome_screen"] = not v
        v = not v
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "welcome_screen": v})







@display_bp.route("/show-verse", methods=["POST"])
def toggle_show_verse():
    with container.state.lock:
        v = container.state.display_config.get("show_verse", False)
        container.state.display_config["show_verse"] = not v
        v = not v
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "show_verse": v})



@display_bp.route("/dynamic-bars", methods=["POST"])
def toggle_dynamic_bars():
    with container.state.lock:
        v = container.state.display_config.get("dynamic_bars", False)
        container.state.display_config["dynamic_bars"] = not v
        v = not v
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "dynamic_bars": v})



@display_bp.route("/custom-theme", methods=["POST"])
def set_custom_theme():
    data = request.get_json(silent=True) or {}
    custom_theme = data.get("custom_theme")
    with container.state.lock:
        container.state.display_config["custom_theme"] = custom_theme
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "custom_theme": custom_theme})



@display_bp.route("/preview-theme", methods=["POST"])
def preview_theme():
    data = request.get_json(silent=True) or {}
    theme = data.get("theme")
    if not theme:
        return jsonify({"error": "Se requiere 'theme'"}), 400

    # If it's a slug reference, resolve it
    if isinstance(theme, str):
        resolved = container.theme_engine.get_theme(theme)
        if resolved:
            theme = resolved

    with container.state.lock:
        dc = container.state.display_config
        dc["preview_theme"] = theme
        dc["theme_slug"] = None

        # Extract screens from preview theme if available
        screens = theme.get("screens", {})
        if screens:
            existing_screens = dc.get("screens", {})
            merged = {}
            for screen_id, screen_cfg in screens.items():
                merged_cfg = deepcopy(screen_cfg)
                if existing_screens and screen_id in existing_screens:
                    existing = existing_screens[screen_id]
                    if existing.get("layout"):
                        merged_cfg["layout"] = deepcopy(existing["layout"])
                    if existing.get("mapping"):
                        merged_cfg["mapping"] = deepcopy(existing["mapping"])
                merged[screen_id] = merged_cfg
            # Preserve extra user screens
            if existing_screens:
                for sid, scfg in existing_screens.items():
                    if sid not in merged:
                        merged[sid] = deepcopy(scfg)
            dc["screens"] = merged

    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "previewed": theme.get("name", "unknown")})



@display_bp.route("/theme-transition", methods=["POST"])
def set_theme_transition():
    data = request.get_json(silent=True) or {}
    transition = data.get("transition", "fade")
    valid = {"fade", "flash", "wave", "glitch"}
    if transition not in valid:
        return jsonify({"error": f"Transicion invalida. Validas: {', '.join(valid)}"}), 400
    with container.state.lock:
        container.state.display_config["theme_transition"] = transition
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "transition": transition})



@display_bp.route("/ambient", methods=["POST"])
def toggle_ambient():
    data = request.get_json(silent=True) or {}
    effect = data.get("effect", "")
    valid = {"stars", "fog", "lightning", "golden", "confetti", "fireworks"}
    if effect not in valid:
        return jsonify({"error": f"Efecto invalido. Validos: {', '.join(valid)}"}), 400
    class_name = "ambient-" + effect
    with container.state.lock:
        current = container.state.display_config.get("ambient_effects", [])
        if class_name in current:
            current.remove(class_name)
        else:
            current.append(class_name)
        container.state.display_config["ambient_effects"] = current
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "effects": current})



SCREEN_ELEMENTS = ("timer", "question", "scores", "shapes", "overlays")
SCREEN_ROLES = ("main", "secondary", "scoreboard", "timer", "stage")

_CORNER_KEYS = ("tl", "tr", "br", "bl")


def _validate_mapping(m):
    out = {}
    if not isinstance(m, dict):
        return out
    if "corners" in m and isinstance(m["corners"], dict):
        corners = {}
        for ck in _CORNER_KEYS:
            v = m["corners"].get(ck)
            if isinstance(v, (list, tuple)) and len(v) == 2:
                corners[ck] = [float(v[0]), float(v[1])]
        if corners:
            out["corners"] = corners
    for key in ("rotation", "zoom", "offset_x", "offset_y", "perspective", "bezel", "z"):
        if key in m and isinstance(m[key], (int, float)):
            out[key] = float(m[key])
    if "edge_blend" in m and isinstance(m["edge_blend"], dict):
        eb = {}
        for side in ("top", "right", "bottom", "left"):
            if side in m["edge_blend"] and isinstance(m["edge_blend"][side], (int, float)):
                eb[side] = float(m["edge_blend"][side])
        if eb:
            out["edge_blend"] = eb
    if "group" in m and isinstance(m["group"], str):
        out["group"] = m["group"][:40]
    return out


@display_bp.route("/screens", methods=["GET"])
def get_screens():
    with container.state.lock:
        screens = container.state.display_config.get("screens", {})
    return jsonify({"ok": True, "screens": screens})



@display_bp.route("/screens/<screen_id>", methods=["PUT", "POST"])
def set_screen(screen_id):
    data = request.get_json(silent=True) or {}
    with container.state.lock:
        screens = container.state.display_config.setdefault("screens", {})
        cur = screens.get(screen_id, {"elements": {}})
        if "name" in data:
            cur["name"] = data["name"]
        if "role" in data:
            if data["role"] not in SCREEN_ROLES:
                return jsonify({"error": f"Rol inválido. Válidos: {', '.join(SCREEN_ROLES)}"}), 400
            cur["role"] = data["role"]
        if "elements" in data and isinstance(data["elements"], dict):
            cur.setdefault("elements", {})
            for el in SCREEN_ELEMENTS:
                if el in data["elements"]:
                    cur["elements"][el] = bool(data["elements"][el])
        if "layout" in data and isinstance(data["layout"], dict):
            cur.setdefault("layout", {})
            for el in SCREEN_ELEMENTS:
                if el in data["layout"] and isinstance(data["layout"][el], dict):
                    cur["layout"][el] = {
                        k: v for k, v in data["layout"][el].items()
                        if k in ("x", "y", "w", "h") and isinstance(v, (int, float))
                    }
        if "mapping" in data and isinstance(data["mapping"], dict):
            cur["mapping"] = _validate_mapping(data["mapping"])
        if "group" in data and data.get("group"):
            cur["group"] = str(data["group"])[:40]
        elif "group" in data and data.get("group") in (None, ""):
            cur["group"] = None
        screens[screen_id] = cur
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "screen": {screen_id: cur}})



@display_bp.route("/screens/<screen_id>/element", methods=["POST"])
def toggle_screen_element(screen_id):
    data = request.get_json(silent=True) or {}
    element = data.get("element")
    if element not in SCREEN_ELEMENTS:
        return jsonify({"error": f"Elemento inválido. Válidos: {', '.join(SCREEN_ELEMENTS)}"}), 400
    active = data.get("active")
    with container.state.lock:
        screens = container.state.display_config.setdefault("screens", {})
        cur = screens.get(screen_id, {"elements": {}})
        cur.setdefault("elements", {})
        if active is not None:
            cur["elements"][element] = bool(active)
        else:
            cur["elements"][element] = not cur["elements"].get(element, True)
        screens[screen_id] = cur
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "screen": {screen_id: cur}})



@display_bp.route("/screens/<screen_id>", methods=["DELETE"])
def delete_screen(screen_id):
    with container.state.lock:
        screens = container.state.display_config.get("screens", {})
        if screen_id in screens:
            del screens[screen_id]
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "screens": screens})