-- ─────────────────────────────────────────────────────────────────────────────
-- Item 4 — Add retire metadata to assets
-- DO NOT APPLY IN THIS PR — APPLY MANUALLY IN SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds the 4 retire-metadata columns, a partial index that accelerates the
-- 99% "active inventory" query path, and a CHECK constraint on retired_reason
-- so the allowed value set lives at both the app and DB layer.
--
-- Fully additive + reversible. No 24h soak needed — any existing row simply
-- reads NULL on the new columns until the app explicitly retires it.
--
-- Run ORDER: apply any time before (or immediately after) the API deploy
-- that introduces the retire endpoint. Deploying the API before this
-- migration is applied will return 500 on POST /assets/:id/retire when
-- the save hits missing columns — so apply this first.
--
-- Take a DB snapshot before applying? Not strictly necessary — rollback
-- below restores the schema exactly.

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS retired_at     timestamp with time zone,
  ADD COLUMN IF NOT EXISTS retired_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retired_reason varchar(20),
  ADD COLUMN IF NOT EXISTS retired_notes  text;

-- ── Partial index ──────────────────────────────────────────────────────────
-- Indexes only non-retired rows. Accelerates the default "active inventory"
-- path — AssetsService.findAll (excludes retired unless includeRetired=true),
-- findAvailable, getAwaitingDump, and the availability projection all hit
-- this index. Retired rows are the exception; indexing them would inflate
-- the index for the 99% use case.
--
-- IS DISTINCT FROM is null-safe — if status were ever NULL, the row is
-- indexed (the `= 'retired'` comparison would yield UNKNOWN, but the
-- DISTINCT FROM form treats NULL as not-equal-to-retired and indexes it).
CREATE INDEX IF NOT EXISTS idx_assets_tenant_active
  ON assets (tenant_id, asset_type, subtype)
  WHERE status IS DISTINCT FROM 'retired';

-- ── CHECK constraint ────────────────────────────────────────────────────────
-- DB-layer defense matching RetireAssetDto's @IsIn validator. A raw INSERT
-- or UPDATE that bypasses the DTO (seed scripts, manual SQL) still gets
-- enforced. NULL is allowed so non-retired rows are unaffected.
--
-- IF NOT EXISTS is not valid on ADD CONSTRAINT, so this block is wrapped
-- in a conditional DO $$ to keep the migration rerunnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_retired_reason_check'
      AND conrelid = 'assets'::regclass
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_retired_reason_check
      CHECK (retired_reason IS NULL
             OR retired_reason IN ('sold', 'damaged', 'scrapped', 'other'));
  END IF;
END $$;

-- ── Rollback ───────────────────────────────────────────────────────────────
-- Drop in reverse dependency order. retired_by FK drops implicitly with
-- its column.
-- ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_retired_reason_check;
-- DROP INDEX IF EXISTS idx_assets_tenant_active;
-- ALTER TABLE assets DROP COLUMN IF EXISTS retired_notes;
-- ALTER TABLE assets DROP COLUMN IF EXISTS retired_reason;
-- ALTER TABLE assets DROP COLUMN IF EXISTS retired_by;
-- ALTER TABLE assets DROP COLUMN IF EXISTS retired_at;
