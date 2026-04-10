-- Phase 20 — Dumpster placement pin on jobs
-- Run in Supabase SQL editor BEFORE deploying the API.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS placement_lat DECIMAL(10,7) NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS placement_lng DECIMAL(10,7) NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS placement_pin_notes TEXT NULL;

-- rollback:
-- ALTER TABLE jobs DROP COLUMN IF EXISTS placement_lat;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS placement_lng;
-- ALTER TABLE jobs DROP COLUMN IF EXISTS placement_pin_notes;
