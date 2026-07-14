"""Sound service — upload, storage and mapping of custom audio files.

Audio library metadata and the active sound map are persisted in config.json
(which is reloaded on every server start) so customization survives restarts.
Uploaded files live on disk under <BASE_DIR>/sounds/ (gitignored, like backups/).
"""

import os
import re
import json
import time
import uuid
import threading
from copy import deepcopy
from datetime import datetime
from typing import Dict, List, Any, Optional

from silly.globals import container

ALLOWED_EXT = {".wav", ".mp3", ".ogg", ".m4a", ".flac", ".webm", ".aac"}
MAX_FILE_BYTES = 50 * 1024 * 1024
CHANNELS = ["sfx", "music", "ambient", "voice"]

EVENT_KEYS = [
    "new_question", "correct", "incorrect", "point", "penalty",
    "timer_start", "tick", "urgent_tick", "timeout",
    "final_round", "podium", "eliminado", "overtake",
    "round_start", "mode_activate",
    "countdown_3", "countdown_2", "countdown_1", "countdown_go",
]

DEFAULT_MAP = {
    "events": {},
    "modes": {},
    "background": None,
    "channels": {"sfx": 1.0, "music": 1.0, "ambient": 1.0, "voice": 1.0},
    "muted": False,
    "enabled": True,
}


class SoundService:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        self.sounds_dir = os.path.join(base_dir, "sounds")
        os.makedirs(self.sounds_dir, exist_ok=True)
        self._lock = threading.Lock()
        self._library: List[Dict] = []
        self._map: Dict = deepcopy(DEFAULT_MAP)
        self._load()

    def _config_path(self) -> str:
        return os.path.join(self.base_dir, "config.json")

    def _load(self):
        try:
            if os.path.exists(self._config_path()):
                with open(self._config_path(), "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            else:
                cfg = {}
            self._library = cfg.get("sound_library", []) or []
            self._map = deepcopy(DEFAULT_MAP)
            self._map.update(cfg.get("sound_map", {}) or {})
            self._map.setdefault("events", {})
            self._map.setdefault("modes", {})
            self._map.setdefault("background", None)
            self._map.setdefault("channels", {c: 1.0 for c in CHANNELS})
            self._map.setdefault("muted", False)
            self._map.setdefault("enabled", True)
        except Exception as exc:
            if container.log:
                container.log.warning("No se pudo cargar sonidos: %s", exc)
            self._library = []
            self._map = deepcopy(DEFAULT_MAP)

    def _persist(self):
        try:
            path = self._config_path()
            cfg = {}
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            cfg["sound_library"] = self._library
            cfg["sound_map"] = self._map
            tmp = path + ".sound.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=4)
            os.replace(tmp, path)
        except Exception as exc:
            if container.log:
                container.log.error("No se pudo persistir sonidos: %s", exc)

    def list_library(self) -> List[Dict]:
        with self._lock:
            return deepcopy(self._library)

    def get_meta(self, sid: str) -> Optional[Dict]:
        with self._lock:
            for m in self._library:
                if m["id"] == sid:
                    return deepcopy(m)
            return None

    def file_path(self, sid: str) -> Optional[str]:
        meta = self.get_meta(sid)
        if not meta:
            return None
        return os.path.join(self.sounds_dir, meta["filename"])

    def add(self, file_storage, name: Optional[str] = None) -> Dict:
        if file_storage is None:
            raise ValueError("No se recibió ningún archivo")
        original = file_storage.filename or "audio"
        ext = os.path.splitext(original)[1].lower()
        if ext not in ALLOWED_EXT:
            raise ValueError(
                f"Formato '{ext or 'desconocido'}' no soportado. "
                f"Usa: {', '.join(sorted(ALLOWED_EXT))}. (AVI no es audio)"
            )
        file_storage.stream.seek(0, os.SEEK_END)
        size = file_storage.stream.tell()
        file_storage.stream.seek(0)
        if size == 0:
            raise ValueError("El archivo está vacío")
        if size > MAX_FILE_BYTES:
            raise ValueError(f"El archivo supera el límite de {MAX_FILE_BYTES // (1024 * 1024)} MB")
        sid = uuid.uuid4().hex[:12]
        safe_name = re.sub(r"[^\w\- ]", "", name or os.path.splitext(original)[0] or "audio").strip() or "audio"
        filename = f"{sid}{ext}"
        dest = os.path.join(self.sounds_dir, filename)
        file_storage.save(dest)
        meta = {
            "id": sid,
            "name": safe_name[:60],
            "filename": filename,
            "ext": ext.lstrip("."),
            "size": size,
            "type": file_storage.mimetype or "audio/" + ext.lstrip("."),
            "created_at": datetime.now().isoformat(),
        }
        with self._lock:
            self._library.append(meta)
            self._persist()
        return deepcopy(meta)

    def delete(self, sid: str) -> bool:
        meta = self.get_meta(sid)
        if not meta:
            return False
        try:
            path = os.path.join(self.sounds_dir, meta["filename"])
            if os.path.exists(path):
                os.remove(path)
        except OSError as exc:
            if container.log:
                container.log.warning("No se pudo borrar %s: %s", meta["filename"], exc)
        with self._lock:
            self._library = [m for m in self._library if m["id"] != sid]
            ev = self._map.get("events", {})
            for k in list(ev.keys()):
                if ev[k] == sid:
                    ev.pop(k, None)
            for mode in self._map.get("modes", {}).values():
                if isinstance(mode, dict):
                    for k in list(mode.keys()):
                        if mode[k] == sid:
                            mode.pop(k, None)
            bg = self._map.get("background")
            if isinstance(bg, dict) and bg.get("id") == sid:
                self._map["background"] = None
            self._persist()
        return True

    def get_map(self) -> Dict:
        with self._lock:
            return deepcopy(self._map)

    def set_map(self, new_map: Dict) -> Dict:
        with self._lock:
            valid_ids = {m["id"] for m in self._library}
            events = new_map.get("events", {}) or {}
            cleaned_events = {k: v for k, v in events.items() if k in EVENT_KEYS and v in valid_ids}
            modes = {}
            for mode, evs in (new_map.get("modes", {}) or {}).items():
                if isinstance(evs, dict):
                    modes[mode] = {k: v for k, v in evs.items() if k in EVENT_KEYS and v in valid_ids}
            background = new_map.get("background")
            if isinstance(background, dict) and background.get("id") in valid_ids:
                background = {
                    "id": background["id"],
                    "loop": bool(background.get("loop", True)),
                    "volume": float(background.get("volume", 0.5)),
                }
            else:
                background = None
            channels = {c: float((new_map.get("channels", {}) or {}).get(c, 1.0)) for c in CHANNELS}
            self._map = {
                "events": cleaned_events,
                "modes": modes,
                "background": background,
                "channels": channels,
                "muted": bool(new_map.get("muted", self._map.get("muted", False))),
                "enabled": bool(new_map.get("enabled", self._map.get("enabled", True))),
            }
            self._persist()
        return deepcopy(self._map)


def get_sound_service() -> Optional[SoundService]:
    return getattr(container, "sound_service", None)
