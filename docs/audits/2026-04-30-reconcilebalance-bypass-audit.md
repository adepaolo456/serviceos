# reconcileBalance() Bypass Audit — 2026-04-30

## Context

PR-C1b-1 (#17, `0dd4521`) closed Stripe outbound idempotency for the 4 P0 write sites. During that audit, the billing-guardian flagged **4 direct writes to `invoice.amount_paid` / `invoice.balance_due` / `invoice.status` outside the canonical `reconcileBalance()` writer**, all in `api/src/modules/stripe/stripe.service.ts`. These violate the inviolable invoice rule from CLAUDE.md "Invoice rules" #1:

> `reconcileBalance()` is the ONLY way to set `invoice_status` / `amount_paid` / `balance_due`. Never set directly.

The bypass was tracked in CLAUDE.md follow-up entry "Deferred — `reconcileBalance()` bypass audit + fix arc" (added by PR #17). PR-C1b-1 explicitly did not touch these sites (scope discipline).

This audit:
- Re-locates each bypass at its post-PR #17 line numbers (lines have shifted)
- Evaluates each site for semantic equivalence with `reconcileBalance()`
- Surfaces two new findings beyond the original PR-C1b notes
- Decides PR shape via billing-guardian sign-off
- Lists 3 blocker questions that gate any implementation

References:
- PR-C audit: `docs/audits/2026-04-30-pr-c-audit-final.md` (PR #13)
- PR-C1b audit: `docs/audits/2026-04-30-stripe-idempotency-audit.md` (PR #18)
- PR-C1b-1 implementation: PR #17

---

## Phase 0 — Inventory

All 4 bypass sites confirmed at their post-PR #17 line numbers via content-based search. Pre-PR #17 line numbers (194-199, 251-255, 288-293, 344-349) are obsolete — PR #17 added idempotency code that shifted everything.

| # | File:line | Function | Columns written | Inside TX? | Inside try/catch? |
|---|---|---|---|---|---|
| 1 | `api/src/modules/stripe/stripe.service.ts:253-258` | `chargeInvoice` (sync path) | `status`, `amount_paid`, `balance_due`, `paid_at` | NO | inside outer try (not isolated) |
| 2 | `api/src/modules/stripe/stripe.service.ts:356-360` | `refundInvoice` (sync path) | `status`, `amount_paid`, `balance_due` | NO | NO |
| 3 | `api/src/modules/stripe/stripe.service.ts:393-398` | `handleWebhook` `payment_intent.succeeded` branch | `status`, `amount_paid`, `balance_due`, `paid_at` | NO | NO |
| 4 | `api/src/modules/stripe/stripe.service.ts:449-454` | `handleWebhook` `checkout.session.completed` branch | `status`, `amount_paid`, `balance_due`, `paid_at` | NO | NO |

### Site 1 — `chargeInvoice` (sync, line 253-258)

```typescript
await this.invoiceRepo.update(invoiceId, {
  status: balanceDue <= 0 ? 'paid' : 'partial',
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  paid_at: balanceDue <= 0 ? new Date() : null,
});
```

Flow: `paymentRepo.save()` (line ~240) → `paymentRepo.find({status:'completed'})` (line 250) → `totalPaid = sum(p.amount)` → `invoiceRepo.update` (253) → `notifRepo.save` (260).

**No transaction** wrapping payment save + invoice update. Two separate commits.

### Site 2 — `refundInvoice` (sync, line 356-360)

```typescript
await this.invoiceRepo.update(invoiceId, {
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  status: newStatus,
});
```

Flow: `paymentRepo.save(payment)` (line 349, with `refunded_amount` updated) → `paymentRepo.find({status:'completed'})` (line 352) → **`totalPaid = sum(p.amount - p.refunded_amount)`** (line 353) → `newStatus = totalPaid<=0 ? 'voided' : balance_due<=0 ? 'paid' : 'partial'` (line 355) → `invoiceRepo.update` (356) → `notifRepo.save` (362).

**No transaction.** Note the explicit subtraction of `refunded_amount` — this is the math divergence flagged in Phase 1.

### Site 3 — Webhook `payment_intent.succeeded` (line 393-398)

```typescript
await this.invoiceRepo.update(pi.metadata.invoiceId, {
  status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  paid_at: balanceDue <= 0 ? new Date() : null,
});
```

Flow: read pi.metadata.invoiceId → `paymentRepo.find({status:'completed'})` (line 388) → `totalPaid = sum(p.amount)` → `invoiceRepo.findOne` (line 390) → `invoiceRepo.update` (393).

**Does NOT create a Payment row** — assumes payment already exists from synchronous `chargeInvoice`.

### Site 4 — Webhook `checkout.session.completed` (line 449-454)

```typescript
await this.invoiceRepo.update(invId, {
  status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  paid_at: balanceDue <= 0 ? new Date() : null,
});
```

Flow: read session.metadata.invoiceId → `invoiceRepo.findOne` (line 432) → **`paymentRepo.save(paymentRepo.create({...}))`** (line 436-445, **unconditional**) → `paymentRepo.find({status:'completed'})` (line 446) → `totalPaid = sum(p.amount)` → `invoiceRepo.update` (449).

**Critical:** Site 4 unconditionally creates a Payment row on every webhook delivery. Stripe's at-least-once delivery means duplicate events create duplicate Payment rows. See Phase 2.

### Canonical writer — `reconcileBalance()`

`api/src/modules/billing/services/invoice.service.ts:979-1036`

```typescript
async reconcileBalance(invoiceId: string, manager?: EntityManager): Promise<void> {
  const paymentRepo = manager ? manager.getRepository(Payment) : this.paymentRepo;
  const invoiceRepo = manager ? manager.getRepository(Invoice) : this.invoiceRepo;
  const creditMemoRepo = manager ? manager.getRepository(CreditMemo) : this.creditMemoRepo;

  const payments = await paymentRepo.find({
    where: { invoice_id: invoiceId, status: 'completed' },
  });
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  // ↑ DOES NOT subtract p.refunded_amount

  const invoice = await invoiceRepo.findOneOrFail({ where: { id: invoiceId } });

  const amountPaid = Math.round(totalPaid * 100) / 100;
  const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);

  let status: string;
  if (invoice.voided_at) {
    status = 'voided';
  } else if (totalPaid >= Number(invoice.total) && totalPaid > 0) {
    status = 'paid';
  } else if (totalPaid > 0) {
    status = 'partial';
  } else {
    status = 'open';
  }

  // Idempotent overpayment credit memo
  const overpayment = Math.round(Math.max(totalPaid - Number(invoice.total), 0) * 100) / 100;
  if (overpayment > 0) {
    const existingMemo = await creditMemoRepo.findOne({
      where: { original_invoice_id: invoiceId, reason: Like('%Overpayment%') },
    });
    if (!existingMemo) {
      await creditMemoRepo.save(creditMemoRepo.create({
        tenant_id: invoice.tenant_id,
        original_invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        amount: overpayment,
        reason: `Overpayment on invoice #${invoice.invoice_number}`,
        status: 'issued',
      }));
    } else if (Math.round(Number(existingMemo.amount) * 100) !== Math.round(overpayment * 100)) {
      await creditMemoRepo.update(existingMemo.id, { amount: overpayment });
    }
  }

  const paidAt = (status === 'paid' && !invoice.paid_at) ? new Date() : invoice.paid_at;

  await invoiceRepo.update(invoiceId, {
    amount_paid: amountPaid,
    balance_due: balanceDue,
    status,
    paid_at: paidAt,
  });
}
```

Existing callers (4):
- `invoice.service.ts:299` — `voidInvoice` (bare, no TX)
- `invoice.service.ts:361` — `applyPayment` (bare, no TX)
- `invoice.service.ts:967` — `recalculateTotals` (bare, no TX)
- `billing.service.ts:723` — `createInternalInvoice` paid-with-payment path (with manager, inside TX)

---

## Phase 1 — Semantic equivalence per site

| Site | Equivalence verdict | Reason |
|---|---|---|
| 1 | **EQUIVALENT** | Same math (`totalPaid = sum(p.amount)`); same status ladder modulo voided-vs-`balanceDue<=0`. Status semantic shift on Site 1 is a non-issue — chargeInvoice never produces `'voided'`. Drop-in replacement works. |
| 2 | **NON-EQUIVALENT** — see Critical Finding #1 | Site 2 uses `sum(p.amount - p.refunded_amount)` for `totalPaid`. `reconcileBalance()` does not subtract refunded amounts. Replacement breaks refund accounting. |
| 3 | **EQUIVALENT** | Same math (`totalPaid = sum(p.amount)`). Site 3 doesn't touch refunds. Drop-in replacement works. |
| 4 | **EQUIVALENT (math)** but **BLOCKED** — see Critical Finding #3 | Same math as Site 3. But Site 4 has a parallel duplicate-Payment-row bug independent of the bypass; replacement does not fix it. |

### Critical Finding #1 — Refund-amount math divergence (Site 2)

For a $100 payment + $50 refund:
- Current `refundInvoice` (Site 2): `totalPaid = 100 - 50 = 50` → `balance_due=50, status='partial'` ✅ correct
- `reconcileBalance()` today: `totalPaid = 100` (refund invisible) → `balance_due=0, status='paid'` ❌ wrong (refunded money owed back to customer disappears from invoice state)

A naive drop-in replacement of Site 2 would mark refunded invoices as paid with $0 balance — invisible to the operator UI.

Evidence supporting "refund subtraction is the intended semantic":
- `payment.entity.ts:48` defines `refunded_amount` column with `default: 0` — column would not exist if refunded payments should still count as gross paid
- `stripe.service.ts:348` actively writes `payment.refunded_amount += refundedAmount` on every refund — meaningless without a reader subtracting it
- CLAUDE.md "Backend is truth" — invoice should not lie about money owed back

**Conclusion:** `reconcileBalance()` itself is buggy at line 987. The math fix must land BEFORE any bypass replacement.

### Critical Finding #2 — Voided-state semantic gap (Site 2)

Site 2 writes `status='voided'` when `totalPaid<=0` (after refund nets it to zero).
`reconcileBalance()` writes `'voided'` only when `voided_at IS NOT NULL`; otherwise falls through to `'open'` for zero totalPaid.

After the math fix lands, a fully-refunded invoice ($100 paid + $100 refund → `totalPaid=0`) with no `voided_at` stamp would be marked `'open'` with `balance_due=$100` — i.e., "customer still owes $100." UX regression.

Resolution options:
- **(a) Recommended:** refund flow stamps `voided_at` when `refundedAmount === total`. Matches the `voidInvoice → reconcileBalance` precedent (caller stamps `voided_at` first).
- (b) Broaden `reconcileBalance()` to set `'voided'` when `totalPaid<=0 && hasCompletedPayments` — risky; changes canonical semantics for all callers.
- (c) Add `'refunded'` terminal state — schema change.

### Critical Finding #3 — Site 4 duplicate Payment rows on webhook re-delivery

`stripe.service.ts:436-445` unconditionally creates a Payment row on every `checkout.session.completed` webhook delivery. Stripe's at-least-once delivery means duplicate events create duplicate Payment rows for the same `stripe_payment_intent_id`.

Today this is masked because the bypass writes `'paid'` either way (totals overflow, balance clamps to 0). After bypass replacement with the math-corrected `reconcileBalance()`, duplicate Payment rows overstate `totalPaid` — billing corruption regardless of which writer runs.

**Resolution:** either webhook event-id dedup (PR-C2 scope), or a `paymentRepo.findOne({ where: { stripe_payment_intent_id } })` guard before save.

### Math-idempotency of `reconcileBalance()`

Walked the implementation. **Functionally idempotent** at the invoice row level: same DB state → same `amount_paid`/`balance_due`/`status`/`paid_at` written. Two concurrent runs converge to the same result.

NOT strictly idempotent at the credit-memo side-effect level: the `Like('%Overpayment%')` dedup means the memo-creation branch runs once per overpayment-detection cycle, but the second run does extra DB work. Acceptable; not a correctness issue.

---

## Phase 2 — Sync vs webhook + dependency analysis

| Site | Class | Independent fixability | Conditions |
|---|---|---|---|
| 1 | sync | YES | Requires PR-C1c-pre (`reconcileBalance` math fix) to land first to preserve current behavior. |
| 2 | sync | YES (after C-1, C-2) | Requires PR-C1c-pre + Critical Finding #2 resolution (refund flow stamps `voided_at` on full refund). |
| 3 | webhook | YES | `reconcileBalance()` is row-write-idempotent; can ship before webhook event-id dedup. Site 3 doesn't create Payment rows. |
| 4 | webhook | **NO** (BLOCKED) | Site 4 unconditional `paymentRepo.save` corrupts totals on duplicate webhook delivery. Replacement does not fix this. Needs webhook event-id dedup OR a `paymentRepo.findOne` guard before save. |

### Sync sites concurrency exposure

`chargeInvoice` and `refundInvoice` controller routes have no pessimistic lock equivalent to PR-C1a's `lockJobRow`. Concurrent double-clicks or sync+webhook interleaving race on stale invoice reads + unsynchronized writes. Replacing the bypass with `reconcileBalance()` does NOT change this race surface — the race still exists; the writer just shifts.

Math-idempotency of `reconcileBalance()` makes the race non-corrupting for invoice columns. Locks defer to PR-C1d (separate hardening).

### Stripe idempotency (PR #17) interaction

PR #17's idempotency keys prevent duplicate Stripe-side payment intents at the API layer. Combined with `reconcileBalance()` math-idempotency, the remaining race window is acceptable for PR-C1c. Locks add belt-and-suspenders correctness for the database side, but are not blocking.

---

## Phase 3 — Proposed canonical fix per site

All proposals assume **PR-C1c-pre lands first** (reconcileBalance math fix at invoice.service.ts:987 to subtract `refunded_amount`).

### Site 1 — `chargeInvoice`

**Before** (lines 250-258):
```typescript
const allPayments = await this.paymentRepo.find({ where: { invoice_id: invoiceId, status: 'completed' } });
const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);
await this.invoiceRepo.update(invoiceId, {
  status: balanceDue <= 0 ? 'paid' : 'partial',
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  paid_at: balanceDue <= 0 ? new Date() : null,
});
```

**After:**
```typescript
await this.invoiceService.reconcileBalance(invoiceId);
```

Notes:
- Requires `InvoiceService` injected into `StripeService` (currently not injected — needs module wiring + constructor change)
- Pre-call payment save is unchanged (line ~240)
- No transaction wrapping (follows `applyPayment` precedent)

### Site 2 — `refundInvoice`

**Before** (lines 348-360):
```typescript
payment.refunded_amount = Math.round((Number(payment.refunded_amount || 0) + refundedAmount) * 100) / 100;
await this.paymentRepo.save(payment);

