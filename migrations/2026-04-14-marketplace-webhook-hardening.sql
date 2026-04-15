-- Marketplace webhook hardening — integration table + tenant-scoped uniqueness.
--
-- Background:
--   POST /marketplace/bookings was previously @Public() and accepted tenantId
--   from the request body, allowing cross-tenant booking injection. Phase 0
--   shut the endpoint down (returns 503). This migration creates the schema
--   needed by Phase 1, where the controller will:
--     1. Read X-Marketplace-Key-Id from the webhook header
--     2. Look up marketplace_integrations row (enabled = true) by (source, key_id)
--     3. Verify HMAC-SHA256 over `${timestamp}.${rawBody}` with the row secret
--     4. Resolve tenant_id from the row — never from the request body
--
-- This migration:
--   1. Creates marketplace_integrations (one row per tenant per marketplace source)
--   2. Replaces the global UNIQUE on marketplace_bookings.marketplace_booking_id
--      with a tenant-scoped UNIQUE on (tenant_id, marketplace_booking_id), so
--      different tenants may legitimately receive overlapping external IDs and
--      so an attacker cannot enumerate booking IDs across tenants.
--
-- Safe to apply with zero downtime: the endpoint is currently disabled (Phase 0),
-- and the constraint swap only relaxes uniqueness — no existing row will conflict.

BEGIN;

-- ============================================================
-- 1. marketplace_integrations
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source          text NOT NULL DEFAULT 'rentthis',
  key_id          text NOT NULL,
  signing_secret  text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketplace_integrations IS
  'Per-tenant marketplace webhook integrations. key_id is the public identifier carried in the X-Marketplace-Key-Id header; signing_secret is used by the API to verify HMAC-SHA256 signatures on POST /marketplace/bookings. Resolves which tenant a webhook belongs to without trusting any client-supplied field.';

CREATE INDEX IF NOT EXISTS idx_marketplace_integrations_tenant
  ON marketplace_integrations(tenant_id);

-- key_id is globally unique within a source so the controller can resolve
-- the integration row without knowing the tenant in advance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_integrations_source_key
  ON marketplace_integrations(source, key_id);

-- ============================================================
-- 2. marketplace_bookings: drop global unique, add compound unique
-- ============================================================
-- Drop any single-column UNIQUE CONSTRAINT on marketplace_booking_id, regardless
-- of its auto-generated name. No-op if no such constraint exists.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel       ON rel.oid = con.conrelid
  JOIN pg_attribute att   ON att.attrelid = rel.oid
                         AND att.attnum = ANY (con.conkey)
  WHERE rel.relname = 'marketplace_bookings'
    AND att.attname = 'marketplace_booking_id'
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE marketplace_bookings DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- Drop any orphan single-column UNIQUE INDEX on marketplace_booking_id that
-- exists outside a constraint (defensive — handles the edge case where the
-- column was made unique via CREATE UNIQUE INDEX rather than a constraint).
DO $$
DECLARE
  iname text;
BEGIN
  FOR iname IN
    SELECT i.relname
    FROM pg_index ix
    JOIN pg_class i         ON i.oid = ix.indexrelid
    JOIN pg_class t         ON t.oid = ix.indrelid
    JOIN pg_attribute a     ON a.attrelid = t.oid
                           AND a.attnum = ANY (ix.indkey)
    LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid
    WHERE t.relname = 'marketplace_bookings'
      AND a.attname = 'marketplace_booking_id'
      AND ix.indisunique
      AND array_length(ix.indkey, 1) = 1
      AND con.conname IS NULL
  LOOP
    EXECUTE format('DROP INDEX %I', iname);
  END LOOP;
END $$;

-- Tenant-scoped uniqueness: same external booking ID is allowed in different
-- tenants but never duplicated within a single tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_bookings_tenant_external
  ON marketplace_bookings(tenant_id, marketplace_booking_id);

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES (run after applying)
-- ============================================================
-- 1. Confirm the new table exists with expected columns:
--      \d marketplace_integrations
--
-- 2. Confirm the old global unique is gone and the new compound index exists:
--      SELECT indexname, indexdef FROM pg_indexes
--      WHERE tablename = 'marketplace_bookings'
--        AND indexdef ILIKE '%marketplace_booking_id%';
--    Expected: idx_marketplace_bookings_tenant_external on
--    (tenant_id, marketplace_booking_id), and NO single-column unique on
--    marketplace_booking_id.
--
-- 3. Smoke-test cross-tenant duplication (replace placeholders with real tenant IDs):
--      INSERT INTO marketplace_bookings
--        (tenant_id, marketplace_booking_id, listing_type, asset_subtype,
--         customer_name, customer_email, requested_date, quoted_price)
--      VALUES ('<tenant-A>', 'TEST-DUP-001', 'dumpster_rental', '20yd',
--              'Test', 'test@example.com', CURRENT_DATE, 0);
--      INSERT INTO marketplace_bookings
--        (tenant_id, marketplace_booking_id, listing_type, asset_subtype,
--         customer_name, customer_email, requested_date, quoted_price)
--      VALUES ('<tenant-B>', 'TEST-DUP-001', 'dumpster_rental', '20yd',
--              'Test', 'test@example.com', CURRENT_DATE, 0);
--    Both should succeed. Then a third insert with the same tenant + ID:
--      INSERT INTO marketplace_bookings
--        (tenant_id, marketplace_booking_id, listing_type, asset_subtype,
--         customer_name, customer_email, requested_date, quoted_price)
--      VALUES ('<tenant-A>', 'TEST-DUP-001', 'dumpster_rental', '20yd',
--              'Test', 'test@example.com', CURRENT_DATE, 0);
--    -- Should FAIL with a unique violation.
--    Cleanup:
--      DELETE FROM marketplace_bookings WHERE marketplace_booking_id = 'TEST-DUP-001';
