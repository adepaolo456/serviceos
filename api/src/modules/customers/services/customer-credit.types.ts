/**
 * Phase 2 — Credit-control: shared TypeScript types for the
 * customer accounting / credit state computation pipeline.
 *
 * The shapes below are the contract between `CustomerCreditService`
 * and any future consumer (dispatch gating, customer detail UI,
 * AR aging dashboard, blocked-job drawer policy display, etc.).
 *
 * Phase 2 has zero existing consumers — these types are foundation
 * for later phases. Adding a new field to a future shape requires
 * an additive change here and explicit handling in the service so
 * the contract evolves predictably.
 */

import type { PaymentTerms } from '../payment-terms';

/* ─── Source of effective values ───────────────────────────────── */

/**
 * Where an effective value came from in the precedence chain. Used
 * to expose to future UI ("this customer is using your tenant
 * default of net-30; click to override").
 */
export type EffectiveSource = 'customer_override' | 'tenant_default' | 'app_default' | 'none';

/* ─── Hold reasons (structured) ────────────────────────────────── */

/**
 * Discriminated union of structured hold reasons. Each variant
 * carries the data the operator needs to understand WHY the hold
 * is active. Future phases will render these as registry-driven
 * label rows in the customer detail / dispatch / blocked-job UI.
 *
 * Adding a new variant requires:
 *   1. New `type` literal here
 *   2. Corresponding computation in `CustomerCreditService.getCustomerCreditState`
 *   3. Future UI registry entries for the human-readable label
 */
export type HoldReason =
  | {
      type: 'manual_hold';
      set_by: string | null;
      set_at: string | null;
      reason: string | null;
    }
  | {
      type: 'credit_limit_exceeded';
      limit: number;
      current_ar: number;
    }
  | {
      type: 'overdue_threshold_exceeded';
      threshold_days: number;
      oldest_past_due_days: number;
    };

/* ─── Receivable / past-due / credit / payment terms / hold ───── */

export interface ReceivableState {
  /** Sum of `balance_due` across all open invoices for this customer. */
  total_open_ar: number;
  /** Number of invoices with positive balance_due (excludes voided/draft). */
  open_invoice_count: number;
  /** Convenience flag — true when `total_open_ar > 0`. */
  has_open_receivables: boolean;
}

export interface PastDueState {
  /** Sum of `balance_due` on invoices where `due_date < CURRENT_DATE`. */
  total_past_due_ar: number;
  /** Number of past-due invoices with positive balance_due. */
  past_due_invoice_count: number;
  /**
   * Days since the oldest past-due invoice's due_date. NULL when
   * there are zero past-due invoices.
   */
  oldest_past_due_days: number | null;
}

export interface CreditLimitState {
  /**
   * Effective credit limit after applying the precedence chain
   * (customer override > tenant default > none). NULL when no
   * limit is configured at any level.
   */
  effective_limit: number | null;
  /**
   * `effective_limit - total_open_ar`. NULL when `effective_limit`
   * is NULL (no limit configured).
   */
  available_credit: number | null;
  /** True when `effective_limit !== null && total_open_ar > effective_limit`. */
  limit_exceeded: boolean;
  /** True when `effective_limit === null`. */
  no_limit_configured: boolean;
  /** Where the effective_limit came from. */
  source: EffectiveSource;
}

export interface PaymentTermsState {
  /** Effective payment terms after the precedence chain. Always non-null. */
  effective: PaymentTerms;
  /** Where the effective value came from. */
  source: EffectiveSource;
}

export interface ManualHoldMetadata {
  reason: string | null;
  set_by: string | null;
  set_at: string | null;
  released_by: string | null;
  released_at: string | null;
}

export interface HoldState {
  /** From `customers.credit_hold`. */
  manual_active: boolean;
  /**
   * Computed from tenant credit_policy rules. Phase 2 stores the
   * policy but enforcement-style computation only fires when the
   * relevant rule has `enabled: true` in the tenant policy.
   */
  policy_active: boolean;
  /** `manual_active || policy_active`. The headline answer. */
  effective_active: boolean;
  /** Structured reasons explaining WHY the hold is active. */
  reasons: HoldReason[];
  /**
   * Audit metadata for the manual hold record. NULL when the
   * customer has never been on manual hold.
   */
  manual_metadata: ManualHoldMetadata | null;
}

/* ─── Top-level customer credit state ──────────────────────────── */

/**
 * Complete accounting / credit / hold state for a single customer.
 * Returned by `CustomerCreditService.getCustomerCreditState`. Pure
 * computed value — no DB writes happen during this read.
 */
export interface CustomerCreditState {
  customer_id: string;
  tenant_id: string;
  computed_at: string;

  receivable: ReceivableState;
  past_due: PastDueState;
  credit: CreditLimitState;
  payment_terms: PaymentTermsState;
  hold: HoldState;
}
