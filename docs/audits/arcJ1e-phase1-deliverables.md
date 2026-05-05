# Arc J.1e — Phase 1 implementation deliverables

**Status:** All implementation complete. STAGED, NOT COMMITTED. NOT PUSHED. NOT DEPLOYED.

Awaiting explicit ship/no-ship verdict.

---

## 1. `git diff --cached --stat`

```
 web/src/app/(dashboard)/dispatch/page.tsx  | 66 ++++++++++-------------------
 web/src/app/(dashboard)/jobs/[id]/page.tsx | 67 +++++++++++++++++++++++++-----
 web/src/app/(dashboard)/jobs/page.tsx      | 60 ++++++++++++++++++++++++--
 web/src/lib/feature-registry.ts            |  5 +++
 web/src/lib/job-status.ts                  | 33 +++++++++++++++
 5 files changed, 173 insertions(+), 58 deletions(-)
```

**5 files. +173 / -58. No new files created. No backend changes. No DTO changes. No migrations.**

Per-file diffs saved to `/tmp/arcJ1e-{job-detail,dispatch,jobs-list,lib}.patch` (344 lines total).

---

## 2. `git diff --cached web/src/app/(dashboard)/jobs/[id]/page.tsx`

Three changes:

1. **Import update at line 199.** Adds `VALID_JOB_TRANSITIONS, canCancelJobByStatus` from the hoisted `@/lib/job-status` module.

2. **Local `VALID_TRANSITIONS` constant becomes a re-export at line 216-222.** Old 7-line literal table replaced with `const VALID_TRANSITIONS = VALID_JOB_TRANSITIONS;` plus a comment block. The local symbol stays so the rest of the file (timeline chips, mark-complete gate, etc.) doesn't need to change.

3. **`canCancel` gets a role gate at line 1487-1492.**
   ```ts
   // Backend RolesGuard at POST /jobs/:id/cancel-with-financials
   // remains the security boundary; hiding the UI element for
   // non-office roles avoids the visible-button-→-403 dead end.
   const canCancel = isOfficeRole && transitions.includes("cancelled");
   ```

4. **`?cancel=1` consumer effect at line 526-560** (mirrors `?override=1` at line 511-524). On URL match: bails for non-office (silent strip), toasts + strips for terminal-status jobs, opens the modal + strips otherwise. `router.replace(/jobs/:id, { scroll: false })` keeps scroll position and removes the trigger so refresh / back-button don't re-fire.

5. **Override effect bails when `?cancel=1` is present** (line 521 `if (searchParams.get("cancel") === "1") return;`) — see § 10 for precedence rule.

Full hunk in `/tmp/arcJ1e-job-detail.patch` (109 lines).

---

## 3. `git diff --cached web/src/app/(dashboard)/dispatch/page.tsx`

Three changes:

1. **`<QVContent>` render at line 1424 receives a new `canOverrideStatus` prop.** Threading is from page-scope `canOverrideStatus` (already derived at line 326-327 from the existing `currentUserRole` fetch).

2. **`QVContent` function signature at line 2495 updated** to accept `canOverrideStatus: boolean`.

