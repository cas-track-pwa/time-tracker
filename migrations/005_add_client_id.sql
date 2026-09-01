-- Migration: Add client_id (per-log UUID) as the cross-device sync identity.
-- Previously the server used the client's IndexedDB autoincrement id directly as
-- the primary key. Two devices both start at id=1, so the second device to sync
-- could silently overwrite the first device's row. Each log now carries a
-- globally-unique client_id that is the sync key; the server's own autoincrement
-- id is purely internal.
--
-- Apply to remote: npx wrangler d1 execute time-tracker --remote < migrations/005_add_client_id.sql
-- Apply locally:   npx wrangler d1 execute time-tracker --local < migrations/005_add_client_id.sql

ALTER TABLE logs ADD COLUMN client_id TEXT;

-- Backfill existing rows with a deterministic value derived from the server
-- primary key ('legacy-<id>'). The upgraded client adopts this value during its
-- schema-upgrade full pull (matching by the old id), so no duplicates are created.
-- Rows created after this migration get a real UUID from the client (or a
-- server-generated UUID if a legacy client pushes without one).
UPDATE logs SET client_id = 'legacy-' || id WHERE client_id IS NULL;

-- Sync upserts are now keyed by (user_id, client_id) instead of id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_user_client ON logs(user_id, client_id);