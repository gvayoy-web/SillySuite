"""Servicio de estadisticas para SillyQuiz."""

import hashlib
import json
import os
import threading
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Any, Optional

from silly.globals import container
from silly.services.sse import EVENT_SNAPSHOT


class StatsService:
    """Servicio para recopilar, almacenar y analizar eventos de juego."""

    def __init__(self):
        self._lock = threading.Lock()
        self._current_session_id = None
        self._sessions = {}
        self._current_session_start = None
        self._event_handlers = {
            "timer:start": self._handle_timer_start,
            "modo:start": self._handle_mode_start,
            "puntos:change": self._handle_points_change,
            "state:snapshot": self._handle_snapshot,
            "question:change": self._handle_question_change,
            "display:update": self._handle_display_update,
        }
        self._enroll_event_bus()

    def _enroll_event_bus(self):
        """Registra el servicio para recibir eventos."""
        # Este metodo se llamara desde el contenedor
        pass

    def start_session(self, metadata: Optional[Dict] = None) -> str:
        """
        Inicia una nueva sesion de juego.

        Args:
            metadata: Metadatos opcionales para la sesion (torre, torneo, ID del participante)

        Returns:
            ID de la sesion iniciada
        """
        with self._lock:
            self._current_session_id = hashlib.sha256(
                f"{datetime.now().isoformat()}-{os.urandom(8).hex()}".encode()
            ).hexdigest()[:16]
            self._current_session_start = datetime.now()

            session_data = {
                "id": self._current_session_id,
                "start_time": self._current_session_start.isoformat(),
                "end_time": None,
                "hash": self._current_session_id,
                "eventos": [],
                "preguntas": {},
                "equipos": defaultdict(list),
                "jugadores": {},
                "estadisticas_pregunta": {},
                "tiempos_partida": {},
                "metadata": metadata or {},
            }
            self._sessions[self._current_session_id] = session_data
            return self._current_session_id

    def record_event(self, event_type: str, data: Dict) -> None:
        """
        Registra un evento en la sesion actual.

        Args:
            event_type: Tipo de evento
            data: Datos del evento
        """
        if not self._current_session_id:
            return

        with self._lock:
            session = self._sessions.get(self._current_session_id)
            if not session:
                return

            # Agregar evento
            evento = {
                "timestamp": datetime.now().isoformat(),
                "tipo": event_type,
                "datos": data,
                "sesion": self._current_session_id,
            }
            session["eventos"].append(evento)

            # Procesar con manejadores
            self._process_event(event_type, data, session)

    def _process_event(self, event_type: str, data: Dict, session: Dict):
        """Procesa el evento segun su tipo y actualiza los datos de la sesion."""
        if event_type in self._event_handlers:
            self._event_handlers[event_type](event_type, data, session)

    def _handle_timer_start(self, event_type: str, data: Dict, session: Dict):
        """Maneja el evento de inicio del temporizador."""
        session["tiempos_partida"]["inicio"] = datetime.now().isoformat()

    def _handle_mode_start(self, event_type: str, data: Dict, session: Dict):
        """Maneja el evento de inicio del modo."""
        session["eventos_modos"].append(
            {
                "timestamp": datetime.now().isoformat(),
                "modo": data.get("modo"),
                "activa": True,
            }
        )

    def _handle_points_change(self, event_type: str, data: Dict, session: Dict):
        """Maneja el evento de cambio de puntos."""
        grupo = data.get("grupo")
        cantidad = data.get("cantidad", 0)
        if grupo:
            session["equipos"][grupo].append(
                {
                    "timestamp": datetime.now().isoformat(),
                    "tipo": "cambio_puntos",
                    "cantidad": cantidad,
                    "equipo": grupo,
                }
            )

    def _handle_snapshot(self, event_type: str, data: Dict, session: Dict):
        """Maneja el snapshot del estado."""
        # Registrar los scores actuales
        if "puntos" in data:
            for grupo, puntos in data["puntos"].items():
                session["equipos"][grupo].append(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "tipo": "snapshot_puntos",
                        "puntos": puntos,
                        "equipo": grupo,
                    }
                )

        # Registrar la pregunta actual
        if "pregunta_actual" in data and data["pregunta_actual"]:
            session["preguntas"][str(data["pregunta_actual"].get("id", len(session["preguntas"])))] = {
                "pregunta_id": data["pregunta_actual"].get("id"),
                "texto": data["pregunta_actual"].get("texto", ""),
                "timestamp": datetime.now().isoformat(),
            }

    def _handle_question_change(self, event_type: str, data: Dict, session: Dict):
        """Maneja el evento de cambio de pregunta."""
        if isinstance(data, dict):
            qid = data.get("id", str(len(session["preguntas"])))
            session["preguntas"][qid] = {
                "id": qid,
                "texto": data.get("texto", ""),
                "respuesta_correcta": data.get("respuesta", ""),
                "mostrar_respuesta": data.get("mostrar_respuesta", False),
                "opciones_seleccionadas": data.get("opcion_seleccionada"),
                "tiempo_respuesta": data.get("tiempo_pregunta"),
                "timestamp": datetime.now().isoformat(),
            }

    def _handle_display_update(self, event_type: str, data: Dict, session: Dict):
        """Maneja el evento de actualizacion de display."""
        session["actualizaciones_display"].append(
            {
                "timestamp": datetime.now().isoformat(),
                "config": data.get("display_config", {}),
                "evento": event_type,
            }
        )

    def end_session(self) -> None:
        """Finaliza la sesion actual."""
        with self._lock:
            if self._current_session_id:
                session = self._sessions.get(self._current_session_id)
                if session:
                    session["end_time"] = datetime.now().isoformat()
                self._current_session_id = None
                self._current_session_start = None

    def get_session(self, session_id: str) -> Optional[Dict]:
        """
        Obtiene datos de una sesion específica.

        Args:
            session_id: ID de la sesion

        Returns:
            Datos de la sesion o None si no existe
        """
        with self._lock:
            return self._sessions.get(session_id)

    def get_all_sessions(self) -> List[Dict]:
        """Obtiene todos los IDs de sesiones."""
        with self._lock:
            return list(self._sessions.keys())

    def get_session_summary(self, session_id: str) -> Dict[str, Any]:
        """
        Obtiene un resumen de una sesion para el dashboard.

        Args:
            session_id: ID de la sesion

        Returns:
            Resumen de la sesion con metricas claves
        """
        session = self.get_session(session_id)
        if not session:
            return {}

        with self._lock:
            start = datetime.fromisoformat(session["start_time"])
            end_time = (
                datetime.fromisoformat(session["end_time"])
                if session["end_time"]
                else datetime.now()
            )
            duration = (end_time - start).total_seconds()

            # Analizar todos los eventos
            preguntas_completadas = len(session["preguntas"])
            cambios_puntos = []
            for equipo_events in session["equipos"].values():
                cambios_puntos.extend([e for e in equipo_events if e["tipo"] == "cambio_puntos"])

            return {
                "id": session["id"],
                "hash": session["hash"],
                "inicio": session["start_time"],
                "fin": session["end_time"],
                "duracion_segundos": duration,
                "duracion_minutos": round(duration / 60, 2),
                "metadatos": session["metadata"],
                "preguntas_completadas": preguntas_completadas,
                "cambios_puntos": len(cambios_puntos),
                "equipos_participantes": list(session["equipos"].keys()),
                "eventos_totales": len(session["eventos"]),
            }

    def generate_stats(self, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Genera estadisticas generales basadas en todas las sesiones.

        Args:
            start_time: Tiempo de inicio para filtrar sesiones
            end_time: Tiempo de fin para filtrar sesiones

        Returns:
            Estadisticas generales
        """
        with self._lock:
            filtered_sessions = self._sessions.values()
            if start_time:
                filtered_sessions = [s for s in filtered_sessions if datetime.fromisoformat(s["start_time"]) >= start_time]
            if end_time:
                filtered_sessions = [s for s in filtered_sessions if datetime.fromisoformat(s["start_time"]) <= end_time]

            total_sessions = len(filtered_sessions)
            if total_sessions == 0:
                return {
                    "total_partidas": 0,
                    "promedio_preguntas": 0,
                    "total_eventos": 0,
                    "participantes": 0,
                    "fecha_inicio": None,
                    "fecha_fin": None,
                    "estadisticas_generales": {},
                }

            all_events = []
            all_questions = {}
            total_preguntas = 0
            participantes_set = set()

            for session in filtered_sessions:
                all_events.extend(session["eventos"])
                all_questions.update(session["preguntas"])
                total_preguntas += len(session["preguntas"]) * 1.0

                for equipo in session["equipos"].keys():
                    participantes_set.add(equipo)

            start_dates = [datetime.fromisoformat(s["start_time"]) for s in filtered_sessions]
            end_dates = [
                datetime.fromisoformat(s["end_time"]) if s["end_time"] else datetime.now()
                for s in filtered_sessions
            ]

            return {
                "total_partidas": total_sessions,
                "promedio_preguntas": round(total_preguntas / total_sessions, 2),
                "total_eventos": len(all_events),
                "participantes": len(participantes_set),
                "fecha_inicio": min(start_dates).isoformat(),
                "fecha_fin": max(end_dates).isoformat(),
                "estadisticas_generales": {
                    "sesion_promedio": round((max(end_dates) - min(start_dates)).total_seconds() / total_sessions, 2)
                    if total_sessions > 0
                    else 0,
                    "pregunta_por_minuto": round(total_preguntas / (max(end_dates) - min(start_dates)).total_seconds() * 60, 2)
                    if total_sessions > 0
                    else 0,
                },
            }

    def clear_old_sessions(self, days: int = 30) -> None:
        """
        Elimina sesiones antiguas para limpiar almacenamiento.

        Args:
            days: Numero de dias antes de los cuales eliminar sesiones
        """
        with self._lock:
            cutoff = datetime.now().timestamp() - (days * 24 * 3600)
            to_delete = []
            for session_id, session in self._sessions.items():
                start_time = datetime.fromisoformat(session["start_time"]).timestamp()
                if start_time < cutoff:
                    to_delete.append(session_id)

            for session_id in to_delete:
                del self._sessions[session_id]

    def export_to_json(self, session_ids: Optional[List[str]] = None) -> str:
        """
        Exporta sesiones a JSON.

        Args:
            session_ids: Lista opcional de IDs de sesiones a exportar (si no se provee, se exportan todas)

        Returns:
            JSON string de las sesiones
        """
        with self._lock:
            if session_ids:
                filtered_sessions = [self._sessions[sid] for sid in session_ids if sid in self._sessions]
            else:
                filtered_sessions = list(self._sessions.values())

            export_data = {
                "version": "1.0",
                "timestamp": datetime.now().isoformat(),
                "sessions": filtered_sessions,
            }
            return json.dumps(export_data, indent=2, ensure_ascii=False)

    def close(self):
        """Cierra el servicio."""
        self._current_session_id = None
        self._current_session_start = None
