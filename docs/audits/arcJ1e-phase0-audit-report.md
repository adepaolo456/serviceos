# Arc J.1e — Phase 0 audit report (UI entry-point wire-up)

**Status:** Read-only code archaeology. No file modifications. Halts for review.

**Working tree state:** `git diff HEAD --stat` returns no output — the working tree exactly matches HEAD (5d6486e). What this audit describes IS what's deployed.

---

## Exec summary (3 bullets)

1. **The dispatch QuickView slide-out's Cancel Job button is alive but the redirect drops the operator on a page that has no auto-open trigger.** The button at `dispatch/page.tsx:2908-2949` (inside `QVContent`, rendered as the QuickView body) preflights `/cancellation-context`, classifies any invoice with `hasPaidInvoices || hasUnpaidInvoices` as decision-required, and redirects via `window.location.href = /jobs/${job.id}` (line 2935) — **with no query param**. There is no `?cancel=1` consumer on `jobs/[id]/page.tsx`. The existing `?override=1` consumer at `jobs/[id]/page.tsx:518` is the proven pattern to mirror.
2. **The job-detail kebab DOES contain a Cancel Job item, but it is gated on `transitions.includes("cancelled")` from `VALID_TRANSITIONS` (`jobs/[id]/page.tsx:216-223`).** That table omits `completed`, `cancelled`, `failed`, `needs_reschedule` — for those statuses `transitions = []` and the Cancel Job button is correctly hidden. If Anthony's test was on a non-terminal job, this is a real bug; if on a terminal job, this is by design and we need to confirm intent. **The audit cannot determine which case applies without knowing the job status under test.**
3. **The Rental Lifecycles page (`jobs/page.tsx`) renders a chain-grouped table with no per-row checkbox and no per-leg kebab.** Lifecycle parent rows have a single trailing arrow icon (`page.tsx:1095-1119`) that navigates to the chain's representative job. Expanded leg rows (`page.tsx:1131-1170`) render task-type label + job number + status text only — zero action affordances. The bulk-cancel UI (`page.tsx:1304-1374`) gated on `statusFilter === "stale"` ships in the file but only renders for the stale view, which has its own (unread in this audit) flat-list rendering presumably with checkboxes. No Cancel entry exists on the default lifecycle view.

---

## § Deliverable 1 — Surface inventory

Cancel-handling sites in `web/src/`. Each entry: filepath:line — classification — surface — context.

### Active orchestrator/legacy cancel paths

| Filepath:line | Classification | Surface | Notes |
|---|---|---|---|
| `app/(dashboard)/jobs/[id]/page.tsx:1087` | ORCHESTRATOR | Job-detail 3-step modal `confirmCancelFromModal` | `await api.post('/jobs/:id/cancel-with-financials', payload)` — the new endpoint call |
| `app/(dashboard)/jobs/[id]/page.tsx:1503` | LEGACY (calls `changeStatus("cancelled")` which routes to `openCancelModal`, then orchestrator) | Job-detail kebab "Cancel Job" item | Indirect: button calls `changeStatus("cancelled")` (line 1503), which special-cases `'cancelled'` and calls `openCancelModal()` (line 971) |
| `app/(dashboard)/jobs/[id]/page.tsx:953` | LEGACY | `cancelWithReasonFallback` network-failure path | Direct `api.patch('/jobs/:id/status', { status: 'cancelled', cancellationReason })`. Reachable from `openCancelModal` only on `/cancellation-context` fetch failure. |
| `app/(dashboard)/dispatch/page.tsx:2908-2949` | LEGACY+ORCHESTRATOR-by-redirect | Dispatch QuickView body (QVContent) red Cancel Job button | window.confirm → preflight → if decision-required: `window.location.href = /jobs/:id` (no param) → modal does NOT auto-open. If zero-balance: `api.patch('/jobs/:id/status')`. |
| `app/(dashboard)/jobs/page.tsx:1347` | LEGACY | Jobs list — bulk Cancel Selected (stale-only) | Inside the `statusFilter === "stale"` branch at line 1304-1374. Per-job preflight + legacy PATCH for zero-balance jobs. Skips decision-required jobs with a count. |

### Display-only / no cancel initiation

| Filepath:line | Classification | Surface | Notes |
|---|---|---|---|
| `app/(dashboard)/jobs/[id]/page.tsx:3597` | DISPLAY-ONLY | Modal `aria-labelledby="cancel-job-modal-title"` | Modal id reference, not a button |
| `app/(dashboard)/jobs/[id]/page.tsx:3601` | DISPLAY-ONLY | `FEATURE_REGISTRY.cancel_job_modal_title` lookup | Title string render |
| `lib/feature-registry.ts:813` and the 17 new Arc J.1 keys at lines ~824-840 | DISPLAY-ONLY | Registry entries powering the modal | Defaults inlined as fallbacks |
| `lib/lifecycle-job-resolver.ts:39-45` | DISPLAY-ONLY | Filters `non-cancelled` chain links | Read-only enrichment |
| `lib/lifecycle-pickup.test.ts:54-64` | DISPLAY-ONLY | Test fixture | Unit test |

### Other matches (false positives, listed for completeness)

`settings/page.tsx`, `quotes/page.tsx`, `team/[id]/page.tsx`, `quote-send-panel.tsx`, `quick-quote-drawer.tsx` use `onCancel` / `handleCancelRemoval` for unrelated modal-dismiss / quote-send-cancel / team-removal flows. None touch `/jobs/:id`.

