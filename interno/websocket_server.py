"""
websocket_server.py — Servidor de sincronizacion multi-display (SillyQuiz)

ARQUITECTURA (dual-process):
  Flask (Waitress, port 8080) + WebSocket (asyncio+websockets, port 8081).
  Ambos corren como hilos daemon en el mismo launcher (launcher.pyw).
  El WS process se comunica con Flask via shared memory (game_state.db) y
  broadcast de eventos. Un health-check mutuo garantiza reconexion automatica.

  El WebSocket NO depende de Flask — puede correr independiente. Flask NO
  depende del WS — funciona sin sync. El bridge es opcional pero recomendado.

Responsabilidades:
  - Registrar pantallas esclavas (display_id) y llevar conteo de conexiones.
  - Enrutar payloads JSON a displays especificos o a todos (display_broadcast_payload).
  - Sincronizar relojes (display_sync_clocks) con timestamp Unix del servidor.
  - Cola FIFO estricta para eventos de hardware (on_player_buzz / on_player_answer):
    los pulsadores se serializan por llegada antes de dispatch, evitando mezcla
    por concurrencia de hilos. Estampa microsegundos a nivel de servidor.
  - Local Game Engine: sesiones de juego, tokens JWT firmados, rate-limit por socket,
    heartbeats ping/pong, leaderboard autoritativo en RAM.

Uso:  python websocket_server.py  [--host 0.0.0.0] [--port 8081]
"""
import asyncio
import argparse
import json
import os
import time
import logging
import hmac
import hashlib
import secrets
import base64
from collections import defaultdict
from dataclasses import dataclass, field

try:
    import websockets
except ImportError:
    websockets = None
    logging.basicConfig(level=logging.INFO)
    logging.getLogger(__name__).error(
        "Falta la libreria 'websockets'. Instalar con: pip install websockets"
    )

LOG = logging.getLogger("ws-sync")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")

# Configuración de seguridad
JWT_SECRET = os.environ.get("JWT_SECRET", "sillyquiz-change-in-production").encode()
TOKEN_TTL = 8 * 3600  # 8 horas
RATE_LIMIT_WINDOW = 1.0  # 1 segundo
MAX_EVENTS_PER_WINDOW = 10  # máx 10 eventos/seg por socket
HEARTBEAT_INTERVAL = 30  # ping cada 30s
HEARTBEAT_TIMEOUT = 10   # timeout pong 10s


@dataclass
class RateLimiter:
    """Token bucket rate limiter por socket."""
    events: dict = field(default_factory=lambda: defaultdict(list))
    window: float = RATE_LIMIT_WINDOW
    max_events: int = MAX_EVENTS_PER_WINDOW

    def allow(self, key: str) -> bool:
        now = time.time()
        events = self.events[key]
        # Limpiar eventos antiguos
        while events and events[0] < now - self.window:
            events.pop(0)
        if len(events) >= self.max_events:
            return False
        events.append(now)
        return True

    def cleanup(self):
        """Limpia claves sin actividad reciente."""
        now = time.time()
        dead = [k for k, v in self.events.items() if not v or v[-1] < now - 60]
        for k in dead:
            del self.events[k]


def create_jwt(payload: dict) -> str:
    """Crea JWT simple (header.payload.signature) con HMAC-SHA256."""
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64.urlsafe_b64encode(json.dumps(header, separators=(',', ':')).encode()).decode().rstrip('=')
    payload["iat"] = int(time.time())
    payload["exp"] = payload["iat"] + TOKEN_TTL
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(JWT_SECRET, signing_input.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).decode().rstrip('=')
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def verify_jwt(token: str) -> dict | None:
    """Verifica JWT y devuelve payload si es válido."""
    try:
        header_b64, payload_b64, sig_b64 = token.split('.')
        signing_input = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(JWT_SECRET, signing_input.encode(), hashlib.sha256).digest()
        expected_b64 = base64.urlsafe_b64encode(expected_sig).decode().rstrip('=')
        if not hmac.compare_digest(sig_b64, expected_b64):
            return None
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + '==').decode())
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


