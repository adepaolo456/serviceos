-- Phase 1 — Credit-control foundation (schema only)
--
-- This migration is purely additive. No backfill. No destructive
-- changes. Existing rows keep NULL for the new optional columns and
-- FALSE for the boolean. Current runtime behavior is unchanged in
-- Phase 1 — these columns are stored but no application code reads
-- them yet. Later phases will introduce policy enforcement, AR
-- aging, customer detail UI, etc.
--
-- DEPLOY ORDERING:
--   1. Run this SQL in the Supabase SQL editor first.
--   2. Then deploy the API. The new columns must exist before the
--      updated entity loads.
--   3. Web side has no changes in Phase 1.
--
-- Tenant safety:
--   Every new column lives on the existing `customers` table which
--   is already tenant-scoped via `customers.tenant_id`. The hold
--   audit fields (set_by / released_by) reference user UUIDs but
--   are intentionally not declared as FOREIGN KEY constraints, to
--   match the existing project pattern (see
--   billing_issues.resolved_by, jobs.assigned_driver_id, etc.).
--
-- Tenant-level credit policy:
--   Stored in the existing `tenants.settings` JSONB column under
--   the `credit_policy` key. No tenants table change is required
--   in this migration. The TypeScript helper at
--   api/src/modules/tenants/credit-policy.ts documents the
--   shape and provides a read-only accessor for future phases.

-- Customer-level fields ──────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS payment_terms TEXT NULL
  CHECK (
    payment_terms IS NULL
    OR payment_terms IN (
      'due_on_receipt',
      'cod',
      'net_7',
      'net_15',
      'net_30',
      'net_60',
      'custom'
    )
  );

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12, 2) NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold BOOLEAN NOT NULL DEFAULT FALSE;

-- Hold audit metadata. All nullable so a customer that has never been
-- on hold has clean NULLs. When credit_hold flips TRUE, the application
-- code must populate set_by + set_at + reason in the same write. When
-- the hold is released, the application code must flip credit_hold
-- back to FALSE and populate released_by + released_at while leaving
-- set_by/set_at/reason intact for forensic history.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_reason TEXT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_set_by UUID NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_set_at TIMESTAMPTZ NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_released_by UUID NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_hold_released_at TIMESTAMPTZ NULL;

-- Partial index — accelerates "list customers currently on hold"
-- queries that future phases (AR aging dashboard, credit-control
-- panel) will need. Partial WHERE clause keeps the index small
-- since the vast majority of customers are NOT on hold.

CREATE INDEX IF NOT EXISTS idx_customers_tenant_credit_hold
  ON customers (tenant_id, credit_hold)
  WHERE credit_hold = TRUE;