### Surface coverage matrix

| Surface | Cancel entry? | Reaches orchestrator? |
|---|---|---|
| Job-detail page kebab | YES (gated on `transitions.includes('cancelled')`) | YES via `changeStatus('cancelled')` → `openCancelModal()` → modal POST |
| Job-detail action row (Send Invoice / Mark Complete / Add Note at lines 1874, 1882, 1898) | NO | n/a |
| Dispatch QuickView body (QVContent) | YES (always, when `!isCompleted && job.status !== "cancelled"` at line 2853) | NO — redirect drops user with no auto-open trigger |
| Dispatch QuickView footer | NO (only Call + Navigate + Override Status) | n/a |
| Dispatch tile context-menu (`ctxMenu` / right-click) | NOT INVENTORIED — see line 1080-1081 — only Reschedule item observed in grep, no Cancel | UNKNOWN |
| Rental Lifecycles parent row | NO action item beyond chevron + arrow drill-through | n/a |
| Rental Lifecycles expanded leg row | NO action item | n/a |
| Rental Lifecycles bulk action bar | YES, but only when `statusFilter === "stale"` AND `selectedJobIds.size > 0` | Partially — preflight + redirect on decision-required jobs |
| Customer portal | NOT INVENTORIED for this audit (out of scope per prompt) | n/a |
| Driver app | NOT INVENTORIED for this audit (out of scope per prompt) | n/a |

---

## § Deliverable 2 — Commit 5d6486e file map

**Commit message header:** `fix(jobs): add cancellation financial reconciliation flow (Arc J.1)` — Sat Apr 25 08:02:52 2026 -0400.

**13 files modified by 5d6486e:**

```
api/src/modules/billing/entities/payment.entity.ts
api/src/modules/credit-audit/credit-audit.service.ts
api/src/modules/jobs/dto/cancel-with-financials.dto.ts        (NEW)
api/src/modules/jobs/jobs.controller.ts
api/src/modules/jobs/jobs.module.ts
api/src/modules/jobs/jobs.service.spec.ts
api/src/modules/jobs/jobs.service.ts
api/src/modules/stripe/stripe.service.ts
migrations/2026-04-25-payments-refund-provider-status.sql     (NEW)
web/src/app/(dashboard)/dispatch/page.tsx                     ← 4 web files of concern
web/src/app/(dashboard)/jobs/[id]/page.tsx
web/src/app/(dashboard)/jobs/page.tsx
web/src/lib/feature-registry.ts
```

### Where the +44 lines on `dispatch/page.tsx` actually went

The +44 lines went to **a single hunk inside `QVContent` (the QuickView body component) at lines ~2908-2949** — the existing `Cancel Job` button. The pre-Arc-J.1 button was a one-liner `window.confirm + api.patch`; Arc J.1 expanded it into a preflight-then-branch handler. Quoted at the literal location:

```tsx
// dispatch/page.tsx:2908-2949
<button
  onClick={async () => {
    if (!confirm("Cancel this job?")) return;
    try {
      // Arc J.1 — preflight the cancellation context. If
      // any linked invoice has paid OR unpaid funds, the
      // financial-decision modal on the job detail page
      // is required (refund/credit/keep authority). Route
      // the operator there. Otherwise (zero-balance job),
      // fall through to the legacy PATCH path which
      // covers the simple cancel-and-be-done case.
      const ctx = await api
        .get<{ summary?: { hasPaidInvoices?: boolean; hasUnpaidInvoices?: boolean } }>(
          `/jobs/${job.id}/cancellation-context`,
        )
        .catch(() => null);
      const requiresDecision =
        !!ctx?.summary?.hasPaidInvoices || !!ctx?.summary?.hasUnpaidInvoices;
      if (requiresDecision) {
        toast("warning", "This job has invoice activity — open the job detail page to cancel with a financial decision.");
        window.location.href = `/jobs/${job.id}`;     // ← no query param
        return;
      }
      await api.patch(`/jobs/${job.id}/status`, { status: "cancelled" });
      toast("success", "Cancelled");
      await onRefresh();
    } catch { toast("error", "Failed"); }
  }}
  className="w-full rounded-full border py-2 text-xs font-medium"
  style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}
>
  Cancel Job
</button>
```

**Critical divergence:** the redirect at line 2935 navigates to `/jobs/${job.id}` with **no query parameter**. The destination page has no auto-open trigger keyed to a `?cancel=1` (or similar) param. **This is the dispatch wire-up gap.**

The 5d6486e commit message claims "Registry-driven modal labels" and "preserves existing cancel/status compatibility paths for follow-up cleanup" — accurate. It does NOT claim the dispatch redirect auto-opens the modal; that part of the story was missed.

### Where the +652 lines on `jobs/[id]/page.tsx` actually went

Three buckets, by my reading of the working tree (full diff in `/tmp/arcJ1-git-diff-cached.patch` from prior session):

