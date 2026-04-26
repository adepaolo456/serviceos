# Arc 1 — Phase 0 Audit Report: `override_reason_required` blocks driver-app forward transitions

**Scope:** READ-ONLY investigation. No source modifications, no migrations, no commits, no deploys. All findings cite file paths and line numbers; SQL observations came from Supabase MCP read-only SELECTs.

---

## 1. Reproduction confirmed

Failing error string (thrown verbatim from the service):

```
override_reason_required: Reason is required for status override
```

Thrown at `api/src/modules/jobs/jobs.service.ts:989–991`.

Request context (reconstructed from the endpoint spec and the driver app's call site):

- Route: `PATCH /jobs/:id/status`
- Payload (from `driver-app/src/api.ts:48–51` → `updateJobStatus`): `{ status: "en_route" }`
- Auth: bearer JWT → `request.user = { id, email, role, tenantId }`

User + job context verified via Supabase MCP:

| Field | Value |
|---|---|
| `users.id` | `f86c8546-528d-40ee-9f8b-942b79ebc821` |
| `users.email` | `adepaolo456@gmail.com` |
| `users.role` | `owner` |
| `jobs.job_number` | `X-1023` |
| `jobs.status` | `confirmed` |
| `jobs.assigned_driver_id` | `f86c8546-528d-40ee-9f8b-942b79ebc821` (= user.id) |
| `jobs.tenant_id` | `822481be-039e-481a-b5c4-21d9e002f16c` |

The actor is indeed the assigned driver, role is `owner`.

---

## 2. Codepath map

### Entry points that end up in `JobsService.changeStatus`

| # | Caller | HTTP | Controller | File:line | `userRole` arg passed to service |
|---|---|---|---|---|---|
| 1 | Driver app (main flow — "On My Way" / "Arrived" / "Complete") | `PATCH /jobs/:id/status` | `JobsController.changeStatus` | `api/src/modules/jobs/jobs.controller.ts:232–278` | `@CurrentUser('role')` — **actual JWT role** (owner/admin/dispatcher/driver/secretary) |
| 2 | Driver app cancel/fail path (`failJob`) | `PATCH /jobs/:id/status` | same as #1 | `driver-app/src/api.ts:188–192` | same as #1 |
| 3 | Driver app completion (`completeJobWithAsset`) | `PATCH /jobs/:id/status` | same as #1 | `driver-app/src/api.ts:174–186` | same as #1 |
| 4 | Web — job detail kebab (`changeStatus` / `handleOverride`) | `PATCH /jobs/:id/status` | same as #1 | `web/src/app/(dashboard)/jobs/[id]/page.tsx:1016–1064` | same as #1 |
| 5 | Web — job detail cancel modal (`confirmCancelFromModal` / fallback) | `PATCH /jobs/:id/status` | same as #1 | `web/src/app/(dashboard)/jobs/[id]/page.tsx:930–999` | same as #1 |
| 6 | Web — dispatch board (quickview footer, tile actions, bulk cancel) | `PATCH /jobs/:id/status` | same as #1 | `web/src/app/(dashboard)/dispatch/page.tsx:1026, 1043, 2599, 2908` | same as #1 |
| 7 | Web — jobs list bulk actions (cancel, complete) | `PATCH /jobs/:id/status` | same as #1 | `web/src/app/(dashboard)/jobs/page.tsx:1325, 1371` | same as #1 |
| 8 | Internal — `DispatchService.sendRoutes` | N/A — in-process call | `dispatch.service.ts:416` | — | **hardcoded `'dispatcher'`** |
| 9 | Driver-dedicated endpoint (unused by current app) | `PATCH /driver/jobs/:id/status` | `DriverController.updateStatus` | `api/src/modules/driver/driver.controller.ts:63–131` | **hardcoded `'driver'`** |

Notes:
- `driver-app/src/api.ts:63–68` (`updateDriverJobStatus`) is **dead code** — declared but referenced nowhere in `driver-app/app/**`. The driver app uses path #1 (the general endpoint) for every status change, including "On My Way", "Arrived", "Complete", and "Failed Trip".
- No portal, cron, or lifecycle-panel writer calls `changeStatus`. Rental-chain code sets `rental_chains.status` / `task_chain_links.status` directly, which are separate entities.
- Customer-portal action layer has no status-change surface today.

### Throw site

`api/src/modules/jobs/jobs.service.ts:986–994`:

```
if (isAdmin && previousStatus !== dto.status) {
  const trimmedReason = (dto.overrideReason ?? '').trim();
  if (!trimmedReason) {
    throw new BadRequestException(
      'override_reason_required: Reason is required for status override',
    );
  }
  dto.overrideReason = trimmedReason;
}
```

Where `isAdmin` is computed at `jobs.service.ts:960`:

```
const isAdmin = ['owner', 'admin'].includes(userRole || '');
```

The decision is **role-based only**. There is no `dto.status` / `job.status` / `VALID_TRANSITIONS` consideration, and no comparison of `userId` against `job.assigned_driver_id`.

---

## 3. Phase 1.7 root-cause diff

Commit **`7d257f9`** — *"feat(jobs): Phase 1 status override ..."* (Fri Apr 24 2026 12:06:45 -0400).

Relevant lines from `git show 7d257f9 -- api/src/modules/jobs/jobs.service.ts`:

```diff
-    const isAdmin = ['owner', 'admin', 'dispatcher'].includes(userRole || '');
+    // Phase-1 override scope — dispatcher no longer has override privileges.
+    // Admin/Owner are the only roles that can bypass VALID_TRANSITIONS.
+    // Drivers still hit this endpoint for their own valid forward transitions
+    // (driver-app/src/api.ts:49,179,190) — they fall through the non-admin
+    // branch below and must obey VALID_TRANSITIONS as before. ...
+    const isAdmin = ['owner', 'admin'].includes(userRole || '');
```

```diff
+    // Phase-1 override scope — reason is mandatory for every admin
+    // override (trimmed, non-empty). ...
+    if (isAdmin && previousStatus !== dto.status) {
+      const trimmedReason = (dto.overrideReason ?? '').trim();
+      if (!trimmedReason) {
+        throw new BadRequestException(
+          'override_reason_required: Reason is required for status override',
+        );
+      }
+      dto.overrideReason = trimmedReason;
+    }
```

The pre-existing comment (now at `jobs.service.ts:955–957`) explicitly asserts that drivers "fall through the non-admin branch below and must obey VALID_TRANSITIONS as before." That assumption holds when `userRole === 'driver'`, but **fails for any admin/owner user who happens to be the assigned driver on the job** — `isAdmin` is a role check, not a capacity check.

---

## 4. Classification

**Primarily (b) with a latent (a) that just became consequential.**

- (b): Phase 1.7 added a new hard gate (`override_reason_required`) whose condition (`isAdmin && previousStatus !== dto.status`) does not account for "authenticated user is also the assigned driver." Before Phase 1.7, the same `isAdmin` classification existed but only controlled whether to skip the `VALID_TRANSITIONS` check and whether to append an audit row — both were harmless to owner-as-driver in the forward direction.
- (a): The pre-existing `isAdmin` bucket has always collapsed "admin doing an override" with "admin doing a normal forward transition." That latent overbreadth is what Phase 1.7's new throw turned from cosmetic (extra audit row) into blocking (400).
- (c) does not apply — the frontend is not trusted to set role; role comes from JWT.

---

## 5. Transition matrix

Canonical forward graph — verbatim from `api/src/modules/jobs/jobs.service.ts:112–120`:

```
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled', 'failed', 'needs_reschedule'],
  dispatched: ['en_route', 'cancelled', 'failed', 'needs_reschedule'],
  en_route: ['arrived', 'cancelled', 'failed', 'needs_reschedule'],
  arrived: ['in_progress', 'cancelled', 'failed', 'needs_reschedule'],
  in_progress: ['completed', 'cancelled', 'failed', 'needs_reschedule'],
  needs_reschedule: ['pending', 'confirmed', 'dispatched', 'cancelled'],
};
```

### Role × current-state behavior (as of HEAD)

Role classification from `jobs.service.ts:960`: `isAdmin = ['owner','admin'].includes(userRole)`.

| Role | VALID_TRANSITIONS enforced? | Same-status no-op? | Reason required for any non-same-status change? | Audit row written (`notifications.type='status_override'`)? |
|---|---|---|---|---|
| `owner` | ❌ skipped (admin) | ✅ | ✅ (broken for forward) | ✅ |
| `admin` | ❌ skipped (admin) | ✅ | ✅ (broken for forward) | ✅ |
| `dispatcher` | ✅ enforced | ❌ | ❌ | ❌ |
| `driver` | ✅ enforced | ❌ | ❌ | ❌ |
| `secretary` | ✅ enforced (falls into non-admin branch) | ❌ | ❌ | ❌ |
| `viewer` (no row in DB) | ✅ enforced | ❌ | ❌ | ❌ |

Note: `viewer` and `admin` are referenced in the prompt's role list but `SELECT DISTINCT role FROM users` returns only `owner, dispatcher, driver, secretary`.

### Intermediate-step question: `dispatched`

- `dispatched` is both in VALID_TRANSITIONS and in the live DB (2 jobs currently in that status).
- The canonical full forward chain is `pending → confirmed → dispatched → en_route → arrived → in_progress → completed`.
- **The driver app does not respect this chain.** `driver-app/app/job/[id].tsx:104–110`:

  ```
  const STATUS_FLOW = {
    pending:    { next: 'en_route', label: 'On My Way', ... },
    confirmed:  { next: 'en_route', label: 'On My Way', ... },
    dispatched: { next: 'en_route', label: 'On My Way', ... },
    en_route:   { next: 'arrived',  label: 'Arrived',   ... },
    arrived:    { next: 'completed',label: 'Complete Job', ... },
    in_progress:{ next: 'completed',label: 'Complete Job', ... },
  };
  ```

  So a driver tapping "On My Way" on a `pending` or `confirmed` job sends `en_route` directly — a transition the backend's `VALID_TRANSITIONS` does **not** permit for non-admins. For role=`driver`, the backend would throw `Cannot transition from 'confirmed' to 'en_route'`. For role=`owner`/`admin`, the `VALID_TRANSITIONS` check is skipped (because `isAdmin`), so the admin branch is reached and fires the override-reason throw instead.

  This is a **second bug latent behind Phase 1.7** and is listed under Open Questions § 11.

### Driver-app button → target state

| Button | Source screen | State transition sent | Code |
|---|---|---|---|
| "On My Way" | job detail | `pending/confirmed/dispatched → en_route` | `driver-app/app/job/[id].tsx:105–107` |
| "Arrived" | job detail | `en_route → arrived` | `driver-app/app/job/[id].tsx:108` |
| "Complete Job" | job detail | `arrived/in_progress → completed` | `driver-app/app/job/[id].tsx:109–110`, `driver-app/src/api.ts:179` |
| "Failed Trip" | job detail (modal) | `* → failed` | `driver-app/src/api.ts:190` |
| "Complete Stop" (with dump slip) | job detail | `arrived → completed` | `driver-app/app/job/[id].tsx:628` |

---

## 6. Owner-as-driver findings

**The general `/jobs/:id/status` endpoint has no concept of "assigned-driver capacity."**

- `jobs.controller.ts:234–277` takes `@CurrentUser('role')`, `@CurrentUser('id')`, `@CurrentUser('email')` and forwards them verbatim to the service.
- `jobs.service.ts:944–994` (`changeStatus`) receives `userRole` and never cross-references `userId` with `job.assigned_driver_id`.
- Neither layer inspects headers, user-agent, or any "source" flag. There is no driver-app marker.
- `AuthUser` (`api/src/common/decorators/index.ts:14–19`) carries `{ id, email, role, tenantId }` — no `capacity` or similar.

The **only** place owner-as-driver gets implicit special handling is the unused `/driver/jobs/:id/status` endpoint (`driver.controller.ts:63–131`), which does two things the general endpoint doesn't:
1. Verifies `assigned_driver_id = userId` (`driver.controller.ts:72–75`).
2. Hardcodes `'driver'` as the role passed to the service (`driver.controller.ts:120`), bypassing the `isAdmin` classification for any user calling it.

But the driver app doesn't use that endpoint. `grep -rn updateDriverJobStatus driver-app/` returns only its definition in `src/api.ts:63` — no callers.

---

## 7. Blast-radius list

### Currently broken (400 `override_reason_required`) for role `owner` or `admin`

Every PATCH against `/jobs/:id/status` that (a) changes status to a non-same value and (b) does **not** include `overrideReason` in the payload. That means:

| Surface | Call site | Payload | Status |
|---|---|---|---|
| Driver app — "On My Way" | `driver-app/app/job/[id].tsx:213` → `updateJobStatus` | `{ status: "en_route" }` | ❌ broken for owner-as-driver (field-test reproduction) |
| Driver app — "Arrived" | same | `{ status: "arrived" }` | ❌ predicted broken |
| Driver app — "Complete Job" | `driver-app/src/api.ts:179` → `completeJobWithAsset` | `{ status: "completed", assetId, ... }` | ❌ predicted broken |
| Driver app — "Complete Stop" | `driver-app/app/job/[id].tsx:628` → `updateJobStatus` | `{ status: "completed" }` | ❌ predicted broken |
| Driver app — "Failed Trip" | `driver-app/src/api.ts:190` → `failJob` | `{ status: "failed", cancellationReason }` | ❌ predicted broken (only `cancellationReason` sent, not `overrideReason`) |
| Web — job-detail cancel modal (primary path) | `web/src/app/(dashboard)/jobs/[id]/page.tsx:986–1000` | `{ status: "cancelled", cancellationReason }` | ❌ predicted broken — only `cancellationReason` sent; gate checks `overrideReason` |
| Web — job-detail cancel modal (prompt fallback) | `web/src/app/(dashboard)/jobs/[id]/page.tsx:930–947` | same | ❌ predicted broken |
| Web — job-detail kebab `changeStatus(newStatus)` | `web/src/app/(dashboard)/jobs/[id]/page.tsx:1016–1032` | `{ status: newStatus }` | ❌ predicted broken |
| Web — dispatch board quickview footer | `web/src/app/(dashboard)/dispatch/page.tsx:1026, 1043` | `{ status, cancellationReason? }` | ❌ predicted broken |
| Web — dispatch tile cancel button | `web/src/app/(dashboard)/dispatch/page.tsx:2908` | `{ status: "cancelled" }` | ❌ predicted broken |
| Web — dispatch QuickView field (line 2599) | `web/src/app/(dashboard)/dispatch/page.tsx:2599` | varies | ❌ predicted broken |
| Web — bulk cancel / bulk complete | `web/src/app/(dashboard)/jobs/page.tsx:1325, 1371` | `{ status }` | ❌ predicted broken per-row |
| Web — override modal (`handleOverride`) | `web/src/app/(dashboard)/jobs/[id]/page.tsx:1034–1064` | `{ status, overrideReason }` | ✅ intended path — works |

### Not affected

- `dispatch.service.ts:416` (`sendRoutes`) — passes `'dispatcher'`, falls into non-admin branch, obeys `VALID_TRANSITIONS`.
- `/driver/jobs/:id/status` — unused but would work (hardcoded `'driver'`).
- Cancellation **orchestrator** (`/jobs/:id/cancellation-context`) and the **exchange flow** (`rental-chains.service.ts`) do **not** call `changeStatus` directly; they either call other service methods (`cancelJob`, `createExchange`) or set non-Job entity statuses. Only the web cancel modal that ultimately PATCHes `/jobs/:id/status` (row above) is affected.

---

## 8. Existing test inventory

File: `api/src/modules/jobs/jobs.service.spec.ts`.

### Phase 1.7 override-reason tests (must continue passing after the fix)

| # | Name | Lines | Asserts |
|---|---|---|---|
| 2 | `empty whitespace reason — throws override_reason_required: before any write` | 354–370 | Whitespace-only `overrideReason` + admin role → throw |
| 2b | `missing reason — throws with override_reason_required: prefix` | 372–386 | No `overrideReason` + admin role → throw |
| 1 | `admin override positive — status updated AND audit row written inside transaction` | 319–353 | Admin + reason + backward or non-forward transition → success, audit written |
| 3 | `transactional rollback — audit insert failure prevents commit` | 389–408 | Rollback invariant |
| 4 | `same-status no-op — returns unchanged job, no audit row, no transaction` | 409–425 | Admin same-status → pass-through |
| 5 | `admin bypasses VALID_TRANSITIONS — en_route → pending backward transition succeeds` | 426–452 | Admin can go backward with reason |
| 6 | `dispatcher role — en_route → pending rejected by VALID_TRANSITIONS` | 453–467 | Dispatcher is non-admin post-Phase-1 |
| 7–9 | Override-to-Unassigned clears driver | 491–556 | `assigned_driver_id` null on pending/confirmed override |

### The one existing "driver happy path" test

`regression: driver role — valid forward transition en_route → arrived succeeds without reason or audit row` (`jobs.service.spec.ts:471–489`). Uses `userRole='driver'` directly — it does **not** cover the owner-as-driver case.

### Missing tests (Phase 1 will add)

1. **`owner role + assigned driver + valid forward transition`** → success without `overrideReason`, no override audit row. (Field-test reproduction: owner, `confirmed → dispatched` or whatever the canonical forward edge is, success.)
2. **`owner role + NOT assigned driver + valid forward transition`** → decide product behavior (likely still no reason required since transition is sanctioned — covered by Option A).
3. **`owner role + assigned driver + backward/out-of-sequence transition`** → reason still required (the Phase 1.7 invariant must still hold when the admin is genuinely doing an override, even on a job they happen to own).
4. **`admin cancel via web cancel-modal payload` (`{ status: 'cancelled', cancellationReason }`)** → either (a) Option A treats `cancelled` as sanctioned forward and lets it through, or (b) the frontend needs to also set `overrideReason` — flag for product.
5. **`driver app 'Failed Trip' payload` (`{ status: 'failed', cancellationReason }`) for role=owner** → same shape as #4.

---

## 9. Proposed fix shape

**Recommend Option A — backend distinguishes by transition legality.**

Rationale: The simplest, most defensible invariant is "a reason is required only when the requested transition is not in the canonical forward set." That mirrors the operator's mental model — a correction requires justification, a sanctioned step does not. It needs no new DTO fields, no headers, no trust boundaries. Role still governs *who is allowed to override at all* (only `owner`/`admin` can bypass `VALID_TRANSITIONS`), but the *reason-required* gate becomes transition-based, not role-based.

Concretely, in prose: compute `isSanctionedForward = VALID_TRANSITIONS[job.status]?.includes(dto.status)`. When `isAdmin && !isSanctionedForward && previousStatus !== dto.status`, require `overrideReason`. When `isAdmin && isSanctionedForward`, skip the reason gate (the admin is just clicking through the normal flow on a job they happen to own — identical semantics to a driver doing it). The admin's ability to bypass `VALID_TRANSITIONS` entirely is preserved for the genuine-override case. The existing audit-log write should still fire on any non-sanctioned admin override, unchanged.

This keeps every Phase 1.7 invariant intact:
- Out-of-flow admin overrides still require a reason (test #1, #2, #2b, #3, #5 all pass).
- Same-status no-op preserved (test #4).
- Dispatcher is still not admin (test #6).
- Driver-role forward transitions unchanged (existing regression test).
- Override-to-Unassigned coupling unchanged (tests #7–9).

Option B (explicit `acting_as` parameter) is unnecessary complexity — the signal is already derivable from the transition itself. Option C is a security anti-pattern and is excluded.

---

## 10. Phase 1 implementation scope estimate

- **Files touched (expected): 2**
  - `api/src/modules/jobs/jobs.service.ts` — swap the `isAdmin && previousStatus !== dto.status` gate for `isAdmin && previousStatus !== dto.status && !VALID_TRANSITIONS[previousStatus]?.includes(dto.status)`. ~3 lines changed in `changeStatus`. Comment update.
  - `api/src/modules/jobs/jobs.service.spec.ts` — add the 5 missing-tests enumerated in § 8. ~100–150 new lines.
- **Migrations required: 0** — no schema change.
- **Registry changes: 0** — no new user-facing label or endpoint.
- **Smoke-test steps:**
  1. Owner-as-driver on `dispatched` job → taps "On My Way" (`dispatched → en_route`) → should succeed with no prompt, writes no override audit row.
  2. Owner from web → uses Override Status modal, `completed → confirmed` with reason → should still succeed with reason, writes audit row.
  3. Owner from web → uses Override Status modal, `completed → confirmed` with empty reason → still throws `override_reason_required` (unchanged).
  4. Dispatcher from dispatch board → `confirmed → dispatched` → should succeed (unchanged).
  5. Owner from web cancel modal → `confirmed → cancelled` with `cancellationReason` only (no `overrideReason`) → success (Option A treats `cancelled` as sanctioned forward since it is in every non-terminal `VALID_TRANSITIONS` entry).
- **Deploy sequence:** per memory — single chain, `git push` + `cd api && vercel --prod`, run as one command.

---

## 11. Open questions for Anthony

1. **Dispatched skip.** The driver app's `STATUS_FLOW` maps `pending → en_route` and `confirmed → en_route` directly, but `VALID_TRANSITIONS` requires `confirmed → dispatched → en_route`. Today this "works" for owner-as-driver only because the admin bypass skips `VALID_TRANSITIONS` — meaning Option A on its own will **still** fail for a regular `driver`-role user (which you don't have in production yet, but will). Options:
   - (a) Teach `VALID_TRANSITIONS` that `confirmed → en_route` is legal (and `pending → en_route`?), collapsing `dispatched` into an optional intermediate.
   - (b) Keep the strict chain and fix the driver app to POST `{ status: 'dispatched' }` then `{ status: 'en_route' }` from the "On My Way" tap — two calls, one user action.
   - (c) Have the driver app send `{ status: 'dispatched' }` when current is `confirmed`, then `{ status: 'en_route' }` as a second implicit step on the same tap.
   - (d) Status "On My Way" should actually transition to `dispatched`, not `en_route`, and the driver button label should be re-mapped.
   My recommendation is (a) — enlarge `VALID_TRANSITIONS` — because `dispatched` is effectively "a dispatcher assigned this to a driver" and the act of a driver tapping "On My Way" is itself evidence of assignment. But this is a product call.

2. **Cancel payload contract.** The web cancel modal sends `cancellationReason` (not `overrideReason`). Option A naturally handles this because `cancelled` is in `VALID_TRANSITIONS[*]` (a sanctioned transition from every non-terminal state), so the reason gate is skipped and the cancel-specific `cancellationReason` is already persisted. Confirm you are fine treating admin cancellations as sanctioned forward (no override-reason required), since `cancellationReason` already captures the operator's rationale in the dedicated column.

3. **Orphan `scheduled` status.** `SELECT DISTINCT status FROM jobs` returned `scheduled` on 9 rows, but `scheduled` is not a key in `VALID_TRANSITIONS` and is not in `ChangeStatusDto`'s `@IsIn` enum. Any attempt to transition *out of* `scheduled` by a non-admin user will throw `Cannot transition from 'scheduled' to ...` (the `VALID_TRANSITIONS[job.status]` lookup returns `undefined`). Is this expected data, or leftover from an older state vocabulary? Out of scope for Arc 1 but flagged for visibility.

4. **Dead code: `/driver/jobs/:id/status` + `updateDriverJobStatus`.** The dedicated driver endpoint and its API function exist but are not wired to any UI. Should we delete them as part of Phase 1 cleanup (Arc 3?), or preserve for a future migration where the driver app switches to the capacity-explicit endpoint?

5. **Latent authorization gap (flag only).** The general `/jobs/:id/status` controller has no `@Roles(...)` guard and no `assigned_driver_id = userId` check for non-admin callers. A `driver`-role user in the same tenant can currently change status on a job assigned to a different driver (subject to `VALID_TRANSITIONS`). Pre-existing, not introduced by Phase 1.7, out of Arc 1 scope — but it is the kind of thing a capacity-aware rewrite (Option B) would have closed. Want me to file it as an Arc 2 item?

### Security checklist results (per prompt § "Security requirements")

| Check | Result | Notes |
|---|---|---|
| Tenant isolation | ✅ | `TenantId()` decorator reads `request.user.tenantId` from the JWT-populated `AuthUser` (`common/decorators/index.ts:29–35`). Body `tenant_id` is never read. |
| Authorization — caller is assigned driver or has admin capability | ⚠️ partial | Enforced on `/driver/jobs/:id/status` (unused). **Not** enforced on `/jobs/:id/status` for the non-admin branch. See Open Question #5. |
| Role hierarchy canonical | ⚠️ | `jobs.service.ts:960` hardcodes `['owner','admin']`. No shared hierarchy helper exists in `api/src/common/**`. Not regressed by Phase 1.7 but worth centralizing when Phase 1 lands. |
| Audit log on every status change | ⚠️ partial | Admin override branch writes `notifications.type='status_override'` in the same transaction as the save (`jobs.service.ts:1232–1262`, post-Phase-1.7). **Non-admin forward transitions write no audit row.** Pre-existing behavior, not a Phase 1.7 regression. Flag: if Anthony wants every transition audited, it's a small add. |
| No PII leak in error response | ✅ | `override_reason_required` string contains no customer data; NestJS `BadRequestException` envelope is generic. |
| Rate-limit / abuse ceiling | ⚠️ not found | No per-user or per-endpoint rate limit on `/jobs/:id/status`. Acceptable for legitimate driver bursts, but no upper ceiling exists at all. Flag for Arc 2 / security-review scope. |

---

**End of report.** No source files were modified; no commits, pushes, or deploys were made.
