import threading
import logging

log = logging.getLogger(__name__)


class ModeManager:
    def __init__(self, state):
        self.state = state
        self._lock = threading.Lock()
        self._modes = {}
        self._active_mode = None
        self._active_name = "preguntas"
        self._secondary_mode = None
        self._secondary_name = None

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

    def start_mode(self, name, slot="primary", **kwargs):
        with self._lock:
            if name not in self._modes:
                return False, f"Modo '{name}' no encontrado"
            if slot == "secondary":
                if self._secondary_mode and self._secondary_mode is not self._modes[name]:
                    try:
                        self._secondary_mode.stop()
                    except Exception as e:
                        log.error("Error al detener modo secundario %s: %s", self._secondary_mode.name, e)
                self._secondary_mode = self._modes[name]
                self._secondary_name = name
            else:
                if self._active_mode and self._active_mode is not self._modes[name]:
                    try:
                        self._active_mode.stop()
                    except Exception as e:
                        log.error("Error al detener modo %s: %s", self._active_mode.name, e)
                self._active_mode = self._modes[name]
                self._active_name = name
        try:
            result = self._modes[name].start(**kwargs)
            if isinstance(result, dict) and "error" in result:
                with self._lock:
                    if slot == "secondary":
                        self._secondary_mode = None
                        self._secondary_name = None
                    else:
                        self._active_mode = None
                        self._active_name = "preguntas"
                return False, result["error"]
            return True, None
        except Exception as e:
            log.error("Error al iniciar modo %s: %s", name, e, exc_info=True)
            with self._lock:
                if slot == "secondary":
                    self._secondary_mode = None
                    self._secondary_name = None
                else:
                    self._active_mode = None
                    self._active_name = "preguntas"
            return False, str(e)

    def stop_active(self, slot="primary"):
        with self._lock:
            if slot == "secondary":
                if not self._secondary_mode:
                    return False, "No hay modo secundario activo"
                name = self._secondary_mode.name
                try:
                    self._secondary_mode.stop()
                except Exception as e:
                    log.error("Error al detener modo secundario %s: %s", name, e)
                self._secondary_mode = None
                self._secondary_name = None
                return True, None
            if not self._active_mode:
                return False, "No hay modo activo"
            name = self._active_mode.name
            try:
                self._active_mode.stop()
            except Exception as e:
                log.error("Error al detener modo %s: %s", name, e)
            self._active_mode = None
            self._active_name = "preguntas"
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
