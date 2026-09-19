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
# SECURITY: el secreto JWT debe venir de entorno. Si no está definido generamos una
# clave efímera y advertimos (nunca usamos una clave conocida/predecible en producción).
_JWT_SECRET_ENV = os.environ.get("JWT_SECRET")
if _JWT_SECRET_ENV:
    JWT_SECRET = _JWT_SECRET_ENV.encode()
else:
    JWT_SECRET = secrets.token_hex(32).encode()
    LOG.warning(
        "JWT_SECRET no definido en entorno: se genero una clave efimera. "
        "Define JWT_SECRET para persistencia de tokens entre reinicios."
    )
TOKEN_TTL = 12 * 3600  # 12 horas
RATE_LIMIT_WINDOW = 1.0  # 1 segundo
MAX_EVENTS_PER_WINDOW = int(os.environ.get("WS_MAX_EVENTS_PER_WINDOW", "50"))
HEARTBEAT_INTERVAL = int(os.environ.get("WS_HEARTBEAT_INTERVAL", "25"))
HEARTBEAT_TIMEOUT = int(os.environ.get("WS_HEARTBEAT_TIMEOUT", "12"))
MAX_CONNECTIONS = int(os.environ.get("WS_MAX_CONNECTIONS", "200"))
MAX_MESSAGE_SIZE = int(os.environ.get("WS_MAX_MESSAGE_SIZE", "65536"))  # 64KB


