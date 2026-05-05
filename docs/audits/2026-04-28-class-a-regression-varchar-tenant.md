# Class A Regression Audit — Varchar Tenant Tables

**Date:** 2026-04-28
**Sentry trigger:** issue 7444816000 (`operator does not exist: uuid = text`)
**Endpoint:** `GET /quotes?customerId=…&limit=50` → `quotes.controller.ts:607`
**Tenant:** `822481be-039e-481a-b5c4-21d9e002f16c` (Rent This Dumpster)
**Hypothesis tested:** d519cc3 decorated entity columns as `type: 'uuid'` on tables whose DB column is varchar, causing TypeORM to bind params with the uuid tag and producing `uuid = text` at PG.

---

## Verdict on Q1 — Is the regression caused by `d519cc3`?

**NO. The hypothesis is falsified.**

Evidence:

1. **`d519cc3` did not touch `quote.entity.ts` or `quotes.controller.ts`.**
   `git show --stat d519cc3` lists 29 entity files; `quote.entity.ts` is not among them.
   `git log -- api/src/modules/quotes/quote.entity.ts` confirms no commit on or after `d519cc3` modifies the file. Its last meaningful change was `5a03fe4` (2026-04-06).

2. **None of the 9 varchar-tenant entity files were touched by `d519cc3`** (see Q2 below).
   `git show --name-only d519cc3 | grep -E '(ai-suggestion-log|delivery-zone|dump-ticket|pricing-template|quote\.entity|tenant-settings|setup-checklist|time-entry|yard\.entity)'` → empty.

3. **The only `customers`-related decoration in `d519cc3`** is `Customer.tenant_id` going from `@Column({ name: 'tenant_id' })` → `@Column({ name: 'tenant_id', type: 'uuid' })` (`api/src/modules/customers/entities/customer.entity.ts:17`). The `customers` table's `tenant_id` column is `uuid` in DB (it is **not** in the 9-varchar list), so this aligns the entity with the DB. It does not introduce a uuid/varchar mismatch.

4. **`d519cc3` is a pure decorator update for columns whose DB column is already `uuid`.** Commit message: *"Adds explicit type: 'uuid' to 40 entity columns across 29 files where the DB column is already uuid… Decorator-only, no migration, no runtime impact."* Inspection of the diff confirms the message.

5. **The failing query path predates `d519cc3` by three weeks.** The subquery `(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN (SELECT email FROM customers WHERE id = :customerId AND tenant_id = :tenantId)))` was introduced in `5a03fe4` (2026-04-06) and has not been modified since.

**Conclusion:** `d519cc3` is innocent for this Sentry. It correctly skipped the 9 varchar-tenant tables. The regression source is somewhere else.