class SyncServer:
    def __init__(self):
        self.displays = {}          # display_id -> websocket
        self.fifo = asyncio.Queue()  # cola estricta de eventos de hardware
        self._fifo_task = None
        # --- Local Game Engine (RAM autoritativa) ---
        self.play_sessions = {}
        self.tokens = {}             # token -> (session_id, client_id)
        self.leaderboards = {}
        self.mobile_clients = {}     # token -> websocket
        # Seguridad
        self.rate_limiter = RateLimiter()
        self.heartbeats = {}         # token -> last_pong_time
        self._heartbeat_task = None
        self.rate_limiter = RateLimiter()

    async def broadcast(self, payload):
        dead = []
        for did, ws in list(self.displays.items()):
            try:
                await ws.send(json.dumps(payload))
            except Exception:
                dead.append(did)
        for did in dead:
            await self.unregister(did)

    async def send_to(self, display_id, payload):
        ws = self.displays.get(display_id)
        if ws:
            try:
                await ws.send(json.dumps(payload))
                return True
            except Exception:
                await self.unregister(display_id)
        return False

    async def enqueue_hardware(self, event):
        """Empuja un evento de hardware a la cola FIFO con sello de microsegundos."""
        event = dict(event)
        event["server_us"] = time.time_ns() // 1000
        await self.fifo.put(event)

    async def fifo_consumer(self):
        """Consume la cola FIFO en orden estricto y la reenvía al canal de juego."""
        while True:
            event = await self.fifo.get()
            LOG.info("FIFO <- %s (us=%d)", event.get("type"), event.get("server_us"))
            # Aquí se dispatchaba al motor de juego; en MVP se retransmite a displays.
            await self.broadcast({"type": "hardware_event", "event": event})
            self.fifo.task_done()

    async def handler(self, ws):
        display_id = None
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send(json.dumps({"type": "error", "msg": "JSON inválido"}))
                    continue

                mtype = msg.get("type")
                if mtype == "register":
                    display_id = msg.get("display_id", "display_" + str(id(ws)))
                    await self.register(ws, display_id)
                elif mtype == "payload":
                    target = msg.get("display_id")
                    if target and target != "all":
                        ok = await self.send_to(target, msg.get("data", msg))
                        if not ok:
                            await ws.send(json.dumps({"type": "error", "msg": "display no encontrado"}))
                    else:
                        await self.broadcast(msg.get("data", msg))
                elif mtype == "sync_clock":
                    await ws.send(json.dumps({"type": "clock", "server_unix": time.time()}))
                elif mtype == "hardware_event":
                    await self.enqueue_hardware(msg.get("event", msg))
                # --- SillyVisualizer: reflejo en vivo del editor ---
                elif mtype == "builder_state":
                    # Reenvía el estado del editor (heads serializados) a todas
                    # las pantallas conectadas, incl. SillyVisualizer.
                    await self.broadcast({
                        "type": "builder_state",
                        "state": msg.get("state"),
                        "ts": time.time(),
                    })
                # --- Local Game Engine ---
                elif mtype == "play_register":
                    session_id = msg.get("session_id") or ("game_" + _rand_token()[:8])
                    res = self.play_register(
                        session_id,
                        msg.get("slots", 4),
                        msg.get("base_name_url", "persona"),
                        msg.get("metrics", ["kills"]),
                    )
                    await ws.send(json.dumps({"type": "play_registered", **res}))
                elif mtype == "play_load_template":
                    ok = self.play_load_template(msg.get("session_id"), msg.get("template_id"))
                    await ws.send(json.dumps({"type": "play_template_loaded", "ok": ok}))
                elif mtype == "play_connect":
                    await self.play_connect(ws, msg.get("token"))
                elif mtype == "play_event":
                    # AUTORITATIVO: el client_id lo impone el servidor vía token.
                    res = self.play_event(msg.get("token"), msg.get("event_key"), msg.get("payload"))
                    await ws.send(json.dumps({"type": "play_event_result", **res}))
                elif mtype == "play_leaderboard":
                    res = self.play_leaderboard(msg.get("session_id"), msg.get("metric"))
                    await ws.send(json.dumps({"type": "play_leaderboard", **res}))
                elif mtype == "rehydrate_leaderboard":
                    res = self.rehydrate_leaderboard(msg.get("session_id"), msg.get("metric"), msg.get("leaderboard"))
                    await ws.send(json.dumps({"type": "rehydrate_leaderboard_result", **res}))
                elif mtype == "pong":
                    token = msg.get("token")
                    if token:
                        await self.handle_pong(token)
                elif mtype == "health_check":
                    await ws.send(json.dumps({
                        "type": "health_ok",
                        "uptime": time.time(),
                        "displays": len(self.displays),
                        "sessions": len(self.play_sessions),
                    }))
                else:
                    await ws.send(json.dumps({"type": "error", "msg": "tipo desconocido: " + str(mtype)}))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            if display_id:
                await self.unregister(display_id)


    # ===================== LOCAL GAME ENGINE =====================

    def play_register(self, session_id, slots, base_name_url, metrics):
        """Crea la sesión de juego y emite tokens inmutables por slot.
        El servidor es AUTORITATIVO: sólo estos client_id pueden reportar."""
        players = {}
        for i in range(int(slots)):
            cid = "%s%d" % (base_name_url or "persona", i + 1)
            token = _rand_token()
            url = "/play/%s" % cid
            players[cid] = {"token": token, "url": url, "name": cid, "connected": False}
            self.tokens[token] = (session_id, cid)
        self.play_sessions[session_id] = {
            "slots": int(slots), "base_name_url": base_name_url,
            "players": players, "template": None,
        }
        self.leaderboards.setdefault(session_id, {})
        for m in (metrics or ["kills"]):
            self.leaderboards[session_id].setdefault(m, {})
        LOG.info("Game session %s: %d jugadores", session_id, len(players))
        return {
            "session_id": session_id,
            "players": [{"client_id": c, "token": p["token"], "url": p["url"], "name": p["name"]}
                        for c, p in players.items()],
        }

    def play_load_template(self, session_id, template_id):
        s = self.play_sessions.get(session_id)
        if s:
            s["template"] = template_id
            LOG.info("Session %s -> plantilla %s", session_id, template_id)
            return True
        return False

    async def play_connect(self, ws, token):
        """Celular se conecta con su token; se valida y se marca activo."""
        pair = self.tokens.get(token)
        if not pair:
            await ws.send(json.dumps({"type": "error", "msg": "token inválido"}))
            return False
        session_id, client_id = pair
        # Rate limit: máx 1 conexión por token cada 5s
        if not self.rate_limiter.consume(f"connect:{token}", 1):
            await ws.send(json.dumps({"type": "error", "msg": "rate limit exceeded"}))
            return False
        self.mobile_clients[token] = ws
        self.heartbeats[token] = time.time()
        self.play_sessions[session_id]["players"][client_id]["connected"] = True
        await ws.send(json.dumps({"type": "play_ready", "client_id": client_id,
                                  "session_id": session_id}))
        LOG.info("Jugador %s conectado (session %s)", client_id, session_id)
        return True

    def play_event(self, token, event_key, payload):
        """Procesa un reporte de evento de un celular. AUTORITATIVO:
        valida el token y sólo acepta client_id registrados. Incrementa
        el leaderboard en RAM y devuelve el leaderboard actualizado."""
        pair = self.tokens.get(token)
        if not pair:
            return {"ok": False, "reason": "token inválido"}
        session_id, client_id = pair
        # El cliente NUNCA define client_id: el servidor lo impone.
        metric = (payload or {}).get("metric", "kills")
        board = self.leaderboards.setdefault(session_id, {}).setdefault(metric, {})
        delta = (payload or {}).get("by", 1)
        if not isinstance(delta, (int, float)) or delta <= 0:
            delta = 1
        board[client_id] = board.get(client_id, 0) + delta
        top = sorted(board.items(), key=lambda kv: kv[1], reverse=True)
        result = {"ok": True, "client_id": client_id, "metric": metric,
                  "leaderboard": [{"client_id": k, "value": v} for k, v in top]}
        # Rehidratar proyector en vivo.
        asyncio.ensure_future(self.broadcast({
            "type": "leaderboard_update", "session_id": session_id,
            "metric": metric, "leaderboard": result["leaderboard"],
        }))
        return result

    def play_leaderboard(self, session_id, metric):
        board = self.leaderboards.get(session_id, {}).get(metric or "kills", {})
        top = sorted(board.items(), key=lambda kv: kv[1], reverse=True)
        return {"session_id": session_id, "metric": metric or "kills",
                "leaderboard": [{"client_id": k, "value": v} for k, v in top]}

