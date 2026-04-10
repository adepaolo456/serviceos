"use client";

/**
 * Job Blocked Resolution Drawer (Phase 4 + Phase 5)
 * --------------------------------------------------
 * Job-scoped resolution surface that consolidates billing blockers for
 * a single job and offers the shortest correct next action without
 * forcing the operator to bounce between Job → Billing Issues → Invoice
 * → back to Job. Stays open inside a SlideOver on the Job detail page.
 *
 * Phase 5 additions:
 *   - Predictive blocker classification via @/lib/blocker-prediction
 *     (payment-rooted vs non-payment vs uncertain)
 *   - Pre-action summary that tells the operator what's expected to
 *     clear before they click Record Payment, with conservative
 *     messaging when the prediction is uncertain
 *   - Post-action comparison: snapshot before-IDs, refetch after, diff
 *     to surface "N cleared / M remaining"
 *   - Auto-close 1.5s after a successful payment if every blocker
 *     cleared (the operator's task is done — lingering on a success
 *     screen adds friction)
 *   - Conservative fallback when the auto-resolution backend is on
 *     cooldown ("backend catching up — refresh in a moment")
 *
 * Design rules carried forward from Phase 4:
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
 *   - The drawer is a guidance + launcher layer. It does NOT mutate
 *     billing issue rows directly. The backend's `resolveStaleIssues`
 *     auto-resolution passes are the only authoritative path that
 *     clears past_due_payment / completed_unpaid issues; this drawer
 *     just nudges them to run via the existing /billing-issues/summary
 *     endpoint after a payment is recorded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { RecordPaymentForm } from "@/components/record-payment-form";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { formatCurrency } from "@/lib/utils";
import {
  classifyBlockers,
  compareBlockerSets,
  generatePredictiveSummary,
  type BlockerComparison,
  type PredictiveSummary,
  type PredictiveSummaryKind,
} from "@/lib/blocker-prediction";

const fmt = (n: number | null | undefined) => formatCurrency(n as number);

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

/**
 * Maps a `PredictiveSummaryKind` discriminator to the registry entry
 * the drawer should render as the lead phrase. Keeps registry lookups
 * declarative and exhaustive — adding a new kind to the utility forces
 * a corresponding registry entry here.
 */
