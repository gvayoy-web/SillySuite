# SillyQuiz

**SillyBuilder** — Plataforma para crear LOCURAS: cuestionarios, videojuegos locales, carreras aleatorias, quiz shows, batallas 1v1, supervivencia, ruleta... lo que quepa en la cabeza del creador. El limite es el builder.

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.0%2B-black)
![License](https://img.shields.io/badge/license-MIT-green)

## Caracteristicas

### Display en Vivo
Pantalla de proyeccion con efectos visuales neo-brutalistas, animaciones de celebracion, confeti, particulas y sonido procedural (Web Audio API). Sincronizacion en tiempo real via Server-Sent Events (SSE).

### Sistema de Temas (ThemeEngine)
- Editor visual WYSIWYG completo (color, tipografia, timer, layout, formas, efectos, sonido).
- Temas preset + presets rapidos.
- CRUD de temas en JSON (`/api/themes`), preview en vivo y transicion sin flash.
- Las formas (`ShapeEngine`) son **color-aware**: mutan al cambiar de tema y generan paletas armonicas automaticas.

### Modos de Juego
- **Preguntas** — Pregunta + opcion multiple (A/B/C) con revelado.
- **Ruleta** — Categorias con rueda animada (canvas).
- **Ahorcado** — Palabras con normalizacion de acentos.
- **Memoria** — Pares de preguntas/respuestas.
- **Tiempo** — Timer + leaderboard.
- **Batalla 1v1** — Dos equipos compiten por ronda.
- **Supervivencia** — Eliminacion progresiva.
- **Quiz Show** — Votacion de la mayoria.
- **Rapid Fire** — Racha con bonus progresivo por aciertos consecutivos.
- **Team Vs IA** — Un equipo vs IA con precision configurable.
- **Jeopardy** — Tablero 5x4 generado desde las categorias.

### Mode Blending
Inicia un **segundo modo en paralelo** (slot `secondary`). Ambos overlays se muestran simultaneamente en el display (ej. Ruleta + Ahorcado). Disponible en la pestaña Modo Presentador.

### Multi-Screen + Mapeo de Proyectores (estilo MadMapper)
- Cada proyector abre `http://host:8080/display?screen=N` con su propia configuracion.
- **Elementos componibles** por pantalla: timer, pregunta, scores, formas, overlays (on/off).
- **Layout por elemento**: posicion y tamano (%) arrastrable en mini-preview.
- **Mapeo real de proyectores**:
  - **Keystone de 4 esquinas** mediante homografia proyectiva (`matrix3d` 3D real).
  - Rotacion, zoom, offset X/Y, perspectiva, bezel.
  - **Edge blend** por lado (plumado de bordes con mascaras de degradado) para solapar proyectores sin doble imagen.
  - **Grupos**: varias pantallas forman una superficie logica continua.
  - Workspace visual con lienzo de arrastre de vertices y sliders en vivo.

### Modo Presentador
- Controles rapidos (anterior/siguiente, correcto/incorrecto, revelar, pausar).
- **Preview "Siguiente Pregunta"** sin proyectarla.
- **Teleprompter** a pantalla completa (pregunta gigante + respuesta revelable).
- **Boton Emergencia**: pantalla negra + timer 30s.

### Modo Builder (Constructor Visual)
Editor tipo **Scratch** para crear modos completos arrastrando bloques, sin programar. Compila a una maquina de estados **AOT** que el backend ejecuta de forma segura y determinista (whitelist de opcodes en `_security.py`).

- **17 categorias** con buscador en vivo.
- **Power Pack**: bloques de potencia extrema — matematicas avanzadas, manipulacion de strings, iteracion sobre listas, bucles con rango, ranking y puntos en vivo, persistencia en SQLite y efectos de pantalla.
- **Vista previa en tiempo real**, exportar/importar JSON y auto-guardado en navegador.

> Documentacion completa del constructor: `frontend/docs/modo-builder/index.html`

## Instalacion

### Requisitos
- Python 3.10+
- Navegador moderno (ES Modules, Web Audio, CSS `matrix3d`)

### Pasos
```bash
cd SillyQuiz
pip install -r interno/requirements.txt
python interno/launcher.pyw
```

### Acceso

| Pantalla | URL |
|----------|-----|
| Panel de Control | http://localhost:8080/control |
| Display (pantalla 1) | http://localhost:8080/display |
| Display (pantalla N) | http://localhost:8080/display?screen=N |
| Constructor (BuildSilly) | http://localhost:8080/html/buildsilly.html |
| Juego movil | http://localhost:8080/play/<client_id> |
| WebSocket sync | ws://127.0.0.1:8081 |

> **Seguridad**: El panel de control requiere un PIN de acceso en primer arranque. El PIN se genera automaticamente y se muestra en el launcher.

## Arquitectura

```
interno/
  launcher.pyw              # Launcher: genera PIN+secrets, inicia Flask+WS
  config.json               # Configuracion unica (merge con DEFAULT_CONFIG)
  silly/
    app.py                  # Flask factory + registro de blueprints/servicios
    globals.py              # DependencyContainer (tipado)
    blueprints/
      _security.py          # Auth (PIN+session), CSRF, rate-limit, opcodes
      api.py                # API REST principal
      control.py            # Panel de Control SPA
      display.py            # Rutas de display
      ...
    modes/                  # BaseMode + implementaciones
    services/               # SSE (EventBus), persistence, theme_service, audit
  frontend/
    sillycontrol.html       # Panel de control
    displaysilly.html       # Pantalla de proyeccion
    js/
      scratch-blocks.js     # Registro maestro de opcodes
      scratch-runtime.js    # Ejecutor AOT
      sillycontrol-api.js   # Cliente API (CSRF + auth)
    css/
  websocket_server.py       # WS sync server (puerto 8081)
scripts/
  sync_opcodes.js           # Sincroniza opcodes JS -> Python
  opcodes_gen.py            # Generado por sync_opcodes.js
tests/
  mode_manager_test.py
  sse_connection_test.py
  security_test.py
```

### Dual-Process Architecture

SillyQuiz usa **dos procesos** coordinados por el launcher:

1. **Flask + Waitress** (port 8080): HTTP API, SSE streaming, panel de control, display.
2. **WebSocket + asyncio** (port 8081): Sync multi-display, Local Game Engine, heartbeats.

Ambos son independientes: Flask funciona sin WS, y el WS puede correr solo. Se comunican via `game_state.db` (SQLite WAL) y eventos SSE. Un health-check en el WS (`type: health_check`) permite monitorear la salud del sync.

## Desarrollo

### Comandos
```bash
# Python
pip install -r interno/requirements.txt
python -m pytest tests/ -v

# JavaScript (sintaxis)
node --check interno/frontend/js/scratch-blocks.js

# Lint
ruff check interno/ tests/
ruff format --check interno/ tests/

# Regenerar opcodes
node scripts/sync_opcodes.js
```

### Convenciones
- ES Modules en frontend; blueprints/servicios en backend.
- **Naming**: ingles para API/Backend, espanol permitido en UI/textos de usuario.
- **Seguridad**: `execute_raw_javascript` y `inject_css_raw` estan BLOQUEADOS globalmente.
- **Opcodes**: `scripts/sync_opcodes.js` es la fuente unica de verdad.

## Licencia
MIT
