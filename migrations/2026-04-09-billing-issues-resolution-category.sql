-- Phase 6 — billing-issues structured resolution category
--
-- Adds a constrained `resolution_category` column to billing_issues so
-- every cleared/resolved/dismissed issue carries a high-level audit tag
-- alongside the existing free-text `resolution_reason` column. The
-- existing `resolution_reason` column stays as-is and continues to
-- hold pass-specific detail strings like 'auto_cleared_balance_paid'
-- for forensic detail.
--
-- Allowed values:
--   'paid'                — issue cleared because the linked invoice
--                            was paid (subset of stale_auto_resolved
--                            but called out separately for the most
--                            common case)
--   'operator_resolved'   — a user explicitly resolved or dismissed
--                            the issue from the Billing Issues page
--                            or the Job Blocked Resolution Drawer
--   'legacy_cleanup'      — Phase 6 audited bulk-cleanup action
--                            against legacy/stale data; always paired
--                            with `resolved_by` and a timestamp
--   'stale_auto_resolved' — BillingIssueDetectorService
--                            .resolveStaleIssues background pass
--                            cleared the issue (Pass 1–5)
--
-- Nullable + additive only:
--   - Existing rows keep NULL category until the next mutation.
--   - The CHECK constraint allows NULL so the migration is non-
--     destructive on production data with mixed history.
--   - Going forward, every cleanup/resolve/dismiss path stamps a
--     non-NULL category so the audit report can classify reliably.
--
-- Indexed because the audit report and the bulk cleanup preview both
-- filter on (tenant_id, status, resolution_category) at the same
-- time. The composite index supports both query shapes.

ALTER TABLE billing_issues
  ADD COLUMN IF NOT EXISTS resolution_category TEXT NULL
  CHECK (
    resolution_category IS NULL
    OR resolution_category IN (
      'paid',
      'operator_resolved',
      'legacy_cleanup',
      'stale_auto_resolved'
    )
  );

CREATE INDEX IF NOT EXISTS idx_billing_issues_tenant_status_category
  ON billing_issues (tenant_id, status, resolution_category);
