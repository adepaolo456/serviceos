-- Rollback for 2026-04-14-marketplace-webhook-hardening.sql
--
-- WARNING: This restores a single-column UNIQUE CONSTRAINT on
-- marketplace_bookings.marketplace_booking_id. If, while the forward migration
-- was in effect, two tenants legitimately received the same external booking ID
-- (now permitted under the compound index), this rollback will FAIL because
-- the duplicates violate the restored constraint. Resolve those rows manually
-- (e.g., delete or rename one) before re-running.

BEGIN;

DROP INDEX IF EXISTS idx_marketplace_bookings_tenant_external;

ALTER TABLE marketplace_bookings
  ADD CONSTRAINT marketplace_bookings_marketplace_booking_id_key
  UNIQUE (marketplace_booking_id);

DROP TABLE IF EXISTS marketplace_integrations;

COMMIT;
