-- =============================================================================
-- phantom-paid-detector.sql
-- =============================================================================
--
-- Purpose:
--   Detect invoices marked paid/partial without sufficient backing payment
--   rows. Verifies no producer has reintroduced the April 29 phantom-paid
--   pattern (status/amount_paid stamped directly without writing matching
--   payment rows).
--
-- When to run:
--   - As part of any billing-touching PR review when reconcileBalance,
--     applyPayment, or seed paths change.
--   - Quarterly hygiene check.
--   - Whenever a customer dispute references an invoice marked paid that
--     they claim was not actually paid.
--
-- Expected clean result:
--   Only OK rows. Any other classification appearing in production is a
--   finding.
--
-- What counts as a finding:
--   - PHANTOM_PAID_NO_PAYMENT_ROWS — invoice paid/partial with amount_paid
--     > 0 and zero payment rows. The original April 29 pattern. Investigate
--     immediately.
--   - PAID_STATUS_BUT_BALANCE_DUE — status='paid' but amount_paid < total
--     and balance_due > 0. Indicates reconcileBalance() was bypassed.
--   - AMOUNT_PAID_EXCEEDS_PAYMENTS — amount_paid exceeds
--     (sum_payments - sum_refunds) by more than $0.01. Manual stamping or
--     arithmetic drift.
--   - AMOUNT_PAID_PAYMENT_SUM_MISMATCH — paid/partial status with
--     arithmetic mismatch beyond rounding tolerance.
--
-- Safety:
--   SELECT-only. Read-only. No DB writes. No destructive keywords.
--   This is a DETECTOR ONLY. Do not add UPDATE / DELETE / INSERT to this file.
--
-- Notes / known false positives:
--   - Trivial "no money moved" rows (status NOT IN ('paid','partial'),
--     amount_paid = 0, payment_count = 0) are intentionally excluded by
--     the WHERE clause to keep the result set focused.
--   - $0.01 rounding tolerance is intentional — Postgres numeric arithmetic
--     can drift by sub-cent amounts on multi-row sums.
--   - Refund accounting follows the pattern: net_paid = sum_payments
--     - sum_refunds. Confirm against current invoice.service.ts semantics
--     before tightening the comparison.
--
-- Source:
--   Recommended detector shape — NOT exact May 1 executed SQL. Verify query
--   syntax against current schema before relying on results in production.
--
-- Background:
--   April 29 2026 phantom-paid audit found 4 rows where seed.controller.ts
--   direct-set status='paid' + amount_paid without writing matching payment
--   rows. Producer was closed in commit 8Tpwz3D (Fix A). This detector
--   exists to catch any future regression of the same class of producer.
--
-- Replace <TENANT_UUID> with the target tenant before running, or remove
-- the WHERE filter for a cross-tenant scan (understand the blast radius first).
-- =============================================================================

-- Detect invoices marked paid/partial without sufficient backing payment rows.
-- This is a DETECTOR ONLY. Do not add UPDATE / DELETE / INSERT to this file.
--
-- Source: recommended detector shape — NOT exact May 1 executed SQL.
-- Verify query syntax against current schema before relying on results.
--
-- Background: April 29 phantom-paid audit found 4 rows where seed.controller.ts
-- direct-set status=paid + amount_paid without writing matching payment rows.
-- Producer closed in commit 8Tpwz3D (Fix A). This query verifies no new
-- producer has reintroduced the pattern.
--
-- Read-only. No DB writes.
-- Replace the tenant UUID below before running, or remove the WHERE for cross-tenant scan.

WITH tenant AS (SELECT '<TENANT_UUID>'::uuid AS id),

invoice_payment_totals AS (
  SELECT i.id AS invoice_id,
         i.tenant_id,
         i.status AS invoice_status,
         i.total,
         i.amount_paid,
         i.balance_due,
         COALESCE(SUM(p.amount), 0) AS sum_payments,
         COALESCE(SUM(p.refunded_amount), 0) AS sum_refunds,
         COUNT(p.id) AS payment_count
  FROM invoices i
  LEFT JOIN payments p ON p.invoice_id = i.id AND p.tenant_id = i.tenant_id
  WHERE i.tenant_id = (SELECT id FROM tenant)
  GROUP BY i.id, i.tenant_id, i.status, i.total, i.amount_paid, i.balance_due
)

SELECT invoice_id::text,
       invoice_status,
       total,
       amount_paid,
       balance_due,
       sum_payments,
       sum_refunds,
       payment_count,
       CASE
         WHEN invoice_status IN ('paid','partial')
              AND amount_paid > 0
              AND payment_count = 0
           THEN 'PHANTOM_PAID_NO_PAYMENT_ROWS'
         WHEN invoice_status = 'paid'
              AND amount_paid < total
              AND balance_due > 0
           THEN 'PAID_STATUS_BUT_BALANCE_DUE'
         WHEN amount_paid > (sum_payments - sum_refunds) + 0.01
           THEN 'AMOUNT_PAID_EXCEEDS_PAYMENTS'
         WHEN invoice_status IN ('paid','partial')
              AND ABS(amount_paid - (sum_payments - sum_refunds)) > 0.01
           THEN 'AMOUNT_PAID_PAYMENT_SUM_MISMATCH'
         ELSE 'OK'
       END AS classification
FROM invoice_payment_totals
WHERE NOT (
  invoice_status NOT IN ('paid','partial')
  AND amount_paid = 0
  AND payment_count = 0
)
ORDER BY classification, invoice_id;