1. **Cancel modal state + handlers** (~95 lines, ~lines 369-1014):
   - `cancelStep` enum + `invoiceDecisions` state shape (369-388)
   - `decisionableInvoices`, `isDecisionEligible`, `allDecisionsValid` derived helpers (1003-1028)
   - `advanceFromReason`, `advanceFromDecisions` step handlers (1030-1052)
   - `confirmCancelFromModal` rewritten to POST `/jobs/:id/cancel-with-financials` (1058-1117) — line 1087 is the orchestrator call.
   - `closeCancelModal` updated to reset all step state (1119-1126)

2. **3-step modal JSX** (~480 lines, ~lines 3500-3990 inside the existing `cancelModalOpen &&` JSX):
   - Step 1 (Reason) JSX
   - Step 2 (Decisions) JSX with per-invoice dropdown, eligibility filter, partial-payment hint (Lock-4 split for refund_credit vs keep_paid), running totals
   - Step 3 (Confirm) JSX with summary + Stripe-failure banner

3. **Inline kebab Cancel Job item** (~7 lines, lines 1501-1508):
   ```tsx
   {canCancel && (
     <button
       onClick={() => changeStatus("cancelled")}
       className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
     >
       <XCircle className="h-3.5 w-3.5" /> Cancel Job
     </button>
   )}
   ```
   gated on `const canCancel = transitions.includes("cancelled")` (line 1445).

**No trigger button in the page action row** (Send Invoice / Mark Complete / Add Note at lines 1874/1882/1898 are unchanged — they are constructive-action chips, not destructive ones).

### Where the +45 lines on `jobs/page.tsx` actually went

Single hunk inside the `statusFilter === "stale"` Cancel Selected button (lines 1304-1374). Pre-Arc-J.1 was a tight loop calling `api.patch('/jobs/:id/status')`. Arc J.1 expanded to per-job preflight with a count of skipped decision-required jobs (line 1340-1351) and a richer toast (line 1355-1362).

**The +45 lines did NOT add any per-row Cancel affordance to the lifecycle parent rows or expanded leg rows.** That is the jobs-list wire-up gap.

### `feature-registry.ts` (+21 lines)

Added 17 new keys for the 3-step modal: `cancel_job_step_label_*`, `cancel_job_decision_*`, `cancel_job_decision_disabled_*`, `cancel_job_keep_paid_reason_*`, `cancel_job_totals_*`, `cancel_job_continue`, `cancel_job_back`, `cancel_job_partial_voided_hint_refund_credit`, `cancel_job_partial_voided_hint_keep_paid`, `cancel_job_stripe_failure_banner`. Inline at lines ~824-840 in the registry. No structural changes.

### Other web files modified by 5d6486e

None beyond the four above.

### Summary of divergence

The commit faithfully wired the **modal** and the **per-page state**. It expanded the **dispatch QuickView body cancel button** with a preflight, but missed the `?cancel=1` query param that would auto-open the modal at the destination. It expanded the **jobs-list bulk cancel** (stale view only). **It did NOT add a per-row Cancel affordance to the default Rental Lifecycles view.** If Anthony was testing on a non-terminal job and saw no Cancel item in the kebab, that is unexplained by the diff alone — see § 5 for the gating story.

---

## § Deliverable 3 — Dispatch QuickView component ownership