# ===================== HEARTBEAT & RATE LIMIT =====================

    async def heartbeat_loop(self):
        """Envía ping a todos los móviles conectados y desconecta los que no responden."""
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            now = time.time()
            dead = []
            for token, ws in list(self.mobile_clients.items()):
                last_pong = self.heartbeats.get(token, 0)
                if now - last_pong > HEARTBEAT_TIMEOUT:
                    dead.append(token)
                    continue
                try:
                    await ws.send(json.dumps({"type": "ping", "ts": time.time()}))
                except Exception:
                    dead.append(token)
            for token in dead:
                await self._disconnect_mobile(token)
                LOG.warning("Jugador %s desconectado por heartbeat timeout", token)
            self.rate_limiter.cleanup()

    async def handle_pong(self, token):
        """Registra pong recibido del móvil."""
        self.heartbeats[token] = time.time()

    def rehydrate_leaderboard(self, session_id, metric, leaderboard):
        """Restaura leaderboard desde estado persistido."""
        if not session_id or not metric or not leaderboard:
            return {"ok": False, "reason": "parámetros inválidos"}
        if session_id not in self.leaderboards:
            self.leaderboards[session_id] = {}
        self.leaderboards[session_id][metric] = {entry["client_id"]: entry["value"] for entry in leaderboard}
        LOG.info("Leaderboard rehidratado: session=%s metric=%s entries=%d", session_id, metric, len(leaderboard))
        return {"ok": True}