@dataclass
class TokenBucketRateLimiter:
    """Token bucket rate limiter por token/clave."""
    rate: int = 20          # tokens por ventana
    per: int = 60           # segundos de ventana
    burst: int = 50         # máximo tokens acumulados
    buckets: dict = field(default_factory=dict)  # key -> (tokens, last_update)

    def _refill(self, key: str) -> float:
        now = time.time()
        tokens, last = self.buckets.get(key, (self.burst, now))
        elapsed = now - last
        tokens = min(self.burst, tokens + elapsed * self.rate / self.per)
        self.buckets[key] = (tokens, now)
        return tokens

    def consume(self, key: str, amount: int = 1) -> bool:
        tokens = self._refill(key)
        if tokens >= amount:
            self.buckets[key] = (tokens - amount, time.time())
            return True
        return False

    def allow(self, key: str, amount: int = 1) -> bool:
        """Alias para compatibilidad con código que usa allow()."""
        return self.consume(key, amount)

    def cleanup(self):
        """Elimina buckets vacíos/antiguos."""
        now = time.time()
        dead = [k for k, (t, last) in self.buckets.items() 
                if t >= self.burst and now - last > self.per * 2]
        for k in dead:
            self.buckets.pop(k, None)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def _b64url_decode(data: str) -> bytes:
    # Restaura padding de forma segura antes de decodificar.
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_jwt(payload: dict) -> str:
    """Crea JWT simple (header.payload.signature) con HMAC-SHA256.

    NO muta el dict de entrada: trabaja sobre una copia para evitar
    efectos colaterales en el llamador.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(',', ':')).encode())
    payload = dict(payload)
    payload["iat"] = int(time.time())
    payload["exp"] = payload["iat"] + TOKEN_TTL
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode())
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(JWT_SECRET, signing_input.encode(), hashlib.sha256).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def verify_jwt(token: str) -> dict | None:
    """Verifica JWT y devuelve payload si es válido."""
    try:
        if not isinstance(token, str) or token.count('.') != 2:
            return None
        header_b64, payload_b64, sig_b64 = token.split('.')
        signing_input = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(JWT_SECRET, signing_input.encode(), hashlib.sha256).digest()
        expected_b64 = _b64url_encode(expected_sig)
        if not hmac.compare_digest(sig_b64, expected_b64):
            return None
        payload = json.loads(_b64url_decode(payload_b64).decode())
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
        self.mobile_sessions = {}    # token -> session_id (reverse lookup)
        # Seguridad
        self.rate_limiter = TokenBucketRateLimiter()
        self.heartbeats = {}         # token -> last_pong_time
        self._heartbeat_task = None
        self._shutdown_event = asyncio.Event()
        self._cleanup_task = None

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

    async def register(self, ws, display_id):
        if len(self.displays) >= MAX_CONNECTIONS:
            LOG.warning("Max connections reached (%d), rejecting %s", MAX_CONNECTIONS, display_id)
            await ws.send(json.dumps({"type": "error", "msg": "max connections reached"}))
            await ws.close(1013, "Too many connections")
            return
        if display_id in self.displays:
            old_ws = self.displays[display_id]
            try:
                await old_ws.close(1000, "Replaced by new connection")
            except Exception:
                pass
        self.displays[display_id] = ws
        LOG.info("Display registrado: %s (total: %d)", display_id, len(self.displays))

    async def unregister(self, display_id):
        ws = self.displays.pop(display_id, None)
        if ws:
            try:
                await ws.close()
            except Exception:
                pass
            LOG.info("Display desregistrado: %s (total: %d)", display_id, len(self.displays))

    async def enqueue_hardware(self, event):
        """Empuja un evento de hardware a la cola FIFO con sello de microsegundos."""
        event = dict(event)
        event["server_us"] = time.time_ns() // 1000
        await self.fifo.put(event)

    async def fifo_consumer(self):
        """Consume la cola FIFO en orden estricto y la reenvía al canal de juego."""
        while not self._shutdown_event.is_set():
            try:
                event = await asyncio.wait_for(self.fifo.get(), timeout=1.0)
                LOG.info("FIFO <- %s (us=%d)", event.get("type"), event.get("server_us"))
                # Aquí se dispatchaba al motor de juego; en MVP se retransmite a displays.
                await self.broadcast({"type": "hardware_event", "event": event})
                self.fifo.task_done()
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                LOG.error("Error en fifo_consumer: %s", e)
                self.fifo.task_done()

    async def handler(self, ws):
        display_id = None
        try:
            async for raw in ws:
                if isinstance(raw, (bytes, str)) and len(raw) > MAX_MESSAGE_SIZE:
                    await ws.send(json.dumps({"type": "error", "msg": "message too large"}))
                    continue
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
                    flask_ok = await self._check_flask_health()
                    await ws.send(json.dumps({
                        "type": "health_ok",
                        "uptime": time.time(),
                        "displays": len(self.displays),
                        "sessions": len(self.play_sessions),
                        "flask": flask_ok,
                    }))
                # --- Health-check mutuo Flask<->WS (Fase 3a) ---
                elif mtype == "ping":
                    await ws.send(json.dumps({
                        "type": "pong",
                        "ts": time.time(),
                        "displays": len(self.displays),
                        "sessions": len(self.play_sessions),
                    }))
                elif mtype == "stats":
                    await ws.send(json.dumps({
                        "type": "stats_result",
                        "ok": True,
                        "displays": len(self.displays),
                        "sessions": len(self.play_sessions),
                        "mobiles": len(self.mobile_clients),
                        "tokens": len(self.tokens),
                    }))
                elif mtype == "engine_stats":
                    await ws.send(json.dumps({
                        "type": "engine_stats_result",
                        "ok": True,
                        "games": len(self.play_sessions),
                        "players": sum(len(s.get("players", {})) for s in self.play_sessions.values()),
                        "leaderboards": sum(len(v) for v in self.leaderboards.values()),
                        "tokens": len(self.tokens),
                    }))
                elif mtype == "list_connections":
                    conns = [
                        {"id": did, "type": "display"}
                        for did in self.displays
                    ]
                    conns.extend(
                        {"id": t[:8] + "...", "type": "mobile", "session": self.mobile_sessions.get(t)}
                        for t in self.mobile_clients
                    )
                    await ws.send(json.dumps({
                        "type": "list_connections_result",
                        "ok": True,
                        "connections": conns,
                    }))
                elif mtype == "disconnect_client":
                    target_id = msg.get("connection_id", "")
                    found = False
                    for did in list(self.displays):
                        if did == target_id or did.startswith(target_id):
                            await self.unregister(did)
                            found = True
                            break
                    if found:
                        await ws.send(json.dumps({"type": "disconnect_client_result", "ok": True}))
                    else:
                        await ws.send(json.dumps({"type": "disconnect_client_result", "ok": False, "error": "not found"}))
                else:
                    await ws.send(json.dumps({"type": "error", "msg": "tipo desconocido: " + str(mtype)}))
        except Exception:
            pass
        finally:
            if display_id:
                await self.unregister(display_id)


    # ===================== LOCAL GAME ENGINE =====================

    async def _check_flask_health(self):
        """Ping Flask server via HTTP to verify dual-process connectivity."""
        import urllib.request
        flask_port = int(os.environ.get("SILLY_PORT", "8080"))
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{flask_port}/api/health",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False

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
        self.mobile_sessions[token] = session_id
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

    async def _disconnect_mobile(self, token):
        """Desconecta un cliente móvil limpiamente."""
        ws = self.mobile_clients.pop(token, None)
        self.heartbeats.pop(token, None)
        self.mobile_sessions.pop(token, None)
        pair = self.tokens.pop(token, (None, None))
        session_id, client_id = pair if isinstance(pair, tuple) else (None, None)
        if session_id and session_id in self.play_sessions:
            self.play_sessions[session_id]["players"][client_id]["connected"] = False
        if ws:
            try:
                await ws.close()
            except Exception:
                pass
        LOG.info("Jugador %s desconectado", token[:8] + "...")

    async def _cleanup_loop(self):
        """Limpieza periódica de estructuras de datos."""
        while not self._shutdown_event.is_set():
            try:
                await asyncio.sleep(60)
                self.rate_limiter.cleanup()
                # Limpieza de tokens expirados
                now = time.time()
                expired = [t for t, (sid, cid) in self.tokens.items() 
                          if t not in self.mobile_clients and t not in self.heartbeats]
                for t in expired:
                    self.tokens.pop(t, None)
                LOG.debug("Limpieza: rate_limiter buckets=%d, tokens=%d", 
                          len(self.rate_limiter.buckets), len(self.tokens))
            except asyncio.CancelledError:
                break
            except Exception as e:
                LOG.error("Error en cleanup_loop: %s", e)

    async def shutdown(self):
        """Apagado graceful del servidor WebSocket."""
        LOG.info("Iniciando apagado graceful del servidor WebSocket...")
        self._shutdown_event.set()
        
        # Cancelar tareas periódicas
        for task in (self._fifo_task, self._heartbeat_task, self._cleanup_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        # Desconectar todos los clientes móviles
        for token in list(self.mobile_clients.keys()):
            await self._disconnect_mobile(token)
        
        # Desconectar displays
        for did, ws in list(self.displays.items()):
            try:
                await ws.close()
            except Exception:
                pass
        
        # Vaciar FIFO
        while not self.fifo.empty():
            try:
                self.fifo.get_nowait()
                self.fifo.task_done()
            except asyncio.QueueEmpty:
                break
        
        LOG.info("Servidor WebSocket detenido correctamente")

    # ===================== HEARTBEAT & RATE LIMIT =====================

    async def heartbeat_loop(self):
        """Envía ping a todos los móviles conectados y desconecta los que no responden."""
        while not self._shutdown_event.is_set():
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if self._shutdown_event.is_set():
                    break
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
                    LOG.warning("Jugador %s desconectado por heartbeat timeout", token[:8] + "...")
                self.rate_limiter.cleanup()
            except asyncio.CancelledError:
                break
            except Exception as e:
                LOG.error("Error en heartbeat_loop: %s", e)

    async def handle_pong(self, token):
        """Registra pong recibido del móvil."""
        if token in self.mobile_clients:
            self.heartbeats[token] = time.time()

    async def rehydrate_leaderboard(self, session_id, metric, leaderboard):
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


async def main_async(host, port):
    server = SyncServer()
    server._fifo_task = asyncio.create_task(server.fifo_consumer())
    server._heartbeat_task = asyncio.create_task(server.heartbeat_loop())
    server._cleanup_task = asyncio.create_task(server._cleanup_loop())
    LOG.info("WebSocket sync escuchando en ws://%s:%d", host, port)
    try:
        async with websockets.serve(server.handler, host, port):
            await server._shutdown_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await server.shutdown()


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
