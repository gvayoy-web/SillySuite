from flask import Blueprint, jsonify, request
from silly.globals import container


config_bp = Blueprint("config", __name__, url_prefix="/api")


@config_bp.route("/config", methods=["GET"])
def get_config():
    return jsonify(container.config)


@config_bp.route("/config/modes", methods=["GET"])
def get_modes_config():
    return jsonify(container.config.get("modes", {}))


@config_bp.route("/config/categories", methods=["GET"])
def get_categories():
    return jsonify(container.config.get("question_categories", {}))


@config_bp.route("/config/categories/add", methods=["POST"])
def add_category():
    import json, os, re
    from silly.config_loader import CONFIG_FILE
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "name requerido"}), 400
    key = re.sub(r'\s+', '_', name.lower())
    key = re.sub(r'[^a-z0-9_]', '', key)
    color = data.get("color", "#888888")
    config_path = CONFIG_FILE
    if not os.path.exists(config_path):
        config_path = os.path.join(os.path.dirname(os.path.abspath(os.path.dirname(os.path.dirname(__file__)))), CONFIG_FILE)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
        container.log.warning("No se pudo leer config.json para agregar categoría")
    if "question_categories" not in cfg:
        cfg["question_categories"] = {}
    cfg["question_categories"][key] = {"name": name, "color": color, "enabled": True}
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)
    container.config["question_categories"][key] = {"name": name, "color": color, "enabled": True}
    return jsonify({"ok": True})


@config_bp.route("/config/categories/remove", methods=["POST"])
def remove_category():
    import json
    import os
    from silly.config_loader import CONFIG_FILE
    data = request.get_json(silent=True) or {}
    key = data.get("key", "").strip()
    if not key:
        return jsonify({"error": "key requerido"}), 400
    config_path = CONFIG_FILE
    if not os.path.exists(config_path):
        config_path = os.path.join(os.path.dirname(os.path.abspath(os.path.dirname(os.path.dirname(__file__)))), CONFIG_FILE)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    if "question_categories" in cfg and key in cfg["question_categories"]:
        del cfg["question_categories"][key]
    if "question_categories" in container.config and key in container.config["question_categories"]:
        del container.config["question_categories"][key]
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)
    return jsonify({"ok": True})
