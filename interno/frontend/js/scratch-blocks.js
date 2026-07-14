/**
 * scratch-blocks.js — Registro maestro de opcodes + compilador AOT
 * Infinite Canvas Builder v3.0 (SillyQuiz)
 *
 * Define la estructura lógica de todos los bloques atómicos y cómo se
 * compilan a una máquina de estados JSON pura que el backend Python valida
 * de un golpe (cero interpretación en caliente durante el show).
 *
 * Sin dependencias externas. Expone window.ScratchBlocks y window.ScratchAOT.
 */

(function (global) {
  'use strict';

  /* ===================================================================
   * CATEGORÍAS — colorVar apunta a las CSS vars de scratch-blocks.css
   * (las clases .block-* se añaden en la fase de estilos CSS final).
   * =================================================================== */
  const CATEGORIES = {
    events:    { id: 'events',    label: 'Eventos',             colorVar: '--cat-events',       order: 1 },
    control:   { id: 'control',   label: 'Control',             colorVar: '--cat-control',      order: 2 },
    looks:     { id: 'looks',     label: 'Looks / Visual',      colorVar: '--cat-looks',        order: 3 },
    audio:     { id: 'audio',     label: 'Audio',               colorVar: '--cat-sound',        order: 4 },
    ndi:       { id: 'ndi',       label: 'NDI / Broadcast',     colorVar: '--cat-ndi',          order: 5 },
    displays:  { id: 'displays',  label: 'Multi-Display',       colorVar: '--cat-displays',     order: 6 },
    quiz:      { id: 'quiz',      label: 'Quiz / Juego',        colorVar: '--cat-motion',       order: 7 },
    state:     { id: 'state',     label: 'Estado / Variables',  colorVar: '--cat-variables',    order: 8 },
    operators: { id: 'operators', label: 'Operadores',          colorVar: '--cat-operators',    order: 9 },
    custom:    { id: 'custom',    label: 'Listas / Custom',     colorVar: '--cat-custom',       order: 10 },
    players:   { id: 'players',   label: 'Concursantes',        colorVar: '--cat-players',      order: 11 },
    db:        { id: 'db',        label: 'Query Engine',        colorVar: '--cat-db',           order: 12 },
    runtime:   { id: 'runtime',   label: 'Runtime / Sistema',   colorVar: '--cat-runtime',      order: 13 },
    engine:    { id: 'engine',    label: 'Engine / Game',        colorVar: '--cat-engine',       order: 14 },
    sprites:   { id: 'sprites',   label: 'Engine Sprites',       colorVar: '--cat-sprites',      order: 15 }
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
  def('inject_css_raw', 'looks', 'stack', 'inyectar CSS en [DISP]: [CSS]',
      { DISP: { type: 'display_id', port: PORT.display }, CSS: { type: 'textarea', port: PORT.any } }, { sideEffects: ['ui'] });
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
  def('execute_raw_javascript', 'custom', 'stack', 'JS: [CODE]',
      { CODE: { type: 'textarea', port: PORT.any } }, { sideEffects: ['unsafe'], disabledInProd: true });

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
  def('list_create', 'custom', 'stack', 'crear lista [NAME]',
      { NAME: { type: 'string', port: PORT.string } }, { sideEffects: ['state'] });
  def('list_add_item', 'custom', 'stack', 'lista [NAME] += [VAL]',
      { NAME: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any } }, { sideEffects: ['state'] });
  def('list_delete_item', 'custom', 'stack', 'lista [NAME] quitar ítem [IDX]',
      { NAME: { type: 'string', port: PORT.string }, IDX: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['state'] });
  def('list_insert_item', 'custom', 'stack', 'lista [NAME] insertar [VAL] en [IDX]',
      { NAME: { type: 'string', port: PORT.string }, VAL: { type: 'input', port: PORT.any }, IDX: { type: 'number', port: PORT.number, default: 1 } }, { sideEffects: ['state'] });
  def('list_get_item', 'custom', 'reporter', 'lista [NAME] ítem [IDX]',
      { NAME: { type: 'string', port: PORT.string }, IDX: { type: 'number', port: PORT.number, default: 1 } }, { returns: 'any' });
  def('list_length', 'custom', 'reporter', 'lista [NAME] largo',
      { NAME: { type: 'string', port: PORT.string } }, { returns: 'number' });
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
   * API de consulta
   * =================================================================== */
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

  /* ===================================================================
   * COMPILADOR AOT
   * Convierte el árbol de instancias de bloques en una máquina de estados
   * JSON pura y validada. Estructura de entrada (scripts):
   *   {
   *     on_mode_init: [ blockInstance, ... ],
   *     ...
   *   }
   * blockInstance = {
   *   opcode, args:{TOKEN:value}, next: blockInstance|null,
   *   body: blockInstance|null, elseBody: blockInstance|null
   * }
   * =================================================================== */
  const ScratchAOT = {
    VERSION: 2,

    /* Tope de seguridad: una cadena lineal no debe superar este largo.
       Si lo hace, la compilación FALLA explícitamente (antes se truncaba
       en silencio en el render, perdiendo bloques). */
    MAX_CHAIN: 1000,
    MAX_NESTING: 8,

    /** Valida y coerce un valor de argumento contra su especificación. */
    _coerce(token, spec, raw) {
      if (spec == null) return raw;
      switch (spec.type) {
        case 'number':
        case 'slider': {
          if (raw === '' || raw == null) return spec.default || 0;
          const num = Number(raw);
          return Number.isNaN(num) ? (spec.default || 0) : num;
        }
        case 'boolean':
          return raw === true || raw === 'true' || raw === 1 || raw === '1';
        case 'dropdown':
          if (Array.isArray(spec.options) && !spec.options.includes(raw) && raw !== '@ndi_sources' && raw !== '@context') {
            return spec.options[0];
          }
          return raw;
        case 'textarea':
        case 'string':
        case 'input':
        case 'id':
        case 'display_id':
        case 'output_id':
        case 'source_id':
        case 'player_id':
        case 'audio_file':
        case 'image_file':
        default:
          return raw == null ? (spec.default != null ? spec.default : '') : raw;
      }
    },

    /** Validación profunda de bloques anidados. */
    _validateBlock(block, depth, errors) {
      if (!block) return true;
      if (depth > this.MAX_NESTING) {
        errors.push('Anidación máxima de ' + this.MAX_NESTING + ' niveles excedida');
        return false;
      }
      if (!block.opcode || !ScratchBlocks.exists(block.opcode)) {
        errors.push('Opcode inválido: ' + (block.opcode || 'null'));
        return false;
      }
      const defn = REGISTRY[block.opcode];
      if (!defn) {
        errors.push('Opcode no registrado: ' + block.opcode);
        return false;
      }
      // Validate required args
      Object.keys(defn.args).forEach(token => {
        const spec = defn.args[token];
        const val = (block.args || {})[token];
        if (val === undefined || val === null || val === '') {
          if (spec.default === undefined && spec.type !== 'boolean') {
            errors.push('Argumento requerido faltante: ' + token + ' en ' + block.opcode);
          }
        }
      });
      return true;
    },

    _serialize(block, depth) {
      if (!block || !ScratchBlocks.exists(block.opcode)) return null;
      depth = depth || 0;
      if (depth >= ScratchAOT.MAX_CHAIN) {
        throw new Error('AOT: cadena supera el máximo de ' + ScratchAOT.MAX_CHAIN + ' bloques');
      }
      const defn = REGISTRY[block.opcode];
      const args = {};
      Object.keys(defn.args).forEach(token => {
        args[token] = this._coerce(token, defn.args[token], (block.args || {})[token]);
      });
      const node = { opcode: block.opcode, args };
      if (defn.hasBody) {
        defn.bodies.forEach(b => {
          node[b] = this._serializeChain(block[b], depth + 1);
        });
      }
      if (block.next) {
        node.next = Array.isArray(block.next)
          ? this._serializeChain(block.next, depth + 1)
          : [this._serialize(block.next, depth + 1)];
      }
      if (block._id != null) node._id = block._id;
      return node;
    },

    _serializeChain(head, depth) {
      depth = depth || 0;
      if (Array.isArray(head)) {
        return head.map(h => this._serialize(h, depth)).filter(Boolean);
      }
      return [this._serialize(head, depth)];
    },

    /** Compila todos los scripts a máquina de estados. */
    compile(scripts, opts) {
      opts = opts || {};
      const events = {};
      let blockCount = 0;
      const errors = [];
      Object.keys(scripts || {}).forEach(eventOpcode => {
        const defn = REGISTRY[eventOpcode];
        if (!defn || defn.type !== 'hat') {
          throw new Error('AOT: "' + eventOpcode + '" no es un bloque Hat válido');
        }
        events[eventOpcode] = this._serializeChain(scripts[eventOpcode]);
        blockCount += this._countChain(scripts[eventOpcode]);
      });
      const machine = {
        version: this.VERSION,
        compiledAt: new Date().toISOString(),
        engine: 'scratch-aot',
        blockCount,
        events,
        hotReload: !!opts.hotReload,
        preserveState: opts.preserve || null,
        snapshotRef: opts.snapshot || null
      };
      if (opts.previousCompiledAt) machine.previousCompiledAt = opts.previousCompiledAt;
      return machine;
    },

    /** Recompila sin perder la partida en curso. Toma la máquina previa y los
     *  nuevos scripts, y produce una máquina marcada hotReload que el runtime
     *  rehidrata con el snapshot de RAM existente (Visual Stepper lo resalta). */
    hotReload(prevMachine, scripts, opts) {
      opts = opts || {};
      const merged = Object.assign({}, opts, {
        hotReload: true,
        previousCompiledAt: prevMachine && prevMachine.compiledAt,
        snapshot: opts.snapshot || (prevMachine && prevMachine.snapshotRef) || null
      });
      return this.compile(scripts, merged);
    },

    _countChain(head) {
      if (Array.isArray(head)) {
        return head.reduce((acc, h) => acc + this._countChain(h), 0);
      }
      let n = 0, cur = head;
      while (cur) {
        const d = REGISTRY[cur.opcode];
        n++;
        if (d && d.hasBody && d.bodies) {
          d.bodies.forEach(b => { n += this._countChain(cur[b]); });
        }
        cur = cur.next;
      }
      return n;
    },

    /** Validación de integridad: referencias, tipos de puerto y bloques inseguros. */
    validate(machine, opts) {
      opts = opts || {};
      const errors = [];
      const walk = (chain, inProd) => {
        (chain || []).forEach(node => {
          const d = REGISTRY[node.opcode];
          if (!d) { errors.push('opcode desconocido: ' + node.opcode); return; }
          if (inProd && d.disabledInProd) {
            errors.push('bloque inseguro en producción: ' + node.opcode);
          }
          // Validar tipos de puerto en args tipo reporter/boolean
          Object.keys(d.args).forEach(tok => {
            const spec = d.args[tok];
            if ((spec.type === 'reporter' || spec.type === 'boolean') && node.args[tok] != null) {
              const child = node.args[tok];
              if (child && child.opcode) {
                const cd = REGISTRY[child.opcode];
                if (cd && cd.returns && spec.returns && spec.returns !== 'any' && cd.returns !== 'any') {
                  if (spec.returns !== cd.returns) {
                    errors.push(node.opcode + '.' + tok + ': tipo ' + cd.returns + ' no compatible con ' + spec.returns);
                  }
                }
              }
            }
          });
          if (d.hasBody && d.bodies) d.bodies.forEach(b => walk(node[b], inProd));
        });
      };
      Object.keys(machine.events).forEach(ev => walk(machine.events[ev], opts.production));
      return { valid: errors.length === 0, errors };
    }
  };

  global.ScratchBlocks = ScratchBlocks;
  global.ScratchAOT = ScratchAOT;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScratchBlocks, ScratchAOT };
  }
})(typeof window !== 'undefined' ? window : this);
