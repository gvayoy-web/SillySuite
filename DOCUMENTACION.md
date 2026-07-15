# DOCUMENTACIÓN TÉCNICA — SILLYQUIZ

> **Qué ES SillyQuiz (la visión)**
> SillyQuiz no es "un programa de trivias": es una **plataforma para que cualquier persona cree LOCURAS**. Un modo en SillyQuiz puede ser desde un sistema de preguntas y respuestas, hasta un **videojuego local donde la gente juega desde sus celulares**, una **carrera de caballos aleatoria**, un quiz show, un modo batalla 1v1, supervivencia, ruleta… lo que le quepa en la cabeza al creador. El límite es el builder.
>
> Por eso se llama *SillyQuiz* y por eso los modos se empaquetan con la extensión **`.silly`**: para que la gente comparta, venda y descargue "locuras" ajenas.
>
> **Modelo de negocio / adopción**
> Idea de venta a **$10–$15 USD**. A ese precio la gente masifica sus modos locos y se forma un ecosistema/marketplace donde unos crean y otros solo descargan.
>
> **Por qué existe (la historia)**
> El profesor de Informática, el primer día de clases, usó un programa para hacernos quiz: **Wordwall** "en abrecajas". Era feo, poco personalizable, y tuvo un problema real: al no poder elegir los tiempos, tenía que reiniciarlos y las preguntas se mezclaban — un solo desastre. Hoy, con SillyQuiz, él (o cualquiera) puede **crear su propio sistema de trivias**, **pedírselo a una IA**, o **descargarlo de internet con un par de clics**. Cero mezcla de preguntas, tiempos a la medida.

---

## Arquitectura general

- **Backend**: Flask + Waitress (Python), modular (blueprints + services).
- **Frontend**: HTML/CSS/JS de módulos ES. Pantalla de proyección en vivo + panel de
  control + constructor visual tipo Scratch + página móvil de juego.
- **Tiempo real**: SSE (Server-Sent Events) para empujar estado al display; un
  servidor WebSocket aparte para sincronizar pantallas y celulares (Local Game Engine
  autoritativo).
- **Persistencia**: `pym.json` (estado del usuario) + `game_state.db` (SQLite WAL) para
  sesiones y marketplace de modos.

URLs:
- Panel de Control: `http://localhost:8080/control`
- Display pantalla N: `http://localhost:8080/display?screen=N`
- Constructor (BuildSilly): `http://localhost:8080/html/buildsilly.html`
- Juego móvil: `http://localhost:8080/play/<client_id>`
- WebSocket de sync: `ws://127.0.0.1:8081`

> **Nota sobre el contenido actual**: el contenido por defecto que trae el código hoy
> está tematizado como ejemplo genérico. Eso es solo **contenido de ejemplo/default**; el motor, los modos y el builder son 100%
> genéricos y están hechos para cualquier locura que el usuario quiera montar.

================================================================================
RAÍZ DEL PROYECTO (SillyQuiz/)
================================================================================

README.md
  - Para qué sirve: Portada del repo. Explica características, arquitectura, mapeo de
    proyectores, mode blending y el constructor.
  - Estética: Markdown con badges, emojis y bloques de código.

requirements.txt
  - Dependencias Python (flask, waitress, flask_cors, websockets, jsonschema, Pillow,
    pystray…). Instaladas por el launcher y por CI.

pytest.ini
  - Configuración de pytest (testpaths=tests, marcadores slow/integration/unit).

JUGAR.spec
  - Receta PyInstaller para empaquetar `launcher.pyw` como ejecutable de escritorio
    (Windows) que la gente pueda instalar y abrir como cualquier app.

sillyquiz.ico
  - Icono de la app (logo "SQ"). Binario.

competencia.log / game_state.db
  - Log de runtime y base de datos SQLite (sesiones, eventos SSE, templates, marketplace).

.github/workflows/ci.yml
  - CI: tests Python (3.9–3.12), tests JS (Node 18/20/22), validación de templates y
    escaneo de seguridad.

.github/workflows/modes-compile.yml
  - Valida/compila todos los templates de modos (`scripts/compile_modes.py`) cuando
    cambian en `interno/modo_templates` y sube el artefacto compilado.

