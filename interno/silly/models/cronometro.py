from __future__ import annotations

import threading
import time
from typing import Callable


class Cronometro(threading.Thread):
    def __init__(self, name: str = "Cronometro", on_timeout: Callable[[], None] | None = None, on_tick: Callable[[float], None] | None = None) -> None:
        super().__init__(daemon=True, name=name)
        self._cv: threading.Condition = threading.Condition()
        self._running: bool = False
        self._target_end: float = 0.0
        self._duracion_original: int = 0
        self._shutdown: bool = False
        self._on_timeout: Callable[[], None] | None = on_timeout
        self._on_tick: Callable[[float], None] | None = on_tick

    def arrancar(self, segundos: int) -> None:
        with self._cv:
            self._duracion_original = segundos
            self._target_end = time.monotonic() + segundos
            self._running = True
            self._cv.notify()

    def reiniciar(self) -> None:
        with self._cv:
            self._target_end = time.monotonic() + self._duracion_original
            self._running = True
            self._cv.notify()

    def parar(self) -> None:
        with self._cv:
            self._running = False
            self._cv.notify()

    def stop_thread(self) -> None:
        with self._cv:
            self._shutdown = True
            self._running = False
            self._cv.notify()

    @property
    def remaining(self) -> int:
        with self._cv:
            if not self._running:
                return 0
            return max(0, int(self._target_end - time.monotonic()))

    def run(self) -> None:
        while not self._shutdown:
            with self._cv:
                if self._shutdown:
                    break
                if not self._running:
                    self._cv.wait()
                    continue
                now: float = time.monotonic()
                wait: float = max(0, self._target_end - now)
                self._cv.wait(timeout=min(wait, 0.5))
                if self._shutdown or not self._running:
                    continue
                now = time.monotonic()
                if now >= self._target_end:
                    self._running = False
                    if self._on_timeout:
                        self._on_timeout()
                else:
                    if self._on_tick:
                        self._on_tick(max(0, self._target_end - now))
