-- Migration 008: Add a server-assigned monotonic sync cursor column.
--
-- The incremental pull filter used `updated_at`, which is authored by the
-- writing client. That value is not monotonic with respect to server insert
-- order: a row authored while offline can arrive at D1 minutes later carrying a
-- timestamp that predates the pull cursors of devices that synced in the gap.
-- Because the pull filter is strict `updated_at > since`, such a row is
-- permanently invisible to those devices, even though it exists in D1.
--
-- `server_updated_at` is stamped by the Worker on every accepted write (upsert
-- or tombstone) with millisecond server time, so insertion order and cursor
-- order agree. The pull now filters on this column. Client-authored `updated_at`
-- is retained unchanged for conflict resolution.
--
-- Backfill: approximate "last server write" as the later of the client
-- updated_at and the server created_at. Rows that were written and never
-- touched again therefore sort by their insert time.
--
-- Apply to remote: npx wrangler d1 execute time-tracker --remote --file migrations/008_add_server_updated_at.sql
-- Apply locally:   npx wrangler d1 execute time-tracker --local --file migrations/008_add_server_updated_at.sql

ALTER TABLE logs ADD COLUMN server_updated_at DATETIME;

UPDATE logs
SET server_updated_at = COALESCE(
    CASE WHEN created_at > updated_at THEN created_at ELSE updated_at END,
    updated_at,
    created_at,
    CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_user_server_updated ON logs(user_id, server_updated_at);