def _rand_token():
    import secrets
    return secrets.token_urlsafe(16)


class RateLimiter:
    """Token bucket rate limiter por token/clave."""
    def __init__(self, rate=20, per=60, burst=50):
        self.rate = rate      # tokens por ventana
        self.per = per        # segundos de ventana
        self.burst = burst    # máximo tokens acumulados
        self.buckets = {}     # key -> (tokens, last_update)

    def _refill(self, key):
        now = time.time()
        tokens, last = self.buckets.get(key, (self.burst, now))
        elapsed = now - last
        tokens = min(self.burst, tokens + elapsed * self.rate / self.per)
        self.buckets[key] = (tokens, now)
        return tokens

    def consume(self, key, amount=1):
        tokens = self._refill(key)
        if tokens >= amount:
            self.buckets[key] = (tokens - amount, time.time())
            return True
        return False

    def cleanup(self):
        """Elimina buckets vacíos/antiguos."""
        now = time.time()
        dead = [k for k, (t, last) in self.buckets.items() if t >= self.burst and now - last > self.per * 2]
        for k in dead:
            self.buckets.pop(k, None)


async def main_async(host, port):
    server = SyncServer()
    server._fifo_task = asyncio.create_task(server.fifo_consumer())
    server._heartbeat_task = asyncio.create_task(server.heartbeat_loop())
    LOG.info("WebSocket sync escuchando en ws://%s:%d", host, port)
    async with websockets.serve(server.handler, host, port):
        await asyncio.Future()  # corre para siempre


def main():
    parser = argparse.ArgumentParser(description="SillyQuiz WebSocket Sync Server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8081)
    args = parser.parse_args()
    if websockets is None:
        raise SystemExit(1)
    try:
        asyncio.run(main_async(args.host, args.port))
    except KeyboardInterrupt:
        LOG.info("Servidor detenido")


if __name__ == "__main__":
    main()
