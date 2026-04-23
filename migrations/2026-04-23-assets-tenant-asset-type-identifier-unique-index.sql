-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 1 of 2 — Asset numbering standardization
-- DO NOT APPLY IN THIS PR — APPLY MANUALLY IN SUPABASE SQL EDITOR IN ORDER
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds a unique index on (tenant_id, asset_type, identifier) to enforce
-- per-tenant per-asset-type uniqueness of asset identifiers. The asset_type
-- component lets the same identifier (e.g. "10-01") coexist across
-- asset_type='dumpster' and asset_type='storage_container' in one tenant —
-- they are genuinely different assets in different type namespaces.
--
-- Run ORDER:
--   1. This migration (unique index)   ← YOU ARE HERE
--   2. Deploy API (409 translation keys off constraint name assets_tenant_asset_type_identifier_unique)
--   3. Deploy web (UI relies on 409 body shape)
--   4. Renumber migration (2026-04-23-renumber-assets-standard-format.sql)
--
-- Rerunnable: CREATE UNIQUE INDEX ... IF NOT EXISTS is idempotent.
-- No lock escalation in prod: CONCURRENTLY avoids taking AccessExclusiveLock.
-- Note: CONCURRENTLY cannot run inside a transaction block, so there is no
-- BEGIN/COMMIT wrapper here.

-- ── Precheck: refuse to add the index if duplicates exist ────────────────────
-- Current prod state (verified): zero duplicate (tenant_id, asset_type,
-- identifier) tuples. If this ever fires, investigate before proceeding —
-- something has created a duplicate that would otherwise be swallowed by
-- the migration's implicit CREATE INDEX failure.
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT tenant_id, asset_type, identifier
    FROM assets
    GROUP BY tenant_id, asset_type, identifier
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique index: % duplicate (tenant_id, asset_type, identifier) tuples exist. Resolve duplicates before re-running.',
      dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS assets_tenant_asset_type_identifier_unique
  ON assets (tenant_id, asset_type, identifier);

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP INDEX CONCURRENTLY IF EXISTS assets_tenant_asset_type_identifier_unique;
