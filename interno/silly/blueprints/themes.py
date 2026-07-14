"""Blueprint — Theme CRUD API + Rotation + Multi-Screen."""

from flask import Blueprint, jsonify, request
from silly.globals import container
from silly.services.sse import EVENT_DISPLAY_UPDATE

themes_bp = Blueprint("themes", __name__, url_prefix="/api/themes")


@themes_bp.route("", methods=["GET"])
def list_themes():
    themes = container.theme_service.list()
    return jsonify({"themes": themes})


@themes_bp.route("/<slug>", methods=["GET"])
def get_theme(slug):
    theme = container.theme_service.get(slug)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    return jsonify(theme)


@themes_bp.route("", methods=["POST"])
def create_theme():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name is required"}), 400
    theme = container.theme_service.create(data)
    return jsonify(theme), 201


@themes_bp.route("/<slug>", methods=["PUT"])
def update_theme(slug):
    data = request.get_json(silent=True) or {}
    theme = container.theme_service.update(slug, data)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    return jsonify(theme)


@themes_bp.route("/<slug>", methods=["DELETE"])
def delete_theme(slug):
    ok = container.theme_service.delete(slug)
    if not ok:
        return jsonify({"error": "Theme not found"}), 404
    return jsonify({"ok": True})


@themes_bp.route("/<slug>/duplicate", methods=["POST"])
def duplicate_theme(slug):
    data = request.get_json(silent=True) or {}
    new_name = data.get("name")
    theme = container.theme_service.duplicate(slug, new_name)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    return jsonify(theme), 201


@themes_bp.route("/<slug>/apply", methods=["POST"])
def apply_theme(slug):
    """Apply theme with full multi-screen support."""
    theme = container.theme_service.get(slug)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404

    colors = theme.get("colors", {})
    effects = theme.get("effects", {})
    typography = theme.get("typography", {})
    shapes = theme.get("shapes", {})
    timer = theme.get("timer", {})
    layout = theme.get("layout", {})
    spawn_rate = shapes.get("spawn_rate", 2500)

    with container.state.lock:
        dc = container.state.display_config
        dc["theme_slug"] = slug
        dc["custom_theme"] = {
            "primary": colors.get("primary", "#0038ff"),
            "secondary": colors.get("secondary", "#ffffff"),
            "accent": colors.get("accent", "#7C3AED"),
            "surface": colors.get("surface", "#ffffff"),
            "text": colors.get("text", "#000000"),
            "border": colors.get("border", "#000000"),
            "glow": colors.get("glow", "rgba(124,58,237,0.3)"),
            "brightness": int(effects.get("intensity", 1.0) * 100),
            "saturation": 100,
            "bg_opacity": 100,
            "border_radius": int(typography.get("size_scale", 1.0) * 12),
            "animation_speed": max(0.5, min(3.0, 2500 / max(1, spawn_rate)))
        }
        dc["theme"] = "default"

        # Apply theme-level layout settings
        if layout:
            current_layout = dc.setdefault("theme_layout", {})
            for k in ("scores_position", "header_style", "question_height", "logo_visible", "decorations_visible", "scores_height"):
                if k in layout:
                    current_layout[k] = layout[k]

        # Apply timer settings
        if timer:
            dc["timer_style"] = timer.get("style", "circle")
            timer_colors = timer.get("colors", {})
            if timer_colors:
                dc["timer_colors"] = {
                    "bg": timer_colors.get("background", "rgba(0,0,0,0.6)"),
                    "text": timer_colors.get("text", "#ffffff"),
                    "progress": timer_colors.get("progress", "#7C3AED"),
                    "urgent": timer_colors.get("urgent", "#ff4444")
                }

        # Apply screens config from theme, preserving user customizations
        existing_screens = dc.get("screens", {})
        merged_screens = container.theme_engine.apply_theme_screens_to_display(slug, existing_screens)
        dc["screens"] = merged_screens

    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "applied": slug})


@themes_bp.route("/<slug>/export", methods=["GET"])
def export_theme(slug):
    theme = container.theme_service.export_json(slug)
    if not theme:
        return jsonify({"error": "Theme not found"}), 404
    return jsonify(theme)


@themes_bp.route("/import", methods=["POST"])
def import_theme():
    data = request.get_json(silent=True) or {}
    theme = container.theme_service.import_json(data)
    if not theme:
        return jsonify({"error": "Invalid theme data"}), 400
    return jsonify(theme), 201


