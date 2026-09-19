"""
sync_bridge.py — Servicio de sincronización con el servidor WebSocket.

Expone la interfaz de SyncBridge del blueprint para uso por otros servicios
del backend (mode_manager, game_state_manager, etc.) sin depender directamente
del blueprint.
"""
import logging

from interno.silly.blueprints.sync_bridge import bridge, SyncBridge

_log = logging.getLogger("sync_bridge_service")


def get_bridge() -> SyncBridge:
    """Devuelve la instancia singleton de SyncBridge."""
    return bridge


def register_session(slots, base_name_url, metrics, session_id=None):
    """Registra una sesión de juego en el servidor WebSocket."""
    return bridge.register_session(slots, base_name_url, metrics, session_id)


def report_event(token, event_key, payload):
    """Reporta un evento de juego al servidor WebSocket."""
    return bridge.report_event(token, event_key, payload)


def get_leaderboard(session_id, metric):
    """Obtiene el leaderboard de una sesión."""
    return bridge.get_leaderboard(session_id, metric)


def rehydrate_leaderboard(session_id, metric, leaderboard):
    """Rehidrata un leaderboard guardado en el servidor WebSocket."""
    return bridge.rehydrate_leaderboard(session_id, metric, leaderboard)


def health_check(timeout=1.5):
    """Health-check rápido contra el servidor WebSocket."""
    return bridge.ping(timeout=timeout)
