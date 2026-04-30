# autoCloseChainIfTerminal Expansion Audit — 2026-04-30

## Context

PR #14 (`706d304`) landed the SQL repair record for 6 ghost-active rental chains
under tenant `822481be` (Rent This Dumpster) that had been stuck at
`status='active'` after their pickup jobs were cancelled while their delivery
jobs had already completed (the partial-completion shape). The bug remains in
code: `cancelJobWithFinancials` does not call `autoCloseChainIfTerminal`, AND
the helper itself only handles the all-cancelled shape (`completedJobs === 0`).

PR-C1 will close the bug. This audit decides between two options:

- **STRICT** — add the missing `autoCloseChainIfTerminal` call after
  `cancelJobWithFinancials` TX commits + cancellation lock + Stripe idempotency
  keys. Helper itself unchanged. Partial-completion ghost chains can still
  appear if the same shape recurs.
- **EXPAND** — STRICT plus widen `autoCloseChainIfTerminal` so all-terminal
  chains (any mix of `completed` + cancelled/failed/needs_reschedule, zero
  active/pending) close. No new enum value.

References:
- PR-C audit: `docs/audits/2026-04-30-pr-c-audit-final.md` (PR #13)
- Repair record: `docs/audits/2026-04-30-pr-c1-ghost-chain-repair.md` (PR #14)

---

## Phase 0 — Helper shape

**File:** `api/src/modules/jobs/jobs.service.ts:2062-2118`

```typescript
private async autoCloseChainIfTerminal(
  tenantId: string,
  jobId: string,
): Promise<void> {
  const currentLink = await this.taskChainLinkRepo.findOne({
    where: { job_id: jobId },
  });
  if (!currentLink) return; // standalone job — nothing to close

  const chainId = currentLink.rental_chain_id;

  // Structural link count — no tenant filter on task_chain_links
  // (the table has no tenant_id). Compared against the
  // tenant-scoped jobs query below to detect drift.
  const totalLinks = await this.taskChainLinkRepo.count({
    where: { rental_chain_id: chainId },
  });
  if (totalLinks === 0) return;

  // Fetch the status of every linked job, tenant-scoped via
  // jobs.tenant_id on the inner join. Rows owned by another
  // tenant (should never happen, but defensive) drop out here.
  const jobs = await this.jobsRepository
    .createQueryBuilder('j')
    .innerJoin(
      TaskChainLink,
      'l',
      'l.job_id = j.id AND l.rental_chain_id = :chainId',
      { chainId },
    )
    .where('j.tenant_id = :tenantId', { tenantId })
    .select(['j.id', 'j.status'])
    .getMany();

  // Integrity bailout — any shortfall vs. total link count means
  // either cross-tenant contamination or a dangling link. Refuse
  // to auto-close rather than make an incorrect decision.
  if (jobs.length !== totalLinks) return;

  const terminal = new Set([
    'cancelled',
    'failed',
    'needs_reschedule',
  ]);
  const completedJobs = jobs.filter((j) => j.status === 'completed').length;
  const allTerminal = jobs.every((j) => terminal.has(j.status));

  // `allTerminal` already precludes completed, but the explicit
  // `completedJobs === 0` check matches the spec's safety rule
  // verbatim and survives future edits to the terminal set.
  if (allTerminal && completedJobs === 0) {
    await this.rentalChainRepo.update(
      { id: chainId, tenant_id: tenantId },
      { status: 'cancelled' },
    );
  }
}
```

**Status values written:** `'cancelled'` only.

**Gating condition:** `allTerminal && completedJobs === 0`, where
- `terminal = Set(['cancelled', 'failed', 'needs_reschedule'])`
- `allTerminal = jobs.every((j) => terminal.has(j.status))`
- `completedJobs = jobs.filter((j) => j.status === 'completed').length`

**Transaction context:** none. Does not open `dataSource.transaction(...)`.
Does not accept a passed-in `EntityManager` / `QueryRunner`. Reads via
service-scoped repos (`taskChainLinkRepo`, `jobsRepository`); writes via
`rentalChainRepo.update()`.

**Locks:** none. No `pg_advisory_xact_lock`, no `SELECT ... FOR UPDATE`.
Unprotected read-then-write pattern.

**Side effects beyond `rental_chains.status`:** none. No asset freeing, no
audit log writes, no notifications, no events emitted.

**Bug premise confirmed:** YES. The helper fires only when
`allTerminal && completedJobs === 0` (the all-cancelled-or-terminal shape with
zero completed jobs). It does NOT fire for partial completion (any mix that
includes at least one `'completed'` job).

**Critical inconsistency uncovered:** the helper writes `'cancelled'` for the
all-cancelled shape. PR #14's one-time repair wrote `'completed'` to the 6
ghost chains. These two precedents are already in conflict — see Phase 7
verdict.

---

## Phase 1 — Callers + cancelJobWithFinancials confirmation + insertion point

| file:line | calling function | TX context | error path | passes EntityManager? |
|---|---|---|---|---|
| `api/src/modules/jobs/jobs.service.ts:1544` | `changeStatus` | post-commit (after `dataSource.transaction(...)` closes at line 1458) | errors propagate (asserted by spec site #28) | NO — uses service-scoped repos |

**`cancelJobWithFinancials` confirmation:** NOT a caller.

**Insertion point for STRICT:** `api/src/modules/jobs/jobs.service.ts:4905`
— immediately after the Stripe refund loop closes (line 4899) and before the
return statement (line 4907). Pattern mirrors the existing `changeStatus`
post-commit caller at jobs.service.ts:1544.

Surrounding context:

```typescript
4898       }
4899     }
4900
4901     // Auto-close chain if all linked jobs are now terminal
4902     // (same pattern as changeStatus post-commit, line 1544).
4903     // Non-fatal wrap: chain-close failure does not block the
4904     // cancellation response (all financial/job state already committed).
4905     await this.autoCloseChainIfTerminal(tenantId, job.id);
4906
4907     return {
4908       success: true,
4909       jobId: job.id,
4910       decisionsApplied: decisionableInvoices.length,
4911       creditMemos,
4912       voidedInvoiceIds,
4913       stripeFailures,
4914       };
4915   }
```

The job's `status='cancelled'` is already persisted by line 4705-4709 inside
the main TX (line 4701-4799). The insertion is post-TX-commit so the helper
sees the committed state.

---

## Phase 2 — Sister / parallel helpers

| file:line | function | what it does | status value(s) |
|---|---|---|---|
| `api/src/modules/jobs/jobs.service.ts:1951` | `_cascadeDeleteInTx` | bulk-cancels parent rental chain when cascading job deletion | `'cancelled'` |
| `api/src/modules/rental-chains/rental-chains.service.ts:279` | `rescheduleExchange` (`handleTypeChange` path) | auto-completes chain when ≤1 scheduled link remains after type change | `'completed'` |
| `api/src/modules/rental-chains/rental-chains.service.ts:644` | `updateChain` (controller endpoint) | manual override; accepts `dto.status` | any |
| `api/src/modules/legacy-backfill/legacy-backfill.service.ts:369-425` | `createChainFromBackfill` | derives status from job set during backfill | `'active'`, `'completed'`, or `'cancelled'` |

`autoCloseChainIfTerminal` is the sole automatic *reactive* status writer
(triggered by job state change). The four above are intentional writes
triggered by operator action (delete, type change, manual update, backfill).

---

## Phase 3 — Backend status consumers

### SEMANTIC — would change behavior under EXPAND

These consumers attach product meaning to the status string. Writing
`'completed'` to partial-completion chains would change the metric or behavior;
writing `'cancelled'` would change it differently but equally incorrectly.

**`api/src/modules/reporting/reporting.service.ts:1314`**
```typescript
const completedChains = chainRows.filter((r) => r.status === 'completed');
const activeChains = chainRows.filter((r) => r.status === 'active');
```
Drives `summary.completed_rentals`, `summary.active_rentals`,
`summary.overdue_rentals` (filter of activeChains), and
`average_rental_duration` (denominator = `completedChains.length`).

**`api/src/modules/reporting/reporting.service.ts:1490`**
```typescript
if (r.status === 'completed') bucket.completed_chains += 1;
```
Per-period trend bucketing for tenant dashboard (`completed_chains` in
returned trend series).

**`api/src/modules/rental-chains/rental-chains.service.ts:1040`**
```typescript
if (link.status === 'cancelled' || link.status === 'completed') {
  throw new BadRequestException(`cannot reschedule a ${link.status} exchange`);
}
```
Link-level status check (chain-status-irrelevant; flagged here for
completeness — EXPAND does not affect this).

### SAFE — semantics-neutral or correctly fixed by EXPAND

| file:line | code | impact |
|---|---|---|
| `api/src/modules/jobs/jobs.service.ts:3648` | `AND rc.status = 'active'` (active rentals for a customer) | EXPAND correctly excludes terminal chains |
| `api/src/modules/assets/assets.service.ts:229` | `.andWhere('rc.status = :active', { active: 'active' })` (active chains linked to assets) | EXPAND correctly excludes terminal chains |
| `api/src/modules/assets/assets.service.ts:368-375` | active-chain count guard before asset retirement | EXPAND correctly excludes terminal chains (asset can be retired) |
| `api/src/modules/billing/services/billing-issue-detector.service.ts:630` | `AND status = 'active'` (overdue check) | EXPAND correctly excludes terminal chains from overdue flagging |

### Reads for display / API response

| file:line | code | exposed surface |
|---|---|---|
| `api/src/modules/rental-chains/rental-chains.service.ts:1206` | `status: chain.status,` | `RentalChainLifecycleResponseDto` returned to admin frontend |
| `api/src/modules/jobs/jobs.service.ts:2449` | `status: chain.status,` | chain metadata returned alongside job-chain hierarchy |
| `api/src/modules/customers/customer-dashboard.service.ts:179` | `status: chain.status,` | customer detail view (admin) |

These are read-only and exposed to admin UI — see Phase 5.

---

## Phase 4 — Reporting / analytics / billing impact

`api/src/modules/reporting/reporting.service.ts`:

| Metric | Logic | EXPAND impact (if EXPAND wrote `'completed'`) |
|---|---|---|
| `summary.completed_rentals` | `completedChains.length` (line 1359) | **SEMANTIC** — count increases by partial-completion chains in window; tenant dashboard shows higher completion rates |
| `summary.active_rentals` | `activeChains.length` (line 1357) | **SEMANTIC** — count decreases by same amount |
| `summary.overdue_rentals` | filter of activeChains (line 1358) | **SEMANTIC** — decreases (partial-completion chains can no longer be overdue) |
| `average_rental_duration` | numerator + denominator on completedChains (lines 1321-1330) | **SEMANTIC** — denominator changes; mean shifts |
| `revenue_per_chain` | denominator: `chainRows.length` (line 1334) | cosmetic — denominator unchanged |
| `profit_per_chain` | denominator: `chainRows.length` (line 1338) | cosmetic — denominator unchanged |
| `exchange_rate` | denominator: `chainRows.length` (line 1343) | cosmetic — denominator unchanged |
| Trend `completed_chains` per period | line 1490 | **SEMANTIC** — period buckets increase by partial-completion chains |

`getLifecycleReport({ statusFilter: 'active' \| 'completed' \| 'all' })` —
user-driven filter on tenant dashboard. Under EXPAND, partial-completion
chains shift between buckets; "Completed Rentals" tab inflates.

**Other modules audited — no semantic shift found:**
- `analytics.service.ts` — no rental-chain status filtering
- `billing.service.ts` — checks job.status only, not chain.status
- `portal.service.ts` — loads chains but does not filter by status
- `customer-dashboard.service.ts` — returns chain.status without conditional

**Demo-customer exclusion** (per CLAUDE.md memory) interacts at the customer
level, not chain status; not affected.

---

## Phase 5 — Frontend / portal / dispatch / driver / admin

### Admin dashboard — semantic risk under EXPAND

| file:line | code/component | user-visible behavior |
|---|---|---|
| `web/src/app/(dashboard)/customers/[id]/page.tsx:661` | label derivation: `if (chain.status === "completed") return "Completed"` SHORT-CIRCUITS before "Awaiting Pickup" / "On Site" branches at lines 664-667 | misleading "Completed" label for chain where pickup was cancelled |
| `web/src/app/(dashboard)/customers/[id]/page.tsx:702` | `isCompleted = chain.status === "completed"` applies green left border `3px solid var(--t-success)` | success styling for non-success chain |
| `web/src/app/(dashboard)/jobs/page.tsx:586-588` | same short-circuit pattern; derives "Completed" label | misleading label in jobs page table |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:2154-2159` | `FEATURE_REGISTRY.lifecycle_status_completed?.label ?? "Completed"` | label per registry — registry definition: "All tasks in the rental are done" |
| `web/src/app/(dashboard)/rentals/[id]/page.tsx:337,392` | `STATUS_LABELS[rentalChain.status]` = "Completed" | rental detail header |
| `web/src/components/rental-chain-timeline.tsx:72-76` | renders raw `{chain.status}` text directly with NO mapping layer | new enum value would appear verbatim as raw string |
| `web/src/app/(dashboard)/customers/[id]/_components/JobsTimeline.tsx:88` | `isActive = chain.status === "active"` for timeline state | terminal chains correctly drop out of active branch |

### Customer portal — NO risk

| file:line | finding |
|---|---|
| `web/src/app/(portal)/portal/page.tsx:130,146,267` | filters/labels on JOB-level status (`r.status === "completed"`), not chain.status |
| `web/src/app/(portal)/portal/rentals/page.tsx:164,282` | tab filter and badge on JOB-level status |
| `web/src/components/portal-rental-detail-view.tsx:163` | `STATUS_LABELS` based on rental (job-level) status |

**Customers do not see chain.status.** No portal misleading risk regardless of
helper widening.

### Dispatch board — NO risk

`web/src/app/(dashboard)/dispatch/page.tsx` — operates on JOB-level status,
not chain.status. No direct chain.status rendering.

### Driver app — NONE

No driver-facing app found in `web/src`. Feature is internal admin + customer
portal only.

### Tenant website / public surface — NONE

No public surface displays `rental_chains.status`.

---

## Phase 6 — Tests

| file:line | description |
|---|---|
| `api/src/modules/jobs/jobs.service.spec.ts:468-473` | spy stub for `autoCloseChainIfTerminal` (private method) — used by tests #26, #27, #30; means those tests do NOT exercise helper logic at all |
| `api/src/modules/jobs/jobs.service.spec.ts:570-582` | site #28 — error-propagation test: verifies error thrown from helper propagates from `changeStatus` (not silenced) |
| `api/src/modules/rental-chains/rental-chains.service.spec.ts:465` | comment noting DB CHECK `rental_chain_active_requires_asset` |
| `api/src/modules/rental-chains/rental-chains.service.spec.ts:570` | happy-path: `updateChain` to `status='active'` requires asset |

**Critical absence:** NO test asserts a chain stays `'active'` after partial
cancellation (one job cancelled, others completed/active). NO test asserts
what `chain.status` should be for the partial-completion shape. There is no
behavioral contract in the test suite either way — neither STRICT nor EXPAND
breaks an existing assertion.

---

## Phase 7 — Lifecycle-auditor verbatim verdict

> ## Verdict: (B) PRODUCT-SEMANTIC
>
> EXPAND is NOT safe or surgical. At least three distinct consumer sites
> assign concrete product meaning to the value written to `rental_chains.status`,
> and any choice of value for the partial-completion shape (delivery completed +
> pickup cancelled) creates a product-semantic conflict. The evidence is as
> follows.
>
> ### Consumer 1 — Reporting KPIs (most critical)
>
> `reporting.service.ts:1314` filters `chainRows` by `r.status === 'completed'`
> to build `completedChains`. This array is the sole input to
> `summary.completed_rentals` and the denominator of
> `average_rental_duration`. At `reporting.service.ts:1490`, the same
> predicate increments `bucket.completed_chains` for per-period trend data
> shown on the tenant dashboard.
>
> A chain where a delivery happened but the pickup was explicitly cancelled
> is not a completed rental in any product sense — no dumpster was retrieved,
> the job was cancelled, and the operator may have taken action outside the
> system. Writing `'completed'` to these chains inflates `completed_rentals`
> and corrupts `average_rental_duration` (shorter-than-actual durations if
> pickup was cancelled early). Writing `'cancelled'` hides revenue that was
> realized (delivery did happen) and removes the chain from the
> `completedChains` denominator — a different but equally incorrect distortion.
>
> Neither value is semantically correct. The partial-completion shape is a
> distinct lifecycle state that does not exist in the current enum.
>
> ### Consumer 2 — Admin dashboard label short-circuit
>
> `customers/[id]/page.tsx:661` and `jobs/page.tsx:586-587` both open with:
>
> ```
> if (chain.status === "completed") return ... "Completed"
> if (chain.status === "cancelled") return "Cancelled"
> ```
>
> These checks fire before the richer job-level derivation logic (the
> "Awaiting Pickup" / "On Site" branches at lines 664-667 / 593-597). Writing
> either `'completed'` or `'cancelled'` to a partial-completion chain causes
> the label derivation to short-circuit at the top branch and return either
> "Completed" or "Cancelled" — both of which are factually wrong for a chain
> where a delivery was completed but pickup was explicitly cancelled. An
> operator viewing the customers or jobs admin page would see a misleading
> status label.
>
> ### Consumer 3 — Timeline raw render
>
> `rental-chain-timeline.tsx:75` renders `chain.status` as raw text with no
> mapping layer. There is no label translation. Writing either `'completed'`
> or `'cancelled'` appears verbatim in the UI for this shape.
>
> ### Observation: the repair's value choice is itself inconsistent
>
> PR #14's one-time repair wrote `'completed'` to the 6 ghost-active chains.
> The existing helper at `jobs.service.ts:2115` writes `'cancelled'` for the
> all-cancelled shape. These two precedents are already in conflict with each
> other, and both point at the same root problem: the enum has no value that
> correctly represents "delivery happened, pickup cancelled." The repair was
> operationally reasonable as a one-time cleanup (the chains were genuinely
> stuck and `'completed'` was the least-bad choice to unblock operations),
> but it cannot be enshrined as the correct value for the partial-completion
> shape going forward.
>
> ## Recommended path forward
>
> ### PR-C1 recommendation: (B1) STRICT only
>
> Add the missing `autoCloseChainIfTerminal` call at `jobs.service.ts`
> post-TX in `cancelJobWithFinancials` (after the Stripe loop, before the
> return at line 4900). The helper itself is unchanged. This eliminates the
> class of ghost-active chains caused by the missing call site without
> touching the partial-completion logic.
>
> The helper as written (`allTerminal && completedJobs === 0`) will correctly
> close only the all-cancelled shape and will leave partial-completion chains
> at `'active'`. This is the correct behavior for STRICT: a chain with a
> completed delivery and a cancelled pickup remains `'active'`, preserving
> the "dumpster may still be on site" safety rule stated in the auditor's
> core rules. That is not a bug — it is the conservative safe state.
>
> The repair's `'completed'` choice for the 6 existing ghost chains was a
> pragmatic one-time fix. It does not need to be reversed, but it also must
> not become a code pattern.
>
> ## BLOCK
>
> EXPAND is blocked from PR-C1. The partial-completion shape requires a new
> lifecycle enum value and coordinated consumer updates across reporting,
> admin dashboard, and timeline components. Neither `'completed'` nor
> `'cancelled'` is semantically correct for that shape. PR-C1 must land as
> STRICT only: add the missing `autoCloseChainIfTerminal` call from
> `cancelJobWithFinancials`, helper unchanged, partial-completion chains
> remain `'active'`.

---

## Verdict

**STRICT**

PR-C1 will add the missing `autoCloseChainIfTerminal` call at
`api/src/modules/jobs/jobs.service.ts:4905` (post-TX-commit, post-Stripe-loop
in `cancelJobWithFinancials`). The helper itself is unchanged. Partial-
completion chains continue to remain `'active'` after PR-C1 ships — this is
the correct conservative behavior per the lifecycle-auditor's safety rule
("dumpster may still be on site"). The 6 chains repaired in PR #14 stand as a
one-time backfill, not a precedent.

EXPAND is blocked because neither `'completed'` nor `'cancelled'` is
semantically correct for the partial-completion shape — both choices change
consumer behavior in ways that misrepresent the operational reality. The
partial-completion shape is a distinct lifecycle state with no current enum
value. Adding it requires a coordinated migration + consumer updates across
reporting and admin frontend — that is a lifecycle-semantics arc, not PR-C1.

---

## If EXPAND deferred (verdict = STRICT)

The following consumers must be updated in the future lifecycle-semantics arc
before EXPAND can land. PR-C1's CLAUDE.md follow-up note will reference this
list:

1. **DB enum migration** — `rental_chains.status` enum requires manual
   `ALTER TYPE` in Supabase BEFORE API deploy (TypeORM `synchronize: true`
   is on in prod — manual ALTER required to add `'partially_completed'` or
   equivalent).
2. **`api/src/modules/reporting/reporting.service.ts:1314`** —
   `completedChains` filter; add new value to filter or split metric into
   "fully completed" vs "terminal."
3. **`api/src/modules/reporting/reporting.service.ts:1490`** — per-period
   `completed_chains` trend bucket; same decision as #2.
4. **`api/src/modules/reporting/reporting.service.ts`** —
   `getLifecycleReport({ statusFilter })` API contract; expose new value or
   redefine bucket meanings.
5. **`api/src/modules/jobs/jobs.service.ts:2114-2118`** — widen
   `autoCloseChainIfTerminal` to write the new value when partial-completion
   shape detected.
6. **`api/src/modules/assets/assets.service.ts:368`** — retirement guard
   (re-audit; likely no change needed since terminal-of-any-kind should
   release the asset).
7. **`web/src/lib/feature-registry.ts`** — register the new lifecycle
   status label per "if visible to the user, it comes from the registry."
8. **`web/src/app/(dashboard)/customers/[id]/page.tsx:661-662`** — label
   derivation short-circuit; insert handling for new value before the
   "Awaiting Pickup" / "On Site" branches.
9. **`web/src/app/(dashboard)/jobs/page.tsx:586-588`** — same short-circuit
   pattern; same insertion.
10. **`web/src/app/(dashboard)/jobs/[id]/page.tsx:2154`** — registry lookup
    must include the new value.
11. **`web/src/app/(dashboard)/rentals/[id]/page.tsx:392`** — `STATUS_LABELS`
    map must include the new value (raw fallback is the status string =
    user-visible junk).
12. **`web/src/components/rental-chain-timeline.tsx:75`** — currently
    renders raw `chain.status`; must add label-mapping layer or new value
    appears verbatim.

Customer portal is NOT in this list — it operates on job-level status, not
chain-level, and does not need updating.
