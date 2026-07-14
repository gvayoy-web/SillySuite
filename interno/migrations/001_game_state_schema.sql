-- Migración 001: Esquema de estado de juego para Modo Builder
-- Compatible con SQLite WAL mode para concurrencia en Waitress

-- Tabla principal de sesiones de juego
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
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_game_sessions_mode_id ON game_sessions(mode_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status);
CREATE INDEX IF NOT EXISTS idx_game_sessions_updated ON game_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_template ON game_sessions(template_id);

-- Tabla de eventos para SSE (Server-Sent Events)
CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES game_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_events_session_time ON game_events(session_id, timestamp);

-- Tabla de templates de modos (metadata para búsqueda rápida)
CREATE TABLE IF NOT EXISTS mode_templates (
    template_id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    icono TEXT,
    categoria TEXT,
    tags TEXT, -- JSON array
    version TEXT,
    autor TEXT,
    fecha_creacion REAL,
    preview_image TEXT,
    descargas INTEGER DEFAULT 0,
    calificacion REAL DEFAULT 0,
    template_config TEXT NOT NULL, -- JSON completo
    componentes TEXT NOT NULL, -- JSON array
    atributos TEXT NOT NULL, -- JSON object
    is_community INTEGER DEFAULT 0,
    original_template_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_mode_templates_categoria ON mode_templates(categoria);
CREATE INDEX IF NOT EXISTS idx_mode_templates_autor ON mode_templates(autor);
CREATE INDEX IF NOT EXISTS idx_mode_templates_descargas ON mode_templates(descargas DESC);
CREATE INDEX IF NOT EXISTS idx_mode_templates_calificacion ON mode_templates(calificacion DESC);

-- Tabla de valoraciones de templates
CREATE TABLE IF NOT EXISTS template_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id TEXT NOT NULL,
    user_hash TEXT NOT NULL, -- hash anónimo del usuario
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at REAL NOT NULL,
    FOREIGN KEY (template_id) REFERENCES mode_templates(template_id) ON DELETE CASCADE,
    UNIQUE(template_id, user_hash)
);

-- Tabla de modos dinámicos creados por usuarios (para marketplace)
CREATE TABLE IF NOT EXISTS user_modes (
    mode_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    icono TEXT,
    categoria TEXT,
    tags TEXT, -- JSON array
    config TEXT NOT NULL, -- JSON completo
    preview_image TEXT,
    autor_hash TEXT NOT NULL,
    autor_nombre TEXT,
    es_publico INTEGER DEFAULT 0,
    descargas INTEGER DEFAULT 0,
    calificacion REAL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY (template_id) REFERENCES mode_templates(template_id)
);

CREATE INDEX IF NOT EXISTS idx_user_modes_autor ON user_modes(autor_hash);
CREATE INDEX IF NOT EXISTS idx_user_modes_publico ON user_modes(es_publico, descargas DESC);
CREATE INDEX IF NOT EXISTS idx_user_modes_categoria ON user_modes(categoria);

-- Configuración de SQLite para rendimiento en Waitress
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32768; -- 32MB cache