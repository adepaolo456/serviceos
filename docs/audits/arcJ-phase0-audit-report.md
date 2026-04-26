# Arc J — Phase 0 Audit Report (Cancellation / Financial Reconciliation)

**Status:** Read-only code archaeology. No code, schema, or DB changes made. DB findings pre-gathered in the prompt are restated where they bear on a code conclusion.

---

## Exec summary (5 bullets)

1. **One server entry point, two client paths.** Both the web cancel modal and direct override transitions converge on `PATCH /jobs/:id/status` → `JobsService.changeStatus`. The legacy `DELETE /jobs/:id` → `JobsService.cascadeDelete` is the *delete-task* flow (used by `delete-task-modal.tsx`) and is structurally separate, but is the only path that voids invoices + creates credit memos today. The cancel modal does NOT touch billing.
2. **No `credit_audit_events` write occurs anywhere on the cancel paths.** The 4 production rows come from `CreditAuditService.record` (fire-and-forget, non-transactional) called only by credit-hold and credit-settings flows. Phase 1 should reuse this writer but **decide intentionally** whether to keep its fire-and-forget semantics for cancellation events or wrap it in the change-status transaction (see § 5).
3. **`stripe_payment_intent_id` is reliably populated on exactly ONE of three card-payment paths** — admin "Charge Card on File" (`stripe.service.ts:152`). Portal Pay Now (Checkout webhook, `stripe.service.ts:287-295`) and admin "Record Payment" / mark-as-paid (`invoice.service.ts:353` with `dto` from a form that does not pass it) both leave it NULL. This matches the production data: 0 of 5 orphaned-paid invoices have a PI id, including the 3 card payments.
4. **No financial decision step in the cancel modal.** The Phase-2 modal in `jobs/[id]/page.tsx:3467+` shows a read-only invoice list and a required `cancelReason` textarea. There is no refund/credit/keep-paid selector. Confirm button calls `PATCH /jobs/:id/status` unchanged.
5. **The cancellation transaction is narrow.** `changeStatus` wraps only the `job.save()` + the `status_override` notification row in `dataSource.transaction` (`jobs.service.ts:1285-1343`). All side effects — customer notifications, billing detection, chain auto-close, asset state — run outside the transaction with best-effort / non-fatal semantics. `cascadeDelete` uses **no** transaction at all (`jobs.service.ts:1586-1806`).

---

## § 1. Cancellation entry points

### 1.1 Web cancel modal path — what the operator clicks "Cancel job" runs

**Controller:** `PATCH /jobs/:id/status`
- `api/src/modules/jobs/jobs.controller.ts:232-278` (`changeStatus`)

**Service:** `JobsService.changeStatus`
- `api/src/modules/jobs/jobs.service.ts:1146` — `job.status = dto.status`
- `api/src/modules/jobs/jobs.service.ts:1182-1189` — `cancelled` branch sets `job.cancelled_at = now` and (conditionally) `job.cancellation_reason`; clears `job.rescheduled_by_customer`

**Web caller:** `web/src/app/(dashboard)/jobs/[id]/page.tsx:986-1007` (`confirmCancelFromModal`) — POSTs `{ status: "cancelled", cancellationReason }` to `/jobs/:id/status`. The dispatch board, jobs list bulk-cancel, and dispatch row inline cancel all hit the same endpoint:
- `web/src/app/(dashboard)/dispatch/page.tsx:2908`
- `web/src/app/(dashboard)/jobs/page.tsx:1325`
- `web/src/app/(dashboard)/jobs/[id]/page.tsx:935-938` (the `prompt()` fallback path).

**DB writes inside the `dataSource.transaction` (`jobs.service.ts:1285-1343`), in execution order:**
1. `txJobRepo.save(job)` — updates `jobs` columns `status='cancelled'`, `cancelled_at`, `cancellation_reason`, `rescheduled_by_customer=false`, plus possibly `assigned_driver_id=null` (mutated in-memory at 1310; *also* re-set via `txJobRepo.update` at 1313-1318 to defeat TypeORM relation-rehydration). Gate: always.
2. `txJobRepo.update({ id, tenant_id }, { assigned_driver_id: null })` — column-only null persist. Gate: `isAdmin && CLEAR_DRIVER_TARGETS.has(dto.status)` (1313).
3. `txNotifRepo.save(...)` — writes `notifications` row of type `status_override`, channel `automation`, recipient `system`, body = JSON of `{from, to, overriddenBy, reason}`. Gate: `isAdmin && previousStatus !== dto.status && !isSanctionedForward` (1323).

