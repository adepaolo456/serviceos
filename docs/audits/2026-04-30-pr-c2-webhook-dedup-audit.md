# PR-C2 Webhook Bypass + Event-ID Dedup Audit — 2026-04-30

## 1. Context

PR #21 (`9973f23`) shipped PR-C1c: Sites 1 + 2 (synchronous Stripe paths) now flow through canonical `reconcileBalance()`. Sites 3 + 4 (webhook handlers) remain bypassed.

PR #19 audit (`docs/audits/2026-04-30-reconcilebalance-bypass-audit.md`) deferred Sites 3 + 4 specifically because **Site 4 has a parallel duplicate-Payment-row bug** (unconditional `paymentRepo.save` with no `findOne` guard on `stripe_payment_intent_id`). Today the bug is masked by Site 4's bypass clamping totals to 0; once the bypass is replaced by `reconcileBalance()`, duplicates would silently inflate `totalPaid`.

This audit's job is to:
- Re-anchor Sites 3 + 4 at post-PR #21 line numbers
- Design the `stripe_events` event-id dedup table
- Decide dedup placement (entry-point vs per-handler)
- Decide migration approach (Supabase SQL editor vs `synchronize`)
- Verify orthogonality with PR-C1b-1's outbound idempotency keys
- Lock 5 binding ownership decisions (D-1..D-5)
- Recommend PR shape

This is a **read-only audit**. The deliverable is this doc. The implementation prompts (PR-C2-pre, PR-C2) are drafted only after the audit lands and the 5 decisions are confirmed.

References:
- PR #13 — PR-C audit (`docs/audits/2026-04-30-pr-c-audit-final.md`)
- PR #17 — PR-C1b-1 idempotency keys
- PR #19 — `reconcileBalance()` bypass audit (`docs/audits/2026-04-30-reconcilebalance-bypass-audit.md`)
- PR #20 — PR-C1c-pre math fix + `isFullyRefunded()` helper
- PR #21 — PR-C1c sync bypass replacements
- CLAUDE.md "Invoice rules" #1 + "Deployment rules"

---

## 2. Phase 1 — Sites 3 + 4 re-anchored (post-PR #21)

Line numbers shifted from PR #19's audit because PR-C1c (Sites 1 + 2 replacements) shrunk the synchronous paths.

### 2.1 Site 3 — `payment_intent.succeeded` (lines 393-411)

`api/src/modules/stripe/stripe.service.ts:394-411`:

```typescript
case 'payment_intent.succeeded': {
  const pi = event.data.object as Stripe.PaymentIntent;
  if (pi.metadata.invoiceId) {
    // Derive from payments — the payment record should already
    // exist from chargeInvoice
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
  }
  break;
}
```

