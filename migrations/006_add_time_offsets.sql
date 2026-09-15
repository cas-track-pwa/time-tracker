-- Migration 006: Consolidate time/date storage onto epoch-millisecond fields.
--
-- Time/date information is being consolidated onto epoch-millisecond fields
-- (`startMs` / `arrivalMs` / `endMs`) as the single source of truth; the
-- locale-formatted display strings (`start` / `end` / `arrivalTime` / `duration`
-- / `decimalHours`) are no longer written by the client and are rendered on
-- demand. An absolute instant alone does not record the wall-clock the user
-- actually saw, so three UTC-offset columns (minutes east of UTC) are added.
--
-- Phase 1 (additive, safe): the legacy columns are intentionally KEPT so
-- already-installed clients can still round-trip them. Because `start` and
-- `end` were declared NOT NULL they must become nullable before the worker can
-- stop writing them, and SQLite cannot alter a column constraint in place, so
-- the table is rebuilt. A follow-up migration will drop the legacy columns.
--
-- Apply to remote: npx wrangler d1 execute time-tracker --remote --file migrations/006_add_time_offsets.sql
-- Apply locally:   npx wrangler d1 execute time-tracker --local --file migrations/006_add_time_offsets.sql

CREATE TABLE logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id TEXT,
    client TEXT NOT NULL,
    start DATETIME,
    end DATETIME,
    arrival DATETIME,
    startMs INTEGER,
    endMs INTEGER,
    arrivalMs INTEGER,
    startOffset INTEGER,
    arrivalOffset INTEGER,
    endOffset INTEGER,
    duration TEXT,
    durationMs INTEGER,
    decimalHours TEXT,
    notes TEXT,
    parts TEXT,
    billableTime TEXT,
    arrivalTime TEXT,
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO logs_new (
    id, user_id, client_id, client, start, end, arrival,
    startMs, endMs, arrivalMs, duration, durationMs, decimalHours,
    notes, parts, billableTime, arrivalTime,
    travelDurationMs, onSiteDurationMs,
    startMileage, arrivalMileage, travelMileage,
    isRemote, invoice_number, deleted_at, created_at, updated_at
)
SELECT
    id, user_id, client_id, client, start, end, arrival,
    startMs, endMs, arrivalMs, duration, durationMs, decimalHours,
    notes, parts, billableTime, arrivalTime,
    travelDurationMs, onSiteDurationMs,
    startMileage, arrivalMileage, travelMileage,
    isRemote, invoice_number, deleted_at, created_at, updated_at
FROM logs;

DROP TABLE logs;

ALTER TABLE logs_new RENAME TO logs;

CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_start ON logs(start);
CREATE INDEX IF NOT EXISTS idx_logs_deleted_at ON logs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_logs_invoice_number ON logs(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_user_client ON logs(user_id, client_id);