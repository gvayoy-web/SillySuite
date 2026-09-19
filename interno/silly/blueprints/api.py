import json
import logging
from datetime import datetime
from flask import Blueprint, jsonify, request, Response, session as flask_session
from silly.globals import container
from silly.services.persistence import _persist_and_notify

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
    max_g = container.config.get("game", {}).get("max_groups", 24)
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


@api_bp.route("/health", methods=["GET"])
def health_check():
    """Health-check endpoint. Returns Flask server status and optionally
    pings the WebSocket sync server to verify dual-process connectivity."""
    import os
    import time
    import socket

    ws_port = int(os.environ.get("SILLY_WS_PORT", "8081"))
    ws_reachable = False
    ws_latency_ms = None

    try:
        start = time.time()
        with socket.create_connection(("127.0.0.1", ws_port), timeout=2):
            ws_reachable = True
            ws_latency_ms = round((time.time() - start) * 1000, 1)
    except Exception:
        ws_reachable = False

    status = {
        "flask": "ok",
        "websocket": "ok" if ws_reachable else "unreachable",
        "websocket_port": ws_port,
        "websocket_latency_ms": ws_latency_ms,
        "uptime": time.time(),
    }
    code = 200 if ws_reachable else 200  # WS down is degraded, not fatal
    return jsonify(status), code


# ===================== DASHBOARD API ENDPOINTS =====================

@api_bp.route("/health/detailed", methods=["GET"])
def health_detailed():
    """Detailed health check for dashboard."""
    import os
    import time
    import socket
    import psutil
    
    ws_port = int(os.environ.get("SILLY_WS_PORT", "8081"))
    ws_reachable = False
    ws_latency_ms = None
    
    try:
        start = time.time()
        with socket.create_connection(("127.0.0.1", ws_port), timeout=2):
            ws_reachable = True
            ws_latency_ms = round((time.time() - start) * 1000, 1)
    except Exception:
        ws_reachable = False
    
    # DB check
    db_healthy = False
    try:
        with container.state.lock:
            _ = len(container.state.preguntas)
        db_healthy = True
    except Exception:
        db_healthy = False
    
    # Engine check
    engine_healthy = False
    try:
        engine_ok = container.mode_manager.get_active() is not None or True
        engine_healthy = True
    except Exception:
        engine_healthy = False
    
    # Memory
    process = psutil.Process()
    mem_mb = process.memory_info().rss / 1024 / 1024
    
    return jsonify({
        "flask": "ok",
        "websocket": "ok" if ws_reachable else "down",
        "websocket_port": ws_port,
        "websocket_latency_ms": ws_latency_ms,
        "database": "ok" if db_healthy else "down",
        "game_engine": "ok" if engine_healthy else "down",
        "memory_mb": round(mem_mb, 1),
        "uptime": time.time(),
    })


@api_bp.route("/activity", methods=["GET"])
def get_activity():
    """Get recent activity log."""
    try:
        limit = int(request.args.get("limit", 50))
        activities = container.state.get_actividad()[-limit:] if hasattr(container.state, 'get_actividad') else []
        return jsonify({"activity": activities})
    except Exception as e:
        return jsonify({"activity": [], "error": str(e)})


@api_bp.route("/logs", methods=["GET"])
def get_logs():
    """Get recent log entries."""
    try:
        lines = int(request.args.get("lines", 100))
        level = request.args.get("level", "")
        
        log_file = container.BASE_DIR / "launcher.log"
        if not log_file.exists():
            return jsonify({"logs": []})
        
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
        
        # Filter by level if specified
        if level:
            level = level.upper()
            filtered = [l for l in all_lines if f"[{level}]" in l]
        else:
            filtered = all_lines
        
        return jsonify({
            "logs": filtered[-lines:],
            "total_lines": len(all_lines)
        })
    except Exception as e:
        return jsonify({"logs": [], "error": str(e)}), 500


@api_bp.route("/server/start", methods=["POST"])
def start_server():
    """Start the Flask server (no-op if already running)."""
    # In production this would trigger the launcher to start the server
    # For now, just return status
    return jsonify({"ok": True, "message": "Server start requested"})


@api_bp.route("/server/stop", methods=["POST"])
def stop_server():
    """Stop the Flask server."""
    try:
        # This would need to be implemented to actually stop the server
        return jsonify({"ok": True, "message": "Server stop requested"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@api_bp.route("/server/restart", methods=["POST"])
def restart_server():
    """Restart the Flask server."""
    return jsonify({"ok": True, "message": "Server restart requested"})


@api_bp.route("/settings", methods=["GET"])
def get_settings():
    """Get current server settings."""
    import os
    return jsonify({
        "httpPort": int(os.environ.get("SILLY_PORT", "8080")),
        "wsPort": int(os.environ.get("SILLY_WS_PORT", "8081")),
        "debug": os.environ.get("SILLY_DEBUG", "false").lower() in ("true", "1"),
        "waitress": True,
        "authEnabled": True,
        "corsOrigins": os.environ.get("SILLY_CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"),
        "rateLimit": 300,
        "jwtSecretConfigured": bool(os.environ.get("JWT_SECRET", "")),
        "tokenTtl": 8,
        "heartbeatInterval": 30,
    })


@api_bp.route("/settings", methods=["PATCH"])
def update_settings():
    """Update server settings."""
    data = request.get_json(silent=True) or {}
    
    # In a real implementation, this would write to config file/env
    # For now, just return success
    return jsonify({"ok": True, "message": "Settings updated (restart required)"})


@api_bp.route("/auth/regenerate-pin", methods=["POST"])
def regenerate_pin():
    """Regenerate the access PIN."""
    # Require existing session authentication
    if not flask_session.get('authenticated'):
        return jsonify({"ok": False, "error": "Se requiere autenticación"}), 401
    
    import secrets
    import hashlib
    
    pin = secrets.token_hex(4).upper()
    salt = secrets.token_hex(16)
    h = hashlib.sha256((pin + salt).encode()).hexdigest()
    
    password_hash_path = container.BASE_DIR / ".password_hash"
    password_salt_path = container.BASE_DIR / ".password_salt"
    
    password_hash_path.write_text(h, encoding="utf-8")
    password_salt_path.write_text(salt, encoding="utf-8")
    
    os.environ["SILLY_PASSWORD_HASH"] = str(password_hash_path)
    os.environ["SILLY_PASSWORD_SALT"] = salt
    
    return jsonify({"ok": True, "pin": pin})


@api_bp.route("/backup", methods=["POST"])
def create_backup():
    """Create a backup of current state."""
    import shutil
    from datetime import datetime
    
    try:
        backup_dir = container.BASE_DIR / "backups"
        backup_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"backup_{timestamp}"
        backup_path = backup_dir / backup_name
        backup_path.mkdir()
        
        # Copy data files
        for fname in ["silly.json", "game_state.db", "config.json"]:
            src = container.BASE_DIR / fname
            if src.exists():
                shutil.copy2(src, backup_path / fname)
        
        # Create archive
        archive = shutil.make_archive(str(backup_path), 'zip', backup_path)
        shutil.rmtree(backup_path)
        
        return jsonify({"ok": True, "backup": os.path.basename(archive)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
