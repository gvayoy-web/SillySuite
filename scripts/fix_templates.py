#!/usr/bin/env python3
"""fix_templates.py — Rewrite all scratch templates with valid JSON."""
import json
from pathlib import Path

SCRATCH_DIR = Path(__file__).parent.parent / "interno" / "modo_templates" / "scratch"


def block(opcode, args=None, nxt=None):
    b = {"opcode": opcode, "args": args or {}}
    if nxt is not None:
        b["next"] = nxt
    return b


def chain(*blocks):
    """Chain blocks: chain(a, b, c) -> a.next=b, b.next=c"""
    for i in range(len(blocks) - 1):
        blocks[i]["next"] = blocks[i + 1]
    return blocks[0]


# =============================================================================
# quiz_capitales.json
# =============================================================================
init = chain(
    block("set_custom_theme", {"BG": "#0b0b0b", "TXT": "#f4f2ec", "ACC": "#FF5E3A", "FNT": "system-ui"}),
    block("set_text_shadow", {"COMP": "titulo-principal", "X": 3, "Y": 3, "BLR": 6, "CLR": "#000000"}),
    block("quiz_init_engine", {"N": 20, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "media"}),
    block("db_query_exclude_last_questions", {"N": 5}),
    block("db_query_shuffle_answers", {}),
    block("players_set_active_slots", {"N": 4}),
    block("state_init_memory_key", {"KEY": "pregunta_actual", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_preguntas", "DEF": 20}),
    block("state_init_memory_key", {"KEY": "puntos_ronda", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "aciertos_ronda", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "fallos_ronda", "DEF": 0}),
    block("show_variable", {"VAR": "pregunta_actual", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "aciertos_ronda", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "QUIZ DE CAPITALES"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "20 preguntas de conocimiento general"}),
    block("play_bg_music", {"FILE": "quiz-theme.mp3", "VOL": 30, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 15}),
    block("set_text_smooth", {"COMP": "footer", "TXT": "4 jugadores - Puntuacion segun velocidad"}),
)

qload = chain(
    block("state_set_memory", {"KEY": "puntos_ronda", "VAL": 0}),
    block("state_set_memory", {"KEY": "aciertos_ronda", "VAL": 0}),
    block("state_set_memory", {"KEY": "fallos_ronda", "VAL": 0}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": ""}),
    block("trigger_scene_wipe", {"WIPE": "glitch"}),
    block("play_sfx", {"FILE": "whoosh.mp3", "VOL": 35, "PITCH": False}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("state_increment_memory", {"KEY": "pregunta_actual", "BY": 1}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta de conocimiento"}),
    block("play_sfx", {"FILE": "bell.mp3", "VOL": 55, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 30}),
    block("wait_seconds", {"SEC": 12}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 70, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("state_increment_memory", {"KEY": "aciertos_ronda", "BY": 1}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 10}),
    block("state_increment_memory", {"KEY": "puntos_ronda", "BY": 10}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "CORRECTO! +10 pts"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 75, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 40}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

timer = chain(
    block("state_increment_memory", {"KEY": "fallos_ronda", "BY": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO AGOTADO!"}),
    block("play_sfx", {"FILE": "alarm.mp3", "VOL": 75, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

quiz_capitales = {
    "id": "quiz_capitales", "title": "Quiz de Capitales",
    "description": "Quiz completo con engine de preguntas, leaderboard en vivo, scoring por velocidad.",
    "tags": ["quiz", "trivia", "completo", "leaderboard"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_load": [qload],
              "on_question_start": [qstart], "on_player_answer": [answer],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "quiz_capitales.json", "w", encoding="utf-8") as f:
    json.dump(quiz_capitales, f, ensure_ascii=False, indent=2)
print("quiz_capitales.json: OK")


# =============================================================================
# trivia_si_no.json
# =============================================================================
init = chain(
    block("set_gradient_bg", {"DIR": "\u2192", "C1": "#1a0f00", "C2": "#0d1117"}),
    block("set_custom_theme", {"BG": "transparent", "TXT": "#d4a574", "ACC": "#e8b848", "FNT": "Georgia, serif"}),
    block("quiz_init_engine", {"N": 15, "CAT": "biblia_db"}),
    block("players_set_active_slots", {"N": 4}),
    block("state_init_memory_key", {"KEY": "ronda_actual", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_rondas", "DEF": 15}),
    block("state_init_memory_key", {"KEY": "racha_global", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "total_correctas", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "total_incorrectas", "DEF": 0}),
    block("show_variable", {"VAR": "ronda_actual", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "racha_global", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TRIVIA SI / NO"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Verdadero o Falso - A demostrar tu conocimiento!"}),
    block("play_bg_music", {"FILE": "trivia-theme.mp3", "VOL": 35, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 15}),
    block("play_sfx", {"FILE": "bell.mp3", "VOL": 60, "PITCH": False}),
    block("set_text_smooth", {"COMP": "footer", "TXT": "15 preguntas - 10 segundos cada una"}),
)

qload = chain(
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": ""}),
    block("trigger_scene_wipe", {"WIPE": "glitch"}),
    block("play_sfx", {"FILE": "whoosh.mp3", "VOL": 40, "PITCH": False}),
    block("state_init_memory_key", {"KEY": "respuesta_actual", "DEF": ""}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta de ronda actual"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "VERDADERO O FALSO?"}),
    block("play_sfx", {"FILE": "ding.mp3", "VOL": 55, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 30}),
    block("wait_seconds", {"SEC": 10}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 75, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("state_increment_memory", {"KEY": "ronda_actual", "BY": 1}),
    block("state_increment_memory", {"KEY": "racha_global", "BY": 1}),
    block("state_increment_memory", {"KEY": "total_correctas", "BY": 1}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 5}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "CORRECTO! +5 pts"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 75, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

timer = chain(
    block("state_set_memory", {"KEY": "racha_global", "VAL": 0}),
    block("state_increment_memory", {"KEY": "total_incorrectas", "BY": 1}),
    block("state_increment_memory", {"KEY": "ronda_actual", "BY": 1}),
    block("play_sfx", {"FILE": "times-up.mp3", "VOL": 90, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO!"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

trivia_si_no = {
    "id": "trivia_si_no", "title": "Trivia Si / No",
    "description": "Trivia rapida con scoring condicional, rachas de aciertos, progreso visual.",
    "tags": ["trivia", "si-no", "rapido", "rachas"], "difficulty": "media",
    "heads": {"on_mode_init": [init], "on_question_load": [qload],
              "on_question_start": [qstart], "on_player_answer": [answer],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "trivia_si_no.json", "w", encoding="utf-8") as f:
    json.dump(trivia_si_no, f, ensure_ascii=False, indent=2)
print("trivia_si_no.json: OK")


# =============================================================================
# battle_1v1.json
# =============================================================================
init = chain(
    block("set_gradient_bg", {"DIR": "\u2192", "C1": "#0a0a2e", "C2": "#2d0a0a"}),
    block("set_custom_theme", {"BG": "transparent", "TXT": "#e0e0e0", "ACC": "#ff4444", "FNT": "Impact, sans-serif"}),
    block("quiz_init_engine", {"N": 20, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "media"}),
    block("players_set_active_slots", {"N": 2}),
    block("state_init_memory_key", {"KEY": "turno", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "puntos_j1", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "puntos_j2", "DEF": 0}),
    block("show_variable", {"VAR": "puntos_j1", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "puntos_j2", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "BATALLA 1v1"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Jugador 1 vs Jugador 2 - Que gane el mejor!"}),
    block("play_bg_music", {"FILE": "battle-theme.mp3", "VOL": 40, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 20, "Y": 30}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 80, "Y": 30}),
    block("play_sfx", {"FILE": "sword-clash.mp3", "VOL": 70, "PITCH": False}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("state_increment_memory", {"KEY": "turno", "BY": 1}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta de duelo"}),
    block("play_sfx", {"FILE": "sword-clash.mp3", "VOL": 65, "PITCH": False}),
    block("wait_seconds", {"SEC": 12}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 70, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO! - Punto perdido"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 10}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Jugador anota +10!"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 80, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 40}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

timer = chain(
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO! - Punto perdido"}),
    block("play_sfx", {"FILE": "miss.mp3", "VOL": 75, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

battle_1v1 = {
    "id": "battle_1v1", "title": "Batalla 1v1",
    "description": "Duelo directo entre dos jugadores con alternancia de turnos y marcador en vivo.",
    "tags": ["batalla", "1v1", "duelo", "competitivo"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_start": [qstart],
              "on_player_answer": [answer], "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "battle_1v1.json", "w", encoding="utf-8") as f:
    json.dump(battle_1v1, f, ensure_ascii=False, indent=2)
print("battle_1v1.json: OK")


# =============================================================================
# survival_mode.json
# =============================================================================
init = chain(
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#0d0d0d", "C2": "#1a0000"}),
    block("set_custom_theme", {"BG": "transparent", "TXT": "#ff6b6b", "ACC": "#ff4444", "FNT": "monospace"}),
    block("quiz_init_engine", {"N": 30, "CAT": "biblia_db"}),
    block("db_query_filter_difficulty", {"D": "dificil"}),
    block("db_query_exclude_last_questions", {"N": 3}),
    block("players_set_active_slots", {"N": 6}),
    block("state_init_memory_key", {"KEY": "ronda", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "jugadores_vivos", "DEF": 6}),
    block("show_variable", {"VAR": "jugadores_vivos", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "ronda", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "MODO SUPERVIVENCIA"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "6 jugadores - 3 strikes = eliminacion"}),
    block("play_bg_music", {"FILE": "suspense.mp3", "VOL": 45, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 10}),
    block("play_sfx", {"FILE": "sword-clash.mp3", "VOL": 70, "PITCH": False}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("state_increment_memory", {"KEY": "ronda", "BY": 1}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Ronda de supervivencia"}),
    block("play_sfx", {"FILE": "drumroll.mp3", "VOL": 55, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 30}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "RONDA"}),
    block("wait_seconds", {"SEC": 10}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 80, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 15}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "SOBREVIVES! +15 pts"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 80, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

buzz = chain(
    block("players_strike_penalize", {"PLAYER": "current"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "STRIKE! Fallo registrado"}),
    block("play_sfx", {"FILE": "strike.mp3", "VOL": 85, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

timer = chain(
    block("players_toggle_lockout", {"PLAYER": "slowest", "ON": True}),
    block("state_increment_memory", {"KEY": "eliminaciones", "BY": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "ELIMINADO!"}),
    block("play_sfx", {"FILE": "elimination.mp3", "VOL": 90, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 40}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Un jugador ha sido eliminado"}),
    block("trigger_scene_wipe", {"WIPE": "slide"}),
)

survival_mode = {
    "id": "survival_mode", "title": "Modo Supervivencia",
    "description": "Eliminacion progresiva. Ultimo en pie gana. Incluye strikes y lockouts.",
    "tags": ["supervivencia", "eliminacion", "competitivo"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_start": [qstart],
              "on_player_answer": [answer], "on_player_buzz": [buzz],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "survival_mode.json", "w", encoding="utf-8") as f:
    json.dump(survival_mode, f, ensure_ascii=False, indent=2)
print("survival_mode.json: OK")


# =============================================================================
# rapid_fire.json
# =============================================================================
init = chain(
    block("set_gradient_bg", {"DIR": "\u2198", "C1": "#0a0a2e", "C2": "#2e0a0a"}),
    block("set_custom_theme", {"BG": "transparent", "TXT": "#00ff88", "ACC": "#ff00ff", "FNT": "monospace"}),
    block("quiz_init_engine", {"N": 25, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "facil"}),
    block("db_query_shuffle_answers", {}),
    block("players_set_active_slots", {"N": 4}),
    block("state_init_memory_key", {"KEY": "pregunta_actual", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_preguntas", "DEF": 25}),
    block("state_init_memory_key", {"KEY": "combo_actual", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "puntos_ronda", "DEF": 0}),
    block("show_variable", {"VAR": "combo_actual", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "puntos_ronda", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "RAPID FIRE"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "25 preguntas - 5 segundos - Velocidad extrema!"}),
    block("play_bg_music", {"FILE": "intense-beat.mp3", "VOL": 50, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 10}),
    block("play_sfx", {"FILE": "whoosh.mp3", "VOL": 65, "PITCH": False}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("state_increment_memory", {"KEY": "pregunta_actual", "BY": 1}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta rapida"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "GO!"}),
    block("play_sfx", {"FILE": "whoosh.mp3", "VOL": 60, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 30}),
    block("wait_seconds", {"SEC": 5}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 80, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "FUERA DE TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 40}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("state_increment_memory", {"KEY": "combo_actual", "BY": 1}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 5}),
    block("state_increment_memory", {"KEY": "puntos_ronda", "BY": 5}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "CORRECTO! +5 pts"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 75, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

buzz = chain(
    block("players_strike_penalize", {"PLAYER": "current"}),
    block("state_set_memory", {"KEY": "combo_actual", "VAL": 0}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "STRIKE! Combo perdido"}),
    block("play_sfx", {"FILE": "wrong.mp3", "VOL": 80, "PITCH": False}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

timer = chain(
    block("state_set_memory", {"KEY": "combo_actual", "VAL": 0}),
    block("play_sfx", {"FILE": "alarm.mp3", "VOL": 85, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "FUERA DE TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Combo perdido - Siguiente pregunta..."}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 40}),
)

rapid_fire = {
    "id": "rapid_fire", "title": "Rapid Fire Challenge",
    "description": "Rafaga de preguntas rapidas contra el cronometro. Sistema de combos y scoring progresivo.",
    "tags": ["rapido", "contrarreloj", "rafaga", "combo"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_start": [qstart],
              "on_player_answer": [answer], "on_player_buzz": [buzz],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "rapid_fire.json", "w", encoding="utf-8") as f:
    json.dump(rapid_fire, f, ensure_ascii=False, indent=2)
print("rapid_fire.json: OK")


# =============================================================================
# quiz_show.json
# =============================================================================
init = chain(
    block("set_custom_theme", {"BG": "#1a0f00", "TXT": "#e8d5b7", "ACC": "#e8b848", "FNT": "Georgia, serif"}),
    block("set_text_shadow", {"COMP": "titulo-principal", "X": 2, "Y": 2, "BLR": 4, "CLR": "#000000"}),
    block("quiz_init_engine", {"N": 15, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "facil"}),
    block("db_query_shuffle_answers", {}),
    block("players_set_active_slots", {"N": 3}),
    block("state_init_memory_key", {"KEY": "pregunta_num", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_preguntas", "DEF": 15}),
    block("state_init_memory_key", {"KEY": "puntos_total", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "aciertos_consecutivos", "DEF": 0}),
    block("show_variable", {"VAR": "puntos_total", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "pregunta_num", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "QUIZ SHOW"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "El programa de conocimiento mas emocionante"}),
    block("play_bg_music", {"FILE": "show-theme.mp3", "VOL": 35, "LOOP": True}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 10}),
    block("play_sfx", {"FILE": "bell.mp3", "VOL": 65, "PITCH": False}),
    block("set_text_smooth", {"COMP": "footer", "TXT": "15 preguntas - 3 jugadores - Dificultad progresiva"}),
)

qload = chain(
    block("state_set_memory", {"KEY": "aciertos_consecutivos", "VAL": 0}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": ""}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": ""}),
    block("trigger_scene_wipe", {"WIPE": "fade"}),
    block("play_sfx", {"FILE": "drumroll.mp3", "VOL": 50, "PITCH": False}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("state_increment_memory", {"KEY": "pregunta_num", "BY": 1}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta del show"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Pregunta"}),
    block("play_sfx", {"FILE": "ding.mp3", "VOL": 60, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "elastic-in"}),
    block("wait_seconds", {"SEC": 18}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 80, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "SE ACABO EL TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("state_increment_memory", {"KEY": "aciertos_consecutivos", "BY": 1}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 10}),
    block("state_increment_memory", {"KEY": "puntos_total", "BY": 10}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "CORRECTO! +10 pts"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 80, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

timer = chain(
    block("state_set_memory", {"KEY": "aciertos_consecutivos", "VAL": 0}),
    block("play_sfx", {"FILE": "times-up.mp3", "VOL": 85, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "SE ACABO EL TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Nadie respondio a tiempo"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 40}),
)

quiz_show = {
    "id": "quiz_show", "title": "Quiz Show TV",
    "description": "Estilo programa de television con preguntas progresivas, pistas y efectos dramaticos.",
    "tags": ["quiz-show", "tv", "progresivo", "dramatico"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_load": [qload],
              "on_question_start": [qstart], "on_player_answer": [answer],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "quiz_show.json", "w", encoding="utf-8") as f:
    json.dump(quiz_show, f, ensure_ascii=False, indent=2)
print("quiz_show.json: OK")


# =============================================================================
# encuesta_satisfaccion.json
# =============================================================================
init = chain(
    block("set_custom_theme", {"BG": "#0d1117", "TXT": "#c9d1d9", "ACC": "#58a6ff", "FNT": "system-ui"}),
    block("state_init_memory_key", {"KEY": "total_respuestas", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "suma_puntos", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "pregunta_actual", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_preguntas", "DEF": 5}),
    block("show_variable", {"VAR": "total_respuestas", "DISP": "display-principal"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "ENCUESTA DE SATISFACCION"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Tu opinion nos ayuda a mejorar"}),
    block("play_bg_music", {"FILE": "ambient-calm.mp3", "VOL": 25, "LOOP": True}),
    block("set_text_smooth", {"COMP": "footer", "TXT": "5 preguntas rapidas - Tu voto cuenta"}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 10}),
    block("play_sfx", {"FILE": "bell.mp3", "VOL": 50, "PITCH": False}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("state_increment_memory", {"KEY": "total_respuestas", "BY": 1}),
    block("state_increment_memory", {"KEY": "suma_puntos", "BY": 1}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Respuesta registrada!"}),
    block("play_sfx", {"FILE": "pop.mp3", "VOL": 50, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
)

encuesta = {
    "id": "encuesta_satisfaccion", "title": "Encuesta de Satisfaccion",
    "description": "Encuesta de satisfaccion multi-pregunta con estadisticas en vivo.",
    "tags": ["encuesta", "feedback", "opiniones"], "difficulty": "media",
    "heads": {"on_mode_init": [init], "on_player_answer": [answer]}
}
with open(SCRATCH_DIR / "encuesta_satisfaccion.json", "w", encoding="utf-8") as f:
    json.dump(encuesta, f, ensure_ascii=False, indent=2)
print("encuesta_satisfaccion.json: OK")


# =============================================================================
# neon_cyber_quiz.json
# =============================================================================
init = chain(
    block("set_custom_theme", {"BG": "#0a0014", "TXT": "#00ff88", "ACC": "#ff00ff", "FNT": "'Courier New', monospace"}),
    block("set_gradient_bg", {"DIR": "\u2198", "C1": "#0a0014", "C2": "#001a2e"}),
    block("set_filter", {"COMP": "fondo", "FILTER": "brightness"}),
    block("create_overlay", {"ID": "scanlines", "X": 0, "Y": 0, "W": 100, "H": 100}),
    block("set_text_shadow", {"COMP": "titulo-principal", "X": 0, "Y": 0, "BLR": 20, "CLR": "#00ff88"}),
    block("set_border", {"COMP": "titulo-principal", "W": 2, "STY": "dashed", "CLR": "#00ff88"}),
    block("set_rounded_corners", {"COMP": "titulo-principal", "R": 4}),
    block("quiz_init_engine", {"N": 20, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "media"}),
    block("db_query_shuffle_answers", {}),
    block("players_set_active_slots", {"N": 4}),
    block("state_init_memory_key", {"KEY": "credits", "DEF": 0}),
    block("state_init_memory_key", {"KEY": "nivel_actual", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "aciertos", "DEF": 0}),
    block("show_variable", {"VAR": "credits", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "nivel_actual", "DISP": "display-principal"}),
    block("play_bg_music", {"FILE": "cyberpunk-beat.mp3", "VOL": 35, "LOOP": True}),
    block("play_sfx", {"FILE": "glitch-start.mp3", "VOL": 60, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "CYBER QUIZ"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 30}),
    block("wait_seconds", {"SEC": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "[ SISTEMA ONLINE ]"}),
    block("play_sfx", {"FILE": "boot-up.mp3", "VOL": 50, "PITCH": False}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Cargando base de datos..."}),
    block("wait_seconds", {"SEC": 1}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Inicializando modulos..."}),
    block("wait_seconds", {"SEC": 1}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": ">> LISTO <<"}),
    block("play_sfx", {"FILE": "success-beep.mp3", "VOL": 60, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 50}),
    block("set_text_smooth", {"COMP": "footer", "TXT": "MODO CYBER ACTIVADO"}),
)

qload = chain(
    block("trigger_scene_wipe", {"WIPE": "glitch"}),
    block("play_sfx", {"FILE": "data-transfer.mp3", "VOL": 40, "PITCH": False}),
    block("set_gradient_bg", {"DIR": "\u2197", "C1": "#0a0014", "C2": "#1a002e"}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": ""}),
    block("set_text_smooth", {"COMP": "footer", "TXT": ""}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "[ NUEVO DESAFIO ]"}),
    block("play_sfx", {"FILE": "alert.mp3", "VOL": 55, "PITCH": False}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Procesando datos..."}),
    block("wait_seconds", {"SEC": 2}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta de nivel cyber"}),
    block("play_css_animation", {"COMP": "pregunta-texto", "ANIM": "elastic-in"}),
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#1a002e", "C2": "#0a0014"}),
    block("play_sfx", {"FILE": "countdown-start.mp3", "VOL": 50, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 85}),
    block("wait_seconds", {"SEC": 10}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "shutdown.mp3", "VOL": 75, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "[ BLOQUEADO ]"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("set_gradient_bg", {"DIR": "\u2192", "C1": "#2e0a0a", "C2": "#0a0014"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 20}),
    block("state_increment_memory", {"KEY": "credits", "BY": 20}),
    block("state_increment_memory", {"KEY": "aciertos", "BY": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "[ ACCESO CONCEDIDO ]"}),
    block("play_sfx", {"FILE": "access-granted.mp3", "VOL": 70, "PITCH": False}),
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#002e00", "C2": "#0a0014"}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 25}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "+20 CREDITS"}),
    block("play_sfx", {"FILE": "coin.mp3", "VOL": 55, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 15}),
)

timer = chain(
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "[ TIMEOUT ]"}),
    block("play_sfx", {"FILE": "alarm.mp3", "VOL": 80, "PITCH": False}),
    block("set_gradient_bg", {"DIR": "\u2198", "C1": "#2e0a00", "C2": "#0a0014"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Tiempo de respuesta agotado"}),
    block("wait_seconds", {"SEC": 2}),
    block("trigger_scene_wipe", {"WIPE": "glitch"}),
)

neon_cyber_quiz = {
    "id": "neon_cyber_quiz", "title": "Neon Cyber Quiz",
    "description": "Estilo futurista con neon, glitch effects, particulas cyberpunk, gradientes extremos y animaciones de camara.",
    "tags": ["neon", "cyber", "futurista", "glitch", "gaming"], "difficulty": "experto",
    "heads": {"on_mode_init": [init], "on_question_load": [qload],
              "on_question_start": [qstart], "on_player_answer": [answer],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "neon_cyber_quiz.json", "w", encoding="utf-8") as f:
    json.dump(neon_cyber_quiz, f, ensure_ascii=False, indent=2)
print("neon_cyber_quiz.json: OK")


# =============================================================================
# quiz_show_glam.json
# =============================================================================
init = chain(
    block("set_custom_theme", {"BG": "#0a0a0f", "TXT": "#f8f6f0", "ACC": "#FF5E3A", "FNT": "'Segoe UI', system-ui, sans-serif"}),
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#0a0a0f", "C2": "#1a0a2e"}),
    block("create_overlay", {"ID": "vignette", "X": 0, "Y": 0, "W": 100, "H": 100}),
    block("set_text_shadow", {"COMP": "titulo-principal", "X": 4, "Y": 4, "BLR": 8, "CLR": "#FF5E3A"}),
    block("set_border", {"COMP": "titulo-principal", "W": 3, "STY": "solid", "CLR": "#FF5E3A"}),
    block("set_rounded_corners", {"COMP": "titulo-principal", "R": 12}),
    block("quiz_init_engine", {"N": 15, "CAT": "mix"}),
    block("db_query_filter_difficulty", {"D": "media"}),
    block("db_query_shuffle_answers", {}),
    block("players_set_active_slots", {"N": 3}),
    block("state_init_memory_key", {"KEY": "pregunta_num", "DEF": 1}),
    block("state_init_memory_key", {"KEY": "total_preguntas", "DEF": 15}),
    block("state_init_memory_key", {"KEY": "puntos_total", "DEF": 0}),
    block("show_variable", {"VAR": "puntos_total", "DISP": "display-principal"}),
    block("show_variable", {"VAR": "pregunta_num", "DISP": "display-principal"}),
    block("play_bg_music", {"FILE": "tv-show-theme.mp3", "VOL": 40, "LOOP": True}),
    block("play_sfx", {"FILE": "dramatic-reveal.mp3", "VOL": 60, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "QUIZ SHOW"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "elastic-in"}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 20}),
    block("wait_seconds", {"SEC": 2}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "PREPARADOS?"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
    block("wait_seconds", {"SEC": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "A JUGAR!"}),
    block("play_sfx", {"FILE": "airhorn.mp3", "VOL": 70, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 50}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
)

qload = chain(
    block("trigger_scene_wipe", {"WIPE": "glitch"}),
    block("play_sfx", {"FILE": "whoosh.mp3", "VOL": 45, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": ""}),
    block("set_text_smooth", {"COMP": "footer", "TXT": ""}),
    block("set_gradient_bg", {"DIR": "\u2197", "C1": "#0a0a0f", "C2": "#2d1b69"}),
)

qstart = chain(
    block("quiz_fetch_next_question", {}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "NUEVA PREGUNTA"}),
    block("play_sfx", {"FILE": "drum-roll.mp3", "VOL": 50, "PITCH": False}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Escuchen bien..."}),
    block("wait_seconds", {"SEC": 2}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": ""}),
    block("set_text_smooth", {"COMP": "pregunta-texto", "TXT": "Pregunta del show"}),
    block("play_css_animation", {"COMP": "pregunta-texto", "ANIM": "elastic-in"}),
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#1a0a2e", "C2": "#0a0a0f"}),
    block("play_sfx", {"FILE": "bell.mp3", "VOL": 60, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 80}),
    block("wait_seconds", {"SEC": 15}),
    block("quiz_lock_answers", {}),
    block("play_sfx", {"FILE": "buzzer.mp3", "VOL": 80, "PITCH": False}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "TIEMPO!"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("set_gradient_bg", {"DIR": "\u2192", "C1": "#2d0a0a", "C2": "#0a0a0f"}),
)

answer = chain(
    block("quiz_verify_player_answer", {"PLAYER": "current"}),
    block("quiz_add_score_to_player", {"PLAYER": "current", "PTS": 15}),
    block("state_increment_memory", {"KEY": "puntos_total", "BY": 15}),
    block("state_increment_memory", {"KEY": "pregunta_num", "BY": 1}),
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "CORRECTO!"}),
    block("play_sfx", {"FILE": "correct.mp3", "VOL": 80, "PITCH": False}),
    block("set_gradient_bg", {"DIR": "\u2193", "C1": "#0a2e0a", "C2": "#0a0a0f"}),
    block("spawn_particle_emitter", {"KIND": "gold", "X": 50, "Y": 30}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "flash"}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "+15 puntos para el jugador"}),
    block("play_sfx", {"FILE": "cash-register.mp3", "VOL": 50, "PITCH": False}),
    block("spawn_particle_emitter", {"KIND": "confetti", "X": 50, "Y": 15}),
)

timer = chain(
    block("set_text_smooth", {"COMP": "titulo-principal", "TXT": "SE ACABO EL TIEMPO!"}),
    block("play_sfx", {"FILE": "alarm.mp3", "VOL": 80, "PITCH": False}),
    block("set_gradient_bg", {"DIR": "\u2198", "C1": "#2e1a0a", "C2": "#0a0a0f"}),
    block("play_css_animation", {"COMP": "titulo-principal", "ANIM": "shake"}),
    block("spawn_particle_emitter", {"KIND": "fire", "X": 50, "Y": 50}),
    block("set_text_smooth", {"COMP": "subtitulo", "TXT": "Nadie fue lo suficientemente rapido"}),
    block("wait_seconds", {"SEC": 3}),
    block("trigger_scene_wipe", {"WIPE": "slide"}),
)

quiz_show_glam = {
    "id": "quiz_show_glam", "title": "Quiz Show Glam",
    "description": "Estilo programa de television con efectos dramaticos, transiciones cinematograficas, iluminacion dinamica y animaciones de camara.",
    "tags": ["tv", "show", "dramatico", "transiciones", "iluminacion"], "difficulty": "dificil",
    "heads": {"on_mode_init": [init], "on_question_load": [qload],
              "on_question_start": [qstart], "on_player_answer": [answer],
              "on_timer_expire": [timer]}
}
with open(SCRATCH_DIR / "quiz_show_glam.json", "w", encoding="utf-8") as f:
    json.dump(quiz_show_glam, f, ensure_ascii=False, indent=2)
print("quiz_show_glam.json: OK")


# Verify all files
print("\nVerifying all scratch templates...")
for f in sorted(SCRATCH_DIR.glob("*.json")):
    try:
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
        assert "heads" in data, "missing heads"
        assert "id" in data, "missing id"
        events = len(data["heads"])
        print(f"  OK {f.name} ({events} events)")
    except Exception as e:
        print(f"  FAIL {f.name}: {e}")
