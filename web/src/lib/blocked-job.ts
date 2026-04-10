/**
 * Shared "Blocked job" helpers — the single frontend source of truth
 * for classifying a job as Blocked and explaining WHY.
 *
 * Blocked is a computed UI + analytics layer. It is NOT a stored
 * job.status value, and nothing in these helpers writes to the
 * database. The predicate here must stay in lockstep with the backend
 * shared fragment at api/src/common/helpers/blocked-jobs-predicate.ts
 * (which in turn backs AnalyticsService.getJobsSummary().blocked and
 * JobsService.findBlocked).
 *
 * Consumers (keep this list tight — new callers mean new drift risk):
 *   - web/src/app/(dashboard)/jobs/page.tsx
 *       Jobs list top-strip, sub-filter segmentation, reason chips,
 *       and row-border priority ladder.
 *   - web/src/app/(dashboard)/jobs/[id]/page.tsx
 *       Job detail page contextual blocked panel.
 *
 * Structural job type: callers pass an object with ONLY the fields we
 * need (status, linked_invoice, open_billing_issue_count). This avoids
 * forcing every caller to carry the full enriched Job interface and
 * lets the Job detail page assemble the shape from its separately
 * fetched pieces (job + invoice state + billing issues fetch).
 */

export type BlockedReason = "billing_issue" | "unpaid_completed_invoice" | null;

/**
 * Minimal shape required to evaluate the Blocked predicate. Any
 * caller-side job representation that exposes these fields can be
 * passed directly — TypeScript structural typing handles the rest.
 */
export interface BlockedJobLike {
  status: string;
  open_billing_issue_count?: number | null;
  linked_invoice?: {
    status: string;
    balance_due: number | string;
  } | null;
}

/**
 * Terminal invoice statuses that count as "payment resolved" and
 * therefore do NOT trigger the unpaid_completed_invoice reason. Must
 * match the backend `__blocked_paidInvoiceStatuses` constant in
 * blocked-jobs-predicate.ts.
 */
const PAID_INVOICE_STATUSES: ReadonlyArray<string> = [
  "paid",
  "partial",
  "voided",
];

/**
 * Derive the blocked reason from a minimal job shape. Priority:
 * `billing_issue` wins over `unpaid_completed_invoice` when both
 * conditions match — the detector-flagged signal is stronger than
 * the fallback "completed with unpaid invoice" derivation.
 */
export function getBlockedReason(job: BlockedJobLike): BlockedReason {
  if ((job.open_billing_issue_count ?? 0) > 0) {
    return "billing_issue";
  }
  const inv = job.linked_invoice;
  if (
    job.status === "completed" &&
    inv &&
    Number(inv.balance_due) > 0 &&
    !PAID_INVOICE_STATUSES.includes(inv.status)
  ) {
    return "unpaid_completed_invoice";
  }
  return null;
}

/**
 * Predicate form. Delegates to `getBlockedReason` so the boolean and
 * the reason can never drift.
 */
export function isJobBlocked(job: BlockedJobLike): boolean {
  return getBlockedReason(job) !== null;
}
