-- Migration 007: Drop the legacy time/date columns (phase 2).
--
-- Phase 1 (006_add_time_offsets.sql) consolidated time/date storage onto
-- epoch-millisecond fields plus per-timestamp UTC offsets. The legacy
-- locale-formatted display strings and formatted duplicates were kept so
-- already-installed clients could still round-trip them.
--
-- No shipped client reads or writes these columns any more, so they are
-- removed here:
--   start, end      -- locale-formatted display strings
--   arrival         -- dead DATETIME column (never written or read by the client)
--   duration        -- formatted duration duplicate of durationMs
--   decimalHours    -- formatted duplicate of durationMs
--   arrivalTime     -- locale time string for arrival
--
-- `idx_logs_start` indexes `start`, so it must be dropped before the column.
-- All date ordering already uses `startMs` (ORDER BY startMs).
--
-- Apply to remote: npx wrangler d1 execute time-tracker --remote --file migrations/007_drop_legacy_datetime_columns.sql
-- Apply locally:   npx wrangler d1 execute time-tracker --local --file migrations/007_drop_legacy_datetime_columns.sql

DROP INDEX IF EXISTS idx_logs_start;

ALTER TABLE logs DROP COLUMN start;
ALTER TABLE logs DROP COLUMN end;
ALTER TABLE logs DROP COLUMN arrival;
ALTER TABLE logs DROP COLUMN duration;
ALTER TABLE logs DROP COLUMN decimalHours;
ALTER TABLE logs DROP COLUMN arrivalTime;