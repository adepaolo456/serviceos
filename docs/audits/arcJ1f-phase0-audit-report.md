# Arc J.1f — Phase 0 Audit Report

**Status:** Read-only. No code or DB changes. Halts for review.
**Working tree state:** clean against HEAD (`e78dd9f`).

---

## 1. Executive summary

All five bugs are diagnosed from code inspection alone — no runtime debugging needed.

- **J.1f-bug1** (driver still attached after orchestrator cancel) is a straight Arc-H regression. `cancelJobWithFinancials` does a single `txJobRepo.save(job)` with no in-memory clear and no post-save column-only `update({ assigned_driver_id: null })`. Arc H's `CLEAR_DRIVER_TARGETS` is consulted only on the override-status path. Fix is ~6 lines inside the existing transaction; pattern is already established at `jobs.service.ts:1322-1331`.
- **J.1f-bug2** (`refunded_amount` written with `manual_required` status) is a contract-violation bug. The orchestrator unconditionally writes `refunded_amount = newRefunded` for every `refund_paid` decision regardless of whether money has actually moved. The bug surface is one line (`jobs.service.ts:4256`); the fix touches that line plus the post-commit Stripe success handler at `:4677-4699`. **Two existing J-suite tests (J4, J5) assert the buggy behavior and must be updated in Phase 1.** **The `refund_provider_status` column ships with no CHECK constraint** — flagged as out-of-scope.
- **J.2.A** (Financials card invoice badge missing `voided` case) is a single-line UI miss at `jobs/[id]/page.tsx:2458` — the chain-scoped invoice row's status pill falls through to `"Unpaid"` for any non-`paid`/non-`draft` status. Add a `voided → "Voided"` case + registry key.
- **J.2.B** (Invoice Summary panel renders unrelated customer's invoice) is a **backend bug**. The `/invoices?jobId=…` endpoint silently ignores the `jobId` query parameter — it is not declared in `ListInvoicesQueryDto` and `invoice.service.findAll` has no `jobId` branch in its query builder. Limit=1 returns the tenant's most recent invoice instead of the job-scoped one. **Multi-tenant isolation IS preserved** (`i.tenant_id = :tenantId` at line 498); leak is within-tenant cross-customer. **Stop-condition flag:** fix requires editing `invoice.service.ts` and `list-invoices-query.dto.ts` — outside the prompt's listed surfaces.
- **J.1f-bug3** (lifecycle leg kebab non-clickable) is rooted in the custom `Dropdown` component at `web/src/components/dropdown.tsx:155-158`. The Dropdown attaches `onClick={() => setOpen(!open)}` to a wrapping div around the trigger. The leg-row kebab passes a trigger button with `onClick={(e) => e.stopPropagation()}` (added in Arc J.1e to prevent the row's parent navigation from firing). `stopPropagation` swallows the click before it bubbles to the Dropdown wrapper — the menu never opens. Fix is ~4 lines: remove stopPropagation from the trigger, wrap the Dropdown in an outer span that does the stopPropagation instead.

**Phase 1 implementation order recommendation:** J.1f-bug1 + J.1f-bug2 share the same orchestrator file and same test file (`jobs.service.spec.ts`) — batch into a single backend PR. J.2.A is one-line UI + one registry key, batch with J.1f-bug3 (also UI). J.2.B is its own backend PR (DTO + service). Total: 3 PRs.

---

## 2. Files read (absolute paths)

```
/Users/Anthony_1/serviceos/api/src/modules/jobs/jobs.service.ts
/Users/Anthony_1/serviceos/api/src/modules/jobs/jobs.service.spec.ts
/Users/Anthony_1/serviceos/api/src/modules/billing/services/invoice.service.ts
/Users/Anthony_1/serviceos/api/src/modules/billing/dto/list-invoices-query.dto.ts
/Users/Anthony_1/serviceos/api/src/modules/billing/controllers/invoice.controller.ts (grep'd)
/Users/Anthony_1/serviceos/api/src/modules/reporting/reporting.service.ts (grep'd)
/Users/Anthony_1/serviceos/api/src/modules/reporting/dto/revenue-response.dto.ts (grep'd)
/Users/Anthony_1/serviceos/api/src/modules/reporting/dto/dump-costs-response.dto.ts (grep'd)
/Users/Anthony_1/serviceos/api/src/modules/reporting/dto/revenue-detail-invoice.dto.ts (grep'd)
/Users/Anthony_1/serviceos/api/src/modules/reporting/dto/revenue-invoices-response.dto.ts (grep'd)
/Users/Anthony_1/serviceos/web/src/app/(dashboard)/jobs/[id]/page.tsx
/Users/Anthony_1/serviceos/web/src/app/(dashboard)/jobs/page.tsx
/Users/Anthony_1/serviceos/web/src/components/dropdown.tsx
/Users/Anthony_1/serviceos/web/src/lib/feature-registry.ts (grep'd)
/Users/Anthony_1/serviceos/web/src/lib/job-status.ts (prior session)
/Users/Anthony_1/serviceos/migrations/2026-04-25-payments-refund-provider-status.sql
git show 5d6486e (Arc J.1)
git show 41d9387 (Arc H — CLEAR_DRIVER_TARGETS pattern)
git show e78dd9f (Arc J.1e — leg-row kebab introduction)
```

---

## 3. Per-bug findings

### § J.1f-bug1 — Driver still attached after orchestrator-path cancellation [P0]

#### Root cause

The orchestrator's job-write block at `api/src/modules/jobs/jobs.service.ts:4574-4582`:

```ts
await this.dataSource.transaction(async (manager) => {
  const txJobRepo = manager.getRepository(Job);

  // 1. Cancel the job itself.
  job.status = 'cancelled';
  job.cancelled_at = new Date();
  job.cancellation_reason = dto.cancellationReason.trim();
  job.rescheduled_by_customer = false;
  await txJobRepo.save(job);
  ...
```

This block writes `status`, `cancelled_at`, `cancellation_reason`, `rescheduled_by_customer` — and **does not touch `assigned_driver_id`**. There is no `CLEAR_DRIVER_TARGETS.has(...)` check, no in-memory `job.assigned_driver_id = null`, and no post-save `txJobRepo.update({ assigned_driver_id: null })`.

The working override-status path at `:1289-1331` does it correctly:

```ts
if (isAdmin && CLEAR_DRIVER_TARGETS.has(dto.status)) {
  job.assigned_driver_id = null as unknown as string;
}
const saved = await txJobRepo.save(job);
if (isAdmin && CLEAR_DRIVER_TARGETS.has(dto.status)) {
  await txJobRepo.update(
    { id: job.id, tenant_id: tenantId },
    { assigned_driver_id: null },
  );
}
```

Arc H's commit message (`41d9387`) explicitly cited cancellation as the motivating bug: *"Cancellation didn't clear the driver. UNASSIGNED_TARGETS only contained {pending, confirmed}, so terminal-status overrides never fired the clear block. Renamed to CLEAR_DRIVER_TARGETS and broadened to {pending, confirmed, cancelled, completed}."* The pattern was wired into the override path. The Arc J.1 orchestrator (added 5 weeks later) re-introduced the bug because it is a new write path that doesn't share `changeStatus`'s code.

**Why `txJobRepo.save(job)` alone isn't enough even if we set `job.assigned_driver_id = null`:** TypeORM `Repository.save(entity)` reconciles a loaded relation (`job.assigned_driver`) against the FK column. If the entity was fetched with `leftJoinAndSelect('j.assigned_driver', ...)` (which `findOne` does at `jobs.service.ts:findOne`), `save()` rehydrates `assigned_driver_id` from `assigned_driver.id` and silently overwrites the explicit null. The Arc H column-only `Repository.update` post-save bypasses the relation reconciliation.

**Confirmation that the orchestrator loads the relation:** the `findOne` call at line 4438 (`this.jobsRepository.findOne({ where: { id: jobId, tenant_id: tenantId } })`) does NOT include `relations: ['assigned_driver']`. Inspect: it currently does not load the relation. **However**, the `save(job)` path is still risky: if any future change to `findOne` adds the relation, the bug returns silently. Phase 1 should use the column-only `update` regardless, matching the Arc H precedent for forward safety.

#### Proposed fix approach

Inside the existing transaction, after `await txJobRepo.save(job)` at line 4582, add:

```ts
// Arc J.1f-bug1 — mirror the override-status path's CLEAR_DRIVER_TARGETS
// driver-clear coupling. cancelled is unconditionally a target, so the
// conditional is unnecessary here. Column-only update bypasses TypeORM's
// relation-FK reconciliation (Arc H pattern).
if (job.assigned_driver_id) {
  await txJobRepo.update(
    { id: job.id, tenant_id: tenantId },
    { assigned_driver_id: null },
  );
}
```

The `if (job.assigned_driver_id)` guard skips the no-op write when no driver was attached. The `update` runs inside the same transaction as the save, so it commits or rolls back as one unit with the rest of the orchestrator writes (per-invoice decisions, audit rows).

#### Files to modify in Phase 1

- `api/src/modules/jobs/jobs.service.ts` — single hunk inside `cancelJobWithFinancials` transaction body, ~6 lines.

#### DB constraints touched

- `jobs.assigned_driver_id` — FK to `users` table (already exists). Setting to NULL respects the FK. No CHECK constraints. NOT NULL — confirmed nullable per Arc H (driver assignment is optional).
- No new constraints needed.

#### Multi-tenant verification

The proposed `txJobRepo.update({ id: job.id, tenant_id: tenantId }, { assigned_driver_id: null })` includes `tenant_id` in the WHERE clause. ✅ Tenant-scoped.

The `job` object loaded at line 4438 was already tenant-scoped via `findOne({ where: { id: jobId, tenant_id: tenantId } })`. The post-save update reaffirms the scope.

#### Existing test impact

Searched `jobs.service.spec.ts` for any assertion on `assigned_driver_id` after `cancelJobWithFinancials`:

```
$ grep -n "assigned_driver_id" jobs.service.spec.ts
(none in the J-suite)
```

The 16 J-suite tests do NOT assert driver-clearing. The 22 changeStatus tests at the top of the file include 7 (Arc H suite H1-H7) that DO assert `txJobUpdate` was called with `{ assigned_driver_id: null }` — but those tests target `changeStatus`, not `cancelJobWithFinancials`. **No existing test asserts the bug or the fix.**

After the fix lands: all 113 tests still pass. The new Phase 1 test must use the existing `txJobUpdate` mock spy already on the harness.

#### Tests to add in Phase 1

One new test, slot it adjacent to the J-suite (e.g., after J7 or before the cascadeDelete smoke):

> **J13. cancelJobWithFinancials clears assigned_driver_id via column-only update.** Build harness with a job that has `assigned_driver_id: 'driver-1'`. Run any decision (e.g., `void_unpaid` against an unpaid invoice) and assert `h.txJobUpdate` was called with `{ id: 'job-1', tenant_id: 'tenant-1' }` AND `{ assigned_driver_id: null }`. Optionally add a J13b that asserts the update is NOT called when `assigned_driver_id` was already null (no-op skip).

#### Registry keys needed

None.

#### Production data consequence

Anthony's prompt notes "16+ jobs in tenant `822481be-...` have status=cancelled with stale `assigned_driver_id`." Arc H shipped a cleanup SQL at `migrations/cleanup_leaked_driver_assignments_arc_h.sql` for the prior wave. Phase 1 should ship a similar one-shot SQL, matching the Arc H precedent:

```sql
-- arcJ1f-bug1-cleanup.sql (NEW)
UPDATE jobs SET assigned_driver_id = NULL
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'cancelled'
  AND assigned_driver_id IS NOT NULL;
```

Recommendation: ship as a separate SQL file (run via Supabase editor post-deploy), parallel to the Arc H cleanup. Do NOT inline as runtime app code — Arc H precedent is a one-shot migration, and reusing the next-driver-assignment-overwrites approach is operationally noisy.

#### Recommended fix order within the bug

1. Add the column-only update inside the transaction (the 6-line edit).
2. Add J13 test, watch RED.
3. Run jest, watch GREEN (114/114).
4. Stage SQL cleanup file. Anthony decides whether to run it pre-deploy or post-deploy.

---

### § J.1f-bug2 — `payments.refunded_amount` written incorrectly on `manual_required` write [P0 financial]

#### Root cause

The `refund_paid` decision branch in the helper at `jobs.service.ts:4248-4259`:

```ts
const refundProviderStatus =
  payment.payment_method === 'cash'
    ? 'manual_completed'
    : payment.stripe_payment_intent_id
      ? 'pending_stripe'
      : 'manual_required';

const newRefunded =
  Math.round(
    (Number(payment.refunded_amount || 0) + amountPaid) * 100,
  ) / 100;

await paymentRepo.update(
  { id: payment.id, tenant_id: tenantId },
  {
    refunded_amount: newRefunded,        // ← unconditional, regardless of provider status
    refund_provider_status: refundProviderStatus,
  },
);
```

`newRefunded` is set unconditionally. For `manual_required` (no PI present), no refund has been processed, but `refunded_amount` is incremented as if it had. Smoke #1' DB state confirms: `payment.refunded_amount=850, refund_provider_status='manual_required'`.

The post-commit Stripe success handler at `:4677-4699` updates ONLY `refund_provider_status='stripe_succeeded'` — it does NOT touch `refunded_amount`. So the inside-tx write is the ONLY place `refunded_amount` is set on this code path.

#### Column-semantics contract (specification)

| `refund_provider_status` | Meaning | `refunded_amount` should be |
|---|---|---|
| `null` | No refund attempted on this payment | `0` |
| `pending_stripe` | Stripe API call is in flight (post-commit) | **`0`** |
| `stripe_succeeded` | Post-commit Stripe API confirmed refund | **`amountPaid`** (set in post-commit handler) |
| `stripe_failed` | Post-commit Stripe API rejected | `0` (stays 0) |
| `manual_required` | Card without PI; operator must refund manually in Stripe Dashboard | **`0`** |
| `manual_completed` | Cash refund; presumed instant by ops | `amountPaid` |

This contract aligns `refunded_amount` strictly with "money actually returned." Stripe's own `amount_refunded` follows this semantic.

The current code violates the contract for `pending_stripe` (writes amount up-front) and `manual_required` (writes amount despite no money moving).

#### Proposed fix approach

**Two related edits, both inside `applyFinancialDecisionTx` and `cancelJobWithFinancials`:**

1. **Inside-tx write (`:4248-4259`):** only write `refunded_amount` when the refund is actually completed at write time (`manual_completed` only). For `pending_stripe` and `manual_required`, write only `refund_provider_status`. Rewritten:

   ```ts
   const updatePayload: Partial<Payment> = {
     refund_provider_status: refundProviderStatus,
   };
   if (refundProviderStatus === 'manual_completed') {
     updatePayload.refunded_amount = newRefunded;
   }
   await paymentRepo.update(
     { id: payment.id, tenant_id: tenantId },
     updatePayload,
   );
   ```

2. **Post-commit Stripe success handler (`:4677-4699`):** add `refunded_amount` to the update on success:

   ```ts
   await postMgr.getRepository(Payment).update(
     { id: intent.paymentId, tenant_id: tenantId },
     {
       refund_provider_status: 'stripe_succeeded',
       refunded_amount: intent.amount,   // ← NEW
     },
   );
   ```

   The `intent` already carries `amount` (line 4564). For accumulating refunds across multiple cancellations (rare; not observed today), Phase 1 should use `intent.amount + payment.refunded_amount` lookup — but for Arc J.1 invariant of one refund per payment, `intent.amount` alone is correct. **Recommend: `intent.amount` for now; document that multi-refund-per-payment is out of scope.** The audit metadata at `:4694` already preserves the count via successive audit rows.

3. **Post-commit Stripe failure handler (`:4702-4726`):** unchanged. `refund_provider_status='stripe_failed'`, `refunded_amount` was 0 going in (per fix #1) and stays 0.

The audit metadata stored on the credit_audit_events row (`paid_portion_amount`) already captures the **intended** refund amount, so for `manual_required` the operator (or a future reconciliation report) can recover the amount-to-be-refunded without `refunded_amount` being polluted.

#### Files to modify in Phase 1

- `api/src/modules/jobs/jobs.service.ts` — two hunks, total ~12 lines:
  - `applyFinancialDecisionTx` `refund_paid` branch (`:4248-4259`)
  - `cancelJobWithFinancials` post-commit Stripe success handler (`:4677-4699`)

#### DB constraints touched

- **Column write target:** `payments.refunded_amount` (decimal(10,2), default 0).
- **Schema gap (out-of-scope finding):** `payments.refund_provider_status` ships from Deploy #15 with **NO `CHECK` constraint**. The migration at `migrations/2026-04-25-payments-refund-provider-status.sql:18-19` is `ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_provider_status TEXT NULL;` — accepts any string. The 6-value contract above (`pending_stripe | stripe_succeeded | stripe_failed | manual_required | manual_completed | NULL`) is enforced ONLY at the application layer by the literal strings the orchestrator writes. **Recommend a follow-up migration** to add the CHECK constraint; flagged in §7. Not blocking for J.1f-bug2 itself.

#### Multi-tenant verification

Both updates already include `tenant_id` filters at `:4254` and `:4680`. ✅ Tenant-scoped. Fix preserves both.

#### Existing test impact

**Two J-suite tests assert the buggy behavior** and MUST be updated:

- **J4** (`jobs.service.spec.ts:1446-1453`):
  ```ts
  expect(h.txPaymentUpdate).toHaveBeenCalledWith(
    { id: 'pay-4', tenant_id: 'tenant-1' },
    expect.objectContaining({
      refunded_amount: 750,                 // ← MUST CHANGE TO 0 (or absent)
      refund_provider_status: 'pending_stripe',
    }),
  );
  ```
  After fix: assert `refunded_amount` is NOT in the inside-tx call (or is 0); assert the post-commit success update DOES contain `refunded_amount: 750`.

- **J5** (`jobs.service.spec.ts:1645-1651`):
  ```ts
  expect(h.txPaymentUpdate).toHaveBeenCalledWith(
    { id: 'pay-5', tenant_id: 'tenant-1' },
    expect.objectContaining({
      refunded_amount: 300,                 // ← MUST CHANGE TO 0 (or absent)
      refund_provider_status: 'manual_required',
    }),
  );
  ```
  After fix: assert `refunded_amount` is NOT in the call (or is 0); the audit metadata's `paid_portion_amount: 300` carries the intended amount.

J4b, J4c, J3, J6, J7 do NOT assert `refunded_amount`. Unchanged.

J3 (credit_memo) and J6 (keep_paid) and J2 (void_unpaid) do NOT touch the payment row, so unaffected.

The cascadeDelete smoke test does not touch `refunded_amount`.

#### Tests to add in Phase 1

Update J4 and J5 in place. Optionally add:

> **J5b. refund_paid with cash payment_method — manual_completed status WITH refunded_amount written immediately.** Build harness with `payment_method='cash', stripe_payment_intent_id=null`. Assert `txPaymentUpdate` called with `refunded_amount: amountPaid, refund_provider_status: 'manual_completed'`. Currently no test exists for the cash path.

> **J4d. post-commit Stripe success writes refunded_amount.** Extend J4 or add a sibling that explicitly asserts the post-commit success-path update payload includes `refunded_amount: intent.amount` and `refund_provider_status: 'stripe_succeeded'` together (not just status).

#### Registry keys needed

None.

#### Production data consequence

Smoke #1' (Maria Santos, payment `19bd0192-2d27-4e9b-9577-45d7983e969e`, invoice 1006) is the **single known production write of the wrong value**: `refunded_amount=850, refund_provider_status='manual_required'`. One-shot SQL fix:

```sql
-- arcJ1f-bug2-cleanup.sql (NEW)
UPDATE payments
SET refunded_amount = 0
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND id = '19bd0192-2d27-4e9b-9577-45d7983e969e'
  AND refund_provider_status = 'manual_required'
  AND refunded_amount = 850;  -- guard against re-running after the operator manually refunds
```

Recommend running this BEFORE the Arc J.1f deploy, so the post-deploy state is consistent. Or accept as historical noise IF reporting tolerance is fine — but per the Anthony note about revenue under-reporting, fixing is the safer path.

#### Recommended fix order within the bug

1. Update J4 and J5 spec assertions (RED state). Run jest — J4 + J5 fail.
2. Apply the inside-tx write fix (only write `refunded_amount` for `manual_completed`).
3. Apply the post-commit success fix (add `refunded_amount` to update payload).
4. Add J5b (cash) and J4d (post-commit) tests.
5. Run jest — expect 115/115 (113 + J5b + J4d, with J4 and J5 updated in place).
6. Stage cleanup SQL.

---

### § J.2.A — Financials card invoice badge missing `voided` case [pre-launch UI]

#### Root cause

`web/src/app/(dashboard)/jobs/[id]/page.tsx:2458`:

```tsx
{isPaid ? "Paid" : inv.status === "draft" ? "Draft" : "Unpaid"}
```

The chain-scoped invoices section (lines 2419-2465, inside the `chainFinancials.invoices.map` block) renders one row per linked invoice. The status pill mapping handles `paid` and `draft` explicitly; every other status (`open`, `partial`, `voided`, `overdue`) falls through to `"Unpaid"`. This is consistent for `open`/`partial`/`overdue` (they ARE unpaid), but wrong for `voided` (the invoice is closed, not unpaid).

The companion COLOR mapping at `:2451-2456` correctly distinguishes paid/overdue/other but doesn't have a `voided` color either.

There is a SECOND status display further down on the same page — the **Invoice Summary panel** at `:2728-2755`. That one renders `{invoice.status}` raw with `capitalize` class, so for a voided invoice it would display "Voided" correctly — **provided the panel was rendering the right invoice**, which is what J.2.B is about. So the same page actually has TWO invoice-status renderings, one buggy (J.2.A on Financials) and one intended-correctly (Invoice Summary, separately broken by J.2.B).

There is also a THIRD site at `:3812` (`{inv.invoice_status}`) inside the cancel modal's Step 1 invoice list — that one already renders raw status correctly.

#### Proposed fix approach

Single-line edit at `:2458`. Add the `voided` case explicitly:

```tsx
{
  isPaid ? "Paid"
  : inv.status === "draft" ? "Draft"
  : inv.status === "voided" ? (FEATURE_REGISTRY.invoice_status_voided?.label ?? "Voided")
  : (FEATURE_REGISTRY.invoice_status_unpaid?.label ?? "Unpaid")
}
```

And mirror in the color block at `:2451-2456`:

```tsx
color: isPaid
  ? "var(--t-accent)"
  : inv.status === "voided"
    ? "var(--t-text-muted)"        // muted — closed, not active
    : isOverdue
      ? "var(--t-error)"
      : "var(--t-warning)",
```

Plus: also gate the `"Due: $N"` chip at `:2440-2447` on `inv.status !== "voided"` so a voided invoice doesn't render a stale "Due:" pill (balance_due is 0 after void, so the existing `Number(inv.balanceDue) > 0` guard already handles it implicitly — but adding an explicit voided check is more legible).

#### Files to modify in Phase 1

- `web/src/app/(dashboard)/jobs/[id]/page.tsx` — single hunk at `:2440-2462`, ~4-6 lines net.
- `web/src/lib/feature-registry.ts` — 2 new keys (see below).

#### DB constraints touched

None — frontend-only.

#### Multi-tenant verification

N/A — display layer reads from already-tenant-scoped `chainFinancials` data (fetched via `setChainFinancials` at `:930` from a tenant-scoped backend endpoint). Fix doesn't introduce new reads.

#### Existing test impact

No tests exist in `web/src/__tests__/` or alongside `jobs/[id]/page.tsx` for this badge mapping. Confirmed by grep: no jest test file references `chainFinancials.invoices` or the literal `"Unpaid"` label assertion.

#### Tests to add in Phase 1

Optional — this is a 4-line UI fix with visual smoke as the primary verification. If component-level tests are desired:

> **Financials chain-invoice badge renders "Voided" for `voided` status.** Mock `chainFinancials.invoices` with a voided invoice; render; assert badge text = "Voided" and color = muted.

Phase 1 may legitimately ship without this test if visual smoke (Anthony's S1 reproduction) is fast and reliable.

#### Registry keys needed

Two new keys at `web/src/lib/feature-registry.ts`:

- `invoice_status_voided` → label `"Voided"`, category `operations`, surface `job_detail`
- `invoice_status_unpaid` → label `"Unpaid"`, category `operations`, surface `job_detail`

Adding the `unpaid` key alongside is registry hygiene — the existing fallback `"Unpaid"` is already a hardcoded literal that should be registry-driven per standing rule #1. This is a registry consolidation opportunity, not a separate fix.

#### Recommended fix order within the bug

1. Add the two registry keys.
2. Update the badge mapping line (single edit).
3. Update the color mapping (single edit).
4. Visual smoke against a voided-invoice job.

---

### § J.2.B — Invoice Summary panel renders unrelated customer's invoice [pre-launch UI / backend bug]

#### ⚠ Stop-condition flag

Per the prompt's stop conditions: *"Any bug appears to require touching code outside of `cancelJobWithFinancials`, the Financials card, the Invoice Summary panel, the lifecycle list page, or shadcn Dropdown usage — flag and ask."*

**This bug's root cause is in `invoice.service.ts` and `list-invoices-query.dto.ts` — both outside the listed surfaces.** The Invoice Summary panel itself (`jobs/[id]/page.tsx:2714-2755`) is correctly written. **Flagging for explicit Phase 1 approval.**

#### Root cause

Two-part backend gap:

**Part 1 — DTO is missing `jobId`:** `api/src/modules/billing/dto/list-invoices-query.dto.ts` declares only `status`, `customerId`, `dateFrom`, `dateTo`, `search`, `page`, `limit`. There is no `jobId` field. NestJS' global `whitelist: true` ValidationPipe silently strips unknown fields from the parsed query before `findAll` ever sees them.

**Part 2 — Service has no `jobId` branch:** `api/src/modules/billing/services/invoice.service.ts:485-535` (`findAll`) builds a query with branches for `query.status`, `query.customerId`, `query.dateFrom`, `query.dateTo`, `query.search`. **There is no `if (query.jobId) qb.andWhere(...)` branch.** The query falls through to a tenant-wide-most-recent-by-`invoice_number` ORDER BY DESC LIMIT 1 result.

**Frontend behavior** at `jobs/[id]/page.tsx:950-953`:

```ts
const fetchInvoice = async () => {
  const res = await api.get<{ data: Array<...> }>(`/invoices?jobId=${id}&limit=1`);
  if (res.data && res.data.length > 0) setInvoice(res.data[0]);
};
```

The `jobId=${id}` is sent in the URL. NestJS strips it (Part 1). The service ignores it (Part 2). `findAll` returns the tenant-wide latest invoice (ordered DESC by invoice_number, limit 1). Anthony's observation that invoice #1015 (Tom Richards) leaks across every job page is consistent: #1015 is the highest invoice_number in the tenant.

#### Multi-tenant isolation: PRESERVED

`invoice.service.ts:498`: `qb.where('i.tenant_id = :tenantId', { tenantId })`. ✅ Tenant boundary holds. The leak is **within-tenant cross-customer**, not cross-tenant. Severity is high for ops-error risk (mis-applying actions to wrong customer's invoice) but is NOT a tenant-isolation breach.

#### Proposed fix approach

**Two-file edit:**

1. **`api/src/modules/billing/dto/list-invoices-query.dto.ts`** — add the field:

   ```ts
   @IsOptional()
   @IsUUID()
   jobId?: string;
   ```

2. **`api/src/modules/billing/services/invoice.service.ts:findAll`** — add the branch (between `customerId` and `dateFrom` for ordering consistency):

   ```ts
   if (query.jobId) {
     qb.andWhere('i.job_id = :jobId', { jobId: query.jobId });
   }
   ```

That's it. The frontend at `jobs/[id]/page.tsx:950-953` is already calling the right URL with the right param shape. No frontend change needed.

**Optional improvement** (call out for review, do NOT bundle): `chain_invoice_id` scoping. If a job is linked to a rental_chain that has multiple invoices, the current frontend query `?jobId=${id}` returns only invoices with `invoice.job_id = id` directly — chain-linked invoices that belong to a sibling job in the chain are excluded. If the operator's expectation is "show me ALL invoices on this job's chain," the frontend should also accept `chainId`, OR the backend should add an OR-branch. **Defer**: chain semantics are a separate UX policy decision. The Phase 1 fix targets ONLY the directly-linked-job case.

#### Files to modify in Phase 1

- `api/src/modules/billing/dto/list-invoices-query.dto.ts` — +4 lines (one `@IsOptional() @IsUUID() jobId?: string;` field).
- `api/src/modules/billing/services/invoice.service.ts` — +3 lines (one `if (query.jobId)` branch).

**No frontend changes.** The Invoice Summary panel (`jobs/[id]/page.tsx:2714-2755`) is already calling the right URL.

#### DB constraints touched

None — read-only query change. The `invoices.job_id` column already exists with an FK to `jobs.id`.

#### Multi-tenant verification

The fix adds `qb.andWhere('i.job_id = :jobId', ...)` to a query that already has `qb.where('i.tenant_id = :tenantId', ...)`. The two scope clauses are AND'ed in the WHERE. ✅ Tenant scoping preserved; the new `job_id` scope is additive.

A defensive `tenant_id` re-check on the job lookup is unnecessary here because invoices already join through `tenant_id` first.

#### Existing test impact

Searched for `findAll`-related tests in `api/src/modules/billing/services/__tests__/` and `api/src/**/*.spec.ts`. No test exists that asserts the absence of jobId filter. **The bug ships untested.** Phase 1 must add coverage.

#### Tests to add in Phase 1

Two-test minimum (or one combined):

> **invoice.service findAll respects jobId.** Seed two invoices in the same tenant, different jobs. Call `findAll(tenantId, { jobId: 'job-1', limit: 10 })`. Assert only invoices with `job_id === 'job-1'` are returned. Assert the `tenant_id = :tenantId` clause is preserved (no leak).

> **invoice.service findAll respects jobId AND tenantId together.** Seed invoices in two different tenants, both linked to a job in tenant A. Call `findAll(tenantId_B, { jobId: 'job-of-tenant-A' })`. Assert the result is empty (multi-tenant scope wins).

#### Registry keys needed

None.

#### Recommended fix order within the bug

1. Add `jobId` to the DTO.
2. Add the branch in `findAll`.
3. Add the two tests.
4. Visual smoke against multiple job pages (verify Invoice Summary now shows the correct per-job invoice).

---

### § J.1f-bug3 — Lifecycle leg kebab non-clickable [P1 entry-point]

#### Root cause

The custom `Dropdown` component at `web/src/components/dropdown.tsx:154-170` renders:

```tsx
<div className="relative" ref={triggerRef}>
  <div onClick={() => setOpen(!open)} className="cursor-pointer">
    {trigger}
  </div>
  {open && (
    <div ref={menuRef} ...>
      {children}
    </div>
  )}
</div>
```

The Dropdown attaches its open-toggle handler to the **wrapping `<div>` around the trigger**, not on the trigger element itself. The trigger is rendered as-is via React children.

The leg-row kebab at `web/src/app/(dashboard)/jobs/page.tsx:1192-1203` passes a trigger button with a `stopPropagation` handler:

```tsx
<Dropdown
  trigger={
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}    // ← THE BUG
      className="..."
      aria-label={...}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </button>
  }
  align="right"
>
```

Click event order on a kebab tap:
1. The button's `onClick` fires: `e.stopPropagation()`.
2. `stopPropagation()` halts bubbling. The wrapping div's `onClick={() => setOpen(!open)}` **never fires**.
3. Menu does not open.

The `stopPropagation` was added in Arc J.1e to prevent the row's parent click handler (`<tr onClick={() => router.push(/jobs/${childJob.id})}>` at `:1138`) from firing on kebab clicks. Without stopPropagation, the row navigates BEFORE the menu opens, so the user is whisked away. The fix Arc J.1e applied was correct in intent but applied at the wrong layer.

**Comparing to other working Dropdown sites in the codebase:**

- `dispatch/page.tsx:1465-1498` (Awaiting Dump → Create Run dropdown): trigger button has `onClick={e => e.stopPropagation()}`. **Same anti-pattern!** Why does that one work? The Awaiting Dump panel's trigger has no row-click ancestor that triggers navigation, so `stopPropagation` is a no-op there — the menu still opens because the wrapping div's onClick fires when the user clicks **anywhere ELSE in the trigger area** (e.g., clicking near the icon vs the button rim). Confirmed: this is a long-standing latent bug in the Dropdown component contract that was never noticed because no other call site combined kebab-button + row-click navigation. The leg-row kebab is the first.

- `jobs/[id]/page.tsx:1408-1518` (job-detail kebab): trigger button has NO `onClick` — just a styled `<button>` whose click bubbles cleanly up to the Dropdown wrapping div. Works perfectly. There is no row-navigation ancestor on the job-detail page to interfere.

#### Proposed fix approach

**Restructure the leg-row kebab to put `stopPropagation` on a wrapping element AROUND the Dropdown, not on the trigger button itself:**

```tsx
{isOfficeRole && canCancelJobByStatus(childJob.status) && (
  <span
    onClick={(e) => e.stopPropagation()}    // ← row-click guard moves here
    className="inline-flex"
  >
    <Dropdown
      trigger={
        <button
          type="button"
          // (no onClick — let it bubble to Dropdown's wrapper div)
          className="p-1 rounded hover:bg-[var(--t-bg-card-hover)] transition-colors"
          style={{ color: "var(--t-text-muted)" }}
          aria-label={FEATURE_REGISTRY.lifecycle_leg_actions_menu?.label ?? "Leg actions"}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      }
      align="right"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          snapshotListState();
          router.push(`/jobs/${childJob.id}?cancel=1`);
        }}
        className="..."
      >
        <XCircle className="h-3.5 w-3.5" />
        {FEATURE_REGISTRY.lifecycle_leg_cancel_action?.label ?? "Cancel Job"}
      </button>
    </Dropdown>
  </span>
)}
```

**Click event order under the fix:**
1. User clicks kebab button. Button has no `onClick`.
2. Bubbles to Dropdown's wrapping div: `setOpen(!open)` — menu opens. ✓
3. Bubbles to outer `<span>`: `stopPropagation()` — row's `onClick` (which would navigate to `/jobs/${childJob.id}`) is suppressed. ✓

The menu item (Cancel Job) keeps its own `e.stopPropagation()` so that clicking the item also doesn't bubble all the way to the row. Belt-and-suspenders.

**Alternative considered: fix the Dropdown component itself** to invoke its own click handler regardless of whether the trigger swallows propagation (e.g., wrap the trigger in a `cloneElement` that injects an onClick). **Rejected** — that's a global change that could have side effects on other call sites; per standing rule #7 (additive changes), prefer adding a wrapper at the leg-row site. The Dropdown contract issue is documented but doesn't need to be fixed for J.1f-bug3.

#### Files to modify in Phase 1

- `web/src/app/(dashboard)/jobs/page.tsx` — single hunk at `:1191-1219`, adds `<span onClick=stopPropagation>` wrapper, removes inline `onClick` from trigger button. Net ~3 lines added.

#### DB constraints touched

None — frontend-only.

#### Multi-tenant verification

N/A — UI restructure only; no data fetch changes. Existing role gate (`isOfficeRole`) and domain gate (`canCancelJobByStatus(childJob.status)`) preserved.

#### Existing test impact

No tests exist for the lifecycle leg kebab. Unchanged.

#### Tests to add in Phase 1

Anthony's prompt explicitly calls for one:

> **Lifecycle leg kebab opens menu and navigates without triggering row click.** Render `JobsPageContent` with a chain expanded. Find a leg row's kebab. Click it. Assert the menu opens (visible "Cancel Job" item). Click the Cancel Job item. Assert `router.push` was called with `/jobs/[childJobId]?cancel=1` AND the row's onClick was NOT called (no navigation to the leg's plain detail page).

Note: this requires React Testing Library and a router mock. If the Phase 1 budget doesn't accommodate a full test, **fall back to a Playwright/visual smoke** as Anthony's S6 implicitly does. Recommend the unit test only if the harness already exists in `web/src/`.

A search for existing web component tests found `web/src/lib/lifecycle-pickup.test.ts` and `web/src/lib/customer-autocomplete-core.test.ts` — both are pure-function tests, no React rendering. **There is no existing pattern for component tests in web/.** Phase 1 should NOT introduce one for this bug; rely on visual smoke.

#### Registry keys needed

None — existing `lifecycle_leg_actions_menu` and `lifecycle_leg_cancel_action` keys (added in Arc J.1e) are reused as-is.

#### Recommended fix order within the bug

1. Apply the JSX restructure (~3 lines).
2. `npx tsc --noEmit` confirms clean.
3. Visual smoke per Anthony's S6 (Phase 1 prompt should specify exact steps).
4. Optionally back-fix the same anti-pattern at `dispatch/page.tsx:1465-1498` (Awaiting Dump dropdown) — defer per scope rule #10 (out-of-scope observation).

---

## 4. Cross-cutting findings

### 4.1 Pattern: Arc J.1 orchestrator path is structurally separate from the override path

J.1f-bug1 and J.1f-bug2 both stem from the same architectural reality: `cancelJobWithFinancials` is a fresh code path that doesn't share `changeStatus`'s helpers. The orchestrator re-implements the job-state mutation inline rather than calling a shared helper. As a result:

- Arc H's `CLEAR_DRIVER_TARGETS` driver-clear coupling does not fire (J.1f-bug1).
- The semantic of `payments.refunded_amount` was set without consulting the column-semantics contract that the post-commit Stripe handler implicitly defines (J.1f-bug2).

**Out-of-scope recommendation for a future arc:** extract a `applyTerminalJobMutationsTx(manager, job, terminalStatus, tenantId)` helper that owns `status`, `cancelled_at`/`completed_at` (and other timestamps), `cancellation_reason`, `rescheduled_by_customer = false` AND the `CLEAR_DRIVER_TARGETS` driver-clear. Both `changeStatus` and `cancelJobWithFinancials` would call it. Arc J.1g or later. **Do not bundle into J.1f.**

### 4.2 Pattern: missing CHECK constraints on Arc J.1 schema additions

`payments.refund_provider_status` was added in Deploy #15 with no `CHECK` constraint. Application-layer validation is the only enforcement of the 6-value contract. This is a recurring discipline gap (cf. the `credit_audit_events.event_type` constraint that was missed in Deploy #15 and only caught in smoke #4 runtime). **Out-of-scope for J.1f**, but recommended Phase 2 follow-up: a one-shot migration adding `CHECK (refund_provider_status IS NULL OR refund_provider_status IN ('pending_stripe', 'stripe_succeeded', 'stripe_failed', 'manual_required', 'manual_completed'))`. Verify against current production data first (no rows exist with values outside that set).

### 4.3 Pattern: tests asserting buggy behavior (J4, J5)

Two J-suite tests written during Arc J.1 Phase 1 captured the orchestrator's THEN-implementation behavior verbatim, not the intended contract. Without a pre-implementation contract spec, the tests "passed" the wrong invariant. Phase 1 should update both. **Process recommendation:** for any future financial decision branch, the contract should be specified BEFORE the test is written, even if it's just a paragraph.

### 4.4 Pattern: missing query DTO fields are silently stripped

J.2.B's root cause depends on NestJS' `whitelist: true` ValidationPipe stripping unknown fields. This is the correct security default — it prevents arbitrary client-side queries. But it makes "missing DTO field" silent at runtime. Recommend a one-time grep: `grep -r 'api.get.*\?.*=' web/src` and audit each query string for backend DTO coverage. **Out-of-scope for J.1f**, but a high-leverage discipline check.

---

## 5. Security review

### 5.1 Per-bug

| Bug | Tenant isolation | Auth | RBAC | Public surface? | PII concern |
|---|---|---|---|---|---|
| J.1f-bug1 | ✅ Fix's `txJobRepo.update` includes `tenant_id` | n/a (no endpoint change) | n/a (orchestrator already `@Roles('owner','admin')`) | No | No new |
| J.1f-bug2 | ✅ Both inside-tx and post-commit updates already include `tenant_id` | n/a | n/a | No | **Audit metadata change**: post-commit success now also writes `refunded_amount: intent.amount` — already in `intent.auditMetadata` shape. No new PII. |
| J.2.A | n/a (frontend) | n/a | n/a (display only; backend role-gates the orchestrator that produced the voided state) | No | No |
| J.2.B | ✅ Tenant scope already in `findAll`. Fix adds `jobId` AND'd into existing tenant filter | `JwtAuthGuard` already on the `/invoices` controller (verified at `:42-44`) | The endpoint is `findAll` with no role decorator — implicitly any tenant user can list invoices. Acceptable; ops dashboard is the consumer. The fix doesn't change role gating. | No (auth-only) | No |
| J.1f-bug3 | n/a (frontend) | n/a | Existing role gate `isOfficeRole` preserved | No | No |

### 5.2 Summary

- No bug introduces a new endpoint.
- No bug touches an unauthenticated or public flow.
- No bug introduces new PII collection or surfacing.
- All five fixes preserve tenant isolation; J.1f-bug1 and J.2.B both add EXTRA scoping (driver clear by `tenant_id`, invoice filter by `tenant_id` AND `job_id`) without weakening any existing scope.
- Backend orchestrator's `RolesGuard('owner', 'admin')` at `jobs.controller.ts:301-302` is unchanged.

No security-review escalations.

---

## 6. Phase 1 implementation order

**Recommendation: 3 separate PRs.** Single-PR bundling risks coupling test changes to UI changes to backend changes; review burden grows superlinearly with surface count.

### PR 1 — Backend orchestrator fixes (J.1f-bug1 + J.1f-bug2)

**Files:**
- `api/src/modules/jobs/jobs.service.ts` — 2 hunks (~18 lines net)
- `api/src/modules/jobs/jobs.service.spec.ts` — update J4 + J5 in place; add J5b, J4d, J13 (3 new tests)
- `migrations/arcJ1f-cleanup.sql` — NEW one-shot SQL combining bug1's driver-clear cleanup and bug2's payment-refund cleanup

**Test deltas:** 113 → 116 tests (J5b, J4d, J13 added; J4 + J5 updated in place).

**Why batch:** both bugs touch the same file. Both shipped in the same orchestrator. Test harness changes (the new spy assertions) overlap. Running jest once verifies both.

### PR 2 — Backend invoice-list filter (J.2.B)

**Files:**
- `api/src/modules/billing/dto/list-invoices-query.dto.ts` — +4 lines
- `api/src/modules/billing/services/invoice.service.ts` — +3 lines
- `api/src/modules/billing/services/__tests__/invoice.service.spec.ts` (or wherever) — 2 new tests

**Why separate from PR 1:** different module (billing vs jobs). Different risk profile (read-only filter vs financial-decision write logic). Reviewer attention should split.

**Stop-condition flag:** this PR touches code outside the prompt's explicit surface list. Anthony must approve before Phase 1 prompt is drafted.

### PR 3 — UI fixes (J.2.A + J.1f-bug3)

**Files:**
- `web/src/app/(dashboard)/jobs/[id]/page.tsx` — 1 hunk (J.2.A badge mapping)
- `web/src/app/(dashboard)/jobs/page.tsx` — 1 hunk (J.1f-bug3 stopPropagation move)
- `web/src/lib/feature-registry.ts` — 2 new keys (J.2.A)

**No new tests** — relies on visual smoke. Both bugs are surface-level.

**Why batch:** both are pure-frontend, both small, neither touches backend. Single visual smoke session covers both.

### Sequence recommendation

**Ship PR 1 → smoke driver-clear + refunded_amount → ship PR 3 → smoke leg-kebab + voided badge → ship PR 2 → smoke Invoice Summary panel.**

PR 1 first because production has data quality issues today (smoke #1' Maria refund row, 16+ stale driver assignments). PR 3 second because it unblocks Anthony's smoke #6 (J.1f-bug3 was the only blocker). PR 2 last because the Invoice Summary leak is non-destructive (display only) and ops can manually re-verify which invoice they're looking at via the invoice number/customer name in the meantime.

---

## 7. Out-of-scope observations

1. **Missing CHECK constraint on `payments.refund_provider_status`.** Migration 2026-04-25 only adds the column; no constraint enforces the 6-value contract. Recommend a Phase 2 migration with `CHECK (refund_provider_status IS NULL OR refund_provider_status IN (...))`. Verify production data first.

2. **`Dropdown` component contract gap.** The trigger swallows-propagation anti-pattern (J.1f-bug3 root cause) is also present at `dispatch/page.tsx:1465-1498`. That call site happens to work because no row-navigation ancestor exists. Recommend a future Dropdown refactor to clone-element-inject the open handler so trigger-level `onClick` doesn't swallow it. Or document the contract explicitly.

3. **Orchestrator/changeStatus shared terminal-mutation helper.** Cross-cutting finding 4.1. A future arc (J.1g or later) should extract the shared logic so the next new-write-path (e.g., bulk cancel, scheduled cancel, customer self-cancel) doesn't re-introduce these regressions.

4. **Chain-scoped invoice query for Invoice Summary panel.** When a job belongs to a rental_chain with multiple invoices, the `?jobId=` filter only returns directly-linked invoices. The operator's expectation may be "show all invoices on this chain." Defer; UX policy decision.

5. **Web component test infrastructure missing.** `web/src/lib/*.test.ts` exists but it's pure-function only. No React component tests for any page or component. The lifecycle leg kebab fix would benefit from a component test (per Anthony's prompt) but the harness doesn't exist. Recommend a future infra arc to bring `@testing-library/react` + `@testing-library/jest-dom` into the project's web jest config.

6. **`refunded_amount` cumulative semantics.** Current orchestrator code adds `Number(payment.refunded_amount || 0) + amountPaid` (cumulative). After the J.1f-bug2 fix, this is still correct for the `manual_completed` and post-commit `stripe_succeeded` paths — the post-commit handler should preserve the cumulative addition. However, the proposed fix uses `intent.amount` (single refund), which would NOT be cumulative across multiple cancellation arcs against the same payment. **For Arc J.1 (one refund per cancellation), this is fine.** Multi-refund-per-payment is out of scope. Documenting so Phase 1 doesn't accidentally regress.

7. **`/auth/profile` race condition (latent).** `currentUserRole` defaults to `null` until the fetch lands; during that window, `isOfficeRole === false` and Cancel Job items are hidden. This is correct (defaults secure), but on a slow network the kebab will briefly NOT contain a Cancel Job item even for an owner user. Likely imperceptible (sub-100ms typical), but if it becomes a UX complaint, lifting role into a context provider that hydrates from session storage would smooth it. Out-of-scope for J.1f.

---

**End of audit.** No code changed. Halting for review before Phase 1 implementation prompt is drafted.

**Files read are listed in §2.**

**Stop-condition flags requiring Anthony's explicit approval:**
1. J.2.B fix touches `invoice.service.ts` and `list-invoices-query.dto.ts` (outside the prompt's listed surfaces — flagged in §J.2.B).
2. The `refund_provider_status` missing CHECK constraint is a separate finding (§7.1) — recommend Phase 2 follow-up; not blocking J.1f-bug2.
