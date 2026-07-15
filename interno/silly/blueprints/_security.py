"""
_security.py — Security middleware: auth (PIN + session), CSRF, rate limiting,
opcode whitelist, input sanitization, and security headers.
"""
import hashlib
import hmac
import os
import re
import secrets
import sys
import time
import threading
from functools import wraps

from flask import Response, request, g, jsonify, session


# =============================================================================
# Authentication — PIN-based local auth with session cookies
# =============================================================================
_PASSWORD_HASH_FILE = os.environ.get("SILLY_PASSWORD_HASH", "")
_PASSWORD_SALT = os.environ.get("SILLY_PASSWORD_SALT", "")


def _hash_pin(pin: str, salt: str) -> str:
    """SHA-256 hash of PIN+salt (used for storage). Argon2 preferred when
    argon2-cffi is available, fallback to SHA-256 for zero-dep environments."""
    try:
        import argon2
        h = argon2.PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
        return h.hash(pin + salt)
    except ImportError:
        return hashlib.sha256((pin + salt).encode()).hexdigest()


def _verify_pin(pin: str, stored_hash: str, salt: str) -> bool:
    """Verify a PIN against the stored hash."""
    try:
        import argon2
        h = argon2.PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
        h.verify(stored_hash, pin + salt)
        return True
    except ImportError:
        return hmac.compare_digest(
            hashlib.sha256((pin + salt).encode()).hexdigest(),
            stored_hash,
        )
    except Exception:
        return False


def is_auth_enabled() -> bool:
    """Check if authentication is configured (password hash file exists and is non-empty)."""
    return bool(_PASSWORD_HASH_FILE and os.path.isfile(_PASSWORD_HASH_FILE))


def verify_credentials(pin: str) -> bool:
    """Verify PIN against stored credentials. Returns True if valid."""
    if not is_auth_enabled():
        return True
    try:
        with open(_PASSWORD_HASH_FILE, "r", encoding="utf-8") as f:
            stored = f.read().strip()
        return _verify_pin(pin, stored, _PASSWORD_SALT)
    except Exception:
        return False


def require_auth(f):
    """Decorator: require valid session for protected routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not is_auth_enabled():
            return f(*args, **kwargs)
        if session.get("authenticated"):
            return f(*args, **kwargs)
        return jsonify({"error": "Autenticación requerida", "auth_required": True}), 401
    return decorated


def require_auth_html(f):
    """Decorator: require valid session for HTML page routes. Redirects to login."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not is_auth_enabled():
            return f(*args, **kwargs)
        if session.get("authenticated"):
            return f(*args, **kwargs)
        from flask import redirect
        return redirect("/login", code=302)
    return decorated


# =============================================================================
# CSRF Protection — mandatory in production
# =============================================================================
_CSRF_SECRET = os.environ.get("CSRF_SECRET", "")


def _ensure_csrf_secret():
    """Abort if CSRF_SECRET is not set in production-like environments."""
    if not _CSRF_SECRET:
        is_prod = os.environ.get("SILLYQUIZ_HEADLESS") or os.environ.get("SILLY_PROD")
        if is_prod:
            print("FATAL: CSRF_SECRET environment variable is required in production.", file=sys.stderr)
            print("Set it in config.json or as an env var before starting.", file=sys.stderr)
            sys.exit(1)
        # Dev fallback: generate a random ephemeral secret (not shared across restarts)
        import warnings
        warnings.warn(
            "CSRF_SECRET not set — using ephemeral dev secret. "
            "Set CSRF_SECRET env var for production.",
            RuntimeWarning,
        )
        return secrets.token_hex(32)
    return _CSRF_SECRET


_EFFECTIVE_CSRF_SECRET = _ensure_csrf_secret()


