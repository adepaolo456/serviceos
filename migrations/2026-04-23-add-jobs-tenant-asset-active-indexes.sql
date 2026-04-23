-- Phase A — Supporting indexes for the replacement NOT EXISTS predicate
-- introduced by Item 5 (current_job_id removal). Must run BEFORE the code
-- deploy that switches reads from `a.current_job_id IS NULL` to the
-- subquery, otherwise each availability query seq-scans jobs.
--
-- Two partial indexes instead of one composite because the replacement
-- predicate is an OR on two independent columns:
--
--     (j.asset_id = a.id OR j.drop_off_asset_id = a.id)
--
-- A single index on (tenant_id, asset_id, drop_off_asset_id) would serve
-- the asset_id branch efficiently, but the drop_off_asset_id branch would
-- require scanning all asset_id values (leftmost-prefix rule). Postgres
-- can bitmap-OR two separate single-column partial indexes and get a
-- clean plan for each side of the OR.
--
-- Both indexes are partial on the same non-terminal status predicate.
-- The predicate MUST match the canonical TERMINAL_JOB_STATUSES constant
-- exactly (see api/src/common/constants/job-statuses.ts), or the planner
-- won't use these indexes for the corresponding WHERE clause. Any change
-- to TERMINAL_JOB_STATUSES in code MUST be matched by a follow-up
-- migration that rebuilds both of these indexes with the new predicate.
--
-- DO NOT APPLY IN THIS PR — APPLY MANUALLY IN SUPABASE SQL EDITOR BEFORE
-- THE CODE DEPLOY. Without these, the replacement queries functionally
-- work but degrade to seq-scan on jobs.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_jobs_tenant_asset_id_active;
--   DROP INDEX IF EXISTS idx_jobs_tenant_drop_off_asset_id_active;

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_asset_id_active
  ON jobs (tenant_id, asset_id)
  WHERE status NOT IN ('completed', 'cancelled', 'failed', 'needs_reschedule');

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_drop_off_asset_id_active
  ON jobs (tenant_id, drop_off_asset_id)
  WHERE status NOT IN ('completed', 'cancelled', 'failed', 'needs_reschedule');
