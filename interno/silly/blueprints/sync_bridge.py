"""
sync_bridge.py — Puente HTTP (Flask/Waitress) -> servidor WebSocket de sync.

Mantiene UNA conexión WebSocket saliente hacia el sync_server (puerto 8081) y
envía comandos del Game Engine (register, event, leaderboard) esperando la
respuesta. Permite que el builder (que corre en el navegador) controle el
motor de juego sin abrir WebSockets desde el hilo de Waitress.
"""
import asyncio
import json
import threading
import websockets

SYNC_WS_URL = "ws://127.0.0.1:8081"


class SyncBridge:
    def __init__(self, url=SYNC_WS_URL):
        self.url = url
        self._lock = threading.Lock()

    def _call_sync(self, command, timeout=5.0):
        """Envía un comando y devuelve el dict de respuesta (thread-safe)."""
        with self._lock:
            return asyncio.run(self._send(command, timeout))

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
