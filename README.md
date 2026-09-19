# SillyQuiz

**SillyQuiz** — Plataforma para crear **LOCURAS**: cuestionarios, videojuegos locales, carreras aleatorias, quiz shows, batallas 1v1, supervivencia, ruleta... lo que quepa en la cabeza del creador. El límite es el **builder**.

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.0%2B-black)
![License](https://img.shields.io/badge/license-MIT-green)
![Tests](https://img.shields.io/badge/tests-51%20passing-brightgreen)

---

## 🎯 ¿Qué es SillyQuiz?

SillyQuiz **no es solo un programa de trivias**. Es una **plataforma de creación** donde cualquier persona puede construir sus propios modos de juego sin programar, usando un editor visual tipo Scratch (**BuildSilly**).

Cada modo se empaqueta como archivo **`.silly`** (ZIP con bloques + assets) para compartir, vender o descargar de un marketplace futuro.

> **Modelo de adopción**: precio sugerido $10–15 USD. A ese precio la gente masifica sus modos locos y se forma un ecosistema donde unos crean y otros solo descargan.

---

## ✨ Características Principales

### 🖥️ Display en Vivo (Proyección)
Pantalla de proyección con **diseño neo-brutalista**, efectos visuales, animaciones de celebración, confeti, partículas y audio procedural (Web Audio API). Sincronización tiempo real vía **Server-Sent Events (SSE)**.

### 🎨 Sistema de Temas (ThemeEngine)
- Editor visual WYSIWYG completo (color, tipografía, timer, layout, formas, efectos, sonido)
- Temas preset + presets rápidos
- CRUD de temas en JSON (`/api/themes`), preview en vivo y transición sin flash
- **ShapeEngine color-aware**: las formas mutan al cambiar de tema y generan paletas armónicas automáticas

### 🎮 Modos de Juego Incluidos
| Modo | Descripción |
|------|-------------|
| **Preguntas** | Pregunta + opción múltiple (A/B/C) con revelado |
| **Ahorcado**  | Palabras con normalización de acentos           |

### 🔀 Mode Blending
Inicia un **segundo modo en paralelo** (slot `secondary`). Ambos overlays se muestran simultáneamente en el display (ej. Ruleta + Ahorcado). Disponible en la pestaña Modo Presentador.

### 🖵 Multi-Screen + Mapeo de Proyectores (estilo MadMapper)
- Cada proyector abre `http://host:8080/display?screen=N` con su propia configuración
- **Elementos componibles** por pantalla: timer, pregunta, scores, formas, overlays (on/off)
- **Layout por elemento**: posición y tamaño (%) arrastrable en mini-preview
- **Mapeo real de proyectores**:
  - Keystone de 4 esquinas mediante homografía proyectiva (`matrix3d` 3D real)
  - Rotación, zoom, offset X/Y, perspectiva, bezel
  - **Edge blend** por lado (plumado de bordes con máscaras de degradado) para solapar proyectores sin doble imagen
  - **Grupos**: varias pantallas forman una superficie lógica continua
  - Workspace visual con lienzo de arrastre de vértices y sliders en vivo

### 🧩 Modo Builder (Constructor Visual) — **BuildSilly**
Editor tipo **Scratch** para crear modos completos arrastrando bloques, sin programar. Compila a una **máquina de estados AOT** que el backend ejecuta de forma segura y determinista (whitelist de opcodes en `_security.py`).

- **17 categorías** con buscador en vivo
- **Power Pack**: bloques de potencia extrema — matemáticas avanzadas, manipulación de strings, iteración sobre listas, bucles con rango, ranking y puntos en vivo, persistencia en SQLite y efectos de pantalla
- **Vista previa en tiempo real**, exportar/importar JSON y auto-guardado en navegador

> Documentación completa del constructor: `interno/frontend/docs/modo-builder/index.html`

---

## 🚀 Instalación Rápida

### Requisitos
- Python 3.10+
- Navegador moderno (ES Modules, Web Audio, CSS `matrix3d`)

### Pasos
```bash
cd SillyQuiz
pip install -r interno/requirements.txt
python interno/launcher.pyw
```

El launcher (GUI Tkinter) genera un PIN de acceso, inicia Flask (puerto 8080) + WebSocket (puerto 8081) y abre el navegador automáticamente.

### Acceso Rápido

| Pantalla | URL |
|--------------------------|-----|
| Panel de Control         | http://localhost:8080/sillycontrol         |
| Display (pantalla 1)     | http://localhost:8080/display              |
| Display (pantalla N)     | http://localhost:8080/display?screen=N     |
| Constructor (BuildSilly) | http://localhost:8080/html/SillyBuild.html |
| Juego móvil              | http://localhost:8080/play/<client_id>     |
| WebSocket sync           | ws://127.0.0.1:8081                        |

> **Seguridad**: El panel de control requiere PIN de acceso en primer arranque. El PIN se genera automáticamente y se muestra en el launcher.

---

## 🏗️ Arquitectura

```
interno/
  launcher.pyw              # Launcher: genera PIN+secrets, inicia Flask+WS
  config.json               # Configuración única (merge con DEFAULT_CONFIG)
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
    sillycontrol.html       # Panel de control (neo-brutalist)
    displaysilly.html       # Pantalla de proyección (neo-brutalist)
    js/
      scratch-blocks.js     # Registro maestro de opcodes
      scratch-runtime.js    # Ejecutor AOT
      sillycontrol-api.js   # Cliente API (CSRF + auth)
    css/
      design-tokens.css     # Design system unificado (tokens --sq-*)
      control-brutalist.css # Overrides brutalistas panel control
  websocket_server.py       # WS sync server (puerto 8081)
scripts/
  sync_opcodes.js           # Sincroniza opcodes JS → Python
  opcodes_gen.py            # Generado por sync_opcodes.js
tests/
  mode_manager_test.py
  sse_connection_test.py
  security_test.py
```

### Arquitectura Dual-Proceso

SillyQuiz usa **dos procesos** coordinados por el launcher:

1. **Flask + Waitress** (puerto 8080): HTTP API, SSE streaming, panel de control, display
2. **WebSocket + asyncio** (puerto 8081): Sync multi-display, Local Game Engine, heartbeats

Ambos son independientes: Flask funciona sin WS, y el WS puede correr solo. Se comunican via `game_state.db` (SQLite WAL) y eventos SSE. Un health-check en el WS (`type: health_check`) permite monitorear la salud del sync.

---

## 🛠️ Desarrollo

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
- ES Modules en frontend; blueprints/servicios en backend
- **Naming**: inglés para API/Backend, español permitido en UI/textos de usuario
- **Seguridad**: `execute_raw_javascript` e `inject_css_raw` están **BLOQUEADOS** globalmente
- **Opcodes**: `scripts/sync_opcodes.js` es la única fuente de verdad

---

## 🧪 Tests

```bash
python -m pytest tests/ -v
# 51 tests passing (mode_manager, SSE, security, CSRF, auth, rate-limit, input sanitization)
```

---

## 📁 Estructura de Archivos Clave

```
SillyQuiz/
├── README.md                 # Este archivo
├── AGENTS.md                 # Instrucciones para agentes IA
├── DOCUMENTACION.md          # Documentación técnica profunda (español)
├── pytest.ini               # Config pytest
├── ruff.toml                # Config lint/formato
├── requirements.txt         # Deps mínimas (qrcode[pil])
├── interno/
│   ├── requirements.txt     # Deps completas Python
│   ├── launcher.pyw         # Launcher GUI
│   ├── websocket_server.py  # WS Server
│   ├── config.json          # Config runtime
│   ├── silly/               # Backend Flask
│   ├── frontend/            # Frontend (HTML/CSS/JS)
│   └── themes/              # Temas JSON (35+ presets)
├── scripts/                 # Scripts de build/sync
└── tests/                   # Suite pytest (51 tests)
```

---

## 🎨 Design System (Neo-Brutalist)

SillyQuiz usa un **design system unificado** basado en **neo-brutalismo**:

- **Tokens CSS** (`--sq-*`): colores, espaciado, tipografía, sombras, radios, transiciones, z-index
- **Fuentes**: `Space Grotesk` (UI), `Space Mono` (mono/display)
- **Colores base**: Negro `#0B0B0B`, Naranja Silly `#FF5E3A`, Blanco roto `#F2EBDD`
- **Sombras duras**: `4px 4px 0 #0B0B0B` (brutalist), sin blur/glow
- **Esquinas cuadradas**: `border-radius: 0` en bloques, paneles, botones
- **Temas**: Dark (default), Light, Fire, Ocean, Neon, Retro, Nature (forest/ocean)

Archivos clave:
- `interno/frontend/css/design-tokens.css` — Tokens unificados
- `interno/frontend/css/control-brutalist.css` — Overrides panel control
- `interno/frontend/css/sillybuild.css` — Estilos builder
- `interno/frontend/css/themes/theme-brutalist.css` — Tema brutalista

---

## 🔐 Seguridad

- **Autenticación**: PIN + sesión HTTP-only, CSRF double-submit, rate-limit por IP
- **Validación de opcodes**: Whitelist estricta en `_security.py`; opcodes peligrosos bloqueados (`execute_raw_javascript`, `inject_css_raw`)
- **Sanitización**: HTML/JS injection bloqueado en inputs
- **CSP**: Headers estrictos en todas las páginas HTML
- **SQLite WAL**: Base de datos con journaling WAL para concurrencia segura

---

## 📦 Empaquetado (.silly)

Los modos creados en el builder se exportan como **`.silly`** (ZIP):

```
mi-modo.silly/
├── blocks.json      # Definición Scratch (opcodes + args + next)
├── assets/          # Imágenes, audio, fuentes referenciadas
└── manifest.json    # Metadatos: nombre, versión, autor, minVersion
```

El backend valida y sanitiza al importar (`asset-sanitize.js`, `silly-package.js`).

---


**Hecho con 🧠 y ☕ para que cualquiera pueda crear sus propias locuras.**