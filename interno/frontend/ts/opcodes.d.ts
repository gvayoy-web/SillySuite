/**
 * opcodes.d.ts — GENERATED FILE. Do not edit by hand.
 * Run: node scripts/gen_types.js
 *
 * Contratos de tipos derivados de scratch-blocks.js (REGISTRY).
 * Es la fuente única de verdad para los opcodes válidos de un mod.
 */

/* Tipos primitivos compartidos --------------------------------- */
export type BlockType = 'hat' | 'stack' | 'c' | 'reporter' | 'boolean';

export type PortType =
  | 'port-number'
  | 'port-string'
  | 'port-boolean'
  | 'port-color'
  | 'port-ndi'
  | 'port-display'
  | 'port-any';

export type SideEffect =
  | 'ndi' | 'db' | 'state' | 'display' | 'ui' | 'audio'
  | 'players' | 'quiz' | 'engine' | 'all' | 'unsafe';

export interface ArgDef {
  type: string;
  port: PortType;
  options?: string | string[];
  default?: unknown;
  accepts?: string;
  returns?: string;
}

export interface BlockDef {
  opcode: string;
  category: string;
  type: BlockType;
  text: string;
  args: Record<string, ArgDef>;
  hasBody: boolean;
  bodies: string[] | null;
  exec: 'event' | 'sync' | 'async';
  returns: string | null;
  sideEffects: SideEffect[];
  scope: string | null;
  disabledInProd: boolean;
}

export interface CategoryDef {
  id: string;
  label: string;
  colorVar: string;
  order: number;
  icon: string;
  desc: string;
}

/* Opcodes por categoría (string-literal-union) ------------------ */
export type EventsOpcode =
  | 'broadcast'
  | 'broadcast_and_wait'
  | 'emit_event'
  | 'event_data'
  | 'on_custom_event'
  | 'on_custom_signal'
  | 'on_hardware_disconnect'
  | 'on_mode_init'
  | 'on_player_answer'
  | 'on_player_buzz'
  | 'on_question_load'
  | 'on_question_start'
  | 'on_timer_expire'
  | 'when_i_receive'
  | 'when_i_start_as_clone';

export type ControlOpcode =
  | 'break_stack'
  | 'continue_loop'
  | 'exit_loop'
  | 'for_each_with_index'
  | 'if_then'
  | 'if_then_else'
  | 'panic_reset'
  | 'repeat_for_range'
  | 'repeat_times'
  | 'repeat_until'
  | 'try_catch_fallback'
  | 'wait_seconds'
  | 'wait_until_timestamp'
  | 'while_loop';

export type LooksOpcode =
  | 'announce'
  | 'ask_and_wait'
  | 'change_color_effect'
  | 'change_size'
  | 'change_x'
  | 'change_y'
  | 'clear_graphic_effects'
  | 'create_clone'
  | 'create_overlay'
  | 'create_tween'
  | 'delete_clone'
  | 'display_set_timer'
  | 'get_answer'
  | 'get_x'
  | 'get_y'
  | 'glide_to_xy'
  | 'go_to_xy'
  | 'hide_component'
  | 'hide_ui_component'
  | 'hide_variable'
  | 'key_pressed'
  | 'load_font'
  | 'mouse_x'
  | 'mouse_y'
  | 'move_component'
  | 'play_css_animation'
  | 'say'
  | 'screen_flash'
  | 'screen_shake'
  | 'set_background_image'
  | 'set_border'
  | 'set_component_property'
  | 'set_custom_theme'
  | 'set_filter'
  | 'set_gradient_bg'
  | 'set_opacity_block'
  | 'set_position'
  | 'set_rotation'
  | 'set_rounded_corners'
  | 'set_scale'
  | 'set_size'
  | 'set_text_shadow'
  | 'set_text_smooth'
  | 'set_theme'
  | 'set_x'
  | 'set_y'
  | 'show_component'
  | 'show_image'
  | 'show_ui_component'
  | 'show_variable'
  | 'show_video'
  | 'spawn_particle_emitter'
  | 'think'
  | 'toggle_fullscreen_layer'
  | 'trigger_scene_wipe';

export type AudioOpcode =
  | 'play_bg_music'
  | 'play_sfx'
  | 'play_sfx_by_name'
  | 'set_audio_category_volume'
  | 'set_master_volume'
  | 'stop_all_sounds'
  | 'stop_bg_music_fade'
  | 'trigger_audio_ducking';

export type NdiOpcode =
  | 'connect_source'
  | 'get_ndi_latency'
  | 'is_ndi_source_online'
  | 'ndi_disconnect_source'
  | 'ndi_send_canvas_scene'
  | 'ndi_set_frame_rate'
  | 'ndi_start_discovery_worker'
  | 'ndi_toggle_failover_image';

export type DisplaysOpcode =
  | 'clear_all_displays'
  | 'display_broadcast_payload'
  | 'display_register_setup'
  | 'display_sync_clocks'
  | 'get_display_connection_count'
  | 'set_grid_anchor'
  | 'set_layer_z_index';

