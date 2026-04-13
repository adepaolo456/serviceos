-- ──────────────────────────────────────────────────────────────
-- Pre-launch cleanup: remove `date_rule_conflict` alert_type
-- ──────────────────────────────────────────────────────────────
-- Follow-up to 2026-04-12-alerts-foundation.sql.
--
-- Why:
-- `date_rule_conflict` was scaffolded end-to-end (CHECK constraint,
-- DTO union, detector method stub, /alerts page icon + filter, help
-- guide, feature registry entry, LifecycleContextPanel icon map) but
-- the detector was intentionally left returning `[]` because the
-- override-tracking field it depends on was never added to
-- `rental_chains`. The Issues Consolidation Audit flagged this as
-- "looks live but ships nothing" — the kind of dead wiring that
-- hides a real future feature gap behind a UI that appears shipped.
--
-- This migration removes the alert_type from the CHECK constraint
-- so the column no longer accepts the value. The application layer
-- (DTO union, detector wiring, web UI type/icon/message/registry)
-- was cleaned up in the same pre-launch pass — see commit log.
--
-- Safety:
-- 1. The detector stub always returned `[]`, so no rows should ever
--    have been inserted with this alert_type. The pre-drop DELETE
--    below is idempotent and touches zero rows in the normal case.
--    It's included only as a defensive cleanup in case a test fixture
--    or manual INSERT leaked a row.
-- 2. CHECK constraints are table-wide — dropping and re-adding is
--    atomic within the transaction and blocks concurrent writes
--    briefly. The alerts table is small (tenant-scoped, cooldown-
--    gated detector) so the lock window is negligible.
-- 3. The re-added constraint uses the same inline-anonymous style
--    as the original migration, so Postgres assigns it the same
--    default name `alerts_alert_type_check`. Idempotent re-runs are
--    safe via `DROP CONSTRAINT IF EXISTS`.
-- ──────────────────────────────────────────────────────────────

BEGIN;

-- Defensive cleanup: remove any stale rows. The detector stub never
-- inserted this alert_type, so this should be a 0-row UPDATE in prod.
DELETE FROM alerts WHERE alert_type = 'date_rule_conflict';

-- Drop the existing CHECK constraint on alert_type. The original
-- migration declared it inline (anonymous), so Postgres named it
-- `alerts_alert_type_check` by convention.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

-- Re-add the CHECK constraint without `date_rule_conflict`. All
-- other values are preserved byte-for-byte from the foundation
-- migration so this is strictly a narrowing change.
ALTER TABLE alerts ADD CONSTRAINT alerts_alert_type_check CHECK (
  alert_type IN (
    'overdue_rental',
    'missing_dump_slip',
    'missing_asset',
    'abnormal_disposal',
    'low_margin_chain',
    'lifecycle_integrity'
  )
);

COMMIT;
