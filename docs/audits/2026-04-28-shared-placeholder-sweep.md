# Shared Placeholder Sweep — `:tenantId` and `:userId`

**Date:** 2026-04-28
**Triggered by:** Phase 0 audit verdict on Sentry issue 7444816000 — root cause was a shared `:tenantId` placeholder in `quotes.controller.ts:589` across mixed-type columns.
**Scope:** `api/src/`, raw subqueries inside `QueryBuilder.where()/andWhere()/having()/orWhere()` that share a `:tenantId` (or aliases like `:tid`) or `:userId` placeholder with the outer query.

## Reference: DB-side type drift

### `tenant_id` column types
- **varchar (9 tables — drift):** `ai_suggestion_log`, `delivery_zones`, `dump_tickets`, `pricing_templates`, `quotes`, `tenant_settings`, `tenant_setup_checklist`, `time_entries`, `yards`
- **uuid:** all other tables that have `tenant_id`

### `user_id` column types
- **varchar (2 tables — drift):** `ai_suggestion_log`, `time_entries`
- **uuid:** all other tables that have `user_id`

A site is a BUG when one generated SQL statement reuses a single placeholder across columns of different families (varchar vs uuid) such that PG cannot infer one parameter type that satisfies both.

## Methodology

1. Initial candidate set: any file under `api/src/` containing `createQueryBuilder|getRepository`, `SELECT`, AND any of `:tenantId|:tid|:tenant_id|:tnt|:tenantID|:userId`.
2. Per-file inspection: read the QB chain plus the literal subquery string. For each shared placeholder, classify the outer column's DB type and each subquery column's DB type.
3. Pre-classification check (per the audit rules): same SQL statement vs separate executions. Bug class only applies when one placeholder is reused inside a single generated statement; reuse across separate `query()` calls or separate QB chains is SAFE regardless of column types.
4. Calibration: confirm the known bug at `quotes.controller.ts:589` surfaces from this method. (It does.)
5. Reverse-direction sanity check: searched for `FROM <varchar-tenant-table>` references inside QB strings on uuid-tenant outer entities. None outside the same-direction findings already captured.

## Calibration row

```
SITE: api/src/modules/quotes/quotes.controller.ts:589
  Outer entity (QB main table): Quote (table: quotes)
  Outer column: tenant_id (DB type: varchar)
  Subquery table: customers
  Subquery column: tenant_id (DB type: uuid)
  Shared placeholder: :tenantId
  Verdict: BUG
  Reason: PG cannot infer one bind type for :tenantId across varchar (quotes) and uuid (customers) columns in a single statement; same parameter is also tied to customers.id (uuid) → :customerId conflict in the same subquery
```

The methodology surfaces this site naturally via Step 1's grep (it is the only site where `SELECT…FROM…:tenantId` lands on a single line, and it appears in the union grep across multi-line patterns too).

---

## Per-site inventory

### BUG verdicts

```
SITE: api/src/modules/quotes/quotes.controller.ts:589 (calibration)
  Outer entity: Quote (table: quotes)
  Outer column: q.tenant_id (DB type: varchar)
  Subquery table: customers
  Subquery columns: customers.tenant_id (uuid), customers.id (uuid via :customerId)
  Shared placeholders: :tenantId, :customerId
  Verdict: BUG
  Reason: shared :tenantId across varchar (quotes) + uuid (customers); shared :customerId across uuid (q.customer_id) + uuid (customers.id) is fine in isolation but coexists with the broken :tenantId in the same statement.
```

```
SITE: api/src/modules/reporting/reporting.service.ts:338 (in getDumpCosts → totals)
  Outer entity: DumpTicket (table: dump_tickets)
  Outer column: t.tenant_id (DB type: varchar)
  Subquery tables: jobs, customers (nested EXISTS)
  Subquery columns: jobs.tenant_id (uuid), customers.tenant_id (uuid)
  Shared placeholder: :tid
  Helper: const twoHopDemoExclusion (defined at reporting.service.ts:319-330)
  Verdict: BUG
  Reason: :tid is bound for outer t.tenant_id (varchar) AND inline NOT EXISTS subqueries against jobs/customers (uuid). Same statement, single placeholder, mixed types.
```

