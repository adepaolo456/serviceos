/**
 * Phase 1 — Credit-control foundation: payment terms enum.
 *
 * Single TypeScript source of truth for the allowed values of
 * `customers.payment_terms`. Mirrors the database CHECK constraint
 * declared in
 * migrations/2026-04-09-credit-control-foundation.sql.
 *
 * Adding a new value here REQUIRES a corresponding migration that
 * extends the CHECK constraint. The application layer should always
 * import from this file rather than hardcoding strings.
 *
 * Phase 1 scope: this file is foundation only. No code currently
 * reads or enforces payment terms — the column exists for later
 * phases (invoice due-date computation, AR aging, customer detail UI).
 *
 * Web/UI labels: when later phases surface payment terms in the UI,
 * the human-readable labels (e.g., "Net 30 days") must come from
 * the centralized feature registry on the web side, NOT hardcoded
 * here. This file is API-side only and intentionally does not own
 * any user-facing copy.
 */

export const PAYMENT_TERMS = [
  'due_on_receipt',
  'cod',
  'net_7',
  'net_15',
  'net_30',
  'net_60',
  'custom',
] as const;

export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/**
 * Days from invoice issuance to due date for each payment terms
 * value. Used by future phases to compute invoice `due_date` from
 * `issued_at`. `'custom'` returns null because the operator must
 * specify a per-invoice override; the application layer should
 * fall back to the tenant default when this returns null.
 */
export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number | null> = {
  due_on_receipt: 0,
  cod: 0, // collected on delivery — same as due_on_receipt for AR purposes
  net_7: 7,
  net_15: 15,
  net_30: 30,
  net_60: 60,
  custom: null,
};

/**
 * Type guard — narrows an unknown string to a `PaymentTerms` value.
 * Use at API boundaries (DTOs, request validation) to ensure only
 * the allowed enum values reach the database write path. The
 * database CHECK constraint is the ultimate enforcer; this is the
 * application-side belt-and-suspenders.
 */
export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return (
    typeof value === 'string' &&
    (PAYMENT_TERMS as ReadonlyArray<string>).includes(value)
  );
}
