# Arc J.1 — Phase 0 Audit Report

**Status:** Read-only code archaeology for the `cancelJobWithFinancials` orchestrator + in-modal financial stepper. No code, schema, or DB changes made. Findings ground every Phase 1 design decision in current ServiceOS source — no guessed APIs.

**References Phase 0 of Arc J:** `~/serviceos/arcJ-phase0-audit-report.md` (cited where its findings remain authoritative; this report extends rather than restates).

---

## Exec summary (5 bullets)

1. **The financial helper extraction is straightforward.** The void-invoice + credit-memo sequence in `cascadeDelete` is a tight 30-line block (`jobs.service.ts:1755-1797`) with no scattered side branches. A single private `applyFinancialDecisionTx(manager, invoice, decision, tenantId, userId)` lifts cleanly; `cascadeDelete` keeps its current loop and calls the helper per opted-in invoice.
2. **`payments.refund_provider_status` does NOT exist.** The Payment entity (`api/src/modules/billing/entities/payment.entity.ts`) has only `refunded_amount` (line 48). A single ALTER TABLE adding the column is the one schema add Phase 1 needs — must run via Supabase SQL editor BEFORE the API deploy per memory entry "Pre-flight env check / deploy sequence".
3. **`Payment` is not currently wired into `JobsService`.** It is not in `TypeOrmModule.forFeature([...])` (`jobs.module.ts`) and not constructor-injected. Phase 1 must add `Payment` to the module's `forFeature` array AND `@InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>` to the service constructor before the new orchestrator can update `refunded_amount` / `refund_provider_status`.
4. **Threading `manager` through `CreditAuditService.record` is a strictly additive change.** The current signature accepts a `RecordAuditParams` object and returns `void`. Adding an optional second arg `manager?: EntityManager` and routing the save through `manager.getRepository(CreditAuditEvent).save(event)` when present preserves byte-equivalent behavior for the 5 existing fire-and-forget call sites. The four new `cancellation_*` event types extend the union additively.
5. **Three call sites need migration to the new endpoint, one does not.** The full-modal cancel on `jobs/[id]/page.tsx:986-1007` migrates to a 3-step modal calling the new endpoint. The dispatch-board inline cancel (`dispatch/page.tsx:2908`) and the jobs-list bulk cancel (`jobs/page.tsx:1325`) — both terse `confirm()` paths — should call the existing `PATCH /jobs/:id/status` ONLY when the cancellation context shows zero paid AND zero unpaid invoices; otherwise they should open the new modal pre-loaded with the target job (i.e., the inline confirm reroutes into the modal flow). The legacy `cancelWithReasonFallback` at `jobs/[id]/page.tsx:930-947` stays as the network-failure fallback, unchanged.

---

## § 1. Helper extraction plan

### 1.1 Source-of-truth lines in `cascadeDelete`

`api/src/modules/jobs/jobs.service.ts:1586-1806` — the only existing path that voids invoices and creates credit memos. Confirmed by `grep`: no other writer to `credit_memos` exists in the API.

The financial-decision block:
- **Invoice void** (`:1765-1769`): `invoiceRepo.update(invoice.id, { status: 'voided', voided_at: now, balance_due: 0 })`
- **Credit memo create** (`:1773-1782`): `creditMemoRepo.create({ tenant_id, original_invoice_id, customer_id, amount: invoice.total, reason, status: 'issued', created_by: userId })` then `creditMemoRepo.save(memo)`
- **Rental chain cancel** (`:1787-1797`): per chain — `rentalChainRepo.update({ id: chainId, tenant_id }, { status: 'cancelled' })`

**Asset release (`:1733-1753`) and pickup mirror writes (`:1702-1729`) stay in `cascadeDelete` only** — those are delete-task-specific and not part of the cancellation financial contract. Phase 1 helper covers ONLY the invoice + memo + rental-chain logic.

### 1.2 Proposed helper signature

```ts
type FinancialDecision =
  | { type: 'void_unpaid' }
  | { type: 'refund_paid' }
  | { type: 'credit_memo' }
  | { type: 'keep_paid'; reason: string };

private async applyFinancialDecisionTx(
  manager: EntityManager,
  invoice: Invoice,
  decision: FinancialDecision,
  tenantId: string,
  userId: string,
): Promise<{
  voided: boolean;
  unpaidBalanceVoided: number;       // > 0 only on partial-payment auto-void
  creditMemoId: string | null;
  refundIntent: {
    paymentId: string;
    stripePaymentIntentId: string | null;
    amount: number;
  } | null;
  auditMetadata: Record<string, unknown>;
}>
```

### 1.3 Lines that move into the helper

The helper takes the `manager` and uses `manager.getRepository(Invoice)`, `manager.getRepository(CreditMemo)`, `manager.getRepository(Payment)` (the new-to-JobsService repo) for ALL writes — the current `this.invoiceRepo.update` / `this.creditMemoRepo.save` calls from `cascadeDelete:1765-1782` are replaced with their trx-scoped equivalents inside the helper.

