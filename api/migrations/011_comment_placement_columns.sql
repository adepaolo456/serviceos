-- 011_comment_placement_columns.sql
--
-- Documents jobs.placement_lat and jobs.placement_lng as customer-portal
-- drop-pin coordinates, distinct from the geocoding pipeline that fills
-- service_address.lat/lng.
--
-- Companion rollback: 011_comment_placement_columns_rollback.sql
--
-- Precedent: this migration is metadata-only. No DDL touches column type
-- or constraints, no data is modified, no rows are read or written.
-- Failure mode is a no-op (the columns retain their current NULL comments).
--
-- Pattern reference: api/migrations/010_comment_quotes_rls_policy.sql
-- (commit 325a3b7) — same COMMENT-only shape with a paired rollback.

BEGIN;

COMMENT ON COLUMN jobs.placement_lat IS
'Optional placement coordinate. Populated by the customer-portal "drop pin" flow (portal.service.ts:1087) where the customer marks where exactly to place the dumpster on their property. Independent of the geocoding pipeline that fills service_address.lat/lng. Null is the default and remains null on jobs where the customer has not dropped a pin.';

COMMENT ON COLUMN jobs.placement_lng IS
'Optional placement coordinate. Populated by the customer-portal "drop pin" flow (portal.service.ts:1087) where the customer marks where exactly to place the dumpster on their property. Independent of the geocoding pipeline that fills service_address.lat/lng. Null is the default and remains null on jobs where the customer has not dropped a pin.';

COMMIT;