```
SITE: api/src/modules/reporting/reporting.service.ts:353 (in getDumpCosts → byFacility)
  Outer entity: DumpTicket (table: dump_tickets)
  Outer column: t.tenant_id (DB type: varchar)
  Subquery tables: jobs, customers (nested EXISTS)
  Subquery columns: jobs.tenant_id (uuid), customers.tenant_id (uuid)
  Shared placeholder: :tid
  Helper: same twoHopDemoExclusion as above
  Verdict: BUG
  Reason: same pattern as :338. Distinct generated statement, same defect.
```

```
SITE: api/src/modules/reporting/reporting.service.ts:371 (in getDumpCosts → byWasteType)
  Outer entity: DumpTicket (table: dump_tickets)
  Outer column: t.tenant_id (DB type: varchar)
  Subquery tables: jobs, customers (nested EXISTS)
  Subquery columns: jobs.tenant_id (uuid), customers.tenant_id (uuid)
  Shared placeholder: :tid
  Helper: same twoHopDemoExclusion as above
  Verdict: BUG
  Reason: same pattern as :338. Third distinct generated statement, same defect.
```

### SAFE verdicts (with reason)

```
SITE: api/src/modules/assets/assets.service.ts:444-468 (findAvailable)
  Outer: assets (uuid tenant_id)
  Subquery: jobs (uuid tenant_id) — joined column-to-column via j.tenant_id = a.tenant_id, no shared placeholder
  Verdict: SAFE — no shared placeholder; subquery uses column reference, not :tenantId.

SITE: api/src/modules/billing/billing.service.ts:363-378 (asset-rebind path)
  Outer: assets (uuid)
  Subquery: jobs (uuid) — j.tenant_id = a.tenant_id (column-to-column)
  Verdict: SAFE — same as above.

SITE: api/src/modules/billing/services/billing-audit.service.ts:498-604 (buildBulkCleanupPredicate, all 4 EXISTS clauses)
  Outer: billing_issues (uuid)
  Subquery tables: invoices (uuid), jobs (uuid)
  Joined column-to-column via inv.tenant_id = bi.tenant_id, j.tenant_id = bi.tenant_id
  Verdict: SAFE — no shared placeholder; column-to-column joins; all sides uuid.

SITE: api/src/modules/customers/customers.service.ts:105-117 (applyRollupSelects)
  Outer: customers (uuid)
  Subquery tables: jobs (uuid), invoices (uuid)
  Joined column-to-column via j.tenant_id = c.tenant_id, i.tenant_id = c.tenant_id
  Verdict: SAFE — column-to-column; all uuid.

SITE: api/src/modules/dispatch/dispatch-credit-enforcement.service.ts:440-457 (chainOnlyMatch)
  Outer: invoices (uuid), with .where('inv.tenant_id = :tenantId')
  Subquery: task_chain_links (uuid) — uses :jobId only, not :tenantId
  Verdict: SAFE — :tenantId is not shared into the subquery; :jobId is only in the subquery. No collision.

SITE: api/src/modules/jobs/jobs.service.ts:2778-2796 (asset-conflict scan)
  Outer: jobs (uuid)
  Subquery: task_chain_links (uuid) — uses :currentChainId only
  Verdict: SAFE — :tenantId not shared into subquery.

SITE: api/src/modules/public/public.service.ts:201-219 (asset availability for booking)
  Outer: assets (uuid)
  Subquery: jobs (uuid) — :tid IS shared, j.tenant_id = :tid AND a.tenant_id = :tid
  Verdict: SAFE — both sides uuid; no type conflict.

SITE: api/src/modules/reporting/reporting.service.ts:91, 128, 665, 685
  Helper: excludeDemoByCustomerIdNamed('i.customer_id', 'tid')
  Outer: invoices (uuid), .where('i.tenant_id = :tid')
  Subquery: customers (uuid)
  Verdict: SAFE — :tid is shared but both sides uuid; no type conflict.

SITE: api/src/modules/reporting/reporting.service.ts:232, 245, 276, 303, 601, 607, 615, 633, 694, 1167
  Helper: excludeDemoCustomers('<alias>') — emits NOT (alias.tags @> ...). No tenant_id placeholder reference at all.
  Verdict: SAFE — helper does not reference tenant_id; no shared placeholder concern.

SITE: api/src/modules/alerts/services/alert-detector.service.ts:258, 300, 348, 535-598
  Detectors with QB and additional dataSource.query() calls; each .query() is a separate execution.
  Verdict: SAFE under the strict QB scope; the dataSource.query() executions have a related concern flagged in Other findings below.

SITE: api/src/modules/billing/services/booking-completion.service.ts:147
  Single QB with .where('j.tenant_id = :tenantId'); no inline subquery referencing :tenantId.
  Verdict: SAFE.

SITE: api/src/modules/customers/services/customer-credit.service.ts:361
  QB on invoices (uuid) with no inline subquery referencing :tenantId.
  Verdict: SAFE.

SITE: api/src/modules/dump-locations/dump-locations.service.ts:475-480
  Update QB; no SELECT subquery.
  Verdict: SAFE.

SITE: api/src/modules/team/team.controller.ts:99, 415
  Group-by aggregation on time_entries (varchar) and a separate QB on jobs (uuid). No inline subqueries; placeholders not shared across the QBs (each QB is its own statement).
  Verdict: SAFE — separate executions.

SITE: api/src/modules/automation/automation.service.ts:63, 378, 518, 533
  Raw dataSource.query() calls with positional $1; each is a single statement on tenant_settings or customers. No QB subquery with mixed-type columns.
  Verdict: SAFE within the QB scope. (Positional bind cousins in Other findings.)

SITE: api/src/modules/billing/billing.service.ts:662, .../invoice.service.ts:303, .../orchestration.service.ts:76, .../billing-issue-detector.service.ts:630
  Raw repo.query() calls; each is a separate statement. No QB subquery sharing :tenantId across mixed types.
  Verdict: SAFE.

SITE: api/src/modules/portal/portal.service.ts:150, 287, 328, 690, 706, 996
  All are simple QB .where('… tenant_id = :tenantId') with no inline subqueries referencing the shared placeholder against a different-typed table.
  Verdict: SAFE.
```

