"""
app.py — SillyQuiz Server v6 "SILLY PACK"
Modular architecture with blueprint-based routes.
SillyQuiz: Tu Constructor de Juegos - Crea, Juega, Comparte
"""
import atexit
import logging
import os
import secrets
import signal
import sys
import threading
import time
from contextlib import contextmanager
from flask import Flask, jsonify, request, session
from flask_cors import CORS

from silly.config_loader import load_config, load_questions
from silly.mode_manager import ModeManager
from silly.modes.questions import QuestionsMode
from silly.modes.roulette import RouletteMode
from silly.modes.hangman import HangmanMode
from silly.modes.verses import VersesMode
from silly.services.logger import setup_logging
from silly.services.sse import EventBus, EVENT_TIMER_TICK, EVENT_TIMER_STOP
from silly.services.stats_service import StatsService
from silly.services.theme_service import CompleteThemeEngine
from silly.services.sound_service import SoundService

# Nuevos modulos del BuildSilly
from silly.game_state_manager import game_state_manager
from silly.template_registry import template_registry
from silly.template_engine import template_engine
from silly.communication_manager import communication_manager

setup_logging()
log = logging.getLogger(__name__)

DATA_FILE = os.getenv("SILLY_DATA_FILE", "silly.json")
SERVER_PORT = int(os.getenv("SILLY_PORT", "8080"))
SERVER_DEBUG = os.getenv("SILLY_DEBUG", "false").lower() in ("true", "1")


def _resolve_secret_key() -> str:
    """Devuelve una clave de sesion estable.

    Prioridad: variable de entorno FLASK_SECRET_KEY. Si no existe, se persiste
    una clave en <BASE_DIR>/.flask_secret para que las sesiones sobrevivan a
    reinicios (en lugar de regenerarse aleatoriamente en cada arranque).
    """
    env_key = os.environ.get("FLASK_SECRET_KEY")
    if env_key:
        return env_key
    secret_path = os.path.join(BASE_DIR, ".flask_secret")
    try:
        if os.path.exists(secret_path):
            with open(secret_path, "r", encoding="utf-8") as fh:
                key = fh.read().strip()
                if key:
                    return key
        key = secrets.token_hex(32)
        with open(secret_path, "w", encoding="utf-8") as fh:
            fh.write(key)
        try:
            os.chmod(secret_path, 0o600)
        except OSError:
            pass
        return key
    except OSError:
        return secrets.token_hex(32)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# CORS origins from env or defaults
_cors_origins_env = os.getenv("SILLY_CORS_ORIGINS", "")
DEFAULT_CORS_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
]
ALLOWED_CORS_ORIGINS = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] or DEFAULT_CORS_ORIGINS

try:
    from waitress import serve as waitress_serve
    HAS_WAITRESS = True
except ImportError:
    HAS_WAITRESS = False
    waitress_serve = None

config = load_config()
preguntas_data = load_questions()

from silly.models.state import AppState
from silly.models.cronometro import Cronometro

# Initialize the application state and mode manager with enhanced error handling
state = AppState(config, preguntas_data)
mode_manager = ModeManager(state)

# Enhanced validation and initialization with better error handling
# Enhanced validation and initialization with better error handling
def _init_core():
    # Load rotation persistence from config (best effort).
    rotation_cfg = config.get("theme_rotation", {})
    if rotation_cfg:
        try:
            theme_engine.set_rotation_state(rotation_cfg)
            log.info("Rotacion de temas cargada: %s", rotation_cfg)
        except Exception as exc:  # noqa: BLE001 - degradar sin romper arranque
            log.warning("No se pudo cargar rotacion: %s", exc)

    # Verify essential components are initialized
    if not isinstance(getattr(state, "display_config", None), dict):
        raise RuntimeError("State display_config no inicializado correctamente")
    if not isinstance(getattr(mode_manager, "_modes", None), dict):
        raise RuntimeError("Mode manager no inicializado correctamente")
    log.info("SillyQuiz v6: Nucleo del servidor listo - todos los componentes verificados")


