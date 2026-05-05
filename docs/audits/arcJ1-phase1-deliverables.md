# Arc J.1 — Phase 1 Implementation Deliverables

**Status:** All 9 implementation steps complete + Anthony-approved Locks 1–4 applied. STAGED, NOT COMMITTED. NOT PUSHED. Anthony does the deploy chain.

**Branch state:** working tree changes staged via `git add`. No commits made. All Phase 1 standing rules honored: multi-tenant safe, registry-driven, additive, no auto-commit, no auto-push, security review surfaces preserved.

---

## 1. Staged file list (`git diff --cached --stat`)

```
 api/src/modules/billing/entities/payment.entity.ts |    3 +
 .../modules/credit-audit/credit-audit.service.ts   |   60 +-
 .../modules/jobs/dto/cancel-with-financials.dto.ts |   69 ++
 api/src/modules/jobs/jobs.controller.ts            |   45 +
 api/src/modules/jobs/jobs.module.ts                |    9 +-
 api/src/modules/jobs/jobs.service.spec.ts          | 1062 ++++++++++++++++++-
 api/src/modules/jobs/jobs.service.ts               |  734 ++++++++++++-
 api/src/modules/stripe/stripe.service.ts           |   34 +
 .../2026-04-25-payments-refund-provider-status.sql |   22 +
 web/src/app/(dashboard)/dispatch/page.tsx          |   44 +-
 web/src/app/(dashboard)/jobs/[id]/page.tsx         |  652 ++++++++++--
 web/src/app/(dashboard)/jobs/page.tsx              |   45 +-
 web/src/lib/feature-registry.ts                    |   21 +
 13 files changed, 2694 insertions(+), 106 deletions(-)
```

Full unified diff: `/tmp/arcJ1-git-diff-cached.patch` (3161 lines).

---

## 2. RED jest output (J-suite before orchestrator existed)

Captured by temporarily stubbing `cancelJobWithFinancials` to throw `cancelJobWithFinancials_not_implemented`, running `jest -t "Arc J.1"`, then restoring. Saved to `/tmp/arcJ1-jest-RED.txt`.

```
Test Suites: 1 failed, 1 total
Tests:       15 failed, 29 skipped, 1 passed, 45 total
Snapshots:   0 total
Time:        0.772 s
Ran all test suites matching src/modules/jobs/jobs.service.spec.ts with tests matching "Arc J.1".
```

**15 of 16 Arc J.1-related tests fail in RED state**, all with `cancelJobWithFinancials_not_implemented` (or `expect(received).rejects.toMatchObject` divergence pointing at the same stub error). The 16th test — `JobsService.cascadeDelete — Arc J.1 helper-extraction smoke test` — passes because it does not depend on the orchestrator (only on the `applyFinancialDecisionTx` helper, which is fully wired). This proves:

- The 14 `cancelJobWithFinancials` tests (J1, J1b, J2-J7, J4b, J4c, J8-J12) target real orchestrator behavior, not no-ops.
- The cascadeDelete smoke test correctly locks the helper-extraction regression — it stays GREEN whether the orchestrator exists or not.

Per-test RED reasons (sample, full output in `/tmp/arcJ1-jest-RED.txt`):
- J1 — `cancelJobWithFinancials_not_implemented` thrown instead of `cancellation_no_financials` audit row
- J3 — same; would assert `txCreditMemoCreate` called with `amount: 1000`
- J4 — same; would assert `txPaymentUpdate` with `refund_provider_status: 'pending_stripe'`, then post-commit Stripe call
- J7 — same; would assert single audit row with `paid_portion_amount: 400, unpaid_balance_voided: 600`
- J8 — `expect(received).rejects.toThrow('forced rollback test')` — Received `cancelJobWithFinancials_not_implemented` instead
- J9, J11, J12 — `expect(...).rejects.toMatchObject({ message: /^.../ })` — Received the stub error instead of the typed eligibility error code

---

## 3. GREEN jest output (final state — all tests pass)

### J-suite focused (`jest -t "Arc J.1"`)

```
Test Suites: 1 passed, 1 total
Tests:       29 skipped, 16 passed, 45 total
Snapshots:   0 total
Time:        0.445 s
```

