import threading
import logging
import os
import time
from contextlib import contextmanager

log = logging.getLogger(__name__)


class ModeManager:
    def __init__(self, state):
        self.state = state
        self._lock = threading.RLock()  # RLock allows re-entrant calls
        self._modes = {}
        self._active_mode = None
        self._active_name = "preguntas"
        self._secondary_mode = None
        self._secondary_name = None
        self._start_timeouts = {}  # mode_name -> deadline for start timeout
        self._max_start_time = float(os.environ.get("SILLY_MODE_START_TIMEOUT", "30.0"))  # seconds

    def register(self, mode_instance):
        with self._lock:
            name = mode_instance.name
            self._modes[name] = mode_instance
            log.info("Modo registrado: %s", name)

    def get_mode(self, name):
        with self._lock:
            return self._modes.get(name)

    def get_active(self, slot="primary"):
        with self._lock:
            return self._secondary_mode if slot == "secondary" else self._active_mode

    def get_active_name(self, slot="primary"):
        with self._lock:
            return self._secondary_name if slot == "secondary" else self._active_name

    @contextmanager
    def _mode_locked(self, name, slot="primary"):
        """Context manager to safely transition modes with timeout."""
        acquired = self._lock.acquire(timeout=self._max_start_time)
        if not acquired:
            raise RuntimeError(f"Timeout acquiring mode lock for {name}")
        try:
            if name not in self._modes:
                raise ValueError(f"Modo '{name}' no encontrado")
            yield self._modes[name]
        finally:
            self._lock.release()

    def start_mode(self, name, slot="primary", **kwargs):
        with self._lock:
            if name not in self._modes:
                return False, f"Modo '{name}' no encontrado"
            mode = self._modes[name]
            
            # Stop existing mode in slot if different
            if slot == "secondary":
                if self._secondary_mode and self._secondary_mode is not mode:
                    self._stop_mode_locked(self._secondary_mode)
                self._secondary_mode = mode
                self._secondary_name = name
            else:
                if self._active_mode and self._active_mode is not mode:
                    self._stop_mode_locked(self._active_mode)
                self._active_mode = mode
                self._active_name = name

            # Start mode while still holding the lock
            try:
                result = mode.start(**kwargs)
                if isinstance(result, dict) and "error" in result:
                    self._rollback_mode(slot, name)
                    return False, result["error"]
                return True, None
            except Exception as e:
                log.error("Error al iniciar modo %s: %s", name, e, exc_info=True)
                self._rollback_mode(slot, name)
                return False, str(e)

    def _stop_mode_locked(self, mode):
        """Stop mode while holding lock. Assumes lock is held."""
        try:
            mode.stop()
        except Exception as e:
            log.error("Error al detener modo %s: %s", mode.name, e)

    def _rollback_mode(self, slot, name):
        """Rollback mode assignment on start failure. Assumes lock is held."""
        if slot == "secondary":
            self._secondary_mode = None
            self._secondary_name = None
        else:
            self._active_mode = None
            self._active_name = "preguntas"

    def stop_active(self, slot="primary"):
        with self._lock:
            if slot == "secondary":
                if not self._secondary_mode:
                    return False, "No hay modo secundario activo"
                mode = self._secondary_mode
                self._secondary_mode = None
                self._secondary_name = None
            else:
                if not self._active_mode:
                    return False, "No hay modo activo"
                mode = self._active_mode
                self._active_mode = None
                self._active_name = "preguntas"
            
            try:
                mode.stop()
            except Exception as e:
                log.error("Error al detener modo %s: %s", mode.name, e)
            
            if slot == "primary":
                with self.state.lock:
                    self.state.modo = "preguntas"
            return True, None

    def get_all_state(self):
        result = {}
        with self._lock:
            for name, mode in self._modes.items():
                try:
                    result[name] = mode.get_state()
                except Exception as e:
                    log.error("Error en snapshot de modo %s: %s", name, e)
            result["modo"] = self._active_name
            result["modo_secundario"] = self._secondary_name
        return result

    def modes_list(self):
        with self._lock:
            return {name: {"name": mode.name, "icon": getattr(mode, 'icon', '')} for name, mode in self._modes.items()}
