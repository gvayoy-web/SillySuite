"""
GameStateManager - Gestor de estado de juego centralizado con SQLite WAL mode.
Soluciona problemas de concurrencia en Waitress (multi-thread).
Todas las operaciones son atómicas y thread-safe.
"""

import sqlite3
import json
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from datetime import datetime

DB_PATH = Path(__file__).parent.parent.parent / "game_state.db"


@dataclass
class GameSession:
    session_id: str
    mode_id: str
    mode_type: str  # 'static' | 'dynamic'
    template_id: Optional[str]
    config: Dict[str, Any]
    state: Dict[str, Any]
    created_at: float
    updated_at: float
    status: str  # 'waiting' | 'active' | 'paused' | 'finished'
    players: Dict[str, Any]
    metadata: Dict[str, Any]


class GameStateManager:
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
        self._init_database()

    def _init_database(self):
        """Inicializa BD con WAL mode para concurrencia"""
        with self._get_connection() as conn:
            # Configuración de rendimiento para Waitress
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA cache_size=-32768")

            # Tabla principal de sesiones
            conn.execute("""
                CREATE TABLE IF NOT EXISTS game_sessions (
                    session_id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    mode_type TEXT NOT NULL CHECK(mode_type IN ('static', 'dynamic')),
                    template_id TEXT,
                    config TEXT NOT NULL,
                    state TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'waiting' 
                        CHECK(status IN ('waiting', 'active', 'paused', 'finished')),
                    players TEXT NOT NULL DEFAULT '{}',
                    metadata TEXT NOT NULL DEFAULT '{}'
                )
            """)

            # Índices para consultas frecuentes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_mode_id ON game_sessions(mode_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_updated ON game_sessions(updated_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_template ON game_sessions(template_id)")

            # Tabla de eventos para SSE
            conn.execute("""
                CREATE TABLE IF NOT EXISTS game_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    timestamp REAL NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES game_sessions(session_id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_game_events_session_time ON game_events(session_id, timestamp)")

            # Templates metadata para búsqueda rápida
            conn.execute("""
                CREATE TABLE IF NOT EXISTS mode_templates (
                    template_id TEXT PRIMARY KEY,
                    nombre TEXT NOT NULL,
                    descripcion TEXT,
                    icono TEXT,
                    categoria TEXT,
                    tags TEXT,
                    version TEXT,
                    autor TEXT,
                    fecha_creacion REAL,
                    preview_image TEXT,
                    descargas INTEGER DEFAULT 0,
                    calificacion REAL DEFAULT 0,
                    template_config TEXT NOT NULL,
                    componentes TEXT NOT NULL,
                    atributos TEXT NOT NULL,
                    is_community INTEGER DEFAULT 0,
                    original_template_id TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_mode_templates_categoria ON mode_templates(categoria)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_mode_templates_descargas ON mode_templates(descargas DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_mode_templates_calificacion ON mode_templates(calificacion DESC)")

            # Ratings
            conn.execute("""
                CREATE TABLE IF NOT EXISTS template_ratings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_id TEXT NOT NULL,
                    user_hash TEXT NOT NULL,
                    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                    comment TEXT,
                    created_at REAL NOT NULL,
                    FOREIGN KEY (template_id) REFERENCES mode_templates(template_id) ON DELETE CASCADE,
                    UNIQUE(template_id, user_hash)
                )
            """)

            # Modos de usuario (marketplace)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_modes (
                    mode_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    nombre TEXT NOT NULL,
                    descripcion TEXT,
                    icono TEXT,
                    categoria TEXT,
                    tags TEXT,
                    config TEXT NOT NULL,
                    preview_image TEXT,
                    autor_hash TEXT NOT NULL,
                    autor_nombre TEXT,
                    es_publico INTEGER DEFAULT 0,
                    descargas INTEGER DEFAULT 0,
                    calificacion REAL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY (template_id) REFERENCES mode_templates(template_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_user_modes_autor ON user_modes(autor_hash)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_user_modes_publico ON user_modes(es_publico, descargas DESC)")

            # Tabla de rate-limit persistente (Fase 3b)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rate_limits (
                    key TEXT NOT NULL,
                    ts REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits(key, ts)")

            # Configuración SQLite para rendimiento
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA cache_size=-32768")

            conn.commit()

    @contextmanager
    def _get_connection(self):
        """Conexión thread-local con row_factory"""
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    # === RATE LIMIT PERSISTENCE (Fase 3b) ===

    def record_rate_event(self, key: str, ts: float) -> None:
        """Registra un hit de rate-limit y poda entradas muy antiguas."""
        with self._get_connection() as conn:
            conn.execute("INSERT INTO rate_limits (key, ts) VALUES (?, ?)", (key, ts))
            conn.execute("DELETE FROM rate_limits WHERE ts < ?", (ts - 86400,))
            conn.commit()

    def count_rate_events(self, key: str, since_ts: float) -> int:
        """Cuenta hits de `key` con ts >= since_ts (ventana deslizante)."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM rate_limits WHERE key = ? AND ts >= ?",
                (key, since_ts)
            ).fetchone()
            return int(row['c']) if row else 0

    def reset_rate_limit(self, key: str) -> None:
        """Elimina todos los hits de `key`."""
        with self._get_connection() as conn:
            conn.execute("DELETE FROM rate_limits WHERE key = ?", (key,))
            conn.commit()

    # === OPERACIONES DE SESIÓN ===

    def create_session(self, mode_id: str, mode_type: str, config: Dict,
                       template_id: str = None) -> GameSession:
        """Crea nueva sesión de juego"""
        session_id = f"sess_{uuid.uuid4().hex[:8]}"
        now = time.time()

        session = GameSession(
            session_id=session_id,
            mode_id=mode_id,
            mode_type=mode_type,
            template_id=template_id,
            config=config,
            state={},
            created_at=now,
            updated_at=now,
            status='waiting',
            players={},
            metadata={}
        )

        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO game_sessions 
                (session_id, mode_id, mode_type, template_id, config, state, 
                 created_at, updated_at, status, players, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session.session_id, session.mode_id, session.mode_type,
                session.template_id, json.dumps(session.config), json.dumps(session.state),
                session.created_at, session.updated_at, session.status,
                json.dumps(session.players), json.dumps(session.metadata)
            ))
            conn.commit()

        self._emit_event(session_id, 'session_created', asdict(session))
        return session

    def get_session(self, session_id: str) -> Optional[GameSession]:
        """Obtiene sesión por ID"""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM game_sessions WHERE session_id = ?", 
                (session_id,)
            ).fetchone()
            return self._row_to_session(row) if row else None

    def update_session_state(self, session_id: str, state_updates: Dict, 
                             status: str = None) -> bool:
        """Actualiza estado de sesión atómicamente con control de concurrencia optimista"""
        max_retries = 3
        for attempt in range(max_retries):
            with self._get_connection() as conn:
                # Leer estado actual y versión
                row = conn.execute(
                    "SELECT state, updated_at FROM game_sessions WHERE session_id = ?",
                    (session_id,)
                ).fetchone()
                if not row:
                    return False

                current_state = json.loads(row['state'])
                last_modified = row['updated_at']

                # Merge updates
                current_state.update(state_updates)
                now = time.time()

                # Actualizar con verificación de versión (optimistic locking)
                if status:
                    cursor = conn.execute("""
                        UPDATE game_sessions 
                        SET state = ?, updated_at = ?, status = ?
                        WHERE session_id = ? AND updated_at = ?
                    """, (json.dumps(current_state), now, status, session_id, last_modified))
                else:
                    cursor = conn.execute("""
                        UPDATE game_sessions 
                        SET state = ?, updated_at = ?
                        WHERE session_id = ? AND updated_at = ?
                    """, (json.dumps(current_state), now, session_id, last_modified))

                if cursor.rowcount == 0:
                    # Conflicto de concurrencia - reintentar
                    if attempt < max_retries - 1:
                        time.sleep(0.01 * (attempt + 1))
                        continue
                    return False

                conn.commit()

            self._emit_event(session_id, 'state_updated', {
                'session_id': session_id,
                'state': current_state,
                'status': status
            })
            return True

        return False

    def add_player(self, session_id: str, player_id: str, player_data: Dict) -> bool:
        """Agrega jugador a sesión"""
        session = self.get_session(session_id)
        if not session:
            return False

        session.players[player_id] = player_data
        return self.update_session_state(session_id, {'players': session.players})

    def remove_player(self, session_id: str, player_id: str) -> bool:
        """Remueve jugador de sesión"""
        session = self.get_session(session_id)
        if not session:
            return False

        session.players.pop(player_id, None)
        return self.update_session_state(session_id, {'players': session.players})

    def list_sessions(self, status: str = None, mode_id: str = None, 
                      limit: int = 100) -> List[GameSession]:
        """Lista sesiones con filtros"""
        query = "SELECT * FROM game_sessions WHERE 1=1"
        params = []

        if status:
            query += " AND status = ?"
            params.append(status)
        if mode_id:
            query += " AND mode_id = ?"
            params.append(mode_id)

        query += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)

        with self._get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
            return [self._row_to_session(r) for r in rows]

    def delete_session(self, session_id: str) -> bool:
        """Elimina sesión y sus eventos"""
        with self._get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM game_sessions WHERE session_id = ?", 
                (session_id,)
            )
            conn.commit()
            return cursor.rowcount > 0

    # === EVENTOS PARA SSE ===

    def _emit_event(self, session_id: str, event_type: str, payload: Dict):
        """Emite evento para SSE"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO game_events (session_id, event_type, payload, timestamp)
                VALUES (?, ?, ?, ?)
            """, (session_id, event_type, json.dumps(payload), time.time()))
            conn.commit()

    def get_events_since(self, session_id: str, since_timestamp: float) -> List[Dict]:
        """Obtiene eventos desde timestamp para SSE"""
        with self._get_connection() as conn:
            rows = conn.execute("""
                SELECT event_type, payload, timestamp FROM game_events
                WHERE session_id = ? AND timestamp > ?
                ORDER BY timestamp ASC
            """, (session_id, since_timestamp)).fetchall()
            return [dict(r) for r in rows]

    # === TEMPLATES METADATA ===

    def save_template_metadata(self, template: Dict) -> bool:
        """Guarda/actualiza metadata de template para búsqueda rápida"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO mode_templates 
                (template_id, nombre, descripcion, icono, categoria, tags, version,
                 autor, fecha_creacion, preview_image, descargas, calificacion,
                 template_config, componentes, atributos, is_community, original_template_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                template['id'],
                template['nombre'],
                template.get('descripcion', ''),
                template.get('icono', '📋'),
                template.get('categoria', 'general'),
                json.dumps(template.get('tags', [])),
                template.get('version', '1.0.0'),
                template.get('autor', 'Sistema'),
                template.get('fecha_creacion', time.time()),
                template.get('preview_image', ''),
                template.get('descargas', 0),
                template.get('calificacion', 0),
                json.dumps(template.get('template_config', {})),
                json.dumps(template.get('componentes', [])),
                json.dumps(template.get('atributos', {})),
                1 if template.get('autor') != 'Sistema' else 0,
                template.get('original_template_id')
            ))
            conn.commit()
            return True

    def get_template_metadata(self, template_id: str) -> Optional[Dict]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM mode_templates WHERE template_id = ?", 
                (template_id,)
            ).fetchone()
            return dict(row) if row else None

    def search_templates(self, query: str = None, categoria: str = None,
                         ordenar: str = 'nombre', limit: int = 50) -> List[Dict]:
        """Busca templates con filtros"""
        sql = "SELECT * FROM mode_templates WHERE 1=1"
        params = []

        if query:
            sql += " AND (nombre LIKE ? OR descripcion LIKE ?)"
            params.extend([f"%{query}%", f"%{query}%"])
        if categoria:
            sql += " AND categoria = ?"
            params.append(categoria)

        # Ordenar
        order_map = {
            'nombre': 'nombre ASC',
            'descargas': 'descargas DESC',
            'calificacion': 'calificacion DESC',
            'reciente': 'fecha_creacion DESC'
        }
        sql += f" ORDER BY {order_map.get(ordenar, 'nombre ASC')} LIMIT ?"
        params.append(limit)

        with self._get_connection() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def increment_downloads(self, template_id: str):
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE mode_templates SET descargas = descargas + 1 WHERE template_id = ?",
                (template_id,)
            )
            conn.commit()

    def update_rating(self, template_id: str, new_rating: float):
        with self._get_connection() as conn:
            # Calcular promedio ponderado simple
            row = conn.execute(
                "SELECT calificacion, descargas FROM mode_templates WHERE template_id = ?",
                (template_id,)
            ).fetchone()
            if row:
                current = row['calificacion'] or 0
                downloads = row['descargas'] or 1
                # Promedio ponderado simple
                new_avg = round((current * (downloads - 1) + new_rating) / downloads, 1)
                conn.execute(
                    "UPDATE mode_templates SET calificacion = ? WHERE template_id = ?",
                    (new_avg, template_id)
                )
                conn.commit()

    # === USER MODES (MARKETPLACE) ===

    def save_user_mode(self, mode_data: Dict) -> bool:
        """Guarda modo de usuario para marketplace"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO user_modes 
                (mode_id, session_id, template_id, nombre, descripcion, icono,
                 categoria, tags, config, preview_image, autor_hash, autor_nombre,
                 es_publico, descargas, calificacion, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                mode_data['mode_id'],
                mode_data['session_id'],
                mode_data['template_id'],
                mode_data['nombre'],
                mode_data.get('descripcion', ''),
                mode_data.get('icono', '🎮'),
                mode_data.get('categoria', 'custom'),
                json.dumps(mode_data.get('tags', [])),
                json.dumps(mode_data['config']),
                mode_data.get('preview_image', ''),
                mode_data['autor_hash'],
                mode_data.get('autor_nombre', 'Anónimo'),
                1 if mode_data.get('es_publico') else 0,
                mode_data.get('descargas', 0),
                mode_data.get('calificacion', 0),
                mode_data.get('created_at', time.time()),
                mode_data.get('updated_at', time.time())
            ))
            conn.commit()
            return True

    def get_public_modes(self, categoria: str = None, limit: int = 20) -> List[Dict]:
        """Obtiene modos públicos para marketplace"""
        sql = "SELECT * FROM user_modes WHERE es_publico = 1"
        params = []
        if categoria:
            sql += " AND categoria = ?"
            params.append(categoria)
        sql += " ORDER BY descargas DESC, calificacion DESC LIMIT ?"
        params.append(limit)

        with self._get_connection() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def _row_to_session(self, row) -> GameSession:
        return GameSession(
            session_id=row['session_id'],
            mode_id=row['mode_id'],
            mode_type=row['mode_type'],
            template_id=row['template_id'],
            config=json.loads(row['config']),
            state=json.loads(row['state']),
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            status=row['status'],
            players=json.loads(row['players']),
            metadata=json.loads(row['metadata'])
        )


# Instancia global
game_state_manager = GameStateManager()