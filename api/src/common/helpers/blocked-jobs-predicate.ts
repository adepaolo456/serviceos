/**
 * Shared SQL predicate for the "Blocked" computed state.
 *
 * This is the SINGLE source of truth for the Blocked predicate on the
 * backend. Every server-side place that needs to answer "is this job
 * blocked?" must go through this fragment so the count and the list
 * cannot drift.
 *
 * Current consumers:
 *   - AnalyticsService.getJobsSummary  → blocked COUNT
 *   - JobsService.findBlocked          → blocked LIST (for Phase 2
 *                                        /analytics/jobs-blocked)
 *
 * Frontend mirror:
 *   - getBlockedReason() in
 *     web/src/app/(dashboard)/jobs/page.tsx applies the identical
 *     predicate per-row against enriched job rows. Keep all three in
 *     lockstep when editing the semantics.
 *
 * Semantics — a job is Blocked when EITHER:
 *   (a) it has ≥1 `billing_issues` row with `status = 'open'`, OR
 *   (b) `job.status = 'completed'` AND its linked invoice has
 *       `balance_due > 0` AND the invoice status is NOT IN
 *       ('paid','partial','voided').
 *
 * Implementation notes:
 *   - Uses correlated `EXISTS` subqueries (not LEFT JOINs) so parent
 *     rows are never duplicated regardless of how many billing_issues
 *     or invoices a job has. Callers do NOT need `DISTINCT`, and TypeORM
 *     entity hydration works cleanly with `.leftJoinAndSelect` on
 *     customer/asset/driver relations.
 *   - Every subquery includes `<alias>.tenant_id = j.tenant_id` as
 *     belt-and-suspenders against any row with a stale cross-tenant
 *     FK. The outer query must also apply its own
 *     `j.tenant_id = :tenantId` predicate — this fragment assumes it.
 *   - Parameter names are prefixed `__blocked_` to avoid collisions
 *     with caller-provided parameters (tenantId, dateFrom, etc.).
 *   - The jobs table MUST be aliased `j` by the caller.
 */
export const BLOCKED_JOBS_WHERE_CLAUSE = `(
  EXISTS (
    SELECT 1
    FROM billing_issues bi
    WHERE bi.job_id = j.id
      AND bi.tenant_id = j.tenant_id
      AND bi.status = :__blocked_openIssueStatus
  )
  OR (
    j.status = :__blocked_completedJobStatus
    AND EXISTS (
      SELECT 1
      FROM invoices inv
      WHERE inv.job_id = j.id
        AND inv.tenant_id = j.tenant_id
        AND inv.balance_due > 0
        AND inv.status NOT IN (:...__blocked_paidInvoiceStatuses)
    )
  )
)`;

export const BLOCKED_JOBS_WHERE_PARAMS = {
  __blocked_openIssueStatus: 'open',
  __blocked_completedJobStatus: 'completed',
  __blocked_paidInvoiceStatuses: ['paid', 'partial', 'voided'],
} as const;
