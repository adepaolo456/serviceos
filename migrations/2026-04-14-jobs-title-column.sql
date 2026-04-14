-- Driver Task V1 — add a nullable `title` column to the `jobs` table.
--
-- Driver Tasks are internal one-off operational items (bring truck to
-- the repair shop, go to the recycling facility, yard errand, etc.)
-- that reuse the existing jobs table with `job_type = 'driver_task'`,
-- following the same precedent as `job_type = 'dump_run'` (no customer,
-- no price, no lifecycle chain). The only thing the jobs table is
-- missing for a driver task is a human-readable title — lifecycle
-- jobs derive their title from customer + service_type + asset_subtype,
-- but driver tasks have none of those, so we need a dedicated field.
--
-- This column is:
--   • nullable — existing lifecycle jobs don't populate it
--   • additive — no data backfill
--   • no index — drivers and dispatchers don't query by title
--
-- Safe to apply in production with zero downtime.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS title TEXT;

COMMENT ON COLUMN jobs.title IS
  'Optional human-readable title. Populated only for Driver Tasks (job_type = driver_task) where there is no customer / service_type to derive a display name from. Lifecycle jobs leave this NULL and continue to derive their title from customer + asset_subtype + service_type.';
