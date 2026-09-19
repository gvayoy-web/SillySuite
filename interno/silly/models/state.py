from __future__ import annotations

import threading
from copy import deepcopy
from collections import deque
from datetime import datetime
from typing import Any

from silly.globals import container


MAX_POINTS: int = 99999
MIN_POINTS: int = -99999
MIN_GRUPO_PUNTOS: int = 0


# Caché del leaderboard del Game Engine: evita bloquear snapshot()/SSE
# cuando el WS :8081 está caído (antes: 5s x 3 reintentos por cada tick/botón).
import time as _time

_LB_CACHE: dict = {"ts": 0.0, "data": {}}
_LB_TTL: float = 10.0


def _get_leaderboard_fast() -> dict:
    now = _time.monotonic()
    if now - _LB_CACHE["ts"] < _LB_TTL and _LB_CACHE["data"]:
        return _LB_CACHE["data"]
    try:
        from silly.blueprints.sync_bridge import bridge
        res = bridge._call_sync(
            {"type": "play_leaderboard", "session_id": "game_persona", "metric": "kills"},
            timeout=0.4,
            retries=0,
        )
        if res and res.get("leaderboard"):
            _LB_CACHE["data"] = {"game_persona": {"kills": res["leaderboard"]}}
            _LB_CACHE["ts"] = now
            return _LB_CACHE["data"]
    except Exception:
        pass
    return _LB_CACHE["data"]