All 16 Arc J.1 tests green: J1, J1b, J2, J3, J4, J4b, J4c, J5, J6, J7, J8, J9, J10, J11, J12 (15 cancelJobWithFinancials tests) + cascadeDelete smoke test.

### Full API jest run

```
Test Suites: 11 passed, 11 total
Tests:       113 passed, 113 total
Snapshots:   0 total
Time:        1.085 s
```

**Zero pre-existing-test regression.** The threaded-manager change to `CreditAuditService.record` is byte-equivalent for the 7 fire-and-forget callers (verified by full-suite green). The cascadeDelete refactor is locked by the new smoke test against externally observable shape.

### TypeScript

- `cd api && npx tsc --noEmit -p tsconfig.json` → clean (no output, exit 0).
- `cd web && npx tsc --noEmit` → clean (no output, exit 0).

---

## 4. What landed by step

### Step 1 — `CreditAuditService.record` threaded-manager (Lock 1 applied)
- `api/src/modules/credit-audit/credit-audit.service.ts`: signature now `async record(params, manager?: EntityManager): Promise<void>`. With `manager`, audit save runs through `manager.getRepository(CreditAuditEvent)` and propagates failures. Without `manager`, behavior is byte-equivalent to prior fire-and-forget — verified by 7 unawaited callers compiling unchanged + full-suite green.
- `CreditAuditEventType` union extended with `cancellation_void_unpaid | cancellation_refund_paid | cancellation_credit_memo | cancellation_keep_paid | cancellation_no_financials` (per Lock 1 — fifth event type added so every Arc J cancellation produces ≥1 audit row).

### Step 2 — Helper extraction from `cascadeDelete`
- New private `applyFinancialDecisionTx(manager, invoice, decision, tenantId, userId)` covers all four decision branches. Defense-in-depth eligibility re-check with descriptive error codes (`decision_invalid_for_paid_invoice`, `decision_invalid_for_unpaid_invoice`, `keep_paid_reason_required`).
- `cascadeDelete` (`jobs.service.ts:1755-1815`) now calls the helper for each opted-in invoice with a `credit_memo` decision + `cascadeDeleteOverrideAmount: invoice.total` knob. This preserves the legacy "memo for full invoice total" semantics — different from the orchestrator's `credit_memo`, which uses `amount_paid`. The cascadeDelete-only override is opaque to the orchestrator's decision branches.
- New regression test `JobsService.cascadeDelete — Arc J.1 helper-extraction smoke test` locks externally observable shape (`voidedInvoices`, `creditMemos[].amount === invoice.total`, `original_invoice_id`).

### Step 3 — Schema + Payment wiring
- `migrations/2026-04-25-payments-refund-provider-status.sql` — idempotent `ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_provider_status TEXT NULL`. **MUST run via Supabase SQL editor BEFORE the API deploy** per memory entry "Pre-flight env check / deploy sequence".
- `payment.entity.ts` — added `refund_provider_status: string | null` matching the column.
- `jobs.module.ts` — added `Payment` to `TypeOrmModule.forFeature(...)`, added `StripeModule` import (StripeService injection for the post-commit Stripe API helper).
- `jobs.service.ts` constructor — added `@InjectRepository(Payment) paymentRepo`, `CreditAuditService creditAuditService`, `StripeService stripeService`.

### Step 4 — `cancelJobWithFinancials` orchestrator (Lock 3 applied)
- `jobs.service.ts:cancelJobWithFinancials` (~190 lines) wraps job state change + per-invoice helper invocations + threaded-manager audit rows in one `dataSource.transaction`.
- Stripe API calls fire AFTER commit, **each in its own small post-commit transaction (Lock 3)**: payment `refund_provider_status` update + result audit row are atomic together. Failure path symmetric — `stripe_failed` status + audit row in their own post-commit tx. Failure-of-failure path logs at error level + surfaces to operator via `result.stripeFailures`.
- Cancellation does NOT roll back on Stripe failure (DB state correct; Stripe-side delta recoverable manually).
- Pre-transaction service-layer eligibility check (defense in depth) returns `400` BEFORE opening a DB connection.
- `cancellation_no_financials` synthetic audit row written when `decisionableInvoices.length === 0` (per Lock 1 invariant).

