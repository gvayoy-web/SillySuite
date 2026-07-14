"""
app.py — SillyQuiz Server v6 "SILLY PACK"
Modular architecture with blueprint-based routes.
SillyQuiz: Tu Constructor de Juegos - Crea, Juega, Comparte
"""
import atexit
import logging
import os
import time
from flask import Flask, jsonify, request
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

# Nuevos módulos del BuildSilly
from silly.game_state_manager import game_state_manager
from silly.template_registry import template_registry
from silly.template_engine import template_engine
from silly.communication_manager import communication_manager

setup_logging()
log = logging.getLogger(__name__)

DATA_FILE = os.getenv("SILLY_DATA_FILE", "silly.json")
SERVER_PORT = int(os.getenv("SILLY_PORT", "8080"))
SERVER_DEBUG = os.getenv("SILLY_DEBUG", "false").lower() in ("true", "1")
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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

state = AppState(config, preguntas_data)
mode_manager = ModeManager(state)

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
        log.info("Rotación de temas cargada: %s", rotation_cfg)
except Exception as exc:
    log.warning("No se pudo cargar rotación: %s", exc)


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


def _shutdown():
    log.info("Deteniendo servidor SILLY...")
    cronometro.stop_thread()
    for name in ("verses",):
        mode = mode_manager.get_mode(name)
        if mode and hasattr(mode, "_cronometro"):
            mode._cronometro.stop_thread()
    with event_bus.suscriptores_lock:
        event_bus.suscriptores.clear()
    log.info("Servidor SILLY detenido.")


atexit.register(_shutdown)


def create_app():
    app = Flask(__name__, static_folder=None)
    CORS(app)

    from silly.services.theme_service import ThemeService
    THEMES_DIR = os.path.join(container.BASE_DIR, "themes")
    container.theme_service = ThemeService(THEMES_DIR)

    from silly.blueprints._security import add_security_headers, rate_limiter, csrf_proteccion
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
    from silly.blueprints.play_routes import play_bp
    from silly.blueprints.engine import engine_bp
    from silly.blueprints.mode_packages import mode_packages_bp
    from silly.blueprints.control import control_bp

    app.register_blueprint(static_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(quiz_bp)
    app.register_blueprint(display_bp, url_prefix="/display")
    # Alias bajo /api para que el panel de control (que usa API='/api')
    # pueda controlar el display vía /api/display/* sin romper la ruta /display.
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

    @app.before_request
    def _before_request():
        request._start_time = time.time()
        # No aplicar rate-limiting a recursos estáticos, al stream SSE ni a
        # las páginas HTML: de lo contrario el límite global (por IP) se
        # agota al instante al abrir Control + Display + el preview embebido,
        # bloqueando /js y /css con 429 y rompiendo la app.
        p = request.path
        _STATIC_PREFIXES = (
            "/js/", "/css/", "/media/", "/vendor/", "/html/",
            "/quiz-renderer.js", "/api/stream",
        )
        _PAGE_ROOTS = (
            "/sillycontrol", "/sillycontrol/", "/control",
            "/display", "/displaysilly", "/canva", "/play", "/",
        )
        if p.startswith(_STATIC_PREFIXES) or p in _PAGE_ROOTS:
            return
        # Rate limiting solo para la API (estado, acciones): 300 req/min por IP
        ip = request.remote_addr or "unknown"
        if not rate_limiter.is_allowed(f"global:{ip}", limit=300, window=60):
            from flask import jsonify as _jsonify
            return _jsonify({"error": "Rate limit excedido"}), 429

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

    @app.errorhandler(500)
    def _handle_500(exc):
        log.exception("Error interno del servidor en %s %s", request.method, request.path)
        return jsonify({"error": "Error interno del servidor"}), 500

    return app


app = create_app()


if __name__ == "__main__":
    from silly.services.persistence import guardar_datos, crear_backup
    if not os.path.exists(DATA_FILE):
        guardar_datos(state.datos_persistibles())
    crear_backup()
    log.info("=" * 60)
    log.info("  SILLYQUIZ v6 — Servidor listo")
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