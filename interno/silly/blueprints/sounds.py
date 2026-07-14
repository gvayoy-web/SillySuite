"""Blueprint — Sound library upload, serving and event mapping."""

import os
from copy import deepcopy
from flask import Blueprint, jsonify, request, send_from_directory
from silly.globals import container
from silly.services.sse import EVENT_DISPLAY_UPDATE
from silly.services.sound_service import get_sound_service, CHANNELS

sounds_bp = Blueprint("sounds", __name__, url_prefix="/api/sounds")


@sounds_bp.route("", methods=["GET"])
def list_sounds():
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    return jsonify({"sounds": svc.list_library()})


@sounds_bp.route("", methods=["POST"])
def upload_sound():
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    if "file" not in request.files:
        return jsonify({"error": "Falta el campo 'file' (multipart)"}), 400
    f = request.files["file"]
    if not f or f.filename == "":
        return jsonify({"error": "Archivo vacío"}), 400
    name = request.form.get("name")
    try:
        meta = svc.add(f, name)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        if container.log:
            container.log.error("Fallo al subir sonido: %s", exc)
        return jsonify({"error": "No se pudo guardar el archivo"}), 500
    return jsonify(meta), 201


@sounds_bp.route("/<sid>", methods=["GET"])
def serve_sound(sid):
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    path = svc.file_path(sid)
    if not path or not os.path.exists(path):
        return jsonify({"error": "Sonido no encontrado"}), 404
    directory = os.path.dirname(path)
    filename = os.path.basename(path)
    resp = send_from_directory(directory, filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@sounds_bp.route("/<sid>", methods=["DELETE"])
def delete_sound(sid):
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    ok = svc.delete(sid)
    if not ok:
        return jsonify({"error": "Sonido no encontrado"}), 404
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True})


@sounds_bp.route("/map", methods=["GET"])
def get_map():
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    return jsonify({"map": svc.get_map(), "channels": CHANNELS})


@sounds_bp.route("/map", methods=["POST"])
def set_map():
    svc = get_sound_service()
    if not svc:
        return jsonify({"error": "Sound service no disponible"}), 503
    data = request.get_json(silent=True) or {}
    new_map = svc.set_map(data)
    with container.state.lock:
        container.state.display_config["sound_map"] = deepcopy(new_map)
    container.event_bus.notify(EVENT_DISPLAY_UPDATE)
    return jsonify({"ok": True, "map": new_map})
