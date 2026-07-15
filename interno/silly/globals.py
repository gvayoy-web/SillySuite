"""
globals.py — DependencyContainer singleton with type hints.
All services are wired in app.py create_app().
"""
from __future__ import annotations
from typing import Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from silly.models.state import AppState
    from silly.mode_manager import ModeManager
    from silly.services.sse import EventBus
    from silly.services.stats_service import StatsService
    from silly.services.theme_service import CompleteThemeEngine, ThemeService
    from silly.services.sound_service import SoundService
    from silly.models.cronometro import Cronometro
    from silly.game_state_manager import GameStateManager
    from silly.template_registry import TemplateRegistry
    from silly.template_engine import TemplateEngine
    from silly.communication_manager import CommunicationManager


class DependencyContainer:
    """Centralized DI container. All attributes are wired at startup in app.py."""

    def __init__(self) -> None:
        self.state: Optional[AppState] = None
        self.config: Optional[dict[str, Any]] = None
        self.mode_manager: Optional[ModeManager] = None
        self.cronometro: Optional[Cronometro] = None
        self.log: Any = None
        self.DATA_FILE: str = ""
        self.BASE_DIR: str = ""
        self.event_bus: Optional[EventBus] = None
        self.sound_service: Optional[SoundService] = None
        # Wired dynamically in app.py
        self.stats_service: Any = None
        self.theme_engine: Any = None
        self.theme_service: Any = None
        self.game_state_manager: Any = None
        self.template_registry: Any = None
        self.template_engine: Any = None
        self.communication_manager: Any = None


_container = DependencyContainer()
container: DependencyContainer = _container


def get_container() -> DependencyContainer:
    return container