### UNCLEAR verdicts

None.

---

## Summary

- Total candidate files scanned: 17 (`:tenantId` set) + 1 (`:tid`-only file already in set) + 0 (`:userId` set is empty)
- Total shared-placeholder QB sites inspected: ~30 across these files
- **BUG verdicts: 4** (one calibration + three new finds in `reporting.service.ts`)
- **SAFE verdicts: ~26** (column-to-column joins; matching uuid types on both sides; placeholder not actually shared into subquery; or separate executions)
- **UNCLEAR verdicts: 0**

The calibration site surfaced cleanly via the methodology, so the sweep is trustable.

---

## Other findings (informational, not in strict QB scope)

These match the same fundamental "one statement, one placeholder, mixed-type columns" defect but use positional `$1` binding via `dataSource.query()` / `repo.query()` instead of named placeholders inside a QueryBuilder. Per the audit's stated scope, they are not in the main BUG inventory, but they will reproduce the same `operator does not exist: uuid = text` error class and warrant a separate fix sweep.

- **`api/src/modules/reporting/reporting.service.ts:422-432`** (`demoExclusion` constant), used at lines **446, 452, 457** in `getDumpSlips`. Outer table `dump_tickets` (varchar `tenant_id`) shares positional `$1` with NOT EXISTS subqueries on `jobs` (uuid) and `customers` (uuid).
- **`api/src/modules/alerts/services/alert-detector.service.ts:412-422`** (`detectAbnormalDisposal`). Outer `dump_tickets` (varchar) joined to `jobs` (uuid) with `dt.tenant_id = $1 AND j.tenant_id = $1` — `$1` shared across mixed types in one statement.

