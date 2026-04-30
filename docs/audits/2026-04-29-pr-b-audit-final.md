# PR-B Audit — Surfaces 1 + 4 (Asset Reservation Race + Marketplace Double-Accept)

**Status:** Audit only. No edits. No DB writes. No commits.
**Branch base:** `bf57b9c` (current `main`).
**Mode:** Plan Mode + Opus 4.7.

---

## Context

Continuing the concurrency arc started in PR-A (#9, Surface 3 — marketplace customer dedup, shipped on `0a7279b`). PR-A established the pattern: DB unique constraint catches the race + clean `BadRequestException` envelope for the second concurrent caller.

PR-B's job is to verify and close the remaining **DB-schema-class** race surfaces:

| # | Surface | Prior hypothesis | Verified? |
|---|---|---|---|
| 1 | Asset reservation race in `JobsService._createInTx` | Pessimistic lock on `assets` row | **CONFIRMED — race exists** |
| 4 | Marketplace double-accept race in `MarketplaceService.accept` | Likely DB-protected via existing unique on `jobs(marketplace_booking_id)` | **HYPOTHESIS WRONG — race exists** |

PR-C (Surface 2 + Stripe idempotency) is **out of scope** here.

---

## Decisions (recorded — gating questions resolved)

| # | Question | Decision |
|---|---|---|
| Q1 | Surface 4 fix shape | **Option (a) — pessimistic-write lock on `marketplace_bookings` row.** No migration. No constraint. |
| Q2 | Surface 1 design + scope | **Option A (shared `lockAssetRow` helper) + `_createInTx` ONLY.** Other reservation surfaces (`assignAssetToJob`, `BillingService` line 376, `BookingCompletionService` line 142, paths C and D) are explicitly out of scope and stay unchanged for PR-B. |
| Q3 | Test strategy | **Unit tests + manual psql verification (3E option 2).** Unit-test the `lockAssetRow` helper. Extend `marketplace.service.spec.ts` with a mocked-second-TX assertion. Manual race verification in two psql sessions before merge. Real-DB integration tests deferred to PR-D. |
| Q4 | Belt-and-suspenders partial unique on `jobs(tenant_id, marketplace_booking_id)` | **NO.** Lock alone is sufficient. Constraint can be added later as PR-D defense-in-depth if a regression ever surfaces. |

---

## Phase 1 — Surface 4 verification: DB constraint check

### SQL evidence

| Query | Result |
|---|---|
| `pg_indexes WHERE tablename='jobs' AND indexdef ILIKE '%marketplace_booking_id%'` | **0 rows** — no unique on `jobs.marketplace_booking_id` |
| `pg_indexes WHERE tablename='marketplace_bookings'` | `idx_marketplace_bookings_tenant_external` UNIQUE on `(tenant_id, marketplace_booking_id)` |
| `pg_indexes WHERE tablename='jobs' AND indexname ILIKE '%unique%'` | Only the PK |
| `grep '@Unique' api/src/modules/jobs api/src/modules/marketplace` | **No `@Unique` decorator anywhere** |
| `SELECT (tenant_id, marketplace_booking_id), COUNT(*) FROM jobs ... HAVING COUNT(*) > 1` | **0 rows** (safe to add a constraint, no backfill needed) |

### Phase 1 verdict: **FAIL (race exists, prior hypothesis was wrong)**

The existing `marketplace_bookings(tenant_id, marketplace_booking_id)` unique prevents **duplicate booking creation** by an external party (`createBooking`). It does **not** prevent **double acceptance** of a single booking row (`accept()`). Those are different races.

Race walkthrough for the **double-accept**:
- T0: Operator A POSTs `accept(bookingX)` — pre-TX read sees `status='pending'`, opens TX
- T1: Operator B POSTs `accept(bookingX)` — pre-TX read sees `status='pending'`, opens TX
- T2: A's TX re-reads `bookingX` inside TX → `status='pending'` (still — both TXs see the unmutated row)
- T3: B's TX re-reads `bookingX` inside TX → `status='pending'`
- T4: A's TX calls `jobsService.create(...)` → creates Job_A; UPDATEs booking → `status='accepted', job_id=Job_A`; commits
- T5: B's TX calls `jobsService.create(...)` → creates Job_B; UPDATEs booking → `status='accepted', job_id=Job_B`; commits
- **End state:** TWO jobs in DB with `marketplace_booking_id=X`. Booking row's `job_id` references whichever committed last. Customer would be charged twice if billing flowed from this; even without billing, the operator dispatcher sees a duplicate pending delivery.

---

## Phase 2 — Surface 1 walkthrough

### 2.1 — Reservation paths in code (file:line)

| # | File | Lines | What it does | TX? | Lock? | Conflict guard? |
|---|---|---|---|---|---|---|
| A | `api/src/modules/jobs/jobs.service.ts` | 314-319, 405, 435-441 | `_createInTx`: pre-read asset (default ds), insert Job with `asset_id`, UPDATE asset → `'reserved'` | Yes (Fix C) | **No** | **No** |
| B | `api/src/modules/jobs/jobs.service.ts` | 2987-3092 | `assignAssetToJob`: tenant-load asset, run `findActiveAssignmentConflict` (line 3049-3058), set `job.asset_id` | Within calling TX | **No** | Yes — TOCTOU window between read & write |
| C | `api/src/modules/jobs/jobs.service.ts` | 1933-1999 (`updateAssetOnJobStatus` reserved branch line 1949) | Status-driven asset state writes during job lifecycle | Post-outer-TX (uses `this.assetRepo`) | No | N/A — driven by job state, not creation |
| D | `api/src/modules/jobs/jobs.service.ts` | 3475 | Reserved-state write, exchange/drop-off path | Inside surrounding TX | No | Caller-dependent |
| E | `api/src/modules/billing/billing.service.ts` | 372-386 | Auto-pick first available asset, UPDATE → `'reserved'` (booking-completion path) | Yes | **No** | Filters out reserved/deployed in SELECT — TOCTOU window |
| F | `api/src/modules/billing/services/booking-completion.service.ts` | 142 | Auto-reserve at booking completion | Yes | **No** | Filters in SELECT — TOCTOU window |

**Not reservation surfaces:**
- `MarketplaceService.accept` calls `jobsService.create` **without** `dto.assetId` (line 266-279) — no asset reserved at marketplace accept time.
- `PublicService.createBooking` creates jobs **without** `asset_id` (line 261-279) — does subtype-level availability count only (line 200-225), no row reservation.

### 2.2 — Authoritative race scenario (path A, `_createInTx`)

- T0: caller A reads asset 2087 (`this.assetRepo.findOne`, default ds, no lock) → `status='available'`, exists in tenant
- T1: caller B reads asset 2087 → same observation
- T2: caller A enters TX, INSERTs Job_A with `asset_id=2087`
- T3: caller A UPDATEs `assets` SET `status='reserved'` WHERE id=2087 — commits
- T4: caller B enters TX, INSERTs Job_B with `asset_id=2087` (no constraint blocks; `(tenant_id, asset_id)` partial unique on jobs does NOT exist — only `idx_jobs_tenant_asset_id_active` is referenced in the public service comment, but no actual unique constraint enforces it)
- T5: caller B's UPDATE on `assets` is idempotent (already `'reserved'`) — no error
- **End state:** TWO non-terminal jobs reference asset 2087. `findActiveAssignmentConflict` (used by assign/changeStatus, NOT by create) would have caught it had it run — but `_createInTx` does not invoke it. Dispatcher dispatches both deliveries.

### 2.3 — Tenant isolation

The race is **strictly intra-tenant**. `_createInTx` line 316 scopes asset lookup by `tenant_id`. `assets` is tenant-partitioned by `tenant_id` column. Cross-tenant exposure is **impossible** because no cross-tenant SELECT or UPDATE path exists in this code. Lock acquisition would also be tenant-scoped (`WHERE id=$1 AND tenant_id=$2`).

---

## Phase 3 — PR-B implementation scope (proposal, not decision)

### 3A. Surface 4 scope — **DECIDED: Option (a)**

**Pessimistic-write lock on `marketplace_bookings` row at TX start.** Inside `accept()`'s `dataSource.transaction` block, replace the `bookingRepo.findOne({ where: {id, tenant_id} })` at marketplace.service.ts line 191 with:

```ts
const booking = await bookingRepo.findOne({
  where: { id, tenant_id: tenantId },
  lock: { mode: 'pessimistic_write' },
});
```

The existing `status === 'pending'` re-check at line 198 stays. Second concurrent TX waits for A's commit, re-reads the row, sees `status='accepted'`, throws `BadRequestException('Booking is already "accepted"')` — same envelope already on line 172.

- LOC: ~3-line change (add `lock` option to one `findOne`).
- Files: `api/src/modules/marketplace/marketplace.service.ts` only.
- Migration: **NONE**.
- Risk: **LOW**.
- No partial unique constraint added (Q4 = NO).

> **Implementation correction (PR-B post-audit, 2026-04-30):** the
> "existing `status === 'pending'` re-check at line 198" referenced
> above is the **pre-TX** check at lines 165-173, not an in-TX check.
> No in-TX status check existed before PR-B. The lock alone is inert
> without one — the second caller wakes up, observes the now-`'accepted'`
> booking, and would still call `jobsService.create` and overwrite the
> booking projection. PR-B therefore adds a 3-LOC post-lock
> `if (booking.status !== 'pending') throw BadRequestException(...)`
> right after the `!booking` 404 guard. Total marketplace.service.ts
> diff lands at ~6 LOC, single method, single file. No scope creep
> beyond what's needed to deliver the outcome described in this
> Phase 3A. Q1 (lock-only, no migration, no constraint) and Q4 (no
> jobs constraint) preserved.

### 3B. Surface 1 scope — **DECIDED: Option A helper, `_createInTx` only**

**Shared `lockAssetRow` helper in `api/src/modules/assets/assets.service.ts`:**

```ts
async lockAssetRow(
  manager: EntityManager,
  assetId: string,
  tenantId: string,
): Promise<Asset> {
  const asset = await manager.getRepository(Asset).findOne({
    where: { id: assetId, tenant_id: tenantId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!asset) throw new NotFoundException('Asset not found');
  return asset;
}
```

**Wired into `_createInTx` ONLY** (jobs.service.ts), after the `manager`-bound repos are derived (~line 350) and before line 405 INSERT. After the lock returns, re-check via the existing `findActiveAssignmentConflict` to determine whether another non-terminal job already references this asset; if so, throw `BadRequestException('Asset {assetId} is no longer available')` per 3C.

**Out of scope for PR-B (explicit deferral):**
- `assignAssetToJob` (jobs.service.ts line 2987-3092) — has its own `findActiveAssignmentConflict` guard
- `BillingService` line 372-386 — has SELECT-time filters
- `BookingCompletionService` line 142 — has SELECT-time filters
- Paths C (`updateAssetOnJobStatus` line 1933-1999) and D (line 3475)

These can be migrated to `lockAssetRow` in a follow-up sprint once the pattern proves itself.

LOC: helper (~15) + `_createInTx` wiring (~5) ≈ +20 net.
Risk: **LOW**. Tightest scope matching PR-A.

### 3C. Error envelope contract

When the second TX wakes up after the lock releases:
- **Surface 4:** Re-check `booking.status === 'pending'` after the lock acquires (already line 198) — if status is now `'accepted'`, throw `BadRequestException('Booking is already "accepted"')` matching the pre-TX envelope at line 172. Caller-visible message identical regardless of whether they lost the race or just hit a stale UI.
- **Surface 1:** After `lockAssetRow` returns, re-check `asset.status` (or check if any other non-terminal job already references it via the existing `findActiveAssignmentConflict` query). If unavailable, throw `BadRequestException('Asset {assetId} is no longer available')`. Mirrors PR-A's clean-error pattern.

### 3D. Multi-tenant safety

Hard requirements (both surfaces):
- Lock query MUST include `tenant_id` in WHERE clause (`{ where: { id, tenant_id }, lock: ... }`).
- `lockAssetRow` helper signature MUST require `tenantId` parameter explicitly — no inferring from request context inside the helper.
- Helper MUST throw if asset not found in tenant scope (`NotFoundException`), preserving the existing `_createInTx` pre-TX behavior.
- Lifecycle-auditor confirmed: **race is strictly intra-tenant, lock contention cannot cross tenants.**

### 3E. Test strategy — **DECIDED: option 2 (unit + manual psql)**

- **Unit test:** `lockAssetRow` helper returns the locked row inside a TX and propagates `NotFoundException` for missing/cross-tenant assets.
- **Service test:** Extend `marketplace.service.spec.ts` with a mocked-second-TX assertion that the lock acquisition path produces the expected `BadRequestException` envelope when the row arrives in `accepted` state.
- **Manual psql verification before merge:**
  - Session A: `BEGIN; SELECT * FROM marketplace_bookings WHERE id=X FOR UPDATE;`
  - Session B: same query — must block.
  - Session A: `COMMIT;` — Session B unblocks and observes the post-commit state.
  - Repeat the same procedure on `assets` for Surface 1.
- Real-DB integration tests with parallel transactions in `Promise.all` are **deferred to PR-D**.

### 3F. PR-B scope estimate (final — Option A helper + Surface 4 option (a))

- Files modified:
  - `api/src/modules/marketplace/marketplace.service.ts` — ~3 LOC (add `lock` option to `findOne` at line 191).
  - `api/src/modules/jobs/jobs.service.ts` — ~5-8 LOC in `_createInTx` (call `lockAssetRow`, optional re-check via `findActiveAssignmentConflict`, throw `BadRequestException` if conflict).
  - `api/src/modules/assets/assets.service.ts` — gain `lockAssetRow` method (~15 LOC).
- Tests:
  - `assets.service.spec.ts` — unit test for `lockAssetRow` (~20 LOC).
  - `marketplace.service.spec.ts` — extend with mocked-second-TX assertion for double-accept (~30 LOC).
  - `jobs.service.spec.ts` — extend with `_createInTx` lock-conflict assertion (~30 LOC).
- Migration: **NONE** (Q1 = (a), Q4 = NO).
- LOC delta (gross add / gross remove / net): ~110 / ~5 / **+105**.
- Risk grade: **LOW**. Lock additions are localized, tenant-scoped, and reuse the existing prior art at `auth/services/password-reset.service.ts:153` and `team/users.service.ts:226,237`.
- Estimated session time: **60-90 min** implementation + tests.

### 3G. Pre-implementation gating decisions

**RESOLVED.** See the **Decisions** table at the top of this document.

---

## Phase 4 — Lifecycle-auditor cross-check

**Verdict: SAFE-WITH-NOTES**

| Point | Result | Note |
|---|---|---|
| 1. Rental chain interaction (Surface 1 race) | WATCH-OUT | Two parallel `task_chain_links` form for duplicate jobs. Cancellation of duplicate cleans correctly via `_cascadeDeleteInTx` (line 1912-1922) and `autoCloseChainIfTerminal` (line 2068, completedJobs===0 guard). **Edge case to test:** `cascadeDelete(Job_A, deletePickup: true)` — pickup-discovery fallback (line 1796-1808) uses `customer_id + asset_id` but is filtered by `job_type: 'pickup'` (line 1804), so cross-cancel of Job_B as pickup is impossible by current code. Add regression test. |
| 2. Cancellation propagation (Surface 4 duplicate) | WATCH-OUT | Cancelled duplicate's `marketplace_booking_id` field remains pointing at the booking even after job is cancelled — observability concern (orphan reference in `WHERE marketplace_booking_id=X` queries returns a cancelled ghost), not chain-state corruption. Option (a) prevents this by never creating the duplicate in the first place. **Auditor preference: option (a).** |
| 3. "Completed delivery without pickup remains active" | PASS | Lock scope is internal to `accept()` (booking row) and `_createInTx` (asset row). Pickup creation goes through a separate `jobsService.create` call; no contention with completed delivery. `autoCloseChainIfTerminal` line 2081 `completedJobs===0` guard preserves the rule. |
| 4. Asset state vs chain state desync | WATCH-OUT | Pre-existing risk in `updateAssetOnJobStatus` (line 1933-1999, called AFTER outer TX commits, uses `this.assetRepo` not the TX manager — so a throw there leaves job-status committed but asset un-updated). **Out of PR-B scope** but should be logged for PR-D. PR-B's locks themselves do not introduce new desync — rolled-back TXs leave no partial asset state. |

---

## Verification

How to test PR-B end-to-end (post-implementation, NOT in this audit):

1. **Surface 4 lock verification:**
   - Two parallel `curl` POSTs to `/marketplace/bookings/:id/accept` for the same booking id (use `curl ... &` and `wait`).
   - Assert: one returns 200 with `booking.status='accepted'`; the other returns 400 with body `{ message: 'Booking is already "accepted"' }`.
   - Assert: `SELECT COUNT(*) FROM jobs WHERE marketplace_booking_id = X` returns exactly 1.
2. **Surface 1 lock verification:**
   - Two parallel `curl` POSTs to `/jobs` with the same `assetId`.
   - Assert: one returns 201; the other returns 400 with body indicating asset is already assigned.
   - Assert: `SELECT COUNT(*) FROM jobs WHERE asset_id = X AND status NOT IN ('completed','cancelled')` returns exactly 1.
3. **Lifecycle regression (auditor's edge case):**
   - Manually create two duplicate jobs by bypassing the lock (e.g., via SQL on a staging DB).
   - Call `cascadeDelete(Job_A, deletePickup: true)`.
   - Assert: only Job_A is cancelled; Job_B and any its pickup are untouched.
4. **Manual verification:**
   - Two psql sessions: `BEGIN; SELECT * FROM marketplace_bookings WHERE id=X FOR UPDATE;` (session A) → second session's same query blocks → COMMIT in A → second session unblocks and sees post-A row.
5. **Migration sanity:** N/A — option (a) for Surface 4 and Q4 = NO mean PR-B has no schema changes.

---

## Critical files (for the implementation prompt to reference)

- `api/src/modules/marketplace/marketplace.service.ts` (Surface 4 surface, lines 159-312)
- `api/src/modules/jobs/jobs.service.ts` (Surface 1 surface, lines 301-442 for `_createInTx`; lines 2987-3092 for `assignAssetToJob`; lines 1933-1999 for `updateAssetOnJobStatus`)
- `api/src/modules/assets/assets.service.ts` (where `lockAssetRow` helper would live if Option A)
- `api/src/modules/auth/services/password-reset.service.ts:153`, `api/src/modules/team/users.service.ts:226-237` (existing pessimistic-write lock prior art — reuse the pattern)
- `api/src/modules/marketplace/marketplace.service.ts:223-249` (existing PR-A pattern for `QueryFailedError` + `code === '23505'` — not used in PR-B since option (a) was chosen, but referenced here as the established envelope shape for any future PR-D constraint-based work)

---

## Out of scope for PR-B

- PR-C / Surface 2 / Stripe idempotency
- `updateAssetOnJobStatus` post-TX desync risk (line 1933-1999) — log for PR-D
- Lifecycle-auditor's pickup-discovery cross-cancel hardening (already protected by `job_type='pickup'` predicate; only an issue if that predicate is ever relaxed)
- Asset reservation paths E/F (`BillingService` line 386, `BookingCompletionService` line 142) — protected by SELECT-time filters; addressable in PR-D