def generar_token_csrf():
    """Generate a time-based CSRF token bound to the client IP."""
    ts = str(int(time.time() // 3600))
    raw = f"{ts}:{request.remote_addr}"
    return hmac.new(_EFFECTIVE_CSRF_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]


def validar_token_csrf(token):
    """Validate a CSRF token (2-hour window)."""
    if not token:
        return False
    for offset in (-1, 0, 1):
        ts = str(int(time.time() // 3600) + offset)
        raw = f"{ts}:{request.remote_addr}"
        expected = hmac.new(_EFFECTIVE_CSRF_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]
        if hmac.compare_digest(token, expected):
            return True
    return False


def csrf_proteccion(f):
    """Decorator: validates CSRF on mutating methods."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method in ('POST', 'PUT', 'DELETE', 'PATCH'):
            token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
            if not validar_token_csrf(token):
                return jsonify({"error": "CSRF token inválido"}), 403
        return f(*args, **kwargs)
    return decorated


# =============================================================================
# Rate Limiting (persistente en SQLite vía game_state_manager, per-IP)
# =============================================================================
from silly.game_state_manager import game_state_manager


class RateLimiter:
    """Rate limiter de ventana deslizante persistente (SQLite), thread-safe.
    Mantiene la MISMA interfaz pública que la versión en memoria:
    is_allowed(key, limit, window), remaining(key, limit, window), reset(key).

    Cada instancia usa un namespace para aislar sus claves (las claves
    persisten en SQLite y sobreviven reinicios del proceso)."""

    def __init__(self, manager=None):
        self._manager = manager or game_state_manager
        self._ns = "rl_" + secrets.token_hex(8)
        self._lock = threading.Lock()

    def _k(self, key):
        return f"{self._ns}:{key}"

    def is_allowed(self, key, limit=60, window=60):
        """Check if key exceeds the limit within the window (seconds)."""
        now = time.time()
        cutoff = now - window
        k = self._k(key)
        with self._lock:
            count = self._manager.count_rate_events(k, cutoff)
            if count >= limit:
                return False
            self._manager.record_rate_event(k, now)
            return True

    def remaining(self, key, limit=60, window=60):
        now = time.time()
        cutoff = now - window
        k = self._k(key)
        with self._lock:
            count = self._manager.count_rate_events(k, cutoff)
            return max(0, limit - count)

    def reset(self, key):
        with self._lock:
            self._manager.reset_rate_limit(self._k(key))


rate_limiter = RateLimiter()


def rate_limit(limit=60, window=60):
    """Decorator for per-IP rate limiting."""
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
                    "remaining": remaining,
                }), 429
            return f(*args, **kwargs)
        return decorated
    return decorator


# =============================================================================
# Input Sanitization
# =============================================================================
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
    """Sanitize a string against basic XSS and SQL injection."""
    if not isinstance(value, str):
        return value
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(value):
            return None
    return value.strip()[:10000]


def sanitize_dict(data):
    """Recursively sanitize a dictionary."""
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
# Opcode Whitelist — single source of truth: scripts/opcodes_gen.py
# =============================================================================
# SECURITY: execute_raw_javascript and inject_css_raw are BLOCKED (not in this set).
# They must never be allowed in production — they allow arbitrary JS/CSS injection.
from scripts.opcodes_gen import VALID_SCRATCH_OPCODES as _GEN_OPCODES

# Additional opcodes that exist in the builder but are NOT in the generated list
# (procedures, custom events, engine extras). Merged here as the single Python set.
_EXTRAS = {
    # Procedures / Mis Bloques
    'proc_def', 'proc_param', 'proc_call', 'proc_call_reporter', 'proc_call_boolean', 'proc_return',
    # Custom events
    'emit_event', 'on_custom_event', 'event_data',
    # Engine extras not in sync_opcodes output
    'render_update_proyector_leaderboard', 'engine_create_player_client',
    'engine_load_game_template', 'engine_on_client_event', 'engine_get_leaderboard_data',
    # Players extras
    'points', 'set_var', 'get_var',
    'send_message', 'show_effect',
    # Timer extras
    'timer_is_paused',
    # Sprite extras
    'create_clone', 'delete_clone',
    # Physics extras
    'physics_create_distance_joint', 'physics_create_revolute_joint',
    'physics_create_prismatic_joint', 'physics_raycast', 'physics_query_aabb', 'physics_query_point',
    # Power Pack safe opcodes (math, strings, etc.)
    'burst_particles', 'triqui_triqui', 'triqui_triqui_slot_machine', 'spawn_money_rain',
    'physics_enable', 'physics_disable', 'physics_create_body', 'physics_destroy_body',
    'physics_set_velocity', 'physics_apply_force', 'physics_apply_impulse',
    'physics_set_gravity_scale', 'physics_on_collision', 'physics_get_position',
    'physics_get_velocity', 'physics_set_collision_filter', 'physics_add_fixture',
    'physics_destroy_joint',
    # Additional look/display opcodes
    'show_image', 'show_video', 'set_background_image',
    'load_font', 'create_overlay', 'move_component',
    'toggle_fullscreen_layer', 'trigger_scene_wipe',
    'show_component', 'hide_component',
    'create_tween', 'say', 'think', 'change_size', 'set_size',
    'change_color_effect', 'clear_graphic_effects',
    'go_to_xy', 'glide_to_xy', 'change_x', 'change_y',
    'set_x', 'set_y', 'get_x', 'get_y',
    # Audio extras
    'set_audio_category_volume', 'trigger_audio_ducking', 'stop_all_sounds',
    # NDI extras
    'get_ndi_latency', 'is_ndi_source_online',
    # Display extras
    'get_display_connection_count',
    # Quiz full set
    'init', 'next_question', 'lock_answers',
    'verify_answer', 'add_score',
    'set_question', 'reveal_answer', 'score',
    'player_rank', 'reset_scores', 'question_category',
    'option_count', 'shuffle_options',
    'timer_remaining', 'timer_set', 'timer_pause', 'timer_resume',
    'correct_option', 'question_image', 'difficulty',
    'total_questions', 'quiz_get_round', 'quiz_is_paused',
    'question_text', 'answer_text', 'leaderboard',
    # State extras
    'variable_set', 'variable_change', 'variable_get', 'variable_init',
    'show_variable', 'hide_variable',
    'state_set_persistent', 'state_get_persistent', 'state_load_persistent',
    'state_get_memory_value',
    # List extras
    'list_set_item', 'list_shuffle', 'list_sort', 'list_join', 'list_count',
    'list_pop', 'list_reverse', 'list_unique', 'list_to_json',
    'list_get_item_at', 'list_get_length', 'list_contains',
    'list_get_random_item', 'list_index_of',
    # Player extras
    'all_names', 'count', 'eliminate', 'revive',
    'rank', 'sort_scores', 'top_n',
    'award_bonus',
    # DB extras
    'db_query_get_hint_text', 'db_query_get_unanswered_count', 'db_query_search_by_keyword',
    # Runtime extras
    'runtime_snapshot_take', 'runtime_hot_reload', 'runtime_debug_log', 'runtime_export_json',
    'system_replicate_state_to_node', 'get_timestamp', 'get_current_time',
    # Animation extras
    'anim_mode', 'anim_burst', 'anim_flash', 'anim_confetti', 'anim_clear_fx',
    # Sprite extras
    'sprite_spawn', 'sprite_destroy', 'sprite_set_animation',
    'sprite_move_to', 'sprite_set_velocity', 'sprite_on_collision',
    'sprite_is_touching',
    # Math extras (Power Pack)
    'clamp', 'type_of', 'lerp',
    'const', 'round_to', 'json_parse', 'json_stringify',
    'random_choice',
    'trim', 'repeat', 'split', 'to_number', 'matches',
    # State full set
    'state_init_memory_key', 'state_set_memory', 'state_increment_memory',
    'state_commit_to_sqlite', 'state_clear_volatile_cache',
    # Operators full set
    'math', 'compare', 'and', 'or', 'not',
    'unary', 'binary', 'xor', 'between',
    'random', 'join', 'contains', 'json_key',
    'length', 'case', 'replace', 'slice',
    'starts_with', 'ends_with',
    # Broadcasts
    'broadcast', 'broadcast_and_wait',
    # Input
    'ask_and_wait', 'get_answer', 'mouse_x', 'mouse_y', 'key_pressed',
}

# Merge: generated opcodes (from JS) + safe extras. DANGEROUS opcodes are EXCLUDED.
VALID_OPCODES: set = _GEN_OPCODES | _EXTRAS

# Explicit blocklist — these opcodes MUST NEVER be in VALID_OPCODES
_DANGEROUS_OPCODES = frozenset({'execute_raw_javascript', 'inject_css_raw'})
VALID_OPCODES -= _DANGEROUS_OPCODES

# Verify no dangerous opcodes leaked in
assert not (VALID_OPCODES & _DANGEROUS_OPCODES), (
    f"Dangerous opcodes found in VALID_OPCODES: {VALID_OPCODES & _DANGEROUS_OPCODES}"
)


def validate_opcodes_recursive(blocks):
    """Validate that all opcodes in a block chain are in the whitelist."""
    errors = []
    if isinstance(blocks, list):
        for block in blocks:
            if isinstance(block, dict):
                opcode = block.get('opcode', '')
                if opcode and opcode not in VALID_OPCODES:
                    errors.append(f"Opcode no permitido: {opcode}")
                if opcode in _DANGEROUS_OPCODES:
                    errors.append(f"Opcode de seguridad bloqueado: {opcode}")
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
# Security Headers (enhanced with HSTS)
# =============================================================================
def add_security_headers(resp: Response) -> Response:
    """Apply security headers to all responses."""
    ct = resp.content_type or ""
    if ct.startswith("text/") and "charset" not in ct:
        resp.content_type = ct + "; charset=utf-8"
    elif ct in ("application/json", "application/javascript") and "charset" not in ct:
        resp.content_type = ct + "; charset=utf-8"

    # Core security headers
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

    # HSTS — only for HTTPS (safe to add unconditionally; browsers ignore on HTTP)
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

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

    # Remove obsolete headers
    resp.headers.pop("X-XSS-Protection", None)
    if resp.headers.get("Cache-Control"):
        resp.headers.pop("Expires", None)

    # CSRF token in HTML responses
    if resp.content_type and "text/html" in resp.content_type:
        token = generar_token_csrf()
        resp.headers["X-CSRF-Token"] = token

    return resp
