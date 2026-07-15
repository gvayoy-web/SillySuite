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
from collections import defaultdict
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
# Rate Limiting (in-memory, per-IP)
# =============================================================================
class RateLimiter:
    """Simple sliding-window rate limiter per key, thread-safe."""

    def __init__(self):
        self._requests = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key, limit=60, window=60):
        """Check if key exceeds the limit within the window (seconds)."""
        now = time.time()
        with self._lock:
            reqs = self._requests[key]
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
    'players_get_score_of', 'players_set_var', 'players_get_var',
    'players_send_message', 'players_show_effect',
    # Timer extras
    'timer_is_paused',
    # Sprite extras
    'create_clone', 'delete_clone',
    # Physics extras
    'physics_create_distance_joint', 'physics_create_revolute_joint',
    'physics_create_prismatic_joint', 'physics_raycast', 'physics_query_aabb', 'physics',
    # Power Pack safe opcodes (math, strings, etc.)
    'burst_particles', 'triqui_triqui', 'triqui_triqui_slot_machine', 'spawn_money_rain',
    'physics_enable', 'physics_disable', 'physics_create_body', 'physics_destroy_body',
    'physics_set_velocity', 'physics_apply_force', 'physics_apply_impulse',
    'physics_set_gravity_scale', 'physics_on_collision', 'physics_get_position',
    'physics_get_velocity',
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
    'quiz_init_engine', 'quiz_fetch_next_question', 'quiz_lock_answers',
    'quiz_verify_player_answer', 'quiz_add_score_to_player',
    'quiz_set_question', 'quiz_reveal_answer', 'quiz_get_score',
    'quiz_get_player_rank', 'quiz_reset_scores', 'quiz_get_question_category',
    'quiz_get_option_count', 'quiz_shuffle_options',
    'get_timer_remaining', 'set_timer_duration', 'timer_pause', 'timer_resume',
    'quiz_get_correct_option', 'quiz_get_question_image', 'quiz_get_difficulty',
    'quiz_get_total_questions', 'quiz_get_round', 'quiz_is_paused',
    'quiz_get_current_question_text', 'quiz_get_answer_text', 'quiz_get_leaderboard_json',
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
    'players_get_all_names', 'players_get_count', 'players_eliminate', 'players_revive',
    'players_get_rank', 'players_sort_by_score', 'players_get_top_n',
    'players_award_bonus',
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
    'math_clamp', 'type_of', 'math_lerp',
    'math_const', 'math_round_to', 'json_parse', 'json_stringify',
    'random_choice',
    'string_trim', 'string_repeat', 'string_split', 'string_to_number', 'string_matches',
    # State full set
    'state_init_memory_key', 'state_set_memory', 'state_increment_memory',
    'state_commit_to_sqlite', 'state_clear_volatile_cache',
    # Operators full set
    'math_calc', 'logic_compare', 'logic_and_or', 'logic_not',
    'math_unary', 'math_binary', 'logic_xor', 'logic_between',
    'get_random_number', 'string_join', 'string_contains', 'parse_json_key',
    'string_length', 'string_case', 'string_replace', 'string_slice',
    'string_starts_with', 'string_ends_with',
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
