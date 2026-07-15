# SillyQuiz API Reference

Base URL: `http://localhost:8080/api`

## Authentication

All protected routes require a valid session cookie. If authentication is configured (via `SILLY_PASSWORD_HASH`), unauthenticated requests receive `401` with `{"auth_required": true}` and are redirected to `/login`.

### Login
```
POST /login
Content-Type: application/x-www-form-urlencoded

pin=<6-digit PIN>
```
Sets `silly_session` cookie on success. Redirects to `/sillycontrol/`.

### Logout
```
POST /logout
```
Clears session. Redirects to `/login`.

---

## CSRF Protection

All mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) require an `X-CSRF-Token` header. The token is returned in the `X-CSRF-Token` response header on every HTML response.

```
X-CSRF-Token: <token>
```

Tokens are time-based (1-hour window) and IP-bound.

---

## Rate Limits

| Scope | Limit | Window |
|-------|-------|--------|
| Global (per IP) | 300 req | 60s |
| Sensitive routes (login, import) | 10 req | 60s |

Exceeding limits returns `429` with `{"error": "Rate limit excedido"}`.

---

## Endpoints

### Health Check
```
GET /api/health
```
Returns Flask status and WebSocket reachability.

**Response:**
```json
{
  "flask": "ok",
  "websocket": "ok" | "unreachable",
  "websocket_port": 8081,
  "websocket_latency_ms": 1.2,
  "uptime": 1721000000.0
}
```

---

### Questions (Preguntas)

#### List Questions
```
GET /api/preguntas
GET /api/preguntas?categoria=Ciencia
```
**Response:**
```json
{
  "preguntas": [{"id": 1, "texto": "...", "respuesta": "...", "categoria": "..."}],
  "categorias_disponibles": ["Ciencia", "Historia"]
}
```

#### Create Question
```
POST /api/preguntas
Content-Type: application/json

{
  "texto": "Capital de Francia",
  "respuesta": "Paris",
  "categoria": "Geografia",
  "opciones": ["Paris", "Londres", "Berlin"],
  "respuesta_correcta": 0
}
```
**Response:** `201 Created` with the question object.

#### Edit Question
```
PUT /api/preguntas/<id>
Content-Type: application/json

{"texto": "...", "respuesta": "..."}
```

#### Delete Question
```
DELETE /api/preguntas/<id>
```

#### Export Questions
```
GET /api/preguntas/exportar
```
Returns JSON file download.

#### Import Questions
```
POST /api/preguntas/importar
Content-Type: application/json

{
  "preguntas": [...],
  "modo": "reemplazar" | "agregar"
}
```

---

### Points (Puntos)

#### Add Points
```
POST /api/puntos
Content-Type: application/json

{"grupo": "team1", "cantidad": 10}
```

#### Subtract Points
```
POST /api/puntos/restar
Content-Type: application/json

{"grupo": "team1", "cantidad": 5}
```

#### Reset All Points
```
POST /api/puntos/reset
```

#### Adjust Points (direct set)
```
POST /api/puntos/ajustar
Content-Type: application/json

{"grupo": "team1", "valor": 100}
```

#### Patch Points
```
PATCH /api/grupos/<key>/puntos
Content-Type: application/json

{"cantidad": 25}
```

---

### Groups (Grupos)

#### Configure Groups
```
POST /api/grupos/config
Content-Type: application/json

{
  "grupos": [
    {"key": "team1", "nombre": "Equipo Rojo", "color": "#FF0000"},
    {"key": "team2", "nombre": "Equipo Azul", "color": "#0000FF"}
  ]
}
```

---

### Game State

#### Get Current State
```
GET /api/estado-actual
```
Returns full game state snapshot (mode, timer, scores, display config).

#### Exit All Modes
```
POST /api/salir
```
Stops active mode, resets timer and overlays.

#### Activity Log
```
GET /api/actividad
```

---

### Display

#### Set Theme
```
POST /api/display/theme
Content-Type: application/json

{"theme": "dark"}
```
Valid themes: `default`, `light`, `dark`, `fire`, `ocean`, `brutalist`

#### Toggle Kiosk Mode
```
POST /api/display/kiosko
Content-Type: application/json

{"active": true}
```

#### Toggle Animations
```
POST /api/display/animations
Content-Type: application/json

{"disabled": true}
```

#### Black Screen
```
POST /api/display/black-screen
Content-Type: application/json

{"active": true}
```

#### Reset Overlays
```
POST /api/display/reset-overlays
```

---

### SSE Stream

```
GET /api/stream
```
Server-Sent Events stream for real-time state updates. Returns `text/event-stream`.

Events: `state:snapshot`, state change notifications, timer ticks.

---

### Server Control

#### Shutdown Server
```
POST /api/shutdown
```

---

## WebSocket (ws://localhost:8081)

The WebSocket server handles display sync, player connections, and game sessions. All messages are JSON.

### Display Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `register` | Client→Server | Register a display |
| `payload` | Client→Server | Send display update |
| `sync_clock` | Client→Server | Request server timestamp |
| `clock` | Server→Client | Server timestamp response |
| `builder_state` | Client→Server | Forward editor state to displays |

### Game Session Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `play_register` | Client→Server | Create game session |
| `play_connect` | Client→Server | Player joins with token |
| `play_event` | Client→Server | Report game event |
| `play_leaderboard` | Client→Server | Request leaderboard |
| `health_check` | Client→Server | Ping Flask + WS status |
| `health_ok` | Server→Client | Health check response |

### JWT Tokens

Player tokens are JWTs signed with `JWT_SECRET` env var. Tokens expire after 8 hours. The server is authoritative — client IDs are assigned by the server via token, never by the client.

---

## Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...`

---

## Opcodes Whitelist (Builder)

The visual builder compiles to a whitelist of ~280 opcodes defined in `scripts/opcodes_gen.py` and `_security.py`. Dangerous opcodes (`execute_raw_javascript`, `inject_css_raw`) are explicitly blocked and cannot be used in production.
