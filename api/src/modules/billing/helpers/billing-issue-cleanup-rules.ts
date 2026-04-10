/**
 * Phase 6 — shared classification + cleanup rule constants for the
 * billing-issues audit pipeline.
 *
 * Single source of truth for:
 *   - The four high-level `resolution_category` enum values
 *   - The legacy/post-correction cutoff date
 *   - Issue-type buckets (payment-related, dump-related, etc.)
 *   - Terminal invoice statuses that imply payment is no longer
 *     a lever (mirrors backend resolveStaleIssues semantics)
 *
 * Imported by:
 *   - BillingIssueDetectorService (to stamp resolution_category on
 *     existing auto-resolution passes and on manual operator paths)
 *   - BillingAuditService (to classify and bulk-clean stale rows)
 */

/* ─── resolution_category enum ─── */

/**
 * Allowed values for `billing_issues.resolution_category`. Mirrors
 * the database CHECK constraint declared in
 * migrations/2026-04-09-billing-issues-resolution-category.sql.
 *
 * Adding a new value here REQUIRES a corresponding migration that
 * updates the CHECK constraint. Adding new categories without the
 * migration will cause INSERT/UPDATE failures.
 */
export const RESOLUTION_CATEGORIES = [
  'paid',
  'operator_resolved',
  'legacy_cleanup',
  'stale_auto_resolved',
] as const;

export type ResolutionCategory = (typeof RESOLUTION_CATEGORIES)[number];

/* ─── Legacy cutoff ─── */

/**
 * Boundary date for distinguishing legacy-era jobs/issues from
 * post-correction jobs/issues. Jobs created BEFORE this date are
 * "legacy" — most blockers from this era are likely artifacts of
 * the older billing flow. Jobs created ON OR AFTER this date are
 * "post-correction" — current-system blockers that should be taken
 * seriously.
 *
 * Used by:
 *   - BillingAuditService.getAuditReport `by_era` bucket
 *   - BillingAuditService bulk cleanup `legacy_stale_only` scope
 *
 * Format: ISO 8601 date string (no time component) so date
 * arithmetic is unambiguous in any timezone.
 */
export const LEGACY_CUTOFF_DATE = '2026-04-02';

/* ─── Issue type buckets ─── */

/**
 * Issue types that the backend `resolveStaleIssues` auto-resolution
 * passes will clear when the linked invoice is paid. Mirrors the
 * frontend `BLOCKER_TYPE_RULES` payment_rooted bucket in
 * web/src/lib/blocker-prediction.ts — keep them in lockstep.
 */
export const PAYMENT_RELATED_ISSUE_TYPES: ReadonlyArray<string> = [
  'past_due_payment',
  'completed_unpaid',
];

/**
 * Issue types that are auto-resolvable in principle BUT depend on
 * non-payment state (e.g. invoice closed, job lifecycle reverted).
 * The audit treats these conservatively — they may appear as
 * `stale_candidate` only when the specific predicate matches.
 */
export const CONDITIONALLY_AUTO_RESOLVABLE_TYPES: ReadonlyArray<string> = [
  'price_mismatch',
  'missing_dump_slip',
];

/**
 * Job types that DO require dump slip tracking. Mirrors the
 * `dumpEligible` constant inside resolveStaleIssues Pass 3 — kept
 * separate here so the audit classifier can reuse the rule without
 * importing service-internal state.
 */
export const DUMP_ELIGIBLE_JOB_TYPES: ReadonlyArray<string> = [
  'pick_up',
  'dump_and_return',
  'haul',
  'swap',
  'exchange',
];

/* ─── Invoice status buckets ─── */

/**
 * Invoice statuses that indicate the payment lever is no longer
 * available — issue types that auto-clear on paid/voided invoices
 * become stale once the invoice reaches one of these states.
 * Mirrors the `terminalStatuses` in resolveStaleIssues Pass 4 + the
 * frontend `PAID_INVOICE_STATUSES` in lib/blocker-prediction.ts.
 */
export const TERMINAL_INVOICE_STATUSES: ReadonlyArray<string> = [
  'paid',
  'partial',
  'voided',
];

/**
 * Strict subset — invoice statuses that are unambiguously "closed"
 * with no further payment expected. Used by `price_mismatch` Pass 2
 * which only clears on truly closed invoices (paid or voided), not
 * partial.
 */
export const CLOSED_INVOICE_STATUSES: ReadonlyArray<string> = [
  'paid',
  'voided',
];
