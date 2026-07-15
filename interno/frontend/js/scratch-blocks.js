/**
 * scratch-blocks.js — Registro maestro de opcodes + compilador AOT
 * Infinite Canvas Builder v3.0 (SillyQuiz)
 *
 * Define la estructura lógica de todos los bloques atómicos y cómo se
 * compilan a una máquina de estados JSON pura que el backend Python valida
 * de un golpe (cero interpretación en caliente durante el show).
 *
 * Sin dependencias externas. Expone window.ScratchBlocks y window.ScratchAOT.
 *
 * INYECTE dynamic-blocks.js para soporte de bloques dinámicos en tiempo de ejecución.
 */

(function (global) {
  'use strict';

/* ===================================================================
   CATEGORÍAS — colorVar apunta a las CSS vars de scratch-blocks.css
   (las clases .block-* se añaden en la fase de estilos CSS final).
   =================================================================== */
const CATEGORIES = {
  events:    { id: 'events',    label: 'Eventos',             colorVar: '--sq-cat-events',      order: 1,  icon: '⚡',  desc: 'Disparadores de inicio y mensajes' },
  control:   { id: 'control',   label: 'Control',             colorVar: '--sq-cat-control',     order: 2,  icon: '🔧',  desc: 'Bucles, condicionales, flujo' },
  looks:     { id: 'looks',     label: 'Looks / Visual',      colorVar: '--sq-cat-looks',       order: 3,  icon: '🎨',  desc: 'Apariencia, animación, efectos' },
  audio:     { id: 'audio',     label: 'Audio',               colorVar: '--sq-cat-audio',       order: 4,  icon: '🔊',  desc: 'Música, SFX, control de sonido' },
  ndi:       { id: 'ndi',       label: 'NDI / Broadcast',     colorVar: '--sq-cat-ndi',         order: 5,  icon: '📡',  desc: 'Video NDI, discovery, streaming' },
  displays:  { id: 'displays',  label: 'Multi-Display',       colorVar: '--sq-cat-displays',    order: 6,  icon: '🖥️',  desc: 'Pantallas, layers, sincronización' },
  quiz:      { id: 'quiz',      label: 'Quiz / Juego',        colorVar: '--sq-cat-quiz',        order: 7,  icon: '🧠',  desc: 'Motor de preguntas y puntuación' },
  state:     { id: 'state',     label: 'Estado / Variables',  colorVar: '--sq-cat-state',       order: 8,  icon: '📦',  desc: 'RAM, SQLite, persistencia' },
  operators: { id: 'operators', label: 'Operadores',          colorVar: '--sq-cat-operators',   order: 9,  icon: '⚙️',  desc: 'Matemáticas, lógica, strings, JSON' },
  custom:    { id: 'custom',    label: 'Listas / Custom',     colorVar: '--sq-cat-custom',      order: 10, icon: '📋',  desc: 'Arrays, iteración, transformación' },
  players:   { id: 'players',   label: 'Concursantes',        colorVar: '--sq-cat-players',     order: 11, icon: '👥',  desc: 'Slots, strikes, ranking, avatares' },
  db:        { id: 'db',        label: 'Query Engine',        colorVar: '--sq-cat-db',          order: 12, icon: '🗄️',  desc: 'Filtrado, búsqueda, metadatos BD' },
  runtime:   { id: 'runtime',   label: 'Runtime / Sistema',   colorVar: '--sq-cat-runtime',     order: 13, icon: '🔄',  desc: 'Snapshots, hot-reload, debug' },
  engine:    { id: 'engine',    label: 'Engine / Game',       colorVar: '--sq-cat-engine',      order: 14, icon: '🎮',  desc: 'Mini-juegos, clientes, sprites' },
  sprites:   { id: 'sprites',   label: 'Engine Sprites',      colorVar: '--sq-cat-sprites',     order: 15, icon: '🎭',  desc: 'Sprites 2D, animación, física ligera' },
  physics:   { id: 'physics',   label: 'Física / Physics',    colorVar: '--sq-cat-physics',     order: 16, icon: '⚖️',  desc: 'Cuerpos, fuerzas, colisiones, joints' },
  procedures: { id: 'procedures', label: 'Mis Bloques',        colorVar: '--sq-cat-procedures', order: 17, icon: '📖',  desc: 'Procedimientos personalizados, funciones' },
};

  /* Tipos de puerto para el tipado visual de enchufes (color del conector) */
  const PORT = {
    number:   'port-number',
    string:   'port-string',
    boolean:  'port-boolean',
    color:    'port-color',
    ndi:      'port-ndi',
    display:  'port-display',
    any:      'port-any'
  };

  const REGISTRY = Object.create(null);

  /**
   * Constructor de definición de bloque.
   * type: 'hat' | 'stack' | 'c' | 'reporter' | 'boolean'
   * text: contiene placeholders [TOKEN] que mapean a args.
   * args: { TOKEN: { type, port, options?, default?, accepts? } }
   * meta: { returns, exec, sideEffects, bodies, scope }
   */
  function def(opcode, category, type, text, args, meta) {
    meta = meta || {};
    const isContainer = type === 'c';
    const isHat = type === 'hat';
    const isReporter = type === 'reporter';
    const isBoolean = type === 'boolean';

    let bodies = meta.bodies || null;
    if (isContainer && !bodies) bodies = ['body'];

    REGISTRY[opcode] = {
      opcode,
      category,
      type,
      text,
      args: args || {},
      hasBody: isContainer,
      bodies,
      // Hats son disparadores de evento; el resto se ejecuta en secuencia.
      exec: meta.exec || (isHat ? 'event' : 'sync'),
      // 'event' | 'sync' | 'async' (NDI discovery, connect son async)
      returns: isReporter ? (meta.returns || 'any')
               : isBoolean ? 'boolean'
               : (meta.returns || null),
      sideEffects: meta.sideEffects || [], // ['ndi','db','state','display','ui','audio','players','quiz','all','unsafe']
      scope: meta.scope || null,           // 'player' si inyecta contexto de jugador
      disabledInProd: !!meta.disabledInProd
    };
    return REGISTRY[opcode];
  }

  /* ===================================================================
   * 1. EVENTOS (Hat / Amarillo) — 8
   * =================================================================== */
  def('on_mode_init', 'events', 'hat', 'al iniciar el modo', {}, { scope: null });
  def('on_question_load', 'events', 'hat', 'al precargar la pregunta en memoria', {}, {});
  def('on_question_start', 'events', 'hat', 'cuando el cronómetro inicia en vivo', {}, {});
  def('on_player_buzz', 'events', 'hat', 'al pulsar concursante [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any, options: '@context' } }, { scope: 'player' });
  def('on_player_answer', 'events', 'hat', 'al confirmar respuesta [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any, options: '@context' } }, { scope: 'player' });
  def('on_timer_expire', 'events', 'hat', 'al llegar el cronómetro a cero absoluto', {}, {});
  def('on_hardware_disconnect', 'events', 'hat', 'si un nodo local pierde red', {}, {});
  def('on_custom_signal', 'events', 'hat', 'al recibir señal [SIGNAL]',
      { SIGNAL: { type: 'string', port: PORT.string } }, {});

  /* ===================================================================
   * 2. CONTROL, TIEMPO Y ESTRUCTURA (Naranja) — 9
   * =================================================================== */
  def('wait_seconds', 'control', 'stack', 'esperar [SEC] segundos',
      { SEC: { type: 'number', port: PORT.number, default: 1 } }, {});
  def('wait_until_timestamp', 'control', 'stack', 'esperar hasta [TS]',
      { TS: { type: 'reporter', port: PORT.number, returns: 'number' } }, { exec: 'async' });
  def('if_then', 'control', 'c', 'si [COND] entonces',
      { COND: { type: 'boolean', port: PORT.boolean } }, { bodies: ['body'] });
  def('if_then_else', 'control', 'c', 'si [COND] entonces ... si no ...',
      { COND: { type: 'boolean', port: PORT.boolean } }, { bodies: ['body', 'elseBody'] });
  def('repeat_times', 'control', 'c', 'repetir [N] veces',
      { N: { type: 'number', port: PORT.number, default: 10 } }, { bodies: ['body'] });
  def('repeat_until', 'control', 'c', 'repetir hasta que [COND]',
      { COND: { type: 'boolean', port: PORT.boolean } }, { bodies: ['body'] });
  def('try_catch_fallback', 'control', 'c', 'intentar ... si falla ...',
      {}, { bodies: ['body', 'fallback'], sideEffects: ['all'] });
  def('break_stack', 'control', 'stack', 'interrumpir pila actual', {}, {});
  def('global_panic_reset', 'control', 'stack', 'RESET GLOBAL (pánico)', {}, { sideEffects: ['all'] });

  /* ===================================================================
   * 3. LOOKS / VISUAL (Púrpura) — 26
   * =================================================================== */
  def('set_theme', 'looks', 'stack', 'aplicar tema [THEME]',
      { THEME: { type: 'dropdown', port: PORT.any, options: ['neon', 'retro', 'oscuro', 'custom'] } }, { sideEffects: ['ui'] });
  def('show_ui_component', 'looks', 'stack', 'mostrar [COMP] en [DISP]',
      { COMP: { type: 'id', port: PORT.any }, DISP: { type: 'display_id', port: PORT.display } }, { sideEffects: ['ui', 'display'] });
  def('hide_ui_component', 'looks', 'stack', 'ocultar [COMP]',
      { COMP: { type: 'id', port: PORT.any } }, { sideEffects: ['ui'] });
  def('set_component_property', 'looks', 'stack', 'fijar [COMP] [PROP] a [VAL]',
      { COMP: { type: 'id', port: PORT.any }, PROP: { type: 'dropdown', port: PORT.any, options: ['font', 'opacity', 'size', 'color'] }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['ui'] });
  // SECURITY: inject_css_raw BLOCKED — allows arbitrary CSS injection
  // def('inject_css_raw', 'looks', 'stack', 'inyectar CSS en [DISP]: [CSS]',
  //     { DISP: { type: 'display_id', port: PORT.display }, CSS: { type: 'textarea', port: PORT.any } }, { sideEffects: ['ui'] });
  def('play_css_animation', 'looks', 'stack', 'animar [COMP] con [ANIM]',
      { COMP: { type: 'id', port: PORT.any }, ANIM: { type: 'dropdown', port: PORT.any, options: ['elastic-in', 'shake', 'flash', 'fade'] } }, { sideEffects: ['ui'] });
  def('spawn_particle_emitter', 'looks', 'stack', 'partículas [KIND] en X:[X] Y:[Y]',
      { KIND: { type: 'dropdown', port: PORT.any, options: ['confetti', 'fire', 'gold'] }, X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('set_text_smooth', 'looks', 'stack', 'texto de [COMP] a [TXT]',
      { COMP: { type: 'id', port: PORT.any }, TXT: { type: 'reporter', port: PORT.string, returns: 'string' } }, { sideEffects: ['ui'] });
  def('toggle_fullscreen_layer', 'looks', 'stack', 'pantalla completa [DISP] = [ON]',
      { DISP: { type: 'display_id', port: PORT.display }, ON: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['ui', 'display'] });
  def('trigger_scene_wipe', 'looks', 'stack', 'transición de escena [WIPE]',
      { WIPE: { type: 'dropdown', port: PORT.any, options: ['fade', 'glitch', 'slide'] } }, { sideEffects: ['ui'] });

  /* ---- LOOKS / VISUAL — Bloques gráficos nuevos (14-24) ---- */
  def('show_image', 'looks', 'stack', 'mostrar imagen [SRC] en [DISP]',
      { SRC: { type: 'image_file', port: PORT.any, accepts: 'image/*' }, DISP: { type: 'display_id', port: PORT.display } }, { sideEffects: ['ui', 'display'] });
  def('show_video', 'looks', 'stack', 'reproducir video [SRC] en [DISP] loop [LOOP]',
      { SRC: { type: 'string', port: PORT.string }, DISP: { type: 'display_id', port: PORT.display }, LOOP: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['ui', 'display'] });
  def('set_background_image', 'looks', 'stack', 'fondo con imagen [SRC] en [DISP]',
      { SRC: { type: 'image_file', port: PORT.any, accepts: 'image/*' }, DISP: { type: 'display_id', port: PORT.display } }, { sideEffects: ['ui', 'display'] });
  def('set_gradient_bg', 'looks', 'stack', 'fondo gradiente [DIR] de [C1] a [C2]',
      { DIR: { type: 'dropdown', port: PORT.any, options: ['→', '↓', '↗', '↘'] }, C1: { type: 'string', port: PORT.any }, C2: { type: 'string', port: PORT.any } }, { sideEffects: ['ui'] });
  def('set_custom_theme', 'looks', 'stack', 'tema custom bg:[BG] txt:[TXT] accent:[ACC] font:[FNT]',
      { BG: { type: 'string', port: PORT.any }, TXT: { type: 'string', port: PORT.any }, ACC: { type: 'string', port: PORT.any }, FNT: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('load_font', 'looks', 'stack', 'cargar fuente [NAME] desde [URL]',
      { NAME: { type: 'string', port: PORT.string }, URL: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('set_text_shadow', 'looks', 'stack', 'sombra de texto [COMP] x:[X] y:[Y] blur:[BLR] color:[CLR]',
      { COMP: { type: 'id', port: PORT.any }, X: { type: 'number', port: PORT.number, default: 2 }, Y: { type: 'number', port: PORT.number, default: 2 }, BLR: { type: 'number', port: PORT.number, default: 4 }, CLR: { type: 'string', port: PORT.any } }, { sideEffects: ['ui'] });
  def('set_border', 'looks', 'stack', 'borde [COMP] grosor:[W] estilo:[STY] color:[CLR]',
      { COMP: { type: 'id', port: PORT.any }, W: { type: 'number', port: PORT.number, default: 2 }, STY: { type: 'dropdown', port: PORT.any, options: ['solid', 'dashed', 'dotted', 'double'] }, CLR: { type: 'string', port: PORT.any } }, { sideEffects: ['ui'] });
  def('set_rounded_corners', 'looks', 'stack', 'esquinas redondeadas [COMP] radio:[R]',
      { COMP: { type: 'id', port: PORT.any }, R: { type: 'number', port: PORT.number, default: 8 } }, { sideEffects: ['ui'] });
  def('set_opacity_block', 'looks', 'stack', 'opacidad [COMP] = [VAL]%',
      { COMP: { type: 'id', port: PORT.any }, VAL: { type: 'number', port: PORT.number, default: 100 } }, { sideEffects: ['ui'] });
  def('set_rotation', 'looks', 'stack', 'rotar [COMP] [DEG]°',
      { COMP: { type: 'id', port: PORT.any }, DEG: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('set_scale', 'looks', 'stack', 'escalar [COMP] = [S]%',
      { COMP: { type: 'id', port: PORT.any }, S: { type: 'number', port: PORT.number, default: 100 } }, { sideEffects: ['ui'] });
  def('set_filter', 'looks', 'stack', 'filtro [COMP] [FILTER]',
      { COMP: { type: 'id', port: PORT.any }, FILTER: { type: 'dropdown', port: PORT.any, options: ['blur', 'grayscale', 'sepia', 'invert', 'brightness', 'contrast', 'saturate', 'hue-rotate'] } }, { sideEffects: ['ui'] });
  def('create_overlay', 'looks', 'stack', 'crear overlay [ID] en X:[X] Y:[Y] ancho:[W] alto:[H]',
      { ID: { type: 'string', port: PORT.string }, X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 }, W: { type: 'number', port: PORT.number, default: 100 }, H: { type: 'number', port: PORT.number, default: 100 } }, { sideEffects: ['ui'] });
  def('move_component', 'looks', 'stack', 'mover [COMP] a X:[X] Y:[Y]',
      { COMP: { type: 'id', port: PORT.any }, X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('set_position', 'looks', 'stack', 'posición [COMP] = [POS]',
      { COMP: { type: 'id', port: PORT.any }, POS: { type: 'dropdown', port: PORT.any, options: ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] } }, { sideEffects: ['ui'] });

  /* ===================================================================
   * 4. AUDIO (Rosa Fucsia) — 6
   * =================================================================== */
  def('play_bg_music', 'audio', 'stack', 'música [FILE] vol [VOL] loop [LOOP]',
      { FILE: { type: 'audio_file', port: PORT.any, accepts: 'audio/*' }, VOL: { type: 'slider', port: PORT.number, default: 50 }, LOOP: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['audio'] });
  def('stop_bg_music_fade', 'audio', 'stack', 'fundir música en [SEC]s',
      { SEC: { type: 'number', port: PORT.number, default: 2 } }, { sideEffects: ['audio'] });
  def('play_sfx', 'audio', 'stack', 'sfx [FILE] vol [VOL] pitch [PITCH]',
      { FILE: { type: 'audio_file', port: PORT.any, accepts: 'audio/*' }, VOL: { type: 'slider', port: PORT.number, default: 80 }, PITCH: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['audio'] });
  def('set_audio_category_volume', 'audio', 'stack', 'volumen [CAT] = [VOL]',
      { CAT: { type: 'dropdown', port: PORT.any, options: ['master', 'sfx', 'music'] }, VOL: { type: 'slider', port: PORT.number, default: 100 } }, { sideEffects: ['audio'] });
  def('trigger_audio_ducking', 'audio', 'stack', 'ducking [PCT]% por [SEC]s',
      { PCT: { type: 'number', port: PORT.number, default: 50 }, SEC: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['audio'] });
  def('stop_all_sounds', 'audio', 'stack', 'silenciar todo', {}, { sideEffects: ['audio'] });

  /* ===================================================================
   * 5. NDI / BROADCAST (Teal) — 8
   * =================================================================== */
  def('ndi_start_discovery_worker', 'ndi', 'stack', 'iniciar discovery NDI (worker)', {}, { exec: 'async', sideEffects: ['ndi'] });
  def('ndi_connect_source', 'ndi', 'stack', 'conectar [SRC] → output [OUT]',
      { SRC: { type: 'dropdown', port: PORT.ndi, options: '@ndi_sources' }, OUT: { type: 'output_id', port: PORT.ndi } }, { exec: 'async', sideEffects: ['ndi'] });
  def('ndi_disconnect_source', 'ndi', 'stack', 'desconectar output [OUT]',
      { OUT: { type: 'output_id', port: PORT.ndi } }, { sideEffects: ['ndi'] });
  def('ndi_send_canvas_scene', 'ndi', 'stack', 'enviar escena [SCENE] alpha [A]',
      { SCENE: { type: 'string', port: PORT.any }, A: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['ndi'] });
  def('ndi_set_frame_rate', 'ndi', 'stack', 'fps NDI [FPS]',
      { FPS: { type: 'dropdown', port: PORT.ndi, options: ['60fps', '30fps', '29.97fps'] } }, { sideEffects: ['ndi'] });
  def('ndi_toggle_failover_image', 'ndi', 'stack', 'failover [IMG] = [ON]',
      { IMG: { type: 'image_file', port: PORT.any, accepts: 'image/*' }, ON: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['ndi'] });
  def('get_ndi_latency', 'ndi', 'reporter', 'latencia de [SRC]',
      { SRC: { type: 'source_id', port: PORT.ndi } }, { returns: 'number' });
  def('is_ndi_source_online', 'ndi', 'boolean', '¿[SRC] online?',
      { SRC: { type: 'source_id', port: PORT.ndi } }, {});

  /* ===================================================================
   * 6. MULTI-DISPLAY (Ámbar) — 7
   * =================================================================== */
  def('display_register_setup', 'displays', 'stack', 'mapear hardware [GRID]',
      { GRID: { type: 'matrix', port: PORT.display } }, { sideEffects: ['display'] });
  def('display_broadcast_payload', 'displays', 'stack', 'a [DISP] acción [ACT] datos [DATA]',
      { DISP: { type: 'display_id', port: PORT.display }, ACT: { type: 'string', port: PORT.string }, DATA: { type: 'reporter', port: PORT.any, returns: 'json' } }, { sideEffects: ['display'] });
  def('display_sync_clocks', 'displays', 'stack', 'sincronizar relojes', {}, { sideEffects: ['display'] });
  def('set_layer_z_index', 'displays', 'stack', 'z-index de [COMP] = [Z]',
      { COMP: { type: 'id', port: PORT.any }, Z: { type: 'number', port: PORT.number, default: 10 } }, { sideEffects: ['ui', 'display'] });
  def('set_grid_anchor', 'displays', 'stack', 'anclar [COMP] en [POS]',
      { COMP: { type: 'id', port: PORT.any }, POS: { type: 'matrix', port: PORT.display } }, { sideEffects: ['ui', 'display'] });
  def('clear_all_displays', 'displays', 'stack', 'limpiar pantallas', {}, { sideEffects: ['display'] });
  def('get_display_connection_count', 'displays', 'reporter', 'nº pantallas conectadas', {}, { returns: 'number' });

  /* ===================================================================
   * 7. QUIZ / NÚCLEO (Azul) — 8
   * =================================================================== */
  def('quiz_init_engine', 'quiz', 'stack', 'init quiz [N] preg [CAT]',
      { N: { type: 'number', port: PORT.number, default: 20 }, CAT: { type: 'dropdown', port: PORT.any, options: ['mixed', 'custom'] } }, { sideEffects: ['db', 'state'] });
  def('quiz_fetch_next_question', 'quiz', 'stack', 'siguiente pregunta', {}, { sideEffects: ['db', 'state'] });
  def('quiz_lock_answers', 'quiz', 'stack', 'bloquear respuestas', {}, { sideEffects: ['quiz'] });
  def('quiz_verify_player_answer', 'quiz', 'stack', 'verificar [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['state'] });
  def('quiz_add_score_to_player', 'quiz', 'stack', 'sumar [PLAYER] [PTS] pts',
      { PLAYER: { type: 'player_id', port: PORT.any }, PTS: { type: 'number', port: PORT.number, default: 10 } }, { sideEffects: ['state'] });
  def('quiz_get_current_question_text', 'quiz', 'reporter', 'texto pregunta', {}, { returns: 'string' });
  def('quiz_get_answer_text', 'quiz', 'reporter', 'respuesta [OPT]',
      { OPT: { type: 'dropdown', port: PORT.any, options: ['A', 'B', 'C', 'D'] } }, { returns: 'string' });
  def('quiz_get_leaderboard_json', 'quiz', 'reporter', 'leaderboard JSON', {}, { returns: 'json' });

  /* ===================================================================
   * 8. ESTADO / RAM (Rojo/Verde) — 6
   * =================================================================== */
  def('state_init_memory_key', 'state', 'stack', 'init clave [KEY] = [DEF]',
      { KEY: { type: 'string', port: PORT.string }, DEF: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });
  def('state_set_memory', 'state', 'stack', 'clave [KEY] = [VAL]',
      { KEY: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });
  def('state_increment_memory', 'state', 'stack', 'clave [KEY] += [BY]',
      { KEY: { type: 'string', port: PORT.string }, BY: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['state'] });
  def('state_commit_to_sqlite', 'state', 'stack', 'commit a SQLite (batch)', {}, { sideEffects: ['db'] });
  def('state_clear_volatile_cache', 'state', 'stack', 'limpiar caché volátil', {}, { sideEffects: ['state'] });
  def('state_get_memory_value', 'state', 'reporter', 'valor de [KEY]',
      { KEY: { type: 'string', port: PORT.string } }, { returns: 'any' });

  /* ===================================================================
   * 9. OPERADORES (Verde Claro) — 8
   * =================================================================== */
  def('math_calc', 'operators', 'reporter', '[A] [OP] [B]',
      { A: { type: 'reporter', port: PORT.number, returns: 'number' }, OP: { type: 'dropdown', port: PORT.any, options: ['+', '-', '*', '÷'] }, B: { type: 'reporter', port: PORT.number, returns: 'number' } }, { returns: 'number' });
  def('logic_compare', 'operators', 'boolean', '[A] [OP] [B]',
      { A: { type: 'reporter', port: PORT.number, returns: 'number' }, OP: { type: 'dropdown', port: PORT.any, options: ['==', '>', '<', '>=', '<=', '!='] }, B: { type: 'reporter', port: PORT.number, returns: 'number' } }, {});
  def('logic_and_or', 'operators', 'boolean', '[A] [OP] [B]',
      { A: { type: 'boolean', port: PORT.boolean }, OP: { type: 'dropdown', port: PORT.any, options: ['AND', 'OR'] }, B: { type: 'boolean', port: PORT.boolean } }, {});
  def('logic_not', 'operators', 'boolean', 'no [A]',
      { A: { type: 'boolean', port: PORT.boolean } }, {});
  def('get_random_number', 'operators', 'reporter', 'random [MIN]..[MAX]',
      { MIN: { type: 'number', port: PORT.number, default: 0 }, MAX: { type: 'number', port: PORT.number, default: 100 } }, { returns: 'number' });
  def('string_join', 'operators', 'reporter', '[A] + [B]',
      { A: { type: 'reporter', port: PORT.string, returns: 'string' }, B: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'string' });
  def('string_contains', 'operators', 'boolean', '[TXT] contiene [SUB]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, SUB: { type: 'reporter', port: PORT.string, returns: 'string' } }, {});
  def('parse_json_key', 'operators', 'reporter', 'json [J] clave [K]',
      { J: { type: 'reporter', port: PORT.any, returns: 'json' }, K: { type: 'string', port: PORT.string } }, { returns: 'any' });

  /* ===================================================================
   * 10. LISTAS / CUSTOM (Gris/Negro) — 6
   * =================================================================== */
  def('list_create', 'custom', 'stack', 'crear lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('list_add_item', 'custom', 'stack', 'lista [NAME] += [VAL]',
      { NAME: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });
  def('list_remove_index', 'custom', 'stack', 'lista [NAME] quitar [IDX]',
      { NAME: { type: 'string', port: PORT.string }, IDX: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['state'] });
  def('list_get_item_at', 'custom', 'reporter', 'ítem [NAME] [IDX]',
      { NAME: { type: 'string', port: PORT.string }, IDX: { type: 'number', port: PORT.number, default: 0 } }, { returns: 'any' });
  def('list_get_length', 'custom', 'reporter', 'largo [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'number' });
  // SECURITY: execute_raw_javascript BLOCKED — allows arbitrary JS execution
  // def('execute_raw_javascript', 'runtime', 'stack', 'JS: [CODE]',
  //     { CODE: { type: 'textarea', port: PORT.any } }, { sideEffects: ['runtime'], exec: 'async', timeout: 300000, disabledInProd: true });

  /* ===================================================================
   * 11. CONCURSANTES (Azul Eléctrico) — 8
   * =================================================================== */
  def('players_set_active_slots', 'players', 'stack', 'slots activos = [N]',
      { N: { type: 'number', port: PORT.number, default: 4 } }, { sideEffects: ['players'] });
  def('players_strike_penalize', 'players', 'stack', 'strike a [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_swap_positions', 'players', 'stack', 'intercambiar [A] ↔ [B]',
      { A: { type: 'player_id', port: PORT.any }, B: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_get_fastest_buzzer', 'players', 'reporter', 'jugador más rápido', {}, { returns: 'string' });
  def('players_toggle_lockout', 'players', 'stack', 'lockout [PLAYER] = [ON]',
      { PLAYER: { type: 'player_id', port: PORT.any }, ON: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['players'] });
  def('players_get_name', 'players', 'reporter', 'nombre de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'string' });
  def('players_set_avatar', 'players', 'stack', 'avatar [PLAYER] = [IMG]',
      { PLAYER: { type: 'player_id', port: PORT.any }, IMG: { type: 'image_file', port: PORT.any, accepts: 'image/*' } }, { sideEffects: ['players'] });
  def('players_is_alive', 'players', 'boolean', '¿[PLAYER] vivo?',
      { PLAYER: { type: 'player_id', port: PORT.any } }, {});

  /* ===================================================================
   * 12. QUERY ENGINE / DB (Marrón) — 7
   * =================================================================== */
  def('db_query_filter_difficulty', 'db', 'stack', 'filtrar dificultad [D]',
      { D: { type: 'dropdown', port: PORT.any, options: ['facil', 'media', 'dificil'] } }, { sideEffects: ['db'] });
  def('db_query_get_unanswered_count', 'db', 'reporter', 'preguntas sin usar', {}, { returns: 'number' });
  def('db_query_exclude_last_questions', 'db', 'stack', 'excluir últimas [N]',
      { N: { type: 'number', port: PORT.number, default: 5 } }, { sideEffects: ['db'] });
  def('db_query_mark_as_burned', 'db', 'stack', 'burn pregunta [QID]',
      { QID: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['db'] });
  def('db_query_search_by_keyword', 'db', 'reporter', 'buscar "[KW]" → id',
      { KW: { type: 'string', port: PORT.string } }, { returns: 'number' });
  def('db_query_get_hint_text', 'db', 'reporter', 'pista de [QID]',
      { QID: { type: 'number', port: PORT.number, default: 0 } }, { returns: 'string' });
  def('db_query_shuffle_answers', 'db', 'stack', 'barajar respuestas A/B/C/D', {}, { sideEffects: ['state', 'db'] });

  /* ===================================================================
   * 13. RUNTIME / SISTEMA — RESILIENCIA EN VIVO — 3
   * (Hot-Reload, Snapshot, Replicación). Blocks 92-94.
   * =================================================================== */
  def('runtime_snapshot_take', 'runtime', 'stack', 'tomar snapshot de RAM', {}, { sideEffects: ['state'] });
  def('runtime_hot_reload', 'runtime', 'stack', 'hot-reload modo [MODO]',
      { MODO: { type: 'dropdown', port: PORT.any, options: '@mode_ids' } }, { exec: 'async', sideEffects: ['all'] });
  def('system_replicate_state_to_node', 'runtime', 'stack', 'replicar estado → [IP]',
      { IP: { type: 'string', port: PORT.string } }, { exec: 'async', sideEffects: ['state', 'db'] });

  /* ===================================================================
   * 14. BROADCASTS / MENSAJES (Cyan) — 3
   * Scratch clásico: enviar/recibir mensajes entre scripts.
   * =================================================================== */
  def('broadcast', 'events', 'stack', 'enviar mensaje [MSG]',
      { MSG: { type: 'string', port: PORT.string } }, { sideEffects: ['all'] });
  def('broadcast_and_wait', 'events', 'stack', 'enviar [MSG] y esperar',
      { MSG: { type: 'string', port: PORT.string } }, { exec: 'async', sideEffects: ['all'] });
  def('when_i_receive', 'events', 'hat', 'al recibir mensaje [MSG]',
      { MSG: { type: 'string', port: PORT.string } }, {});

  /* ===================================================================
   * 15. VARIABLES / LISTAS (Rojo Oscuro) — 10
   * Variables globales, listas y operaciones con ellas.
   * =================================================================== */
  def('variable_set', 'state', 'stack', 'variable [VAR] = [VAL] como [TYPE]',
      { VAR: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any }, TYPE: { type: 'dropdown', port: PORT.any, options: ['auto', 'number', 'string', 'boolean', 'color'] } }, { sideEffects: ['state'] });
  def('variable_change', 'state', 'stack', 'variable [VAR] += [VAL]',
      { VAR: { type: 'string', port: PORT.string }, VAL: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['state'] });
  def('variable_get', 'state', 'reporter', 'variable [VAR]',
      { VAR: { type: 'string', port: PORT.string } }, { returns: 'any' });
  def('variable_init', 'state', 'stack', 'inicializar variable [VAR] = [VAL] como [TYPE]',
      { VAR: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any }, TYPE: { type: 'dropdown', port: PORT.any, options: ['number', 'string', 'boolean', 'color', 'list'] } }, { sideEffects: ['state'] });
  def('show_variable', 'looks', 'stack', 'mostrar variable [VAR] en [DISP]',
      { VAR: { type: 'string', port: PORT.string }, DISP: { type: 'display_id', port: PORT.display } }, { sideEffects: ['ui'] });
  def('hide_variable', 'looks', 'stack', 'ocultar variable [VAR]',
      { VAR: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('list_insert_item', 'custom', 'stack', 'lista [NAME] insertar [VAL] en [IDX]',
      { NAME: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any }, IDX: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['state'] });
  def('list_contains', 'custom', 'boolean', 'lista [NAME] contiene [VAL]',
      { NAME: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any } }, {});
  def('list_delete_all', 'custom', 'stack', 'lista [NAME] vaciar',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });

  /* ===================================================================
   * 16. MOVIMIENTO / POSICIÓN (Azul Claro) — 8
   * Control de posición y movimiento de componentes en pantalla.
   * =================================================================== */
  def('go_to_xy', 'looks', 'stack', 'ir a X:[X] Y:[Y]',
      { X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('glide_to_xy', 'looks', 'stack', 'deslizar a X:[X] Y:[Y] en [SEC]s',
      { X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 }, SEC: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['ui'] });
  def('change_x', 'looks', 'stack', 'cambiar X en [DX]',
      { DX: { type: 'number', port: PORT.number, default: 10 } }, { sideEffects: ['ui'] });
  def('change_y', 'looks', 'stack', 'cambiar Y en [DY]',
      { DY: { type: 'number', port: PORT.number, default: 10 } }, { sideEffects: ['ui'] });
  def('set_x', 'looks', 'stack', 'fijar X = [X]',
      { X: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('set_y', 'looks', 'stack', 'fijar Y = [Y]',
      { Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
  def('get_x', 'looks', 'reporter', 'posición X', {}, { returns: 'number' });
  def('get_y', 'looks', 'reporter', 'posición Y', {}, { returns: 'number' });

  /* ===================================================================
   * 17. LOOKS EXTRAS / EXPRESIONES (Púrpura Claro) — 8
   * Say, think, show, hide, size, graphic effects.
   * =================================================================== */
  def('say', 'looks', 'stack', 'decir [MSG] por [SEC]s',
      { MSG: { type: 'string', port: PORT.string }, SEC: { type: 'number', port: PORT.number, default: 2 } }, { sideEffects: ['ui'] });
  def('think', 'looks', 'stack', 'pensar [MSG] por [SEC]s',
      { MSG: { type: 'string', port: PORT.string }, SEC: { type: 'number', port: PORT.number, default: 2 } }, { sideEffects: ['ui'] });
  def('show_component', 'looks', 'stack', 'mostrar [COMP]',
      { COMP: { type: 'id', port: PORT.any } }, { sideEffects: ['ui'] });
  def('hide_component', 'looks', 'stack', 'ocultar [COMP]',
      { COMP: { type: 'id', port: PORT.any } }, { sideEffects: ['ui'] });
  def('change_size', 'looks', 'stack', 'cambiar tamaño [COMP] en [PCT]%',
      { COMP: { type: 'id', port: PORT.any }, PCT: { type: 'number', port: PORT.number, default: 10 } }, { sideEffects: ['ui'] });
  def('set_size', 'looks', 'stack', 'fijar tamaño [COMP] = [PCT]%',
      { COMP: { type: 'id', port: PORT.any }, PCT: { type: 'number', port: PORT.number, default: 100 } }, { sideEffects: ['ui'] });
  def('change_color_effect', 'looks', 'stack', 'cambiar efecto color [COMP] en [VAL]',
      { COMP: { type: 'id', port: PORT.any }, VAL: { type: 'number', port: PORT.number, default: 25 } }, { sideEffects: ['ui'] });
  def('clear_graphic_effects', 'looks', 'stack', 'limpiar efectos gráficos [COMP]',
      { COMP: { type: 'id', port: PORT.any } }, { sideEffects: ['ui'] });

  /* ===================================================================
   * 18. CLONES (Gris) — 3
   * Crear y eliminar clones de componentes.
   * =================================================================== */
  def('create_clone', 'looks', 'stack', 'crear clon de [COMP]',
      { COMP: { type: 'id', port: PORT.any } }, { sideEffects: ['ui'] });
  def('delete_clone', 'looks', 'stack', 'eliminar este clon', {}, { sideEffects: ['ui'] });
  def('when_i_start_as_clone', 'events', 'hat', 'al iniciar como clon', {}, {});

  /* ===================================================================
   * 19. ENTRADA / INPUT (Naranja Claro) — 5
   * Preguntar al usuario, detectar teclas, ratón.
   * =================================================================== */
  def('ask_and_wait', 'looks', 'stack', 'preguntar [QUESTION] y esperar',
      { QUESTION: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('get_answer', 'looks', 'reporter', 'respuesta del usuario', {}, { returns: 'string' });
  def('mouse_x', 'looks', 'reporter', 'posición ratón X', {}, { returns: 'number' });
  def('mouse_y', 'looks', 'reporter', 'posición ratón Y', {}, { returns: 'number' });
  def('key_pressed', 'looks', 'boolean', '¿tecla [KEY] presionada?',
      { KEY: { type: 'dropdown', port: PORT.any, options: ['space', 'up', 'down', 'left', 'right', 'enter', 'any'] } }, {});

  /* ===================================================================
   * 20. POWER PACK — OPERADORES AVANZADOS (Verde Claro) — 10
   * Matemáticas avanzadas, manipulación potente de strings y lógica extra.
   * =================================================================== */
  def('math_unary', 'operators', 'reporter', '[OP] de [A]',
      { OP: { type: 'dropdown', port: PORT.any, options: ['sqrt', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'tan', 'ln', 'log10'] }, A: { type: 'reporter', port: PORT.number, returns: 'number' } }, { returns: 'number' });
  def('math_binary', 'operators', 'reporter', '[A] [OP] [B]',
      { A: { type: 'reporter', port: PORT.number, returns: 'number' }, OP: { type: 'dropdown', port: PORT.any, options: ['pow', 'mod', 'min', 'max'] }, B: { type: 'reporter', port: PORT.number, returns: 'number' } }, { returns: 'number' });
  def('string_length', 'operators', 'reporter', 'longitud de [TXT]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'number' });
  def('string_case', 'operators', 'reporter', '[TXT] a [OP]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, OP: { type: 'dropdown', port: PORT.any, options: ['upper', 'lower', 'title'] } }, { returns: 'string' });
  def('string_replace', 'operators', 'reporter', '[TXT] cambiar [OLD] por [NEW]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, OLD: { type: 'reporter', port: PORT.string, returns: 'string' }, NEW: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'string' });
  def('string_slice', 'operators', 'reporter', '[TXT] desde [START] hasta [END]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, START: { type: 'number', port: PORT.number, default: 0 }, END: { type: 'number', port: PORT.number, default: -1 } }, { returns: 'string' });
  def('string_starts_with', 'operators', 'boolean', '[TXT] empieza con [SUB]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, SUB: { type: 'reporter', port: PORT.string, returns: 'string' } }, {});
  def('string_ends_with', 'operators', 'boolean', '[TXT] termina con [SUB]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, SUB: { type: 'reporter', port: PORT.string, returns: 'string' } }, {});
  def('logic_xor', 'operators', 'boolean', '[A] O-exclusiva [B]',
      { A: { type: 'boolean', port: PORT.boolean }, B: { type: 'boolean', port: PORT.boolean } }, {});
  def('logic_between', 'operators', 'boolean', '[VAL] entre [MIN] y [MAX]',
      { VAL: { type: 'reporter', port: PORT.number, returns: 'number' }, MIN: { type: 'reporter', port: PORT.number, returns: 'number' }, MAX: { type: 'reporter', port: PORT.number, returns: 'number' } }, {});

  /* ===================================================================
   * 21. POWER PACK — LISTAS PRO (Gris/Negro) — 8
   * Iteración real sobre listas, búsqueda, orden y agregación.
   * =================================================================== */
  def('for_each_in_list', 'custom', 'c', 'para cada [VAR] en lista [NAME]',
      { VAR: { type: 'string', port: PORT.string }, NAME: { type: 'string', port: PORT.string } }, { bodies: ['body'], sideEffects: ['state'] });
  def('list_index_of', 'custom', 'reporter', 'índice de [VAL] en [NAME]',
      { VAL: { type: 'input', port: PORT.any }, NAME: { type: 'string', port: PORT.string } }, { returns: 'number' });
  def('list_get_random_item', 'custom', 'reporter', 'ítem aleatorio de [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'any' });
  def('list_set_item', 'custom', 'stack', 'lista [NAME] fijar ítem [IDX] = [VAL]',
      { NAME: { type: 'string', port: PORT.string }, IDX: { type: 'number', port: PORT.number, default: 1 }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });
  def('list_shuffle', 'custom', 'stack', 'barajar lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('list_sort', 'custom', 'stack', 'ordenar lista [NAME] [OP]',
      { NAME: { type: 'string', port: PORT.string }, OP: { type: 'dropdown', port: PORT.any, options: ['asc', 'desc'] } }, { sideEffects: ['state'] });
  def('list_join', 'custom', 'reporter', 'unir lista [NAME] con [SEP]',
      { NAME: { type: 'string', port: PORT.string }, SEP: { type: 'string', port: PORT.string, default: ', ' } }, { returns: 'string' });
  def('list_count', 'custom', 'reporter', 'contar [VAL] en lista [NAME]',
      { VAL: { type: 'input', port: PORT.any }, NAME: { type: 'string', port: PORT.string } }, { returns: 'number' });

  /* ===================================================================
   * 22. POWER PACK — CONTROL AVANZADO (Naranja) — 3
   * Bucles con rango, salida y continuación reales.
   * =================================================================== */
  def('repeat_for_range', 'control', 'c', 'desde [FROM] hasta [TO] paso [STEP] en [VAR]',
      { FROM: { type: 'number', port: PORT.number, default: 1 }, TO: { type: 'number', port: PORT.number, default: 10 }, STEP: { type: 'number', port: PORT.number, default: 1 }, VAR: { type: 'string', port: PORT.string, default: 'i' } }, { bodies: ['body'], sideEffects: ['state'] });
  def('exit_loop', 'control', 'stack', 'salir del bucle', {}, {});
  def('continue_loop', 'control', 'stack', 'siguiente iteración', {}, {});

  /* ===================================================================
   * 23. POWER PACK — QUIZ PRO (Azul) — 8
   * Control fino del quiz: revelado, ranking, reset y metadata.
   * =================================================================== */
  def('quiz_set_question', 'quiz', 'stack', 'pregunta actual = [TXT]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' } }, { sideEffects: ['state'] });
  def('quiz_reveal_answer', 'quiz', 'stack', 'revelar respuesta correcta', {}, { sideEffects: ['quiz'] });
  def('quiz_get_score', 'quiz', 'reporter', 'puntos de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'number' });
  def('quiz_get_player_rank', 'quiz', 'reporter', 'puesto de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'number' });
  def('quiz_reset_scores', 'quiz', 'stack', 'reiniciar puntuaciones', {}, { sideEffects: ['state'] });
  def('quiz_get_question_category', 'quiz', 'reporter', 'categoría de pregunta', {}, { returns: 'string' });
  def('quiz_get_option_count', 'quiz', 'reporter', 'nº de opciones', {}, { returns: 'number' });
  def('quiz_shuffle_options', 'quiz', 'stack', 'barajar opciones A/B/C/D', {}, { sideEffects: ['state', 'db'] });

  /* ===================================================================
   * 24. POWER PACK — CONCURSANTES PRO (Azul Eléctrico) — 6
   * Métricas, eliminación, revivir y ranking en vivo.
   * =================================================================== */
  def('players_get_points', 'players', 'reporter', 'puntos de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'number' });
  def('players_get_count', 'players', 'reporter', 'nº de concursantes', {}, { returns: 'number' });
  def('players_get_all_names', 'players', 'reporter', 'nombres de todos', {}, { returns: 'json' });
  def('players_eliminate', 'players', 'stack', 'eliminar [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_revive', 'players', 'stack', 'revivir [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_get_rank', 'players', 'reporter', 'puesto de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'number' });

  /* ===================================================================
   * 25. POWER PACK — ESTADO PERSISTENTE (Rojo/Verde) — 3
   * Persistencia real en SQLite + rehidratación de claves.
   * =================================================================== */
  def('state_set_persistent', 'state', 'stack', 'persistir clave [KEY] = [VAL]',
      { KEY: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['db', 'state'] });
  def('state_get_persistent', 'state', 'reporter', 'valor persistido [KEY]',
      { KEY: { type: 'string', port: PORT.string } }, { returns: 'any' });
  def('state_load_persistent', 'state', 'stack', 'cargar persistido [KEY] → RAM [RAMKEY]',
      { KEY: { type: 'string', port: PORT.string }, RAMKEY: { type: 'string', port: PORT.string } }, { sideEffects: ['db', 'state'] });

  /* ===================================================================
   * 26. POWER PACK — LOOKS / EFECTOS PRO (Púrpura) — 4
   * Efectos de pantalla en vivo: destello, sacudida, anuncio y timer.
   * =================================================================== */
  def('screen_flash', 'looks', 'stack', 'destello de [COLOR] por [SEC]s',
      { COLOR: { type: 'string', port: PORT.any, default: '#ffffff' }, SEC: { type: 'number', port: PORT.number, default: 0.5 } }, { sideEffects: ['ui', 'display'] });
  def('screen_shake', 'looks', 'stack', 'sacudir pantalla intensidad [INTENSITY]',
      { INTENSITY: { type: 'number', port: PORT.number, default: 8 } }, { sideEffects: ['ui', 'display'] });
  def('announce', 'looks', 'stack', 'anunciar [TEXT] por [SEC]s',
      { TEXT: { type: 'string', port: PORT.string }, SEC: { type: 'number', port: PORT.number, default: 3 } }, { sideEffects: ['ui', 'display'] });
  def('display_set_timer', 'looks', 'stack', 'en [DISP] timer = [SEC]s',
      { DISP: { type: 'display_id', port: PORT.display }, SEC: { type: 'number', port: PORT.number, default: 30 } }, { sideEffects: ['ui', 'display'] });

  /* ===================================================================
   * 27. POWER PACK — AUDIO / RUNTIME PRO — 4
   * SFX por nombre, volumen master y depuración/export en vivo.
   * =================================================================== */
  def('play_sfx_by_name', 'audio', 'stack', 'sfx [NAME] vol [VOL]',
      { NAME: { type: 'string', port: PORT.string }, VOL: { type: 'slider', port: PORT.number, default: 80 } }, { sideEffects: ['audio'] });
  def('set_master_volume', 'audio', 'stack', 'volumen master = [VOL]',
      { VOL: { type: 'slider', port: PORT.number, default: 100 } }, { sideEffects: ['audio'] });
  def('runtime_debug_log', 'runtime', 'stack', 'log [MSG]',
      { MSG: { type: 'string', port: PORT.string } }, { sideEffects: ['all'] });
  def('runtime_export_json', 'runtime', 'stack', 'exportar estado a log JSON', {}, { sideEffects: ['state'] });

  /* ===================================================================
   * 28. POWER PACK 2 — EXTENSIONES (cronómetro, datos, tiempo, JSON)
   * Bloques avanzados adicionales: control fino del timer, metadata del quiz,
   * ranking de concursantes, manipulación de listas/strings y datos JSON.
   * =================================================================== */
  def('get_timer_remaining', 'quiz', 'reporter', 'timer restante (s)', {}, { returns: 'number' });
  def('set_timer_duration', 'quiz', 'stack', 'fijar timer = [SEC]s',
      { SEC: { type: 'number', port: PORT.number, default: 30 } }, { sideEffects: ['quiz'] });
  def('timer_pause', 'quiz', 'stack', 'pausar timer', {}, { sideEffects: ['quiz'] });
  def('timer_resume', 'quiz', 'stack', 'reanudar timer', {}, { sideEffects: ['quiz'] });
  def('quiz_get_correct_option', 'quiz', 'reporter', 'nº opción correcta', {}, { returns: 'number' });
  def('quiz_get_question_image', 'quiz', 'reporter', 'imagen de pregunta', {}, { returns: 'string' });
  def('quiz_get_difficulty', 'quiz', 'reporter', 'dificultad pregunta', {}, { returns: 'string' });
  def('quiz_get_total_questions', 'quiz', 'reporter', 'total de preguntas', {}, { returns: 'number' });
  def('players_sort_by_score', 'players', 'stack', 'ordenar concursantes por puntos', {}, { sideEffects: ['players'] });
  def('players_get_top_n', 'players', 'reporter', 'top [N] concursantes',
      { N: { type: 'number', port: PORT.number, default: 3 } }, { returns: 'json' });
  def('players_award_bonus', 'players', 'stack', 'bonus [PTS] a [PLAYER]',
      { PTS: { type: 'number', port: PORT.number, default: 5 }, PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_set_var', 'players', 'stack', 'variable [VAR] de [PLAYER] = [VAL]',
      { VAR: { type: 'string', port: PORT.string }, PLAYER: { type: 'player_id', port: PORT.any }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['players', 'state'] });
  def('players_get_var', 'players', 'reporter', 'variable [VAR] de [PLAYER]',
      { VAR: { type: 'string', port: PORT.string }, PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'any' });
  def('players_send_message', 'players', 'stack', 'enviar [MSG] a [PLAYER]',
      { MSG: { type: 'string', port: PORT.string }, PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players'] });
  def('players_show_effect', 'players', 'stack', 'efecto [EFFECT] en [PLAYER]',
      { EFFECT: { type: 'dropdown', port: PORT.any, options: ['confetti', 'sparkle', 'fireworks', 'shake', 'flash'] }, PLAYER: { type: 'player_id', port: PORT.any } }, { sideEffects: ['players', 'ui'] });
  def('list_pop', 'custom', 'reporter', 'sacar último de [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'any' });
  def('list_reverse', 'custom', 'stack', 'invertir lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('list_unique', 'custom', 'stack', 'quitar duplicados de [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('list_to_json', 'custom', 'reporter', 'JSON de lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'json' });
  def('string_trim', 'operators', 'reporter', 'recortar [TXT]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'string' });
  def('string_repeat', 'operators', 'reporter', '[TXT] repetir [N] veces',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, N: { type: 'number', port: PORT.number, default: 2 } }, { returns: 'string' });
  def('string_split', 'operators', 'reporter', '[TXT] partir por [SEP]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, SEP: { type: 'string', port: PORT.string, default: ',' } }, { returns: 'json' });
  def('string_to_number', 'operators', 'reporter', 'número de [TXT]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'number' });
  def('string_matches', 'operators', 'boolean', '[TXT] coincide con [PAT]',
      { TXT: { type: 'reporter', port: PORT.string, returns: 'string' }, PAT: { type: 'string', port: PORT.string } }, {});
  def('math_const', 'operators', 'reporter', 'constante [C]',
      { C: { type: 'dropdown', port: PORT.any, options: ['PI', 'E', 'TAU', 'PHI'] } }, { returns: 'number' });
  def('math_round_to', 'operators', 'reporter', '[A] redondear a [DEC] decimales',
      { A: { type: 'reporter', port: PORT.number, returns: 'number' }, DEC: { type: 'number', port: PORT.number, default: 2 } }, { returns: 'number' });
  def('json_parse', 'operators', 'reporter', 'parse JSON [S]',
      { S: { type: 'reporter', port: PORT.string, returns: 'string' } }, { returns: 'json' });
  def('json_stringify', 'operators', 'reporter', 'a JSON texto [V]',
      { V: { type: 'input', port: PORT.any } }, { returns: 'string' });
  def('get_timestamp', 'runtime', 'reporter', 'timestamp (ms)', {}, { returns: 'number' });
  def('get_current_time', 'runtime', 'reporter', 'hora actual [FMT]',
      { FMT: { type: 'dropdown', port: PORT.any, options: ['HH:MM:SS', 'HH:MM', 'DD/MM'] } }, { returns: 'string' });
  def('random_choice', 'operators', 'reporter', 'aleatorio de lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'any' });

  /* ===================================================================
   * 29. ENGINE / LOCAL GAME ENGINE — Servidor de mini-juegos (Naranja/Teal)
   * Instancia clientes móviles, plantillas y leaderboard en RAM.
   * scope: 'player' inyecta client_id / current_value en los hats.
   * =================================================================== */
  def('engine_create_player_client', 'engine', 'stack', 'crear [SLOTS] clientes [BASE]',
      { SLOTS: { type: 'number', port: PORT.number, default: 4 },
        BASE: { type: 'string', port: PORT.string, default: 'persona' } },
      { exec: 'async', sideEffects: ['players', 'state'] });
  def('engine_load_game_template', 'engine', 'stack', 'cargar plantilla [TPL]',
      { TPL: { type: 'dropdown', port: PORT.any, options: ['zombie_pixel_art', 'space_invader', 'custom_html'] } },
      { exec: 'async', sideEffects: ['players', 'ui'] });
  def('engine_on_client_event', 'engine', 'hat', 'al evento cliente [KEY]',
      { KEY: { type: 'string', port: PORT.string } }, { scope: 'player' });
  def('engine_get_leaderboard_data', 'engine', 'reporter', 'leaderboard [METRIC]',
      { METRIC: { type: 'string', port: PORT.string, default: 'kills' } }, { returns: 'json' });
  def('render_update_proyector_leaderboard', 'engine', 'stack', 'pintar ranking [COMP] con [JSON]',
      { COMP: { type: 'id', port: PORT.any }, JSON: { type: 'reporter', port: PORT.any, returns: 'json' } },
      { sideEffects: ['ui', 'display'] });

  /* ===================================================================
   * 30. ENGINE SPRITES — Canvas 2D (PixiJS/GSAP) (Naranja Vivo)
   * Spawn, física, animación y detección de colisiones en proyector y móvil.
   * =================================================================== */
  def('sprite_spawn', 'sprites', 'stack', 'spawn [SID] asset [ASSET] en X:[X] Y:[Y]',
      { SID: { type: 'string', port: PORT.string }, ASSET: { type: 'image_file', port: PORT.any, accepts: 'image/*' },
        X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 } },
      { sideEffects: ['ui'] });
  def('sprite_destroy', 'sprites', 'stack', 'destruir sprite [SID]',
      { SID: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('sprite_set_animation', 'sprites', 'stack', 'sprite [SID] anim [ANIM] loop [LOOP]',
      { SID: { type: 'string', port: PORT.string }, ANIM: { type: 'string', port: PORT.string, default: 'walk' },
        LOOP: { type: 'boolean', port: PORT.boolean } }, { sideEffects: ['ui'] });
  def('sprite_move_to', 'sprites', 'stack', 'mover [SID] a X:[TX] Y:[TY] en [MS]ms [EASE]',
      { SID: { type: 'string', port: PORT.string }, TX: { type: 'number', port: PORT.number, default: 0 },
        TY: { type: 'number', port: PORT.number, default: 0 }, MS: { type: 'number', port: PORT.number, default: 300 },
        EASE: { type: 'dropdown', port: PORT.any, options: ['linear', 'power2.out', 'power2.in', 'elastic.out', 'back.out', 'sine.inOut'] } },
      { sideEffects: ['ui'] });
  def('sprite_set_velocity', 'sprites', 'stack', 'velocidad [SID] = vx:[VX] vy:[VY]',
      { SID: { type: 'string', port: PORT.string }, VX: { type: 'number', port: PORT.number, default: 0 },
        VY: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['ui'] });
def('sprite_on_collision', 'sprites', 'hat', 'al colisionar [A] con [B]',
      { A: { type: 'string', port: PORT.string }, B: { type: 'string', port: PORT.string } }, { sideEffects: ['ui'] });
  def('sprite_is_touching', 'sprites', 'boolean', '[A] toca [B]?',
      { A: { type: 'string', port: PORT.string }, B: { type: 'string', port: PORT.string } }, {});

  /* ===================================================================
   * 31. PHYSICS / FÍSICA (Verde Oscuro) — 12
   * Box2D / Matter.js estilo: mundo, cuerpos, fuerzas, colisiones, joints.
   * =================================================================== */
  def('physics_enable', 'physics', 'stack', 'activar física gravedad X:[GX] Y:[GY]',
      { GX: { type: 'number', port: PORT.number, default: 0 }, GY: { type: 'number', port: PORT.number, default: 9.8 } },
      { sideEffects: ['ui', 'state'] });
  def('physics_disable', 'physics', 'stack', 'desactivar física', {}, { sideEffects: ['ui', 'state'] });
  def('physics_create_body', 'physics', 'stack', 'crear cuerpo [BID] tipo [TYPE] en X:[X] Y:[Y]',
      { BID: { type: 'string', port: PORT.string },
        TYPE: { type: 'dropdown', port: PORT.any, options: ['dynamic', 'static', 'kinematic'] },
        X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 } },
      { sideEffects: ['ui', 'state'] });
  def('physics_destroy_body', 'physics', 'stack', 'destruir cuerpo [BID]',
      { BID: { type: 'string', port: PORT.string } }, { sideEffects: ['ui', 'state'] });
  def('physics_set_velocity', 'physics', 'stack', 'velocidad [BID] = vx:[VX] vy:[VY]',
      { BID: { type: 'string', port: PORT.string }, VX: { type: 'number', port: PORT.number, default: 0 },
        VY: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['state'] });
  def('physics_apply_force', 'physics', 'stack', 'aplicar fuerza [BID] fx:[FX] fy:[FY] en X:[X] Y:[Y]',
      { BID: { type: 'string', port: PORT.string }, FX: { type: 'number', port: PORT.number, default: 0 },
        FY: { type: 'number', port: PORT.number, default: 0 }, X: { type: 'number', port: PORT.number, default: 0 },
        Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['state'] });
  def('physics_apply_impulse', 'physics', 'stack', 'aplicar impulso [BID] ix:[IX] iy:[IY] en X:[X] Y:[Y]',
      { BID: { type: 'string', port: PORT.string }, IX: { type: 'number', port: PORT.number, default: 0 },
        IY: { type: 'number', port: PORT.number, default: 0 }, X: { type: 'number', port: PORT.number, default: 0 },
        Y: { type: 'number', port: PORT.number, default: 0 } }, { sideEffects: ['state'] });
  def('physics_set_gravity_scale', 'physics', 'stack', 'escala gravedad [BID] = [SCALE]',
      { BID: { type: 'string', port: PORT.string }, SCALE: { type: 'number', port: PORT.number, default: 1 } },
      { sideEffects: ['state'] });
  def('physics_on_collision', 'physics', 'hat', 'al colisionar [A] con [B]',
      { A: { type: 'string', port: PORT.string }, B: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('physics_get_position', 'physics', 'reporter', 'posición [BID]',
      { BID: { type: 'string', port: PORT.string } }, { returns: 'json' });
  def('physics_get_velocity', 'physics', 'reporter', 'velocidad [BID]',
      { BID: { type: 'string', port: PORT.string } }, { returns: 'json' });
  def('physics_create_distance_joint', 'physics', 'stack', 'joint distancia [JID] entre [A] y [B] largo [LEN]',
      { JID: { type: 'string', port: PORT.string }, A: { type: 'string', port: PORT.string },
        B: { type: 'string', port: PORT.string }, LEN: { type: 'number', port: PORT.number, default: 1 } },
      { sideEffects: ['state'] });

  /* ===================================================================
   * 33. PHYSICS ADVANCED — Física avanzada (Raycast, Queries, Joints)
   * =================================================================== */
  
  /* ---- Raycast ---- */
  def('physics_raycast', 'physics', 'reporter', 'raycast desde X:[X] Y:[Y] dir X:[DX] Y:[DY] max:[MAXDIST] filtro:[FILTER]',
      { X: { type: 'number', port: PORT.number, default: 0 }, Y: { type: 'number', port: PORT.number, default: 0 },
        DX: { type: 'number', port: PORT.number, default: 1 }, DY: { type: 'number', port: PORT.number, default: 0 },
        MAXDIST: { type: 'number', port: PORT.number, default: 100 }, FILTER: { type: 'string', port: PORT.string, default: '' } },
      { returns: 'json' });
  
  /* ---- AABB Query ---- */
  def('physics_query_aabb', 'physics', 'reporter', 'query AABB min X:[MINX] Y:[MINY] max X:[MAXX] Y:[MAXY] filtro:[FILTER]',
      { MINX: { type: 'number', port: PORT.number }, MINY: { type: 'number', port: PORT.number },
        MAXX: { type: 'number', port: PORT.number }, MAXY: { type: 'number', port: PORT.number },
        FILTER: { type: 'string', port: PORT.string, default: '' } },
      { returns: 'json' });
  
  /* ---- Point Query ---- */
  def('physics_query_point', 'physics', 'reporter', 'query punto X:[X] Y:[Y] filtro:[FILTER]',
      { X: { type: 'number', port: PORT.number }, Y: { type: 'number', port: PORT.number },
        FILTER: { type: 'string', port: PORT.string, default: '' } },
      { returns: 'json' });
  
  /* ---- Collision Filter ---- */
  def('physics_set_collision_filter', 'physics', 'stack', 'filtro colisión [BID] = [FILTER]',
      { BID: { type: 'string', port: PORT.string }, FILTER: { type: 'string', port: PORT.string, default: 'default' } },
      { sideEffects: ['state'] });
  
  /* ---- Add Fixture ---- */
  def('physics_add_fixture', 'physics', 'stack', 'añadir fixture a [BID] forma:[SHAPE] radio:[RAD] ancho:[W] alto:[H] densidad:[DEN] fricción:[FRIC] restitución:[REST] sensor:[ISENSOR] offsetX:[OX] offsetY:[OY]',
      { BID: { type: 'string', port: PORT.string }, SHAPE: { type: 'dropdown', port: PORT.string, options: ['circle', 'polygon', 'box'], default: 'circle' },
        RAD: { type: 'number', port: PORT.number, default: 0.5 }, W: { type: 'number', port: PORT.number, default: 1 },
        H: { type: 'number', port: PORT.number, default: 1 }, DEN: { type: 'number', port: PORT.number, default: 1 },
        FRIC: { type: 'number', port: PORT.number, default: 0.3 }, REST: { type: 'number', port: PORT.number, default: 0.5 },
        ISENSOR: { type: 'boolean', port: PORT.boolean, default: false }, OX: { type: 'number', port: PORT.number, default: 0 },
        OY: { type: 'number', port: PORT.number, default: 0 } },
      { sideEffects: ['state'] });
  
  /* ---- Revolute Joint ---- */
  def('physics_create_revolute_joint', 'physics', 'stack', 'joint pivote [JID] [A]-[B] ancla X:[AX] Y:[AY] motor:[MOTOR] vel:[MSPEED] torque:[MTORQUE] límites:[LIMITS] min:[MINA] max:[MAXA]',
      { JID: { type: 'string', port: PORT.string }, A: { type: 'string', port: PORT.string }, B: { type: 'string', port: PORT.string },
        AX: { type: 'number', port: PORT.number, default: 0 }, AY: { type: 'number', port: PORT.number, default: 0 },
        MOTOR: { type: 'boolean', port: PORT.boolean, default: false }, MSPEED: { type: 'number', port: PORT.number, default: 0 },
        MTORQUE: { type: 'number', port: PORT.number, default: 1000 }, LIMITS: { type: 'boolean', port: PORT.boolean, default: false },
        MINA: { type: 'number', port: PORT.number, default: -3.14 }, MAXA: { type: 'number', port: PORT.number, default: 3.14 } },
      { sideEffects: ['state'] });
  
  /* ---- Prismatic Joint ---- */
  def('physics_create_prismatic_joint', 'physics', 'stack', 'joint prismático [JID] [A]-[B] ancla X:[AX] Y:[AY] eje X:[AXISX] Y:[AXISY] motor:[MOTOR] vel:[MSPEED] fuerza:[MFUERZA] límites:[LIMITS] min:[MIN] max:[MAX]',
      { JID: { type: 'string', port: PORT.string }, A: { type: 'string', port: PORT.string }, B: { type: 'string', port: PORT.string },
        AX: { type: 'number', port: PORT.number, default: 0 }, AY: { type: 'number', port: PORT.number, default: 0 },
        AXISX: { type: 'number', port: PORT.number, default: 1 }, AXISY: { type: 'number', port: PORT.number, default: 0 },
        MOTOR: { type: 'boolean', port: PORT.boolean, default: false }, MSPEED: { type: 'number', port: PORT.number, default: 0 },
        MFUERZA: { type: 'number', port: PORT.number, default: 1000 }, LIMITS: { type: 'boolean', port: PORT.boolean, default: false },
        MIN: { type: 'number', port: PORT.number, default: 0 }, MAX: { type: 'number', port: PORT.number, default: 10 } },
      { sideEffects: ['state'] });
  
  /* ---- Destroy Joint ---- */
  def('physics_destroy_joint', 'physics', 'stack', 'destruir joint [JID]',
      { JID: { type: 'string', port: PORT.string } },
      { sideEffects: ['state'] });

  /* ---- Animación (categoría engine) ---- */
  def('anim_mode', 'engine', 'stack', 'modo de formas [MODE]',
      { MODE: { type: 'string', port: PORT.string, default: 'idle' } }, { sideEffects: ['engine'] });
  def('anim_burst', 'engine', 'stack', 'ráfaga de formas [N]',
      { N: { type: 'number', port: PORT.number, default: 6 } }, { sideEffects: ['engine'] });
  def('anim_flash', 'engine', 'stack', 'destello de color [COLOR]',
      { COLOR: { type: 'string', port: PORT.string, default: '#ffffff' } }, { sideEffects: ['engine'] });
  def('anim_confetti', 'engine', 'stack', 'confeti', {}, { sideEffects: ['engine'] });
  def('anim_clear_fx', 'engine', 'stack', 'limpiar efectos de animación', {}, { sideEffects: ['engine'] });

  /* ===================================================================
   * 32. POWER PACK 3 — BLOQUES NUEVOS (Mejoras flagship)
   * Control, operadores, quiz, concursantes, runtime, looks.
   * =================================================================== */

  /* ---- Control: While Loop ---- */
  def('while_loop', 'control', 'c', 'mientras [COND]',
      { COND: { type: 'boolean', port: PORT.boolean } }, { bodies: ['body'] });

  /* ---- Control: For Each with Index ---- */
  def('for_each_with_index', 'control', 'c', 'para cada [VAR] con índice [IDX] en [LIST]',
      { VAR: { type: 'string', port: PORT.string }, IDX: { type: 'string', port: PORT.string, default: 'i' }, LIST: { type: 'string', port: PORT.string } }, { bodies: ['body'], sideEffects: ['state'] });

  /* ---- Operators: Clamp ---- */
  def('math_clamp', 'operators', 'reporter', '[VAL] clamp [MIN]..[MAX]',
      { VAL: { type: 'reporter', port: PORT.number, returns: 'number' }, MIN: { type: 'number', port: PORT.number, default: 0 }, MAX: { type: 'number', port: PORT.number, default: 100 } }, { returns: 'number' });

  /* ---- Operators: Type Of ---- */
  def('type_of', 'operators', 'reporter', 'tipo de [VAL]',
      { VAL: { type: 'input', port: PORT.any } }, { returns: 'string' });

  /* ---- Operators: Lerp ---- */
  def('math_lerp', 'operators', 'reporter', 'lerp [A] → [B] por [T]',
      { A: { type: 'reporter', port: PORT.number, returns: 'number' }, B: { type: 'reporter', port: PORT.number, returns: 'number' }, T: { type: 'reporter', port: PORT.number, returns: 'number' } }, { returns: 'number' });

  /* ---- Quiz: Is Paused ---- */
  def('quiz_is_paused', 'quiz', 'boolean', '¿quiz pausado?', {}, {});

  /* ---- Quiz: Get Round ---- */
  def('quiz_get_round', 'quiz', 'reporter', 'ronda actual', {}, { returns: 'number' });

  /* ---- Players: Get Score Of ---- */
  def('players_get_score_of', 'players', 'reporter', 'puntos de [PLAYER]',
      { PLAYER: { type: 'player_id', port: PORT.any } }, { returns: 'number' });

  /* ---- Runtime: Timer Is Paused ---- */
  def('timer_is_paused', 'runtime', 'boolean', '¿timer pausado?', {}, {});

  /* ---- Looks: Tween ---- */
  def('create_tween', 'looks', 'stack', 'tween [PROP] de [FROM] a [TO] en [DUR]ms',
      { PROP: { type: 'string', port: PORT.string }, FROM: { type: 'number', port: PORT.number, default: 0 }, TO: { type: 'number', port: PORT.number, default: 100 }, DUR: { type: 'number', port: PORT.number, default: 300 } }, { sideEffects: ['ui'] });

  /* ===================================================================
   * 33. PROCEDURES / MIS BLOQUES — Procedimientos personalizados
   * Define y llama tus propios bloques con parámetros.
   * =================================================================== */

  /* ---- Definir procedimiento (Hat) ---- */
  def('proc_def', 'procedures', 'hat', 'definir [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { bodies: ['body'], scope: 'procedure' });

  /* ---- Parámetro del procedimiento ---- */
  def('proc_param', 'procedures', 'reporter', 'parámetro [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'any' });

  /* ---- Llamar procedimiento ---- */
  def('proc_call', 'procedures', 'stack', 'llamar [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });

  /* ---- Llamar procedimiento con retorno ---- */
  def('proc_call_reporter', 'procedures', 'reporter', 'llamar [NAME] →',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'any' });

  /* ---- Llamar procedimiento booleano ---- */
  def('proc_call_boolean', 'procedures', 'boolean', '¿llamar [NAME]?',
      { NAME: { type: 'string', port: PORT.string } }, {});

  /* ---- Retornar valor del procedimiento ---- */
  def('proc_return', 'procedures', 'stack', 'retornar [VAL]',
      { VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });

  /* ===================================================================
   * 34. EVENTOS PERSONALIZADOS — Custom Events System
   * Dispara y escucha eventos con nombre dinámico.
   * =================================================================== */

  def('emit_event', 'events', 'stack', 'emitir evento [NAME] con [DATA]',
      { NAME: { type: 'string', port: PORT.string }, DATA: { type: 'input', port: PORT.any } }, { sideEffects: ['all'] });

  def('on_custom_event', 'events', 'hat', 'al recibir evento [NAME] → [DATA]',
      { NAME: { type: 'string', port: PORT.string } }, { scope: 'custom_event' });

  def('event_data', 'events', 'reporter', 'datos del evento', {}, { returns: 'any' });

  const ScratchBlocks = {
    CATEGORIES,
    PORT,
    registry: REGISTRY,

    get(opcode) { return REGISTRY[opcode] || null; },
    exists(opcode) { return opcode in REGISTRY; },
    all() { return Object.keys(REGISTRY); },

    byCategory(catId) {
      return Object.keys(REGISTRY)
        .map(k => REGISTRY[k])
        .filter(b => b.category === catId);
    },

    categoriesOrdered() {
      return Object.keys(CATEGORIES)
        .map(k => CATEGORIES[k])
        .sort((a, b) => a.order - b.order);
    },

    /* Valida que un puerto de salida (src) pueda conectarse a una entrada (dst).
       Mismo tipo de puerto = OK; 'any' acepta todo; reporter/boolean tipados coinciden. */
    portsCompatible(srcPort, dstPort) {
      if (!srcPort || !dstPort) return false;
      if (dstPort === PORT.any) return true;
      if (srcPort === PORT.any) return true;
      return srcPort === dstPort;
    }
  };

  global.ScratchBlocks = ScratchBlocks;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScratchBlocks };
  }
})(typeof window !== 'undefined' ? window : this);
