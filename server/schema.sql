-- Time Tracker sync service schema (self-hosted, SQLite).
-- Mirrors the Cloudflare D1 schema used by worker.js plus a small kv table that
-- stands in for the Worker's KV binding (token blocklist, allowed users, sync marker).

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT,
    client TEXT NOT NULL,
    startMs INTEGER,
    endMs INTEGER,
    arrivalMs INTEGER,
    startOffset INTEGER,
    arrivalOffset INTEGER,
    endOffset INTEGER,
    durationMs INTEGER,
    notes TEXT,
    parts TEXT,
    billableTime TEXT,
    travelDurationMs INTEGER,
    onSiteDurationMs INTEGER,
    startMileage REAL,
    arrivalMileage REAL,
    travelMileage REAL,
    isRemote INTEGER DEFAULT 0,
    invoice_number TEXT DEFAULT NULL,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    server_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_logs_deleted_at ON logs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_logs_user_server_updated ON logs(user_id, server_updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_user_client ON logs(user_id, client_id);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at INTEGER
);
