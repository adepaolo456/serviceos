/**
 * Blocker prediction + post-action comparison helpers (Phase 5).
 *
 * Pure presentation-layer utility — NO backend calls, NO mutation, NO
 * source of truth. Classifies the blockers the Job Blocked Resolution
 * Drawer already fetched and produces structured guidance the drawer
 * renders via registry-driven labels.
 *
 * Key design rules:
 *   - Deterministic. Same inputs → same outputs. No randomness, no
 *     time-of-day branches, no API state.
 *   - Conservative. When uncertain, classify as `uncertain` and let
 *     the UI surface a softer message. Never overpromise.
 *   - Documented. Every issue type's bucket assignment is justified
 *     in `BLOCKER_TYPE_RULES` below with a reference to the backend
 *     auto-resolution behavior it relies on.
 *   - Explainable. The discriminated `PredictiveSummary.kind` lets
 *     the UI pick the matching registry label without the utility
 *     hardcoding any user-facing copy.
 *   - Single source of truth preserved. This file does NOT decide
 *     whether an issue is *actually* resolved — only how to *talk
 *     about* the issue before and after action. Authoritative
 *     resolution still happens in
 *     BillingIssueDetectorService.resolveStaleIssues on the backend.
 *
 * Consumers:
 *   - web/src/components/job-blocked-resolution-drawer.tsx
 */

/* ─── Types ─────────────────────────────────────────────────────── */

/**
 * Coarse classification bucket for a single billing issue, derived
 * from its `issue_type` and the current invoice state.
 */
export type BlockerGroup = "payment_rooted" | "non_payment" | "uncertain";

/**
 * Minimal blocker shape required for classification. Matches the
 * fields the drawer already fetches from
 * `/billing-issues?jobId=…&status=open`.
 */
export interface PredictableBlocker {
  id: string;
  issue_type: string;
}

/**
 * Minimal invoice shape required for classification. The presence of
 * an unpaid balance is what makes payment-rooted predictions
 * actionable; without an unpaid balance the operator can't record
 * payment, so even payment-rooted issue types collapse to
 * `uncertain` (we don't know how the operator will resolve them).
 */
export interface PredictableInvoice {
  status: string;
  balance_due: number;
}

/**
 * Output of `classifyBlockers`. Same blocker objects, partitioned by
 * bucket. The sum of all three arrays equals the input list (no
 * blocker is dropped or duplicated).
 */
export interface BlockerClassification {
  paymentRooted: PredictableBlocker[];
  nonPayment: PredictableBlocker[];
  uncertain: PredictableBlocker[];
}

/**
 * Discriminated summary the UI maps to a registry label key. The UI
 * is responsible for picking the right `FEATURE_REGISTRY[...]` entry
 * for each `kind` and substituting the counts at render time.
 *
 * `kind` semantics:
 *   - `all_payment_clear`        → only payment-rooted blockers; high confidence
 *                                   that recording payment will clear all of them
 *   - `payment_with_remaining`   → payment-rooted blockers + non-payment blockers
 *                                   that will require separate review
 *   - `payment_with_uncertain`   → payment-rooted blockers + uncertain blockers
 *                                   that may also clear but warrant review
 *   - `mixed`                    → payment-rooted + non-payment + uncertain
 *   - `non_payment_only`         → no payment-rooted; only manual-review issues
 *   - `uncertain_only`           → only uncertain issues; conservative messaging
 *   - `no_blockers`              → empty input; nothing actionable
 */
export type PredictiveSummaryKind =
  | "all_payment_clear"
  | "payment_with_remaining"
  | "payment_with_uncertain"
  | "mixed"
  | "non_payment_only"
  | "uncertain_only"
  | "no_blockers";

export interface PredictiveSummary {
  kind: PredictiveSummaryKind;
  paymentRootedCount: number;
  nonPaymentCount: number;
  uncertainCount: number;
  /**
   * True when there is a recordable payment that will plausibly
   * clear at least one blocker. The UI uses this to decide whether
   * to render the inline payment form prominently.
   */
  paymentActionable: boolean;
}

/**
 * Output of `compareBlockerSets`. `cleared` lists IDs that were
 * present before but absent after; `remaining` lists IDs that survived
 * the action. `allCleared` is true when every previously-known blocker
 * is gone — the drawer uses this to trigger its auto-close behavior.
 */
export interface BlockerComparison {
  cleared: string[];
  remaining: string[];
  allCleared: boolean;
}

/* ─── Rule table ────────────────────────────────────────────────── */

/**
 * Per-issue-type classification rules. Each entry is a deliberate
 * call about whether the backend's existing auto-resolution behavior
 * will clear the issue when payment is recorded against the linked
 * invoice. Anything not listed here falls through to `uncertain`.
 *
 * Backend auto-resolution reference (as of Phase 4):
 *   billing-issue-detector.service.ts → resolveStaleIssues
 *     Pass 1: past_due_payment    cleared when balance≤0 OR invoice in
 *                                  ('paid','voided')
 *     Pass 4: completed_unpaid    cleared when balance≤0 OR invoice in
 *                                  ('paid','partial','voided')
 *
 * Issue types NOT auto-cleared by payment:
 *   - missing_dump_slip   → resolved by uploading the slip
 *   - weight_overage      → resolved by adjusting the invoice line item
 *   - surcharge_gap       → resolved by adding/removing surcharges
 *   - no_invoice          → resolved by creating an invoice (precondition,
 *                            not a payment outcome)
 *   - overdue_days        → resolved by adjusting rental period
 *   - price_mismatch      → resolved either by recalculating pricing OR
 *                            (per Pass 2) auto-cleared when invoice closed.
 *                            We classify as `uncertain` because the
 *                            *underlying* mismatch may still warrant audit
 *                            even if the issue row auto-clears.
 */