class AppState:
    def __init__(self, config: dict, preguntas: list[dict]) -> None:
        self._lock: threading.Lock = threading.Lock()
        self.config: dict = config
        self.preguntas: list[dict] = preguntas
        self._preguntas_por_id: dict[int, dict] = {}
        self._indexar_preguntas()
        gc: list[dict] = config.get("groups", {}).get("default", [])
        self.puntos: dict[str, int] = {g["key"]: MIN_GRUPO_PUNTOS for g in gc}
        self.pregunta_actual: dict | None = None
        self.mostrar_respuesta: bool = False
        self.mostrar_opciones: bool = False
        self.timer_activo: bool = False
        self.timer_segundos: int = 0
        self.timer_totales: int = 0
        default_timer: int = config.get("game", {}).get("default_timer", 45)
        self.display_config: dict = {
            "kiosko": False,
            "animations_disabled": False,
            "overlay_reset": 0,
            "black_screen": False,
            "frozen": False,
            "clean": False,
            "eliminados": [],
            "final_round": False,
            "final_results": False,
            "grupos_config": gc,
            "default_timer": default_timer,
            "bg_style": "default",
            "decorations": True,
            "particles": False,
            "theme": "default",
            "screen_shake": True,
            "confetti": True,
            "sound": True,
            "scanline": False,
            "glow_fx": False,
            "ultra_glow": False,
            "vignette": False,
            "glow_pulse": False,
            "score_breathe": False,
            "bg_breath": False,
            "fractal_animations": False,
            "micro_particles": False,
            "dynamic_bg": False,
            "theme_effects": True,
            "score_anim": "none",
            "crown_leader": False,
            "flash_intensity": 1,
            "show_progress": False,
            "edge_blend": "none",
            "welcome_screen": False,
            "show_verse": False,
            "dynamic_bars": False,
            "theme_slug": None,
            "sound_map": {
                "events": {},
                "modes": {},
                "background": None,
                "channels": {"sfx": 1.0, "music": 1.0, "ambient": 1.0, "voice": 1.0},
                "muted": False,
                "enabled": True,
            },
            "theme_layout": {},
            "timer_style": "circle",
            "timer_colors": {},
            "last_rotation": None,
            "rotation_enabled": False,
            "screens": {
                "1": {
                    "name": "Principal",
                    "role": "main",
                    "elements": {"timer": True, "question": True, "scores": True, "shapes": True, "overlays": True},
                    "layout": {},
                    "mapping": {},
                },
                "2": {
                    "name": "Pantalla 2",
                    "role": "secondary",
                    "elements": {"timer": False, "question": False, "scores": True, "shapes": True, "overlays": False},
                    "layout": {},
                    "mapping": {},
                },
            },
        }
        self.anim_texto: str | None = None
        self.anim_id: int = 0
        self.anim_data: dict = {"tipo": None, "grupo": None, "cantidad": 0}
        self._actividad: deque = deque(maxlen=20)
        self.modo: str = "preguntas"
        self.opcion_seleccionada: str | None = None
        self.tiempo_timer_segundos: int = 0
        self.tiempo_timer_totales: int = 0
        self.tiempo_timer_fin: float = 0.0


    def _indexar_preguntas(self):
        self._preguntas_por_id.clear()
        for p in self.preguntas:
            pid = p.get("id")
            if pid is not None:
                self._preguntas_por_id[pid] = p

    def _invalidate_cache(self):
        pass

    @property
    def lock(self) -> threading.Lock:
        return self._lock

    def _log_actividad(self, msg: str) -> None:
        ts: str = datetime.now().strftime("%H:%M:%S")
        self._actividad.appendleft(f"[{ts}] {msg}")

    def get_actividad(self) -> list[str]:
        with self._lock:
            return list(self._actividad)

    def snapshot(self) -> dict:
        with self._lock:
            grupos_ordenados: list[dict] = sorted(
                [{"grupo": k, "puntos": v} for k, v in self.puntos.items()],
                key=lambda x: x["puntos"], reverse=True,
            )
            gc: list[dict] = self.display_config.get("grupos_config", [])
            color_map: dict = {g["key"]: g.get("color", "#888") for g in gc}
            resultados_finales: list[dict] = [
                {**g, "color": color_map.get(g["grupo"], "#888")}
                for g in grupos_ordenados
            ]
            # Leaderboard del Game Engine (si existe) — vía caché rápida no bloqueante
            leaderboard_data = _get_leaderboard_fast()
            return {
                "pregunta_actual": deepcopy(self.pregunta_actual),
                "mostrar_respuesta": self.mostrar_respuesta,
                "mostrar_opciones": self.mostrar_opciones,
                "opcion_seleccionada": self.opcion_seleccionada,
                "mostrar_scores": True,
                "scores": grupos_ordenados,
                "puntos": dict(self.puntos),
                "anim_activo": self.anim_texto is not None,
                "anim_texto": self.anim_texto,
                "anim_id": self.anim_id,
                "ultima_animacion_id": self.anim_id,
                "ultima_animacion": self.anim_texto,
                "anim_data": deepcopy(self.anim_data),
                "timer_activo": self.timer_activo,
                "timer_segundos": self.timer_segundos,
                "temporizador": {
                    "activo": self.timer_activo,
                    "segundos_restantes": self.timer_segundos,
                    "segundos_totales": self.timer_totales,
                },
                "modo": self.modo,
                "resultados_finales": resultados_finales,
                "actividad": list(self._actividad),
                "display_config": deepcopy(self.display_config),
                "sound_library": container.sound_service.list_library() if container.sound_service else [],
                "tiempo_timer_segundos": self.tiempo_timer_segundos,
                "tiempo_timer_totales": self.tiempo_timer_totales,
                "tiempo_timer_fin": self.tiempo_timer_fin,
                "leaderboard": leaderboard_data,
            }

    def datos_persistibles(self) -> dict:
        with self._lock:
            # Leaderboard del Game Engine (si existe) — vía caché rápida no bloqueante
            leaderboard_data = _get_leaderboard_fast()
            return {
                "preguntas": [dict(p) for p in self.preguntas],
                "puntos": dict(self.puntos),
                "display_config": dict(self.display_config),
                "leaderboard": leaderboard_data,
            }

    def sumar_puntos(self, grupo: str, cantidad: int) -> bool:
        with self._lock:
            if grupo not in self.puntos:
                return False
            antes: int = self.puntos[grupo]
            cantidad = max(MIN_POINTS, min(MAX_POINTS, cantidad))
            self.puntos[grupo] = max(MIN_GRUPO_PUNTOS, min(MAX_POINTS, antes + cantidad))
            self.anim_id += 1
            self.anim_texto = f"{grupo.upper()}: {antes} -> {self.puntos[grupo]}"
            self.anim_data = {"tipo": "suma", "grupo": grupo, "cantidad": cantidad}
            self._log_actividad(f"Puntos {grupo}: {antes} -> {self.puntos[grupo]}")
            self._invalidate_cache()
        return True

    def ajustar_puntos(self, grupo: str, valor: int) -> bool:
        with self._lock:
            if grupo not in self.puntos:
                return False
            self.puntos[grupo] = max(MIN_GRUPO_PUNTOS, min(MAX_POINTS, valor))
            self._log_actividad(f"Puntos {grupo}: ajustado a {self.puntos[grupo]}")
            self._invalidate_cache()
        return True

    def set_pregunta(self, pid: int) -> bool:
        with self._lock:
            p = self._preguntas_por_id.get(pid)
            if p is None:
                return False
            self.pregunta_actual = dict(p)
            self.mostrar_respuesta = False
            self.mostrar_opciones = False
            self.opcion_seleccionada = None
            self.anim_texto = None
            self._log_actividad(f"Pregunta {pid}: {p['texto'][:60]}")
            self._invalidate_cache()
            return True

    def agregar_pregunta(self, pregunta: dict) -> None:
        with self._lock:
            max_id: int = max(self._preguntas_por_id.keys(), default=0)
            pregunta["id"] = max_id + 1
            self.preguntas.append(pregunta)
            self._preguntas_por_id[pregunta["id"]] = pregunta
            self._invalidate_cache()

    def eliminar_pregunta(self, pid: int) -> bool:
        with self._lock:
            p = self._preguntas_por_id.pop(pid, None)
            if p is None:
                return False
            self.preguntas.remove(p)
            if self.pregunta_actual and self.pregunta_actual["id"] == pid:
                self.pregunta_actual = None
            self._invalidate_cache()
            return True

    def editar_pregunta(self, pid: int, texto: str, respuesta: str, extra: dict | None = None) -> bool:
        with self._lock:
            p = self._preguntas_por_id.get(pid)
            if p is None:
                return False
            p["texto"] = texto
            p["respuesta"] = respuesta
            if extra:
                p.update(extra)
            if self.pregunta_actual and self.pregunta_actual["id"] == pid:
                self.pregunta_actual = dict(p)
            self._invalidate_cache()
            return True

    def reset(self) -> None:
        with self._lock:
            self.preguntas = []
            self._preguntas_por_id.clear()
            gc: list[dict] = self.display_config.get("grupos_config", [])
            self.puntos = {g["key"]: MIN_GRUPO_PUNTOS for g in gc}
            self.pregunta_actual = None
            self.mostrar_respuesta = False
            self.mostrar_opciones = False
            self.timer_activo = False
            self.timer_segundos = 0
            self.anim_texto = None
            self.anim_id = 0
            self.anim_data = {"tipo": None, "grupo": None, "cantidad": 0}
            self.modo = "preguntas"
            self.opcion_seleccionada = None
            self.tiempo_timer_segundos = 0
            self.tiempo_timer_totales = 0
            self.tiempo_timer_fin = 0.0
            self._invalidate_cache()
