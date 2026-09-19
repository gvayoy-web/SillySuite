from flask import Blueprint, jsonify, request
from silly.globals import container
from silly.services.sse import EVENT_TIMER_START, EVENT_TIMER_STOP

timer_bp = Blueprint("timer", __name__, url_prefix="/api")


@timer_bp.route("/temporizador/iniciar", methods=["POST"])
def iniciar_temporizador():
    data = request.get_json(silent=True) or {}
    try:
        seg = int(data.get("segundos", container.config.get("game", {}).get("default_timer", 45)))
    except (TypeError, ValueError):
        return jsonify({"error": "segundos debe ser entero"}), 400
    if seg < 1 or seg > 3600:
        return jsonify({"error": "segundos debe estar entre 1 y 3600"}), 400
    with container.state.lock:
        container.state.timer_segundos = seg
        container.state.timer_totales = seg
        container.state.timer_activo = True
    container.cronometro.arrancar(seg)
    container.event_bus.notify(EVENT_TIMER_START)
    return jsonify({"ok": True})


@timer_bp.route("/temporizador/reiniciar", methods=["POST"])
def reiniciar_temporizador():
    with container.state.lock:
        container.state.timer_segundos = container.state.timer_totales
        container.state.timer_activo = True
    container.cronometro.reiniciar()
    container.event_bus.notify(EVENT_TIMER_START)
    return jsonify({"ok": True})


@timer_bp.route("/temporizador/parar", methods=["POST"])
def parar_temporizador():
    with container.state.lock:
        container.state.timer_activo = False
        container.state.timer_segundos = 0
    container.cronometro.parar()
    container.event_bus.notify(EVENT_TIMER_STOP)
    return jsonify({"ok": True})
