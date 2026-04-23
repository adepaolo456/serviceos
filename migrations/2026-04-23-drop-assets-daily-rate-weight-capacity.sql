-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 3 of 3 — Asset numbering standardization + field removal
-- DO NOT APPLY IN THIS PR — APPLY MANUALLY IN SUPABASE SQL EDITOR
-- APPLY ONLY AFTER 24H PROD SOAK ON THE NEW CODE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Drops `assets.daily_rate` and `assets.weight_capacity`. These columns
-- duplicated pricing-engine state and drifted in prod (every existing
-- asset disagrees with the canonical value resolved from `pricing_rules`).
-- Canonical pricing now lives exclusively in `pricing_rules`
-- (included_tons, extra_day_rate, daily_overage_rate).
--
-- Pre-apply safety gates:
--   1. Code review confirms nothing in api/, web/, driver-app/ reads
--      `assets.daily_rate` or `assets.weight_capacity`. Any `dailyRate`
--      variable in billing/invoice/pricing code reads from
--      `pricingData.daily_overage_rate` via pricing_rules, not the asset
--      column. Confirmed by grep at audit time.
--   2. 24h prod soak on the pre-Migration-3 build with zero log hits on
--      these column names. The soak window is the only safety net —
--      once dropped, data is gone.
--
-- Run ORDER:
--   1. Migration 1 (unique index) — applied before API deploy
--   2. Deploy API + web (combined Item 1 + Item 3)
--   3. Migration 2 (renumber + pin fix)
--   4. 24h prod soak ← important
--   5. This migration                                         ← YOU ARE HERE

-- ── Informational: how many rows still carry values on the deprecated cols
-- Run before applying to know what you're dropping. Expect non-zero; that
-- is fine — the whole point is these values are stale and duplicative.
SELECT
  COUNT(*) FILTER (WHERE daily_rate IS NOT NULL)      AS rows_with_daily_rate,
  COUNT(*) FILTER (WHERE weight_capacity IS NOT NULL) AS rows_with_weight_capacity
FROM assets;

-- ── Confirm the columns still exist before attempting the drop ──────────────
-- Expect 2 rows.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'assets'
  AND column_name IN ('daily_rate', 'weight_capacity');

-- ── APPLY ──────────────────────────────────────────────────────────────────
-- IF EXISTS makes this idempotent — rerun-safe.
ALTER TABLE assets DROP COLUMN IF EXISTS daily_rate;
ALTER TABLE assets DROP COLUMN IF EXISTS weight_capacity;

-- ── Post-apply verification ─────────────────────────────────────────────────
-- Expect 0 rows.
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'assets'
--   AND column_name IN ('daily_rate', 'weight_capacity');

-- ── Rollback (structural only — data is irrecoverable) ──────────────────────
-- ALTER TABLE assets ADD COLUMN daily_rate      numeric(10, 2);
-- ALTER TABLE assets ADD COLUMN weight_capacity numeric(10, 2);