A plausible actual root cause (not part of this audit's hypothesis, flagged for follow-up — see "Likely actual root cause" below): the param `:tenantId` is shared between the outer `q.tenant_id` clause (varchar in DB) and the inline subquery `customers.tenant_id` clause (uuid in DB). PostgreSQL cannot resolve a single placeholder against both column types and raises `operator does not exist: uuid = text`. This is latent since `5a03fe4` and fires whenever `customerId` is supplied.

---

## Verdict on Q2 — Which of the 9 varchar-tenant tables had `tenant_id` decorated as `type: 'uuid'`?

**NONE. All 9 entities still declare `tenant_id` without an explicit `type: 'uuid'`.**

| # | Table | Entity file | `tenant_id` decorator (current) | `type: 'uuid'`? | Introduced in |
|---|---|---|---|---|---|
| 1 | `ai_suggestion_log` | `api/src/modules/ai/entities/ai-suggestion-log.entity.ts:13` | `@Column({ name: 'tenant_id' })` | NO | n/a — never decorated as uuid |
| 2 | `delivery_zones` | `api/src/modules/pricing/entities/delivery-zone.entity.ts:8` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 3 | `dump_tickets` | `api/src/modules/dump-locations/entities/dump-ticket.entity.ts:17` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 4 | `pricing_templates` | `api/src/modules/pricing/entities/pricing-template.entity.ts:8` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 5 | `quotes` | `api/src/modules/quotes/quote.entity.ts:8` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 6 | `tenant_settings` | `api/src/modules/tenant-settings/entities/tenant-settings.entity.ts:14` | `@Column({ name: 'tenant_id', unique: true })` | NO | n/a |
| 7 | `tenant_setup_checklist` | `api/src/modules/onboarding/entities/setup-checklist.entity.ts:15` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 8 | `time_entries` | `api/src/modules/team/time-entry.entity.ts:10` | `@Column({ name: 'tenant_id' })` | NO | n/a |
| 9 | `yards` | `api/src/modules/yards/yard.entity.ts:14` | `@Column({ name: 'tenant_id' })` | NO | n/a |

`git log -S "tenant_id', type: 'uuid'" -- <each file>` returns 0 commits for every one of these files. No commit in the repo's history has ever added `type: 'uuid'` to any of these `tenant_id` decorators. The entity decorators correctly reflect the varchar DB columns.

---

## Risk matrix (re-scoped to the actual hypothesis)

Because no varchar-tenant entity is decorated as uuid, the hypothesized regression class has **no surface area** today. The matrix is informational, not load-bearing.

| Table | Entity has `type: 'uuid'`? | QB sites in module | Customer-facing endpoint | Triggered by hypothesis? | Risk |
|---|---|---|---|---|---|
| ai_suggestion_log | NO | none found in `api/src/modules/ai` | n/a | NO | LOW |
| delivery_zones | NO | `pricing/pricing.service.ts:109,344,474`; `pricing/services/price-resolution.service.ts:86`; `pricing/controllers/client-pricing.controller.ts:36` (most are over `client_pricing_overrides`/templates, not `delivery_zones`) | mixed | NO | LOW |
| dump_tickets | NO | `dump-locations/dump-locations.service.ts:476` | internal/ops | NO | LOW |
| pricing_templates | NO | shares pricing module sites above | mixed | NO | LOW |
| quotes | NO | `quotes/quotes.controller.ts:537,566` (the failing site) | YES (customer/staff dashboards) | NO — Sentry is NOT the hypothesized class | LOW for hypothesis; HIGH for actual bug (see below) |
| tenant_settings | NO | `tenant-settings/tenant-settings.service.ts:350` | indirect | NO | LOW |
| tenant_setup_checklist | NO | none found | onboarding | NO | LOW |
| time_entries | NO | `team/team.controller.ts:99,415` | staff-only | NO | LOW |
| yards | NO | none found | n/a | NO | LOW |

---

## Likely next-to-fire endpoints (under the hypothesis)

Re-scoped: **none.** Under the literal hypothesis (varchar DB column + uuid entity decorator), there is no decorated-as-uuid entity to trip on, so no second-shoe is waiting to drop from this class.

The actual Sentry comes from a different bug class (param-type-conflict in a shared placeholder across an outer + inline-subquery) — see below.

---

## Likely actual root cause (out-of-hypothesis, flagged for follow-up)

`api/src/modules/quotes/quotes.controller.ts:566–591`:

```ts
const qb = this.quoteRepo.createQueryBuilder('q')
  .where('q.tenant_id = :tenantId', { tenantId })          // q.tenant_id is varchar (DB) — :tenantId resolves as text/varchar
  .orderBy('q.created_at', 'DESC')
  .take(Number(limit) || 50);
…
if (customerId) {
  qb.andWhere(
    '(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN ' +
    '(SELECT email FROM customers WHERE id = :customerId AND tenant_id = :tenantId)))',
    { customerId, tenantId },
  );
}
```

The same placeholder `:tenantId` is referenced by both:

- outer: `q.tenant_id = :tenantId` — `quotes.tenant_id` is **varchar** (in the 9-list)
- subquery: `customers.tenant_id = :tenantId` — `customers.tenant_id` is **uuid** (not in the 9-list)

PG cannot pick a single inferred type for one placeholder against two columns of different families with no implicit cast → `operator does not exist: uuid = text` from the subquery branch. The bug has been in place since `5a03fe4` (2026-04-06) and only fires when the `customerId` query param is supplied (customer history tab and similar). The temporal coincidence with `d519cc3` (~3 hours earlier today) is not causal — `d519cc3` neither edited this file nor altered any metadata that influences the raw subquery's parameter resolution.

This is a plausible explanation, not a confirmed one. Confirming requires either reproducing the query in a Postgres console with both placeholder substitutions, or enabling TypeORM query logging to see the prepared SQL with bound types. Both are follow-ups, outside this read-only audit.

---

## Remediation options analysis

### Option A — DB migration (the originally proposed remediation)

Re-scoped: **not applicable to this Sentry.** No varchar-tenant entity is decorated as uuid, so altering `tenant_id` from varchar to uuid on the 9 tables does not address this Sentry.

For completeness, if Option A is still desired as a separate cleanup arc to bring the 9 tables into uuid-aligned schema (preferred end state per Anthony):

- Statement template: `ALTER TABLE <table> ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;`
- Pre-flight cast probe (Anthony to run in Supabase): `SELECT COUNT(*) FROM <table> WHERE tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';` (must be 0 for every table before ALTER).
- FK probe: `SELECT * FROM information_schema.constraint_column_usage WHERE table_name = '<table>' AND column_name = 'tenant_id';` — verify FK to `tenants(id)` exists; ALTER will recheck.
- RLS probe: `SELECT polname, polqual FROM pg_policies WHERE tablename = '<table>';` — confirm `tenant_id` references in policies still type-check after the column type change.
- Lock duration: per-table ALTER acquires AccessExclusive for the rewrite; tables vary by row count. Quotes / dump_tickets / time_entries are likely the largest. Run during a maintenance window or use a non-blocking pattern (add new uuid column, backfill, swap).
- Order to pursue: small/cold tables first (`yards`, `tenant_settings`, `tenant_setup_checklist`, `delivery_zones`), hot tables last with care (`quotes`, `dump_tickets`, `time_entries`, `pricing_templates`, `ai_suggestion_log`).

This arc, if undertaken, is a separate effort from fixing the live Sentry.

### Option C — Hybrid (revert decoration + plan migration)

Re-scoped: **not applicable.** There is nothing to revert — none of the 9 entities have `type: 'uuid'` on `tenant_id`. The only related decoration touched today is `Customer.tenant_id`, which correctly aligns the entity with the uuid DB column (and is not in the 9-list).

### Option D — Address the actual Sentry (new, out of original audit scope)

Two narrow, low-risk paths to fix the live Sentry. Both are surgical — no schema changes, no broad refactor.

**D1 — Use a distinct placeholder name in the subquery.**

```ts
qb.andWhere(
  '(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN ' +
  '(SELECT email FROM customers WHERE id = :customerId AND tenant_id = :customersTenantId)))',
  { customerId, customersTenantId: tenantId },
);
```

Each placeholder resolves against exactly one column → PG infers each independently → no conflict. Single-file change, single-line risk.

**D2 — Cast in SQL.**

```ts
qb.andWhere(
  '(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN ' +
  "(SELECT email FROM customers WHERE id = :customerId::uuid AND tenant_id = :tenantId::uuid)))",
  { customerId, tenantId },
);
```

Forces the subquery comparisons to uuid regardless of inferred placeholder type. Slightly less clean than D1 because it concedes the placeholder is text in the outer clause but coerces it in the subquery; if the outer ever gains a uuid context, the cast becomes a no-op.

D1 is cleaner. D2 is more defensive. Either fixes the Sentry without touching schema or other entities.

---

## Recommended next step

1. **Reject the original hypothesis.** `d519cc3` is not the cause; do not revert it; do not gate it.
2. **Do not run Option A or Option C in response to this Sentry.** Option A as a long-term schema-cleanup arc remains valid but is not the right action now.
3. **Pursue Option D1 (rename the subquery placeholder)** as the minimum surgical fix for `quotes.controller.ts:589`. One-file, one-line edit; no schema risk; preserves all current behavior. Verify by reproducing locally with a customerId pinned to a tenant in the 9-varchar list before approving.
4. **Audit the codebase for the same `:tenantId`-shared-across-entities pattern** before marking this remediation complete. The same pattern likely exists elsewhere; one Sentry today is the canary, not the only instance. (This audit step is a separate, time-boxed read-only sweep.)

No code, no migration, no commit, no push from this audit. Awaiting Anthony's call on D1 (or alternative).