const allPayments = await this.paymentRepo.find({ where: { invoice_id: invoiceId, status: 'completed' } });
const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount) - Number(p.refunded_amount || 0), 0);
const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);
const newStatus = totalPaid <= 0 ? 'voided' : balanceDue <= 0 ? 'paid' : 'partial';
await this.invoiceRepo.update(invoiceId, {
  amount_paid: Math.round(totalPaid * 100) / 100,
  balance_due: balanceDue,
  status: newStatus,
});
```

**After (preferred per Critical Finding #2 option (a)):**
```typescript
payment.refunded_amount = Math.round((Number(payment.refunded_amount || 0) + refundedAmount) * 100) / 100;
await this.paymentRepo.save(payment);

// PR-C1c: Stamp voided_at on full refund so reconcileBalance produces
// 'voided' status (matches the voidInvoice → reconcileBalance precedent).
const fullyRefunded =
  Math.round(Number(payment.refunded_amount) * 100) >=
  Math.round(Number(invoice.total) * 100);
if (fullyRefunded && !invoice.voided_at) {
  await this.invoiceRepo.update(invoiceId, { voided_at: new Date() });
}

await this.invoiceService.reconcileBalance(invoiceId);
```

Notes:
- Depends on PR-C1c-pre's math fix (subtract `refunded_amount`) — without it, math is wrong
- The `voided_at` stamp resolves Critical Finding #2; alternative resolutions (option (b), (c)) require larger changes
- Could refactor the fully-refunded check to a helper in InvoiceService

### Site 3 — Webhook `payment_intent.succeeded`

**Before** (lines 388-398):
```typescript
const payments = await this.paymentRepo.find({ where: { invoice_id: pi.metadata.invoiceId, status: 'completed' } });
const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
const inv = await this.invoiceRepo.findOne({ where: { id: pi.metadata.invoiceId } });
if (inv) {
  const balanceDue = Math.max(Math.round((Number(inv.total) - totalPaid) * 100) / 100, 0);
  await this.invoiceRepo.update(pi.metadata.invoiceId, {
    status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
    amount_paid: Math.round(totalPaid * 100) / 100,
    balance_due: balanceDue,
    paid_at: balanceDue <= 0 ? new Date() : null,
  });
}
```

**After:**
```typescript
await this.invoiceService.reconcileBalance(pi.metadata.invoiceId);
```

Notes:
- No payment-row creation in this branch (chargeInvoice already created it)
- Math-idempotent — duplicate webhook deliveries write identical state
- Safe to ship before webhook event-id dedup

### Site 4 — Webhook `checkout.session.completed`

**BLOCKED** until either webhook event-id dedup OR a payment-row dedup guard ships.

**Two viable paths:**

**Path A** (defensive guard, fits PR-C1c scope):
```typescript
// Before paymentRepo.save, dedup by stripe_payment_intent_id:
const existing = await this.paymentRepo.findOne({
  where: { stripe_payment_intent_id: paymentIntentId },
});
if (!existing) {
  await this.paymentRepo.save(this.paymentRepo.create({ /* ... */ }));
}
await this.invoiceService.reconcileBalance(invId);
```

**Path B** (defer to PR-C2 with full event-id dedup):
- New `stripe_events` table with unique constraint on `(tenant_id, stripe_event_id)`
- Handler dedupes at the event level before any per-branch processing
- Site 4's bypass replacement happens in PR-C2 alongside the dedup table

Phase 6 verdict: defer to PR-C2 unless you want a stopgap.

---

## Phase 4 — Concurrency / locking

`reconcileBalance()` does not acquire row locks. It is **math-idempotent at the invoice row level** — concurrent runs converge to identical state.

Concurrency scenarios analyzed:

1. **Two `chargeInvoice` requests on same invoice (double-click):**
   - PR #17 idempotency keys block duplicate Stripe payment intents
   - Both request paths still race on `paymentRepo.find` + invoice update
   - With math-idempotent `reconcileBalance()`, both paths write identical state — last-writer-wins is correct
   - **Acceptable; PR-C1d adds belt-and-suspenders**

2. **`chargeInvoice` (sync) + `payment_intent.succeeded` webhook:**
   - Webhook (Site 3) re-derives from `paymentRepo` and writes; sync (Site 1) does the same after `paymentRepo.save`
   - Both paths see the same payment rows after save commits
   - `reconcileBalance()` produces identical output for both
   - **Acceptable**

3. **`refundInvoice` (sync) + concurrent `chargeInvoice`:**
   - Race already exists today (no lock)
   - With math fix in `reconcileBalance()`, both paths reach correct convergent state
   - **Acceptable**

4. **Two duplicate `checkout.session.completed` webhook deliveries (Site 4):**
   - **NOT acceptable** — duplicate Payment rows are created, `totalPaid` overstates
   - Math-idempotency does not save us here; the underlying data corruption is upstream of `reconcileBalance()`
   - **Resolution: Phase 3 Site 4 BLOCKED**

5. **Two concurrent `applyPayment` calls on same invoice:**
   - Existing pre-PR-C1c risk; not introduced by this change
   - Both paths call `reconcileBalance()` after independent payment saves
   - Both writes converge correctly
   - **Acceptable; out of scope**

Recommendation: math-idempotency is sufficient for PR-C1c correctness. Pessimistic locking on invoice rows for `chargeInvoice`/`refundInvoice` controller routes is a nice-to-have hardening (PR-C1d) but not blocking.

---

## Phase 5 — Webhook dedup boundary

Webhook event-id dedup remains **OUT OF SCOPE** for any PR resulting from this audit. Owned by PR-C2.

| Site | Can bypass replacement ship before webhook event-id dedup? |
|---|---|
| 3 | **YES** — math-idempotent at the invoice row level. Duplicate event delivery writes identical state. No corruption. |
| 4 | **NO (CONDITIONAL)** — depends on Site 4's duplicate-Payment-row issue. Either: (a) ship a defensive `paymentRepo.findOne` guard in PR-C1c, OR (b) bundle Site 4 with full event-id dedup in PR-C2. |

Webhook handler: `api/src/modules/stripe/stripe.service.ts:371-469` (`handleWebhook`)

Events handled:
- `payment_intent.succeeded` (Site 3)
- `payment_intent.payment_failed` — no invoice writes; out of scope
- `checkout.session.completed` (Site 4)
- `account.updated` — tenant subscription only; out of scope

Current dedup state: NONE. No `stripe_events` table. No unique constraint on event ID. PR-C2 fix shape (out of scope for this audit):
- New `stripe_events` table with `(tenant_id, stripe_event_id)` unique constraint
- Handler dedupes at the event level before per-branch processing
- Site 4's payment-row creation moves inside the dedup-guarded branch

---

## Phase 6 — Billing-guardian verbatim verdict

> **RECOMMEND FINAL PR SHAPE: (d) — three-stage split**
>
> 1. PR-C1c-pre: fix `reconcileBalance` math (`invoice.service.ts:987`) + define refund→voided state stamp convention + tests
> 2. PR-C1c: replace Sites 1 + 2 bypass writes with `reconcileBalance` calls
> 3. PR-C2: replace Sites 3 + 4 + add `stripe_events` event-id dedup + Site 4 payment-row dedup guard
>
> **STATUS: CONDITIONAL — pass if the following are resolved before the implementation prompt is written:**
>
> - **C-1 (BLOCKER):** Owner must confirm the Q1 answer is (b) — refund subtraction is the intended semantic. If ownership disagrees and prefers (a), the conversation moves to "why does `payment.refunded_amount` exist at all?" before any code changes.
> - **C-2 (BLOCKER):** Owner must commit to a status convention for fully-refunded invoices (recommend: refund flow stamps `voided_at` when `refundedAmount === total`; canonical writer's `voided_at`-keyed branch does the rest). Without this decision, Site 2 replacement leaves fully-refunded invoices in `'open'` status — a UX regression.
> - **C-3 (BLOCKER for Site 4 only):** Decide whether Site 4's payment-row dedup (check existing Payment by `stripe_payment_intent_id` before save) ships in PR-C2 alongside event dedup, or as a defensive guard in PR-C1c. Either is acceptable; not deciding is not.
>
> Once C-1, C-2, C-3 are answered by ownership, the implementation prompt for PR-C1c-pre is greenlit.

### Verdict supporting evidence (key cited file:line)

- **Q1 (refund subtraction):** `payment.entity.ts:48` (`refunded_amount` column with `default: 0` exists), `stripe.service.ts:348` (column actively maintained on every refund), `invoice.service.ts:987` (canonical reader does NOT subtract — the bug). Blast radius across existing callers (`voidInvoice`, `applyPayment`, `recalculateTotals`, `createInternalInvoice`) is bounded and corrective in every case.
- **Q2 (webhook fixability):** `stripe.service.ts:436-445` (Site 4 unconditional save without `findOne` guard) — the gating evidence. Site 3 has no such issue; safe standalone.
- **Q3 (concurrency):** Math-idempotency walkthrough; PR #17 idempotency keys cover the API-side race.
- **Q4 (transaction wrapping):** `invoice.service.ts:359-361` (`applyPayment` precedent — separate commits, no TX). Healing-friendly is the safer property for money-already-moved-at-Stripe scenarios.
- **Q5 (Site 2 ordering):** Preserves existing line 348-349 ordering; replacement requires Q1 math fix to preserve refund accounting.
- **Q6 (PR shape):** 3-stage split quarantines the math fix's high-blast-radius change into a single reviewable diff.

---

## Recommended PR shape

**Three-stage split:**

| PR | Scope | Blockers to resolve |
|---|---|---|
| **PR-C1c-pre** | `reconcileBalance()` math fix at `invoice.service.ts:987` (subtract `refunded_amount`) + status convention for fully-refunded → voided + new tests asserting refund accounting | C-1, C-2 |
| **PR-C1c** | Replace Sites 1 + 2 bypass writes with `reconcileBalance()` calls; Site 2 stamps `voided_at` on full refund per PR-C1c-pre convention; inject `InvoiceService` into `StripeService` | C-1, C-2 (resolved by PR-C1c-pre); InvoiceService injection wiring |
| **PR-C2** | Replace Site 3 (math-only) + Site 4 + new `stripe_events` event-id dedup table + Site 4 payment-row dedup guard | C-3 (decides whether Site 4 guard is in PR-C1c or PR-C2) |

**Out of scope (separate hardening PR-C1d):**
- Pessimistic lock on invoice row for `chargeInvoice` / `refundInvoice` controller routes (lockJobRow-equivalent for billing flows)

### Why three stages (not two or four)

- **Math fix isolated (PR-C1c-pre):** highest blast radius — touches every `reconcileBalance()` caller. Reviewable independently of bypass redirection. Independently revertable if production regression is observed.
- **Sync replacements bundled (PR-C1c):** mechanical changes once math is correct. Sites 1 + 2 share concerns (sync flow, no webhook coupling).
- **Webhook + dedup bundled (PR-C2):** Site 3 could ship in PR-C1c, but bundling with PR-C2 keeps webhook-related risk centralized. Site 4's blockers naturally fit PR-C2's scope.

### Why not all-in-one bundled PR

- Largest blast radius; hardest to bisect if regression observed
- Mixes orthogonal correctness concerns (math vs redirection vs event dedup)
- Reviewer cannot verify each layer independently

### Why not five stages (split Site 3 from Site 4)

- Site 3 alone is too small for its own PR
- PR-C2 already owns webhook concerns; bundling Sites 3 + 4 there preserves clean module ownership

---

## Open gating questions

These need explicit answers before the PR-C1c-pre implementation prompt is drafted.

### C-1 (BLOCKER) — Refund subtraction semantic

Confirm `totalPaid = sum(p.amount - p.refunded_amount)` is the intended semantic for `reconcileBalance()`?

- (a) **YES** — fix `reconcileBalance()` line 987 to subtract `refunded_amount`. Existing callers' behavior changes are bounded and corrective.
- (b) **NO** — keep `reconcileBalance()` as-is (gross paid). Then explain why `payment.refunded_amount` column exists and what should subtract from it. (This path requires deeper schema design discussion before any code changes.)

Recommendation: **(a)**. Evidence in Phase 1 Critical Finding #1 supports this unambiguously.

### C-2 (BLOCKER) — Fully-refunded invoice status convention

After C-1 (a) lands, a fully-refunded invoice ($100 paid + $100 refund) has `totalPaid=0` and falls into `reconcileBalance()`'s `'open'` branch — incorrect UX.

Pick the convention:

- (a) **Recommended:** refund flow stamps `voided_at` when `refundedAmount === total`. Caller-side stamp + canonical `voided_at`-keyed branch (matches `voidInvoice` precedent).
- (b) Broaden `reconcileBalance()` to set `'voided'` when `totalPaid<=0 && hasCompletedPayments`. Risky — changes canonical semantics for all callers.
- (c) Add `'refunded'` terminal state. Schema enum change + frontend updates required.

### C-3 (BLOCKER for Site 4 only) — Site 4 payment-row dedup placement

Site 4 (`checkout.session.completed`) creates a Payment row unconditionally. Stripe's at-least-once delivery causes duplicates.

Pick:

- (a) Defensive `paymentRepo.findOne({ where: { stripe_payment_intent_id } })` guard ships in **PR-C1c-pre** as preparatory work (lightweight; isolates Site 4's data corruption from the bypass replacement)
- (b) Defensive guard ships in **PR-C1c** alongside Site 4's bypass replacement (couples the two changes)
- (c) Defer to **PR-C2** alongside full webhook event-id dedup table (bundled approach)

Recommendation: **(c)** — keeps PR-C1c tight; PR-C2 owns webhook dedup holistically.

---

## Audit doc state

Path: `docs/audits/2026-04-30-reconcilebalance-bypass-audit.md`

This file sits untracked. No source code changes. No DB writes. No migrations. The implementation prompt for PR-C1c-pre is drafted only after C-1, C-2, C-3 are answered.
