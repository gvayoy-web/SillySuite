import random
import time
from .base import BaseMode


class RouletteMode(BaseMode):
    name = "ruleta"
    icon = "\U0001f3b0"

    def __init__(self, state, event_bus=None, config=None):
        super().__init__(state, event_bus, config)
        self.activa = False
        self.fase = "idle"
        self.anim_id = 0
        self.categoria_seleccionada = None
        self.categoria_forzada = None
        self.resultado = None
        self.categories = {}
        self.timer_segundos = 15
        self._timer_iniciado = False

    def _load_config(self):
        cfg = self.state.config.get("roulette", {})
        cats = cfg.get("categories", {})
        if not cats:
            qc = self.state.config.get("question_categories", {})
            if qc:
                cats = {k: {"name": v.get("name", k), "items": v.get("items", [k])} for k, v in qc.items()}
        self.categories = cats
        self.timer_segundos = cfg.get("timer", 15)

    def _cat_meta(self):
        meta = {}
        for i, (k, v) in enumerate(self.categories.items()):
            hue = (i * 360 / max(len(self.categories), 1) + 15) % 360
            meta[k] = {
                "name": v.get("name", k),
                "color": v.get("color", "hsl(" + str(hue) + ",75%,55%)"),
            }
        return meta

    def start(self, **kwargs):
        if self.activa:
            return {"error": "La ruleta ya est\u00e1 activa"}
        self._load_config()
        cat_items = list(self.categories.items())
        if len(cat_items) < 2:
            return {"error": "Se necesitan al menos 2 categor\u00edas"}
        self.activa = True
        self.fase = "category_select"
        self.anim_id += 1
        self.categoria_forzada = None
        self.categoria_seleccionada = None
        self.resultado = None
        self._timer_iniciado = False
        self.log_actividad("Ruleta iniciada — fase selección de categoría")
        return {"ok": True, "fase": "category_select"}

    def seleccionar_categoria(self, forzar=None):
        if not self.activa or self.fase != "category_select":
            return {"error": "No se puede seleccionar categoría ahora"}
        cat_items = list(self.categories.items())
        if forzar and forzar in [k for k, v in cat_items]:
            self.categoria_seleccionada = forzar
        else:
            self.categoria_seleccionada = random.choice([k for k, v in cat_items]) if cat_items else None
        if not self.categoria_seleccionada:
            return {"error": "No hay categorías disponibles"}
        self.fase = "wheel"
        self.anim_id += 1
        cat_name = self.categories.get(self.categoria_seleccionada, {}).get("name", self.categoria_seleccionada)
        self.log_actividad(f"Categoría seleccionada: {cat_name}")
        return {
            "ok": True,
            "fase": "wheel",
            "categoria": self.categoria_seleccionada,
            "cat_name": cat_name,
            "cat_color": self.categories.get(self.categoria_seleccionada, {}).get("color", "#888"),
        }

    def girar(self):
        if not self.activa or self.fase != "wheel":
            return {"error": "No se puede girar ahora"}
        if not self.categoria_seleccionada:
            return {"error": "No hay categoría seleccionada"}
        cat_config = self.categories.get(self.categoria_seleccionada, {})
        items = cat_config.get("items", [])
        if not items:
            return {"error": f"No hay elementos en {cat_config.get('name', self.categoria_seleccionada)}"}
        self.resultado = random.choice(items)
        self.fase = "result"
        self.anim_id += 1
        self._timer_iniciado = True
        self.log_actividad(f"Ruleta → {cat_config.get('name', self.categoria_seleccionada)}: {self.resultado}")
        return {
            "ok": True,
            "categoria": self.categoria_seleccionada,
            "cat_name": cat_config.get("name", self.categoria_seleccionada),
            "resultado": self.resultado,
            "timer": self.timer_segundos,
        }

    def stop(self):
        self.activa = False
        self.fase = "idle"
        self.categoria_seleccionada = None
        self.categoria_forzada = None
        self.resultado = None
        self._timer_iniciado = False

    def handle_action(self, action, data=None):
        if action == "iniciar":
            return self.start(**(data or {}))
        elif action == "seleccionar_categoria":
            forzar = (data or {}).get("forzar")
            return self.seleccionar_categoria(forzar)
        elif action == "girar":
            return self.girar()
        elif action == "cerrar":
            self.stop()
            return {"ok": True}
        return {"error": f"Acción desconocida: {action}"}

    def get_state(self):
        return {
            "activa": self.activa,
            "fase": self.fase,
            "anim_id": self.anim_id,
            "categories": self._cat_meta(),
            "all_categories": {k: {"name": v.get("name", k), "color": v.get("color", "#888"), "items": v.get("items", [])} for k, v in self.categories.items()},
            "categoria_seleccionada": self.categoria_seleccionada,
            "resultado": self.resultado,
            "timer_segundos": self.timer_segundos if self._timer_iniciado else None,
        }
