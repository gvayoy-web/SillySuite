"""
tiempo.py — Modo "Tiempo": Timer + Leaderboard.
Simple countdown timer displayed prominently alongside a live leaderboard.
"""
import time
from .base import BaseMode
from silly.models.cronometro import Cronometro
from silly.services.sse import EVENT_DISPLAY_UPDATE


class VersesMode(BaseMode):
    name = "verses"
    icon = "\u23f1\ufe0f"

    def __init__(self, state, event_bus=None, config=None):
        super().__init__(state, event_bus, config)
        self.activo = False
        self.timer_segundos = 0
        self.timer_totales = 0
        self.tiempo_inicio = 0.0
        self.pausado = False
        self.history = []
        self._cronometro = Cronometro(
            name="VersesTimer",
            on_timeout=self._on_timeout,
            on_tick=self._on_tick,
        )
        self._cronometro.start()

    def start(self, **kwargs):
        if self.activo:
            return {"error": "El modo tiempo ya est\u00e1 activo"}
        config = self.state.config.get("modes", {}).get("verses", {})
        self.timer_totales = kwargs.get("timer", config.get("timer", 60))
        self.timer_segundos = self.timer_totales
        self.pausado = False
        self.history = []
        self.tiempo_inicio = time.monotonic()
        self.activo = True
        self._sync_state()
        self._cronometro.arrancar(self.timer_totales)
        self.log_actividad(f"Modo tiempo iniciado — {self.timer_totales}s")
        return {"ok": True, "timer": self.timer_totales}

    def stop(self):
        self.activo = False
        self._cronometro.parar()
        self.timer_segundos = 0
        self.timer_totales = 0
        self.pausado = False
        self._sync_state()
        self.log_actividad("Modo tiempo detenido")

    def handle_action(self, action, data=None):
        if action == "iniciar":
            return self.start(**(data or {}))
        elif action == "cerrar":
            self.stop()
            return {"ok": True}
        elif action == "pausar":
            return self._pausar()
        elif action == "reanudar":
            return self._reanudar()
        elif action == "responder":
            grupo = data.get("grupo") if data else None
            puntos = int(data.get("puntos", 10)) if data else 10
            return self._award_points(grupo, puntos)
        elif action == "reset_timer":
            return self._reset_timer()
        return {"error": f"Acci\u00f3n desconocida: {action}"}

    def _award_points(self, grupo, puntos):
        if not self.activo:
            return {"error": "Modo no activo"}
        if not grupo:
            return {"error": "Grupo requerido"}
        if puntos <= 0:
            return {"error": "Los puntos deben ser positivos"}
        self.state.sumar_puntos(grupo, puntos)
        self.log_actividad(f"{grupo} +{puntos} pts")
        return {"ok": True, "correcta": True, "grupo": grupo, "puntos": puntos}

    def _reset_timer(self):
        if not self.activo:
            return {"error": "Modo no activo"}
        self.timer_segundos = self.timer_totales
        self.tiempo_inicio = time.monotonic()
        self._cronometro.arrancar(self.timer_totales)
        self._sync_state()
        self.log_actividad("Timer reiniciado")
        return {"ok": True}

    def _pausar(self):
        if not self.activo or self.pausado:
            return {"error": "No se puede pausar"}
        self.pausado = True
        self._cronometro.parar()
        elapsed = time.monotonic() - self.tiempo_inicio
        self.timer_segundos = max(0, self.timer_totales - int(elapsed))
        self._sync_state()
        self.log_actividad("Timer pausado")
        return {"ok": True}

    def _reanudar(self):
        if not self.activo or not self.pausado:
            return {"error": "No se puede reanudar"}
        self.pausado = False
        remaining = self.timer_segundos
        self.tiempo_inicio = time.monotonic()
        self.timer_totales = remaining
        if remaining > 0:
            self._cronometro.arrancar(remaining)
        self._sync_state()
        self.log_actividad("Timer reanudado")
        return {"ok": True}

    def _on_tick(self, remaining):
        self.timer_segundos = max(0, int(remaining))
        self._sync_state()
        if self._event_bus:
            self._event_bus.notify(EVENT_DISPLAY_UPDATE)

    def _on_timeout(self):
        self.log_actividad("Tiempo terminado")
        self.timer_segundos = 0
        self._sync_state()
        if self._event_bus:
            self._event_bus.notify(EVENT_DISPLAY_UPDATE)

    def _sync_state(self):
        with self.state.lock:
            self.state.tiempo_timer_segundos = self.timer_segundos
            self.state.tiempo_timer_totales = self.timer_totales
            self.state.tiempo_timer_fin = self.tiempo_inicio + self.timer_totales if self.tiempo_inicio else 0.0

    def get_state(self):
        return {
            "activo": self.activo,
            "timer_segundos": self.timer_segundos,
            "timer_totales": self.timer_totales,
            "pausado": self.pausado,
            "history": self.history[-10:] if self.history else [],
        }

    def cleanup(self):
        if hasattr(self, "_cronometro") and self._cronometro:
            self._cronometro.stop_thread()