3. **Cancel Job button at line 2908-2949 fully replaced.** Pre-Arc-J.1e: 42-line `<button onClick={...}>` with `window.confirm` + preflight + branched legacy PATCH/redirect, no role gate. Post-Arc-J.1e: 9-line `<Link href={`/jobs/${job.id}?cancel=1`}>` wrapped in `canOverrideStatus &&` (defense-in-depth role gate). **Net −33 lines.**

   ```tsx
   canOverrideStatus && (
     <Link
       href={`/jobs/${job.id}?cancel=1`}
       className="w-full rounded-full border py-2 text-xs font-medium text-center"
       style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}
     >
       {FEATURE_REGISTRY.cancel_job_quickview_action?.label ?? "Cancel Job"}
     </Link>
   )
   ```

   The `<Link>` component was already imported. No `window.confirm`, no preflight `/cancellation-context` call (modal page does its own), no legacy PATCH fast-path (Step 3 of the modal is the user's destructive ack).

Full hunk in `/tmp/arcJ1e-dispatch.patch` (93 lines).

---

## 4. `git diff --cached web/src/app/(dashboard)/jobs/page.tsx`

Three changes:

1. **Import additions at line 111-112.** `canCancelJobByStatus` from `@/lib/job-status`. `XCircle` from `lucide-react` (used by the kebab Cancel Job item icon).

2. **Role-fetch pattern lifted into `JobsPageContent` at line 260-272.** Replicates the established pattern from `dispatch/page.tsx:319-327` and `jobs/[id]/page.tsx:499-507` — `useState + useEffect + api.get<{ role: string }>("/auth/profile")`. Per Anthony's instruction: no new role-fetching hook, no new context provider; matched the existing precedent.

3. **Leg-row Status cell at line 1167-1218 wraps its existing status badge in a flex container and conditionally renders a Dropdown kebab** with a single Cancel Job item. Gates: `isOfficeRole && canCancelJobByStatus(childJob.status)`. Click → `snapshotListState()` (preserves expanded chains for back-nav) → `router.push(/jobs/${childJob.id}?cancel=1)`.

Full hunk in `/tmp/arcJ1e-jobs-list.patch` (85 lines).

---

## 5. `git diff --cached` for additional files

### `web/src/lib/job-status.ts` (+33 lines)

Appended at file tail:

```ts
export const VALID_JOB_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  failed: ['cancelled'],            // ← Arc J.1e widen
  needs_reschedule: ['cancelled'],  // ← Arc J.1e widen
};

export function canCancelJobByStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (VALID_JOB_TRANSITIONS[status] ?? []).includes('cancelled');
}
```

`completed` and `cancelled` remain absent — those are truly terminal and the UI hides the cancel affordance for them. `failed` and `needs_reschedule` are widened — these are non-terminal operator-attention states where cancellation is a legitimate office action.

### `web/src/lib/feature-registry.ts` (+5 lines)

Four new keys, all under the existing Arc J.1 cancel-modal cluster:

- `cancel_job_quickview_action` — "Cancel Job" link label in dispatch QuickView
- `cancel_job_deeplink_terminal` — toast text for terminal-status `?cancel=1` deep-links
- `lifecycle_leg_actions_menu` — ARIA label for the per-leg kebab trigger
- `lifecycle_leg_cancel_action` — "Cancel Job" item label in the leg kebab

All defaults inlined as fallbacks per the registry standard pattern.

Full hunk in `/tmp/arcJ1e-lib.patch` (57 lines).

---

## 6. TypeScript clean confirmation

- `cd ~/serviceos/api && npx tsc --noEmit -p tsconfig.json` → exit 0, no output (clean).
- `cd ~/serviceos/web && npx tsc --noEmit` → exit 0, no output (clean).

---

## 7. Full jest GREEN confirmation

```
$ cd ~/serviceos/api && npx jest --no-coverage
Test Suites: 11 passed, 11 total
Tests:       113 passed, 113 total
Snapshots:   0 total
Time:        1.362 s
Ran all test suites.
```

**113/113 — matches Deploy #15 baseline exactly. No regression.** Includes all 16 Arc J.1 J-suite tests (J1, J1b, J2-J7, J4b, J4c, J8-J12 + cascadeDelete smoke). Backend orchestrator API surface is unchanged this arc — none of the J-suite tests required modification.

---

## 8. Cancel Job entry-point inventory after Arc J.1e

| Surface | Filepath:line | Role gate | Domain gate | Reaches orchestrator? |
|---|---|---|---|---|
| Job-detail kebab | `web/src/app/(dashboard)/jobs/[id]/page.tsx:1494` (`canCancel = isOfficeRole && transitions.includes("cancelled")`) | YES — `isOfficeRole` | YES — `transitions.includes("cancelled")` | YES — calls `changeStatus("cancelled")` → `openCancelModal()` → POST `/jobs/:id/cancel-with-financials` |
| Job-detail `?cancel=1` deep-link consumer | `web/src/app/(dashboard)/jobs/[id]/page.tsx:534-559` | YES — `isOfficeRole` (silent strip if not) | YES — `canCancelJobByStatus(job.status)` (toast + strip if not) | YES — same path via `openCancelModal()` |
| Dispatch QuickView body Cancel Job link | `web/src/app/(dashboard)/dispatch/page.tsx:2912-2920` (`canOverrideStatus && <Link href=?cancel=1>`) | YES — `canOverrideStatus` | DEFERRED — domain gate runs on the destination page (`?cancel=1` consumer) so the dispatch board never has to know per-job status nuance | YES via deep-link |
| Rental Lifecycles per-leg kebab Cancel Job | `web/src/app/(dashboard)/jobs/page.tsx:1184-1208` (`isOfficeRole && canCancelJobByStatus(childJob.status) && <Dropdown>`) | YES — `isOfficeRole` | YES — `canCancelJobByStatus(childJob.status)` | YES via deep-link |
| Rental Lifecycles bulk Cancel Selected (stale-only) | `web/src/app/(dashboard)/jobs/page.tsx:1304-1374` | NO (UI surface only renders inside `statusFilter === "stale"`; not changed this arc) | partial — preflight `/cancellation-context` per job | partial — only zero-balance jobs cancel via legacy PATCH; decision-required jobs are skipped with a count |
| `cancelWithReasonFallback` (network-failure escape hatch) | `web/src/app/(dashboard)/jobs/[id]/page.tsx:948-965` | NO (not changed this arc per scope) | NO (only fires when `/cancellation-context` is unreachable) | NO — falls back to legacy `PATCH /jobs/:id/status` |

**Three primary entry points (kebab + dispatch QV link + leg kebab) all gate `isOfficeRole && canCancelJobByStatus`. All three reach the same 3-step modal which in turn calls the same orchestrator endpoint, which has its own server-side `RolesGuard('owner', 'admin')` as the security boundary.**

---

## 9. VALID_TRANSITIONS reference inventory

Searched `web/src/` for all references. Only call sites:

| Filepath:line | Reference | Affected by widening? |
|---|---|---|
| `web/src/lib/job-status.ts:516` | NEW: declaration of `VALID_JOB_TRANSITIONS` (canonical) | n/a — it IS the table |
| `web/src/lib/job-status.ts:528` | NEW: `canCancelJobByStatus` helper reads the table | YES (uses widened entries) |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:199` | Import of `VALID_JOB_TRANSITIONS` from lib | YES (re-exported as local `VALID_TRANSITIONS`) |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:222` | Local `VALID_TRANSITIONS = VALID_JOB_TRANSITIONS` re-export | YES (transitive) |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:264` | Comment "Mirrors VALID_TRANSITIONS in api/src/modules/jobs/jobs.service.ts:112" | DOC — not a runtime reference |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:1275` | `transitions = (VALID_TRANSITIONS[job.status] || []).filter(...)` | YES — `transitions.includes("cancelled")` for `failed`/`needs_reschedule` jobs now resolves true |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:1494` | `canCancel = isOfficeRole && transitions.includes("cancelled")` | YES (transitive) |
| `web/src/app/(dashboard)/jobs/[id]/page.tsx:1878` | `disabled={actionLoading || !transitions.includes("completed")}` (Mark Complete button gate) | NO — `failed` and `needs_reschedule` table entries do NOT contain `completed`, so the Mark Complete button stays disabled for those statuses (correct — you can't go from failed to completed without a re-attempt) |
| `web/src/app/(dashboard)/jobs/page.tsx:111` | NEW: import `canCancelJobByStatus` from lib | YES (uses widened table) |
| `web/src/app/(dashboard)/jobs/page.tsx:1188` | `canCancelJobByStatus(childJob.status)` | YES (transitive) |

**API server-side `VALID_TRANSITIONS` at `api/src/modules/jobs/jobs.service.ts:112` is independent of this widening.** The orchestrator endpoint does not consume that table for cancellation eligibility — its own logic is at `cancelJobWithFinancials` which validates job status separately. Server-side widening is NOT required for Arc J.1e.

**No tests touch VALID_TRANSITIONS directly.** Searched `web/src/__tests__`, `**/*.test.ts(x)`, `**/*.spec.ts(x)` — zero hits. No test updates needed.

---

## 10. Precedence rule for `?cancel=1` and `?override=1`

**Documented behavior:** `?cancel=1` takes precedence over `?override=1`.

**Implementation** (in `jobs/[id]/page.tsx`):

- The `?override=1` effect bails early when `searchParams.get("cancel") === "1"` (line 521).
- The `?cancel=1` effect runs unconditionally and ends with `router.replace(/jobs/:id, { scroll: false })` which strips BOTH params from the URL.
- Both effects use `useState`-backed `Auto​Opened` flags (`overrideAutoOpened`, `cancelAutoOpened`) for single-fire semantics.

**Rationale:**
1. Cancel is more destructive (terminates the lifecycle) → safer to make it the primary action when both are signaled.
2. The cancel modal has its own multi-step confirmation (Step 1 reason → Step 2 decisions → Step 3 confirm), so making it primary doesn't lose any safety check.
3. Override is a corrective action (reset a status); if the operator somehow constructed both params, the destructive intent is the more likely one.

**Edge case:** if the cancel domain gate fails (terminal status), the effect toasts + strips. The override effect already bailed. **The override modal will NOT auto-open in that case** — the operator sees the terminal-status toast and decides what to do next. Acceptable outcome: opening the override modal silently after a "cannot cancel" toast would be confusing. If Anthony wants override to fall through when cancel is blocked, that's a follow-up tweak (~3 LOC).

---

## 11. Deviations from prompt scope

1. **Hoisted `VALID_TRANSITIONS` to `lib/job-status.ts` rather than left as a duplicated literal across two files.** Cleaner DRY than declaring the table twice. Adds 1 file to the diff (`lib/job-status.ts` +33 lines) but eliminates the duplication and gives the leg-row kebab a clean import path. Anthony's prompt didn't prescribe placement — choosing canonical `lib/` over per-page literal is a small judgment call.

2. **Did NOT add `?cancel=1` consumer to terminal-status jobs that should toast + strip.** The prompt's S6 says: "open /jobs/[id]?cancel=1 for a completed job in the URL bar. Confirm toast 'This job cannot be cancelled...' appears, query param strips, modal does NOT open." → IMPLEMENTED at lines 543-553 with the registry-backed toast and `router.replace(...)`. **No deviation; documenting for the smoke checklist.**

3. **Removed the dispatch QuickView's preflight `/cancellation-context` call entirely.** The pre-Arc-J.1e button preflighted before navigating; the new `<Link>` does not preflight. Justification: the destination page does its own fetch (`openCancelModal` triggers `GET /cancellation-context` at `jobs/[id]/page.tsx:983`). Eliminating the duplicate fetch is a net win for latency and code simplicity. **Documented; not a scope deviation but worth flagging for the QuickView UX team.**

4. **Did NOT thread `tenantId` from the URL.** Tenant is derived server-side from JWT only (`api/src/modules/jobs/jobs.controller.ts:308`). `?cancel=1` carries no tenant identifier. **No new client-side tenant inputs.**

5. **Help center copy.** The dispatch QuickView previously fired a browser confirm dialog; this arc removes it (the modal's Step 3 is the new confirmation). **Flag for help-center copy update** — anywhere docs say "click Cancel Job, confirm in the browser dialog" should be updated to "click Cancel Job, confirm in the 3-step modal that opens on the job detail page." Per Anthony's instruction, the copy is NOT written in this arc.

6. **Did NOT change `cancelWithReasonFallback`** (line 948-965). Out of scope per prompt.

7. **Did NOT change `statusFilter === "stale"` bulk-cancel UI** (line 1304-1374). Out of scope per prompt.

8. **Did NOT add jest tests.** Frontend-only changes per prompt; backend orchestrator API surface unchanged.

9. **Did NOT introduce a context provider for the role state.** Anthony's instruction was to lift a context provider IF the role wasn't loaded ad-hoc — but the existing pattern across two pages (`dispatch/page.tsx`, `jobs/[id]/page.tsx`) is direct `api.get('/auth/profile')` with local `useState`. Replicating the same pattern in `jobs/page.tsx` matches the precedent without introducing new abstraction. If Anthony wants a shared `useCurrentUserRole` hook later, that's its own small refactor.

---

## Standing rules — reaffirmed compliance

| Rule | Status |
|---|---|
| Multi-tenant safe | ✅ Every modal call still filters by tenant_id from JWT server-side. No client-side tenant inputs added. |
| JWT auth | ✅ Inherits global JwtAuthGuard. |
| RBAC `owner | admin` only on cancel | ✅ Backend `RolesGuard` unchanged at `jobs.controller.ts:301-302`. UI gate now matches via `isOfficeRole`/`canOverrideStatus` on all three entry points. |
| Registry-driven labels | ✅ 4 new keys added; defaults inlined as fallbacks. |
| Audit row per decision | ✅ Orchestrator unchanged; threaded-manager audit save still atomic with cancellation transaction. |
| No-magic / additive only | ✅ Only existing-code edits are (a) `dispatch/page.tsx` Cancel Job button + QVContent prop addition, (b) `jobs/[id]/page.tsx` import + canCancel gate + `?cancel=1` effect + override-effect cancel-precedence guard, (c) `jobs/page.tsx` import + role state + leg-row Status cell wrap. Everything else is new (registry keys, lib exports). |
| No auto-commit / no auto-push / no auto-deploy | ✅ STAGED via `git add`, no commits, no pushes. |

---

**END OF DELIVERABLES.** Awaiting explicit ship/no-ship verdict.
