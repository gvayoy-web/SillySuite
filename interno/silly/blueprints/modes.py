from flask import Blueprint, jsonify, request
from silly.globals import container
from silly.services.persistence import _persist_and_notify
from silly.services.sse import EVENT_MODO_START, EVENT_MODO_STOP, EVENT_DISPLAY_UPDATE, EVENT_STATE_PERSIST

modes_bp = Blueprint("modes", __name__, url_prefix="/api")





@modes_bp.route("/reset-todo", methods=["POST"])
def reset_todo():
    container.cronometro.parar()
    container.mode_manager.stop_active()
    container.state.reset()
    _persist_and_notify()
    return jsonify({"ok": True})


@modes_bp.route("/modo/<mode_name>/<action>", methods=["POST"])
def modo_action(mode_name, action):
    data = request.get_json(silent=True) or {}
    slot = request.args.get("slot", "primary")
    if slot not in ("primary", "secondary"):
        return jsonify({"error": "slot inválido"}), 400
    mode = container.mode_manager.get_mode(mode_name)
    if not mode:
        return jsonify({"error": f"Modo '{mode_name}' no encontrado"}), 404
    if action == "iniciar":
        ok, err = container.mode_manager.start_mode(mode_name, slot=slot, **data)
        if not ok:
            return jsonify({"error": err}), 400
        _persist_and_notify()
        return jsonify({"ok": True, "slot": slot, **mode.get_state()})
    elif action == "cerrar":
        if slot == "secondary":
            container.mode_manager.stop_active(slot="secondary")
        elif container.mode_manager.get_active_name() == mode_name:
            container.mode_manager.stop_active()
        else:
            mode.stop()
        _persist_and_notify()
        return jsonify({"ok": True})
    else:
        result = mode.handle_action(action, data)
        _persist_and_notify()
        return jsonify(result)


# --- Legacy route proxies ---

@modes_bp.route("/ruleta/iniciar", methods=["POST"])
def api_ruleta_iniciar():
    return modo_action("ruleta", "iniciar")


@modes_bp.route("/ruleta/seleccionar", methods=["POST"])
def api_ruleta_seleccionar():
    return modo_action("ruleta", "seleccionar")


@modes_bp.route("/ruleta/cerrar", methods=["POST"])
def api_ruleta_cerrar():
    return modo_action("ruleta", "cerrar")


@modes_bp.route("/ruleta/girar", methods=["POST"])
def api_ruleta_girar():
    return modo_action("ruleta", "girar")

@modes_bp.route("/ruleta/seleccionar-categoria", methods=["POST"])
def api_ruleta_seleccionar_categoria():
    data = request.get_json(silent=True) or {}
    forzar = data.get("forzar")
    mode = container.mode_manager.get_mode("ruleta")
    if not mode:
        return jsonify({"error": "Modo ruleta no encontrado"}), 404
    result = mode.handle_action("seleccionar_categoria", {"forzar": forzar})
    _persist_and_notify()
    return jsonify(result)


@modes_bp.route("/hangman/<action>", methods=["POST"])
def api_hangman(action):
    return modo_action("hangman", action)


@modes_bp.route("/verses/pausar", methods=["POST"])
def api_versos_pausar():
    return modo_action("verses", "pausar")

@modes_bp.route("/verses/reanudar", methods=["POST"])
def api_versos_reanudar():
    return modo_action("verses", "reanudar")

@modes_bp.route("/verses/<action>", methods=["POST"])
def api_versos_action(action):
    return modo_action("verses", action)





@modes_bp.route("/config/modes/save", methods=["POST"])
def config_modes_save():
    import json
    import os
    from silly.config_loader import CONFIG_FILE
    data = request.get_json(silent=True) or {}
    mode_name = data.get("mode")
    mode_config = data.get("config")
    if not mode_name or not isinstance(mode_config, dict):
        return jsonify({"error": "mode (str) y config (dict) requeridos"}), 400
    config_path = CONFIG_FILE
    if not os.path.exists(config_path):
        config_path = os.path.join(os.path.dirname(os.path.abspath(os.path.dirname(os.path.dirname(__file__)))), CONFIG_FILE)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
        container.log.warning("No se pudo leer config.json para guardar modo")
    if "modes" not in cfg:
        cfg["modes"] = {}
    cfg["modes"][mode_name] = mode_config
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)
    if mode_name == "roulette":
        if "roulette" not in cfg:
            cfg["roulette"] = {}
        for key in ("subconjunto_size", "timer", "repesca_chance", "categories", "enabled", "icon", "force_result"):
            if key in mode_config:
                cfg["roulette"][key] = mode_config[key]
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=4)
    container.config = cfg
    if hasattr(container.state, 'config'):
        container.state.config = cfg
    container.event_bus.notify(EVENT_STATE_PERSIST)
    return jsonify({"ok": True})


@modes_bp.route("/stream")
def stream():
    import queue
    from flask import Response
    from silly.services.sse import _sse_message, EVENT_SNAPSHOT
    bus = container.event_bus

    def event_gen():
        q = queue.Queue(maxsize=100)
        bus.subscribe(q)
        try:
            yield _sse_message(EVENT_SNAPSHOT, bus.full_snapshot()) + "\n"
            while True:
                try:
                    data = q.get(timeout=5)
                    if data is None:
                        break
                    yield data + "\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            raise
        finally:
            bus.unsubscribe(q)
    return Response(event_gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                             "Access-Control-Allow-Origin": "*"})

