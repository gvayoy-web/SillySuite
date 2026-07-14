import random
from .base import BaseMode


class QuestionsMode(BaseMode):
    name = "preguntas"
    icon = "❓"

    def __init__(self, state, event_bus=None, config=None):
        super().__init__(state, event_bus, config)

    def start(self, **kwargs):
        self.log_actividad("Modo preguntas activado")

    def stop(self):
        self.state.mostrar_respuesta = False
        self.state.mostrar_opciones = False
        self.state.pregunta_actual = None
        self.state.opcion_seleccionada = None

    def handle_action(self, action, data=None):
        if action == "set_pregunta":
            pid = data.get("id") if data else None
            if pid is None:
                return {"error": "id requerido"}
            return self._set_pregunta(pid)
        elif action == "mostrar_respuesta":
            mostrar = data.get("mostrar", False) if data else False
            return self._mostrar_respuesta(mostrar)
        elif action == "mostrar_opciones":
            return self._mostrar_opciones()
        elif action == "seleccionar_opcion":
            idx = data.get("indice") if data else None
            return self._seleccionar_opcion(idx)
        elif action == "clear":
            return self._clear()
        return {"error": f"Acción desconocida: {action}"}

    def _set_pregunta(self, pid):
        if self.state.set_pregunta(pid):
            p = self.state.pregunta_actual
            self.log_actividad(f"Proyectando: «{p['texto'][:40]}»")
            return {"ok": True, "pregunta": p}
        return {"error": "No encontrada"}

    def _mostrar_respuesta(self, mostrar):
        self.state.mostrar_respuesta = bool(mostrar)
        self.state.mostrar_opciones = bool(mostrar)
        if mostrar:
            self.state.timer_activo = False
        accion = "Respuesta revelada" if mostrar else "Respuesta ocultada"
        self.log_actividad(accion)
        return {"ok": True, "mostrar": self.state.mostrar_respuesta}

    def _mostrar_opciones(self):
        self.state.mostrar_opciones = True
        self.state.opcion_seleccionada = None
        self.state.timer_segundos = 15
        self.state.timer_totales = 15
        self.state.timer_activo = True
        self.log_actividad("Opciones mostradas — timer 15s")
        return {"ok": True}

    def _seleccionar_opcion(self, indice):
        if indice not in (0, 1, 2):
            return {"error": "indice debe ser 0, 1 o 2"}
        self.state.opcion_seleccionada = indice
        if self.state.pregunta_actual and self.state.pregunta_actual.get("opciones"):
            labels = ["A", "B", "C"]
            correcta = indice == self.state.pregunta_actual.get("respuesta_correcta")
            estado = "correcta" if correcta else "incorrecta"
            self.log_actividad(f"Opción {labels[indice]} seleccionada — {estado}")
        return {"ok": True, "opcion_seleccionada": indice}

    def _clear(self):
        self.state.pregunta_actual = None
        self.state.mostrar_respuesta = False
        self.state.mostrar_opciones = False
        return {"ok": True}

    def get_state(self):
        return {}
