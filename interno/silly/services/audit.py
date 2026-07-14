"""
audit.py — Sistema de auditoría y reportes del editor de modos.
Registra acciones de usuarios, métricas de uso y genera reportes.
"""
import json
import os
import time
import threading
import logging
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Any

log = logging.getLogger(__name__)

AUDIT_DIR = Path(__file__).parent.parent.parent / "logs"
AUDIT_FILE = AUDIT_DIR / "auditoria_editor.json"
METRICS_FILE = AUDIT_DIR / "metricas_uso.json"


class AuditLogger:
    """Logger de auditoría con persistencia en JSON."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)
        self._events: List[Dict] = []
        self._metrics: Dict[str, Any] = defaultdict(lambda: {"count": 0, "last_used": None})
        self._load_existing()

    def _load_existing(self):
        """Carga eventos existentes del disco."""
        if AUDIT_FILE.exists():
            try:
                with open(AUDIT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._events = data.get("events", [])[-1000:]  # Mantener últimos 1000
            except (json.JSONDecodeError, OSError):
                self._events = []

        if METRICS_FILE.exists():
            try:
                with open(METRICS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._metrics.update(data.get("templates", {}))
            except (json.JSONDecodeError, OSError):
                pass

    def _save(self):
        """Persiste eventos y métricas a disco."""
        try:
            with open(AUDIT_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "events": self._events[-1000:],
                    "last_updated": time.strftime('%Y-%m-%dT%H:%M:%S')
                }, f, ensure_ascii=False, indent=2)
        except OSError as e:
            log.error("Error guardando audit log: %s", e)

        try:
            with open(METRICS_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "templates": dict(self._metrics),
                    "last_updated": time.strftime('%Y-%m-%dT%H:%M:%S')
                }, f, ensure_ascii=False, indent=2)
        except OSError as e:
            log.error("Error guardando métricas: %s", e)

    def log_event(self, event_type: str, details: Dict, ip: str = None):
        """Registra un evento de auditoría."""
        event = {
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
            "type": event_type,
            "details": details,
            "ip": ip
        }
        self._events.append(event)
        if len(self._events) > 1000:
            self._events = self._events[-1000:]
        self._save()
        log.info("AUDIT: %s — %s", event_type, json.dumps(details, ensure_ascii=False)[:200])

    def log_template_action(self, template_id: str, action: str, ip: str = None):
        """Registra una acción sobre un template."""
        self.log_event("template_action", {
            "template_id": template_id,
            "action": action
        }, ip)
        # Actualizar métricas
        key = f"{template_id}:{action}"
        self._metrics[key]["count"] += 1
        self._metrics[key]["last_used"] = time.strftime('%Y-%m-%dT%H:%M:%S')

    def log_mode_compile(self, template_id: str, success: bool, errors: List[str] = None):
        """Registra un evento de compilación de modo."""
        self.log_event("mode_compile", {
            "template_id": template_id,
            "success": success,
            "errors": errors or []
        })

    def log_security_event(self, event_type: str, details: Dict, ip: str = None):
        """Registra un evento de seguridad."""
        self.log_event(f"security:{event_type}", details, ip)

    def get_recent_events(self, limit: int = 50, event_type: str = None) -> List[Dict]:
        """Obtiene los eventos más recientes."""
        events = self._events
        if event_type:
            events = [e for e in events if e.get("type") == event_type]
        return events[-limit:]

    def get_template_metrics(self, template_id: str = None) -> Dict:
        """Obtiene métricas de uso de templates."""
        if template_id:
            return {k: v for k, v in self._metrics.items() if k.startswith(template_id)}
        return dict(self._metrics)

    def get_usage_report(self) -> Dict:
        """Genera un reporte de uso consolidado."""
        total_events = len(self._events)
        event_types = defaultdict(int)
        template_actions = defaultdict(int)
        security_events = []

        for event in self._events:
            event_types[event.get("type", "unknown")] += 1
            if event.get("type") == "template_action":
                template_actions[event.get("details", {}).get("template_id", "unknown")] += 1
            if event.get("type", "").startswith("security:"):
                security_events.append(event)

        return {
            "total_events": total_events,
            "event_types": dict(event_types),
            "top_templates": dict(sorted(template_actions.items(), key=lambda x: -x[1])[:10]),
            "security_events_count": len(security_events),
            "last_event": self._events[-1] if self._events else None,
            "generated_at": time.strftime('%Y-%m-%dT%H:%M:%S')
        }


@lru_cache(maxsize=1024)
def verificar_validez_template(template_id: str) -> Dict:
    """Verifica la validez de un template (con cache)."""
    from silly.template_registry import template_registry
    tpl = template_registry.get_template(template_id)
    if tpl is None:
        return {"valid": False, "reason": "template_not_found"}
    if "heads" in tpl:
        heads = tpl["heads"]
        if not isinstance(heads, dict):
            return {"valid": False, "reason": "heads_not_dict"}
        if not any(k.startswith("on_") for k in heads.keys()):
            return {"valid": False, "reason": "no_hat_events"}
    return {"valid": True, "reason": None}


# Instancia global
audit_logger = AuditLogger()