**DB writes AFTER the transaction (best-effort, non-fatal where wrapped in `try {} catch {}`):**
4. Asset status auto-update (`updateAssetOnJobStatus`) at `jobs.service.ts:1403`. Updates `assets.status` for the job's asset. Always runs.
5. Route completion check (`checkRouteCompletion`) at 1407. Conditional: terminal statuses + driver + scheduled_date.
6. Rental-chain auto-close (`autoCloseChainIfTerminal`) at 1429. Conditional: `cancelled | failed | needs_reschedule`. Updates `rental_chains.status='cancelled'` if all linked jobs terminal.
7. Customer SMS/email status notifications (`notificationsService.send`) at 1445-1469. **No `cancelled` branch exists** — only `confirmed`, `en_route`, `completed`. → No customer notification is fired on cancellation today.

**Critically: no writes to `invoices`, `payments`, `credit_memos`, or `credit_audit_events` exist on this path.**

### 1.2 Direct override path — `PATCH :id/status` with `dto.status='cancelled'`

**Same endpoint, same service method, same writes** as 1.1. The `isAdmin` and `isSanctionedForward` flags branch into the override audit row (write #3), but the table-level effect is identical.

### 1.3 Cascade-delete path — `DELETE /jobs/:id` (the legacy "Delete task" flow)

**Controller:** `api/src/modules/jobs/jobs.controller.ts:366-381`

**Service:** `JobsService.cascadeDelete` — `jobs.service.ts:1586-1806`

**Web caller:** `web/src/components/delete-task-modal.tsx:114-121` — DELETE with `{deletePickup, voidInvoices, voidReason}`. Loads `/jobs/:id/cascade-preview` first (line 89).

**Writes (NO transaction wrapping; sequential):**
1. `jobsRepository.update` — soft-cancel main job: `status='cancelled', cancelled_at` (1662-1665).
2. `jobsRepository.update` — null out `assigned_driver_id` if present (1670-1673).
3. *(if `deletePickup` and delivery)* mirror writes on linked pickup job + asset release (1702-1729).
4. `assetRepo.update` — release main asset to `status='available'` if pre-delivery (1740-1745).
5. `invoiceRepo.update` — per opted-in invoice: `status='voided', voided_at, balance_due=0` (1765-1769).
6. `creditMemoRepo.save` — per voided invoice: insert into `credit_memos` (`tenant_id, original_invoice_id, customer_id, amount, reason, status='issued', created_by`) (1773-1782). **This is the only `credit_memos` writer in the API.**
7. `rentalChainRepo.update` — per chain: `status='cancelled'` (1795).

For a `driver_task` job, a hard-DELETE branch fires at 1628-1650 (deletes `task_chain_links` then `jobs` row).

### Convergence question

**Two separate implementations.** The cancel modal calls `PATCH /jobs/:id/status` → `changeStatus` (no billing/credit). The delete-task modal calls `DELETE /jobs/:id` → `cascadeDelete` (voids invoices + creates credit memos). They share no internal cancel function. This is the architectural gap Arc J must close: the cancel modal has no financial reconciliation step today, and `cascadeDelete` is reachable only via the "Delete task" UI, not the "Cancel" button.

---

## § 2. `credit_audit_events` writer location

**Sole writer:** `CreditAuditService.record` — `api/src/modules/credit-audit/credit-audit.service.ts:49-65`.

**Pattern (relevant for Phase 1 reuse):**
- Synchronous-call, async-execute, error-swallow: `this.repo.save(event).catch(...logger.warn)`. The caller does **not** `await` the save and never sees a failure.
- **Not bound to any transaction context.** The repository is the module-injected one, not a transactional manager.
- Type-safe `eventType` union at `credit-audit.service.ts:18-24`. **No `cancellation_*` event types exist.** Phase 1 will need to extend this union.

**Existing 4-row writers (matching the production `event_type` values):**
| event_type | Caller |
|---|---|
| `credit_settings_updated` | `api/src/modules/customers/services/customer-credit.service.ts:222` |
| `credit_hold_set` | `api/src/modules/customers/services/customer-credit.service.ts:275` |
| `credit_hold_released` | `api/src/modules/customers/services/customer-credit.service.ts:308` |

Other call sites that have NOT yet produced production rows for this tenant but use the same `record` method:
- `api/src/modules/billing/services/booking-credit-enforcement.service.ts:213`
- `api/src/modules/dispatch/dispatch-credit-enforcement.service.ts:175`, `:331`
- `api/src/modules/tenant-settings/tenant-settings.service.ts:128`

**Phase 1 implication:** the existing pattern is fire-and-forget. If cancellation-decision audit rows must be transactional with the status change (so a failed audit rolls the cancel back), Phase 1 must either inject the transactional `manager` and do the insert with that — or accept fire-and-forget with the same forensic risk that exists today for credit holds.

---

## § 3. `stripe_payment_intent_id` population check

| Path | Code site | Populates `stripe_payment_intent_id`? |
|---|---|---|
| **Admin SlideOver "Charge Card on File"** | `api/src/modules/stripe/stripe.service.ts:147-154` (`chargeInvoice` → `paymentRepo.save`) | **YES** — `stripe_payment_intent_id: pi.id` (line 152). Web caller: `web/src/app/(dashboard)/invoices/[id]/page.tsx:315` POSTs `/stripe/charge-invoice/:id`. |
| **Customer portal "Pay Now"** | `api/src/modules/stripe/stripe.service.ts:287-295` (`handleWebhook` → `checkout.session.completed`) | **NO** — payment row is built with `payment_method: 'stripe_checkout'`, and `stripe_payment_intent_id` is **not set** on the create. Web caller: `web/src/app/(portal)/portal/invoices/page.tsx:132` → `/portal/payments/prepare` → `portal.service.ts:1175` Stripe Checkout session. The session does carry a PI internally, but the webhook handler never reads `session.payment_intent` to populate the column. |
| **Admin "Record Payment" / mark-as-paid** | `api/src/modules/billing/services/invoice.service.ts:353` (`applyPayment`) | **CONDITIONALLY NO** — `stripe_payment_intent_id: dto.stripe_payment_intent_id`. The shared form `web/src/components/record-payment-form.tsx:50-54` POSTs only `{ amount, payment_method, notes }`. The DTO field is optional (`dto/apply-payment.dto.ts:12`) and is left undefined → column written as NULL. |

**Aligned with production data.** The 3 orphaned card payments (#1005, #1007, #1012) all have NULL `stripe_payment_intent_id` — consistent with them having been recorded via Pay Now (webhook path) or admin mark-as-paid, neither of which populates the column. The Charge-Card-on-File path is the only one that does.

**Phase 1 implication:** Stripe-API refunds are currently feasible **only** for new payments collected via Charge Card on File. To make automated refunds reliable for new cancellations going forward, Phase 1 needs a one-line fix on the webhook handler at `stripe.service.ts:287-295` (`stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id`) — and the `RecordPaymentForm` is irrelevant because manual mark-as-paid never has a real PI to refund. The 5 existing orphaned payments cannot be auto-refunded regardless and need a manual reconciliation backfill.

---

## § 4. Cancel modal UX state today

**Component file:** `web/src/app/(dashboard)/jobs/[id]/page.tsx` (modal markup at `:3467-3735`; state hooks at `:373-377`; entry point `openCancelModal` at `:953-980`; confirm handler `confirmCancelFromModal` at `:986-1007`).

**State shape** (lines 373-377, 957):
```ts
cancelModalOpen: boolean
cancelContext: CancellationContext | null   // fetched from GET /jobs/:id/cancellation-context
cancelContextLoading: boolean
cancelReason: string                         // free-text textarea, required
```

**Rendered content** when `cancelContext` is loaded (modal markup `:3501-3735`):
- Summary banners: `hasCompletedJobs`, `hasActiveJobs`, `hasPaidInvoices` (3505, 3522, 3538) — purely informational warnings.
- Chain section listing sibling jobs (3557-3625) — read-only.
- **Linked Invoices** list (3628-3669) — each invoice shown with `invoice_number`, `invoice_status`, `amount_paid`, `balance_due`. **Display only.** No checkbox, no per-invoice toggle, no refund/credit selector.
- Required cancellation-reason textarea (3683-3698).
- Two buttons: "Keep Job" (closes) and "Confirm Cancellation" (calls `confirmCancelFromModal`).

**Conclusion:** there is no financial decision step in the cancel modal. The operator cannot choose refund vs credit vs keep-paid. The confirmation simply transitions the job to `cancelled` via `PATCH /jobs/:id/status` — every linked invoice retains its existing status and amount_paid, which is exactly the orphan condition Arc J needs to close.

(Contrast with the **delete-task** modal at `web/src/components/delete-task-modal.tsx:182-249`, which DOES expose per-invoice "Void invoice #N" toggles and a "void reason" textarea — but that modal is reachable only via the Delete-Task UI, not the Cancel button.)

---

## § 5. Transaction boundary in the cancellation orchestrator

**Method:** `dataSource.transaction(async (manager) => {...})` — `api/src/modules/jobs/jobs.service.ts:1285`.

**Q1 — does it use `dataSource.transaction(...)` or `QueryRunner`?**
**`dataSource.transaction(async (manager) => {...})`** at `jobs.service.ts:1285`. No `QueryRunner` (`grep -n queryRunner` on the file returns nothing).

**Q2 — are notifications/audit writes inside or outside the transaction?**
**Mixed, by type:**
- **Inside the transaction** (`jobs.service.ts:1285-1343`): `txJobRepo.save(job)`, the conditional `assigned_driver_id` null update, and the `status_override` notification row (`txNotifRepo.save` at 1324-1340).
- **Outside the transaction**: customer-facing SMS/email status notifications (`notificationsService.send` at 1445-1469, wrapped in `try {} catch {}` and explicitly called "NON-FATAL" at 1438-1444), billing-issue detection (1353-1363), chain-type-change reaction (1396-1399), asset-state update (1403), route-completion (1406-1408), rental-chain auto-close (1424-1430).
- **Cascade-delete (`cascadeDelete`, 1586-1806) uses NO transaction at all.** Sequential `jobsRepository.update`, `assetRepo.update`, `invoiceRepo.update`, `creditMemoRepo.save`, `rentalChainRepo.update` — a partial failure would leave invoices voided without credit memos, or credit memos without rental-chain closure.
- The **`CreditAuditService.record`** writer (§ 2) is fire-and-forget and would NOT participate in any caller's transaction unless Phase 1 changes its signature to accept a `manager`.

---

## § 6. Phase 1 sequencing recommendation (smallest viable scope before launch)

1. **Add a financial-decision step to the cancel modal + a single internal `cancelJobWithFinancials` orchestrator on the API.** Inputs: `jobId`, `reason`, per-invoice `decision: 'void' | 'keep_paid' | 'refund_card'`. Internally calls the existing `JobsService.changeStatus` cancel branch + reuses `cascadeDelete`'s invoice-void / credit-memo logic (already battle-tested at `jobs.service.ts:1755-1785`). **Wrap in `dataSource.transaction`** — `cascadeDelete`'s lack of one is itself a latent risk Phase 1 should fix incidentally.
2. **Backfill the 5 production orphaned-paid invoices via a one-shot SQL migration**, not via app code. The DB findings table maps each to its decision (2 cash → cash refund + credit memo; 3 cards w/ NULL PI → manual Stripe-dashboard refund + credit memo). One-shot, idempotent migration; no runtime code path needed for legacy rows.
3. **Add `cancellation_decision_recorded` and `cancellation_refund_requested` event types to `CreditAuditService`** (`credit-audit.service.ts:18-24`) and emit on every cancel. Decide *intentionally* whether to keep fire-and-forget or thread the transactional manager through `record`. Recommendation: thread the manager through; the tradeoff (cancel rolls back if audit fails) is the safer side of the risk for financial events.
4. **Fix the Pay-Now webhook to populate `stripe_payment_intent_id`** at `stripe.service.ts:287-295` (one-line: pull `session.payment_intent` and store it). This is the prerequisite that lets new card cancellations after launch be auto-refunded via the Stripe API. Skip the `RecordPaymentForm` change — manual mark-as-paid has no real PI and can stay NULL.
5. **DEFER**: (a) automated Stripe refund for the 5 existing orphans (no PI exists, manual is faster than building a no-PI fallback); (b) customer-facing cancellation notification template (no current notification fires on cancel — adding this is its own scoped Phase 2 change with template + tenant-settings work, not a launch blocker if office staff calls customers manually post-cancel).

---

**End of Phase 0 audit report. No code changes were made. No commits. No pushes.**