@themes_bp.route("/defaults", methods=["POST"])
def restore_defaults():
    """Create preset themes if they don't exist."""
    presets = [
        {
            "name": "Oscuro",
            "description": "Tema oscuro con acento púrpura",
            "colors": {"primary": "#0a0a0f", "secondary": "#e0e0ff", "accent": "#7C3AED", "surface": "#1a1a2e", "text": "#ffffff", "border": "#2a2a4a", "glow": "rgba(124,58,237,0.3)"},
            "timer": {"style": "circle", "colors": {"progress": "#7C3AED"}},
            "shapes": {"color_source": "theme"}
        },
        {
            "name": "Fuego",
            "description": "Tema ígneo con acento naranja",
            "colors": {"primary": "#1a0500", "secondary": "#ffd700", "accent": "#ff4400", "surface": "#2a1500", "text": "#ffeedd", "border": "#4a2a00", "glow": "rgba(255,68,0,0.4)"},
            "timer": {"style": "bar", "colors": {"progress": "#ff4400"}},
            "shapes": {"color_source": "theme", "behavior": "burst"}
        },
        {
            "name": "Oceano",
            "description": "Tema marino con acento azul",
            "colors": {"primary": "#001a2a", "secondary": "#e0f0ff", "accent": "#00aaff", "surface": "#002540", "text": "#e0f0ff", "border": "#004466", "glow": "rgba(0,170,255,0.4)"},
            "timer": {"style": "digital", "colors": {"progress": "#00aaff"}},
            "shapes": {"color_source": "theme", "behavior": "stream"}
        },
        {
            "name": "Neon",
            "description": "Tema cyberpunk neón",
            "colors": {"primary": "#000000", "secondary": "#00ff00", "accent": "#ff00ff", "surface": "#111111", "text": "#ffffff", "border": "#333333", "glow": "rgba(255,0,255,0.5)"},
            "timer": {"style": "digital", "colors": {"progress": "#ff00ff", "glow": "rgba(255,0,255,0.6)"}},
            "shapes": {"color_source": "theme", "behavior": "pulse", "spawn_rate": 1500}
        },
        {
            "name": "Bosque",
            "description": "Tema natural verde",
            "colors": {"primary": "#064e3b", "secondary": "#d1fae5", "accent": "#34d399", "surface": "#0a3d2a", "text": "#d1fae5", "border": "#2d6a4f", "glow": "rgba(52,211,153,0.4)"},
            "timer": {"style": "circle", "colors": {"progress": "#34d399"}},
            "shapes": {"enabled": ["dove", "heart", "crown", "star", "fish", "bread"]}
        },
    ]
    created = []
    for preset in presets:
        slug = preset["name"].lower().replace(" ", "-")
        if not container.theme_service.get(slug):
            container.theme_service.create(preset)
            created.append(slug)
    return jsonify({"ok": True, "created": created})


# ── ROTATION ENDPOINTS ──

@themes_bp.route("/rotation/state", methods=["GET"])
def get_rotation_state():
    """Get current rotation configuration."""
    state = container.theme_engine.get_rotation_state()
    return jsonify({"ok": True, "rotation": state})


@themes_bp.route("/rotation/configure", methods=["POST"])
def configure_rotation():
    """Configure auto-rotation settings."""
    data = request.get_json(silent=True) or {}
    interval = data.get("interval_seconds", 300)
    seed = data.get("seed")
    enabled = data.get("enabled", True)
    exclude_slugs = data.get("exclude_slugs", [])

    container.theme_engine.configure_rotation(
        interval_seconds=interval,
        seed=seed,
        exclude_slugs=exclude_slugs
    )
    rot_mgr = container.theme_engine.get_rotation_manager()
    rot_mgr._is_rotating = bool(enabled)

    # Persist to config.json
    _save_rotation_persistence({
        "interval_seconds": interval,
        "seed": seed,
        "excluded_themes": exclude_slugs,
        "enabled": enabled
    })

    return jsonify({"ok": True, "configured": {
        "interval_seconds": interval,
        "enabled": enabled,
        "excluded": exclude_slugs
    }})


@themes_bp.route("/rotation/next", methods=["POST"])
def force_next_theme():
    """Force rotate to next theme."""
    data = request.get_json(silent=True) or {}
    current_slug = data.get("current_slug") or container.state.display_config.get("theme_slug", "")

    all_slugs = list(container.theme_engine._all_themes_cache.keys())
    next_slug, is_random = container.theme_engine.get_current_theme(current_slug, all_slugs)

    if not next_slug or next_slug == current_slug:
        return jsonify({"error": "No available themes for rotation"}), 404

    # Apply the next theme using the engine's apply method
    theme = container.theme_engine.get_theme(next_slug)
    if not theme:
        return jsonify({"error": "Next theme not found"}), 404

    # Apply via the existing logic
    colors = theme.get("colors", {})
    effects = theme.get("effects", {})
    typography = theme.get("typography", {})
    shapes = theme.get("shapes", {})
    spawn_rate = shapes.get("spawn_rate", 2500)

    with container.state.lock:
        dc = container.state.display_config
        dc["theme_slug"] = next_slug
        dc["custom_theme"] = {
            "primary": colors.get("primary", "#0038ff"),
            "secondary": colors.get("secondary", "#ffffff"),
            "accent": colors.get("accent", "#7C3AED"),
            "brightness": int(effects.get("intensity", 1.0) * 100),
            "saturation": 100,
            "bg_opacity": 100,
            "border_radius": int(typography.get("size_scale", 1.0) * 12),
            "animation_speed": max(0.5, min(3.0, 2500 / max(1, spawn_rate)))
        }
        dc["theme"] = "default"

        # Merge screens
        existing_screens = dc.get("screens", {})
        merged_screens = container.theme_engine.apply_theme_screens_to_display(next_slug, existing_screens)
        dc["screens"] = merged_screens
        dc["last_rotation"] = __import__("datetime").datetime.now().isoformat()

    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "next_theme": next_slug, "is_random": is_random})


