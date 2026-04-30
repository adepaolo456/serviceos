# Stripe Idempotency Audit (PR-C1b) — 2026-04-30

## Context

PR #16 (`e19f81d`) closed Surface 2 cancellation race at the **app level** — `lockJobRow` serializes concurrent ServiceOS callers. It does NOT close Stripe **provider-level** retry idempotency: a single ServiceOS caller whose request to `stripe.refunds.create` succeeds at Stripe but loses the response can retry and double-charge / double-refund the customer. PR #13 (PR-C audit) flagged "zero idempotency keys" across all Stripe write call sites. This audit verifies that finding, classifies each call site, proposes deterministic key shapes, identifies wrapper layers, documents the test mock pattern, and gets billing-guardian sign-off on the implementation shape.

References:
- PR-C audit: `docs/audits/2026-04-30-pr-c-audit-final.md` (PR #13)
- PR-C1a (lock + chain closure): `e19f81d` (PR #16)

---

## Phase 0 — Stripe write call site inventory

| File:Line | API method | Containing function | Public-facing? |
|---|---|---|---|
| `api/src/modules/stripe/stripe.service.ts:55` | `refunds.create` | `createRefundForPaymentIntent` | No (called from jobs.service.ts:4847 post-commit) |
| `api/src/modules/stripe/stripe.service.ts:166` | `paymentIntents.create` (with `confirm: true` inline) | `chargeInvoice` | **Yes** — POST `/stripe/charge-invoice/{invoiceId}` |
| `api/src/modules/stripe/stripe.service.ts:234` | `refunds.create` | `refundInvoice` | **Yes** — POST `/stripe/refund/{invoiceId}` |
| `api/src/modules/stripe/stripe.service.ts:120` | `customers.create` | `getOrCreateStripeCustomer` | No (internal) |
| `api/src/modules/stripe/stripe.service.ts:135` | `setupIntents.create` | `createSetupIntent` | **Yes** — POST `/stripe/setup-intent` |
| `api/src/modules/stripe/stripe.service.ts:450` | `customers.create` | `subscribe` | **Yes** — POST `/stripe/subscribe` |
| `api/src/modules/stripe/stripe.service.ts:459` | `subscriptions.create` | `subscribe` | **Yes** — POST `/stripe/subscribe` |
| `api/src/modules/stripe/stripe.service.ts:488` | `subscriptions.update` | `cancelSubscription` | **Yes** — POST `/stripe/cancel-subscription` |
| `api/src/modules/stripe/stripe.service.ts:500` | `billingPortal.sessions.create` | `getBillingPortalUrl` | **Yes** — GET `/stripe/billing-portal` |
| `api/src/modules/stripe/stripe.service.ts:525` | `subscriptionItems.update` | `updateDriverCount` | No (internal) |
| `api/src/modules/stripe/stripe.service.ts:74,83` | `accounts.create`, `accountLinks.create` | `onboardConnect` | **Yes** — POST `/stripe/connect/onboard` |
| `api/src/modules/subscriptions/subscriptions.service.ts:72,84,95,121` | `customers.create`, `prices.create`, `checkout.sessions.create`, `billingPortal.sessions.create` | `createCheckoutSession`, `createPortalSession` | Unclear — appears legacy parallel module |
| `api/src/modules/portal/portal.service.ts:1175` | `checkout.sessions.create` | `preparePayment` | **Yes** — portal payment prep |

**Indirect call site (via wrapper):** `api/src/modules/jobs/jobs.service.ts:4847` calls `this.stripeService.createRefundForPaymentIntent` which wraps `refunds.create` at stripe.service.ts:55.

---

## Phase 1 — P0 / P1 / P2 classification + retry exposure

### P0 — money movement (audit target)

| Site | API method | Caller path | Retry exposure | idempotencyKey today? |
|---|---|---|---|---|
| jobs.service.ts:4847 → stripe.service.ts:55 | `refunds.create` | `POST /jobs/{id}/cancel-with-financials` (owner/admin) → `cancelJobWithFinancials` post-commit refund loop | User-clicks-twice **mitigated by PR-C1a lock**. Network-failure retry **HIGH RISK**. | NO |
| stripe.service.ts:166 | `paymentIntents.create` | `POST /stripe/charge-invoice/{invoiceId}` (auth-only) → `chargeInvoice` | User can click "Charge" twice. Network-failure retry **HIGH RISK**. | NO |
| stripe.service.ts:234 | `refunds.create` | `POST /stripe/refund/{invoiceId}` (auth-only) → `refundInvoice` | User can click "Refund" twice. No app-level lock. Network-failure retry **HIGH RISK**. | NO |
| stripe.service.ts:459 | `subscriptions.create` | `POST /stripe/subscribe` (auth-only) → `subscribe` | Write-after-Stripe race: `tenant.stripe_subscription_id` saved after the create call. Network-failure retry **HIGH RISK** for duplicate recurring billing. | NO |

**Note on Site 4:** original audit framing classified `subscriptions.create` as P1. **Billing-guardian reclassified as P0** — new subscriptions ARE money movement (recurring charges start). The pre-write `if (!stripeCustomerId)` guard at stripe.service.ts:449 does NOT cover the retry race because the success-path DB write at stripe.service.ts:465 happens after the Stripe call.

### P1 — state-mutating but recoverable / lower-risk

| Site | Reason for P1 |
|---|---|
| stripe.service.ts:120 (`customers.create`) | Pre-write guard `if (!customer.stripe_customer_id)` at line 117. Duplicate Stripe customers don't move money. |
| stripe.service.ts:135 (`setupIntents.create`) | Ephemeral client secret, no re-use. |
| stripe.service.ts:450 (`customers.create` in `subscribe`) | Same guard pattern as 120. |
| stripe.service.ts:488 (`subscriptions.update`) | Update-idempotent at Stripe (same `cancel_at_period_end: true` twice → same state). |
| stripe.service.ts:500 (`billingPortal.sessions.create`) | Ephemeral session URL. |
| stripe.service.ts:525 (`subscriptionItems.update`) | Update-idempotent. |
| stripe.service.ts:74,83 (Connect onboarding) | Account creation guarded by `if (!accountId)`; account links ephemeral. |
| portal.service.ts:1175 (`checkout.sessions.create`) | Ephemeral session; webhook dedup (PR-C2) handles the eventual charge race. |
| subscriptions.service.ts:* | Apparent legacy parallel module — usage status unclear; **flagged for separate verification**. |

### P2 — read-only

`stripe.accounts.retrieve` / `stripe.subscriptions.retrieve` / `stripe.paymentMethods.list` — no idempotency relevant.

---

## Phase 2 — Proposed keys per P0 site (post billing-guardian revisions)

### Site 1 — `cancelJobWithFinancials` refund loop

- **Proposed key:** `tenant-{tenantId}:refund:job-{jobId}:payment-{paymentId}`
- **Classification:** (A) derived-only
- **Inputs:** `tenantId` (function param), `jobId` (function param), `paymentId` (from `intent.paymentId` populated by `applyFinancialDecisionTx`)
- **Persistence chain:** `payment.id` is loaded by `paymentRepo.findOne` at `jobs.service.ts:4367-4370`, the Payment row is updated inside the main TX at `jobs.service.ts:4407-4410`, the post-commit Stripe loop runs only after TX commit at `jobs.service.ts:4836`, and the Stripe call at `jobs.service.ts:4847` references the durable `paymentId` from `applyFinancialDecisionTx` at line 4427. **`paymentId` is durably persisted before the Stripe call.**
- **Caveat:** Arc J.1 §7.6 invariant must be locked in code comment — "one Stripe refund per (job, payment) ever." If the deferred multi-refund-accumulation flow ships in the future, this key will need a refund-attempt discriminator.

### Site 2 — `refundInvoice`

- **Proposed key:** `tenant-{tenantId}:refund:invoice-{invoiceId}:payment-{paymentId}:cumulative-{previous_refunded_amount_cents}-{cents}`
- **Classification:** (A) derived-only — **with a code-comment-locked invariant**
- **Inputs:** `tenantId`, `invoiceId` (param), `payment.id` (loaded at stripe.service.ts:225-228), `payment.refunded_amount` snapshot at call time, `amount` (caller-provided)
- **Why `cumulative-`:** the simpler `refund:invoice-{...}:payment-{...}:amount-{cents}` shape silently dedupes legitimate identical-amount partial refunds (e.g., $50 today + $50 tomorrow against the same payment). Including the prior-refunded-amount snapshot makes each subsequent partial refund get a unique key.
- **Alternative (simpler, but constrained):** drop `cumulative-` and lock the invariant in code comment — "one Stripe refund per (invoice, payment, amount) tuple, ever; UI must enforce no duplicate partial refunds at identical amounts." Acceptable if business never legitimately re-refunds the same amount.
- **Recommendation:** ship with `cumulative-` — strictly safer, no UI dependency.

### Site 3 — `chargeInvoice`

- **Proposed key:** `tenant-{tenantId}:charge:invoice-{invoiceId}:balance-{cents}`
- **Classification:** (A) derived-only — **simpler than original audit framing**
- **Inputs:** `tenantId`, `invoiceId` (param), `Math.round(invoice.balance_due * 100)` snapshot at call time
- **Why balance-keyed (not attempt-keyed):**
  - Original audit framing was `charge:invoice-{invoiceId}:attempt-{attemptId}` with a new `payment_attempts` table — **(B) classification, requires migration**.
  - Billing-guardian determined the simpler `charge:invoice-{invoiceId}` alone is unsafe: if first charge fails with `card_declined` and the customer fixes their card, Stripe replays the cached failure response under the same key — **the second charge will NOT fire** (missed-charge risk).
  - `balance-{cents}` distinguishes "retry the same charge" (idempotent dedup) from "balance changed, new charge attempt" (new key) without needing `payment_attempts`.
  - Stripe's idempotency cache replays the cached PaymentIntent response regardless of which `payment_method_id` was sent on the second call — the non-determinism of `paymentMethods.data[0].id` does NOT need to be in the key.

### Site 4 — `subscribe` (subscriptions.create)

- **Proposed key:** `tenant-{tenantId}:subscribe:tier-{tier}:cycle-{billingCycle}`
- **Classification:** (A) derived-only
- **Inputs:** `tenantId`, `tier` (function param), `billingCycle` (function param)
- **Caveat:** must coexist with the existing `if (!stripeCustomerId)` guard at stripe.service.ts:449 — guard catches the "customer already exists" case; key catches the "subscription created at Stripe but DB write missed" case.

### Tenant namespacing — required across ALL 4 sites

Stripe scopes idempotency keys per Stripe account. For Connect tenants (`tenant.stripe_connect_id` set), the `stripeAccount` request option scopes keys naturally. **For non-Connect tenants, the platform-account fallback at stripe.service.ts:61-63 means all tenants share the platform's idempotency namespace.** Without the `tenant-{tenantId}:` prefix, two tenants who happen to use identical job/invoice IDs would collide. Prefix is cheap, the safety upside is real, and it's a one-line construction in every key shape.

### Test-environment namespacing

Recommend prefixing all keys with `${NODE_ENV}-${GIT_SHA||'local'}-` in non-prod environments to avoid Stripe-sandbox cache contamination across test runs (Stripe TTL = 24h). Production keys remain bare.

---

## Phase 3 — Stripe SDK mechanics + wrapper review

**SDK pattern:** `await stripe.refunds.create(payload, { idempotencyKey: 'k', stripeAccount: 'acct_xxx' })` — second arg is a Stripe-specific options object.

**Current wrapper (stripe.service.ts):** every P0 method already passes an options-object 2nd arg conditionally for Connect (`stripeAccount`), but no method accepts an `idempotencyKey` parameter today. Required signature changes:

```typescript
// Site 1
async createRefundForPaymentIntent(
  tenantId, paymentIntentId, amount, metadata,
  idempotencyKey?: string,  // NEW
)

// Site 3
async chargeInvoice(tenantId, invoiceId, idempotencyKey?: string)

// Site 2
async refundInvoice(tenantId, invoiceId, amount?, idempotencyKey?: string)

// Site 4
async subscribe(tenantId, tier, billingCycle, idempotencyKey?: string)
```

**Options-object merge pattern** (replaces the current ternary):
```typescript
}, {
  ...(idempotencyKey ? { idempotencyKey } : {}),
  ...(tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : {}),
}
```

**No retry middleware exists** in StripeService or NestJS interceptors — keys flow through cleanly.

**Logging:** wrapper logs metadata via the audit trail; idempotency keys are not secrets but should not be logged carelessly (no need for redaction, just don't add them to outbound logs).

---

## Phase 4 — Webhook dedup boundary

**Confirmed OUT OF SCOPE for PR-C1b. Scheduled for PR-C2.**

Webhook handler: `api/src/modules/stripe/stripe.service.ts:266-364` (`handleWebhook`), exposed at `api/src/modules/stripe/stripe.controller.ts:89-92` (`POST /stripe/webhook`, `@Public()`).

Events handled (no event-ID dedup currently):
- `payment_intent.succeeded` (line 279-296)
- `payment_intent.payment_failed` (line 298-317)
- `checkout.session.completed` (line 319-351)
- `account.updated` (line 354-359)

PR-C2 will introduce a `stripe_webhook_events` table with unique constraint on `(tenant_id, stripe_event_id)`, dispatched from the first line of `handleWebhook`.

**Conceptual distinction (audit-relevant):**
- **Outbound idempotency keys (PR-C1b):** prevent Stripe from processing the same ServiceOS request twice.
- **Webhook event dedup (PR-C2):** prevent ServiceOS from processing the same Stripe event twice.
- Different layers, different fixes.

---

## Phase 5 — Test strategy + existing mock pattern

### Existing patterns

**stripe.service.spec.ts** (224 lines): direct Stripe SDK mocked via `(service as any).stripe = stripeMock`, where `stripeMock = { paymentIntents: { create: jest.fn() }, ... }`. Assertions today capture only the **first argument** (payload) at `.mock.calls[0]` — second arg (options) is dropped.

**jobs.service.spec.ts**: StripeService is mocked as a NestJS provider via `useValue: { createRefundForPaymentIntent: jest.fn().mockResolvedValue({...}) }`. Assertions on the wrapper method's parameters, not the underlying SDK call.

### Required changes for PR-C1b tests

For stripe.service.spec.ts:
```typescript
const [piPayload, piOptions] = h.stripeMock.paymentIntents.create.mock.calls[0];
expect(piOptions).toEqual(
  expect.objectContaining({
    idempotencyKey: 'tenant-tenant-1:charge:invoice-inv-1:balance-5000',
  })
);
```

For jobs.service.spec.ts:
```typescript
expect(h.stripeService.createRefundForPaymentIntent).toHaveBeenCalledWith(
  'tenant-1',
  'pi_card_4',
  750,
  expect.objectContaining({ invoiceId: 'inv-4' }),
  expect.stringMatching(/^tenant-tenant-1:refund:job-.*:payment-.*$/),
);
```

### Stripe-side conflict simulation

Mock-level test: simulate `StripeIdempotencyError` (Stripe's response when an idempotency conflict is detected — same key replayed with different request body). ServiceOS should treat this as success because the original call succeeded at Stripe; current code does not have this branch and would surface the error to the caller. Either swallow with logging or document acceptance behavior.

---

## Phase 6 — Billing-guardian verbatim verdict

> ## Verdict: BLOCK on PR-C1b-as-proposed; PASS on PR-C1b-1 reframed.
>
> Block reasons:
> 1. Site 3 key shape (`attempt-{attemptId}`) introduces a new table that is not needed — the simpler balance-keyed shape works.
> 2. `subscriptions.create` was incorrectly deferred to P1; new subscriptions ARE money movement and the existing guard has a write-after-Stripe race.
> 3. Tenant namespacing on the platform-account path is missing from the proposal and is required for safety.
> 4. Site 2 key needs a code-comment-locked invariant or a discriminator — silent dedup of legitimate identical-amount partial refunds is a missed-charge risk in a fully-paid customer scenario.

### Critical scope-finding from billing-guardian (NOT in PR-C1b scope, but flagged)

`reconcileBalance()` bypass — direct writes to `invoice.amount_paid` / `invoice.balance_due` / `invoice.status` at:
- `stripe.service.ts:194-199` (chargeInvoice)
- `stripe.service.ts:251-255` (refundInvoice)
- `stripe.service.ts:288-293` (webhook payment_intent.succeeded)
- `stripe.service.ts:344-349` (webhook checkout.session.completed)

These violate the inviolable invoice rule from CLAUDE.md: **"`reconcileBalance()` is the ONLY way to set `invoice_status` / `amount_paid` / `balance_due`. Never set directly."** PR-C1b must NOT touch these (scope discipline) but the violation must be tracked. Likely landing point: PR-C2 alongside webhook dedup, or a dedicated PR before PR-C2.

### Webhook race risk (PR-C2 scope)

`payment_intent.succeeded` webhook reads `paymentRepo.find` and writes `invoice.amount_paid` directly while `chargeInvoice`'s synchronous flow does the same. If both arrive interleaved, two unsynchronized writers update the same invoice columns. Idempotency keys do NOT solve this — needs row-level locking or a single derived path through `reconcileBalance()`.

### Connect tenant namespacing

Connect tenants get natural per-account isolation via `stripeAccount` in request options. Non-Connect tenants share the platform account's idempotency namespace — hence the `tenant-{tenantId}:` prefix is mandatory.

---

## Recommended implementation shape

**PR-C1b-1** (proposed scope):
- All 4 P0 sites (1: cancellation refund, 2: refundInvoice, 3: chargeInvoice, 4: subscribe)
- All keys (A)-derived, no migration
- `idempotencyKey?: string` parameter added to all 4 StripeService method signatures
- Options-object merge pattern (preserves existing `stripeAccount` Connect path)
- Tenant namespacing prefix `tenant-{tenantId}:` on every key
- Non-prod environment prefix `${NODE_ENV}-${GIT_SHA||'local'}-` to avoid sandbox cache contamination
- Test mock extensions to assert 2nd-arg options object
- Code comments locking:
  - Site 1: Arc J.1 §7.6 single-refund-per-payment-per-cancellation invariant
  - Site 2: cumulative-amount discriminator semantic (or "one refund per amount" invariant if dropping)

**Out of scope (separate PRs):**
- `reconcileBalance()` bypass fixes — PR-C2 or dedicated PR before PR-C2
- Webhook event dedup — PR-C2
- `credit_memos` uniqueness migration — PR-C2
- P1 sites (customers.create, setupIntents.create, etc.) — future hardening
- `subscriptions.service.ts` legacy parallel module — needs separate verification of usage status before any audit work
- `getClient()` consumers (Stripe Checkout module) — quick P1 follow-up grep

**Proposed PR shape:** **single PR (PR-C1b-1) covering all 4 P0 sites** since all are (A)-derivable with no migration. The earlier "split" framing was driven by the assumed `payment_attempts` table for Site 3 — the balance-keyed shape eliminates that need.

---

## Open gating questions

These need explicit answers before the implementation prompt is drafted:

**Q1 — Site 2 key shape:**
- (a) Ship with `cumulative-{previous_refunded_cents}-{cents}` (strictly safer, no UI dependency, slightly more complex code), or
- (b) Ship with simpler `:amount-{cents}` and lock the "no duplicate partial refunds at identical amounts ever" invariant in a code comment + UI gate?

**Q2 — Site 1 caveat documentation:**
The Arc J.1 §7.6 invariant ("one Stripe refund per (job, payment) ever") needs to be locked in a code comment near the key generation. Confirm: should the comment explicitly forbid the deferred multi-refund-accumulation flow without first updating this key shape?

**Q3 — Site 4 (subscriptions.create) inclusion:**
Billing-guardian reclassified as P0. Confirm:
- (a) Include in PR-C1b-1 (4 sites total), or
- (b) Defer to a separate small PR (PR-C1b-2) so PR-C1b-1 stays tightly scoped to the 3 originally-audited sites?

**Q4 — Test environment namespacing:**
- (a) Add `${NODE_ENV}-${GIT_SHA||'local'}-` prefix in non-prod (cleaner test isolation, ~3-line code addition, env-conditional), or
- (b) Skip — rely on per-PR Stripe sandbox accounts to avoid contamination?

**Q5 — `reconcileBalance()` bypass scope:**
Billing-guardian flagged 4 violations of the inviolable invoice rule outside PR-C1b's scope. Options:
- (a) Track in CLAUDE.md follow-up, address in PR-C2 alongside webhook dedup
- (b) Dedicated PR before PR-C2 (call it PR-C1c?) so PR-C2 is purely about event-level concerns
- (c) Track in a separate audit doc with billing-guardian-led design before any implementation

**Q6 — `StripeIdempotencyError` handling in tests:**
When Stripe returns an idempotency conflict (same key, different request body), should ServiceOS:
- (a) Treat as success (Stripe-side state is the source of truth — the original call succeeded), log and continue
- (b) Surface the error to the caller (forces the caller to investigate; safer if request bodies should never legitimately differ across retries)

**Q7 — `subscriptions.service.ts` legacy module:**
The audit found `customers.create`, `prices.create`, `checkout.sessions.create`, and `billingPortal.sessions.create` calls in this file but couldn't confirm whether the module is live or dead code. Options:
- (a) Quick verification grep (fast)
- (b) Defer entirely — out of PR-C1b scope regardless

**Q8 — `@Roles` hardening on stripe.controller.ts:**
The chargeInvoice and refundInvoice routes are auth-only with no role gate (unlike cancelJobWithFinancials which is owner/admin). Should PR-C1b-1 also add `@Roles('owner', 'admin')` to those routes, or is that a separate hardening item out of scope?

---

## Verdict summary

**STATUS: BLOCK on PR-C1b-as-originally-framed; READY for PR-C1b-1 reframed pending answers to gating questions.**

**Reframing summary:**
- Sites: 3 → 4 (added `subscriptions.create`)
- Site 3 key: `attempt-{attemptId}` (with new table) → `balance-{cents}` (no table)
- Tenant namespacing: missing from original framing → mandatory in all keys
- Test-env namespacing: missing → recommended
- `reconcileBalance` bypass: surfaced as separate scope item (NOT PR-C1b)

After Q1-Q8 are answered, the implementation prompt for PR-C1b-1 can be drafted.
