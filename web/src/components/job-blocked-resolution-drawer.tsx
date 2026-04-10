"use client";

/**
 * Job Blocked Resolution Drawer (Phase 4)
 * ---------------------------------------
 * Job-scoped resolution surface that consolidates billing blockers for
 * a single job and offers the shortest correct next action without
 * forcing the operator to bounce between Job → Billing Issues → Invoice
 * → back to Job. Stays open inside a SlideOver on the Job detail page.
 *
 * Design rules (Phase 4 spec):
 *   - REUSE the existing payment endpoint (POST /invoices/:id/payments)
 *     via the shared `RecordPaymentForm`. No parallel payment system.
 *   - REUSE the existing tenant-scoped /billing-issues?jobId=… endpoint
 *     to fetch the actionable issue list for the job.
 *   - REUSE the existing Billing Issues resolve workflow as a fallback
 *     for non-payment issue types — never re-implement issue resolution
 *     here, only act as a launcher.
 *   - All user-facing labels resolve through FEATURE_REGISTRY.
 *   - Multi-tenant safety is enforced by the underlying endpoints; this
 *     drawer adds no new data access patterns.
 *
 * Root-cause consolidation:
 *   - When the linked invoice has a positive balance, this drawer
 *     classifies any open `past_due_payment` and `completed_unpaid`
 *     issues for the same job as "will clear after payment". The
 *     backend `BillingIssueDetectorService.resolveStaleIssues` already
 *     auto-clears those exact issue types (Pass 1 + Pass 4) when the
 *     invoice flips to paid/partial/voided or balance reaches zero —
 *     so the operator should NOT have to resolve them one by one.
 *   - After payment success, the drawer optimistically removes the
 *     payment-clearing issues from its local view for instant feedback,
 *     then re-fetches issues + invoice via the parent's `onRefetch`.
 *     A `/billing-issues/summary` ping triggers the backend's stale
 *     cleanup pass (subject to the existing 60s cooldown) so the
 *     authoritative state catches up shortly.
 *
 * State machine:
 *   1. one payment-related actionable blocker  → payment form, no other-issues section
 *   2. multiple related blockers tied to unpaid invoice
 *                                              → payment form + "will clear" badges
 *   3. one non-payment billing issue           → no payment form, fallback CTA
 *   4. multiple mixed billing issues           → payment form + grouped "needs attention"
 *   5. fetch failure / unavailable data        → fallback CTA, never blank
 *   6. post-success refresh                    → optimistic clear, refetch, recompute
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { RecordPaymentForm } from "@/components/record-payment-form";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { formatCurrency } from "@/lib/utils";

const fmt = (n: number | null | undefined) => formatCurrency(n as number);

/** Issue types that auto-resolve once the linked invoice is paid. */
const PAYMENT_CLEARING_ISSUE_TYPES: ReadonlyArray<string> = [
  "past_due_payment",
  "completed_unpaid",
];

interface DrawerBillingIssue {
  id: string;
  issue_type: string;
  description: string;
  status: string;
  calculated_amount: number | null;
  created_at: string;
}

interface DrawerInvoice {
  id: string;
  invoice_number: number;
  status: string;
  balance_due: number;
}

export interface JobBlockedResolutionDrawerProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  /**
   * Linked invoice for the job. Pass `null` when there is no invoice
   * (the drawer will fall back to issue-only mode). The drawer reads
   * `balance_due` and `status` to decide whether the payment-first
   * path applies.
   */
  invoice: DrawerInvoice | null;
  /**
   * Called after the drawer mutates state (currently: after payment is
   * recorded). The Job detail page should refetch its job, invoice,
   * and open-billing-issue-count so the contextual blocked panel
   * updates immediately.
   */
  onRefetch: () => void;
}

