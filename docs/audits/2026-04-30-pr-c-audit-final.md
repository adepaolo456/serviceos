# PR-C Audit — Surface 2 (cancelJobWithFinancials Race) + Stripe Idempotency

**Date:** 2026-04-30  
**Branch audited:** `main` (HEAD `8821d59`)  
**Auditors:** billing-guardian (primary), serviceos-lifecycle-auditor (cross-check)  
**Overall verdict: NO-GO — 9 blocking items across two auditors**

---

## Scope

This audit covers:
- **Surface 2:** Race condition in `cancelJobWithFinancials` — two concurrent callers both pass the pre-TX status check, both fire Stripe refunds, and both create `credit_memos` rows for the same invoice
- **Stripe idempotency:** All three Stripe mutation call sites have no idempotency keys (`refunds.create`, `paymentIntents.create`)
- **reconcileBalance violations:** Direct invoice status/amount writes in `applyFinancialDecisionTx` and `stripe.service.ts` that bypass the billing SSoT
- **Webhook dedup:** `handleWebhook` creates duplicate `Payment` rows on event replay
- **Rental chain lifecycle impact of the proposed fixes** (lifecycle-auditor cross-check)

Out of scope: PR-B surfaces (already merged as #11), PR-A surface (already merged as #9), frontend flows.

---

## Phase 0 — File inventory

Key files read:

| File | Purpose |
|------|---------|
| `api/src/modules/jobs/jobs.service.ts` | `cancelJobWithFinancials`, `applyFinancialDecisionTx`, `_createInTx` |
| `api/src/modules/stripe/stripe.service.ts` | `chargeInvoice`, `refundInvoice`, `createRefundForPaymentIntent`, `handleWebhook` |
| `api/src/modules/billing/entities/credit-memo.entity.ts` | `CreditMemo` schema |
| `api/src/modules/jobs/entities/job.entity.ts` | `VALID_TRANSITIONS`, status enum |
| `api/src/modules/rental-chains/rental-chains.service.ts` | `autoCloseChainIfTerminal`, `updateChain` |

---

## Phase 1 — cancelJobWithFinancials flow map

**Entry point:** `cancelJobWithFinancials(tenantId, jobId, dto)` — `jobs.service.ts:4542`

**Flow:**
1. `findOne(jobId, tenantId)` — pre-TX read, no lock (line ~4576)
2. Status check: `if (job.status === 'cancelled') throw BadRequestException` (line ~4581) — **TOCTOU gap**
3. `this.dataSource.transaction(async (manager) => { ... })` — TX opens (line ~4701)
4. Inside TX: job status write, invoice void, credit_memo insert
5. TX commits (line ~4799)
6. Post-commit: `this.stripeService.createRefundForPaymentIntent(...)` (line ~4810) — **no idempotency key**
7. Return

**Race window:** Steps 1-3 are non-atomic. Two callers both pass step 2 concurrently. Both open separate transactions. Both void the same invoice and insert a `CreditMemo` row. Both call Stripe post-commit. Result: double refund (real money), two `credit_memos` rows for the same `original_invoice_id`.

---

## Phase 2 — VALID_TRANSITIONS analysis

`VALID_TRANSITIONS` is defined at `jobs.service.ts:135-144`. It is used by `changeStatus` but **NOT** by `cancelJobWithFinancials`. `cancelJobWithFinancials` performs its own ad-hoc status check (line ~4581) that is logically equivalent but not atomic with the subsequent write.

---

## Phase 3 — Stripe call site audit

### 3A. `createRefundForPaymentIntent` — `stripe.service.ts:48`

```typescript
this.stripe.refunds.create({ payment_intent, amount, metadata })
```

No `idempotencyKey`. Stripe processes every call as a new refund.

**Risk:** Double-cancel race fires this twice for the same payment intent → two refund objects created at Stripe → customer refunded twice.

### 3B. `refundInvoice` — `stripe.service.ts:220`

```typescript
this.stripe.refunds.create({ payment_intent, amount, metadata })  // line ~234
// followed by:
invoiceRepo.update(id, { amount_paid: 0, balance_due: 0, status: 'refunded' })  // line ~251
```

Two violations: no idempotency key AND direct `invoiceRepo.update` bypassing `reconcileBalance`.

### 3C. `chargeInvoice` — `stripe.service.ts:144`

```typescript
this.stripe.paymentIntents.create(...)  // line ~166 — no idempotencyKey
// followed by:
invoiceRepo.update(id, { amount_paid, balance_due, status: 'paid' })  // line ~194
```

Two violations: no idempotency key AND direct `invoiceRepo.update` bypassing `reconcileBalance`.

### 3D. `handleWebhook` — `stripe.service.ts:266`

`checkout.session.completed` event handler creates a `Payment` row (line ~288) and updates invoice status (line ~344) with no `stripe_events` dedup table. Stripe's at-least-once delivery guarantee means replay creates a duplicate `Payment` row and double-applies the invoice update.

---

## Phase 4 — reconcileBalance violation map

`reconcileBalance()` is the ONLY authorized writer of `invoice_status / amount_paid / balance_due` (CLAUDE.md billing rule 1).

Direct writes found:

| Location | Fields written directly |
|----------|------------------------|
| `applyFinancialDecisionTx` line ~4330-4333 | `status: 'voided', voided_at, balance_due: 0` |
| `applyFinancialDecisionTx` line ~4391-4394 | `status: 'voided', voided_at, balance_due: 0` |
| `applyFinancialDecisionTx` line ~4434-4437 | `status: 'voided', voided_at, balance_due: 0` |
| `applyFinancialDecisionTx` line ~4443-4446 | `status: 'voided', voided_at, balance_due: 0` |
| `stripe.service.ts chargeInvoice` line ~194 | `amount_paid, balance_due, status: 'paid'` |
| `stripe.service.ts refundInvoice` line ~251 | `amount_paid: 0, balance_due: 0, status: 'refunded'` |
| `stripe.service.ts handleWebhook` line ~288 | (Payment insert) |
| `stripe.service.ts handleWebhook` line ~344 | invoice status update |

Total: 8 direct-write call sites bypassing `reconcileBalance`.

---

## Phase 5 — credit_memos schema gap

`api/src/modules/billing/entities/credit-memo.entity.ts` line 27:

```typescript
@Column({ nullable: true })
original_invoice_id: string;
```

No `@Unique` decorator. No unique index in migrations. The double-cancel race produces two rows with identical `original_invoice_id`. No DB-layer constraint blocks this.

---

## Phase 6 — Proposed fix sketch (for auditor evaluation only)

**Surface 2 (cancelJobWithFinancials):**
- Open TX earlier; acquire pessimistic-write lock on `jobs` row inside TX
- Post-lock status re-check: abort if status already `'cancelled'`
- Add `idempotencyKey: \`refund_${invoiceId}\`` to `stripe.service.ts:createRefundForPaymentIntent`

**credit_memos uniqueness:**
- Add `@Unique(['original_invoice_id'])` to `CreditMemo` entity
- Add corresponding migration
- **Prerequisite:** data cleanup for any existing duplicates before migration runs

**reconcileBalance SSoT restoration:**
- Replace all 8 direct-write call sites with `reconcileBalance()` calls
- `applyFinancialDecisionTx`: replace direct void-writes with `reconcileBalance` inside the same manager-bound TX
- `stripe.service.ts`: replace direct updates with `reconcileBalance` calls post-Stripe response

**Webhook dedup:**
- Add `stripe_events` table with `(event_id TEXT UNIQUE)` 
- `handleWebhook` checks/inserts into `stripe_events` before processing; skip on duplicate

**Stripe idempotency on `chargeInvoice`:**
- `idempotencyKey: \`charge_${invoiceId}\`` on `paymentIntents.create`

**Stripe idempotency on `refundInvoice`:**
- `idempotencyKey: \`refund_invoice_${invoiceId}\`` on `refunds.create`

---

## Phase 7 — PR split recommendation

**PR-C1 (safe, no migration):** Surface 2 race closure + idempotency keys on all Stripe calls  
**PR-C2 (migration required):** `reconcileBalance` SSoT restoration + `credit_memos` uniqueness constraint + webhook dedup table

PR-C2 requires DB migration and data cleanup before deploy; should be a separate PR with its own audit cycle.

---

## Phase 8 — Billing-guardian verdict

**Verdict: BLOCK (7 of 8 items)**

| # | Item | Verdict | Evidence |
|---|------|---------|---------|
| BG-1 | `cancelJobWithFinancials` double-cancel → duplicate Stripe refund | **BLOCK** | Pre-TX TOCTOU; `stripe.service.ts:55` has no idempotency key on `refunds.create` |
| BG-2 | No `@Unique` on `credit_memos(original_invoice_id)` | **BLOCK** | `credit-memo.entity.ts:27` — plain `@Column`, no index |
| BG-3 | `reconcileBalance` violations in `applyFinancialDecisionTx` | **BLOCK** | Direct `invoiceRepo.update` at `jobs.service.ts:4330-4446` (4 call sites) |
| BG-4 | `reconcileBalance` violations in `stripe.service.ts` | **BLOCK** | `chargeInvoice:194`, `refundInvoice:251`, `handleWebhook:288`, `handleWebhook:344` |
| BG-5 | No idempotency key on `refundInvoice` | **BLOCK** | `stripe.service.ts:234` — bare `refunds.create` |
| BG-6 | No idempotency key on `chargeInvoice` | **BLOCK** | `stripe.service.ts:166` — bare `paymentIntents.create` |
| BG-7 | Webhook dedup absent — duplicate Payment rows on replay | **BLOCK** | No `stripe_events` table; `handleWebhook` not idempotent |
| BG-8 | Seed-controller phantom-paid pattern | **PASS** | Pattern intact; no new violation introduced |

---

## Phase 9 — Lifecycle-auditor cross-check

**Verdict: BLOCK (2 of 5 questions)**

### Q1: Rental chain deadlock risk under proposed lock — PASS (with caveat)

`cancelJobWithFinancials` TX locks only `jobs` and billing tables (`invoices`, `credit_memos`, `payments`). It does NOT touch `rental_chains` or `task_chain_links` inside the TX. The only other TX that writes both `jobs` and `rental_chains` is `cascadeDelete._cascadeDeleteInTx` (line ~1726-1961, touches `rental_chains` at lines 1950-1952) and `updateChain` in `rental-chains.service.ts` (touches `rental_chains` then `jobs`). No lock-ordering collision exists because `cancelJobWithFinancials` never acquires a `rental_chains` lock. Caveat: the proposed lock scope covers `jobs` only; the chain-status write happens outside the TX (see Q2).

### Q2: Chain status reflection after cancelJobWithFinancials — **BLOCK**

`cancelJobWithFinancials` sets `job.status = 'cancelled'` and commits at line ~4799, then enters the Stripe loop (lines ~4801-4898) and returns at line ~4900. There is **no call to `autoCloseChainIfTerminal`** anywhere in this function. `changeStatus` (lines 1539-1544) calls `autoCloseChainIfTerminal` after its TX commits whenever `dto.status === 'cancelled'`. `cancelJobWithFinancials` does not. Result: when `cancelJobWithFinancials` cancels the last job in a rental chain, `rental_chains.status` is never updated — the chain becomes ghost-active indefinitely.

**Required fix:** Add post-commit call to `autoCloseChainIfTerminal(tenantId, job.id)` after line ~4799, outside the main TX, mirroring `changeStatus` lines 1539-1544.

### Q3: task_chain_links orphan risk under double-cancel — PASS

`cancelJobWithFinancials` reads one `task_chain_links` row (line ~4593) for invoice resolution but performs no insert/update/delete on `task_chain_links`. A double-cancel race cannot orphan a `task_chain_links` row. The ghost-active-chain issue (Q2) is a `rental_chains.status` problem, not a link-integrity problem.

### Q4: credit_memo uniqueness migration safety — **BLOCK**

Adding `@Unique(['original_invoice_id'])` triggers `CREATE UNIQUE INDEX` on `credit_memos.original_invoice_id`. If the production DB already contains duplicate `original_invoice_id` values from the pre-fix race, Postgres will reject the migration with `ERROR: could not create unique index`. Given TypeORM `synchronize: true` is on in production (CLAUDE.md), this will crash the API cold start. **A dedup/cleanup SQL step must run in the Supabase SQL editor BEFORE the constraint migration deploys.**

Suggested pre-migration SQL:
```sql
-- Keep the newest credit_memo per original_invoice_id; delete dupes
DELETE FROM credit_memos
WHERE id NOT IN (
  SELECT DISTINCT ON (original_invoice_id) id
  FROM credit_memos
  ORDER BY original_invoice_id, created_at DESC
);
```

### Q5: applyFinancialDecisionTx void-invoice — PASS

`rental_chains.status` is driven entirely by `job.status` via `autoCloseChainIfTerminal` and `cascadeDelete`. The `invoices.status` field is not read by any chain-lifecycle path. Bypassing `reconcileBalance` in `applyFinancialDecisionTx` is a billing invariant violation (already flagged by billing-guardian as BG-3) but does not corrupt rental chain or `task_chain_links` state.

---

## Overall verdict: NO-GO

**9 blocking items (7 billing-guardian + 2 lifecycle-auditor)**

**Critical path to merge-ready:**

| Priority | Item | Blocks |
|----------|------|--------|
| P0 | Add pessimistic-write lock + post-lock status check in `cancelJobWithFinancials` | BG-1 double-refund |
| P0 | Add idempotency key to `createRefundForPaymentIntent` | BG-1 double-refund |
| P0 | Add `autoCloseChainIfTerminal` call after `cancelJobWithFinancials` TX | LC-Q2 ghost chain |
| P0 | Add idempotency key to `chargeInvoice` | BG-6 |
| P0 | Add idempotency key to `refundInvoice` | BG-5 |
| P1 | Restore `reconcileBalance` as SSoT in `applyFinancialDecisionTx` | BG-3 |
| P1 | Restore `reconcileBalance` as SSoT in `stripe.service.ts` (3 sites) | BG-4 |
| P1 | Add `stripe_events` dedup table + idempotent `handleWebhook` | BG-7 |
| P1 | Pre-migration data cleanup + `@Unique` on `credit_memos.original_invoice_id` | BG-2 + LC-Q4 |

**Recommended split:**
- **PR-C1:** P0 items only — race closure + idempotency keys + `autoCloseChainIfTerminal` hook. No migration. Safe to merge immediately once tests pass.
- **PR-C2:** P1 items — `reconcileBalance` SSoT restoration, webhook dedup table, `credit_memos` constraint (with prerequisite data cleanup). Requires its own audit cycle before implementation.

**Gating questions for user before any implementation:**
1. Should the idempotency key for `createRefundForPaymentIntent` be `refund_${invoiceId}` or `refund_${paymentIntentId}`? (PaymentIntent ID is more stable if invoice can be re-assigned.)
2. Should `cancelJobWithFinancials` acquire the lock by re-reading inside a new TX or by converting the existing logic to open the TX earlier?
3. For PR-C2 `reconcileBalance` restoration in `applyFinancialDecisionTx`: the void path currently sets `balance_due: 0` directly — `reconcileBalance` must produce the same result; confirm the invariant holds before replacing.
4. Webhook dedup: new `stripe_events` table or add `event_id UNIQUE` column to existing `payments` table?
5. Is the pre-migration dedup SQL above safe to run on production `credit_memos`, or are there business rules about which dupe to keep beyond "newest created_at"?
6. PR-C1 test strategy: unit tests only (mock TX/Stripe), or integration test with real Postgres for the lock path?
7. Should `autoCloseChainIfTerminal` call in `cancelJobWithFinancials` be inside or outside the main TX? (Lifecycle-auditor says outside, mirroring `changeStatus` — confirm.)
