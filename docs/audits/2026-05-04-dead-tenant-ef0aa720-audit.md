---
arc: arcK
phase: 0
date: 2026-05-04
target: tenant prefix `ef0aa720`
project: ServiceOS (Supabase project voczrzbdukgdrirmlgfw)
branch: main @ 696b960080fff870e235f81f53926d794d300a67
verdict: **D — DO NOT DELETE (TARGET DOES NOT EXIST)**
writes_performed: none
---

# arcK — Phase 0 audit: tenant prefix `ef0aa720`

## Summary

The tenant identified by UUID prefix `ef0aa720` **does not exist** in the production
Supabase database. The DB currently holds **exactly one** tenant, and it is the live
"Rent This Dumpster" tenant. There is no dead/duplicate tenant to clean up.

Verdict: **D — DO NOT DELETE.** Not because the tenant is risky to delete, but because
there is nothing to delete. No Phase 1 is required or authorized.

## 1. Repo state

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD | `696b960080fff870e235f81f53926d794d300a67` |
| Tracked changes | none |
| Untracked | `.claude/worktrees/`, prior arc audit reports/deliverables, `docs/audits/2026-04-28-*.md` (pre-existing) |

No tracked-file modifications. Working tree clean for the purpose of this audit.

## 2. Target tenant identity

```sql
SELECT id, name, slug, is_active, onboarding_status, created_at, updated_at
FROM public.tenants
WHERE id::text LIKE 'ef0aa720%';
-- → 0 rows
```

**No tenant matches the prefix `ef0aa720` in `public.tenants`.**

## 3. All tenants for comparison

```sql
SELECT id, name, slug, created_at, updated_at FROM public.tenants ORDER BY created_at;
```

| id | name | slug | created_at | updated_at |
|---|---|---|---|---|
| `822481be-039e-481a-b5c4-21d9e002f16c` | Rent This Dumpster | `rent-this-dumpster-mnbxs4jm` | 2026-03-29 15:51:11 | 2026-04-03 02:51:20 |

**Total tenant count: 1.** No duplicate, no seed/test tenant, no soft-deleted tenant
(the schema does not have a `deleted_at` column on `tenants`; `is_active` is the only
disable knob, and the single live tenant uses it). The prefix `ef0aa720` is not even
close to the live tenant's `822481be` prefix.

## 4. Inventory of tenant-scoped tables

48 public tables carry a `tenant_id` column. A single dynamic UNION sweep counted rows
where `tenant_id::text LIKE 'ef0aa720%'` for each of them:

```sql
DO $$
DECLARE r record; q text := '';
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id' ORDER BY table_name
  LOOP
    q := q || format(
      'SELECT %L AS tbl, count(*) AS hits FROM public.%I WHERE tenant_id::text LIKE ''ef0aa720%%'' UNION ALL ',
      r.table_name, r.table_name);
  END LOOP;
  q := left(q, length(q) - length(' UNION ALL '));
  EXECUTE 'CREATE TEMP TABLE _sweep AS ' || q;
END $$;
SELECT tbl, hits FROM _sweep WHERE hits > 0 ORDER BY hits DESC, tbl;
-- → 0 rows
```

**Result: zero rows in every one of the 48 tables.** No orphaned tenant_id references.

Tables swept (all returned 0 hits): `ai_suggestion_log`, `alerts`, `assets`,
`billing_issues`, `client_notification_overrides`, `client_pricing_overrides`,
`client_surcharge_overrides`, `credit_audit_events`, `credit_collection_events`,
`credit_memos`, `customer_notes`, `customers`, `delivery_zones`, `driver_tasks`,
`dump_locations`, `dump_tickets`, `help_analytics_events`, `invoices`, `job_costs`,
`job_pricing_audit`, `jobs`, `marketplace_bookings`, `marketplace_integrations`,
`notification_preferences`, `notifications`, `orchestration_results`,
`password_reset_tokens`, `payments`, `pricing_rules`, `pricing_snapshots`,
`pricing_templates`, `quotes`, `rental_chains`, `routes`, `scheduled_notifications`,
`sms_messages`, `sms_number_release_requests`, `sms_opt_outs`, `stripe_events`,
`surcharge_templates`, `tenant_fees`, `tenant_settings`, `tenant_setup_checklist`,
`terms_templates`, `time_entries`, `user_audit_log`, `users`, `yards`.