const BLOCKER_TYPE_RULES: Record<string, BlockerGroup> = {
  // High-confidence payment-rooted — direct backend auto-resolve on payment.
  past_due_payment: "payment_rooted",
  completed_unpaid: "payment_rooted",

  // High-confidence non-payment — payment doesn't fix the underlying problem.
  missing_dump_slip: "non_payment",
  weight_overage: "non_payment",
  surcharge_gap: "non_payment",
  no_invoice: "non_payment",
  overdue_days: "non_payment",

  // Conservative uncertain — backend may auto-clear via the invoice-closed
  // pass, but the underlying mismatch may still warrant operator review.
  price_mismatch: "uncertain",
};

/* ─── Functions ─────────────────────────────────────────────────── */

/**
 * Partition blockers into payment-rooted / non-payment / uncertain
 * buckets. When the linked invoice has no unpaid balance, every
 * payment-rooted issue type is downgraded to `uncertain` because
 * recording payment is no longer an actionable lever — the operator
 * can't pay an already-paid invoice.
 *
 * Unknown issue types fall through to `uncertain` so new detector
 * rules added in the backend get a safe default until this rule
 * table is updated.
 */
export function classifyBlockers(
  blockers: PredictableBlocker[],
  invoice: PredictableInvoice | null,
): BlockerClassification {
  const paymentRooted: PredictableBlocker[] = [];
  const nonPayment: PredictableBlocker[] = [];
  const uncertain: PredictableBlocker[] = [];

  const paymentActionable = isPaymentActionable(invoice);

  for (const b of blockers) {
    const rule = BLOCKER_TYPE_RULES[b.issue_type];
    if (rule === "payment_rooted") {
      // Only honor the payment-rooted classification when payment is
      // actually a lever the operator can pull. Otherwise downgrade
      // to uncertain so the UI doesn't suggest recording a payment
      // that can't be recorded.
      if (paymentActionable) {
        paymentRooted.push(b);
      } else {
        uncertain.push(b);
      }
    } else if (rule === "non_payment") {
      nonPayment.push(b);
    } else {
      uncertain.push(b);
    }
  }

  return { paymentRooted, nonPayment, uncertain };
}

/**
 * Decide which discriminated `kind` of summary to render and how to
 * count each bucket. The UI uses `kind` to look up the matching
 * registry label.
 */
export function generatePredictiveSummary(
  classification: BlockerClassification,
  invoice: PredictableInvoice | null,
): PredictiveSummary {
  const p = classification.paymentRooted.length;
  const n = classification.nonPayment.length;
  const u = classification.uncertain.length;

  const summary = (kind: PredictiveSummaryKind): PredictiveSummary => ({
    kind,
    paymentRootedCount: p,
    nonPaymentCount: n,
    uncertainCount: u,
    paymentActionable: isPaymentActionable(invoice),
  });

  if (p === 0 && n === 0 && u === 0) return summary("no_blockers");

  if (p > 0 && n === 0 && u === 0) return summary("all_payment_clear");
  if (p > 0 && n > 0 && u === 0) return summary("payment_with_remaining");
  if (p > 0 && n === 0 && u > 0) return summary("payment_with_uncertain");
  if (p > 0 && n > 0 && u > 0) return summary("mixed");

  if (p === 0 && n > 0 && u === 0) return summary("non_payment_only");
  if (p === 0 && u > 0 && n === 0) return summary("uncertain_only");

  // p === 0 && n > 0 && u > 0  → still mostly manual-review-driven
  return summary("non_payment_only");
}

/**
 * Diff a before/after snapshot of blocker IDs. Used after a payment
 * action to tell the operator exactly what cleared.
 */
export function compareBlockerSets(
  beforeIds: ReadonlySet<string>,
  afterIds: ReadonlySet<string>,
): BlockerComparison {
  const cleared: string[] = [];
  for (const id of beforeIds) {
    if (!afterIds.has(id)) cleared.push(id);
  }
  const remaining: string[] = [];
  for (const id of afterIds) {
    remaining.push(id);
  }
  return {
    cleared,
    remaining,
    allCleared: remaining.length === 0,
  };
}

/* ─── Internals ─────────────────────────────────────────────────── */

const PAID_INVOICE_STATUSES: ReadonlyArray<string> = [
  "paid",
  "partial",
  "voided",
];

function isPaymentActionable(invoice: PredictableInvoice | null): boolean {
  if (!invoice) return false;
  if (Number(invoice.balance_due) <= 0) return false;
  if (PAID_INVOICE_STATUSES.includes(invoice.status)) return false;
  return true;
}