**Two-layer architecture** (a finding that wasn't obvious from the prompt):

### Layer 1 — generic shell

**Filepath:** `web/src/components/quick-view.tsx` (107 lines).
**Props:** `isOpen`, `onClose`, `title`, `subtitle?`, `actions?: ReactNode`, `footer?: ReactNode`, `children: ReactNode`, `featureId?`.
**Renders:** absolutely-positioned fixed slide-in panel with header (title + actions), body (children), footer. NO buttons. NO knowledge of jobs.
**Last 3 commits touching this file:** `410df9d` (featureId prop), `dde8982` (theme tokens), `b644496` (initial creation). **NOT touched by 5d6486e.**

### Layer 2 — dispatch-specific consumer (the actual cancel button host)

**Filepath:** `web/src/app/(dashboard)/dispatch/page.tsx`.
**`<QuickView>` render site:** `dispatch/page.tsx:1393-1428`.

**Footer JSX (lines 1398-1421):**
```tsx
footer={quickViewJob ? (
  <div className="flex flex-col gap-2">
    <div className="flex gap-2">
      {quickViewJob.customer?.phone && <a href={`tel:${...}`} ...>Call</a>}
      {quickViewJob.service_address && <button onClick={... google maps ...}>Navigate</button>}
    </div>
    {/* Phase-1 override scope — admin/owner only. Routes to
        Job Detail with ?override=1 so the existing Override
        Status modal auto-opens, keeping a single modal owner
        and avoiding duplication into dispatch. */}
    {canOverrideStatus && (
      <Link href={`/jobs/${quickViewJob.id}?override=1`} ...>Override Status</Link>
    )}
  </div>
) : undefined}
```

**The footer has NO Cancel Job button.** The cancel button Anthony observed is rendered as the QuickView **body content** via `<QVContent>` (line 1424).

**`QVContent` cancel button click handler:** `dispatch/page.tsx:2908-2944` (quoted in full in § Deliverable 2). The function declaration of `QVContent` itself is at line 2495.

**Last 3 commits touching `dispatch/page.tsx`:**
```
5d6486e fix(jobs): add cancellation financial reconciliation flow (Arc J.1)
1a91054 fix(invoices): rewrite sendInvoice for Constraint 2 compliance
6c9f8b1 fix(jobs): override default target uses deriveDisplayStatus
```

**Confirmed: `dispatch/page.tsx` WAS modified in 5d6486e, but the QuickView footer JSX was untouched** — the +44 lines went into the existing `QVContent` Cancel button at line 2908-2944. **The footer's Override Status link (line 1411-1418) is the existing `?<param>=1` precedent we should mirror for `?cancel=1`.**

**Imports of new cancel modal/DTO from `dispatch/page.tsx`:** None. The dispatch page does not import any cancel-modal component (because the modal is inline inside `jobs/[id]/page.tsx`, not extracted — see § 4).

---

## § Deliverable 4 — New 3-step modal exportability

**Defined inline inside `jobs/[id]/page.tsx`** as JSX — NOT extracted into its own file or component.

**JSX location:** `jobs/[id]/page.tsx:3500-3990` (approximate; full extent of the `cancelModalOpen && (...)` block based on prior diff review). The modal renders unconditionally on every render of `JobDetailPageContent` (the page's main component) when `cancelModalOpen === true`.

**Closures the modal depends on (cannot be lifted into a different page without these):**

| Symbol | Source | Type |
|---|---|---|
| `cancelModalOpen` | `useState(false)` at line 379 | bool |
| `cancelContext` | `useState<CancellationContext \| null>` at line 380 | data |
| `cancelContextLoading` | `useState(false)` at line 382 | bool |
| `cancelReason` | `useState("")` at line 383 | str |
| `cancelStep` | `useState<CancelStep>("reason")` at line 384 | enum |
| `invoiceDecisions` | `useState<Record<...>>` at line 385 | record |
| `stripeFailureCount` | `useState<number>(0)` at line 388 | int |
| `decisionableInvoices` | derived from `cancelContext` at line 1006 | array |
| `isDecisionEligible` | inline closure at line 1014 | function |
| `allDecisionsValid` | derived at line 1022 | bool |
| `advanceFromReason` | function at line 1030 | handler |
| `advanceFromDecisions` | function at line 1054 | handler |
| `confirmCancelFromModal` | function at line 1058 — does the orchestrator POST | handler |
| `closeCancelModal` | function at line 1119 | handler |
| `cancelWithReasonFallback` | function at line 948 — used by `openCancelModal` on context-fetch failure | handler |
| `openCancelModal` | function at line 971 — fetches `/cancellation-context`, sets state, opens modal | handler |
| `actionLoading`, `setActionLoading` | shared with the broader page | bool |
| `id` | route param `useParams().id` | str |
| `api` (network client), `toast`, `fetchJob`, `setLifecyclePanelRefresh` | shared | various |
| `FEATURE_REGISTRY` import | shared | data |

**Extraction effort estimate:** A clean extraction would be ~700 LOC of work (the modal + its fetch + state + helpers, refactored into a `<CancelJobModal>` component with a controlled `isOpen` prop, an `onClose` callback, an `onCancelled` callback, a `jobId` prop, and a `tenantHints?: { isOfficeRole: boolean }` prop). NOT a hot-fix scope. **Phase 1 should NOT extract** — instead, route the dispatch QuickView and the jobs-list lifecycle rows through the existing inline modal via the `?cancel=1` URL trigger pattern (proven by the existing `?override=1` consumer at line 510-523).

**Modal open-state contract:** Self-managed via the page's internal `cancelModalOpen` state. There is no controlled `isOpen` prop — the modal cannot be opened from outside the page directly. **This forces the URL-trigger pattern.**

**Modal data fetch:** `openCancelModal` (line 971) fetches `GET /jobs/:id/cancellation-context` to populate `cancelContext`. Step 2 derives `decisionableInvoices` from `cancelContext.invoices`. Modal does NOT accept invoices as props; it self-fetches. **Good consequence:** if Phase 1 wires `?cancel=1` to call `openCancelModal()` on mount, the fetch + state population is automatic and identical to the manual-click path.

---

## § Deliverable 5 — Job-detail kebab menu component

### Component used

**Shared `<Dropdown>`** imported as `import Dropdown from "@/components/dropdown";` (line 33 of jobs/[id]/page.tsx). Same Dropdown used by dispatch's Create Run, etc. The kebab in jobs/[id] renders at line 1408-1518.

### Trigger JSX

```tsx
<Dropdown
  trigger={<button className="rounded-full border ... p-2 ..."><MoreHorizontal className="h-4 w-4" /></button>}
  align="right"
>
  ...children menu items...
</Dropdown>
```

### Existing menu items (full block at lines 1427-1517)

```tsx
{job.job_type === "driver_task" ? (
  <button onClick={deleteTask} className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
    <Trash2 className="h-3.5 w-3.5" />
    {FEATURE_REGISTRY.driver_task_delete_action?.label ?? "Delete Task"}
  </button>
) : (() => {
  const canOverride = isOfficeRole;                                          // owner|admin only
  const canSchedule = job.status === "completed" && (job.job_type === "delivery" || job.job_type === "drop_off");
  const hasLifecycleGroup = canOverride || canSchedule;
  const canCancel = transitions.includes("cancelled");                       // ← THE GATE
  return (
    <>
      {/* Lifecycle / scheduling group */}
      {canOverride && (
        <button onClick={() => { setOverrideTarget(...); setOverrideOpen(true); }} ...>
          <AlertTriangle ... /> Override Status
        </button>
      )}
      {canSchedule && (<>
        ...Schedule Pickup, Schedule Exchange, Schedule Dump & Return...
      </>)}

      {/* Destructive group */}
      {hasLifecycleGroup && (<div className="my-1 border-t ..." />)}
      {canCancel && (
        <button onClick={() => changeStatus("cancelled")} className="... text-[var(--t-error)] ...">
          <XCircle className="h-3.5 w-3.5" /> Cancel Job
        </button>
      )}
      <button onClick={deleteJob} className="... text-[var(--t-error)] ...">
        <Trash2 className="h-3.5 w-3.5" /> Delete Job
      </button>
    </>
  );
})()}
```

### Gating story

| Item | Gate | Falsy when |
|---|---|---|
| Override Status | `canOverride = isOfficeRole` | Driver / dispatcher / unauthenticated viewer |
| Schedule Pickup/Exchange/Dump | `canSchedule = job.status === "completed" && job_type ∈ {delivery, drop_off}` | Most lifecycle states |
| Cancel Job | `canCancel = transitions.includes("cancelled")` from `VALID_TRANSITIONS[job.status]` | `completed`, `cancelled`, `failed`, `needs_reschedule` (not in the table at lines 216-223) |
| Delete Job | **None** — always renders | Never (always rendered) |

**The exact set Anthony observed (Override Status + Delete Job, no Cancel Job)** is consistent with a job in status `completed`, `cancelled`, `failed`, or `needs_reschedule`. **Ask Anthony what status the test job was in.**

### Smallest patch to add Cancel Job for terminal states

If Anthony's intent is that a terminal-status job should still be cancellable (unusual; usually a no-op), the patch is to widen `VALID_TRANSITIONS` to include `cancelled` for the relevant terminal states OR replace the gate with a separate `canCancelEvenIfTerminal` predicate. **Defer to product decision — not a mechanical fix.**

If Anthony's intent is that the existing gate is correct, no patch is needed for the kebab — the jobs-list and dispatch entry points are still real bugs.

---

## § Deliverable 6 — URL trigger pattern feasibility

### Existing precedent (proven, working in production)

`?override=1` is consumed by `jobs/[id]/page.tsx:510-523`:

```tsx
// Phase-1 override scope — dispatch board's QuickView navigates
// here with ?override=1 to open the override modal in-place. Runs
// once when both (a) the job has loaded, (b) the role is known
// and is office, and (c) the query param is truthy. Uses ref-ish
// state (`overrideAutoOpened`) to prevent re-firing on re-renders.
const [overrideAutoOpened, setOverrideAutoOpened] = useState(false);
useEffect(() => {
  if (overrideAutoOpened) return;
  if (!job || !isOfficeRole) return;
  if (searchParams.get("override") !== "1") return;
  setOverrideTarget(defaultOverrideTarget(job.status));
  setOverrideReason("");
  setOverrideOpen(true);
  setOverrideAutoOpened(true);
}, [job, isOfficeRole, searchParams, overrideAutoOpened]);
```

`useSearchParams` is imported at line 5 and consumed at line 363. `useRouter` at line 5. Reusing both costs zero new imports.

A **second `?postCreate=1` consumer** at line 937 confirms the pattern is already used in two places in this same file:

```tsx
if (searchParams.get("postCreate") === "1") {
  setIsPostCreate(true);
  router.replace(`/jobs/${id}`, { scroll: false });
}
```

**The `router.replace` after triggering is the URL-cleanup idiom** — drops the param so refreshing or back-button doesn't re-fire.

### Recommended `?cancel=1` consumer (proposed for Phase 1, not implemented)

```tsx
const [cancelAutoOpened, setCancelAutoOpened] = useState(false);
useEffect(() => {
  if (cancelAutoOpened) return;
  if (!job || !isOfficeRole) return;            // RBAC at UI layer (cf. Deliverable 8)
  if (searchParams.get("cancel") !== "1") return;
  openCancelModal();
  setCancelAutoOpened(true);
  router.replace(`/jobs/${id}`, { scroll: false });
}, [job, isOfficeRole, searchParams, cancelAutoOpened]);
```

**Sibling change in `dispatch/page.tsx:2935`** — `window.location.href = /jobs/${job.id}?cancel=1`. Use `router.push` instead of `window.location.href` to avoid full page reload (matches the pattern used by the Override Status `<Link>` at line 1412).

**Estimated total wire-up LOC:** 12 lines on jobs/[id]/page.tsx + 2 lines on dispatch/page.tsx (single character additions to URL string + import switch from window.location to router.push).

---

## § Deliverable 7 — Jobs list / Rental Lifecycles surface

### Confirmed file + render

**Filepath:** `web/src/app/(dashboard)/jobs/page.tsx` (1691 lines).
**Page title rendered:** `FEATURE_REGISTRY.lifecycle_dashboard?.label ?? "Rental Lifecycles"` at line 649.
**Component name:** `JobsPageContent` at line 249.

### Existing row-level actions

**Lifecycle parent row** (line 1037-1122 inside `filteredChains.map`):
- Columns: chevron-toggle (line 1048-1052), Size, Customer, Address, Delivered, Pickup, Tasks, Status badge + arrow drill-through button (line 1095-1119).
- Status cell action is `router.push(/jobs/:repJobId)` — navigates to the chain's representative job. **No kebab. No checkbox. No Cancel.**
- Click on the row body (line 1039 `onClick={() => toggleChain(chain.id)}`) toggles the expansion.

**Expanded leg row** (line 1130-1170 inside `orderedLinks.map`):
- Columns: empty cell, task-type label + job number, asset_subtype, scheduled_date, empty, status text.
- Click on row navigates to `/jobs/:childJobId` (line 1133).
- **No kebab. No checkbox. No per-leg actions.**

### Smallest viable injection point

Two options ranked by complexity:

**Option A — kebab on parent row (row-level cancel = chain-level "cancel all legs"):**
Add a `<Dropdown>` next to the existing arrow button at line 1095-1119 with a single "Cancel Job" item that does the dispatch-style preflight (`/cancellation-context` on `repJobId`) → either redirect with `?cancel=1` or fire legacy PATCH. **~25 LOC.** Semantic: cancels the chain's representative job, not all legs.

**Option B — kebab on each expanded leg row (leg-level cancel):**
Add a `<Dropdown>` to leg rows at line 1131-1170, in a new trailing cell. **~35 LOC.** Semantic: precise per-leg cancel. Matches operator mental model better but adds a column / changes table layout.

**Recommended for Phase 1:** Option B. Per-leg cancel is the operator's actual mental model (kebab on the specific delivery / pickup / exchange leg they want to cancel). Option A's chain-level cancel is muddier (does it cancel all legs? Just the rep? What if the rep is already completed?).

### Existing bulk-select infrastructure to lift

The bulk-cancel UI at `jobs/page.tsx:1304-1374` ships with selection state (`selectedJobIds`, `setBulkProgress`) but the **selection mechanism is invisible on the lifecycle view** — the table has no checkbox cells. Bulk select is presumably wired through the `statusFilter === "stale"` flat-list rendering, not the lifecycle view. **Lifting bulk-select into the lifecycle view requires its own design discussion (chain-level vs leg-level selection, mixed selection across both, interaction with chain expansion); do not bundle into this hot-fix.**

---

## § Deliverable 8 — RBAC and security posture

### Backend gate (orchestrator endpoint)

`api/src/modules/jobs/jobs.controller.ts:300-302`:
```ts
@Post(':id/cancel-with-financials')
@UseGuards(RolesGuard)
@Roles('owner', 'admin')
```
**Enforced server-side. Tenant scoping via `@TenantId() tenantId` from JWT (line 308) — never from client payload.** A driver / dispatcher / viewer hitting the endpoint receives 403 from `RolesGuard`.

### Other related endpoint gates (sanity check)

| Endpoint | Roles |
|---|---|
| `POST /jobs/:id/cancel-with-financials` | `owner`, `admin` (this audit's target) |
| `DELETE /jobs/:id` (cascadeDelete) | `admin`, `owner` (line 366-368 of controller — checked via the existing legacy delete-task path) |
| `PATCH /jobs/:id/status` (legacy cancel-via-status) | NO `@Roles` decorator — open to any authenticated tenant user |

### Gating per UI surface

| Surface | Currently gated client-side? | Server-enforced? |
|---|---|---|
| Job-detail kebab Override Status | `isOfficeRole` (owner|admin) — line 1440 | YES — server-side override audit branch in `changeStatus` |
| Job-detail kebab Cancel Job | NOT explicitly gated by role — `canCancel = transitions.includes("cancelled")` is status-only | Mixed — calls `openCancelModal` → orchestrator POST is 403 for non-owner/admin; fallback `cancelWithReasonFallback` calls the open `PATCH /jobs/:id/status` which has no role gate |
| Job-detail kebab Delete Job | NOT gated client-side | YES — `DELETE /jobs/:id` requires owner|admin |
| Dispatch QuickView footer Override Status `<Link>` | `canOverrideStatus` (line 1410) | Same as above |
| Dispatch QuickView body Cancel Job (QVContent line 2908) | NOT gated | Mixed — orchestrator path is 403-protected; legacy PATCH path is open |
| Jobs-list bulk Cancel Selected | NOT gated | Mixed — same |

### What happens if a driver or viewer accidentally clicks Cancel Job

The button currently routes through `changeStatus("cancelled")` → `openCancelModal()` → fetches `/cancellation-context` (no role gate) → renders the modal → submit calls `POST /jobs/:id/cancel-with-financials`. **`RolesGuard` returns 403 with `RolesGuard` exception body.** The modal stays open showing a `Failed to cancel` toast (per `confirmCancelFromModal` catch handler at line 1108-1115).

**This is a degraded UX (visible button → confusing 403)**, but **not a security hole** — the orchestrator is the source of truth.

The legacy `cancelWithReasonFallback` at line 948 hits `PATCH /jobs/:id/status` which has no role gate — a driver/dispatcher COULD currently cancel via that path. Note this is an existing gap, NOT introduced by Arc J.1; flagged here for completeness.

### Recommended UX for Phase 1

**Hide the Cancel Job UI element for non-`isOfficeRole` users.** Matches the `Override Status` precedent and avoids the visible-button-→-403 dead end. Concrete change to `jobs/[id]/page.tsx:1445`:

```ts
const canCancel = isOfficeRole && transitions.includes("cancelled");
```

Same gate (`isOfficeRole`) applied to:
- Dispatch QuickView body Cancel Job (`QVContent` already has `creditState` and `board` in scope; needs to thread `isOfficeRole` or its equivalent — currently QVContent does NOT receive a role prop and the dispatch page derives `canOverrideStatus` at component scope from `currentUserRole` at line 315-318. Pass `canOverrideStatus` (or rename to `canCancelOrOverride`) into QVContent.)
- Jobs-list lifecycle row kebab (Phase 1 new)

### Other security considerations

1. **Confirmation:** The modal already requires reason text + step navigation. The dispatch QuickView body cancel button uses `window.confirm("Cancel this job?")` — this is the only "destructive double-tap" guard in the dispatch flow and should be preserved (or replaced with a richer confirm panel) for Phase 1.
2. **Audit ID surfacing:** The orchestrator returns no audit row IDs in its response. Not surfaced to UI today. Defer; not a Phase 1 concern.
3. **Rate limiting:** Deferred to Arc J.4 per controller comment at lines 295-298.
4. **Tenant scoping:** Confirmed Phase 1 will continue to scope by `@TenantId() tenantId` from JWT — no client payload changes. Verified at `jobs.controller.ts:308`.

---

## § Deliverable 9 — `cancelWithReasonFallback` path

### Location + body

`web/src/app/(dashboard)/jobs/[id]/page.tsx:948-965`:

```tsx
// Phase 2 — pre-modal existing behavior, preserved as the fallback
// path when the cancellation-context fetch fails. Kept byte-for-byte
// equivalent to the pre-Phase-2 flow so a backend outage on the new
// read-only endpoint never blocks an operator from cancelling.
const cancelWithReasonFallback = async () => {
  const reason = prompt("Cancellation reason:");
  if (!reason) return;
  setActionLoading(true);
  try {
    await api.patch(`/jobs/${id}/status`, {
      status: "cancelled",
      cancellationReason: reason,
    });
    toast("success", "Job cancelled");
    await fetchJob();
    setLifecyclePanelRefresh((n) => n + 1);
  } catch {
    toast("error", "Failed to update");
  } finally {
    setActionLoading(false);
  }
};
```

### Trigger

Reachable ONLY from `openCancelModal` at line 988 and 996, fired when:
1. The `/cancellation-context` GET returns a malformed shape (line 987: `!ctx || ... !Array.isArray(ctx.jobs)`)
2. The `/cancellation-context` GET throws (line 993 catch block)

**Not directly callable from any UI button.** Pure fail-safe behind the kebab Cancel Job → `changeStatus("cancelled")` → `openCancelModal` chain.

### Routing target

`PATCH /jobs/:id/status` with `{ status: "cancelled", cancellationReason }` — **legacy endpoint, NOT the orchestrator. Bypasses the financial decision flow entirely.** No role gate on the server.

### Recommendation for Phase 1

**Leave alone.** It's a 17-line escape hatch that fires only when the network preview fails — exactly the scenario where forcing a 3-step modal would block the operator. The financial-decision orchestrator is unreachable in this case anyway (the preview endpoint is the same backend), so degrading to legacy PATCH is the right behavior.

Phase 1 scope: do NOT migrate this fallback. It will go away naturally when the legacy `PATCH /jobs/:id/status` cancel-via-status path is removed in Arc J.3.

---

## § Deliverable 10 — Diagnosis and recommended hot-fix scope

### Root cause

**Two distinct bugs + one product question:**

1. **Dispatch QuickView body Cancel Job button (`dispatch/page.tsx:2908-2949`):** the preflight + redirect logic is correct in shape, but `window.location.href = /jobs/${job.id}` (line 2935) drops the `?cancel=1` (or equivalent) query param that the destination page would need to auto-open the modal. Compounding this: the `/cancellation-context` summary almost certainly returns `hasUnpaidInvoices === true` for any active rental delivery (which has at least one open invoice), so the "zero-balance fast path" at line 2938 is unreachable in practice — meaning the redirect path is the ONLY path, and that path doesn't auto-open. **Result: every dispatch cancel click drops the operator on the job-detail page with no visible cancellation flow.**

2. **Jobs-list Rental Lifecycles per-row Cancel (`jobs/page.tsx:984-1182`):** simply does not exist. Lifecycle parent rows have a single drill-through arrow icon; expanded leg rows have only display text. No kebab, no per-row action menu, no per-leg cancel affordance. The bulk Cancel Selected exists at line 1304-1374 but is gated on the stale-filter view, which uses a different flat-list rendering not on the default Lifecycle view. **Result: no cancel entry point on the default page rendering.**

3. **Job-detail kebab Cancel Job (`jobs/[id]/page.tsx:1501-1508`):** is gated on `transitions.includes("cancelled")` from `VALID_TRANSITIONS[job.status]` (line 216-223). For `completed`, `cancelled`, `failed`, `needs_reschedule` this evaluates false — **by design.** If Anthony tested on a non-terminal job and saw no Cancel item, this is an unexplained bug; if on a terminal job, the gate is correct and Override Status + Delete Job is the right menu. **Cannot be diagnosed without knowing the job status under test.**

### Recommended Phase 1 scope

**Single prompt, six file changes, ~70-100 LOC.**

| File | Change | Est. LOC |
|---|---|---|
| `web/src/app/(dashboard)/jobs/[id]/page.tsx` | Add `?cancel=1` consumer effect (~12 LOC mirroring `?override=1` at line 510-523). Add `isOfficeRole` to the `canCancel` gate (~1 LOC). Optionally widen `VALID_TRANSITIONS` if Anthony confirms the kebab gating is wrong. | 13-30 |
| `web/src/app/(dashboard)/dispatch/page.tsx` | Change `window.location.href = /jobs/${job.id}` (line 2935) to `router.push(/jobs/${job.id}?cancel=1)`. Pass `canOverrideStatus` (or rename to `canCancelOrOverride`) into `QVContent` to gate the body Cancel Job button. Hide the QVContent Cancel Job button for non-`isOfficeRole`. | ~10 |
| `web/src/app/(dashboard)/jobs/page.tsx` | Add a `<Dropdown>` kebab to each expanded leg row at line 1130-1170 with a Cancel Job item that navigates to `/jobs/${childJobId}?cancel=1` (preflight optional but recommended for symmetry with dispatch — possibly skip preflight and let the modal page handle it). | ~30 |
| `web/src/lib/feature-registry.ts` | Add 1-2 new keys for "Cancel Job" leg-row kebab tooltips if needed. | ~3 |

**Total estimate:** ~70 LOC plus 1-2 registry keys. Plus 0-15 LOC depending on Anthony's answer on the `VALID_TRANSITIONS` widen question.

### Sequencing recommendation

**Single Phase 1 prompt.** All three entry-point fixes share the same destination (the existing inline modal via `?cancel=1`) and the same RBAC gate (`isOfficeRole`). Splitting would re-pay context-switch cost twice for what is fundamentally one wire-up.

### Risk callouts

1. **`?override=1` precedent uses `<Link>`** in dispatch QuickView footer (full-page-like nav) but `useEffect` consumer on the destination. Phase 1 dispatch QVContent should switch from `window.location.href` to `router.push` — cleaner SPA navigation, faster, preserves state. Verify `useRouter` is in scope inside `QVContent` (function definition at line 2495) — it's NOT today; it's used at the page top level. **Need to import / pass router or use a `<Link>` instead of `<button onClick>`.** This is the one non-trivial consideration; probably easiest to construct the destination URL in the click handler and call `window.location.href = ...?cancel=1` (preserving the existing pattern, just with the param appended). **No state restoration concerns** because the modal self-fetches its data on open.

2. **Modal extraction is NOT scoped.** Phase 1 reuses the inline modal via URL trigger only. If Anthony later wants the modal to open in-place from the dispatch slide-out (no navigation), that's a Phase 2 modal-extraction arc estimated at ~700 LOC. **Do not bundle.**

3. **`statusFilter === "stale"` bulk-cancel rendering** (`jobs/page.tsx:1304-1374`) is unread by this audit. If lifecycle-view per-leg cancel is added, the stale-view bulk-cancel path stays untouched. **Verify stale view continues to function** in smoke; do not refactor.

4. **`cancelWithReasonFallback` legacy path** stays as-is. **Do not migrate.** Removing it is Arc J.3 cleanup.

5. **Job-detail kebab gate question.** If Anthony wants Cancel Job available on terminal jobs (e.g. "I clicked into a `completed` job to fix its mistakenly-marked-complete status, then realized it should have been cancelled"), widen `VALID_TRANSITIONS` to include `cancelled` for those statuses. If not, no change needed. **Block on Anthony's answer.**

### Smoke plan (post-Phase-1)

Minimum 5-step smoke against deployed Phase 1, **without** re-running the full Arc J.1 J-suite:

1. **Dispatch reroute:** open `/dispatch`, click any active rental delivery tile, click Cancel Job in the QuickView body. Confirm `window.confirm` fires, OK redirects to `/jobs/[id]?cancel=1`, and the 3-step modal auto-opens with linked invoices populated. Cancel out — verify no PATCH was issued (network tab).
2. **Job-detail kebab:** on a `confirmed` job (non-terminal), click the kebab → confirm Cancel Job is visible between Override Status and Delete Job → click → modal opens. Submit → confirm POST `/jobs/:id/cancel-with-financials` returns 200.
3. **Job-detail kebab on terminal job:** on a `completed` job, click the kebab → confirm Cancel Job is HIDDEN. (Or visible if Anthony chose to widen the gate.)
4. **Lifecycle leg-row kebab:** on `/jobs`, expand a chain row, hover a delivery leg → click new kebab → confirm Cancel Job item visible → click → navigates to leg's job-detail page with `?cancel=1` and modal auto-opens.
5. **RBAC:** as a non-office user (driver or dispatcher), confirm the Cancel Job items are HIDDEN from the kebab and from the QuickView body. As an attacker, attempt to call `POST /jobs/:id/cancel-with-financials` directly — confirm 403.

**Do not** re-run the J-suite jest tests — orchestrator is unchanged. Do not re-verify modal step transitions, decision eligibility, or partial-payment handling — all locked by the existing test suite.

---

**End of Phase 0 audit. Halting for review.**

No file modifications were made. No commits. No deploys. Working tree matches HEAD (5d6486e).

**Open question for Anthony before Phase 1:** What status was the test job in when you observed "Menu contains only Override Status and Delete Job. No Cancel Job item"? Answer determines whether Phase 1 includes a `VALID_TRANSITIONS` widen (~15 LOC) or just hides the button for non-`isOfficeRole`.