const PREDICTION_KIND_LABEL_KEYS: Record<PredictiveSummaryKind, string> = {
  all_payment_clear: "blocker_prediction_payment_will_clear",
  payment_with_remaining: "blocker_prediction_payment_with_remaining",
  payment_with_uncertain: "blocker_prediction_payment_with_uncertain",
  mixed: "blocker_prediction_mixed",
  non_payment_only: "blocker_prediction_non_payment_only",
  uncertain_only: "blocker_prediction_uncertain_only",
  no_blockers: "blocker_prediction_no_blockers",
};

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
  // payment-rooted issues from local state for instant feedback.
  // The backend auto-resolution catches up via the next stale cleanup
  // pass; the parent refetch + comparisonResult reconcile authoritative state.
  const [optimisticallyClearedIds, setOptimisticallyClearedIds] = useState<Set<string>>(new Set());
  // Phase 5 — snapshot of issue IDs at the moment the operator clicked
  // Record Payment. Used by the post-action comparison effect to
  // produce a "N cleared / M remaining" result without ever overclaiming.
  const [beforeSnapshotIds, setBeforeSnapshotIds] = useState<Set<string> | null>(null);
  const [comparisonResult, setComparisonResult] = useState<BlockerComparison | null>(null);
  // Track whether the post-payment refetch has actually completed so the
  // comparison effect knows it's safe to compute. Without this flag the
  // effect would fire on the pre-payment `issues` state and produce
  // misleading "0 cleared" results.
  const refetchAfterPaymentPending = useRef(false);

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

  // Reset all transient state and re-fetch whenever the drawer opens.
  useEffect(() => {
    if (open) {
      setPaymentJustRecorded(false);
      setOptimisticallyClearedIds(new Set());
      setBeforeSnapshotIds(null);
      setComparisonResult(null);
      refetchAfterPaymentPending.current = false;
      loadIssues();
    }
  }, [open, loadIssues]);

  /**
   * Phase 5 — apply the shared classification utility to the visible
   * issues (post optimistic clear). This is the single source of truth
   * for both the predictive section render and the rendered groupings.
   * Replaces the old hand-rolled `paymentClearing/otherIssues` split.
   */
  const classification = useMemo(() => {
    const visible = (issues ?? []).filter((i) => !optimisticallyClearedIds.has(i.id));
    return classifyBlockers(visible, invoice);
  }, [issues, optimisticallyClearedIds, invoice]);

  /** Predictive summary for the drawer header. */
  const summary: PredictiveSummary = useMemo(
    () => generatePredictiveSummary(classification, invoice),
    [classification, invoice],
  );

  /**
   * Should the inline payment form render?
   * Yes when there's an unpaid balance — even if the predictive bucket
   * has zero payment-rooted issues, the unpaid_completed_invoice
   * computed reason on the parent panel implies the operator wants to
   * record payment from here.
   */
  const showPaymentForm = summary.paymentActionable;

  const handlePaymentSuccess = useCallback(async () => {
    // Phase 5 — capture the "before" state at the moment of action.
    // We use the full set of currently-visible issue IDs (post any
    // existing optimistic clears, though there shouldn't be any yet
    // since the drawer reset on open). This becomes the comparison
    // baseline for the result summary.
    const before = new Set((issues ?? []).map((i) => i.id));
    setBeforeSnapshotIds(before);

    setPaymentJustRecorded(true);
    // Optimistically hide the payment-rooted issues for instant
    // feedback. The shared classification utility already restricted
    // these to issue types the backend will auto-clear when payment
    // is recorded against the linked invoice.
    setOptimisticallyClearedIds(
      new Set(classification.paymentRooted.map((b) => b.id)),
    );
    // Trigger backend stale-cleanup (subject to the existing 60s
    // cooldown). Even if the cooldown blocks it on this exact call,
    // the optimistic clear above keeps the UI honest until the next
    // page visit and the result UI uses conservative copy.
    api.get("/billing-issues/summary").catch(() => {});
    // Mark the refetch as pending so the comparison effect knows
    // when it's safe to compute the diff against the new `issues`.
    refetchAfterPaymentPending.current = true;
    await loadIssues();
    onRefetch();
  }, [issues, classification, loadIssues, onRefetch]);

  /**
   * Phase 5 — post-action comparison effect.
   * Fires once after `loadIssues` updates `issues` following a
   * payment success. Diffs the before/after snapshots and stores the
   * result in `comparisonResult` so the result section can render.
   * Uses a ref flag instead of plain state so the effect doesn't
   * accidentally fire on initial drawer open.
   */
  useEffect(() => {
    if (!refetchAfterPaymentPending.current) return;
    if (!beforeSnapshotIds || !issues) return;
    const afterIds = new Set(issues.map((i) => i.id));
    setComparisonResult(compareBlockerSets(beforeSnapshotIds, afterIds));
    refetchAfterPaymentPending.current = false;
  }, [beforeSnapshotIds, issues]);

  /**
   * Phase 5 — auto-close on success. When the comparison confirms
   * every blocker cleared AND the linked invoice is no longer
   * actionable (parent's onRefetch will have updated `invoice` to
   * paid/partial by the time this fires), give the operator 1.5s of
   * visual confirmation then close the drawer. The blocked panel on
   * the Job page will already be gone by the time they look up.
   */
  useEffect(() => {
    if (!comparisonResult?.allCleared) return;
    if (summary.paymentActionable) return; // invoice still unpaid → don't auto-close
    const timer = setTimeout(() => onClose(), 1500);
    return () => clearTimeout(timer);
  }, [comparisonResult, summary.paymentActionable, onClose]);

  /* ─── Registry-driven labels ─── */

  const drawerTitle =
    FEATURE_REGISTRY.job_blocked_resolution_drawer?.label ?? "Resolve Blockers";
  const paymentSectionTitle =
    FEATURE_REGISTRY.job_blocked_resolution_payment_first?.label ?? "Record Payment";
  const fallbackCtaLabel =
    FEATURE_REGISTRY.job_blocked_resolution_open_in_billing_issues?.label ??
    "Open in Billing Issues";
  const sectionPaymentLabel =
    FEATURE_REGISTRY.blocker_prediction_section_payment_rooted?.label ??
    "Will clear after payment";
  const sectionNonPaymentLabel =
    FEATURE_REGISTRY.blocker_prediction_section_non_payment?.label ??
    "Needs separate review";
  const sectionUncertainLabel =
    FEATURE_REGISTRY.blocker_prediction_section_uncertain?.label ??
    "May need review";
  const predictionLeadLabel = FEATURE_REGISTRY[
    PREDICTION_KIND_LABEL_KEYS[summary.kind]
  ]?.label;
  const resultAllClearedLabel =
    FEATURE_REGISTRY.blocker_result_all_cleared?.label ?? "All blockers cleared";
  const resultSomeClearedLabel =
    FEATURE_REGISTRY.blocker_result_some_cleared?.label ??
    "Some blockers cleared. Others still need attention.";
  const resultNoneClearedLabel =
    FEATURE_REGISTRY.blocker_result_none_cleared?.label ??
    "No blockers cleared yet — backend is catching up.";

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

        {/* ─── Phase 5: predictive lead phrase ─── */}
        {/*
         * Rendered whenever we have classified data (i.e. issues
         * loaded successfully). Uses the discriminated `kind` to pick
         * the matching registry label so the user-facing copy is never
         * hardcoded. Counts are inserted next to the lead phrase so
         * the operator immediately sees the magnitude of each bucket.
         */}
        {!loadError && issues !== null && !comparisonResult && summary.kind !== "no_blockers" && predictionLeadLabel && (
          <div
            className="rounded-[14px] border px-4 py-3"
            style={{
              backgroundColor: "var(--t-bg-card)",
              borderColor: "var(--t-border)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>
              {predictionLeadLabel}
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--t-text-muted)" }}>
              {summary.paymentRootedCount > 0 && (
                <li>
                  <span className="font-semibold tabular-nums" style={{ color: "var(--t-text-primary)" }}>
                    {summary.paymentRootedCount}
                  </span>{" "}
                  {sectionPaymentLabel.toLowerCase()}
                </li>
              )}
              {summary.nonPaymentCount > 0 && (
                <li>
                  <span className="font-semibold tabular-nums" style={{ color: "var(--t-text-primary)" }}>
                    {summary.nonPaymentCount}
                  </span>{" "}
                  {sectionNonPaymentLabel.toLowerCase()}
                </li>
              )}
              {summary.uncertainCount > 0 && (
                <li>
                  <span className="font-semibold tabular-nums" style={{ color: "var(--t-text-primary)" }}>
                    {summary.uncertainCount}
                  </span>{" "}
                  {sectionUncertainLabel.toLowerCase()}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ─── Phase 5: post-action result summary ─── */}
        {/*
         * Replaces the predictive section once payment has been
         * recorded AND the post-action refetch has completed. Uses
         * conservative copy:
         *   - allCleared       → "All blockers cleared" (drawer auto-closes)
         *   - cleared > 0      → "N cleared, M still need attention"
         *   - cleared === 0    → "Backend is catching up" (cooldown likely)
         */}
        {comparisonResult && (
          <div
            className="rounded-[16px] border-l-4 px-4 py-3"
            style={{
              backgroundColor: comparisonResult.allCleared
                ? "var(--t-accent-soft)"
                : "var(--t-warning-soft)",
              borderColor: comparisonResult.allCleared
                ? "var(--t-accent)"
                : "var(--t-warning)",
            }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2
                className="h-4 w-4"
                style={{
                  color: comparisonResult.allCleared
                    ? "var(--t-accent)"
                    : "var(--t-warning)",
                }}
              />
              <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                {comparisonResult.allCleared
                  ? resultAllClearedLabel
                  : comparisonResult.cleared.length > 0
                    ? resultSomeClearedLabel
                    : resultNoneClearedLabel}
              </p>
            </div>
            {!comparisonResult.allCleared && comparisonResult.cleared.length > 0 && (
              <p className="mt-1 text-xs" style={{ color: "var(--t-text-secondary)" }}>
                <span className="font-semibold tabular-nums">{comparisonResult.cleared.length}</span> cleared,{" "}
                <span className="font-semibold tabular-nums">{comparisonResult.remaining.length}</span> still
                need attention.
              </p>
            )}
            {comparisonResult.allCleared && (
              <p className="mt-1 text-xs" style={{ color: "var(--t-text-secondary)" }}>
                Closing this drawer in a moment.
              </p>
            )}
          </div>
        )}

        {/* Payment-first section — only when there's an unpaid balance */}
        {showPaymentForm && invoice && !comparisonResult?.allCleared && (
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
              </div>
            </header>

            {/* Payment-rooted issues — list with section header from registry */}
            {classification.paymentRooted.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>
                  {sectionPaymentLabel}
                </p>
                <ul className="space-y-1.5">
                  {classification.paymentRooted.map((issue) => {
                    const full = (issues ?? []).find((i) => i.id === issue.id);
                    return (
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
                            {full?.description && (
                              <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                                {full.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <RecordPaymentForm
              invoiceId={invoice.id}
              balanceDue={Number(invoice.balance_due)}
              onSuccess={handlePaymentSuccess}
            />
          </section>
        )}

        {/* Uncertain section — softer copy, no inline action */}
        {classification.uncertain.length > 0 && !loadError && !comparisonResult?.allCleared && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {sectionUncertainLabel}
            </h3>
            <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
              These blockers may also clear after action, but warrant a quick review.
            </p>
            <ul className="space-y-1.5">
              {classification.uncertain.map((issue) => {
                const full = (issues ?? []).find((i) => i.id === issue.id);
                return (
                  <li
                    key={issue.id}
                    className="rounded-[12px] border px-3 py-2"
                    style={{
                      borderColor: "var(--t-border)",
                      backgroundColor: "var(--t-bg-card)",
                    }}
                  >
                    <p className="text-xs font-semibold capitalize" style={{ color: "var(--t-text-primary)" }}>
                      {issue.issue_type.replace(/_/g, " ")}
                    </p>
                    {full?.description && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                        {full.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Non-payment section — anything that needs separate attention */}
        {classification.nonPayment.length > 0 && !loadError && !comparisonResult?.allCleared && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {sectionNonPaymentLabel}
            </h3>
            <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
              These issues need separate attention. Open them in the Billing Issues
              workspace for the full guided resolution flow.
            </p>
            <ul className="space-y-1.5">
              {classification.nonPayment.map((issue) => {
                const full = (issues ?? []).find((i) => i.id === issue.id);
                return (
                  <li
                    key={issue.id}
                    className="rounded-[12px] border px-3 py-2"
                    style={{
                      borderColor: "var(--t-border)",
                      backgroundColor: "var(--t-bg-card)",
                    }}
                  >
                    <p className="text-xs font-semibold capitalize" style={{ color: "var(--t-text-primary)" }}>
                      {issue.issue_type.replace(/_/g, " ")}
                    </p>
                    {full?.description && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                        {full.description}
                      </p>
                    )}
                  </li>
                );
              })}
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

        {/* Empty case — drawer opened against a job with no actionable blockers */}
        {!loading &&
          !loadError &&
          !showPaymentForm &&
          summary.kind === "no_blockers" &&
          !comparisonResult && (
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>
              {FEATURE_REGISTRY.blocker_prediction_no_blockers?.label ??
                "No actionable blockers found for this job."}{" "}
              If you expected to see something here, try the Billing Issues page directly.
            </p>
          )}
      </div>
    </SlideOver>
  );
}