### Existence of high-risk tables called out by the audit prompt

| Prompt-listed table | Exists? | Has `tenant_id`? | Notes |
|---|---|---|---|
| `jobs` | yes | yes | swept, 0 hits |
| `invoices` | yes | yes | swept, 0 hits |
| `invoice_line_items` | yes | **no** | tenant-scoped indirectly via `invoice_id` |
| `payments` | yes | yes | swept, 0 hits |
| `credit_memos` | yes | yes | swept, 0 hits |
| `customers` | yes | yes | swept, 0 hits |
| `quotes` | yes | yes | swept, 0 hits |
| `marketplace_bookings` | yes | yes | swept, 0 hits |
| `assets` | yes | yes | swept, 0 hits |
| `rental_chains` | yes | yes | swept, 0 hits |
| `task_chain_links` | yes | **no** | tenant-scoped indirectly |
| `notifications` | yes | yes | swept, 0 hits |
| `users` | yes | yes | swept, 0 hits |
| `tenant_users` / `memberships` | **does not exist** | n/a | auth model uses `users.tenant_id` directly |
| `tenant_settings` | yes | yes | swept, 0 hits |
| `tenant_label_overrides` | **does not exist** | n/a | not part of current schema |
| `rentals` | **does not exist** | n/a | rental data lives in `rental_chains` |

Because `invoice_line_items` and `task_chain_links` lack a direct `tenant_id`, they were
not in the sweep — but they would only be at risk if a tenant-scoped parent row existed,
which it does not.

## 5. FK reference matrix → `tenants.id`

31 foreign keys reference `public.tenants.id`. ON DELETE behavior:

| ON DELETE | Count | Tables |
|---|---|---|
| `NO ACTION` (block delete) | 28 | `assets`, `billing_issues`, `client_notification_overrides`, `client_pricing_overrides`, `client_surcharge_overrides`, `credit_memos`, `customer_notes`, `customers`, `driver_tasks`, `dump_locations`, `invoices`, `job_costs`, `job_pricing_audit`, `jobs`, `marketplace_bookings`, `notification_preferences`, `notifications`, `payments`, `pricing_rules`, `pricing_snapshots`, `rental_chains`, `routes`, `scheduled_notifications`, `surcharge_templates`, `tenant_fees`, `terms_templates`, `users` |
| `CASCADE` | 3 | `marketplace_integrations`, `password_reset_tokens`, `stripe_events` |

Notable: 17 tables carry a `tenant_id` column **without** an FK to `tenants.id`
(`ai_suggestion_log`, `alerts`, `credit_audit_events`, `credit_collection_events`,
`delivery_zones`, `dump_tickets`, `help_analytics_events`, `orchestration_results`,
`pricing_templates`, `quotes`, `sms_messages`, `sms_number_release_requests`,
`sms_opt_outs`, `tenant_settings`, `tenant_setup_checklist`, `time_entries`,
`user_audit_log`, `yards`). They were still included in the sweep; all returned 0.
This FK-coverage gap is **not a target of this arc** but is documented for a future
hygiene pass.

## 6. Auth / user / membership linkage

```sql
SELECT 'auth.users.id' AS where_, count(*) FROM auth.users WHERE id::text LIKE 'ef0aa720%'
UNION ALL
SELECT 'auth.identities.user_id', count(*) FROM auth.identities WHERE user_id::text LIKE 'ef0aa720%';
-- → 0, 0
```

`public.users` (which carries `tenant_id`) was already covered by the tenant_id sweep — 0 hits.
There is no `tenant_users` / `memberships` table in this schema; tenant ↔ user is a
direct `users.tenant_id` FK.

