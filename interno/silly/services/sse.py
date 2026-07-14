"""SSE (Server-Sent Events) service — EventBus manages subscribers and notifications."""

import json
import queue
import threading

EVENT_TIMER_TICK = "timer:tick"
EVENT_TIMER_START = "timer:start"
EVENT_TIMER_STOP = "timer:stop"
EVENT_PUNTOS_CHANGE = "puntos:change"
EVENT_MODO_START = "modo:start"
EVENT_MODO_STOP = "modo:stop"
EVENT_DISPLAY_UPDATE = "display:update"
EVENT_QUESTION_CHANGE = "question:change"
EVENT_STATE_PERSIST = "state:persist"
EVENT_SNAPSHOT = "state:snapshot"


def _sse_message(event_type, data_dict):
    payload = json.dumps(data_dict, ensure_ascii=False)
    lines = []
    if event_type:
        lines.append(f"event: {event_type}")
    lines.append(f"data: {payload}")
    lines.append("")
    return "\n".join(lines)


class EventBus:
    def __init__(self, state, mode_manager, stats_service=None):
        self._state = state
        self._mode_manager = mode_manager
        self._stats_service = stats_service
        self._suscriptores = []
        self._lock = threading.Lock()

    def full_snapshot(self):
        snap = self._state.snapshot()
        mode_states = self._mode_manager.get_all_state()
        snap.update({k: v for k, v in mode_states.items() if k not in snap})
        snap["modo_activo"] = self._mode_manager.get_active_name() or ""
        snap["grupos"] = self._state.display_config.get("grupos_config", [])
        return snap

    def notify(self, event_type=None):
        snap = self._state.snapshot()
        mode_states = self._mode_manager.get_all_state()
        snap.update({k: v for k, v in mode_states.items() if k not in snap})
        snap["modo_activo"] = self._mode_manager.get_active_name() or ""
        snap["grupos"] = self._state.display_config.get("grupos_config", [])

        if self._stats_service and event_type:
            self._stats_service.record_event(event_type, snap)

        typed_msg = _sse_message(event_type or EVENT_SNAPSHOT, snap)
        plain_msg = _sse_message(None, snap)
        with self._lock:
            muertos = []
            for q in self._suscriptores:
                try:
                    q.put(typed_msg, timeout=0.2)
                    if event_type:
                        q.put(plain_msg, timeout=0.2)
                except queue.Full:
                    muertos.append(q)
            for q in muertos:
                self._suscriptores.remove(q)

    def subscribe(self, q):
        with self._lock:
            while len(self._suscriptores) >= 50:
                old_q = self._suscriptores.pop(0)
                try:
                    old_q.put(None, timeout=0.1)
                except Exception:
                    pass
            self._suscriptores.append(q)

    def unsubscribe(self, q):
        with self._lock:
            if q in self._suscriptores:
                self._suscriptores.remove(q)

    @property
    def suscriptores(self):
        return self._suscriptores

    @property
    def suscriptores_lock(self):
        return self._lock
