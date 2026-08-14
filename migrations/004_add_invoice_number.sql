-- Migration: Add invoice_number column to logs table
-- Run this in Cloudflare D1 after deploying the updated code
-- Apply to remote: npx wrangler d1 execute time-tracker --remote < migrations/004_add_invoice_number.sql
-- Apply locally:   npx wrangler d1 execute time-tracker --local < migrations/004_add_invoice_number.sql

ALTER TABLE logs ADD COLUMN invoice_number TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_invoice_number ON logs(invoice_number) WHERE invoice_number IS NOT NULL;