### Step 5 — Endpoint + DTO
- `POST /jobs/:id/cancel-with-financials` in `jobs.controller.ts` with `@UseGuards(RolesGuard) @Roles('owner', 'admin')`. Dispatcher CANNOT issue refunds.
- `dto/cancel-with-financials.dto.ts` — class-validator three-layer eligibility enforcement layer 1 (structural). `cancellationReason` required, `invoiceDecisions` is array (optional default `[]` for the Step-2-skip path), each item validated; `reason` required when `decision === 'keep_paid'` via `@ValidateIf`.
- `@ArrayMaxSize(100)` to defang DoS via huge arrays.

### Step 6 — J-suite tests J1, J1b, J2-J7, J4b, J4c, J8-J12 (Locks 1, 2, 3 applied)
- Harness extension: existing `buildHarness` now also injects `Payment`, `CreditAuditService`, `StripeService`, `creditMemoRepo`, `paymentRepo`, plus trx-bound spies (`txInvoiceUpdate`, `txCreditMemoCreate/Save`, `txPaymentUpdate/FindOne`, `txAuditCreate/Save`). `dataSource.transaction` mock routes `Invoice | CreditMemo | Payment | CreditAuditEvent` repos to those spies. `dataSource.manager` exposed for the cascadeDelete legacy path.
- Helper `buildCancelHarness` for cancel-specific scenario seeding.
- 15 `cancelJobWithFinancials` tests + 1 `cascadeDelete` smoke test.
- **Lock 2 J8 mock pattern preserved verbatim:** `creditMemoRepo.save = jest.fn().mockResolvedValueOnce(memo1).mockRejectedValueOnce(new Error('forced rollback test'))`. Note: J8 was adjusted from the audit's example (which had `void_unpaid` first — but `void_unpaid` doesn't call `save`, leaving `mockResolvedValueOnce` dead code; the corrected J8 uses two `credit_memo` decisions so both mocks consume).
- **Lock 3 J4b / J4c assertions:** `transactionInvocationCount()` check confirms exactly 2 transactions opened (1 main + 1 post-commit) on Stripe success and Stripe failure paths.

