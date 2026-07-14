# LOGOSKQUIZ 🏆

**Campeonísimo Bíblico** — Sistema profesional de competencia bíblica con display visual en tiempo real, panel de control avanzado, múltiples modos de juego, sistema de temas, mapeo de proyectores estilo MadMapper y modo presentador.

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.0%2B-black)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Características

### 🎬 Display en Vivo
Pantalla de proyección con efectos visuales neo-brutalistas, animaciones de celebración, confeti, partículas y sonido procedural (Web Audio API). Sincronización en tiempo real vía Server-Sent Events (SSE).

### 🎛 Sistema de Temas (ThemeEngine)
- Editor visual WYSIWYG completo (color, tipografía, timer, layout, formas, efectos, sonido).
- 5 temas preset (Oscuro, Fuego, Océano, Neon, Bosque) + presets rápidos (Estrellado, Bosque, Atardecer, etc.).
- CRUD de temas en JSON (`/api/themes`), preview en vivo y transición sin flash.
- Las formas (`ShapeEngine`) son **color-aware**: mutan al cambiar de tema y generan paletas armónicas automáticas.

### 🕹 Modos de Juego
- ❓ **Preguntas** — Pregunta + opción múltiple (A/B/C) con revelado.
- 🎰 **Ruleta de Alabanzas** — Categorías con rueda animada (canvas).
- 🪢 **Ahorcado Bíblico** — Palabras bíblicas con normalize de acentos.
- 🧠 **Memoria** — Pares de preguntas/respuestas.
- ⏱ **Tiempo (Versos)** — Timer + leaderboard.
- ⚔️ **Batalla 1v1** — Dos equipos compiten por ronda.
- 💀 **Supervivencia** — Eliminación progresiva.
- 🎬 **Quiz Show** — Votación de la mayoría.
- ⚡ **Rapid Fire** — Racha con bonus progresivo por aciertos consecutivos.
- 🤖 **Team Vs AI** — Un equipo vs IA con precisión configurable.
- 📊 **Jeopardy** — Tablero 5×4 generado desde las categorías.

### 🔀 Mode Blending
Inicia un **segundo modo en paralelo** (slot `secondary`). Ambos overlays se muestran simultáneamente en el display (ej. Ruleta + Ahorcado). Disponible en la pestaña Modo Presentador.

### 🖵 Multi-Screen + Mapeo de Proyectores (estilo MadMapper)
- Cada proyector abre `http://host:5000/display?screen=N` con su propia configuración.
- **Elementos componibles** por pantalla: timer, pregunta, scores, formas, overlays (on/off).
- **Layout por elemento**: posición y tamaño (% ) arrastrable en mini-preview.
- **Mapeo real de proyectores**:
  - **Keystone de 4 esquinas** mediante homografía proyectiva (`matrix3d` 3D real).
  - Rotación, zoom, offset X/Y, perspectiva, bezel.
  - **Edge blend** por lado (plumado de bordes con máscaras de degradado) para solapar proyectores sin doble imagen.
  - **Grupos**: varias pantallas forman una superficie lógica continua.
  - Workspace visual "🗺️ Mapeo" con lienzo de arrastre de vértices y sliders en vivo.

### 🎤 Modo Presentador
- Controles rápidos (anterior/siguiente, correcto/incorrecto, revelar, pausar).
- **Preview "Siguiente Pregunta"** sin proyectarla.
- **Teleprompter** a pantalla completa (pregunta gigante + respuesta revelable).
- **Botón Emergencia**: pantalla negra + timer 30s.
- Timer custom y escenas rápidas.

### 📊 Exportación y Persistencia
- Resultados en JSON / CSV / HTML / imagen.
- Backup automático de `pym.json` y guardado atómico.

### 🧱 Modo Builder (Constructor Visual)