**Decision branch logic the helper implements:**
- `void_unpaid` → `invoiceRepo.update({ status: 'voided', voided_at, balance_due: 0 })`. No memo. No payment touch. Returns `{ voided: true, unpaidBalanceVoided: 0, creditMemoId: null, refundIntent: null }`.
- `refund_paid` → `paymentRepo.update` with `refunded_amount += paid_amount` AND `refund_provider_status='pending_stripe' | 'manual_required' | 'manual_completed'` (depending on payment_method + stripe_payment_intent_id presence). If `balance_due > 0`: also void the unpaid balance via the `voided + balance_due=0` update. Returns `refundIntent` populated when `stripe_payment_intent_id` is present (caller does the Stripe API call after commit).
- `credit_memo` → `creditMemoRepo.save` with `amount = invoice.amount_paid` (NOT `invoice.total` — distinct from the cascadeDelete current behavior, which assumes full refund). Auto-void unpaid balance if any. Returns `{ creditMemoId, voided: true, unpaidBalanceVoided: balance_due_at_decision }`.
- `keep_paid` → no payment row write, no memo. If `balance_due > 0`: still void the unpaid balance (Anthony's policy). Returns `{ voided: balance_due > 0, unpaidBalanceVoided: balance_due_at_decision, creditMemoId: null, refundIntent: null }`.

### 1.4 What stays in `cascadeDelete`

`cascadeDelete` keeps its outer loop (`:1756-1785`), the `options.voidInvoices` opt-in filter, the rental-chain cancellation block (`:1787-1797`), the asset release blocks, the pickup-deletion branch, and its result-shape return. Inside its loop, it stops constructing the void/memo writes inline and instead calls `await this.applyFinancialDecisionTx(this.dataSource.manager, invoice, { type: 'credit_memo' }, tenantId, userId)` — `cascadeDelete`'s opt-in semantics map to `credit_memo` for paid invoices and `void_unpaid` for unpaid.

**Behavior regression risk:** today's `cascadeDelete` creates a credit memo for `invoice.total` regardless of paid/unpaid status. The new helper differentiates: `credit_memo` decision uses `amount_paid` (correct accounting). The 5 existing `cascadeDelete` call sites are invoked from the delete-task modal, which only fires on unpaid pre-delivery jobs in practice — production data shows zero credit memos in the Anthony tenant, so no historical rows are at risk. Even so, Phase 1 adds the smoke test mentioned below to lock current `cascadeDelete` behavior in.

### 1.5 cascadeDelete regression test (new)

`jobs.service.spec.ts` has no current `cascadeDelete` coverage (grep'd: zero `describe('cascadeDelete')` blocks). Add ONE smoke test that exercises the void+memo path through the helper to lock the existing externally observable behavior — `voidedInvoices`, `creditMemos`, `rentalChainsCancelled` in the return shape — before the helper extraction lands.

---

## § 2. `CreditAuditService.record` threaded-manager change

### 2.1 Current state

`api/src/modules/credit-audit/credit-audit.service.ts:49-65` — synchronous-call, async-execute, error-swallow:
```ts
record(params: RecordAuditParams): void {
  const event = this.repo.create({...});
  this.repo.save(event).catch((err) => this.logger.warn(...));
}
```
The 5 callers (per Phase 0 § 2 of the prior audit) call `record(...)` and continue. None await; none observe failure.

### 2.2 Proposed signature

```ts
async record(
  params: RecordAuditParams,
  manager?: EntityManager,
): Promise<void> {
  const repo = manager
    ? manager.getRepository(CreditAuditEvent)
    : this.repo;
  const event = repo.create({...});

  if (manager) {
    // Inside-transaction path: failures propagate so the caller's
    // transaction rolls back the entire cancellation.
    await repo.save(event);
  } else {
    // Existing fire-and-forget path: byte-equivalent to today.
    repo.save(event).catch((err) => this.logger.warn(...));
  }
}
```

**Backwards compatibility verified by call-site review:** all 5 existing callers (`customer-credit.service.ts:222,275,308`, `booking-credit-enforcement.service.ts:213`, `dispatch-credit-enforcement.service.ts:175,331`, `tenant-settings.service.ts:128`) invoke `record(...)` without `await` and without a second argument. The new return type `Promise<void>` does not break them — JS-runtime semantics for an unawaited async function returning `void` are identical to a sync function returning `void` for the caller's purposes. TypeScript strict-mode does not error either; the compiler permits ignoring a `Promise<void>` return.

### 2.3 New event-type union additions

Extend `CreditAuditEventType` (`credit-audit.service.ts:18-24`):
```ts
export type CreditAuditEventType =
  | 'credit_hold_set'
  | 'credit_hold_released'
  | 'booking_override'
  | 'dispatch_override'
  | 'credit_policy_updated'
  | 'credit_settings_updated'
  | 'cancellation_void_unpaid'
  | 'cancellation_refund_paid'
  | 'cancellation_credit_memo'
  | 'cancellation_keep_paid';
```

### 2.4 Event row metadata shape (per Anthony's decision contract)

Per invoice-decision, ONE `credit_audit_events` row:
```ts
{
  tenant_id,
  event_type: 'cancellation_void_unpaid' | 'cancellation_refund_paid' | 'cancellation_credit_memo' | 'cancellation_keep_paid',
  user_id,
  customer_id: invoice.customer_id,
  job_id: jobId,
  reason: dto.cancellationReason,        // top-level cancellation reason
  metadata: {
    invoice_id,
    invoice_number,
    amount_paid_at_decision,             // snapshot at write time
    balance_due_at_decision,             // snapshot at write time
    decision_reason: decision.reason ?? null,   // populated for keep_paid
    paid_portion_decision: 'refund_paid' | 'credit_memo' | 'keep_paid' | null,  // null for void_unpaid
    paid_portion_amount: number | null,
    unpaid_balance_voided: number,       // 0 unless partial-payment auto-void
    refund_provider_status: 'pending_stripe' | 'manual_required' | 'manual_completed' | null,
    stripe_refund_id: string | null,     // populated POST-commit by Stripe success path
    credit_memo_id: string | null,
  },
}
```

**Note on partial-payment events:** Anthony's policy treats partial as ONE decision with two halves (paid portion + auto-voided unpaid balance). The audit row reflects this — `paid_portion_amount` and `unpaid_balance_voided` are recorded as a pair; only one row per invoice fires.

---

## § 3. Endpoint design

### 3.1 Route + decorators

```ts
@Post(':id/cancel-with-financials')
@UseGuards(RolesGuard)
@Roles('owner', 'admin')
@ApiOperation({ summary: 'Cancel a job with per-invoice financial decisions (Arc J.1)' })
async cancelWithFinancials(
  @TenantId() tenantId: string,
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: CancelWithFinancialsDto,
  @CurrentUser('id') userId: string,
  @CurrentUser('role') userRole: string,
  @CurrentUser('email') userEmail: string,
) {
  return this.jobsService.cancelJobWithFinancials(
    tenantId, id, dto, userId, userRole, userEmail,
  );
}
```

### 3.2 DTO

```ts
// api/src/modules/jobs/dto/cancel-with-financials.dto.ts (NEW file)
import {
  IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID,
  ValidateNested, MinLength, ValidateIf, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class InvoiceDecisionDto {
  @IsUUID()
  invoice_id!: string;

  @IsIn(['void_unpaid', 'refund_paid', 'credit_memo', 'keep_paid'])
  decision!: 'void_unpaid' | 'refund_paid' | 'credit_memo' | 'keep_paid';

  // Required only when decision === 'keep_paid'. Service-layer guard
  // re-checks; here is the first line of defense.
  @ValidateIf((o) => o.decision === 'keep_paid')
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  reason?: string;
}

export class CancelWithFinancialsDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  cancellationReason!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceDecisionDto)
  invoiceDecisions!: InvoiceDecisionDto[];
}
```

**Note on ArrayMinSize:** Step 2 is skipped when every linked invoice has `amount_paid == 0 AND balance_due == 0`. In that case, `invoiceDecisions` is the empty array — so `@ArrayMinSize` is NOT used. The eligibility-check pass at the service layer treats an empty array as "no financial work to do" and proceeds to the status-change-only path.

### 3.3 Three-layer eligibility enforcement

1. **DTO `class-validator` layer** (basic structural validation) — ensures `decision` is in the union, `reason` present when `keep_paid`. Cannot reach `amount_paid` since DTO has no invoice context.
2. **Service-layer eligibility check** (defense in depth, before any write): on entry to `cancelJobWithFinancials`, the service loads each invoice from the DB, then for each `invoiceDecisions[i]` re-validates eligibility against the DB row's actual `amount_paid` and `balance_due`:
   - `void_unpaid` REJECT if `amount_paid > 0` → 400 with `decision_invalid_for_paid_invoice`
   - `refund_paid | credit_memo | keep_paid` REJECT if `amount_paid == 0` → 400 with `decision_invalid_for_unpaid_invoice`
   - Missing decision for an invoice with `amount_paid > 0 OR balance_due > 0` → 400 with `decision_required_for_invoice`
3. **Modal UI layer** disables ineligible options on render (see § 5) — operators cannot construct the bad request from the supported UI.

### 3.4 Cancel-via-PATCH-status compatibility (Arc J.3 deferred)

`PATCH /jobs/:id/status` with `dto.status='cancelled'` STAYS in place, unchanged, in this arc. Reasons:
- Three call sites (`dispatch/page.tsx:2908`, `jobs/page.tsx:1325`, `jobs/[id]/page.tsx:930-947` fallback) currently invoke it and Arc J.1 should not block on rewriting all of them with full-decision UX.
- The bulk-cancel + dispatch-board inline cancel flows are operationally important — operators need to be able to cancel zero-balance jobs in one click without a 3-step modal.

The migration strategy for the three sites (Phase 1 implementation step 8):
- **`jobs/[id]/page.tsx:986-1007`** (`confirmCancelFromModal`) → fully migrated to the new modal/endpoint.
- **`dispatch/page.tsx:2908`** (inline `confirm("Cancel this job?")`) → minimal change: pre-fetch `GET /jobs/:id/cancellation-context`; if every invoice has zero `amount_paid` AND zero `balance_due` (i.e. `summary.hasInvoices === false || (!hasPaidInvoices && !hasUnpaidInvoices)`), call the legacy PATCH unchanged. Otherwise, open the new modal seeded with the target job. Cleaner UX with minimal site disruption.
- **`jobs/page.tsx:1325`** (bulk cancel) → same per-job branching as dispatch-board; jobs that need a financial decision halt the bulk loop and open the modal for that specific job, the rest continue via PATCH. Document this as "best effort bulk; jobs with paid/unpaid invoices require operator decision."
- **`jobs/[id]/page.tsx:930-947`** (`cancelWithReasonFallback`, the network-failure fallback) → unchanged. It still hits `PATCH /jobs/:id/status` because Arc J.1's whole point of having a fallback is that the new context endpoint is unreachable.

This Arc-J.3-deferred policy is documented in the migration step's PR description.

---

## § 4. Stripe refund integration

### 4.1 Schema — the one column add

Confirmed by reading `api/src/modules/billing/entities/payment.entity.ts`: `payments` has `refunded_amount` (line 48) but NO `refund_provider_status`. **One ALTER TABLE is required.**

```sql
ALTER TABLE payments
  ADD COLUMN refund_provider_status TEXT NULL;
COMMENT ON COLUMN payments.refund_provider_status IS
  'Arc J.1: stripe_succeeded | stripe_failed | pending_stripe | manual_required | manual_completed | NULL (no refund yet)';
```

Per memory entry "Pre-flight env check / deploy sequence", run via Supabase SQL editor BEFORE the API deploy. Migration file kept in `migrations/` for audit trail; no TypeORM-managed migration runner.

The Payment entity gets one new field:
```ts
@Column({ name: 'refund_provider_status', type: 'text', nullable: true })
refund_provider_status!: string | null;
```

### 4.2 Stripe call timing — AFTER commit

The orchestrator wraps the DB transaction (status change + per-invoice helper calls + threaded-manager audit rows) in `dataSource.transaction(async (manager) => {...})`. After commit, for each `refundIntent` returned with a non-null `stripePaymentIntentId`, call Stripe outside the transaction in a try/catch.

**Path map for `refund_paid`:**

| Payment shape | Inside-tx write to `payments` | Post-commit Stripe call | Final `refund_provider_status` |
|---|---|---|---|
| Card, `stripe_payment_intent_id` present (Charge-Card-on-File path) | `refunded_amount += amount`, `refund_provider_status='pending_stripe'` | `stripe.refunds.create({ payment_intent, amount, metadata })` (reuse pattern from `stripe.service.ts:200-204`) | success → `stripe_succeeded`, `metadata.stripe_refund_id = refund.id`; failure → `stripe_failed`, surface in audit |
| Card, `stripe_payment_intent_id == null` (Pay Now webhook orphans + admin Mark-Paid) | `refunded_amount += amount`, `refund_provider_status='manual_required'` | none | `manual_required` (operator handles in Stripe dashboard) |
| Cash | `refunded_amount += amount`, `refund_provider_status='manual_completed'` | none | `manual_completed` (no programmatic refund possible) |

### 4.3 Stripe failure handling

If `stripe.refunds.create` rejects after a successful DB commit:
1. The DB has already recorded the refund intent (`refund_provider_status='pending_stripe'`).
2. Update `payments.refund_provider_status = 'stripe_failed'` post-commit.
3. Write a *second* audit row of type `cancellation_refund_paid` with `metadata.refund_provider_status='stripe_failed'` and `metadata.stripe_error_message`. (One audit row per Stripe state transition; the original `pending_stripe` row from inside-tx + the post-commit `stripe_failed` row form a forensic chain.)
4. Surface the failure to the operator in the response: the orchestrator returns `{ success: true, jobCancelled: true, stripeFailures: [{ invoice_id, payment_id, error }] }`. Modal shows a yellow banner: "Job cancelled, but Stripe refund failed for invoice #N — retry from invoice page or refund manually in Stripe dashboard."

**Critical: cancellation does NOT roll back on Stripe failure.** The DB state is correct (cancelled job + memo of intent); the Stripe-side delta is recoverable manually. Rolling back would leave the operator unable to cancel jobs at all when Stripe is degraded.

### 4.4 Reuse `stripe.service.ts:refundInvoice` directly?

`refundInvoice` (`stripe.service.ts:186-230`) does too much: it loads the invoice, picks the most recent payment by `applied_at DESC`, and re-derives invoice state. Phase 1 does NOT reuse this method directly because the orchestrator has already loaded the right `Payment` row by the time it gets to the post-commit Stripe call. Instead, lift the inner `stripe.refunds.create({...})` call (lines 200-204) into a small private helper inside `JobsService` (since `JobsService` cannot inject `StripeService` without a circular module dep — `BillingModule` re-exports `StripeService` and `JobsModule` already imports `BillingModule`). Verify circular dep absence in implementation; if `StripeService` is exported from `BillingModule`, prefer direct injection over duplicating the API call.

### 4.5 The 5 production orphans

Out of scope for Arc J.1 — this is Arc J.2 (one-shot SQL backfill, idempotent, no app code path needed). Phase 0 of Arc J already mapped each orphan to its decision. Arc J.1 only ensures NEW cancellations do not become orphans.

---

## § 5. Modal UX wireframe

### 5.1 State (replacing the current single-screen state at `jobs/[id]/page.tsx:373-377`)

```ts
type CancelStep = 'reason' | 'decisions' | 'confirm';

const [cancelStep, setCancelStep] = useState<CancelStep>('reason');
const [cancelReason, setCancelReason] = useState('');
const [invoiceDecisions, setInvoiceDecisions] = useState<
  Record<string, { decision: FinancialDecision['type']; reason: string }>
>({});  // keyed by invoice_id
const [submitting, setSubmitting] = useState(false);
const [stripeFailures, setStripeFailures] = useState<...>(null);
```

### 5.2 Step 1 — Cancellation reason

- Same warning banners as today (`hasCompletedJobs`, `hasActiveJobs`, `hasPaidInvoices`).
- Same chain-section read-only summary as today.
- Required `cancelReason` textarea (preserve current label + placeholder via FEATURE_REGISTRY).
- "Keep Job" + "Continue" buttons.
- "Continue" disabled until `cancelReason.trim().length > 0`.
- On click: if every linked invoice has `amount_paid == 0 AND balance_due == 0` → SKIP to Step 3. Else → go to Step 2.

### 5.3 Step 2 — Per-invoice financial decision

For each `cancelContext.invoices[i]` where `amount_paid > 0 OR balance_due > 0`:

| Column | Content |
|---|---|
| Invoice | `#{invoice_number}` + status badge |
| Total | `formatCurrency(total_amount)` |
| Paid | `formatCurrency(amount_paid)` |
| Balance | `formatCurrency(balance_due)`, color-coded |
| Decision | `<select>` with eligibility filter |
| Reason | `<textarea>` (visible only when decision === `keep_paid`) |

**Decision dropdown eligibility (mirrors § 3.3 layer 3):**
- If `amount_paid > 0 AND balance_due == 0`: enabled options = `refund_paid`, `credit_memo`, `keep_paid`. `void_unpaid` rendered with `disabled` attribute and tooltip "This invoice has been paid — choose a refund or credit option."
- If `amount_paid == 0 AND balance_due > 0`: enabled options = `void_unpaid`. The other three rendered disabled with tooltip "This invoice has no payments — only voiding the unpaid balance is available."
- If `amount_paid > 0 AND balance_due > 0` (partial payment): enabled options = `refund_paid`, `credit_memo`, `keep_paid`. `void_unpaid` disabled — paid portion must be addressed; the chosen decision auto-voids the remaining balance per Anthony's policy.
- If `amount_paid == 0 AND balance_due == 0`: invoice not rendered in Step 2 at all.

**Below the table — running totals** (computed live from `invoiceDecisions`):
- "To refund: $X" (sum of `amount_paid` for invoices where decision === `refund_paid`)
- "To credit: $Y" (sum of `amount_paid` for invoices where decision === `credit_memo`)
- "To void: $Z" (sum of `balance_due` across `void_unpaid` decisions PLUS auto-voided balances from refund/credit/keep on partial-paid invoices)
- "Kept paid: $W" (sum of `amount_paid` for invoices where decision === `keep_paid`)

**"Back" + "Continue" buttons:**
- "Continue" disabled until: every Step-2 invoice has a decision AND every `keep_paid` selection has a non-empty `reason`.

### 5.4 Step 3 — Confirm

Final summary screen showing:
- Job number being cancelled
- Cancellation reason (read-only)
- Per-invoice decision summary (compact: "#1015 → Credit memo $400 + auto-void $600", "#1016 → Void unpaid $250", etc.)
- Totals as in Step 2
- "Back" + "Confirm Cancellation" buttons

On click:
- POST to `/jobs/:id/cancel-with-financials` with `{ cancellationReason, invoiceDecisions: [...] }`.
- On 200: success toast, close modal, refresh job. If response includes `stripeFailures`, show the yellow follow-up banner described in § 4.3.
- On 4xx: show inline error (translate the service-layer code to a friendly message per memory entry "registry-driven user-facing labels"). Modal stays open so operator can adjust.
- On 5xx: same as today's `confirmCancelFromModal` — toast, modal stays open.

### 5.5 Registry entries (new keys for Phase 1 implementation step 9)

```
cancel_job_step_label_reason            // "Cancellation Reason"
cancel_job_step_label_decisions         // "Financial Decisions"
cancel_job_step_label_confirm           // "Confirm"
cancel_job_decision_void_unpaid         // "Void unpaid invoice"
cancel_job_decision_refund_paid         // "Refund payment"
cancel_job_decision_credit_memo         // "Issue credit memo"
cancel_job_decision_keep_paid           // "Keep payment as final"
cancel_job_decision_disabled_paid       // tooltip
cancel_job_decision_disabled_unpaid     // tooltip
cancel_job_keep_paid_reason_label       // "Reason for keeping payment"
cancel_job_keep_paid_reason_placeholder // "Why is this payment being kept?"
cancel_job_totals_refund                // "To refund: {AMOUNT}"
cancel_job_totals_credit                // "To credit: {AMOUNT}"
cancel_job_totals_void                  // "To void: {AMOUNT}"
cancel_job_totals_kept                  // "Kept paid: {AMOUNT}"
cancel_job_continue                     // "Continue"
cancel_job_back                         // "Back"
cancel_job_partial_voided_hint          // "Unpaid balance of {AMOUNT} will be voided automatically."
cancel_job_stripe_failure_banner        // "Job cancelled. Stripe refund failed for {N} invoice(s). Retry or refund manually."
```

---

## § 6. Test coverage plan

### 6.1 Test harness extensions

The current `buildHarness` in `jobs.service.spec.ts:110-244` does NOT inject `Payment`, mocks `CreditMemo` as `{}`, and stubs `dataSource.transaction` with only `Job` + `Notification` trx repos (`:174-181`). Phase 1 extends:
- Add `Payment` to the harness imports (currently missing — `payment.entity.ts` not used in spec).
- Add real spies to `creditMemoRepo` (`{ create: jest.fn(x => x), save: jest.fn(x => Promise.resolve(x)) }`) and `paymentRepo` (`{ findOne, find, update, save }`).
- Extend the `dataSource.transaction` mock so `manager.getRepository(Invoice)`, `manager.getRepository(CreditMemo)`, `manager.getRepository(Payment)`, `manager.getRepository(CreditAuditEvent)` all return spies — necessary for J3, J4, J5, J7, J10.
- Mock `CreditAuditService` as a provider with a `record: jest.fn().mockResolvedValue(undefined)` AND a parallel `recordWithManager: jest.fn().mockImplementation(async (params, mgr) => mgr.getRepository(CreditAuditEvent).save({...}))` — depending on whether the implementation lifts the manager case into a separate method or threads through one method (per § 2.2 we recommend ONE method with optional second arg; harness mocks `record` to behave both ways).
- Mock `Stripe` SDK via `stripe.refunds.create` injected on `JobsService` directly (or via the `BillingModule`-exported StripeService — implementation choice).

### 6.2 J-suite test cases

| # | Setup | Action | Assertions |
|---|---|---|---|
| **J1** | Job with single zero-dollar invoice (`amount_paid=0, balance_due=0`) | `cancelJobWithFinancials({ cancellationReason: 'r', invoiceDecisions: [] })` | (a) Step 2 logically skipped: orchestrator branch when `invoiceDecisions.length === 0` does no helper invocations; (b) `txJobSave` called with `status='cancelled'`; (c) ONE `credit_audit_events` row of type `cancellation_void_unpaid`? **Actually no** — for zero-dollar invoice with no decision, the audit is the JOB-LEVEL row only, not a per-invoice row. Confirm policy with Anthony: should an empty-financials cancellation still write any audit? Recommendation in § 6.3 below. |
| **J2** | Job with single unpaid invoice (`amount_paid=0, balance_due=500`) | decision: `void_unpaid` | (a) `manager.getRepository(Invoice).update` called with `{ status:'voided', voided_at, balance_due:0 }`; (b) NO `creditMemoRepo.save`; (c) ONE audit row of type `cancellation_void_unpaid` with metadata containing `invoice_id`, `amount_paid_at_decision: 0`, `balance_due_at_decision: 500`, `unpaid_balance_voided: 500`; (d) audit row written via `manager.getRepository(CreditAuditEvent).save` (proves threaded-manager) |
| **J3** | Fully-paid invoice (`amount_paid=1000, balance_due=0`), card payment WITH `stripe_payment_intent_id` | decision: `credit_memo` | (a) `creditMemoRepo.save` called with `amount: 1000`; (b) invoice updated to `status='voided', balance_due=0`; (c) audit row type `cancellation_credit_memo`, metadata has `paid_portion_decision: 'credit_memo'`, `paid_portion_amount: 1000`, `unpaid_balance_voided: 0`, `credit_memo_id` populated; (d) NO Stripe call (credit_memo decision does not refund) |
| **J4** | Fully-paid invoice, card payment WITH `stripe_payment_intent_id` | decision: `refund_paid` | (a) Inside-tx: `paymentRepo.update` sets `refunded_amount += 1000, refund_provider_status='pending_stripe'`; (b) post-commit: `stripe.refunds.create` called with `payment_intent` and `amount: 100000`; (c) audit row 1 inside-tx with `refund_provider_status='pending_stripe'`; (d) audit row 2 post-commit (or final state update) with `refund_provider_status='stripe_succeeded'` and `stripe_refund_id` populated; (e) `transactionCommit` fires before Stripe call |
| **J5** | Fully-paid invoice, card payment WITHOUT `stripe_payment_intent_id` (orphan-shape) | decision: `refund_paid` | (a) `refunded_amount` populated; (b) `refund_provider_status='manual_required'`; (c) audit row type `cancellation_refund_paid` with `refund_provider_status='manual_required'`; (d) **NO** `stripe.refunds.create` call (no PI to refund) |
| **J6** | Fully-paid invoice (`amount_paid=200, balance_due=0`) | decision: `keep_paid` with `reason: 'customer kept service'` | (a) NO `paymentRepo.update`; (b) NO `creditMemoRepo.save`; (c) audit row type `cancellation_keep_paid` with `metadata.decision_reason: 'customer kept service'` |
| **J7** | Partial-pay invoice ($1000 total, $400 paid, $600 balance) | decision: `credit_memo` | (a) `creditMemoRepo.save` called with `amount: 400` (NOT 1000); (b) `invoiceRepo.update` sets `balance_due=0, status='voided', voided_at` (single update — auto-void unpaid balance happens in same write); (c) ONE audit row total (not two) with metadata `paid_portion_decision: 'credit_memo'`, `paid_portion_amount: 400`, `unpaid_balance_voided: 600`, `credit_memo_id` populated; (d) `transactionCommit` called once |
| **J8** | Job with TWO invoices: inv1 unpaid → `void_unpaid`, inv2 fully paid → `credit_memo`; force `creditMemoRepo.save` to reject on inv2 | call orchestrator | (a) Transaction rolls back: inv1's update is NOT persisted (assert via `transactionCommit` NOT called); (b) NO audit rows persisted (the audit row save inside the manager-bound repo is in the same tx, so it rolls back too); (c) caller receives the rejection up the stack (Promise rejects) |
| **J9** | DTO: `{ cancellationReason: 'r', invoiceDecisions: [{ invoice_id: '<u>', decision: 'keep_paid' }] }` (NO reason) | controller-layer DTO validation | (a) 400 with `keep_paid` → `reason should not be empty` from `class-validator`; (b) service method NOT entered (assert via `dataSource.transaction` mock NOT called) |
| **J10** | Single `void_unpaid` decision; spy on `manager.getRepository(CreditAuditEvent).save` directly | call orchestrator | (a) `manager.getRepository(CreditAuditEvent).save` called inside the trx callback; (b) the un-trx-scoped `creditAuditService.repo.save` is NOT called (proves manager-threading); (c) audit-row save's failure ALSO rolls back the cancellation (regression check on § 2.2) |
| **J11** | DTO claims `decision: 'void_unpaid'` but loaded invoice has `amount_paid=500` | service-layer guard | (a) 400 with code `decision_invalid_for_paid_invoice` (or whatever final code chosen); (b) `transactionCommit` NOT called; (c) NO writes performed; ALSO: an isolated DTO-validation test of the same payload asserts the controller-layer 400 fires before the service is reached (in this layer the DTO can't catch it because eligibility depends on DB state — confirm intentional) |
| **J12** | DTO claims `decision: 'refund_paid'` but loaded invoice has `amount_paid=0` | service-layer guard | (a) 400 with code `decision_invalid_for_unpaid_invoice`; (b) `transactionCommit` NOT called; (c) NO writes performed |

### 6.3 Open question for J1

For a zero-dollar single-invoice cancellation (or any cancellation where every invoice has `amount_paid=0 AND balance_due=0`, which is the Step-2-skipped path), should we still write a credit_audit_events row? Two choices:
- **(a)** Yes, one synthetic `cancellation_void_unpaid` row with `invoice_id: null, balance_due_at_decision: 0` (or a dedicated new event type `cancellation_no_financials`). Keeps the "every cancellation has an audit row" invariant.
- **(b)** No, if there are no financial decisions there's no per-invoice audit; rely on the existing `notifications.status_override` row (writes from `changeStatus`'s admin-override branch) for a cancellation trail.

**Recommendation: (a)**, with a new event type `cancellation_no_financials`. Preserves the invariant "Arc J cancellations always emit at least one credit_audit_events row" so reporting queries stay simple. Cost is one extra row per zero-dollar cancellation; benefit is no special-casing in the audit dashboard. Flag for Anthony's confirmation in the Phase 1 implementation kickoff.

### 6.4 Pre-fix RED state requirement

The prompt requires J-suite tests to be RED before step 4 (orchestrator) lands. Recommended ordering:
- Step 1 (CreditAuditService manager param) → no J-suite tests pass yet.
- Step 2 (helper extraction) → cascadeDelete smoke test passes; no J-suite tests pass.
- Step 3 (schema add) → no J-suite tests pass.
- Step 4 (orchestrator implementation) → J1-J7, J11, J12 turn green.
- Step 5 (endpoint + DTO) → J9 turns green (DTO-layer test); J11/J12 service-layer tests already green from step 4.
- Step 6 (J-suite tests AS A WHOLE run) → all 12 green.

The "RED first" proof is captured by adding J1-J12 BEFORE step 4 lands, then watching them go RED on the test run, then green after step 4.

---

## § 7. Standing rule check

| Standing rule | Compliance plan |
|---|---|
| **Tenant isolation** | Endpoint uses `@TenantId() tenantId` from JWT; orchestrator passes `tenantId` to every helper call; helper queries (`Invoice.findOne`, `CreditMemo.save`, `Payment.update`, `CreditAuditEvent.save`) all include `tenant_id` in WHERE/payload; Stripe metadata includes `tenantId` for audit; rate-limit keys include `tenantId`. |
| **JWT auth** | Inherits from global `JwtAuthGuard` mounted in `app.module.ts` — no additional `@UseGuards(JwtAuthGuard)` needed at controller level (matches existing patterns in `jobs.controller.ts`). |
| **RBAC** | `@UseGuards(RolesGuard) @Roles('owner', 'admin')` on the new endpoint. Dispatcher CANNOT cancel jobs with paid invoices (refund authority is owner/admin only). The existing `PATCH /jobs/:id/status` stays open to dispatcher for non-financial cancellations (zero-dollar cases routed to it from the modal's conditional skip branch — but only when invoice has no payments AND no balance, which means RBAC-distinct refund authority isn't engaged). |
| **Rate limiting** | Add `@Throttle({ default: { limit: 10, ttl: 3600_000 } })` (10/hr per user) to the new endpoint. Per `grep` of `api/src`, throttler decorator IS in use elsewhere (verify via `nest-cli throttler` config in `app.module.ts` during Phase 1) — fall back to a dedicated `RateLimitGuard` if `@nestjs/throttler` isn't wired. |
| **Registry-driven labels** | All operator-facing strings funneled through `FEATURE_REGISTRY` per § 5.5 — 17 new keys enumerated. Defaults inlined as fallback so an unsynced registry doesn't blank the modal. |
| **PII handling** | New endpoint only writes; no new PII surface. Existing `GET /jobs/:id/cancellation-context` already returns invoice + customer data (used for Step 1 context load), already audited as compliant in Phase 0 of Arc J. |
| **Validation error UX** | Service-layer eligibility codes (`decision_required_for_invoice`, `decision_invalid_for_paid_invoice`, `decision_invalid_for_unpaid_invoice`) translate to friendly messages in the modal: "Decision required for invoice #1015", "Invoice #1015 has been paid — refund or credit required", "Invoice #1016 has no payments — only void available". |
| **Audit row per decision** | Threaded-manager save inside transaction guarantees atomicity (J10). Audit metadata captures full forensic chain (paid portion + auto-voided unpaid + Stripe state transitions). |
| **No magic / additive only** | All changes are additive: new endpoint, new DTO, new service method, new helper, new event types, new column, new modal step. The single existing-code edit is `cascadeDelete` switching its inline writes to call the helper — externally observable behavior unchanged (locked by smoke test). |
| **Full diff + explanation, stop for approval** | Phase 1 deliverable already enumerated in the prompt: full `git diff --cached`, pre-fix RED jest, final GREEN jest, file stat, deviations list, manual smoke checklist. STOP after deliverables — Anthony does the deploy chain. |
| **Multi-tenant safe / no auto-commit / no auto-push** | Confirmed; this audit makes zero changes. |

---

## Phase 1 sequencing (locked from prompt; cross-references)

1. `CreditAuditService.record` → optional `manager` + 4 new event types (§ 2). Run existing tests; confirm 5 callers regression-free.
2. Extract `applyFinancialDecisionTx` from `cascadeDelete` (§ 1). Add cascadeDelete smoke test.
3. `payments.refund_provider_status` column add via Supabase SQL editor (§ 4.1). Update Payment entity. Add `Payment` to `JobsModule.forFeature` and `JobsService` constructor (§ 1.4 / Exec § 3).
4. Implement `JobsService.cancelJobWithFinancials` using helper + threaded-manager audit (§ 1, § 2, § 4). Stripe call AFTER `dataSource.transaction` commit.
5. Add `POST /jobs/:id/cancel-with-financials` controller + `CancelWithFinancialsDto` (§ 3).
6. Add J1-J12 (§ 6.2). Validate RED-then-GREEN ordering (§ 6.4).
7. Refactor cancel modal to 3 steps (§ 5). Wire to new endpoint.
8. Migrate `dispatch/page.tsx:2908` + `jobs/page.tsx:1325` per § 3.4 conditional re-route.
9. Registry entries (§ 5.5).

Then deliverables. STOP.

---

## Out-of-scope reminders (Arc J.1 boundary)

- 5 production orphan backfill → **Arc J.2** (one-shot SQL).
- Customer cancellation notifications (SMS/email) → **Arc K** (deferred per Decision 4).
- Removing PATCH-status cancel compatibility → **Arc J.3** (cleanup).
- `cascadeDelete` / Delete Task UI deprecation → **post-J UX policy**.
- Customer-facing refund receipt → **Phase 2**.

---

**End of Phase 0 audit report. No code changes were made. No commits. No pushes. Awaiting approval to begin Phase 1 implementation.**