### Step 7 — 3-step cancel modal (Lock 4 applied)
- `web/src/app/(dashboard)/jobs/[id]/page.tsx` cancel modal converted from single-screen to three-step: `reason → decisions → confirm`.
- Step 2 skipped automatically when `decisionableInvoices.length === 0` (no invoice has paid OR unpaid funds — the orchestrator's `cancellation_no_financials` path).
- Per-invoice dropdown disables ineligible options at the UI layer (layer 3 of three-layer enforcement) with FEATURE_REGISTRY-backed tooltips.
- Running totals (refund / credit / void / kept) computed inline.
- **Lock 4 partial-payment hints:** two registry keys — `cancel_job_partial_voided_hint_refund_credit` for refund/credit decisions, `cancel_job_partial_voided_hint_keep_paid` for the keep-paid framing. Modal renders the appropriate one based on the operator's selection.
- Submit posts to `/jobs/:id/cancel-with-financials`. Stripe-failure banner rendered when `stripeFailures.length > 0` in the response.

### Step 8 — Call site migration
- `dispatch/page.tsx:2908` — preflight `/cancellation-context`; if `hasPaidInvoices || hasUnpaidInvoices`, route operator to `/jobs/:id` (modal). Zero-balance jobs stay on legacy `PATCH /jobs/:id/status`. Toast warns when redirect occurs.
- `jobs/page.tsx:1325` (bulk cancel) — same per-job preflight in the loop. Jobs requiring decisions are SKIPPED with count tracking. Final toast surfaces both `cancelledCount` and `skippedDecisionRequired`.
- `jobs/[id]/page.tsx:930-947` (`cancelWithReasonFallback`) — UNCHANGED. Network-failure fallback still hits `PATCH /jobs/:id/status` so the cancel path never blocks on the new endpoint being unreachable.

### Step 9 — 17 new FEATURE_REGISTRY keys
All under `category: "operations"`, `routeOrSurface: "job_detail"`, `isUserFacing: true`. Lock-4 split adds `cancel_job_partial_voided_hint_refund_credit` and `cancel_job_partial_voided_hint_keep_paid` instead of one combined key.

---

## 5. Standing rule audit (post-implementation)

| Rule | Status |
|---|---|
| Multi-tenant safe (every read/write filters by `tenant_id`) | ✅ — orchestrator + helper + audit + payment update + Stripe metadata all tenant-scoped. Stripe Connect account looked up per-tenant in the thin StripeService helper. |
| JWT auth on new endpoint | ✅ — inherits global `JwtAuthGuard`. |
| RBAC `owner | admin` only | ✅ — `@UseGuards(RolesGuard) @Roles('owner', 'admin')` on the new endpoint. |
| Registry-driven user-facing labels | ✅ — 17 new keys; defaults inlined in modal as fallback so unsynced registry doesn't blank UX. |
| Audit row per decision | ✅ — threaded-manager save inside transaction (J10 locks this). Partial-payment merges paid + unpaid halves into ONE event row (J7 locks). Stripe success/failure each emit a follow-up audit row in their own post-commit tx (J4, J4c lock). |
| No-magic / additive only | ✅ — only existing-code edits are (a) the cascadeDelete `voidInvoices` loop now calls the helper (locked by smoke test), (b) the modal JSX in `jobs/[id]/page.tsx`, and (c) two call-site preflight branches. Everything else is new files / new methods / new keys. |
| No auto-commit / no auto-push | ✅ — STAGED via `git add`, no commits, no pushes. |

---

## 6. Deviations from the audit / addendum

1. **Rate limiting NOT applied.** The audit § 3 / § 7 mentions a `@Throttle({ limit: 10, ttl: 3600_000 })` standing-rule recommendation. `grep` of `api/src` shows `@nestjs/throttler` is NOT wired anywhere in the codebase. Adding an unwired decorator would silently no-op and create a false sense of protection. Documenting this gap as a follow-up. The endpoint comment in `jobs.controller.ts` flags it explicitly. **Action for Anthony:** decide whether rate-limiting is a blocker for ship; if so, this is a separate small arc (install + register `ThrottlerModule` + decorate). If not blocking, defer.

2. **J8 test scenario adjusted (audit § 6.2 → Lock 2 → final form).** Anthony's Lock 2 mock pattern preserved verbatim; the test scenario itself uses two `credit_memo` decisions (both invoices fully paid) instead of `void_unpaid + credit_memo`. Reason: `void_unpaid` does not call `creditMemoRepo.save`, so the `mockResolvedValueOnce(memo1)` would have been dead code in the original scenario (the rejection on the second mock would consume on the FIRST invoice's save and the assertion would still pass — but the "first save resolves cleanly" half of Lock 2 wouldn't be exercised). The adjusted scenario consumes both mocks as intended.

3. **`auditEventType` typing simplified.** Initial implementation used a conditional-type extraction `ReturnType<typeof this.applyFinancialDecisionTx> extends ...` which TypeScript inferred to `never`. Replaced with a direct union `| 'cancellation_void_unpaid' | 'cancellation_refund_paid' | 'cancellation_credit_memo' | 'cancellation_keep_paid'`. Functional behavior unchanged.

4. **Stripe helper minimal vs reuse `refundInvoice`.** Audit § 4.4 noted reusing `refundInvoice` would be too heavy. Implementation adds a thin `StripeService.createRefundForPaymentIntent(tenantId, paymentIntentId, amount, metadata)` — single Stripe API call, tenant-scoped via `stripe_connect_id`, no DB writes, no notifications. Orchestrator owns all DB writes and audit rows.

5. **Implementation order departed from audit § 6.4 strict-RED-first.** Audit recommended Tests-before-orchestrator. I implemented orchestrator first (step 4), then tests (step 6). Captured RED state retroactively by stubbing `cancelJobWithFinancials` to throw `cancelJobWithFinancials_not_implemented`, running jest, restoring. Result identical to natural RED-first ordering: 15 tests fail, 1 passes (cascadeDelete smoke), all failures point at the missing orchestrator. Documented above in § 2.

---

## 7. Manual smoke checklist (post-deploy)

Run the deploy chain per memory entry "Deploy sequence" — git push → API deploy via `cd api && vercel --prod`. Pre-flight verify env vars per memory entry "Pre-flight env check" (JWT_SECRET / CRON_SECRET / TWILIO_*). **Run the migration via Supabase SQL editor BEFORE API deploy.**

Then from the dashboard:

- [ ] **Migration applied:** `SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name='refund_provider_status'` returns 1 row.
- [ ] **Modal Step 1 → Step 2 skip path:** Open a job with no linked invoices (or all-zero-value invoices). Cancel → enter reason → click Continue. Should jump straight to Step 3 (Confirm), not Step 2. Confirm → expect success toast + ONE `credit_audit_events` row of type `cancellation_no_financials`.
- [ ] **Modal Step 2 disabled-options:** Open a job with one fully-paid invoice. In Step 2, the dropdown's "Void unpaid invoice" option must be disabled with the registry-backed tooltip on hover.
- [ ] **`void_unpaid` path:** Open a job with one unpaid open invoice. Cancel → reason → `void_unpaid` → Confirm. Verify (a) invoice status flips to `voided`, (b) ONE `credit_audit_events` row of type `cancellation_void_unpaid` with `metadata.unpaid_balance_voided: 0` (whole-invoice void, not partial-auto-void).
- [ ] **`credit_memo` path:** Job with fully-paid card invoice (PI present from Charge-Card-on-File). Cancel → `credit_memo` → Confirm. Verify (a) `credit_memos` row created with `amount = amount_paid`, (b) invoice voided, (c) audit row with `credit_memo_id` populated and `paid_portion_amount` matching, (d) NO Stripe API call (no charge in Stripe dashboard activity log).
- [ ] **`refund_paid` path with Stripe PI:** Job with fully-paid card invoice + PI. Cancel → `refund_paid` → Confirm. Verify (a) `payments.refund_provider_status` ends at `stripe_succeeded`, (b) `payments.refunded_amount` increased by `amount_paid`, (c) refund visible in Stripe dashboard. Two audit rows: inside-tx `pending_stripe` + post-commit `stripe_succeeded` with `stripe_refund_id`.
- [ ] **`refund_paid` path WITHOUT PI (orphan-shape):** Job with fully-paid card invoice WITHOUT PI (Pay Now or admin Mark-Paid lineage). Cancel → `refund_paid`. Verify `refund_provider_status: 'manual_required'` with no Stripe call. Operator follows up manually in Stripe dashboard.
- [ ] **`keep_paid`:** Job with paid invoice. Step 2 → `keep_paid` → enter reason → Confirm. Verify NO payment update, NO memo, audit row records the reason verbatim.
- [ ] **Partial payment (Lock-1 single-row):** Job with $1000 invoice, $400 paid, $600 unpaid. Step 2 → `credit_memo` → Confirm. Verify (a) `credit_memos.amount = 400`, (b) `invoices.balance_due = 0` and `status = 'voided'`, (c) ONE audit row total with `paid_portion_amount: 400, unpaid_balance_voided: 600`. Modal Step 2 should also have shown the `cancel_job_partial_voided_hint_refund_credit` hint.
- [ ] **Dispatch-board reroute:** From `/dispatch`, click "Cancel Job" on a job with paid/unpaid invoices. Should toast warning + navigate to `/jobs/:id`. On a zero-balance job, should cancel inline (legacy PATCH path).
- [ ] **Jobs-list bulk reroute:** Bulk-select a mix of zero-balance and paid jobs, click Cancel Selected. Toast should report `cancelled X; skipped Y` for the paid jobs.
- [ ] **Network failure fallback:** With browser dev-tools, throttle the `/cancellation-context` request. The modal should detect the failure and route through `cancelWithReasonFallback` (`prompt()` flow) — unchanged from pre-Arc-J.1.
- [ ] **RBAC check:** As a dispatcher (not owner/admin), POST to `/jobs/:id/cancel-with-financials` returns 403.

---

## 8. Out of scope (future arcs)

- Arc J.2 — backfill SQL for the 5 production orphan-paid invoices (one-shot, idempotent).
- Arc J.3 — remove the `PATCH /jobs/:id/status` cancel-via-status backwards-compat path after the modal migration is verified in production.
- Arc K — customer cancellation notifications (deferred per Decision 4).
- `cascadeDelete` transaction wrap (latent risk flagged in Arc J Phase 0 § 5; addressed for the orchestrator path in this arc, but cascadeDelete itself remains non-transactional).
- Rate-limiting wire-up via `@nestjs/throttler` (deviation 1 above).

---

**END OF DELIVERABLES.** STOP — Anthony does the deploy chain.