export function JobBlockedResolutionDrawer({
  open,
  onClose,
  jobId,
  invoice,
  onRefetch,
}: JobBlockedResolutionDrawerProps) {
  const [issues, setIssues] = useState<DrawerBillingIssue[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentJustRecorded, setPaymentJustRecorded] = useState(false);
  // After a successful payment we optimistically hide the
  // payment-clearing issues from local state for instant feedback.
  // The backend auto-resolution catches up via the next stale cleanup
  // pass; the parent refetch will reconcile authoritative state.
  const [optimisticallyClearedIds, setOptimisticallyClearedIds] = useState<Set<string>>(new Set());

  /** Fetch open issues for THIS job using the existing tenant-scoped endpoint. */
  const loadIssues = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<{ data: DrawerBillingIssue[]; meta: { total: number } }>(
        `/billing-issues?jobId=${jobId}&status=open&limit=25`,
      );
      setIssues(res.data ?? []);
    } catch {
      setLoadError(true);
      setIssues(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open) {
      setPaymentJustRecorded(false);
      setOptimisticallyClearedIds(new Set());
      loadIssues();
    }
  }, [open, loadIssues]);

  /** True when this job has an unpaid invoice with a positive balance. */
  const hasUnpaidBalance =
    !!invoice &&
    Number(invoice.balance_due) > 0 &&
    !["paid", "partial", "voided"].includes(invoice.status);

  /**
   * Bucket the visible issues into "will clear after payment" vs
   * "needs separate attention" so the drawer can render them as
   * distinct groups. Optimistically-cleared IDs are filtered out so
   * the drawer reflects the post-payment state immediately.
   */
  const { paymentClearing, otherIssues } = useMemo(() => {
    const visible = (issues ?? []).filter((i) => !optimisticallyClearedIds.has(i.id));
    const paymentClearing: DrawerBillingIssue[] = [];
    const otherIssues: DrawerBillingIssue[] = [];
    for (const i of visible) {
      if (
        hasUnpaidBalance &&
        PAYMENT_CLEARING_ISSUE_TYPES.includes(i.issue_type)
      ) {
        paymentClearing.push(i);
      } else {
        otherIssues.push(i);
      }
    }
    return { paymentClearing, otherIssues };
  }, [issues, optimisticallyClearedIds, hasUnpaidBalance]);

  /**
   * Should the inline payment-first path render?
   * Yes when there is an unpaid balance — even if there are zero
   * payment-clearing issues, the unpaid_completed_invoice computed
   * reason on the parent panel implies the operator wants to record
   * payment from here.
   */
  const showPaymentForm = hasUnpaidBalance;

  const handlePaymentSuccess = useCallback(async () => {
    setPaymentJustRecorded(true);
    // Optimistically hide the payment-clearing issues for instant
    // feedback. The backend auto-resolution clears them on the next
    // stale-cleanup pass; the parent refetch reconciles.
    setOptimisticallyClearedIds(
      new Set(paymentClearing.map((i) => i.id)),
    );
    // Trigger backend stale-cleanup (subject to the existing 60s
    // cooldown). Even if the cooldown blocks it on this exact call,
    // the optimistic clear above keeps the UI honest until the next
    // page visit.
    api.get("/billing-issues/summary").catch(() => {});
    // Refresh own data and parent state.
    await loadIssues();
    onRefetch();
  }, [paymentClearing, loadIssues, onRefetch]);

  const drawerTitle =
    FEATURE_REGISTRY.job_blocked_resolution_drawer?.label ?? "Resolve Blockers";
  const paymentSectionTitle =
    FEATURE_REGISTRY.job_blocked_resolution_payment_first?.label ?? "Record Payment";
  const otherIssuesTitle =
    FEATURE_REGISTRY.job_blocked_resolution_other_issues?.label ?? "Other open issues";
  const fallbackCtaLabel =
    FEATURE_REGISTRY.job_blocked_resolution_open_in_billing_issues?.label ??
    "Open in Billing Issues";

  // Anything left after optimistic clears + payment-clearing bucket?
  const visibleIssueCount = paymentClearing.length + otherIssues.length;
  const allBlockersCleared =
    paymentJustRecorded && visibleIssueCount === 0 && !showPaymentForm;

  return (
    <SlideOver open={open} onClose={onClose} title={drawerTitle}>
      <div className="space-y-5">
        {/* Loading state */}
        {loading && issues === null && (
          <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>
            Loading blockers…
          </p>
        )}

        {/* Failure state — never leave the operator with a blank drawer */}
        {loadError && (
          <div
            className="rounded-[16px] border-l-4 px-4 py-3"
            style={{
              backgroundColor: "var(--t-error-soft)",
              borderColor: "var(--t-error)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              Couldn’t load blocker details
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--t-text-secondary)" }}>
              Open the Billing Issues page to investigate this job directly.
            </p>
            <Link
              href={`/billing-issues?jobId=${jobId}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
            >
              <ExternalLink className="h-3 w-3" /> {fallbackCtaLabel}
            </Link>
          </div>
        )}

        {/* All-clear state after a successful payment */}
        {allBlockersCleared && (
          <div
            className="rounded-[16px] border-l-4 px-4 py-3"
            style={{
              backgroundColor: "var(--t-accent-soft)",
              borderColor: "var(--t-accent)",
            }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                All blockers cleared
              </p>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--t-text-secondary)" }}>
              You can close this drawer.
            </p>
          </div>
        )}

        {/* Payment-first section — only when there's an unpaid balance */}
        {showPaymentForm && invoice && (
          <section className="space-y-3">
            <header className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--t-error)" }} />
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                  {paymentSectionTitle}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--t-text-secondary)" }}>
                  Invoice #{invoice.invoice_number} — {fmt(invoice.balance_due)} due
                </p>
                {paymentClearing.length > 0 && (
                  <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>
                    Recording payment will clear {paymentClearing.length} related blocker
                    {paymentClearing.length !== 1 ? "s" : ""} automatically.
                  </p>
                )}
                {paymentClearing.length === 0 && hasUnpaidBalance && (
                  <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>
                    The job is blocked because the invoice still has a balance due.
                  </p>
                )}
              </div>
            </header>

            {/* Payment-clearing issues — list with "Will clear" badges */}
            {paymentClearing.length > 0 && (
              <ul className="space-y-1.5">
                {paymentClearing.map((issue) => (
                  <li
                    key={issue.id}
                    className="rounded-[12px] border px-3 py-2"
                    style={{
                      borderColor: "var(--t-border)",
                      backgroundColor: "var(--t-bg-card)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold capitalize" style={{ color: "var(--t-text-primary)" }}>
                          {issue.issue_type.replace(/_/g, " ")}
                        </p>
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                          {issue.description}
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: "var(--t-warning-soft)",
                          color: "var(--t-warning)",
                        }}
                      >
                        Will clear after payment
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <RecordPaymentForm
              invoiceId={invoice.id}
              balanceDue={Number(invoice.balance_due)}
              onSuccess={handlePaymentSuccess}
            />
          </section>
        )}

        {/* Other-issues section — anything that needs separate attention */}
        {otherIssues.length > 0 && !loadError && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {otherIssuesTitle}
            </h3>
            <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
              These issues need separate attention. Open them in the Billing Issues
              workspace for the full guided resolution flow.
            </p>
            <ul className="space-y-1.5">
              {otherIssues.map((issue) => (
                <li
                  key={issue.id}
                  className="rounded-[12px] border px-3 py-2"
                  style={{
                    borderColor: "var(--t-border)",
                    backgroundColor: "var(--t-bg-card)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold capitalize" style={{ color: "var(--t-text-primary)" }}>
                        {issue.issue_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                        {issue.description}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              href={`/billing-issues?jobId=${jobId}`}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--t-text-primary)",
                color: "var(--t-bg-page, #fff)",
              }}
            >
              <FileText className="h-3 w-3" /> {fallbackCtaLabel}
            </Link>
          </section>
        )}

        {/* Empty case — no payment form, no issues, no failure → unusual but handle gracefully */}
        {!loading && !loadError && !showPaymentForm && otherIssues.length === 0 && !allBlockersCleared && (
          <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>
            No actionable blockers found for this job. If you expected to see something here,
            try the Billing Issues page directly.
          </p>
        )}
      </div>
    </SlideOver>
  );
}
