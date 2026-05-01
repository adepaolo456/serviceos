-- =============================================================================
-- legacy-completed-unpaid-invoices.sql
-- =============================================================================
--
-- Purpose:
--   Surface completed jobs whose linked invoice is NOT paid/partial. Per the
--   dispatch-gate rule, completed jobs SHOULD have paid/partial invoices.
--   Legacy jobs without chain links can be exceptions, but worth surfacing.
--
-- When to run:
--   Quarterly hygiene check, or whenever auditing whether the dispatch-gate
--   contract is being honored end-to-end. Re-run after any change to the
--   completion or invoice-reconciliation paths.
--
-- Expected clean result:
--   Only OK_PAID, VOIDED_ONLY, NO_INVOICE_LINKED (legacy manual jobs), or
--   OTHER (voided $0-balance) rows. Zero COMPLETED_BUT_OPEN_INVOICE rows
--   in production-shaped data (test data may legitimately fall here).
--
-- What counts as a finding:
--   Any COMPLETED_BUT_OPEN_INVOICE row that is NOT clearly E2E test data.
--   Investigate whether dispatch was incorrectly gated, whether
--   reconcileBalance was bypassed, or whether a manual completion path
--   skipped invoice settlement.
--
-- Safety:
--   SELECT-only. Read-only. No DB writes. No destructive keywords.
--
-- Notes / known false positives:
--   - VOIDED_ONLY and OTHER classifications frequently reflect legitimate
--     corrections, dogfooding, or refunded jobs.
--   - E2E test data can show up as COMPLETED_BUT_OPEN_INVOICE; verify against
--     the test fixture allowlist before treating it as a real finding.
--   - "Legacy manual" jobs (created before chain-link plumbing) may
--     legitimately produce NO_INVOICE_LINKED rows.
--
-- Source:
--   Exact SQL from May 1 2026 audit.
--
-- May 1 2026 audit baseline (production tenant):
--   13 completed jobs total
--   8 OK_PAID
--   4 OTHER (voided $0-balance — legitimate)
--   1 COMPLETED_BUT_OPEN_INVOICE — E2E test data, not a real finding
--   0 production-grade legacy data repair candidates
--
-- Replace <TENANT_UUID> with the target tenant before running.
-- =============================================================================

-- Detect completed jobs whose linked invoice is NOT paid/partial.
-- Per dispatch-gate rule, completed jobs SHOULD have paid/partial invoices.
-- (legacy jobs without chain links can be exceptions, but worth surfacing)
--
-- Read-only. No DB writes.
-- Replace the tenant UUID below with the target tenant before running.

WITH tenant AS (SELECT '<TENANT_UUID>'::uuid AS id),

-- Direct invoice→job linkage
direct_link AS (
  SELECT j.id AS job_id, j.status AS job_status,
         j.created_at AS job_created,
         i.id AS invoice_id, i.status AS invoice_status,
         i.total, i.amount_paid, i.balance_due,
         j.customer_id
  FROM jobs j
  LEFT JOIN invoices i ON i.job_id = j.id AND i.tenant_id = j.tenant_id
  WHERE j.tenant_id = (SELECT id FROM tenant)
    AND j.status = 'completed'
),

-- Chain-based linkage fallback (rental_chain_id → invoice via task_chain_links)
chain_link AS (
  SELECT j.id AS job_id,
         (SELECT i.id FROM invoices i
          INNER JOIN task_chain_links tcl ON tcl.rental_chain_id = i.rental_chain_id
          WHERE tcl.job_id = j.id AND i.tenant_id = j.tenant_id
          ORDER BY i.created_at DESC LIMIT 1) AS chain_inv_id,
         (SELECT i.status FROM invoices i
          INNER JOIN task_chain_links tcl ON tcl.rental_chain_id = i.rental_chain_id
          WHERE tcl.job_id = j.id AND i.tenant_id = j.tenant_id
          ORDER BY i.created_at DESC LIMIT 1) AS chain_inv_status,
         (SELECT i.balance_due FROM invoices i
          INNER JOIN task_chain_links tcl ON tcl.rental_chain_id = i.rental_chain_id
          WHERE tcl.job_id = j.id AND i.tenant_id = j.tenant_id
          ORDER BY i.created_at DESC LIMIT 1) AS chain_inv_balance
  FROM jobs j
  WHERE j.tenant_id = (SELECT id FROM tenant)
    AND j.status = 'completed'
)

SELECT
  d.job_id::text AS job_id,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), ''), cu.company_name, '(no customer)') AS customer,
  d.invoice_id::text AS direct_inv,
  d.invoice_status AS direct_status,
  d.balance_due AS direct_balance,
  c.chain_inv_id::text AS chain_inv,
  c.chain_inv_status AS chain_status,
  c.chain_inv_balance AS chain_balance,
  CASE
    WHEN d.invoice_id IS NULL AND c.chain_inv_id IS NULL THEN 'NO_INVOICE_LINKED'
    WHEN d.invoice_status IN ('paid','partial') OR c.chain_inv_status IN ('paid','partial') THEN 'OK_PAID'
    WHEN d.invoice_status = 'voided' AND c.chain_inv_id IS NULL THEN 'VOIDED_ONLY'
    WHEN d.invoice_status = 'open' OR c.chain_inv_status = 'open' THEN 'COMPLETED_BUT_OPEN_INVOICE'
    ELSE 'OTHER'
  END AS classification
FROM direct_link d
LEFT JOIN chain_link c ON c.job_id = d.job_id
LEFT JOIN customers cu ON cu.id = d.customer_id AND cu.tenant_id = (SELECT id FROM tenant)
ORDER BY classification, d.job_id;
