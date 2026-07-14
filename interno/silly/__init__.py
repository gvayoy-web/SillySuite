"""
silly/__init__.py — SillyQuiz Core Package
"""
__version__ = "6.0.0"
__name__ = "SillyQuiz"
__codename__ = "SILLY PACK"

# Exportar módulos principales
from .config_loader import load_config, load_questions
from .mode_manager import ModeManager
from .models.state import AppState
from .models.cronometro import Cronometro

__all__ = [
    "load_config",
    "load_questions",
    "ModeManager",
    "AppState",
    "Cronometro",
]