export type QuizOpcode =
  | 'add_score'
  | 'answer_text'
  | 'correct_option'
  | 'difficulty'
  | 'init'
  | 'leaderboard'
  | 'lock_answers'
  | 'next_question'
  | 'option_count'
  | 'player_rank'
  | 'question_category'
  | 'question_image'
  | 'question_text'
  | 'quiz_get_round'
  | 'quiz_is_paused'
  | 'reset_scores'
  | 'reveal_answer'
  | 'score'
  | 'set_question'
  | 'shuffle_options'
  | 'timer_pause'
  | 'timer_remaining'
  | 'timer_resume'
  | 'timer_set'
  | 'total_questions'
  | 'verify_answer';

export type StateOpcode =
  | 'state_clear_volatile_cache'
  | 'state_commit_to_sqlite'
  | 'state_get_memory_value'
  | 'state_get_persistent'
  | 'state_increment_memory'
  | 'state_init_memory_key'
  | 'state_load_persistent'
  | 'state_set_memory'
  | 'state_set_persistent'
  | 'variable_change'
  | 'variable_get'
  | 'variable_init'
  | 'variable_set';

export type OperatorsOpcode =
  | 'and'
  | 'between'
  | 'binary'
  | 'case'
  | 'compare'
  | 'contains'
  | 'ends_with'
  | 'join'
  | 'json_key'
  | 'json_parse'
  | 'json_stringify'
  | 'length'
  | 'matches'
  | 'math'
  | 'math_clamp'
  | 'math_const'
  | 'math_lerp'
  | 'math_round_to'
  | 'not'
  | 'or'
  | 'random'
  | 'random_choice'
  | 'repeat'
  | 'replace'
  | 'slice'
  | 'split'
  | 'starts_with'
  | 'to_number'
  | 'trim'
  | 'type_of'
  | 'unary'
  | 'xor';

export type CustomOpcode =
  | 'for_each_in_list'
  | 'list_add_item'
  | 'list_contains'
  | 'list_count'
  | 'list_create'
  | 'list_delete_all'
  | 'list_get_item_at'
  | 'list_get_length'
  | 'list_get_random_item'
  | 'list_index_of'
  | 'list_insert_item'
  | 'list_join'
  | 'list_remove_index'
  | 'list_set_item'
  | 'list_shuffle'
  | 'list_sort'
  | 'pop'
  | 'reverse'
  | 'to_json'
  | 'unique';

export type PlayersOpcode =
  | 'alive'
  | 'all_names'
  | 'avatar'
  | 'award_bonus'
  | 'count'
  | 'eliminate'
  | 'fastest_buzzer'
  | 'get_var'
  | 'lockout'
  | 'max_players'
  | 'name'
  | 'players_get_score_of'
  | 'points'
  | 'rank'
  | 'revive'
  | 'send_message'
  | 'set_var'
  | 'show_effect'
  | 'sort_scores'
  | 'strike'
  | 'swap'
  | 'top_n';

export type DbOpcode =
  | 'db_query_exclude_last_questions'
  | 'db_query_filter_difficulty'
  | 'db_query_get_hint_text'
  | 'db_query_get_unanswered_count'
  | 'db_query_mark_as_burned'
  | 'db_query_search_by_keyword'
  | 'db_query_shuffle_answers';

export type RuntimeOpcode =
  | 'execute_raw_javascript'
  | 'get_current_time'
  | 'get_timestamp'
  | 'runtime_debug_log'
  | 'runtime_export_json'
  | 'runtime_hot_reload'
  | 'runtime_snapshot_take'
  | 'system_replicate_state_to_node'
  | 'timer_is_paused';

export type EngineOpcode =
  | 'anim_burst'
  | 'anim_clear_fx'
  | 'anim_confetti'
  | 'anim_flash'
  | 'anim_mode'
  | 'engine_create_player_client'
  | 'engine_get_leaderboard_data'
  | 'engine_load_game_template'
  | 'engine_on_client_event'
  | 'render_update_proyector_leaderboard';

export type SpritesOpcode =
  | 'sprite_destroy'
  | 'sprite_is_touching'
  | 'sprite_move_to'
  | 'sprite_on_collision'
  | 'sprite_set_animation'
  | 'sprite_set_velocity'
  | 'sprite_spawn';

export type PhysicsOpcode =
  | 'physics_add_fixture'
  | 'physics_apply_force'
  | 'physics_apply_impulse'
  | 'physics_create_body'
  | 'physics_create_distance_joint'
  | 'physics_create_prismatic_joint'
  | 'physics_create_revolute_joint'
  | 'physics_destroy_body'
  | 'physics_destroy_joint'
  | 'physics_disable'
  | 'physics_enable'
  | 'physics_get_position'
  | 'physics_get_velocity'
  | 'physics_on_collision'
  | 'physics_query_aabb'
  | 'physics_query_point'
  | 'physics_raycast'
  | 'physics_set_collision_filter'
  | 'physics_set_gravity_scale'
  | 'physics_set_velocity';

export type ProceduresOpcode =
  | 'proc_call'
  | 'proc_call_boolean'
  | 'proc_call_reporter'
  | 'proc_def'
  | 'proc_param'
  | 'proc_return';

/* Interfaz del registro (espejo de scratch-blocks.js) ----------- */
export interface ScratchBlocks {
  CATEGORIES: Record<string, CategoryDef>;
  PORT: Record<string, PortType>;
  registry: Record<string, BlockDef>;
  get(opcode: string): BlockDef | null;
  exists(opcode: string): boolean;
  all(): string[];
  byCategory(catId: string): BlockDef[];
  categoriesOrdered(): CategoryDef[];
  portsCompatible(srcPort: string, dstPort: string): boolean;
}