Two unrelated security/correctness flags discovered en passant — log only, not in this audit's scope:

- **`api/src/modules/dispatch/dispatch-credit-enforcement.service.ts:446-450`** — subquery `SELECT tcl.rental_chain_id FROM task_chain_links tcl WHERE tcl.job_id = :jobId` does not filter `tcl.tenant_id`. Cross-tenant leak vector if `task_chain_links` ever serves the same `job_id` across tenants. Separate audit.
- **`api/src/modules/reporting/reporting.service.ts:443`** — `${baseWhere}${extraWhere}` interpolation with a `search` value escaped only via `ILIKE $${paramIdx}` (params used safely), so this one looks OK on second read; flagged here only because the dynamic SQL pattern is fragile to future edits.

---

## Recommended Phase 1 scope

D1-style placeholder rename across all 4 BUG sites in one PR:

1. **`api/src/modules/quotes/quotes.controller.ts:589`** — rename `:tenantId` in the subquery to `:customersTenantId`, pass `{ customersTenantId: tenantId }` alongside existing params.
2. **`api/src/modules/reporting/reporting.service.ts:319-330`** (the shared `twoHopDemoExclusion` constant). Two reasonable shapes:
   - **D1a (preferred):** change the constant to a builder function `twoHopDemoExclusion(jobsTenantParam: string, customersTenantParam: string)` that emits two distinct placeholders, then update each call site (`:338`, `:353`, `:371`) to pass `{ jobsTid: tenantId, customersTid: tenantId }` (or any uniquely named pair).
   - **D1b:** inline a fixed pair of placeholder names inside the constant (e.g. `:jobsTid`, `:customersTid`) and call `setParameters({ jobsTid: tenantId, customersTid: tenantId })` once per QB at the call sites.
   - Either works; D1a is cleaner because the helper function makes the parameter contract explicit at the type level.

**Files for Phase 1 PR:**

```
api/src/modules/quotes/quotes.controller.ts
api/src/modules/reporting/reporting.service.ts
```

**Tests for Phase 1 PR (must be added/updated):**

- A regression test that calls `GET /quotes?customerId=<uuid>` for a tenant whose `quotes.tenant_id` is the varchar shape (fixture or integration). The pre-fix should fail with `operator does not exist: uuid = text`; the post-fix should return 200.
- A regression test that calls `GET /reporting/dump-costs` for a tenant whose `dump_tickets.tenant_id` is the varchar shape. Same pre/post expectation.
- The existing `demo-customers-predicate.spec.ts` covers the helper output shape — extend if D1a is chosen so the new builder signature is locked.

**Out-of-Phase-1 follow-up arcs (separate prompts, not bundled with the placeholder rename):**

- Apply the same fix class to the two `dataSource.query()` sites in *Other findings* (`reporting.service.ts:446/452/457` and `alert-detector.service.ts:412-422`). The mechanical fix is to rename one of the `$1` references to a new positional `$<n>` and add a duplicated value to the params array — but the cleaner long-term fix is **schema migration** to bring `dump_tickets.tenant_id` (and the other 8 varchar tables) to `uuid`. That migration is the original Option A from the Phase 0 audit and remains the preferred end state.
- Cross-tenant leak audit on `task_chain_links` subqueries (`dispatch-credit-enforcement.service.ts:446-450`).

No code, no migration, no commit, no push from this sweep. Awaiting Anthony's go on the Phase 1 fix prompt.
