"""
_security.py — Security middleware: headers, CSRF, rate limiting.
"""
import hashlib
import hmac
import os
import time
import threading
from collections import defaultdict
from functools import wraps

from flask import Response, request, g, jsonify


# =============================================================================
# CSRF Protection
# =============================================================================
_CSRF_SECRET = os.environ.get("CSRF_SECRET", "sillyquiz-change-in-production-" + hashlib.sha256(b"defaultsalt").hexdigest()[:16])


def generar_token_csrf():
    """Genera un token CSRF baseado en la sesión y timestamp."""
    ts = str(int(time.time() // 3600))
    raw = f"{ts}:{request.remote_addr}"
    return hmac.new(_CSRF_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]


def validar_token_csrf(token):
    """Valida un token CSRF (ventana de 2 horas)."""
    if not token:
        return False
    for offset in (-1, 0, 1):
        ts = str(int(time.time() // 3600) + offset)
        raw = f"{ts}:{request.remote_addr}"
        expected = hmac.new(_CSRF_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]
        if hmac.compare_digest(token, expected):
            return True
    return False


def csrf_proteccion(f):
    """Decorator que valida CSRF en métodos mutantes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method in ('POST', 'PUT', 'DELETE', 'PATCH'):
            token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
            if not validar_token_csrf(token):
                return jsonify({"error": "CSRF token inválido"}), 403
        return f(*args, **kwargs)
    return decorated


# =============================================================================
# Rate Limiting (in-memory, per-IP)
# =============================================================================
class RateLimiter:
    """Rate limiter simple en memoria por IP y ventana de tiempo."""

    def __init__(self):
        self._requests = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key, limit=60, window=60):
        """
        Verifica si una key (normalmente IP) excede el límite.
        limit: máximo de requests por window (en segundos).
        """
        now = time.time()
        with self._lock:
            reqs = self._requests[key]
            # Limpiar requests fuera de la ventana
            self._requests[key] = [t for t in reqs if now - t < window]
            if len(self._requests[key]) >= limit:
                return False
            self._requests[key].append(now)
            return True

    def remaining(self, key, limit=60, window=60):
        now = time.time()
        with self._lock:
            reqs = [t for t in self._requests.get(key, []) if now - t < window]
            return max(0, limit - len(reqs))

    def reset(self, key):
        with self._lock:
            self._requests.pop(key, None)


rate_limiter = RateLimiter()


def rate_limit(limit=60, window=60):
    """Decorator de rate limiting por IP."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            ip = request.remote_addr or "unknown"
            key = f"{ip}:{f.__module__}.{f.__name__}"
            if not rate_limiter.is_allowed(key, limit, window):
                remaining = rate_limiter.remaining(key, limit, window)
                return jsonify({
                    "error": "Rate limit excedido",
                    "retry_after": window,
                    "remaining": remaining
                }), 429
            return f(*args, **kwargs)
        return decorated
    return decorator


# =============================================================================
# Input Sanitization
# =============================================================================
import re

_DANGEROUS_PATTERNS = [
    re.compile(r'<script[^>]*>', re.IGNORECASE),
    re.compile(r'javascript:', re.IGNORECASE),
    re.compile(r'on\w+\s*=', re.IGNORECASE),
    re.compile(r'expression\s*\(', re.IGNORECASE),
    re.compile(r'url\s*\(', re.IGNORECASE),
    re.compile(r'\.\.\/', re.IGNORECASE),
    re.compile(r'union\s+select', re.IGNORECASE),
    re.compile(r'drop\s+table', re.IGNORECASE),
]


def sanitize_input(value):
    """Sanitiza un string contra XSS y SQL injection básica."""
    if not isinstance(value, str):
        return value
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(value):
            return None
    return value.strip()[:10000]


def sanitize_dict(data):
    """Sanitiza recursivamente un diccionario."""
    if not isinstance(data, dict):
        return data
    cleaned = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized = sanitize_input(value)
            if sanitized is None:
                raise ValueError(f"Input peligroso detectado en '{key}'")
            cleaned[key] = sanitized
        elif isinstance(value, dict):
            cleaned[key] = sanitize_dict(value)
        elif isinstance(value, list):
            cleaned[key] = [
                sanitize_dict(item) if isinstance(item, dict) else
                sanitize_input(item) if isinstance(item, str) else item
                for item in value
            ]
        else:
            cleaned[key] = value
    return cleaned


# =============================================================================
# Opcode Whitelist para Scratch Builder
# =============================================================================
VALID_OPCODES = {
    'on_mode_init', 'on_question_load', 'on_question_start',
    'on_player_buzz', 'on_player_answer', 'on_timer_expire',
    'on_hardware_disconnect', 'on_custom_signal',
    'wait_seconds', 'wait_until_timestamp',
    'if_then', 'if_then_else', 'repeat_times', 'repeat_until',
    'repeat_for_range', 'exit_loop', 'continue_loop',
    'try_catch_fallback', 'break_stack', 'global_panic_reset',
    'set_theme', 'set_custom_theme', 'set_gradient_bg',
    'set_text_smooth', 'set_text_shadow', 'set_border',
    'set_rounded_corners', 'set_opacity_block', 'set_rotation',
    'set_scale', 'set_filter', 'set_position',
    'screen_flash', 'screen_shake', 'announce', 'display_set_timer',
    'show_ui_component', 'hide_ui_component', 'set_component_property',
    'inject_css_raw', 'play_css_animation', 'spawn_particle_emitter',
    'show_image', 'show_video', 'set_background_image',
    'load_font', 'create_overlay', 'move_component',
    'toggle_fullscreen_layer', 'trigger_scene_wipe',
    'show_component', 'hide_component',
    'play_bg_music', 'stop_bg_music_fade', 'play_sfx',
    'play_sfx_by_name', 'set_master_volume',
    'set_audio_category_volume', 'trigger_audio_ducking', 'stop_all_sounds',
    'display_register_setup', 'display_broadcast_payload', 'display_sync_clocks',
    'set_layer_z_index', 'set_grid_anchor', 'clear_all_displays',
    'quiz_init_engine', 'quiz_fetch_next_question', 'quiz_lock_answers',
    'quiz_verify_player_answer', 'quiz_add_score_to_player',
    'quiz_set_question', 'quiz_reveal_answer', 'quiz_get_score',
    'quiz_get_player_rank', 'quiz_reset_scores', 'quiz_get_question_category',
    'quiz_get_option_count', 'quiz_shuffle_options',
    'get_timer_remaining', 'set_timer_duration', 'timer_pause', 'timer_resume',
    'quiz_get_correct_option', 'quiz_get_question_image', 'quiz_get_difficulty',
    'quiz_get_total_questions',
    'state_init_memory_key', 'state_set_memory', 'state_increment_memory',
    'state_commit_to_sqlite', 'state_clear_volatile_cache',
    'state_set_persistent', 'state_get_persistent', 'state_load_persistent',
    'variable_set', 'variable_change', 'show_variable', 'hide_variable',
    'math_calc', 'logic_compare', 'logic_and_or', 'logic_not',
    'math_unary', 'math_binary', 'logic_xor', 'logic_between',
    'get_random_number', 'string_join', 'string_contains', 'parse_json_key',
    'string_length', 'string_case', 'string_replace', 'string_slice',
    'string_starts_with', 'string_ends_with',
    'string_trim', 'string_repeat', 'string_split', 'string_to_number',
    'string_matches', 'math_const', 'math_round_to',
    'json_parse', 'json_stringify', 'random_choice',
    'list_create', 'list_add_item', 'list_delete_item', 'list_insert_item',
    'list_get_item', 'list_length', 'list_contains', 'list_delete_all',
    'for_each_in_list', 'list_index_of', 'list_get_random_item',
    'list_set_item', 'list_shuffle', 'list_sort', 'list_join', 'list_count',
    'list_pop', 'list_reverse', 'list_unique', 'list_to_json',
    'players_set_active_slots', 'players_strike_penalize',
    'players_swap_positions', 'players_toggle_lockout',
    'players_set_avatar',
    'players_get_points', 'players_get_count', 'players_get_all_names',
    'players_eliminate', 'players_revive', 'players_get_rank',
    'players_sort_by_score', 'players_get_top_n', 'players_award_bonus',
    'db_query_filter_difficulty', 'db_query_exclude_last_questions',
    'db_query_mark_as_burned', 'db_query_shuffle_answers',
    'runtime_snapshot_take', 'runtime_hot_reload',
    'runtime_debug_log', 'runtime_export_json',
    'get_timestamp', 'get_current_time',
    'system_replicate_state_to_node',
    'broadcast', 'broadcast_and_wait', 'when_i_receive',
    'go_to_xy', 'glide_to_xy', 'change_x', 'change_y',
    'set_x', 'set_y',
    'say', 'think', 'change_size', 'set_size',
    'change_color_effect', 'clear_graphic_effects',
    'create_clone', 'delete_clone',
    'ask_and_wait',
    # Reporters / booleanos / hooks que faltaban en la whitelist inicial.
    # Todos forman parte del registro vetted de ScratchBlocks; se añaden para
    # que el backend acepte cualquier bloque que el editor pueda colocar.
    # (execute_raw_javascript se mantiene FUERA a propósito: es inseguro en prod).
    'db_query_get_hint_text', 'db_query_get_unanswered_count', 'db_query_search_by_keyword',
    'get_answer', 'get_display_connection_count', 'get_ndi_latency', 'get_x', 'get_y',
    'is_ndi_source_online', 'key_pressed',
    'list_get_item_at', 'list_get_length', 'list_remove_index', 'mouse_x', 'mouse_y',
    'ndi_connect_source', 'ndi_disconnect_source', 'ndi_send_canvas_scene',
    'ndi_set_frame_rate', 'ndi_start_discovery_worker', 'ndi_toggle_failover_image',
    'players_get_fastest_buzzer', 'players_get_name', 'players_is_alive',
    'quiz_get_answer_text', 'quiz_get_current_question_text', 'quiz_get_leaderboard_json',
    'state_get_memory_value', 'variable_get', 'when_i_start_as_clone',
}


def validate_opcodes_recursive(blocks):
    """Valida que todos los opcodes en una cadena de bloques estén en la whitelist."""
    errors = []
    if isinstance(blocks, list):
        for block in blocks:
            if isinstance(block, dict):
                opcode = block.get('opcode', '')
                if opcode and opcode not in VALID_OPCODES:
                    errors.append(f"Opcode no permitido: {opcode}")
                args = block.get('args', {})
                if isinstance(args, dict):
                    for key, val in args.items():
                        if isinstance(val, str):
                            s = sanitize_input(val)
                            if s is None:
                                errors.append(f"Input peligroso en args.{key}")
                for key in ('next', 'body', 'elseBody', 'fallback'):
                    if key in block and block[key]:
                        errors.extend(validate_opcodes_recursive(block[key]))
    return errors


# =============================================================================
# Security Headers (enhanced)
# =============================================================================
def add_security_headers(resp: Response) -> Response:
    """Aplica headers de seguridad a todas las respuestas."""
    ct = resp.content_type or ""
    if ct.startswith("text/") and "charset" not in ct:
        resp.content_type = ct + "; charset=utf-8"
    elif ct in ("application/json", "application/javascript") and "charset" not in ct:
        resp.content_type = ct + "; charset=utf-8"

    # Headers de seguridad
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

    # Content Security Policy
    csp_directives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'self'",
    ]
    resp.headers["Content-Security-Policy"] = "; ".join(csp_directives)

    # Eliminar headers obsoletos
    resp.headers.pop("X-XSS-Protection", None)
    if resp.headers.get("Cache-Control"):
        resp.headers.pop("Expires", None)

    # CSRF token en respuestas HTML
    if resp.content_type and "text/html" in resp.content_type:
        token = generar_token_csrf()
        resp.headers["X-CSRF-Token"] = token

    return resp
