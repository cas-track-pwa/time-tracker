import db from './db.js';

// Minimal stand-in for the Worker's KV binding. Values expire lazily on read,
// which is enough for the token blocklist (logout) and the allowed-users list.

export function kvGet(key) {
    const row = db.prepare('SELECT value, expires_at FROM kv WHERE key = ?').get(key);
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) {
        db.prepare('DELETE FROM kv WHERE key = ?').run(key);
        return null;
    }
    return row.value;
}

export function kvPut(key, value, ttlMs = null) {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    db.prepare(
        'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
    ).run(key, value, expiresAt);
}