Editor tipo **Scratch** para crear modos completos arrastrando bloques, sin programar. Compila a una máquina de estados **AOT** que el backend ejecuta de forma segura y determinista (whitelist de opcodes en `_security.py`).

- **Paleta por categorías** con buscador en vivo (`🔍 Buscar bloque`).
- **13 categorías**: Eventos, Control, Looks, Audio, NDI, Multi-Display, Quiz, Estado/Variables, Operadores, Listas, Concursantes, Query Engine y Runtime.
- **Power Pack ⚡**: bloques de potencia extrema — matemáticas avanzadas (`math_unary`/`math_binary`), manipulación de strings, iteración real sobre listas (`for_each_in_list`, `list_sort`, `list_shuffle`), bucles con rango (`repeat_for_range`) y control de salida (`exit_loop`/`continue_loop`), ranking y puntos en vivo (`quiz_get_player_rank`, `players_get_rank`), persistencia en SQLite (`state_set_persistent`/`state_load_persistent`) y efectos de pantalla (`screen_flash`, `screen_shake`, `announce`).
- **Vista previa en tiempo real**, exportar/importar JSON y auto-guardado en navegador.

> 📚 Documentación completa del constructor: `frontend/docs/modo-builder/index.html` (Centro de soporte) y `…/tutorial.html` (tutorial + referencia de bloques Power Pack).

## 🚀 Instalación

### Requisitos
- Python 3.10+
- Navegador moderno (ES Modules, Web Audio, CSS `matrix3d`)

### Pasos
```bash
cd LogosKQuiz
pip install -r requirements.txt
python interno/apps/app.py
```

### Acceso
| Pantalla | URL |
|----------|-----|
| Panel de Control | http://localhost:5000/control |
| Display (pantalla 1) | http://localhost:5000/display |
| Display (pantalla N) | http://localhost:5000/display?screen=N |

> 💡 Abre el control y el/los display(s) en ventanas o dispositivos distintos. Para mapeo multi-proyector, asigna un `?screen=N` a cada proyector y configúralo en la pestaña 🗺️ Mapeo.

## 🗺️ Mapeo de Proyectores — Guía Rápida
1. En el panel, ve a **🗺️ Mapeo**.
2. Selecciona la pantalla a calibrar.
3. Arrastra los 4 círculos de las esquinas sobre el preview para corregir la distorsión del proyector (keystone real).
4. Ajusta **Edge Blend** (top/right/bottom/left) en px donde dos proyectores se solapan.
5. Asigna un **Grupo** a pantallas que forman una superficie continua.
6. Guarda (auto-guardado al soltar). El display aplicará la transformación al instante.

## 🔀 Mode Blending — Guía Rápida
1. En **🎤 Presentador**, sección "🔀 Mode Blending".
2. Elige un 2º modo y pulsa "▶ Iniciar 2º modo".
3. Ambos modos corren a la vez en el display.

## 🧱 Arquitectura
```
interno/
  apps/
    app.py                 # Factory Flask + registro de blueprints/servicios
    globals.py             # DependencyContainer
    models/                # AppState, Cronometro
    modes/                 # BaseMode + implementaciones (preguntas, ruleta, ...)
    blueprints/            # API REST (api, quiz, display, timer, modes, themes, export, config)
    services/              # SSE (EventBus), persistence, theme_service, logger, concurrency
  frontend/
    display.html           # Pantalla de proyección
    control.html           # Panel de control
    css/                   # display-base, overlays, control, temas
    js/                    # display-state, display-config (ThemeEngine), display-shapes2 (ShapeEngine),
                           # display-screens (compositor), display-modes, control-core, control-api, ...
```

## 🧪 Desarrollo
- Verificar JS: `node --check interno/frontend/js/<archivo>.js`
- Endpoints: probados vía Flask `test_client` (ver ejemplos en sesiones de migración).
- Convenciones: ES Modules en frontend; blueprints/servicios en backend; nombres mezcla español/inglés.

## 📜 Licencia
MIT