================================================================================
interno/ — Núcleo del servidor
================================================================================

launcher.pyw
  - Para qué sirve: Lanzador de escritorio (GUI tkinter + bandeja pystray). Arranca el
    servidor Flask (8080) y el WebSocket (8081), abre el navegador, instala dependencias
    faltantes, asegura instancia única y da botones Iniciar/Detener + accesos rápidos.
    Es el "doble clic" que cualquier usuario final usará para encender SillyQuiz.
  - Estética (código): paleta de marca (fondo #0d0f14, primario teal #00d4aa, acento
    púrpura #7c3aed). Botones ModernButton con hover/press, tipografía Segoe UI /
    Consolas. Interfaz oscura y moderna.

websocket_server.py
  - Para qué sirve: Servidor de sincronización multi-display (asyncio + websockets,
    puerto 8081). Mantiene pantallas esclavas, cola FIFO de eventos de hardware
    (pulsadores) con sello de microsegundos, relojes sincronizados, y un **Local Game
    Engine autoritativo en RAM** (sesiones, tokens JWT, rate-limit, heartbeats,
    leaderboard). Aquí es donde, por ejemplo, los celulares de los jugadores empujan
    eventos y el servidor decide el ranking sin que el cliente pueda hacer trampa.
  - Estética (código): Python async, docstring técnico en español, énfasis en seguridad
    (JWT HMAC-SHA256, FIFO estricto, rate-limit por token).

config.json
  - Configuración principal (marca, juego, grupos, categorías, ruleta, modos, display,
    rotación de temas, puertos, formatos de media). Se fusiona con DEFAULT_CONFIG.
  - Estética: JSON legible.

pym.json
  - Estado persistente del usuario (banco de preguntas, puntos, display_config con todos
    los efectos/temas/pantallas). Se respalda automáticamente.
  - Estética: JSON.

*.log / *.out
  - Registros de arranque/servidor/SSE para diagnóstico.

================================================================================
interno/silly/ — Aplicación Flask (backend)
================================================================================

app.py
  - Fábrica Flask. Carga config/preguntas, crea AppState, ModeManager, Cronómetro,
    ThemeEngine, SoundService, EventBus; registra los modos estáticos; inyecta todo en
    el contenedor de dependencias; registra blueprints; aplica middlewares (seguridad,
    rate-limit global, logging de requests). Sirve con waitress (100 hilos).

globals.py
  - Contenedor de dependencias compartido (DependencyContainer).

config_loader.py
  - Carga/fusiona config.json sobre DEFAULT_CONFIG y carga preguntas desde pym.json.

game_state_manager.py
  - Persistencia centralizada en SQLite (WAL): sesiones, eventos SSE, metadata de
    templates, ratings y modos de marketplace. Atómico y thread-safe.

template_engine.py
  - Instancia modos dinámicos desde templates (template + config usuario -> DynamicMode
    ejecutable). Valida tipos/rangos/enum y mergea configs.

template_registry.py
  - Registro centralizado de templates (base/community/scratch), validación JSON Schema,
    versionado, búsqueda y sync con BD.

communication_manager.py
  - Comunicación híbrida SSE (push) + REST (acciones), compatible con Waitress.

--- interno/silly/blueprints/ (API REST por dominio) ---

_security.py — middlewares: cabeceras HTTP (CSP, etc.), tokens CSRF, rate limiting.
asset_sanitizer.py — validación estricta por magic-bytes (anti-malware) para importar
  modos `.silly`/`.lkqmode` sin riesgo.
api.py — /api: CRUD de preguntas, estado actual, acciones generales.
quiz.py — /api: pregunta actual, mostrar respuesta/opciones, selección.
display.py — /api/display: tema, kiosko, animaciones, reset overlays.
timer.py — /api: control del cronómetro (el usuario ELIGE los tiempos — justo lo que le
  faltaba al profesor con Wordwall).
modes.py — /api: reset-todo, iniciar/detener modo (slot primary/secondary), mode blending.
config.py — /api: lectura/escritura de config y categorías.
export.py — /api/exportar: resultados en JSON / CSV / HTML / imagen.
themes.py — /api/themes: CRUD de temas, rotación y multi-screen.
sounds.py — /api/sounds: subida/servido/mapeo de audio (sfx/music/ambient/voice).
mode_packages.py — /api/mode-packages: **import/export de modos `.lkqmode` (ZIP
  sanitizado, anti zip-slip)** — el mecanismo de "descargar una locura con un par de
  clics".
engine.py — /api/engine: REST del Local Game Engine (register/event/leaderboard).
play_routes.py — /play/<client_id>: **página móvil de juego** (HTML inline) donde la
  gente juega desde el celular.
qr_routes.py — /api/qr: genera QR de acceso (para que los jugadores entren rápido).
templates.py — /api/templates: gestión de templates y modos dinámicos.
communication.py — /api/comm: stream SSE y stats de conexiones.
docs.py — /docs/<pagina>: documentación estática del builder.
sync_bridge.py — puente HTTP (Flask) -> servidor WebSocket de sync.
static.py — rutas estáticas /css, /js, media y QR.

  Estética (código): Blueprint por dominio, jsonify, notificación vía EventBus (SSE).

--- interno/silly/models/ ---

state.py — AppState: estado central en memoria (preguntas, puntos, timer, display_config
  con todos los efectos, actividad, snapshot thread-safe).
cronometro.py — Cronómetro thread daemon con on_tick/on_timeout.
dynamic_mode.py — DynamicMode: modo dinámico instanciado desde template, con lifecycle,
  componentes (Preguntas/Timer/Scoring/Audio/Visual), eventos y timer loop.

--- interno/silly/modes/ (modos de juego estáticos) ---

base.py — BaseMode: clase base abstracta.
questions.py — QuestionsMode: preguntas + opción múltiple (A/B/C) con revelado.
roulette.py — RouletteMode: ruleta con categorías y rueda animada.
hangman.py — HangmanMode: ahorcado con normalización de acentos.
verses.py — VersesMode: modo Tiempo con timer + leaderboard.
  (Estos son los modos "de ejemplo"; el builder permite crear modos totalmente nuevos
  y locos sin tocar Python.)

--- interno/silly/services/ ---

sse.py — EventBus: suscriptores SSE y notificación de snapshots completos.
theme_service.py — ThemeService + ThemeRotationManager: 25 temas preset, rotación,
  blending, lectura/escritura de themes JSON.
sound_service.py — SoundService: audio procedural y subido (4 canales), mapeo por evento.
persistence.py — guardar_datos / crear_backup / _persist_and_notify (escritura atómica).
audit.py — AuditLogger: auditoría y métricas del editor de modos.
logger.py — setup_logging: logging estructurado (texto o JSON).
stats_service.py — StatsService: recopila/analiza eventos de juego.

================================================================================
interno/frontend/ — Interfaz web
================================================================================

displaysilly.html
  - Pantalla de proyección en vivo (lo que ve el público). Recibe estado por SSE y
    renderiza pregunta, opciones, scores, timer, ruleta, ahorcado, tiempo, batalla,
    supervivencia, quiz show, ganador, resultados, pantalla negra, etc.
  - Estética (visual): Neo-brutalista épico. Tipografías Inter, Space Grotesk, Cinzel,
    Playfair, Lora. Fondo azul rey con gradientes radiales animados, esquinas
    decorativas (✧✦◇◆), text-shadow duro 4px/8px negro, mayúsculas, confeti/canvas de
    celebración, overlays "¡CORRECTO!", "RONDA FINAL", pantalla de bienvenida. Monitor
    de carga y overlay de reconexión si SSE falla.

sillycontrol.html
  - Panel de control (lo que usa el anfitrión/creador). Sidebar con pestañas:
    Dashboard, Preguntas, Ahorcado, Grupos, Pantallas, Editor de Temas, Presentador,
    Modos (Builder), Canva, Config. Incluye mapeo de proyectores, mode blending, editor
    WYSIWYG de temas y teleprompter.
  - Estética (visual): Brutalista oscuro. Paleta #0b0b0b/#161616, acento azul #2b50ff y
    amarillo #ffd400, sombras duras 4px, sin border-radius, monoespaciado Space Mono +
    Inter, rejilla de fondo, tarjetas numeradas, botones cuadrados. Versión "light" de
    alto contraste y HUD con dot de estado. Responsive.

html/buildsilly.html
  - Constructor visual de modos estilo Scratch (BuildSilly). Carga los scripts del
    editor de bloques y muestra la bienvenida "⚡ SILLY PACK".
  - Estética (visual): fondo claro roto (#ECEAE3) con gradientes radiales púrpura/teal,
    tipografía Bangers, spinner de carga. Estilo "constructor" amigable.

quiz-renderer.js
  - Script clásico que renderiza quizzes en displays; puente con los módulos ES.

css/design-tokens.css
  - Sistema unificado de variables de diseño (colores, sombras, tipografía, espaciado,
    radios, transiciones, timers, shapes, texturas) + temas dark/fire/ocean/light.
  - Estética: identidad "lzq" (azul #001144, acento púrpura #7C3AED, grupos en
    magenta/amarillo/naranja/verde), sombras duras, ruido SVG sutil.

css/display-base.css
  - Estilos base del display: variables por modo, animaciones de eventos
    (correcto/incorrecto/final/penalización/racha/timer), fondos dinámicos,
    decoraciones, score-cards animados, efectos ambientales (estrellas/niebla/rayos/
    dorado/confeti/fuegos) y transiciones de tema/modo (fade/flash/wave/glitch/rotation).

css/control.css
  - Estilos del panel de control brutalista (ver sillycontrol.html).

css/control-brutalist.css — variante más intensa.
css/display-mcq.css, display-memory.css, display-overlays.css, display-robust.css —
  estilos específicos (opción múltiple, memoria, overlays, fallback).
css/modo-builder.css, preview-engine.css, dynamic-tabs.css, template-gallery.css,
ndi-panel.css, scratch-*.css — estilos del constructor visual.

css/themes/theme-dark.css, theme-fire.css, theme-ocean.css — hojas de tema del display.

js/ (módulos ES)
  - display-state.js: orquestador del display (SSE + render).
  - display-config.js: ThemeEngine/ShapeEngine en JS (aplica temas, transiciones,
    efectos por evento).
  - display-shapes2.js (SM): motor de formas "color-aware" que mutan con el tema.
  - display-scores.js, display-anim.js, display-roulette.js, display-modes.js,
    display-screens.js (compositor multi-pantalla), display-sound.js (Web Audio API),
    display-utils.js, display-manager.js.
  - sillycontrol-core.js, sillycontrol-api.js: lógica del panel (ctrl.*) y llamadas API.
  - scratch-*.js, buildsilly.js, buildsilly-v2.js, preview-engine.js,
    template-gallery.js, dynamic-tabs.js, ndi-*.js, quiz-blocks.js: constructor visual
    (Scratch) y galería de modos.

html/templates/ — plantillas del builder.
docs/modo-builder/ — centro de soporte y tutorial del constructor (HTML).

================================================================================
interno/themes/ — Biblioteca de temas (JSON)
================================================================================

35 archivos `.json` de temas presets: fantasy-*, festive-*, nature-*,
modern-*, más fuego/océano/bosque/oscuro/neón y test-theme.

  - Para qué sirve: cada tema define colores, tipografía, timer, layout, shapes,
    efectos y sonido; el editor WYSIWYG los crea/modifica y el display los aplica sin
    flash. Así el creador pone la estética de su "locura" en segundos.
  - Estética de los temas: neón púrpura (#a855f7), fuego rojo/naranja, océano azul
    cian, bosque verde, festivo multicolor. Todos con
    bg_gradient, glow, sombras y formas.

================================================================================
interno/modo_templates/ — Plantillas de modos (el catálogo de locuras)
================================================================================

base/ — 10 templates base (battle-simple, hunter-mode, memory-game, memory-pairs,
  quiz-basic, quiz-questions, quiz-show, story-mode, survival-simple, timing-basic).
community/ — templates de comunidad (featured/popular/trending/user_templates).
compiled/ — all_modes.json (artefacto compilado por CI).
scratch/ — 10 plantillas en formato Scratch (heads + cadenas de bloques): battle_1v1,
  bienvenida_color, encuesta_satisfaccion, neon_cyber_quiz, quiz_capitales, quiz_show,
  quiz_show_glam, rapid_fire, survival_mode, trivia_si_no.

  - Para qué sirve: catálogo de modos que el builder instancia y el usuario personaliza
    o comparte. Es la semilla del marketplace de "locuras".
  - Estética (datos): JSON con id/nombre/icono/categoría/componentes/atributos y cadenas
    de bloques opcode por "next".

interno/modo_uploads/ — uploads de usuario (audio/, exports/, images/) — vacíos.
interno/sounds/sounds/ — biblioteca de audio subida — vacío (gitignored).
interno/static/images/ — modo_iconos/ y previews/ — vacíos.
interno/logs/ — logs de auditoría — vacío en repo.
interno/migrations/001_game_state_schema.sql — esquema SQLite WAL de game_state.db.

================================================================================
scripts/ — Herramientas de compilación/validación
================================================================================

compile_modes.py — valida y compila todas las plantillas de modos; verifica cadenas de
  bloques contra la whitelist de opcodes; genera artefacto compilado.
fix_templates.py — reescribe los templates scratch con JSON válido.
opcodes_gen.py — ARCHIVO GENERADO: lista VALID_SCRATCH_OPCODES sincronizada desde JS.
sync_opcodes.js — fuente única de verdad: lee el REGISTRY de scratch-blocks.js y vuelca
  todos los opcodes a opcodes_gen.py (evita desincronización JS/Python).

================================================================================
tests/ — Pruebas automatizadas
================================================================================

mode_manager_test.py — tests de ModeManager.
mode_package_smoke.py — smoke test de import/export de modos empaquetados.
sse_connection_test.py — test de conexión SSE.
scratch-renderer.test.js — test JS del renderizador Scratch (CI con node).

================================================================================
RESUMEN DE ESTÉTICAS
================================================================================

1) Display (displaysilly.html + display-base.css): Neo-brutalismo épico. Azul rey,
   púrpura, dorado; texto uppercase con sombras duras; confeti, glow, formas flotantes,
   rueda de ruleta, ahorcado SVG, overlays de celebración.

2) Panel de Control (sillycontrol.html + control.css): Brutalismo oscuro plano. #0b0b0b
   con acento azul #2b50ff / amarillo; sin bordes redondeados; sombras 4px;
   monoespaciado; tarjetas numeradas; HUD y sidebar de iconos. Modo claro disponible.

3) Constructor / Canva (buildsilly.html + scratch-*.css): estilo "constructor" amigable
   sobre fondo claro roto con gradientes púrpura/teal y tipografía Bangers.

4) Temas JSON: 35 presets (neón, fuego, océano, bosque, litúrgico, festivo, moderno),
   todos con gradientes, glow y formas coherentes.

5) Launcher: GUI tkinter oscura con marca teal/verde (#00d4aa) y púrpura, minimalista.

================================================================================
MAPA "DE LOCURA A CÓDIGO" (ejemplos de uso)
================================================================================

- "Videojuego local donde la gente juega en sus celulares"
  → play_routes.py (página móvil) + websocket_server.py (Local Game Engine, tokens por
    jugador, leaderboard autoritativo) + qr_routes.py (QR para que entren).

- "Carrera de caballos aleatoria"
  → se arma como un modo en el builder (templates/scratch) o se instancia un template
    dinámico vía template_engine.py + template_registry.py; el display lo proyecta.

- "Descargar una locura con un par de clics"
  → mode_packages.py importa un `.lkqmode`/`.silly` (ZIP sanitizado) y lo registra;
    templates.py lo lista en la galería.

- "El profesor crea su propio sistema de trivias (sin el desastre de Wordwall)"
  → sillycontrol.html para armar preguntas/categorías, timer.py para elegir los tiempos
    a la medida (sin reiniciar ni mezclar), y export.py para sacar resultados.
