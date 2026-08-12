-- Migration 002: Add soft-delete tombstone support to logs table
-- Apply to remote:  npx wrangler d1 execute time-tracker --remote < migrations/002_soft_delete.sql
-- Apply locally:    npx wrangler d1 execute time-tracker --local < migrations/002_soft_delete.sql

ALTER TABLE logs ADD COLUMN deleted_at DATETIME DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_deleted_at ON logs(deleted_at);