try:
    _init_core()
except Exception as error:  # noqa: BLE001 - permitir fallback en produccion
    log.error("Error critico durante la inicializacion: %s", error)
    if SERVER_DEBUG:
        raise
    log.warning("Continuando con configuracion minima debido a error de inicializacion")

global stats_service
stats_service = StatsService()

theme_engine = CompleteThemeEngine(os.path.join(BASE_DIR, "themes"))

sound_service = SoundService(os.path.join(BASE_DIR, "sounds"))

event_bus = EventBus(state, mode_manager, stats_service)

from silly.globals import container
container.state = state
container.config = config
container.mode_manager = mode_manager
container.event_bus = event_bus
container.log = log
container.DATA_FILE = DATA_FILE
container.BASE_DIR = BASE_DIR
container.stats_service = stats_service
container.theme_engine = theme_engine
container.sound_service = sound_service

# Nuevos managers del Modo Builder
container.game_state_manager = game_state_manager
container.template_registry = template_registry
container.template_engine = template_engine
container.communication_manager = communication_manager

with state.lock:
    state.display_config["sound_map"] = sound_service.get_map()

# Load rotation persistence from config
try:
    rotation_cfg = config.get("theme_rotation", {})
    if rotation_cfg:
        theme_engine.set_rotation_state(rotation_cfg)
        log.info("Rotacion de temas cargada: %s", rotation_cfg)
except Exception as exc:
    log.warning("No se pudo cargar rotacion: %s", exc)


def _on_timer_timeout():
    mode = mode_manager.get_active()
    with state.lock:
        state.timer_activo = False
        state.timer_segundos = 0
    if mode and mode.name == "ruleta":
        mode.stop()
    event_bus.notify(EVENT_TIMER_STOP)


def _on_timer_tick(remaining):
    with state.lock:
        state.timer_segundos = max(0, int(remaining))
    event_bus.notify(EVENT_TIMER_TICK)


cronometro = Cronometro(on_timeout=_on_timer_timeout, on_tick=_on_timer_tick)
container.cronometro = cronometro
cronometro.start()

# Register all modes
mode_manager.register(QuestionsMode(state, event_bus, config))
mode_manager.register(RouletteMode(state, event_bus, config))
mode_manager.register(HangmanMode(state, event_bus, config))
mode_manager.register(VersesMode(state, event_bus, config))


_shutdown_event = None
_shutdown_handlers = []


def register_shutdown_handler(handler):
    """Register a handler to be called on graceful shutdown."""
    _shutdown_handlers.append(handler)


def _shutdown():
    log.info("Deteniendo servidor SILLY...")
    cronometro.stop_thread()
    for name in ("verses",):
        mode = mode_manager.get_mode(name)
        if mode and hasattr(mode, "_cronometro"):
            mode._cronometro.stop_thread()
    with event_bus.suscriptores_lock:
        event_bus.suscriptores.clear()
    # Call registered shutdown handlers
    for handler in _shutdown_handlers:
        try:
            handler()
        except Exception as e:
            log.error("Error en handler de apagado: %s", e)
    # Persist state
    try:
        from silly.services.persistence import guardar_datos
        guardar_datos(state.datos_persistibles())
    except Exception as e:
        log.error("Error guardando datos al apagar: %s", e)
    log.info("Servidor SILLY detenido.")


def _signal_handler(signum, frame):
    log.info("SeÃ±al %s recibida, iniciando apagado graceful...", signum)
    _shutdown()
    sys.exit(0)


