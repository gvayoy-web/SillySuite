"""
mode_manager_test.py — Tests para ModeManager.
Verifica registro, inicio, detección y snapshot de modos.
"""
import threading
import time
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'interno'))


class MockMode:
    """Mock de un modo para testing."""
    def __init__(self, name, should_fail=False, icon=""):
        self.name = name
        self.icon = icon
        self.started = False
        self.stopped = False
        self.should_fail = should_fail
        self._state_data = {}

    def start(self, **kwargs):
        if self.should_fail:
            return {"error": f"Fallo simulado en {self.name}"}
        self.started = True
        return True

    def stop(self):
        self.stopped = True
        self.started = False

    def get_state(self):
        return {"name": self.name, "started": self.started}


class MockState:
    def __init__(self):
        self.lock = threading.Lock()
        self.modo = "preguntas"


class MockStateManager:
    def __init__(self):
        self.game_state_manager = None


@pytest.fixture
def state():
    return MockState()


@pytest.fixture
def manager(state):
    from silly.mode_manager import ModeManager
    return ModeManager(state)


class TestModeManagerRegistration:
    def test_register_mode(self, manager):
        mode = MockMode("preguntas")
        manager.register(mode)
        assert manager.get_mode("preguntas") is mode

    def test_register_multiple_modes(self, manager):
        m1 = MockMode("preguntas")
        m2 = MockMode("ruleta")
        manager.register(m1)
        manager.register(m2)
        assert manager.get_mode("preguntas") is m1
        assert manager.get_mode("ruleta") is m2

    def test_get_unknown_mode_returns_none(self, manager):
        assert manager.get_mode("desconocido") is None

    def test_modes_list(self, manager):
        m1 = MockMode("preguntas", icon="❓")
        m2 = MockMode("ruleta", icon="🎰")
        manager.register(m1)
        manager.register(m2)
        modes = manager.modes_list()
        assert "preguntas" in modes
        assert "ruleta" in modes
        assert modes["preguntas"]["icon"] == "❓"


class TestModeManagerStartStop:
    def test_start_mode(self, manager):
        mode = MockMode("preguntas")
        manager.register(mode)
        ok, err = manager.start_mode("preguntas")
        assert ok is True
        assert err is None
        assert mode.started is True
        assert manager.get_active_name() == "preguntas"

    def test_start_unknown_mode(self, manager):
        ok, err = manager.start_mode("desconocido")
        assert ok is False
        assert "no encontrado" in err

    def test_start_mode_with_error(self, manager):
        mode = MockMode("fallido", should_fail=True)
        manager.register(mode)
        ok, err = manager.start_mode("fallido")
        assert ok is False
        assert err is not None

    def test_stop_active_mode(self, manager):
        mode = MockMode("preguntas")
        manager.register(mode)
        manager.start_mode("preguntas")
        ok, err = manager.stop_active()
        assert ok is True
        assert err is None
        assert mode.stopped is True
        assert manager.get_active() is None

    def test_stop_no_active_mode(self, manager):
        ok, err = manager.stop_active()
        assert ok is False
        assert "No hay modo activo" in err

    def test_switch_mode(self, manager):
        m1 = MockMode("preguntas")
        m2 = MockMode("ruleta")
        manager.register(m1)
        manager.register(m2)
        manager.start_mode("preguntas")
        assert manager.get_active_name() == "preguntas"
        manager.start_mode("ruleta")
        assert manager.get_active_name() == "ruleta"
        assert m1.stopped is True

    def test_start_same_mode_no_restart(self, manager):
        mode = MockMode("preguntas")
        manager.register(mode)
        manager.start_mode("preguntas")
        mode.started = False
        manager.start_mode("preguntas")
        assert manager.get_active_name() == "preguntas"


class TestModeManagerSecondarySlot:
    def test_start_secondary(self, manager):
        m1 = MockMode("preguntas")
        m2 = MockMode("ruleta")
        manager.register(m1)
        manager.register(m2)
        manager.start_mode("preguntas")
        manager.start_mode("ruleta", slot="secondary")
        assert manager.get_active_name("primary") == "preguntas"
        assert manager.get_active_name("secondary") == "ruleta"

    def test_stop_secondary(self, manager):
        m1 = MockMode("preguntas")
        m2 = MockMode("ruleta")
        manager.register(m1)
        manager.register(m2)
        manager.start_mode("preguntas")
        manager.start_mode("ruleta", slot="secondary")
        ok, err = manager.stop_active(slot="secondary")
        assert ok is True
        assert m2.stopped is True
        assert manager.get_active("secondary") is None

    def test_stop_no_secondary(self, manager):
        ok, err = manager.stop_active(slot="secondary")
        assert ok is False
        assert "No hay modo secundario" in err


class TestModeManagerSnapshot:
    def test_get_all_state(self, manager):
        m1 = MockMode("preguntas")
        m2 = MockMode("ruleta")
        manager.register(m1)
        manager.register(m2)
        manager.start_mode("preguntas")
        state = manager.get_all_state()
        assert "preguntas" in state
        assert "ruleta" in state
        assert state["modo"] == "preguntas"
        assert state["modo_secundario"] is None


class TestModeManagerThreadSafety:
    def test_concurrent_registrations(self, manager):
        def register_mode(name):
            mode = MockMode(name)
            manager.register(mode)

        threads = [threading.Thread(target=register_mode, args=(f"mode_{i}",)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        modes = manager.modes_list()
        assert len(modes) == 20

    def test_concurrent_start_stop(self, manager):
        for i in range(10):
            manager.register(MockMode(f"mode_{i}"))

        errors = []

        def start_mode(name):
            try:
                manager.start_mode(name)
            except Exception as e:
                errors.append(e)

        def stop_mode():
            try:
                manager.stop_active()
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(10):
            threads.append(threading.Thread(target=start_mode, args=(f"mode_{i}",)))
            threads.append(threading.Thread(target=stop_mode))

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
