/**
 * Phase 6 — Billing audit DTOs.
 *
 * Read-only audit report and bulk-cleanup preview/execute payloads.
 * No request DTOs at the controller level use class-validator here
 * because the bulk-cleanup scope is a small enum picked from query
 * parameters; the controller validates with a manual switch.
 */

import { LEGACY_CUTOFF_DATE } from '../helpers/billing-issue-cleanup-rules';

/* ─── Audit report ─── */

export interface BillingAuditReport {
  tenant_id: string;
  generated_at: string;
  legacy_cutoff: typeof LEGACY_CUTOFF_DATE;

  totals: {
    all: number;
    open: number;
    auto_resolved: number;
    manually_resolved: number;
    dismissed: number;
  };

  by_type: Record<string, number>;

  by_age: {
    /** < 7 days old */
    lt_7d: number;
    /** 7–29 days old */
    lt_30d: number;
    /** 30–89 days old */
    lt_90d: number;
    /** ≥ 90 days old */
    gte_90d: number;
  };

  by_invoice_state: {
    /** open invoice with positive balance */
    unpaid: number;
    paid: number;
    partial: number;
    voided: number;
    /** invoice exists with balance_due ≤ 0 (regardless of status) */
    zero_balance: number;
    /** issue.invoice_id is NULL or points to a non-existent invoice */
    no_invoice: number;
  };

  by_era: {
    /** linked job created strictly before LEGACY_CUTOFF_DATE */
    legacy: number;
    /** linked job created on or after LEGACY_CUTOFF_DATE */
    post_correction: number;
    /** issue has no linked job */
    unknown: number;
  };

  /**
   * Headline numbers operators care about. Each insight is a count
   * of OPEN issues only — already-resolved issues don't count.
   */
  insights: {
    /** Open issues that match a deterministic stale rule but were never cleared. */
    should_have_auto_resolved: number;
    /** Distinct (job_id, issue_type) combinations with > 1 open issue. */
    duplicates_on_same_job: number;
    /** completed_unpaid issues where the linked invoice is now paid/partial/voided. */
    completed_unpaid_on_paid_invoice: number;
    /** Any open issue tied to an invoice that is paid or zero-balance. */
    paid_invoice_with_open_issues: number;
    /** Open issues whose linked job_id no longer exists in the jobs table. */
    dangling_job_reference: number;
    /** Open issues with no linked invoice for issue types that expect one. */
    missing_invoice_link: number;
  };

  classification_summary: {
    valid: number;
    stale_candidate: number;
    needs_review: number;
  };
}

/* ─── Bulk cleanup ─── */

/**
 * Discriminated union of bulk cleanup scopes. Each scope corresponds
 * to a deterministic SQL filter — the operator picks one, the
 * service shows a preview, and only after explicit confirmation does
 * the service execute the matching UPDATE.
 *
 * Adding a new scope here REQUIRES adding a corresponding `case` in
 * `BillingAuditService.buildBulkCleanupPredicate`. The TypeScript
 * exhaustiveness check enforces this at compile time.
 */
export type BulkCleanupScopeKind =
  | 'paid_invoice_payment_issues'
  | 'zero_balance_payment_issues'
  | 'completed_unpaid_now_paid'
  | 'missing_dump_slip_non_dump'
  | 'legacy_stale_only';

export interface BulkCleanupScope {
  kind: BulkCleanupScopeKind;
  /**
   * Optional override for the legacy cutoff date. Only applies when
   * `kind === 'legacy_stale_only'`. Defaults to LEGACY_CUTOFF_DATE.
   * Format: 'YYYY-MM-DD'. Must parse as a valid ISO date.
   */
  legacy_cutoff?: string;
}

export interface BulkCleanupPreview {
  scope: BulkCleanupScope;
  matched_count: number;
  /** Up to 25 sample issue IDs so the operator can inspect before executing. */
  sample_ids: string[];
  /** Human-readable explanation of the rule the scope encodes. */
  rule_description: string;
}

export interface BulkCleanupResult {
  scope: BulkCleanupScope;
  /** How many billing_issues rows were UPDATEd to auto_resolved. */
  resolved_count: number;
  /** ISO timestamp when the cleanup ran. */
  executed_at: string;
  /** UUID of the user who triggered the cleanup. */
  executed_by: string;
}