def create_app():
    global _shutdown_event
    import threading
    _shutdown_event = threading.Event()

    app = Flask(__name__, static_folder=None)
    app.secret_key = _resolve_secret_key()
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_NAME"] = "silly_session"
    app.config["SESSION_PERMANENT"] = True
    app.config["PERMANENT_SESSION_LIFETIME"] = 86400 * 30  # 30 days

    # CORS: configurable origins with credentials support
    CORS(app, origins=ALLOWED_CORS_ORIGINS, supports_credentials=True,
         allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
         expose_headers=["X-CSRF-Token"],
         max_age=3600)

    from silly.services.theme_service import ThemeService
    THEMES_DIR = os.path.join(container.BASE_DIR, "themes")
    container.theme_service = ThemeService(THEMES_DIR)

    from silly.blueprints._security import (
        add_security_headers, rate_limiter, csrf_proteccion,
        require_auth, require_auth_html, is_auth_enabled,
        verify_credentials, generar_token_csrf, validar_token_csrf,
    )
    from silly.services.audit import audit_logger
    app.after_request(add_security_headers)

    from silly.blueprints.static import static_bp
    from silly.blueprints.api import api_bp
    from silly.blueprints.quiz import quiz_bp
    from silly.blueprints.display import display_bp
    from silly.blueprints.timer import timer_bp
    from silly.blueprints.modes import modes_bp

    from silly.blueprints.config import config_bp
    from silly.blueprints.export import export_bp
    from silly.blueprints.themes import themes_bp
    from silly.blueprints.sounds import sounds_bp
    from silly.blueprints.mode_packages import mode_packages_bp
    from silly.blueprints.engine import engine_bp
    from silly.blueprints.play_routes import play_bp
    from silly.blueprints.qr_routes import qr_bp

    # Nuevos blueprints del BuildSilly
    from silly.blueprints.templates import templates_bp
    from silly.blueprints.communication import comm_bp
    from silly.blueprints.docs import docs_bp
    from silly.blueprints.control import control_bp
    from silly.blueprints.sync_bridge import sync_bp

    app.register_blueprint(static_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(quiz_bp)
    app.register_blueprint(display_bp, url_prefix="/display")
    # Alias bajo /api para que el panel de control (que usa API='/api')
    # pueda controlar el display via /api/display/* sin romper la ruta /display.
    app.register_blueprint(display_bp, name="display_api", url_prefix="/api/display")
    app.register_blueprint(timer_bp)
    app.register_blueprint(modes_bp)

    app.register_blueprint(config_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(mode_packages_bp)
    app.register_blueprint(engine_bp)
    app.register_blueprint(play_bp)
    app.register_blueprint(themes_bp)
    app.register_blueprint(sounds_bp)

    # Registrar nuevos blueprints
    app.register_blueprint(templates_bp)
    app.register_blueprint(comm_bp)
    app.register_blueprint(docs_bp)
    app.register_blueprint(qr_bp)
    app.register_blueprint(control_bp)
    app.register_blueprint(sync_bp)

    # =========================================================================
    # AUTH ROUTES â€” login/logout endpoints
    # =========================================================================
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if not is_auth_enabled():
            from flask import redirect
            return redirect("/sillycontrol/", code=302)
        if request.method == "GET":
            from flask import make_response
            html = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SillyQuiz - Acceso</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0B0B0B;color:#F2EBDD;font-family:'Space Grotesk','Segoe UI',system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161616;border:2px solid #2A2A2A;padding:40px;max-width:400px;width:90%;text-align:center}
h1{font-size:1.8rem;margin-bottom:8px;color:#FF5E3A}
.sub{color:#A8A090;margin-bottom:30px;font-size:0.9rem}
label{display:block;text-align:left;color:#A8A090;font-size:0.85rem;margin-bottom:6px;font-weight:600}
input{width:100%;padding:12px 16px;background:#0B0B0B;border:2px solid #2A2A2A;color:#F2EBDD;
font-size:1rem;font-family:'Space Mono',monospace;letter-spacing:4px;text-align:center;margin-bottom:20px;outline:none}
input:focus{border-color:#FF5E3A}
button{width:100%;padding:14px;background:#FF5E3A;border:none;color:#0B0B0B;font-weight:700;
font-size:1rem;cursor:pointer;font-family:'Space Grotesk',sans-serif}
button:hover{background:#FF7A5C}
.err{color:#FF3B30;margin-top:12px;font-size:0.85rem;min-height:20px}
</style>
</head>
<body>
<div class="card">
<h1>SillyQuiz</h1>
<p class="sub">Panel de Control â€” Acceso</p>
<form method="POST" action="/login">
<label for="pin">PIN de acceso</label>
<input type="password" id="pin" name="pin" maxlength="32" autocomplete="current-password" autofocus required>
<button type="submit">Entrar</button>
<div class="err" id="err"></div>
</form>
</div>
</body>
</html>"""
            resp = make_response(html)
            resp.headers["Cache-Control"] = "no-cache"
            return resp

        # POST: validate PIN
        pin = request.form.get("pin", "")
        if verify_credentials(pin):
            session["authenticated"] = True
            session.permanent = True
            audit_logger.log_security_event("login_success", {}, request.remote_addr)
            from flask import redirect
            return redirect("/sillycontrol/", code=302)
        else:
            audit_logger.log_security_event("login_failure", {}, request.remote_addr)
            from flask import make_response
            resp = make_response("<script>document.getElementById('err').textContent='PIN incorrecto';</script>", 401)
            return resp

    @app.route("/logout", methods=["POST", "GET"])
    def logout():
        session.clear()
        from flask import redirect
        return redirect("/login", code=302)

    # =========================================================================
    # HEALTH CHECK & SHUTDOWN
    # =========================================================================
    @app.route("/api/health", methods=["GET"])
    def health_check():
        """Health check endpoint for load balancers and monitoring."""
        return jsonify({
            "status": "ok",
            "timestamp": time.time(),
            "version": "6.0",
            "uptime": time.time() - app.config.get("START_TIME", time.time()),
        })

    @app.route("/api/shutdown", methods=["POST"])
    def shutdown():
        """Graceful shutdown endpoint (requires auth in production)."""
        if not SERVER_DEBUG:
            from silly.blueprints._security import require_auth
            # Simple auth check for shutdown
            auth_header = request.headers.get("Authorization", "")
            expected = os.environ.get("SHUTDOWN_TOKEN", "")
            if not expected or auth_header != f"Bearer {expected}":
                return jsonify({"error": "Unauthorized"}), 401
        
        log.info("Apagado solicitado via endpoint")
        _shutdown_event.set()
        
        # Schedule actual shutdown after response
        def delayed_shutdown():
            time.sleep(0.5)
            _shutdown()
            os._exit(0)
        
        import threading
        threading.Thread(target=delayed_shutdown, daemon=True).start()
        
        return jsonify({"status": "shutting down"})

    # =========================================================================
    # RATE LIMITING & REQUEST MIDDLEWARE
    # =========================================================================
    _SENSITIVE_ROUTES = {
        "login", "logout",
    }

    @app.before_request
    def _before_request():
        request._start_time = time.time()
        p = request.path
        _STATIC_PREFIXES = (
            "/js/", "/css/", "/media/", "/vendor/", "/html/",
            "/quiz-renderer.js", "/api/stream",
        )
        _PAGE_ROOTS = (
            "/sillycontrol", "/sillycontrol/",
            "/display", "/displaysilly", "/canva", "/play", "/",
            "/login", "/logout", "/api/health",
        )
        if p.startswith(_STATIC_PREFIXES) or p in _PAGE_ROOTS:
            return

        # Stricter rate limit for sensitive routes (login, import, shutdown)
        if any(s in p for s in ("/preguntas/importar", "/login", "/shutdown")):
            ip = request.remote_addr or "unknown"
            if not rate_limiter.is_allowed(f"sensitive:{ip}", limit=10, window=60):
                from flask import jsonify as _jsonify
                audit_logger.log_security_event("rate_limit_sensitive", {"path": p}, ip)
                return _jsonify({"error": "Rate limit excedido para ruta sensible"}), 429

        # Global rate limit for API: 300 req/min per IP
        ip = request.remote_addr or "unknown"
        if not rate_limiter.is_allowed(f"global:{ip}", limit=300, window=60):
            from flask import jsonify as _jsonify
            return _jsonify({"error": "Rate limit excedido"}), 429

        # Request size limit (configurable; individual asset sanitizer still applies its own caps)
        _max_payload = int(os.getenv("SILLY_MAX_PAYLOAD_MB", "50")) * 1024 * 1024
        if request.content_length and request.content_length > _max_payload:
            from flask import jsonify as _jsonify
            return _jsonify({"error": "Payload demasiado grande"}), 413

    @app.after_request
    def _log_request(response):
        duration = time.time() - request._start_time
        status = response.status_code
        msg = "%s %s -> %s (%.3fs)"
        if status >= 500:
            log.error(msg, request.method, request.path, status, duration)
            audit_logger.log_security_event("server_error", {
                "method": request.method, "path": request.path, "status": status
            }, request.remote_addr)
        elif status >= 400:
            log.warning(msg, request.method, request.path, status, duration)
            if status == 429:
                audit_logger.log_security_event("rate_limit", {
                    "path": request.path
                }, request.remote_addr)
        else:
            log.info(msg, request.method, request.path, status, duration)
        return response

    @app.errorhandler(400)
    def _handle_400(exc):
        log.warning("Bad request: %s %s - %s", request.method, request.path, exc)
        return jsonify({"error": "Solicitud invÃ¡lida"}), 400

    @app.errorhandler(401)
    def _handle_401(exc):
        log.warning("Unauthorized: %s %s", request.method, request.path)
        return jsonify({"error": "No autorizado"}), 401

    @app.errorhandler(403)
    def _handle_403(exc):
        log.warning("Forbidden: %s %s", request.method, request.path)
        return jsonify({"error": "Prohibido"}), 403

    @app.errorhandler(404)
    def _handle_404(exc):
        log.debug("Not found: %s %s", request.method, request.path)
        return jsonify({"error": "No encontrado"}), 404

    @app.errorhandler(429)
    def _handle_429(exc):
        log.warning("Rate limited: %s %s from %s", request.method, request.path, request.remote_addr)
        return jsonify({"error": "Demasiadas solicitudes"}), 429

    @app.errorhandler(500)
    def _handle_500(exc):
        log.exception("Error interno del servidor en %s %s", request.method, request.path)
        return jsonify({"error": "Error interno del servidor"}), 500

    @app.errorhandler(Exception)
    def _handle_exception(exc):
        log.exception("ExcepciÃ³n no manejada: %s", exc)
        return jsonify({"error": "Error interno del servidor"}), 500

    # Register signal handlers for graceful shutdown (only in main thread)
    try:
        if threading.main_thread() is threading.current_thread():
            signal.signal(signal.SIGTERM, _signal_handler)
            signal.signal(signal.SIGINT, _signal_handler)
    except (ValueError, OSError):
        # Signal handlers not available in this context (e.g., non-main thread)
        pass

    app.config["START_TIME"] = time.time()

    return app


app = create_app()


if __name__ == "__main__":
    from silly.services.persistence import guardar_datos, crear_backup
    if not os.path.exists(DATA_FILE):
        guardar_datos(state.datos_persistibles())
    crear_backup()
    log.info("=" * 60)
    log.info("  SILLYQUIZ v6 â€” Servidor listo")
    log.info("  Panel:    http://localhost:%d/control", SERVER_PORT)
    log.info("  Display:  http://localhost:%d/display", SERVER_PORT)
    log.info("  Canva:    http://localhost:%d/canva", SERVER_PORT)
    log.info("  Play:     http://localhost:%d/play/<cid>", SERVER_PORT)
    log.info("  WS:       ws://localhost:8081")
    log.info("  Datos:    %s", DATA_FILE)
    log.info("=" * 60)
    if HAS_WAITRESS and not SERVER_DEBUG:
        waitress_serve(app, host="0.0.0.0", port=SERVER_PORT, threads=100)
    else:
        app.run(debug=SERVER_DEBUG, host="0.0.0.0", port=SERVER_PORT, use_reloader=False, threaded=True)

