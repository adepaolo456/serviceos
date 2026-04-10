/**
 * Phase 1 — Credit-control foundation: tenant-level credit policy.
 *
 * Stores the tenant's credit-control configuration inside the
 * existing `tenants.settings` JSONB column under the `credit_policy`
 * key. No schema migration required for the tenant side — the
 * `settings` column already exists with default `{}`.
 *
 * Why JSONB instead of a dedicated table:
 *   1. `tenants.settings` already exists for exactly this purpose
 *      (other tenant config lives there)
 *   2. One row per tenant — no need for a join table
 *   3. Tenant scoping is automatic (the column is on the tenants table)
 *   4. Adding new policy fields in future phases requires no migration
 *   5. Low write frequency (operators rarely change credit policy)
 *      means the JSONB read overhead is negligible
 *
 * Phase 1 scope: this file defines the shape and a read-only helper.
 * No code writes or enforces these settings yet. Later phases will:
 *   - Add admin UI for editing the policy
 *   - Use `default_payment_terms` as fallback when a customer's own
 *     `payment_terms` is NULL
 *   - Use `default_credit_limit` as fallback for `customers.credit_limit`
 *   - Implement AR threshold + overdue blocking when enabled
 *
 * Multi-tenant safety: the helper takes a Tenant entity (or any object
 * with a `settings` field) and returns ONLY that tenant's policy. There
 * is no cross-tenant access. Callers are responsible for loading the
 * tenant via the existing tenant-scoped repository pattern.
 */

import type { PaymentTerms } from '../customers/payment-terms';

/**
 * Mode for an enforcement rule. `warn` surfaces a notification to
 * operators but does not block the action. `block` prevents the
 * action entirely (with operator-override capability if
 * `allow_office_override` is true at the policy root).
 */
export type CreditPolicyMode = 'warn' | 'block';

export interface ArThresholdRule {
  enabled: boolean;
  /** Total open AR threshold (USD). Block triggers when AR > threshold. */
  threshold?: number;
  mode?: CreditPolicyMode;
}

export interface OverdueRule {
  enabled: boolean;
  /** Number of days past due that triggers the rule. */
  days_overdue?: number;
  mode?: CreditPolicyMode;
}

export interface UnpaidExceptionsRule {
  enabled: boolean;
  mode?: CreditPolicyMode;
}

/**
 * Tenant-level credit policy. All fields are optional — an unset
 * field means "no rule configured" for the corresponding behavior.
 * Future phases consume these settings; Phase 1 only stores them.
 */
export interface CreditPolicySettings {
  /**
   * Default payment terms for newly created customers when no
   * customer-specific override is set on `customers.payment_terms`.
   */
  default_payment_terms?: PaymentTerms;

  /**
   * Default credit limit for newly created customers (USD). Customer
   * rows with NULL `credit_limit` fall back to this value when later
   * phases compute available credit.
   */
  default_credit_limit?: number | null;

  /**
   * Block when total open AR for a customer exceeds a threshold.
   * Threshold can be a flat USD value or, in future phases, a
   * multiplier of the customer's credit_limit.
   */
  ar_threshold_block?: ArThresholdRule;

  /**
   * Block when any invoice is overdue beyond N days.
   */
  overdue_block?: OverdueRule;

  /**
   * Block when there are unpaid exception charges (overage, weight,
   * surcharge etc.) on the customer's account.
   */
  unpaid_exceptions_block?: UnpaidExceptionsRule;

  /**
   * When true, operators with sufficient role can override an
   * automatic block on a per-action basis. The override must be
   * audited (future phase will record who/when/why on the action).
   */
  allow_office_override?: boolean;
}

/**
 * Read-only accessor. Returns the tenant's credit policy from
 * `settings.credit_policy`, or an empty object if not configured.
 * Never throws — a missing or malformed `settings` field returns
 * the empty default. Callers should treat the return value as
 * potentially-empty and handle the "no rule configured" case.
 *
 * Phase 1 has no consumers. Future phases will call this from the
 * dispatch / billing-issue / blocked-job pipelines as needed.
 */
export function getCreditPolicy(tenant: {
  settings?: Record<string, unknown> | null;
}): CreditPolicySettings {
  const raw = tenant.settings?.credit_policy;
  if (!raw || typeof raw !== 'object') return {};
  return raw as CreditPolicySettings;
}
