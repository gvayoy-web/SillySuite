import json
import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, Response
from silly.globals import container
from silly.services.persistence import _persist_and_notify

log = logging.getLogger(__name__)

log = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.route("/preguntas", methods=["GET"])
def get_preguntas():
    categoria = request.args.get("categoria")
    with container.state.lock:
        lista = list(container.state.preguntas)
    if categoria:
        lista = [p for p in lista if p.get("categoria") == categoria.strip()]
    cats = [v["name"] for v in container.config.get("question_categories", {}).values() if v.get("enabled", True)]
    return jsonify({"preguntas": lista, "categorias_disponibles": cats})


@api_bp.route("/preguntas", methods=["POST"])
def crear_pregunta():
    data = request.get_json(silent=True) or {}
    texto = data.get("texto", "").strip()
    respuesta = data.get("respuesta", "").strip()
    if not texto or not respuesta:
        return jsonify({"error": "texto y respuesta requeridos"}), 400
    nueva = {"texto": texto, "respuesta": respuesta}
    cat = data.get("categoria")
    if isinstance(cat, str) and cat.strip():
        nueva["categoria"] = cat.strip()
    ref = data.get("referencia")
    if isinstance(ref, str) and ref.strip():
        nueva["referencia"] = ref.strip()
    opciones = data.get("opciones")
    if isinstance(opciones, list) and len(opciones) == 3:
        rc = data.get("respuesta_correcta")
        if isinstance(rc, int) and rc in (0, 1, 2):
            nueva["opciones"] = [o.strip() for o in opciones]
            nueva["respuesta_correcta"] = rc
    container.state.agregar_pregunta(nueva)
    _persist_and_notify()
    return jsonify(nueva), 201


@api_bp.route("/preguntas/<int:pid>", methods=["PUT"])
def editar_pregunta(pid):
    data = request.get_json(silent=True) or {}
    texto = data.get("texto", "").strip()
    respuesta = data.get("respuesta", "").strip()
    if not texto or not respuesta:
        return jsonify({"error": "texto y respuesta requeridos"}), 400
    extra = {}
    if "opciones" in data:
        op = data["opciones"]
        if op is None:
            extra["opciones"] = None
            extra["respuesta_correcta"] = None
        elif isinstance(op, list) and len(op) == 3:
            rc = data.get("respuesta_correcta")
            if isinstance(rc, int) and rc in (0, 1, 2):
                extra["opciones"] = [o.strip() for o in op]
                extra["respuesta_correcta"] = rc
    if "categoria" in data:
        cat = data.get("categoria")
        extra["categoria"] = cat.strip() if isinstance(cat, str) and cat.strip() else None
    if "referencia" in data:
        ref = data.get("referencia")
        extra["referencia"] = ref.strip() if isinstance(ref, str) and ref.strip() else None
    if container.state.editar_pregunta(pid, texto, respuesta, extra):
        _persist_and_notify()
        return jsonify({"ok": True})
    return jsonify({"error": "No encontrada"}), 404


@api_bp.route("/preguntas/<int:pid>", methods=["DELETE"])
def eliminar_pregunta(pid):
    if container.state.eliminar_pregunta(pid):
        _persist_and_notify()
        return jsonify({"ok": True})
    return jsonify({"error": "No encontrada"}), 404


