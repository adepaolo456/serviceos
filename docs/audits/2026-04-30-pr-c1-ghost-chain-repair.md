# PR-C1 Ghost-Active Chain Repair — 2026-04-30

## Context

Six ghost-active rental chains were identified during the PR-C audit (see
`docs/audits/2026-04-30-pr-c-audit-final.md`, merged as PR #13 commit `d14e445`).
Root cause: `cancelJobWithFinancials` never calls `autoCloseChainIfTerminal`, and
`autoCloseChainIfTerminal` itself only handles the all-cancelled shape
(`completedJobs === 0`), so partial-completion chains (completed delivery + cancelled
pickup) had no path to close. All 6 chains were created from smoke-test seed data on
2026-04-23 and remained stuck at `status = 'active'` since.

Repair decision: set all 6 to `status = 'completed'`. Delivery completed, pickup
terminal, no further activity possible. Partial-completion enum semantics
(`'partially_completed'`) deferred to a CLAUDE.md follow-up in Prompt B.

---

## Pre-state

### Chain rows

| chain_id | status | tenant_id | customer_id | asset_id | created_at | updated_at |
|---|---|---|---|---|---|---|
| `4addaab3-6efd-4195-986a-2b1577b24ce5` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `a403c4b1` | `676be314` | 2026-04-23 19:43:20 | 2026-04-24 12:32:41 |
| `6f7a9690-c78e-423d-85b2-09df651e31c8` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `79304cb1` | `a7ca9f12` | 2026-04-23 19:43:20 | 2026-04-23 19:43:20 |
| `3c86d590-09aa-4fe6-9f7f-e87269067577` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `c3444e39` | `57ed1377` | 2026-04-23 19:43:20 | 2026-04-25 11:45:52 |
| `2e8b2eaf-81d9-4ec3-93d8-c471def73b13` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `1b229e0c` | `c9e5b01a` | 2026-04-23 19:43:20 | 2026-04-23 19:43:20 |
| `7d4ec706-a0d6-4d83-9b5b-a653191daff0` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `c3444e39` | `4fc69b46` | 2026-04-23 19:43:20 | 2026-04-23 19:43:20 |
| `cd3a9352-c89b-4ef4-b4f3-dba762c9b8d9` | active | `822481be-039e-481a-b5c4-21d9e002f16c` | `a2d86935` | `c1c93f50` | 2026-04-23 19:43:20 | 2026-04-23 19:43:20 |

### Linked jobs (task_chain_links → jobs)

| rental_chain_id | seq | job_id | status | job_type | scheduled_date | completed_at | cancelled_at | cancellation_reason |
|---|---|---|---|---|---|---|---|---|
| `2e8b2eaf` | 1 | `4afdf399` | completed | delivery | 2026-04-05 | 2026-04-05 14:00 UTC | — | — |
| `2e8b2eaf` | 2 | `b6145114` | cancelled | pickup | 2026-04-19 | — | 2026-04-25 20:15 UTC | Smoke #3 — keep_paid no financial action |
| `3c86d590` | 1 | `66c6a5fc` | completed | delivery | 2026-04-03 | 2026-04-03 14:00 UTC | — | — |
| `3c86d590` | 2 | `6165bbae` | cancelled | pickup | 2026-04-25 | — | 2026-04-25 19:40 UTC | Smoke #2 |
| `4addaab3` | 1 | `8f15c9df` | completed | delivery | 2026-04-09 | 2026-04-09 14:00 UTC | — | — |
| `4addaab3` | 2 | `3d24ab96` | cancelled | pickup | 2026-04-24 | — | 2026-04-25 03:46 UTC | test smoke |
| `6f7a9690` | 1 | `e05c3498` | completed | delivery | 2026-04-15 | 2026-04-15 14:00 UTC | — | — |
| `6f7a9690` | 2 | `ea8eb295` | cancelled | pickup | 2026-04-29 | — | 2026-04-25 15:33 UTC | Smoke #4 retry — void unpaid post constraint fix |
| `7d4ec706` | 1 | `066c45fd` | completed | delivery | 2026-04-11 | 2026-04-11 14:00 UTC | — | — |
| `7d4ec706` | 2 | `5550adaf` | cancelled | pickup | 2026-04-25 | — | 2026-04-25 20:08 UTC | Smoke #1' — refund_paid no-PI manual_required |
| `cd3a9352` | 1 | `0eac0892` | completed | delivery | 2026-04-08 | 2026-04-08 14:00 UTC | — | — |
| `cd3a9352` | 2 | `cf3f2bc9` | cancelled | pickup | 2026-04-22 | — | 2026-04-25 20:21 UTC | Smoke #5 — Dispatch QuickView entry point |

### Invoice sanity (non-voided only)

| invoice_id | invoice_number | status | balance_due | created_at |
|---|---|---|---|---|
| `f7cbff10-5474-4421-8f98-677cf89d3fa0` | 1002 | paid | 0.00 | 2026-04-23 19:55:55 |
| `9bab65e3-f360-4ffd-bf8a-f5d65cd1017f` | 1005 | paid | 0.00 | 2026-04-23 19:55:55 |

4 of 6 chains had no non-voided invoices (consistent with smoke-test scaffolding).
Both present invoices are `paid` with `balance_due = 0.00`. No open billing coupling.

### Customer sanity

| chain_id | customer_id | name | is_active |
|---|---|---|---|
| `2e8b2eaf` | `1b229e0c` | David Kim | true |
| `3c86d590` | `c3444e39` | Maria Santos | true |
| `4addaab3` | `a403c4b1` | Karen O'Brien | true |
| `6f7a9690` | `79304cb1` | Anthony DePaolo | true |
| `7d4ec706` | `c3444e39` | Maria Santos | true |
| `cd3a9352` | `a2d86935` | Robert Patel | true |

5 distinct customers, all `is_active = true`. Maria Santos owns 2 chains. All are
seed/smoke-test customers. No production end-users affected.

---

## SQL applied

```sql
UPDATE rental_chains
SET
  status = 'completed',
  updated_at = NOW()
WHERE id IN (
  '7d4ec706-a0d6-4d83-9b5b-a653191daff0',
  '6f7a9690-c78e-423d-85b2-09df651e31c8',
  '2e8b2eaf-81d9-4ec3-93d8-c471def73b13',
  'cd3a9352-c89b-4ef4-b4f3-dba762c9b8d9',
  '4addaab3-6efd-4195-986a-2b1577b24ce5',
  '3c86d590-09aa-4fe6-9f7f-e87269067577'
)
  AND tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'active';
```

---

## Post-state

| id | status | updated_at |
|---|---|---|
| `2e8b2eaf-81d9-4ec3-93d8-c471def73b13` | completed | 2026-04-30 14:05:46.059686 UTC |
| `3c86d590-09aa-4fe6-9f7f-e87269067577` | completed | 2026-04-30 14:05:46.059686 UTC |
| `4addaab3-6efd-4195-986a-2b1577b24ce5` | completed | 2026-04-30 14:05:46.059686 UTC |
| `6f7a9690-c78e-423d-85b2-09df651e31c8` | completed | 2026-04-30 14:05:46.059686 UTC |
| `7d4ec706-a0d6-4d83-9b5b-a653191daff0` | completed | 2026-04-30 14:05:46.059686 UTC |
| `cd3a9352-c89b-4ef4-b4f3-dba762c9b8d9` | completed | 2026-04-30 14:05:46.059686 UTC |

All 6 rows updated. Identical `updated_at` timestamp confirms single atomic execution.

---

## Verification

- Ghost-chain query post-repair row count: **0**
- Timestamp (UTC): `2026-04-30 14:05:46`

---

## Rollback recipe

For the record only — do not run unless reverting this repair.

```sql
UPDATE rental_chains
SET status = 'active', updated_at = NOW()
WHERE id IN (
  '7d4ec706-a0d6-4d83-9b5b-a653191daff0',
  '6f7a9690-c78e-423d-85b2-09df651e31c8',
  '2e8b2eaf-81d9-4ec3-93d8-c471def73b13',
  'cd3a9352-c89b-4ef4-b4f3-dba762c9b8d9',
  '4addaab3-6efd-4195-986a-2b1577b24ce5',
  '3c86d590-09aa-4fe6-9f7f-e87269067577'
)
  AND tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c';
```

---

## Notes

- Operator: Anthony DePaolo
- Tenant: `822481be-039e-481a-b5c4-21d9e002f16c` (Rent This Dumpster)
- Chain shape: completed delivery (seq 1) + cancelled pickup (seq 2) — uniform across all 6
- All chains are smoke-test seed data (created 2026-04-23, cancellation reasons reference
  explicit smoke labels: Smoke #1–#5, "test smoke")
- No production customer data affected
- Invoice state was clean before repair: 2 paid invoices at $0 balance, 4 chains with no
  active invoice
- Schema notes discovered during audit: `task_chain_links` uses `sequence_number` (not
  `sequence`); `invoices` uses `status` (not `invoice_status`) and has a direct
  `rental_chain_id` FK; `customers` has no `is_demo` column (use `is_active`)
- Code-side prevention ships in Prompt B (PR-C1 code changes):
  `cancelJobWithFinancials` → `autoCloseChainIfTerminal` hook,
  partial-completion handling, cancellation lock, Stripe idempotency
- Partial-completion enum semantics (`'partially_completed'`) deferred to CLAUDE.md
  follow-up in Prompt B
- No anomalies observed during Phases 0–4
