from flask import Blueprint, jsonify, request
from silly.globals import container
from silly.services.sse import EVENT_QUESTION_CHANGE

quiz_bp = Blueprint("quiz", __name__, url_prefix="/api")


@quiz_bp.route("/pregunta-actual", methods=["POST"])
def set_pregunta_actual():
    data = request.get_json(silent=True) or {}
    pid = data.get("id")
    if not isinstance(pid, int):
        return jsonify({"error": "id debe ser entero"}), 400
    ok = container.state.set_pregunta(pid)
    if ok:
        container.event_bus.notify(EVENT_QUESTION_CHANGE)
        with container.state.lock:
            pregunta = dict(container.state.pregunta_actual) if container.state.pregunta_actual else None
        return jsonify({"ok": True, "pregunta": pregunta})
    return jsonify({"error": "No encontrada"}), 404


@quiz_bp.route("/mostrar-respuesta", methods=["POST"])
def set_mostrar_respuesta():
    data = request.get_json(silent=True) or {}
    mostrar = data.get("mostrar", False)
    with container.state.lock:
        container.state.mostrar_respuesta = bool(mostrar)
        container.state.mostrar_opciones = bool(mostrar)
        if mostrar:
            container.state.timer_activo = False
    if mostrar:
        container.cronometro.parar()
    container.event_bus.notify(EVENT_QUESTION_CHANGE)
    return jsonify({"ok": True})


@quiz_bp.route("/pregunta-actual/mostrar-opciones", methods=["POST"])
def mostrar_opciones():
    with container.state.lock:
        container.state.mostrar_opciones = True
        container.state.opcion_seleccionada = None
        default_timer = container.config.get("game", {}).get("default_timer", 45)
        container.state.timer_segundos = 15
        container.state.timer_totales = 15
        container.state.timer_activo = True
    container.cronometro.parar()
    container.cronometro.arrancar(15)
    container.event_bus.notify(EVENT_QUESTION_CHANGE)
    return jsonify({"ok": True})


@quiz_bp.route("/pregunta-actual/clear", methods=["POST"])
def clear_pregunta_actual():
    with container.state.lock:
        container.state.pregunta_actual = None
        container.state.mostrar_respuesta = False
        container.state.mostrar_opciones = False
    container.event_bus.notify(EVENT_QUESTION_CHANGE)
    return jsonify({"ok": True})


@quiz_bp.route("/pregunta-actual/seleccionar-opcion", methods=["POST"])
def seleccionar_opcion():
    data = request.get_json(silent=True) or {}
    indice = data.get("indice")
    if not isinstance(indice, int) or indice not in (0, 1, 2):
        return jsonify({"error": "indice debe ser 0, 1 o 2"}), 400
    with container.state.lock:
        container.state.opcion_seleccionada = indice
    container.event_bus.notify(EVENT_QUESTION_CHANGE)
    return jsonify({"ok": True})


@quiz_bp.route("/pregunta/proxima", methods=["GET"])
def peek_next_question():
    with container.state.lock:
        preguntas = list(container.state.preguntas)
        actual = container.state.pregunta_actual
        actual_id = actual.get("id") if actual else None
    if not preguntas:
        return jsonify({"ok": False, "error": "Sin preguntas"}), 404
    if actual_id is None:
        prox = preguntas[0]
    else:
        idx = next((i for i, p in enumerate(preguntas) if p.get("id") == actual_id), -1)
        prox = preguntas[(idx + 1) % len(preguntas)] if idx >= 0 else preguntas[0]
    return jsonify({"ok": True, "pregunta": dict(prox)})


@quiz_bp.route("/pregunta/proxima/proyectar", methods=["POST"])
def project_next_question():
    data = request.get_json(silent=True) or {}
    with container.state.lock:
        preguntas = list(container.state.preguntas)
        actual = container.state.pregunta_actual
        actual_id = actual.get("id") if actual else None
    if not preguntas:
        return jsonify({"error": "Sin preguntas"}), 404
    if actual_id is None:
        prox = preguntas[0]
    else:
        idx = next((i for i, p in enumerate(preguntas) if p.get("id") == actual_id), -1)
        prox = preguntas[(idx + 1) % len(preguntas)] if idx >= 0 else preguntas[0]
    pid = prox.get("id")
    ok = container.state.set_pregunta(pid)
    if ok:
        container.event_bus.notify(EVENT_QUESTION_CHANGE)
        return jsonify({"ok": True, "pregunta": dict(prox)})
    return jsonify({"error": "No encontrada"}), 404
