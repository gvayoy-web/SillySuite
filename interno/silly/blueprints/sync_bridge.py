"""
sync_bridge.py — Puente HTTP (Flask/Waitress) -> servidor WebSocket de sync.

Mantiene UNA conexión WebSocket saliente hacia el sync_server (puerto 8081) y
envía comandos del Game Engine (register, event, leaderboard) esperando la
respuesta. Permite que el builder (que corre en el navegador) controle el
motor de juego sin abrir WebSockets desde el hilo de Waitress.

Fase 3a: health-check mutuo Flask<->WS vía endpoint /api/sync/health que
hace un ping/connect rápido y no bloqueante al servidor WebSocket.
"""
import asyncio
import json
import logging
import os
import threading
import time
from flask import Blueprint, jsonify

import websockets

SYNC_WS_URL = "ws://127.0.0.1:8081"
WS_PORT = int(os.environ.get("SILLY_WS_PORT", "8081"))

sync_bp = Blueprint("sync_bridge", __name__)
_log = logging.getLogger("sync_bridge")


class SyncBridge:
    def __init__(self, url=SYNC_WS_URL):
        self.url = url
        self._lock = threading.Lock()

    def _call_sync(self, command, timeout=5.0, retries=2):
        """Envía un comando y devuelve el dict de respuesta (thread-safe).
        Reintenta con backoff exponencial ante fallos transitorios."""
        last_err = None
        for attempt in range(retries + 1):
            try:
                with self._lock:
                    result = asyncio.run(self._send(command, timeout))
                if result.get("ok", True):
                    return result
                last_err = result.get("error", "unknown error")
            except Exception as e:
                last_err = str(e)
                _log.warning("SyncBridge intento %d/%d falló: %s", attempt + 1, retries + 1, last_err)
            if attempt < retries:
                backoff = min(2.0, 0.2 * (2 ** attempt))
                time.sleep(backoff)
        _log.error("SyncBridge agotó reintentos para %s: %s", command.get("type"), last_err)
        return {"ok": False, "error": last_err}

    async def _send(self, command, timeout):
        try:
            async with websockets.connect(self.url, open_timeout=timeout) as ws:
                await ws.send(json.dumps(command))
                # Espera la respuesta del tipo correspondiente.
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    msg = json.loads(raw)
                    if self._matches(msg, command.get("type")):
                        return msg
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # --- Health-check mutuo (Fase 3a) ---
    def ping(self, timeout=1.5, retries=2):
        """Hace un ping/connect rápido y no bloqueante al WS.
        Reintenta `retries` veces con backoff exponencial ante fallos transitorios.
        Devuelve dict con ok/latency_ms/error."""
        last_err = None
        for attempt in range(retries + 1):
            try:
                start = time.time()
                with self._lock:
                    resp = asyncio.run(self._send_ping(timeout))
                if resp.get("ok"):
                    resp["latency_ms"] = round((time.time() - start) * 1000, 1)
                    return resp
                last_err = resp.get("error")
            except Exception as e:
                last_err = str(e)
            if attempt < retries:
                backoff = min(2.0, 0.2 * (2 ** attempt))
                time.sleep(backoff)
        return {"ok": False, "error": last_err}

    async def _send_ping(self, timeout):
        try:
            async with websockets.connect(self.url, open_timeout=timeout) as ws:
                await ws.send(json.dumps({"type": "ping"}))
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    msg = json.loads(raw)
                    if msg.get("type") == "pong":
                        return {"ok": True, "displays": msg.get("displays", 0),
                                "sessions": msg.get("sessions", 0)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @staticmethod
    def _matches(msg, req_type):
        t = msg.get("type")
        mapping = {
            "play_register": "play_registered",
            "play_event": "play_event_result",
            "play_leaderboard": "play_leaderboard",
        }
        return t == mapping.get(req_type, req_type + "_result") or t == req_type

    # --- API de alto nivel usada por el blueprint engine ---
    def register_session(self, slots, base_name_url, metrics, session_id=None):
        return self._call_sync({
            "type": "play_register",
            "session_id": session_id,
            "slots": slots, "base_name_url": base_name_url, "metrics": metrics,
        })

    def report_event(self, token, event_key, payload):
        return self._call_sync({
            "type": "play_event",
            "token": token, "event_key": event_key, "payload": payload,
        })

    def get_leaderboard(self, session_id, metric):
        return self._call_sync({
            "type": "play_leaderboard",
            "session_id": session_id, "metric": metric,
        })

    # --- Rehidratación de leaderboard desde estado persistido ---
    def rehydrate_leaderboard(self, session_id, metric, leaderboard):
        """Empuja leaderboard guardado al sync_server."""
        return self._call_sync({
            "type": "rehydrate_leaderboard",
            "session_id": session_id,
            "metric": metric,
            "leaderboard": leaderboard,
        })


bridge = SyncBridge()


@sync_bp.route("/api/sync/health", methods=["GET"])
def sync_health():
    """Health-check mutuo: estado de Flask + alcance del WS (puerto 8081).
    Ping/connect rápido y no bloqueante con timeout corto."""
    result = bridge.ping(timeout=1.5)
    return jsonify({
        "flask": "ok",
        "websocket": "ok" if result.get("ok") else "unreachable",
        "websocket_port": WS_PORT,
        "websocket_latency_ms": result.get("latency_ms"),
        "websocket_displays": result.get("displays"),
        "websocket_sessions": result.get("sessions"),
        "websocket_error": result.get("error"),
        "uptime": time.time(),
    }), 200


# ===================== DASHBOARD WS STATS ENDPOINTS =====================

@sync_bp.route("/api/ws/stats", methods=["GET"])
def ws_stats():
    """Get WebSocket server statistics for dashboard."""
    result = bridge._call_sync({"type": "stats"}, timeout=3.0)
    if result.get("ok"):
        return jsonify({
            "ok": True,
            "displays": result.get("displays", 0),
            "sessions": result.get("sessions", 0),
            "mobiles": result.get("mobiles", 0),
            "fifo_rate": result.get("fifo_rate", 0),
            "latency": result.get("latency", 0),
        })
    return jsonify({"ok": False, "error": result.get("error", "WS unreachable")}), 503


@sync_bp.route("/api/engine/stats", methods=["GET"])
def engine_stats():
    """Get Local Game Engine statistics."""
    result = bridge._call_sync({"type": "engine_stats"}, timeout=3.0)
    if result.get("ok"):
        return jsonify({
            "ok": True,
            "games": result.get("games", 0),
            "players": result.get("players", 0),
            "leaderboards": result.get("leaderboards", 0),
            "tokens": result.get("tokens", 0),
        })
    return jsonify({"ok": False, "error": result.get("error", "WS unreachable")}), 503


@sync_bp.route("/api/connections", methods=["GET"])
def ws_connections():
    """Get list of active WebSocket connections."""
    result = bridge._call_sync({"type": "list_connections"}, timeout=3.0)
    if result.get("ok"):
        return jsonify({"ok": True, "connections": result.get("connections", [])})
    return jsonify({"ok": False, "error": result.get("error", "WS unreachable")}), 503


@sync_bp.route("/api/connections/<connection_id>", methods=["DELETE"])
def disconnect_client(connection_id):
    """Disconnect a specific WebSocket client."""
    result = bridge._call_sync({
        "type": "disconnect_client",
        "connection_id": connection_id
    }, timeout=3.0)
    if result.get("ok"):
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": result.get("error", "Failed")}), 500