**Bypass write at lines 403-408.** Single violation: direct `invoiceRepo.update` of `status` / `amount_paid` / `balance_due` / `paid_at` (CLAUDE.md "Invoice rules" #1 violation). No Payment row creation — assumes the row exists from sync `chargeInvoice`. No transaction wrapper. No try/catch isolating the case.

### 2.2 Site 4 — `checkout.session.completed` (lines 434-467)

**⚠️ Site 4 has TWO compounding violations**, not one. PR-C2 must fix both.

`api/src/modules/stripe/stripe.service.ts:434-467`:

```typescript
case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.invoiceId && session.payment_status === 'paid') {
    const invId = session.metadata.invoiceId;
    const tId = session.metadata.tenantId;
    const inv = await this.invoiceRepo.findOne({ where: { id: invId } });
    if (inv) {
      const paidAmount = (session.amount_total || 0) / 100;
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
      // ── VIOLATION 1: unconditional Payment row creation (lines 446-455) ──
      await this.paymentRepo.save(this.paymentRepo.create({
        tenant_id: tId,
        invoice_id: invId,
        amount: paidAmount,
        payment_method: 'stripe_checkout',
        stripe_payment_intent_id: paymentIntentId,
        status: 'completed',
        applied_at: new Date(),
        notes: `Stripe Checkout Session ${session.id}`,
      }));
      const allPayments = await this.paymentRepo.find({ where: { invoice_id: invId, status: 'completed' } });
      const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balanceDue = Math.max(Math.round((Number(inv.total) - totalPaid) * 100) / 100, 0);
      // ── VIOLATION 2: bypass write to invoice columns (lines 459-464) ──
      await this.invoiceRepo.update(invId, {
        status: balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open',
        amount_paid: Math.round(totalPaid * 100) / 100,
        balance_due: balanceDue,
        paid_at: balanceDue <= 0 ? new Date() : null,
      });
    }
  }
  break;
}
```

**Violation 1 (lines 446-455) — duplicate-Payment-row bug.** `paymentRepo.save` fires unconditionally on every webhook delivery. No `findOne({ where: { stripe_payment_intent_id } })` guard. Stripe's at-least-once delivery semantics mean duplicate `checkout.session.completed` events create duplicate Payment rows for the same `stripe_payment_intent_id`.

Today this is masked because the bypass write at 459-464 derives from the duplicated Payment rows AND `Math.max(... , 0)` clamps the result. Once the bypass is replaced by `reconcileBalance()` (which sums `payment.amount - refunded_amount` across all completed payments at `invoice.service.ts:993-996` with NO clamp downstream), duplicates would directly inflate `totalPaid`. **Money-overstatement vector.**

**Violation 2 (lines 459-464) — bypass write.** Direct `invoiceRepo.update` of `status` / `amount_paid` / `balance_due` / `paid_at`. Same Rule #1 violation as Site 3.

**Both violations must be fixed in PR-C2.** Replacement of Violation 2 alone (`reconcileBalance` redirect) without Violation 1 fix (`paymentRepo.findOne` guard) would convert the masked-bug scenario into an active money-overstatement vector. This is the central reason PR-C2 ships defense-in-depth (D-4) rather than relying on entry-point dedup alone.

### 2.3 `handleWebhook` structure

`api/src/modules/stripe/stripe.service.ts:381-478`:

- Signature verification at lines 382-391 (`Stripe.webhooks.constructEvent` if `STRIPE_WEBHOOK_SECRET` set; `JSON.parse` dev fallback).
- **Dedup insertion point: line 392** — immediately after the catch block at 391, before `switch (event.type)` at 393. This is the canonical entry point where Stripe has already authenticated the webhook source.
- 4 case branches: `payment_intent.succeeded` (Site 3), `payment_intent.payment_failed`, `checkout.session.completed` (Site 4), `account.updated`.
- No transaction wrapping the dispatch.
- No try/catch around individual cases (exceptions propagate).
- Returns uniform `{ received: true }` at line 478.

### 2.4 Existing webhook test coverage

Only `payment_intent.payment_failed` is exercised (Arc K Phase 1A tests at `stripe.service.spec.ts:206, 244`). **Sites 3 + 4 have NO direct tests.** No test currently exercises duplicate-event-id behavior.

Mock pattern: `delete process.env.STRIPE_WEBHOOK_SECRET` → take dev-mode `JSON.parse` branch → craft Buffer payload manually.

PR-C2-pre + PR-C2 must add tests for:
- Duplicate `evt_*` ID rejected at entry point (PR-C2-pre)
- Duplicate `stripe_payment_intent_id` rejected by Site 4 internal guard (PR-C2)
- Site 3 end-state matches sync `chargeInvoice` end-state (PR-C2)
- Site 4 end-state with single delivery matches end-state with redelivery (PR-C2)

---

## 3. Phase 2 — `stripe_events` schema proposal

### 3.1 Column-by-column proposal

```sql
CREATE TABLE stripe_events (
  -- Surrogate UUID PK per entity convention (D-1).
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stripe's evt_* event ID. Globally unique across Stripe, but
  -- still scoped to (tenant_id, event_id) per multi-tenant index
  -- convention.
  event_id VARCHAR NOT NULL,

  -- Tenant scoping. NULLABLE for cross-tenant platform events
  -- (account.updated has no payload-derivable tenant_id).
  -- See §3.3 for the trade-off rationale.
  tenant_id UUID NULL,

  -- Stripe event type for auditing and debugging
  -- (payment_intent.succeeded, checkout.session.completed, etc.).
  event_type VARCHAR NOT NULL,

  -- When the entry-point dedup INSERT first fired for this event.
  -- Used for retention queries (D-2 follow-up) and replay debugging.
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Compound unique index: (tenant_id, event_id) prevents duplicate
  -- processing per-tenant. Leads with tenant_id matching all existing
  -- entity index conventions (e.g., idx_invoices_status).
  CONSTRAINT uk_stripe_events_tenant_event UNIQUE (tenant_id, event_id)
);

-- Optional secondary for retention pruning (D-2 follow-up):
-- CREATE INDEX idx_stripe_events_processed ON stripe_events(processed_at);
```

### 3.2 Convention alignment

Mirrors the established billing-module pattern verified in Phase 0:

- **PK:** `@PrimaryGeneratedColumn('uuid')` surrogate UUID (consistent with `Payment`, `Invoice`, `CreditMemo`, etc.).
- **`tenant_id`:** UUID, here NULLABLE (departure from typical NOT NULL — see §3.3).
- **Compound unique index:** leads with `tenant_id` per `idx_invoices_status` precedent at `invoice.entity.ts:22`.

### 3.3 Tenant-id nullability — the `account.updated` trade-off

`account.updated` events arrive when a Stripe Connect account is updated. Their payload does NOT carry `tenant_id` in metadata — they're cross-tenant platform events that arrive at the platform account level. Site 5's existing handler (`stripe.service.ts:469-474`) does a Connect-account-id reverse lookup on the tenants table to resolve tenant — which happens AFTER the proposed dedup insertion point at line 392.

Three options for resolving this:

1. **(Chosen) Allow `tenant_id` NULL.** `account.updated` events insert with `tenant_id=NULL` and the literal `event.id`. PostgreSQL's unique-index NULL semantics treat NULL as distinct, so two NULL rows with the same `event_id` would NOT collide (a strict no-dedup scenario for `account.updated`). In practice, `account.updated` events are rare (one per Connect onboarding state transition), and processing one twice is idempotent at the application level (the handler simply re-asserts `stripe_onboarded: true`). **Trade-off accepted: dedup is best-effort for `account.updated`; strict for invoice-money events.**

2. Pre-resolve tenant before dedup INSERT. Adds a Connect-id → tenant lookup at line 392 BEFORE the dedup INSERT. Increases entry-point complexity and adds a DB round trip on every webhook. Rejected as over-engineered.

3. Use a sentinel `tenant_id` value (e.g., `'00000000-0000-0000-0000-000000000000'`) for cross-tenant events. Bends the multi-tenant safety model; rejected.

Document the option 1 trade-off in code comments: webhooks where `tenant_id` cannot be derived from payload (currently only `account.updated`) get best-effort dedup. Money-movement events (`payment_intent.*`, `checkout.session.*`) carry `metadata.tenantId` and dedup strictly.

### 3.4 Open follow-ups (NOT in PR-C2-pre or PR-C2)

- **D-2 retention prune:** schedule a cron / background job to delete rows older than ~90 days (covers Stripe's 30-day replay window + buffer). Deferred to its own follow-up PR per billing-guardian verdict.
- **`payload_hash` tamper detection:** optional sha256 of the event body for replay auditing. Not required for dedup correctness; deferred.
- **`error` column for failed processing:** allows future retry/observability work. Deferred.

---

## 4. Phase 3 — Dedup placement

### 4.1 Recommendation: entry-point in `handleWebhook` (D-3 = (a))

Insertion at **line 392** — immediately after signature verification, before the `switch (event.type)` at line 393.

### 4.2 Trade-offs analyzed

| Approach | Pros | Cons |
|---|---|---|
| **(a) Entry-point** at line 392 | Single SSOT for "was this event seen?". All 4 case branches benefit. New cases auto-covered. | Requires careful sequencing relative to signature verification. |
| **(b) Per-handler** | Surgical — only money-movement handlers pay the cost. | Anti-pattern: registry-style bypass possible (CLAUDE.md SSOT rule). Easy to forget on new handlers. |

(a) wins per the C-3 lock from PR #19 audit ("event-id dedup at the webhook entry point supersedes the need for a separate guard") AND the file evidence that all 4 current handlers benefit equally.

### 4.3 INSERT...ON CONFLICT DO NOTHING semantics — REQUIRED

Naive implementation:

```typescript
const existing = await stripeEventRepo.findOne({ where: { tenant_id, event_id } });
if (existing) return { received: true };
await stripeEventRepo.save({ tenant_id, event_id, ... });
// ... process event
```

**This is a TOCTOU race.** Stripe documents that they may deliver an event before the previous delivery has been ack'd. Two webhook handlers can both call `findOne`, both miss, both call `save` — duplicate Payment rows result.

**Required pattern:** atomic `INSERT ... ON CONFLICT DO NOTHING`:

```typescript
const result = await this.dataSource.query(
  `INSERT INTO stripe_events (tenant_id, event_id, event_type)
   VALUES ($1, $2, $3)
   ON CONFLICT (tenant_id, event_id) DO NOTHING
   RETURNING id`,
  [tenantId, event.id, event.type],
);
const isNewEvent = result.length > 0;
if (!isNewEvent) {
  return { received: true };
}
// ... process event (this is the first time)
```

The `RETURNING id` makes the "was this row inserted?" check atomic with the INSERT. PostgreSQL guarantees `ON CONFLICT DO NOTHING` is concurrent-safe.

### 4.4 Sequencing requirement

Dedup INSERT MUST happen AFTER signature verification at line 391. Otherwise unsigned/forged payloads pollute the `stripe_events` table. Insertion at line 392 (immediately after the catch block) is correct.

---

## 5. Phase 4 — Migration approach

### 5.1 Supabase SQL migration (CLAUDE.md compliance)

Per CLAUDE.md "Deployment rules" line 36-37:
> DB migrations: Supabase SQL editor BEFORE API deploy. Always.

PR-C2-pre must include:
- `api/migrations/012_stripe_events_dedup.sql` with the schema from §3.1
- Apply via Supabase SQL editor BEFORE deploying the API code that introduces the `StripeEvent` entity
- Numbered consecutively after the existing 11 migrations (002 through 011)

### 5.2 `synchronize` state — no auto-sync risk

`api/src/app.module.ts:74-79`:

```typescript
const isTest = process.env.NODE_ENV === 'test';
return {
  type: 'postgres',
  url,
  autoLoadEntities: true,
  synchronize: isTest,
  // ...
};
```

`synchronize: isTest` — TRUE only when `NODE_ENV === 'test'`; **FALSE in dev/prod**. The schema does NOT auto-sync from entity definitions in production.

**⚠️ CLAUDE.md line 38 is stale.** It says "TypeORM `synchronize: true` is on in production" but the code has disabled it for non-test environments. Production deploys still rely on Supabase SQL migrations. This stale rule is flagged in §10 References + open follow-ups.

### 5.3 Rollback strategy

If `012_stripe_events_dedup.sql` needs to be reverted:

```sql
-- Rollback (apply via Supabase SQL editor)
DROP TABLE stripe_events;
```

Plus revert the API code (PR-C2-pre's Git revert). Order: API revert first (so code stops referencing the table), then `DROP TABLE`.

If only the dedup logic needs to be disabled but the table kept (e.g., investigating dedup correctness without losing event history), revert the API change but keep the table; the dedup INSERT just stops firing.

### 5.4 Indexing strategy

- Primary: `id` (UUID PK)
- Unique compound: `(tenant_id, event_id)` — drives the dedup `ON CONFLICT` check
- Optional secondary (D-2 follow-up): `processed_at` for retention prune queries

No other indexes proposed. Webhook handlers touch the table at most once per delivery (one INSERT or one conflict). Read patterns are limited to retention queries (D-2 follow-up) and ad-hoc replay debugging.

---

## 6. Phase 5 — Idempotency interaction with PR-C1b-1 (orthogonality)

PR #17 added Stripe outbound idempotency keys at `stripe.service.ts:200-205, 310-316, 581-586`. Examples:

```typescript
'tenant-' + tenantId + ':charge:invoice-' + invoiceId + ':balance-' + amount
'tenant-' + tenantId + ':refund:invoice-' + invoiceId + ':payment-' + paymentId + ':cumulative-' + prevRefundedCents + '-' + refundCents
'tenant-' + tenantId + ':subscribe:tier-' + tier + ':cycle-' + billingCycle
```

These keys are derived from **ServiceOS-controlled data** (tenant_id, invoice_id, payment_id, balance/refund cumulative). They protect outbound retries: if ServiceOS calls `paymentIntents.create` twice with the same key, Stripe returns the cached response server-side. **No double-charge** if a network timeout occurs mid-request.

PR-C2's webhook event-id dedup uses **Stripe's `evt_*` IDs** to dedup *inbound* event processing. **No double-record** if Stripe delivers the same webhook event twice.

| Mechanism | Direction | Identifier source | Protects against |
|---|---|---|---|
| PR-C1b-1 idempotency keys | Outbound (ServiceOS → Stripe) | ServiceOS-controlled (tenant + invoice + amounts) | ServiceOS retrying the same logical Stripe call |
| PR-C2 event-id dedup | Inbound (Stripe → ServiceOS) | Stripe-controlled (`evt_*` ID) | Stripe re-delivering the same webhook event |

**Independent mechanisms at opposite ends of the request/response cycle.** No interaction. Verified by:
- Outbound key construction never touches `event.id` or any inbound webhook data.
- Stripe's `evt_*` IDs are stable across retries (that's why dedup works).
- Outbound idempotency cache and inbound dedup table sit at different boundaries.

Worked example illustrating the two:

1. ServiceOS calls `paymentIntents.create(payload, { idempotencyKey: 'tenant-t1:charge:invoice-inv1:balance-10000' })`.
2. Stripe processes successfully, returns `{ id: 'pi_123' }`. The HTTP response is lost to network timeout.
3. ServiceOS auto-retries with the same idempotency key. Stripe returns the cached `{ id: 'pi_123' }` — **outbound dedup protects this layer.**
4. Stripe later delivers `payment_intent.succeeded` webhook with `event.id = 'evt_456'`.
5. Stripe loses the webhook ack, redelivers the same event with `event.id = 'evt_456'`.
6. PR-C2 entry-point dedup at line 392 sees `tenant_id='t1', event_id='evt_456'` already in `stripe_events`, returns `{ received: true }` without re-running the handler — **inbound dedup protects this layer.**

---

## 7. Phase 6 — Billing-guardian verdict (verbatim)

> ## Findings verification (all confirmed at cited line numbers)
>
> **Site 3 confirmed** — `api/src/modules/stripe/stripe.service.ts:393-411`. Direct `invoiceRepo.update` at lines 403-408 writes `status` / `amount_paid` / `balance_due` / `paid_at`. This is a verbatim violation of CLAUDE.md Invoice Rule #1: "`reconcileBalance()` is the ONLY way to set `invoice_status` / `amount_paid` / `balance_due`."
>
> **Site 4 confirmed (CRITICAL)** — `stripe.service.ts:434-467`. The `paymentRepo.save` at lines 446-455 has NO `findOne({ where: { stripe_payment_intent_id } })` guard. Bypass write at 459-464. Two compounding violations:
> 1. Direct invoice column writes (Rule #1 violation).
> 2. Unconditional Payment row creation. Stripe's at-least-once delivery + duplicate `evt_*` redelivery would create duplicate Payment rows. Today the bypass clamps via `Math.max(... , 0)` at line 458, but once the bypass is replaced by `reconcileBalance()`, duplicates would silently inflate `totalPaid` because `reconcileBalance` (invoice.service.ts:993-996) sums `payment.amount - refunded_amount` across all completed payments. **This is a money-overstatement vector.**
>
> **Entry-point insertion verified** — Lines 381-391 contain signature verification + try/catch; line 393 is the `switch`. Insert point at 391-392 is clean and pre-dispatch.
>
> **Entity convention verified** — `Payment` (`payment.entity.ts:13`), `Invoice` (`invoice.entity.ts:25`) both use `@PrimaryGeneratedColumn('uuid')` surrogate PKs. Compound indexes lead with `tenant_id` (`idx_invoices_status` at `invoice.entity.ts:22`). `@ManyToOne(() => Tenant)` + `@JoinColumn({ name: 'tenant_id' })` pattern uniform.
>
> **`synchronize` state confirmed** — `app.module.ts:74-79`: `synchronize: isTest` only. CLAUDE.md line 38 IS stale. PR-C2 must include a real Supabase SQL migration (`012_stripe_events_dedup.sql`); cannot rely on entity-driven schema sync. Note this contradiction in the implementation prompt.
>
> **`isFullyRefunded` + `voided_at` precedent verified** — `invoice.service.ts:1004-1012`: `voided_at` is the canonical signal for `'voided'` status. Confirms the existing pattern where callers stamp side data on the row BEFORE invoking `reconcileBalance`. PR-C2 site replacements should follow this same precedent (no new patterns invented).
>
> **Idempotency orthogonality verified** — `idempotency.util` keys at `stripe.service.ts:200-205`, `310-316`, `581-586` are all ServiceOS-data-derived (tenant + invoice + balance / payment / refund cumulative). Independent from inbound event-id dedup.
>
> **Test gap verified** — Only `payment_intent.payment_failed` exercised. No coverage of duplicate-event-id behavior on Sites 3 or 4. PR-C2 MUST add tests for: (i) duplicate event-id rejected at entry point, (ii) Site 4 duplicate `paymentRepo.save` blocked, (iii) Site 3 + 4 produce identical end-state to `reconcileBalance`.
>
> ## D-1 — `stripe_events` PK design
>
> **ANSWER: (b) — surrogate UUID PK + unique compound index `(tenant_id, event_id)`.**
>
> Evidence:
> - `payment.entity.ts:13`, `invoice.entity.ts:25`, all 30+ billing entities use `@PrimaryGeneratedColumn('uuid')`. NO entity uses an external-system identifier as PK.
> - `invoice.entity.ts:22-23` shows the compound index pattern leading with `tenant_id`. `stripe_events` should mirror: `@Index('idx_stripe_events_event', ['tenant_id', 'event_id'], { unique: true })`.
> - Stripe `evt_*` IDs are guaranteed unique globally — but if `tenant_id` is in scope (Connect platform supports multiple destination accounts), leading the unique constraint with `tenant_id` aligns with all existing index patterns in the codebase.
>
> Caveat: webhook signature verification (`stripe.service.ts:387`) happens BEFORE `tenant_id` is resolved from event metadata. The dedup INSERT must carry tenant_id derivable from event payload (`pi.metadata.tenantId` for Sites 3/4; `account.id` lookup for Site 5). Document the resolution path in the migration's column comment.
>
> ## D-2 — Retention policy
>
> **ANSWER: (d) — defer retention to a follow-up PR.**
>
> Evidence:
> - No existing pruning crons in the codebase (verified by absence of any cron-decorated retention services in the billing module).
> - Stripe's documented replay window is 30 days; production volume is currently single-tenant low-throughput (Rent This Dumpster, per CLAUDE.md). Row growth is bounded in the near term.
> - Bikeshed risk is real: pruning logic on day 1 forces decisions on retention windows, soft-delete vs hard-delete, and tenant-isolation of the prune query — all unrelated to the dedup correctness goal.
> - Add a TODO comment in the migration referencing the follow-up PR.
>
> ## D-3 — Dedup placement
>
> **ANSWER: (a) — entry-point in `handleWebhook`, immediately after line 391.**
>
> Evidence:
> - `stripe.service.ts:381-478` is the single inbound funnel. All four `case` branches (`payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`, `account.updated`) benefit equally.
> - Per-handler placement would require duplication in 4 places + every future case statement — a registry-bypass-style anti-pattern (violates SSOT, CLAUDE.md Rule #5).
> - The entry-point dedup is the canonical "was this event processed?" oracle. Per-handler guards become redundant noise.
> - Critical sequencing: dedup INSERT MUST happen AFTER signature verification (line 391) so unsigned/forged payloads don't pollute the `stripe_events` table. Insertion point at 392 is correct.
>
> Implementation note: use `INSERT ... ON CONFLICT DO NOTHING` with `RETURNING` (or a TypeORM equivalent) to atomically detect duplicates. A two-step `findOne` + `save` introduces a TOCTOU race under high webhook concurrency.
>
> ## D-4 — Defense-in-depth Site 4 guard
>
> **ANSWER: (b) — both. Defense-in-depth is REQUIRED for money-movement.**
>
> Evidence:
> - CLAUDE.md Invoice Rule #1 makes `reconcileBalance` the sole writer for invoice money columns. Once Site 4 calls `reconcileBalance`, ANY duplicate Payment row directly inflates `amount_paid` via `invoice.service.ts:993-996` (sums `amount - refunded_amount` across all completed payments). There is no clamp downstream.
> - Failure scenarios that entry-point dedup alone does NOT cover:
>   - **Crash mid-handler**: `stripe_events` INSERT succeeds (commits), then handler crashes before `paymentRepo.save` completes. Stripe redelivers; `stripe_events` says "already processed"; the handler is skipped; the Payment row is permanently missing. **OR** the inverse: `paymentRepo.save` commits, then dedup INSERT fails to commit (network glitch). Stripe redelivers; dedup says "new event"; second `paymentRepo.save` runs → duplicate row.
>   - **Bug in dedup logic itself**: any future refactor that breaks the entry-point guard silently doubles every payment.
>   - **Concurrent webhook delivery**: Stripe documents that they may deliver an event before the previous one has been ack'd. If dedup uses `ON CONFLICT DO NOTHING` on a non-transactional INSERT and the handler runs in a separate code path, two handlers can run concurrently before either has committed the Payment row.
> - The `paymentRepo.findOne({ where: { stripe_payment_intent_id } })` guard is one indexed lookup. Cost is negligible. The blast radius of a missing guard is direct customer overcharge.
> - Existing precedent: `chargeInvoice` at line 247 saves a Payment record BEFORE `reconcileBalance`; that path is single-call and synchronous so no duplicate risk. Webhook path is at-least-once delivery — a categorically different threat model.
>
> **Cite billing rule:** Invoice Rule #1 (canonical writer) + the pattern enforced in the Apr 29 phantom-paid incident (per agent system prompt) — both establish that money-movement code must defend against state desynchronization independently of upstream guards.
>
> ## D-5 — PR shape
>
> **ANSWER: (b) — split into PR-C2-pre (table + entry-point guard) and PR-C2 (Site 3 + Site 4 replacements).**
>
> Evidence:
> - The entry-point guard is a pure addition: it only rejects duplicate events. Sites 3 + 4 still run their existing bypass writes. PR-C2-pre can ship and bake in production without changing money-movement semantics.
> - Sites 3 + 4 replacements are MUTATIONS to the canonical money path. Reviewing them on top of an already-merged dedup guard is safer:
>   - Reviewers can verify the dedup guard works in production (via observability — single source of truth for "was this event seen") before authorizing the bypass replacement.
>   - Rollback granularity: if Site 3 or 4 replacement misbehaves, revert only PR-C2 — the dedup table stays.
>   - Test isolation: the dedup-guard tests are independent (event-id replay) from the bypass-replacement tests (reconcileBalance state assertions). Splitting matches the test boundary.
> - Single-PR risk: the migration + dedup guard + Site 4's defense-in-depth `findOne` guard + the `reconcileBalance` redirects in Sites 3 and 4 = at least 5 distinct correctness surfaces in one diff. Reviewer fatigue compounds.
> - Counter-argument ("the guard makes Sites 3+4 trivially replaceable, review them together") is true but does not require a single PR — it requires Sites 3+4 review to come AFTER the guard exists. PR ordering achieves both.
>
> **Recommended sequence:**
> 1. **PR-C2-pre**: `012_stripe_events_dedup.sql` migration + `StripeEvent` entity + dedup INSERT in `handleWebhook` after line 391 + tests asserting duplicate event-id rejection. No changes to Sites 3/4 logic.
> 2. **PR-C2**: Replace Site 3 bypass with `reconcileBalance(invId)`. Replace Site 4 bypass with `paymentRepo.findOne` guard + `reconcileBalance(invId)`. Tests asserting end-state equality with chargeInvoice path.
>
> **RECOMMEND PR SHAPE: (b) — split**
>
> **STATUS: CONDITIONAL — pass if the following are written into the PR-C2-pre and PR-C2 implementation prompts**
>
> **Conditions:**
>
> 1. **D-1**: `stripe_events` entity uses `@PrimaryGeneratedColumn('uuid')` PK + `@Index(..., ['tenant_id', 'event_id'], { unique: true })`. NOT event_id as PK.
>
> 2. **D-2**: No retention/prune logic in PR-C2-pre. TODO comment in migration referencing follow-up.
>
> 3. **D-3**: Dedup INSERT placed at line 392 (after signature verify, before `switch`). Use `INSERT ... ON CONFLICT DO NOTHING` semantics — NOT `findOne` + `save` (TOCTOU race under concurrent delivery).
>
> 4. **D-4**: PR-C2 MUST include both the entry-point dedup AND the Site 4 internal `paymentRepo.findOne({ where: { stripe_payment_intent_id } })` guard. Defense-in-depth is non-negotiable for money-movement per Invoice Rule #1.
>
> 5. **D-5**: Two-PR sequence. PR-C2-pre lands first and bakes before PR-C2 ships.
>
> 6. **Migration discipline (CLAUDE.md line 36-37)**: `012_stripe_events_dedup.sql` MUST be applied via Supabase SQL editor BEFORE the API deploy carrying the new entity. `synchronize: isTest` (`app.module.ts:74-79`) means the entity-driven schema bootstrap won't run in production. Stale CLAUDE.md line 38 should be flagged in a separate doc-only PR.
>
> 7. **Site 3 + Site 4 replacement contract** (PR-C2): both sites must end with `await this.invoiceService.reconcileBalance(invId)` and remove the direct `invoiceRepo.update` blocks at lines 403-408 and 459-464. Site 4 must also add the `paymentRepo.findOne` guard wrapping the `paymentRepo.save` at lines 446-455.
>
> 8. **Test coverage** (PR-C2-pre + PR-C2):
>    - Duplicate `evt_*` ID rejected at entry point (PR-C2-pre).
>    - Duplicate `stripe_payment_intent_id` rejected by Site 4 internal guard (PR-C2).
>    - Site 3 end-state matches `chargeInvoice` end-state (PR-C2).
>    - Site 4 end-state with single delivery matches Site 4 with redelivery (PR-C2).
>
> 9. **`tenant_id` resolution in dedup INSERT**: must use event-payload-derived tenant_id (`pi.metadata.tenantId` / `session.metadata.tenantId` / `account.id` reverse-lookup). NOT JWT — webhooks are unauthenticated relative to ServiceOS auth. Document this in the entity's column comment to avoid future confusion. Multi-tenant safety holds because dedup writes use trusted Stripe event payload, verified by signature at line 387.
>
> 10. **`account.updated` handler tenant resolution**: line 472 uses `stripe_connect_id` lookup — for the dedup INSERT, the tenant_id may need to be a separate lookup BEFORE the dedup write, or the dedup table must allow nullable `tenant_id` for tenant-resolution-deferred events. Flag this for the implementation prompt to resolve explicitly.
>
> **FINAL VERDICT: CONDITIONAL PASS — proceed to PR-C2-pre implementation prompt with all 10 conditions encoded as binding requirements. PR-C2 implementation prompt blocked until PR-C2-pre lands and bakes in production.**

---

## 8. Five binding decisions for ownership

All five locked per billing-guardian's recommendations.

### D-1 — `stripe_events` PK design

**LOCKED: (b) surrogate UUID PK + unique compound index `(tenant_id, event_id)`.**

Mirrors all 30+ existing entity conventions. Doesn't expose Stripe's event ID format as a primary key.

### D-2 — Retention policy

**LOCKED: (d) defer retention/prune logic to a follow-up PR.**

PR-C2-pre's migration includes a TODO comment referencing the follow-up. No prune cron in PR-C2-pre. Bikeshed risk is real; near-term volume is bounded.

### D-3 — Dedup placement

**LOCKED: (a) entry-point in `handleWebhook` at line 392, with `INSERT ... ON CONFLICT DO NOTHING` semantics REQUIRED.**

Naive `findOne + save` is rejected — TOCTOU race under concurrent webhook delivery. Atomic INSERT with `RETURNING` is the only safe pattern.

### D-4 — Defense-in-depth Site 4 guard

**LOCKED: (b) BOTH layers — entry-point dedup AND Site 4 internal `paymentRepo.findOne({ where: { stripe_payment_intent_id } })` guard. NON-NEGOTIABLE for money-movement.**

Three failure scenarios that entry-point dedup alone does NOT cover (crash mid-handler, future bug in dedup logic, concurrent webhook delivery TOCTOU). The `paymentRepo.findOne` guard is one indexed lookup; cost is negligible; blast radius of missing it is direct customer overcharge.

### D-5 — PR shape

**LOCKED: (b) two-PR split.**

- **PR-C2-pre** — `012_stripe_events_dedup.sql` migration + `StripeEvent` entity + entry-point dedup INSERT in `handleWebhook` + tests asserting duplicate event-id rejection. NO Sites 3/4 replacements.
- **PR-C2** — Replace Site 3 bypass with `reconcileBalance()`. Replace Site 4 bypass with `paymentRepo.findOne` guard + `reconcileBalance()`. End-state parity tests.

PR-C2-pre lands and bakes in production BEFORE PR-C2 ships. Rollback granularity is preserved (revert PR-C2 alone keeps the dedup table).

---

## 9. Recommended PR shape

### 9.1 PR-C2-pre — table + entry-point guard

| Component | Description |
|---|---|
| `api/migrations/012_stripe_events_dedup.sql` | New migration. Apply via Supabase SQL editor BEFORE API deploy. |
| `api/src/modules/stripe/entities/stripe-event.entity.ts` | NEW entity. Surrogate UUID PK + `@Index('idx_stripe_events_event', ['tenant_id', 'event_id'], { unique: true })`. Nullable `tenant_id` documented for `account.updated`. |
| `api/src/modules/stripe/stripe.module.ts` | Add `StripeEvent` to `TypeOrmModule.forFeature`. |
| `api/src/modules/stripe/stripe.service.ts:392` | Insert atomic dedup INSERT (`INSERT ... ON CONFLICT DO NOTHING RETURNING id`) before the `switch (event.type)`. |
| `api/src/modules/stripe/stripe.service.spec.ts` | New tests: duplicate event-id rejected at entry point; signed events processed once. |
| `CLAUDE.md` | Status update under existing reconcileBalance bypass section: PR-C2-pre shipped. |

### 9.2 PR-C2 — Sites 3 + 4 replacements

| Component | Description |
|---|---|
| `stripe.service.ts:403-408` | Replace Site 3 bypass write with `await this.invoiceService.reconcileBalance(invId)`. |
| `stripe.service.ts:446-455` | Wrap Site 4 `paymentRepo.save` in `findOne({ where: { stripe_payment_intent_id } })` guard. |
| `stripe.service.ts:459-464` | Replace Site 4 bypass write with `await this.invoiceService.reconcileBalance(invId)`. |
| `stripe.service.spec.ts` | Tests: Site 3 end-state matches sync `chargeInvoice` end-state; Site 4 end-state with single delivery matches Site 4 with redelivery (no duplicate Payment rows); Site 4 internal guard rejects duplicate `stripe_payment_intent_id`. |
| `CLAUDE.md` | Status update marking PR-C2 shipped — entire reconcileBalance bypass arc closed. |

### 9.3 Sequencing

1. **PR-C2-pre** — ship + bake in production. Verify dedup INSERT works under live webhook traffic via observability (`stripe_events` row count over time, no duplicate event_ids).
2. **PR-C2** — only after PR-C2-pre is live and observed working. Rolls in the bypass replacements + Site 4 internal guard.

If PR-C2-pre's dedup logic misbehaves, revert PR-C2-pre alone — Sites 3 + 4 are unchanged from current state.

If PR-C2's bypass replacements misbehave, revert PR-C2 alone — the dedup table + entry-point guard remain in place.

### 9.4 Test boundary

PR-C2-pre tests are pure dedup-correctness assertions (event-id replay scenarios). PR-C2 tests are end-state-parity assertions (`reconcileBalance` produces the same invoice columns the bypass would have). The two test concerns are independent and the split matches that natural boundary.

### 9.5 Why not single-PR

Single PR would bundle: migration + new entity + entry-point dedup + Site 4 internal guard + Sites 3 + 4 bypass replacements = at least 5 distinct correctness surfaces. Reviewer fatigue compounds. Splitting also enables incremental rollback granularity.

---

## 10. References + open follow-ups

### References

- `docs/audits/2026-04-30-pr-c-audit-final.md` — PR #13 PR-C audit
- `docs/audits/2026-04-30-stripe-idempotency-audit.md` — PR-C1b audit
- `docs/audits/2026-04-30-reconcilebalance-bypass-audit.md` — PR #19 audit
- PR #17 — PR-C1b-1 idempotency keys
- PR #20 — PR-C1c-pre math fix + isFullyRefunded helper
- PR #21 — PR-C1c sync bypass replacements
- CLAUDE.md "Invoice rules" #1, "Deployment rules" lines 36-38

### Open follow-ups (NOT in PR-C2-pre or PR-C2)

1. **CLAUDE.md `synchronize` correction (separate doc-only PR).** CLAUDE.md line 38 says "TypeORM `synchronize: true` is on in production" but `api/src/app.module.ts:74-79` shows `synchronize: isTest` (TRUE only when `NODE_ENV === 'test'`). Production has `synchronize: false`. The CLAUDE.md rule's intent — "manual ALTER TABLE in Supabase BEFORE API deploy" — remains correct, but the premise is stale. Submit a doc-only PR correcting line 38. **Do NOT bundle into PR-C2 or PR-C2-pre.**

2. **`stripe_events` retention prune (D-2 follow-up).** Add a cron / background job to prune rows older than ~90 days once production volume warrants it. Decisions: retention window, soft-delete vs hard-delete, tenant-isolation of the prune query.

3. **`account.updated` tenant resolution.** Currently `tenant_id=NULL` for these rare cross-tenant events; dedup is best-effort. If volume grows or dedup correctness becomes critical, add a Connect-account-id reverse-lookup BEFORE the dedup INSERT.

4. **Pessimistic invoice-row lock (PR-C1d).** Separate hardening for `chargeInvoice` / `refundInvoice` controller routes. Out of scope for this audit.

5. **`subscriptions.service.ts` SSoT arc.** Separate audit. Out of scope.

6. **P1 Stripe sites idempotency** (`customers.create`, `setupIntents.create`, etc.). Out of scope.

7. **Lifecycle-semantics arc** (`'partially_completed'` enum). Out of scope.
