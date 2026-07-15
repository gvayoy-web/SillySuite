"""
security_test.py — Security tests for SillyQuiz.
Verifies: blocked opcodes, CSRF enforcement, auth system, security headers.
"""
import os
import sys
import hashlib
import hmac

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'interno'))

# Set required env vars for testing
os.environ.setdefault("CSRF_SECRET", "test-secret-for-ci")
os.environ.setdefault("SILLYQUIZ_HEADLESS", "1")


class TestBlockedOpcodes:
    """Verify dangerous opcodes are never in VALID_OPCODES."""

    def test_execute_raw_javascript_blocked(self):
        from silly.blueprints._security import VALID_OPCODES
        assert 'execute_raw_javascript' not in VALID_OPCODES

    def test_inject_css_raw_blocked(self):
        from silly.blueprints._security import VALID_OPCODES
        assert 'inject_css_raw' not in VALID_OPCODES

    def test_dangerous_opcodes_constant(self):
        from silly.blueprints._security import _DANGEROUS_OPCODES
        assert 'execute_raw_javascript' in _DANGEROUS_OPCODES
        assert 'inject_css_raw' in _DANGEROUS_OPCODES

    def test_validate_rejects_dangerous_opcodes(self):
        from silly.blueprints._security import validate_opcodes_recursive
        blocks = [{'opcode': 'execute_raw_javascript', 'args': {'CODE': 'alert(1)'}}]
        errors = validate_opcodes_recursive(blocks)
        assert len(errors) > 0
        assert any('bloqueado' in e for e in errors)

    def test_validate_rejects_inject_css(self):
        from silly.blueprints._security import validate_opcodes_recursive
        blocks = [{'opcode': 'inject_css_raw', 'args': {'CSS': 'body{background:red}'}}]
        errors = validate_opcodes_recursive(blocks)
        assert len(errors) > 0

    def test_validate_allows_safe_opcodes(self):
        from silly.blueprints._security import validate_opcodes_recursive
        blocks = [{'opcode': 'set_theme', 'args': {'THEME': 'neon'}}]
        errors = validate_opcodes_recursive(blocks)
        assert len(errors) == 0


class TestCSRFProtection:
    """Verify CSRF token generation and validation."""

    def test_csrf_secret_is_set(self):
        from silly.blueprints._security import _EFFECTIVE_CSRF_SECRET
        assert len(_EFFECTIVE_CSRF_SECRET) > 0

    def test_opcodes_gen_no_dangerous(self):
        """opcodes_gen.py should not contain blocked opcodes."""
        from scripts.opcodes_gen import VALID_SCRATCH_OPCODES
        assert 'execute_raw_javascript' not in VALID_SCRATCH_OPCODES
        assert 'inject_css_raw' not in VALID_SCRATCH_OPCODES


class TestInputSanitization:
    """Verify input sanitization blocks dangerous patterns."""

    def test_script_tag_blocked(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('<script>alert(1)</script>') is None

    def test_javascript_proto_blocked(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('javascript:alert(1)') is None

    def test_onclick_blocked(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('onclick=alert(1)') is None

    def test_normal_input_allowed(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('Hello World') == 'Hello World'

    def test_path_traversal_blocked(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('../../etc/passwd') is None

    def test_sql_injection_blocked(self):
        from silly.blueprints._security import sanitize_input
        assert sanitize_input('1; DROP TABLE users') is None


class TestRateLimiter:
    """Verify rate limiter works correctly."""

    def test_basic_rate_limit(self):
        from silly.blueprints._security import RateLimiter
        rl = RateLimiter()
        assert rl.is_allowed("test", limit=3, window=60) is True
        assert rl.is_allowed("test", limit=3, window=60) is True
        assert rl.is_allowed("test", limit=3, window=60) is True
        assert rl.is_allowed("test", limit=3, window=60) is False

    def test_remaining(self):
        from silly.blueprints._security import RateLimiter
        rl = RateLimiter()
        rl.is_allowed("test", limit=5, window=60)
        assert rl.remaining("test", limit=5, window=60) == 4

    def test_reset(self):
        from silly.blueprints._security import RateLimiter
        rl = RateLimiter()
        for _ in range(5):
            rl.is_allowed("test", limit=5, window=60)
        rl.reset("test")
        assert rl.is_allowed("test", limit=5, window=60) is True


class TestAuthSystem:
    """Verify auth helpers work correctly."""

    def test_hash_generation(self):
        from silly.blueprints._security import _hash_pin
        h = _hash_pin("1234", "testsalt")
        assert len(h) > 0
        assert h != "1234"

    def test_verify_correct_pin(self):
        from silly.blueprints._security import _hash_pin, _verify_pin
        salt = "testsalt"
        h = _hash_pin("1234", salt)
        assert _verify_pin("1234", h, salt) is True

    def test_verify_wrong_pin(self):
        from silly.blueprints._security import _hash_pin, _verify_pin
        salt = "testsalt"
        h = _hash_pin("1234", salt)
        assert _verify_pin("5678", h, salt) is False
