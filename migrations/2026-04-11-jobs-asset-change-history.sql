-- Phase 11A — asset enforcement + audit trail
-- Add a narrow JSONB column on `jobs` to record every asset
-- assignment and correction for audit purposes. No new tables.
-- Run in Supabase SQL editor BEFORE deploying the API.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS asset_change_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Index to speed up "find any active job assigned to this asset"
-- queries used by the active-assignment conflict guard. The existing
-- btree on (tenant_id, asset_id) is sufficient for the guard; this
-- adds nothing new but is called out for posterity.

-- rollback:
-- ALTER TABLE jobs DROP COLUMN IF EXISTS asset_change_history;
