# Audit Queries

Read-only, tenant-scoped diagnostic SQL preserved from production audits. These
files are durable artifacts of work already done — keep them in sync with
schema changes, but never use them as cleanup scripts.

> **These are AUDIT queries, not cleanup scripts.** They observe state. They do
> not change state. Adding any `UPDATE` / `DELETE` / `INSERT` / `ALTER` /
> `CREATE` / `DROP` / `TRUNCATE` to any file in this directory is forbidden.

---

## Overview

Each file in this directory captures a single read-only diagnostic that has
been useful in past audits. Files are append-only in spirit: extend with new
classifications when the schema or business rules change, but do not mutate
the original intent of a query.

Two kinds of files live here:

- **Exact** SQL that was actually executed during the named audit (faithful
  reproduction; safe to re-run as-is once the tenant placeholder is filled in).
- **Recommended detector shape** — query intent that matches an audit but was
  reconstructed for reuse rather than copied verbatim. Always verify against
  current schema before relying on results in production.

The header comment block at the top of each `.sql` file declares which
category that file belongs to.

---

## How to run safely

1. Open the Supabase SQL editor for project `voczrzbdukgdrirmlgfw`.
2. Open the audit query file and copy its contents into the editor.
3. Replace every `<TENANT_UUID>` placeholder with the target tenant's UUID
   (production is `Rent This Dumpster` → `822481be-...`).
4. Run the query. Read the results.
5. **Do not modify the SQL.** If a query needs a fix, edit the file in this
   repo via a normal PR — do not silently mutate the editor copy and forget.
6. **Do not add destructive SQL.** If an audit reveals data that needs
   correcting, raise it with the team and write a separate, reviewed
   migration — never bolt an `UPDATE`/`DELETE` onto a file in this directory.

---

## Query list

| File | One-line purpose | Source |
|---|---|---|
| [`legacy-completed-unpaid-invoices.sql`](./legacy-completed-unpaid-invoices.sql) | Surface completed jobs whose linked invoice is not paid/partial. | exact SQL from May 1 2026 audit |
| [`geocoding-coverage-audit.sql`](./geocoding-coverage-audit.sql) | Report geocoding coverage across customer service addresses and job service addresses; distinguish dormant `placement_lat/lng` from missing coords. | exact SQL from May 1 2026 audit |
| [`phantom-paid-detector.sql`](./phantom-paid-detector.sql) | Flag invoices marked paid/partial that are not backed by sufficient payment rows. | recommended detector shape — verify before production use |

---

## Expected clean-state interpretation

### `legacy-completed-unpaid-invoices.sql`

Returns one row per completed job in the tenant. Classifications:

- `OK_PAID` — completed job with paid/partial invoice via direct or chain link.
- `COMPLETED_BUT_OPEN_INVOICE` — completed but the linked invoice is `open`.
  Investigate; may be a billing gap or test data.
- `VOIDED_ONLY` — direct invoice is `voided` and there is no chain-linked
  alternative. Frequently legitimate (corrections, dogfooding).
- `NO_INVOICE_LINKED` — completed job with no invoice via either path. Legacy
  manual jobs may legitimately fall here.
- `OTHER` — anything that doesn't fit the above; usually voided invoices with
  $0 balance. Frequently legitimate.

**May 1 2026 audit baseline (production tenant):**

- 13 completed jobs total
- 8 `OK_PAID`
- 4 `OTHER` (voided $0-balance — legitimate corrections / dogfooding)
- 1 `COMPLETED_BUT_OPEN_INVOICE` — was E2E test data, not a real legacy issue
- 0 production-grade legacy data repair candidates

A clean run today should look similar; new `COMPLETED_BUT_OPEN_INVOICE` rows
that aren't test data are the real signal.

### `geocoding-coverage-audit.sql`

Returns two rows: one for `customers` (flattened service-address JSONB array)
and one for `jobs` (`service_address` JSONB is canonical). Columns expose
total, null coords, `0,0` coords, "address present but no coords",
"address missing entirely", "coords without `geocoded_at` marker", and "coords
with marker." The `jobs` row also reports `placement_dormant` — null
`placement_lat/lng` count.

**Important:** `jobs.placement_lat` and `jobs.placement_lng` are SEPARATE from
`service_address` geocoding. They are reserved for a future "capture dumpster
placement at delivery" feature and may be permanently null until that ships.
Null `placement_lat/lng` is **not** a missing-geocode signal.

**May 1 2026 audit baseline (production tenant):**

- Jobs: `service_address` JSONB coordinates are the canonical geocoding source.
- 0 unprocessed geocoding candidates.
- 5 of 7 customer addresses lacked `geocoded_at` marker (cosmetic — coordinates
  were correct).
- 34 of 34 jobs had null `placement_lat/lng` (dormant feature, not a backfill
  candidate).

A clean run should report `0` for `addr_present_no_coords`. `coords_no_marker`
counts are cosmetic; `placement_dormant` will continue to equal the job total
until the placement-at-delivery feature ships.

### `phantom-paid-detector.sql`

One row per invoice (excluding the trivial "no money moved" rows).
Classifications:

- `PHANTOM_PAID_NO_PAYMENT_ROWS` — `paid` / `partial` status with `amount_paid > 0`
  and zero linked payment rows. **The original April 29 phantom-paid pattern.**
  Any non-zero count here is a regression and should be investigated immediately.
- `PAID_STATUS_BUT_BALANCE_DUE` — status `paid` but `amount_paid < total` and
  `balance_due > 0`. Indicates `reconcileBalance()` was bypassed.
- `AMOUNT_PAID_EXCEEDS_PAYMENTS` — `amount_paid` exceeds `(sum_payments - sum_refunds)`
  by more than $0.01. Manual stamping or arithmetic drift.
- `AMOUNT_PAID_PAYMENT_SUM_MISMATCH` — paid/partial status with arithmetic
  mismatch beyond rounding tolerance. Looser detector for any drift between
  `amount_paid` and the payment-row ledger.
- `OK` — everything is consistent.

**Background:** April 29 2026 phantom-paid audit found 4 rows where
`seed.controller.ts` direct-set `status='paid'` plus `amount_paid` without
writing matching payment rows. Producer was closed in commit `8Tpwz3D`
(Fix A). This detector exists to catch any future regression of the same
class of producer.

A clean run should return only `OK` rows. Any other classification appearing
in production is a finding.

---

## Reminders

- **Tenant-scoped:** every file embeds a `WITH tenant AS (SELECT '<TENANT_UUID>'::uuid AS id)`
  CTE. Replace `<TENANT_UUID>` before running. Cross-tenant scans are
  intentionally not the default; only remove the filter if you understand the
  blast radius.
- **SELECT-only.** No `UPDATE`, `DELETE`, `INSERT`, `ALTER`, `CREATE`, `DROP`,
  or `TRUNCATE` belongs in any file in this directory. The CI / review bar
  treats their introduction as a blocker.
- **No silent edits.** If you fix a query, fix it in the repo via PR. Don't
  let the editor copy diverge from the file checked in here.
