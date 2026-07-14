"""
Gestor de comunicación híbrida: SSE para updates + REST para acciones.
Compatible 100% con Waitress (sin WebSockets nativos).
"""

import json
import time
import threading
import queue
from typing import Dict, List, Optional, Generator
from flask import Response, request, stream_with_context
from dataclasses import dataclass

from .game_state_manager import game_state_manager


@dataclass
class SSEClient:
    session_id: str
    queue: queue.Queue
    last_event_id: int
    connected_at: float
    user_agent: str


class CommunicationManager:
    """
    Maneja conexiones SSE para updates en tiempo real.
    Usa polling/REST para acciones cliente->servidor.
    """
    
    def __init__(self):
        self._clients: Dict[str, List[SSEClient]] = {}  # session_id -> [clients]
        self._lock = threading.Lock()
        self._event_id_counter = 0
        self._event_id_lock = threading.Lock()
    
    def _next_event_id(self) -> int:
        with self._event_id_lock:
            self._event_id_counter += 1
            return self._event_id_counter
    
    def register_sse_client(self, session_id: str) -> SSEClient:
        """Registra nuevo cliente SSE para sesión"""
        client = SSEClient(
            session_id=session_id,
            queue=queue.Queue(maxsize=100),
            last_event_id=0,
            connected_at=time.time(),
            user_agent=request.headers.get('User-Agent', 'unknown')
        )
        
        with self._lock:
            if session_id not in self._clients:
                self._clients[session_id] = []
            self._clients[session_id].append(client)
        
        print(f"[CommManager] Cliente SSE conectado a sesión {session_id}. Total: {len(self._clients.get(session_id, []))}")
        return client
    
    def unregister_sse_client(self, session_id: str, client: SSEClient):
        """Desregistra cliente SSE"""
        with self._lock:
            if session_id in self._clients:
                try:
                    self._clients[session_id].remove(client)
                    if not self._clients[session_id]:
                        del self._clients[session_id]
                except ValueError:
                    pass
    
    def broadcast_to_session(self, session_id: str, event_type: str, payload: Dict):
        """Envía evento a todos los clientes de una sesión"""
        event_id = self._next_event_id()
        event_data = f"id: {event_id}\nevent: {event_type}\ndata: {json.dumps(payload)}\n\n"
        
        with self._lock:
            clients = self._clients.get(session_id, []).copy()
        
        for client in clients:
            try:
                client.queue.put_nowait(event_data)
                client.last_event_id = event_id
            except queue.Full:
                # Cliente lento - desconectar
                self.unregister_sse_client(session_id, client)
    
    def create_sse_response(self, session_id: str, last_event_id: int = 0) -> Response:
        """Crea respuesta SSE streaming"""
        client = self.register_sse_client(session_id)
        
        # Enviar eventos perdidos si last_event_id > 0
        if last_event_id > 0:
            events = game_state_manager.get_events_since(session_id, last_event_id / 1000.0)
            for evt in events:
                try:
                    client.queue.put_nowait(
                        f"id: {evt.get('id', 0)}\nevent: {evt['event_type']}\ndata: {json.dumps(evt['payload'])}\n\n"
                    )
                except queue.Full:
                    break
        
        def event_stream():
            try:
                # Heartbeat inicial
                yield f": connected\n\n"
                
                while True:
                    try:
                        # Timeout para heartbeat cada 30s
                        event_data = client.queue.get(timeout=30)
                        yield event_data
                    except queue.Empty:
                        # Heartbeat
                        yield f": heartbeat {int(time.time())}\n\n"
                    except GeneratorExit:
                        break
            finally:
                self.unregister_sse_client(session_id, client)
        
        response = Response(
            stream_with_context(event_stream()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',  # Disable nginx buffering
            }
        )
        return response
    
    def get_session_clients_count(self, session_id: str) -> int:
        with self._lock:
            return len(self._clients.get(session_id, []))

    def get_active_sessions(self) -> List[str]:
        with self._lock:
            return list(self._clients.keys())


# Instancia global
communication_manager = CommunicationManager()