No auth orphaning risk because there is nothing to delete.

## 7. Wide UUID prefix sweep

To rule out the possibility that `ef0aa720` was a different kind of id the user was
remembering (a customer id, a job id, an auth user id, etc.), every uuid-typed column
in the public schema was scanned for that prefix:

```sql
DO $$
DECLARE r record; cnt int;
BEGIN
  CREATE TEMP TABLE _wide_sweep(tbl text, col text, hits int);
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type='uuid'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text LIKE ''ef0aa720%%''',
                   r.table_name, r.column_name) INTO cnt;
    IF cnt > 0 THEN INSERT INTO _wide_sweep VALUES (r.table_name, r.column_name, cnt); END IF;
  END LOOP;
END $$;
SELECT * FROM _wide_sweep;
-- → 0 rows
```

**No uuid value beginning with `ef0aa720` exists anywhere in the public schema.**
Repo-wide grep across `*.md *.ts *.tsx *.sql *.json` also found zero hits.

## 8. Production-data scale (context)

For perspective on what *does* live under the only tenant `822481be-...`:

| Table | Rows |
|---|---|
| tenants | 1 |
| users | 6 |
| customers | 12 |
| jobs | 38 |
| invoices | 21 |
| payments | 12 |
| quotes | 8 |
| assets | 50 |

This is consistent with a small live production tenant, not a seeded test tenant.
None of these rows are at risk in this audit because none belong to `ef0aa720`.

## 9. Risk findings

| Risk class | Finding |
|---|---|
| Financial (invoices/payments/credit_memos) | None — 0 rows for prefix |
| Job/customer/asset/marketplace | None — 0 rows for prefix |
| Auth / user orphaning | None — 0 rows for prefix |
| FK cascade surprises | N/A — no parent row to cascade from |
| Hidden orphan rows in tenant_id-but-no-FK tables | None — sweep still returned 0 |
| Production write history collision | None — no rows |

## 10. Verdict

**D — DO NOT DELETE.**

Not because the tenant is risky to delete, but because the tenant **does not exist**:

- 0 rows in `public.tenants` matching `ef0aa720%`.
- 0 rows in any of the 48 tenant_id-bearing tables.
- 0 rows in any uuid-typed column in the public schema.
- 0 hits in `auth.users` / `auth.identities`.
- 0 hits in repo source.

No `DELETE` is possible because there is no row to target, and no `WHERE tenant_id LIKE 'ef0aa720%'`
cleanup is possible because no orphan rows exist either.

## 11. Phase 1 SQL

**Not applicable.** Verdict is D, not A or B. No Phase 1 SQL is produced.
Per the audit charter ("Exact SQL for Phase 1 only if verdict is A or B"), this report
intentionally contains no migration, no `DELETE`, and no Supabase write.

## 12. Rollback considerations

**Not applicable.** No write was performed, so there is nothing to roll back.

## 13. Recommendation

Two reasonable next moves, neither involving DB writes:

1. **Close this arc as a no-op.** Either the prefix was remembered from a prior
   environment (local dev DB, a pre-launch reset, an old backup), or it was a
   transcription slip. The live production DB is already clean — exactly one tenant,
   the right one.

2. **If you actually meant a different prefix** (e.g. a real duplicate you spotted in
   logs, a Stripe customer id, an auth user uuid, etc.), share the exact value or the
   surface where you saw it and I will rerun Phase 0 against the corrected target.

No further action recommended on the current target.

## 14. Compliance with audit charter

- [x] No code changes
- [x] No DB writes (every `execute_sql` call was `SELECT`/read-only `DO` block creating temp tables)
- [x] No commit
- [x] No push
- [x] No migration written
- [x] Verdict produced (D)
- [x] FK matrix mapped
- [x] Tenant-scoped tables fully inventoried
- [x] Auth linkage checked
- [x] Stopped at Phase 0
