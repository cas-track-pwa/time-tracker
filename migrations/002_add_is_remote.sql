-- Migration: Add isRemote column to logs table
-- Run this in Cloudflare D1 after deploying the updated schema

-- Add the isRemote column to existing logs table
-- Using a default of 0 (false) for existing entries
ALTER TABLE logs ADD COLUMN isRemote INTEGER DEFAULT 0;
