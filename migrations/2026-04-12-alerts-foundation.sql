-- Phase 14 — Alerts / Exceptions System (System of Attention)
--
-- Creates the `alerts` table that powers the new /alerts page and
-- sidebar badge. This is a READ/DERIVE layer only — no lifecycle,
-- pricing, billing, or dispatch logic is modified by this migration.
--
-- Shape & conventions
--   - TEXT + CHECK constraints for every enum-like column (no ENUM
--     types, matching the rest of the codebase).
--   - tenant_id stays a plain UUID column (no FK), matching the
--     convention used by billing_issues, credit_collection_events,
--     and credit_audit_events. Tenant isolation is enforced at the
--     app layer via TenantGuard + `where: { tenant_id }`.
--   - Alerts are derived by AlertDetectorService on request; this
--     migration seeds no rows and there is no backfill pass.
--
-- Idempotency model
--   AlertDetectorService must never produce duplicate active alerts
--   for the same (tenant, alert_type, entity_type, entity_id). We
--   enforce this at the database level with a UNIQUE PARTIAL INDEX
--   scoped to `status = 'active'`. Resolved/dismissed rows are
--   excluded, so the same key can cleanly re-open after the
--   condition recurs.
--
-- Auto-resolve rule
--   When a condition no longer evaluates to true, the detector
--   transitions the stored active alert to 'resolved' (with
--   resolved_at timestamp). The history row stays for audit.

-- ──────────────────────────────────────────────────────────────
-- Group 1: Table (additive)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,

  alert_type TEXT NOT NULL CHECK (
    alert_type IN (
      'overdue_rental',
      'missing_dump_slip',
      'missing_asset',
      'abnormal_disposal',
      'low_margin_chain',
      'lifecycle_integrity',
      'date_rule_conflict'
    )
  ),

  severity TEXT NOT NULL CHECK (
    severity IN ('high', 'medium', 'low')
  ),

  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('job', 'rental_chain', 'asset', 'invoice', 'customer')
  ),
  entity_id UUID NOT NULL,

  -- `message` is a registry-driven feature key (e.g. 'alerts_overdue_rental').
  -- The web layer resolves this to a human label via getFeatureLabel(),
  -- so changing copy does not require a migration.
  message TEXT NOT NULL,

  -- Per-alert context — detector-populated, varies by alert_type.
  -- Never put sensitive financial data beyond aggregate summaries
  -- (spec: Security section).
  metadata JSONB NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'resolved', 'dismissed')
  ),

  resolved_by UUID NULL,
  resolved_at TIMESTAMPTZ NULL,
  dismissed_by UUID NULL,
  dismissed_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- Group 2: Backfill — NONE
-- ──────────────────────────────────────────────────────────────
-- Alerts are derived fresh by AlertDetectorService. On first load
-- after deploy, the first /alerts request will populate all active
-- rows for the calling tenant (cooldown-gated thereafter).

-- ──────────────────────────────────────────────────────────────
-- Group 3: Indexes & idempotency constraint
-- ──────────────────────────────────────────────────────────────

-- Primary list query: "active alerts for my tenant, grouped by
-- severity". Covers both the sidebar badge count and the default
-- /alerts page view.
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_status
  ON alerts (tenant_id, status);

-- Filter-by-type queries on the /alerts page.
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_type
  ON alerts (tenant_id, alert_type);

-- Deep-link lookups from entity pages ("show me alerts for this job").
CREATE INDEX IF NOT EXISTS idx_alerts_entity
  ON alerts (entity_type, entity_id);

-- Idempotency: at most ONE active alert per (tenant, type, entity).
-- Resolved/dismissed rows are excluded from the unique constraint so
-- the same key can re-open after the condition recurs. This is what
-- lets the detector safely do INSERT ... ON CONFLICT DO NOTHING
-- during the reconciliation pass.
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerts_active_tenant_type_entity
  ON alerts (tenant_id, alert_type, entity_type, entity_id)
  WHERE status = 'active';
