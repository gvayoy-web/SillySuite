"""
sse_connection_test.py — Tests para SSE (Server-Sent Events) EventBus.
Verifica suscripciones, notificaciones y manejo de colas.
"""
import queue
import threading
import time
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'interno'))


class MockState:
    def __init__(self):
        self.lock = threading.Lock()
        self.timer_segundos = 0
        self.modo = "preguntas"
        self.display_config = {"grupos_config": []}

    def snapshot(self):
        with self.lock:
            return {
                "timer_segundos": self.timer_segundos,
                "modo": self.modo,
                "display_config": dict(self.display_config)
            }


class MockModeManager:
    def __init__(self):
        self._active_name = "preguntas"
        self._secondary_name = None

    def get_all_state(self):
        return {"modo": self._active_name}

    def get_active_name(self, slot="primary"):
        if slot == "secondary":
            return self._secondary_name
        return self._active_name


class MockStatsService:
    def __init__(self):
        self.events = []

    def record_event(self, event_type, snap):
        self.events.append({"type": event_type, "snap": snap})


@pytest.fixture
def state():
    return MockState()


@pytest.fixture
def mode_manager():
    return MockModeManager()


@pytest.fixture
def stats_service():
    return MockStatsService()


@pytest.fixture
def event_bus(state, mode_manager, stats_service):
    from silly.services.sse import EventBus
    return EventBus(state, mode_manager, stats_service)


class TestEventBusSubscribe:
    def test_subscribe_single(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        assert q in event_bus.suscriptores

    def test_subscribe_multiple(self, event_bus):
        queues = [queue.Queue() for _ in range(5)]
        for q in queues:
            event_bus.subscribe(q)
        assert len(event_bus.suscriptores) == 5

    def test_subscribe_evicts_old_when_full(self, event_bus):
        for i in range(55):
            q = queue.Queue()
            event_bus.subscribe(q)
        assert len(event_bus.suscriptores) <= 50

    def test_unsubscribe(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        event_bus.unsubscribe(q)
        assert q not in event_bus.suscriptores

    def test_unsubscribe_nonexistent(self, event_bus):
        q = queue.Queue()
        event_bus.unsubscribe(q)
        assert len(event_bus.suscriptores) == 0


class TestEventBusNotify:
    def test_notify_sends_message(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        event_bus.notify("test:event")
        msg = q.get(timeout=2)
        assert "data:" in msg
        assert "event: test:event" in msg

    def test_notify_without_event_type(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        event_bus.notify()
        msg = q.get(timeout=2)
        assert "data:" in msg

    def test_notify_all_subscribers(self, event_bus):
        queues = [queue.Queue() for _ in range(3)]
        for q in queues:
            event_bus.subscribe(q)
        event_bus.notify("test")
        for q in queues:
            msg = q.get(timeout=2)
            assert "data:" in msg

    def test_notify_records_stats(self, event_bus, stats_service):
        q = queue.Queue()
        event_bus.subscribe(q)
        event_bus.notify("timer:tick")
        assert len(stats_service.events) == 1
        assert stats_service.events[0]["type"] == "timer:tick"

    def test_notify_includes_snapshot(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        event_bus.notify()
        msg = q.get(timeout=2)
        assert "timer_segundos" in msg


class TestEventBusFullQueue:
    def test_full_queue_removes_subscriber(self, event_bus):
        q = queue.Queue(maxsize=1)
        event_bus.subscribe(q)
        q.put("overflow", timeout=0.1)
        event_bus.notify("test")
        time.sleep(0.5)
        assert q not in event_bus.suscriptores


class TestEventBusFullSnapshot:
    def test_full_snapshot(self, event_bus):
        snap = event_bus.full_snapshot()
        assert "timer_segundos" in snap
        assert "modo" in snap
        assert "modo_activo" in snap


class TestEventBusThreadSafety:
    def test_concurrent_subscribe_unsubscribe(self, event_bus):
        errors = []

        def sub():
            try:
                q = queue.Queue()
                event_bus.subscribe(q)
                time.sleep(0.01)
                event_bus.unsubscribe(q)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=sub) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0

    def test_concurrent_notify(self, event_bus):
        q = queue.Queue()
        event_bus.subscribe(q)
        errors = []

        def notify():
            try:
                event_bus.notify("concurrent")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=notify) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(errors) == 0
        assert not q.empty()