@themes_bp.route("/sorpresa", methods=["POST"])
def random_theme():
    """Apply a random theme (sorpresa)."""
    data = request.get_json(silent=True) or {}
    exclude = data.get("exclude_slugs", [])

    theme = container.theme_engine.get_random_theme(exclude_slugs=exclude)
    if not theme:
        return jsonify({"error": "No themes available"}), 404

    slug = theme["slug"]
    colors = theme.get("colors", {})
    effects = theme.get("effects", {})
    typography = theme.get("typography", {})
    shapes = theme.get("shapes", {})
    spawn_rate = shapes.get("spawn_rate", 2500)

    with container.state.lock:
        dc = container.state.display_config
        dc["theme_slug"] = slug
        dc["custom_theme"] = {
            "primary": colors.get("primary", "#0038ff"),
            "secondary": colors.get("secondary", "#ffffff"),
            "accent": colors.get("accent", "#7C3AED"),
            "brightness": int(effects.get("intensity", 1.0) * 100),
            "saturation": 100,
            "bg_opacity": 100,
            "border_radius": int(typography.get("size_scale", 1.0) * 12),
            "animation_speed": max(0.5, min(3.0, 2500 / max(1, spawn_rate)))
        }
        dc["theme"] = "default"

        existing_screens = dc.get("screens", {})
        merged_screens = container.theme_engine.apply_theme_screens_to_display(slug, existing_screens)
        dc["screens"] = merged_screens

    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "selected": slug, "name": theme.get("name", "")})


# ── SCREENS SETUP ──

@themes_bp.route("/screens/setup", methods=["POST"])
def setup_screens():
    """Configure themes per screen with multi-projector support."""
    data = request.get_json(silent=True) or {}
    screens = data.get("screens", {})

    if not screens:
        return jsonify({"error": "Se requiere 'screens' con configuración por pantalla"}), 400

    multi_mgr = container.theme_engine.get_multi_screen_manager()
    results = []

    for screen_id, config in screens.items():
        theme_slug = config.get("theme")
        blend_mode = config.get("blend_mode", "simple")
        blend_factor = config.get("blend_factor", 0.5)

        if not theme_slug:
            continue

        # Setup the screen in the multi-screen manager
        multi_mgr.setup_screen(
            screen_id=screen_id,
            theme_slug=theme_slug,
            screen_config=config.get("display_config", {})
        )

        # Get theme and apply screen-specific config
        theme = container.theme_engine.get_theme(theme_slug)
        if theme:
            results.append({
                "screen_id": screen_id,
                "theme": theme_slug,
                "blend_mode": blend_mode,
                "name": config.get("name", f"Screen {screen_id}")
            })

    # Apply to display_config
    with container.state.lock:
        dc = container.state.display_config
        dc_screens = dc.setdefault("screens", {})

        for screen_id, config in screens.items():
            cur = dc_screens.get(screen_id, {"elements": {}})
            if "name" in config:
                cur["name"] = config["name"]
            if "role" in config:
                cur["role"] = config["role"]
            if "elements" in config and isinstance(config["elements"], dict):
                cur.setdefault("elements", {})
                for el in ("timer", "question", "scores", "shapes", "overlays"):
                    if el in config["elements"]:
                        cur["elements"][el] = bool(config["elements"][el])
            if "layout" in config:
                cur["layout"] = config["layout"]
            if "mapping" in config:
                cur["mapping"] = config["mapping"]
            dc_screens[screen_id] = cur

    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "screens_configured": results})


@themes_bp.route("/categories", methods=["GET"])
def get_categories():
    """Get all theme categories."""
    categories = container.theme_engine.get_all_categories()
    result = {}
    for cat in categories:
        result[cat] = container.theme_engine.get_themes_by_category(cat)
    return jsonify({"ok": True, "categories": result})


# ── HELPERS ──

def _save_rotation_persistence(data: dict):
    """Save rotation config to config.json."""
    import json, os
    from silly.globals import container

    config_path = os.path.join(container.BASE_DIR, "config.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        else:
            cfg = {}

        cfg["theme_rotation"] = data

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=4)
    except Exception as exc:
        if container.log:
            container.log.warning("No se pudo persistir rotación: %s", exc)
