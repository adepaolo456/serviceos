-- 011_comment_placement_columns_rollback.sql
--
-- Reverses 011_comment_placement_columns.sql by clearing both column
-- comments back to NULL.
--
-- ONLY run this if you need to roll 011 back. The columns themselves
-- (jobs.placement_lat, jobs.placement_lng) are untouched by either 011
-- or this rollback; only the pg_description metadata rows are added or removed.

BEGIN;

COMMENT ON COLUMN jobs.placement_lat IS NULL;
COMMENT ON COLUMN jobs.placement_lng IS NULL;

COMMIT;
