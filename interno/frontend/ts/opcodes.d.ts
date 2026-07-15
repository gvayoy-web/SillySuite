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
  | 'global_panic_reset'
  | 'if_then'
  | 'if_then_else'
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
  | 'get_ndi_latency'
  | 'is_ndi_source_online'
  | 'ndi_connect_source'
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
  | 'get_timer_remaining'
  | 'quiz_add_score_to_player'
  | 'quiz_fetch_next_question'
  | 'quiz_get_answer_text'
  | 'quiz_get_correct_option'
  | 'quiz_get_current_question_text'
  | 'quiz_get_difficulty'
  | 'quiz_get_leaderboard_json'
  | 'quiz_get_option_count'
  | 'quiz_get_player_rank'
  | 'quiz_get_question_category'
  | 'quiz_get_question_image'
  | 'quiz_get_round'
  | 'quiz_get_score'
  | 'quiz_get_total_questions'
  | 'quiz_init_engine'
  | 'quiz_is_paused'
  | 'quiz_lock_answers'
  | 'quiz_reset_scores'
  | 'quiz_reveal_answer'
  | 'quiz_set_question'
  | 'quiz_shuffle_options'
  | 'quiz_verify_player_answer'
  | 'set_timer_duration'
  | 'timer_pause'
  | 'timer_resume';

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
  | 'get_random_number'
  | 'json_parse'
  | 'json_stringify'
  | 'logic_and_or'
  | 'logic_between'
  | 'logic_compare'
  | 'logic_not'
  | 'logic_xor'
  | 'math_binary'
  | 'math_calc'
  | 'math_clamp'
  | 'math_const'
  | 'math_lerp'
  | 'math_round_to'
  | 'math_unary'
  | 'parse_json_key'
  | 'random_choice'
  | 'string_case'
  | 'string_contains'
  | 'string_ends_with'
  | 'string_join'
  | 'string_length'
  | 'string_matches'
  | 'string_repeat'
  | 'string_replace'
  | 'string_slice'
  | 'string_split'
  | 'string_starts_with'
  | 'string_to_number'
  | 'string_trim'
  | 'type_of';

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
  | 'list_pop'
  | 'list_remove_index'
  | 'list_reverse'
  | 'list_set_item'
  | 'list_shuffle'
  | 'list_sort'
  | 'list_to_json'
  | 'list_unique';

export type PlayersOpcode =
  | 'players_award_bonus'
  | 'players_eliminate'
  | 'players_get_all_names'
  | 'players_get_count'
  | 'players_get_fastest_buzzer'
  | 'players_get_name'
  | 'players_get_points'
  | 'players_get_rank'
  | 'players_get_score_of'
  | 'players_get_top_n'
  | 'players_get_var'
  | 'players_is_alive'
  | 'players_revive'
  | 'players_send_message'
  | 'players_set_active_slots'
  | 'players_set_avatar'
  | 'players_set_var'
  | 'players_show_effect'
  | 'players_sort_by_score'
  | 'players_strike_penalize'
  | 'players_swap_positions'
  | 'players_toggle_lockout';

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