@api_bp.route("/preguntas/exportar", methods=["GET"])
def exportar_preguntas():
    with container.state.lock:
        data = {"preguntas": list(container.state.preguntas)}
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(json.dumps(data, ensure_ascii=False, indent=2),
                    mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="preguntas_{ts}.json"'})


@api_bp.route("/preguntas/importar", methods=["POST"])
def importar_preguntas():
    data = request.get_json(silent=True) or {}
    preguntas_list = data.get("preguntas", [])
    modo = data.get("modo", "reemplazar")
    nuevas = []
    for p in preguntas_list:
        if not isinstance(p, dict):
            continue
        texto = str(p.get("texto", "")).strip()
        respuesta = str(p.get("respuesta", "")).strip()
        if texto and respuesta:
            q = {"texto": texto, "respuesta": respuesta}
            cat = p.get("categoria")
            if isinstance(cat, str) and cat.strip():
                q["categoria"] = cat.strip()
            ref = p.get("referencia")
            if isinstance(ref, str) and ref.strip():
                q["referencia"] = ref.strip()
            if isinstance(p.get("opciones"), list) and len(p["opciones"]) == 3:
                rc = p.get("respuesta_correcta")
                if isinstance(rc, int) and rc in (0, 1, 2):
                    q["opciones"] = [str(o).strip() for o in p["opciones"]]
                    q["respuesta_correcta"] = rc
            nuevas.append(q)
    if not nuevas:
        return jsonify({"error": "Sin preguntas válidas"}), 400
    with container.state.lock:
        if modo == "reemplazar":
            container.state.preguntas = []
            container.state._preguntas_por_id.clear()
        base_id = max(container.state._preguntas_por_id.keys(), default=0) + 1
        for i, q in enumerate(nuevas):
            q["id"] = base_id + i
            container.state.preguntas.append(q)
            container.state._preguntas_por_id[q["id"]] = q
    _persist_and_notify()
    return jsonify({"ok": True, "importadas": len(nuevas)})


@api_bp.route("/puntos", methods=["POST"])
def sumar_puntos():
    data = request.get_json(silent=True) or {}
    grupo = data.get("grupo")
    cantidad = data.get("cantidad", 10)
    with container.state.lock:
        validos = {g["key"] for g in container.state.display_config.get("grupos_config", [])}
    if not isinstance(grupo, str) or grupo not in validos:
        return jsonify({"error": "Grupo inválido"}), 400
    if not isinstance(cantidad, int):
        return jsonify({"error": "cantidad debe ser entero"}), 400
    if not container.state.sumar_puntos(grupo, cantidad):
        return jsonify({"error": "Grupo no encontrado"}), 404
    _persist_and_notify()
    with container.state.lock:
        pts = dict(container.state.puntos)
    return jsonify({"ok": True, "puntos": pts})


@api_bp.route("/puntos/restar", methods=["POST"])
def restar_puntos():
    data = request.get_json(silent=True) or {}
    grupo = data.get("grupo")
    cantidad = data.get("cantidad", 10)
    with container.state.lock:
        validos = {g["key"] for g in container.state.display_config.get("grupos_config", [])}
    if not isinstance(grupo, str) or grupo not in validos:
        return jsonify({"error": "Grupo inválido"}), 400
    if not isinstance(cantidad, int) or cantidad < 0:
        return jsonify({"error": "cantidad debe ser entero positivo"}), 400
    container.state.sumar_puntos(grupo, -cantidad)
    _persist_and_notify()
    return jsonify({"ok": True})


@api_bp.route("/puntos/reset", methods=["POST"])
def reset_puntos():
    with container.state.lock:
        validos = {g["key"] for g in container.state.display_config.get("grupos_config", [])}
        for g in validos:
            container.state.puntos[g] = 0
    _persist_and_notify()
    return jsonify({"ok": True})


@api_bp.route("/grupos/<string:grupo_key>/puntos", methods=["PATCH"])
def patch_puntos(grupo_key):
    data = request.get_json(silent=True) or {}
    cantidad = data.get("cantidad", 0)
    if not isinstance(cantidad, int):
        return jsonify({"error": "cantidad debe ser entero"}), 400
    if not container.state.ajustar_puntos(grupo_key, cantidad):
        return jsonify({"error": "Grupo no encontrado"}), 404
    _persist_and_notify()
    return jsonify({"ok": True, "puntos": cantidad})


@api_bp.route("/puntos/ajustar", methods=["POST"])
def ajustar_puntos():
    data = request.get_json(silent=True) or {}
    grupo = data.get("grupo")
    valor = data.get("valor")
    if not isinstance(grupo, str) or not isinstance(valor, int):
        return jsonify({"error": "grupo (str) y valor (int) requeridos"}), 400
    if container.state.ajustar_puntos(grupo, valor):
        _persist_and_notify()
        return jsonify({"ok": True})
    return jsonify({"error": "Grupo no encontrado"}), 400


@api_bp.route("/grupos/config", methods=["POST"])
def grupos_config():
    data = request.get_json(silent=True) or {}
    grupos = data.get("grupos")
    min_g = container.config.get("game", {}).get("min_groups", 2)
    max_g = container.config.get("game", {}).get("max_groups", 8)
    if not isinstance(grupos, list) or len(grupos) < min_g or len(grupos) > max_g:
        return jsonify({"error": f"Se requieren {min_g}-{max_g} grupos"}), 400
    ids = set()
    for g in grupos:
        if "key" not in g or "nombre" not in g:
            return jsonify({"error": "Cada grupo necesita key y nombre"}), 400
        if g["key"] in ids:
            return jsonify({"error": f"Grupo duplicado: {g['key']}"}), 400
        ids.add(g["key"])
        g.setdefault("color", "#888888")
        g.setdefault("color2", "#AAAAAA")
    with container.state.lock:
        container.state.display_config["grupos_config"] = grupos
        for g in grupos:
            if g["key"] not in container.state.puntos:
                container.state.puntos[g["key"]] = 0
        active_keys = {g["key"] for g in grupos}
        for k in list(container.state.puntos.keys()):
            if k not in active_keys:
                del container.state.puntos[k]
    _persist_and_notify()
    return jsonify({"ok": True, "grupos_config": grupos})


@api_bp.route("/actividad", methods=["GET"])
def get_actividad():
    return jsonify({"actividad": container.state.get_actividad()})


@api_bp.route("/estado-actual", methods=["GET"])
def estado_actual():
    return jsonify(container.event_bus.full_snapshot())


@api_bp.route("/salir", methods=["POST"])
def salir():
    container.cronometro.parar()
    container.mode_manager.stop_active()
    with container.state.lock:
        container.state.pregunta_actual = None
        container.state.mostrar_respuesta = False
        container.state.mostrar_opciones = False
        container.state.opcion_seleccionada = None
        container.state.timer_activo = False
        container.state.timer_segundos = 0
        container.state.timer_totales = 0
        container.state.anim_texto = None
        container.state.anim_data = {"tipo": None, "grupo": None, "cantidad": 0}
        container.state.modo = "preguntas"
        container.state.display_config["frozen"] = False
        container.state.display_config["black_screen"] = False
        container.state.display_config["clean"] = True
        container.state.display_config["final_round"] = False
        container.state.display_config["final_results"] = False
        container.state.display_config["overlay_reset"] += 1
    _persist_and_notify()
    return jsonify({"ok": True, "msg": "Todo detenido — esperando pregunta"})


@api_bp.route("/shutdown", methods=["POST"])
def shutdown():
    shutdown_func = request.environ.get("werkzeug.server.shutdown")
    if shutdown_func:
        shutdown_func()
    return jsonify({"ok": True})
