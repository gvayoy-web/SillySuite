from collections import deque
from datetime import datetime


class BaseMode:
    name = ""
    icon = ""

    def __init__(self, state, event_bus=None, config=None):
        self.state = state
        self._event_bus = event_bus
        self._config = config or {}
        self._log = deque(maxlen=200)

    def start(self, **kwargs):
        raise NotImplementedError

    def stop(self):
        raise NotImplementedError

    def handle_action(self, action, data=None):
        raise NotImplementedError

    def get_state(self):
        return {}

    def snapshot(self):
        return {self.name: self.get_state()}

    def log_actividad(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.append(f"[{ts}] {msg}")
        if hasattr(self.state, '_log_actividad'):
            self.state._log_actividad(msg)

    def get_activity(self):
        return list(self._log)
