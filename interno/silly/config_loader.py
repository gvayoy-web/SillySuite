"""
config_loader.py — Unified configuration loader for SillyQuiz.
Single source of truth: interno/config.json merged with DEFAULT_CONFIG.
Security section (csrf_secret, password) is managed by the launcher.
"""
import json
import os
import logging

log = logging.getLogger(__name__)

CONFIG_FILE = os.getenv("COMP_CONFIG_FILE", "config.json")
DATA_FILE = os.getenv("COMP_DATA_FILE", "pym.json")

DEFAULT_CONFIG = {
    "brand": {
        "name": "SillyQuiz",
        "title": "SillyQuiz",
        "subtitle": "Competencia de Conocimiento",
        "favicon": "favicon.ico",
    },
    "game": {
        "default_timer": 45,
        "min_groups": 2,
        "max_groups": 8,
        "default_points": 10,
        "final_round_multiplier": 2,
    },
    "groups": {
        "default": [],
    },
    "question_categories": {},
    "roulette": {
        "enabled": True,
        "subconjunto_size": 20,
        "timer": 15,
        "repesca_chance": 0.01,
        "categories": {},
    },
    "modes": {
        "questions": {"enabled": True, "icon": "\u2753"},
        "verses": {"enabled": True, "icon": "\U0001f4d6"},
        "roulette": {"enabled": True, "icon": "\U0001f3b0"},
        "hangman": {
            "enabled": True,
            "icon": "\U0001faa2",
            "max_attempts": 6,
            "timer": 60,
            "words": ["REDENCION", "GRACIA", "FE", "ESPERANZA", "AMOR"],
        },
    },
    "display": {
        "themes": ["brutal", "calm"],
        "default_theme": "brutal",
        "fonts": {"title": "Cinzel", "body": "Space Grotesk"},
    },
    "silly": {
        "port_http": 8080,
        "port_ws": 8081,
        "qr_enabled": True,
        "qr_size": 256,
        "extension": ".silly",
        "media_formats": {
            "images": ["webp", "png", "jpg", "gif"],
            "audio": ["mp3", "ogg", "wav"],
            "video": ["mp4", "webm"],
        },
        "max_file_size_mb": 50,
        "compression": "deflate",
    },
    "security": {
        "csrf_secret": "",
        "jwt_secret": "",
    },
    "theme_rotation": {
        "interval_seconds": 180,
        "enabled": True,
        "excluded_themes": [],
        "seed": None,
    },
}


def deep_merge(base, override):
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def load_config():
    config_path = CONFIG_FILE
    if not os.path.exists(config_path):
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", CONFIG_FILE)
    if not os.path.exists(config_path):
        log.warning("config.json no encontrado, usando configuracion por defecto")
        return dict(DEFAULT_CONFIG)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            user_config = json.load(f)
        merged = deep_merge(DEFAULT_CONFIG, user_config)
        log.info("Configuracion cargada desde %s", config_path)
        return merged
    except Exception as exc:
        log.error("Error al cargar config.json: %s", exc, exc_info=True)
        return dict(DEFAULT_CONFIG)


def load_questions():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("preguntas", [])
    except Exception as exc:
        log.error("Error al cargar preguntas desde %s: %s", DATA_FILE, exc)
        return []
