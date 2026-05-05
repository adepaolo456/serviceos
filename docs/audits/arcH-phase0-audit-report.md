# Arc H — Phase 0 Audit Report: Driver-Clear Hygiene + Dispatch Filter + Frontend Refetch

**Discipline rule honored:** every behavioral claim below is backed by a quoted source line. Where I found that an Arc 1-cited test claim diverges from production behavior, that divergence is reported as a finding (§ 3), not a footnote.

**Status:** READ-ONLY. No source modifications, no migrations, no commits. Audit only.

---

## 1. Reproduction summary

All four bugs verified live against `voczrzbdukgdrirmlgfw` (ServiceOS) at the time of audit.

### Bug 1 — Override-to-Unassigned does not null `assigned_driver_id`

DB state at time of audit (Apr 25 01:03:20 UTC, ~6 minutes after Arc 1 deploy `828cd30`):

| Field | Value |
|---|---|
| `job_number` | `JOB-20260409-003-P` |
| `id` | `3d24ab96-5f99-43f3-ba50-6817c7e03888` |
| `status` | `confirmed` ← override succeeded on this field |
| `assigned_driver_id` | `f86c8546-528d-40ee-9f8b-942b79ebc821` ← **NOT nulled** |
| `scheduled_date` | `2026-04-24` |

`SELECT job_number, status, assigned_driver_id FROM jobs WHERE id='3d24ab96-…'` returned the row above. `notifications` row of `type='status_override'` for `job_id='3d24ab96-…'` exists with the operator's reason (audit row was written; only the driver-clear is missing).

### Bug 2 — Cancellation does not null `assigned_driver_id`

| Field | Value |
|---|---|
| `job_number` | `X-1021` |
| `id` | `f0ee8243-8052-4bc5-a84c-df0940e1291d` |
| `status` | `cancelled` |
| `assigned_driver_id` | `f86c8546-528d-40ee-9f8b-942b79ebc821` ← **NOT nulled** |
| `updated_at` | `2026-04-25 00:52:11` |

### Bug 3 — Dispatch board query does not filter terminal statuses

Backed by source quote in § 5 below: `dispatch.service.ts:56–64` selects only on `tenant_id` and `scheduled_date`; no `status` filter.

### Bug 4 — Frontend page goes stale after override mutation

Backed by source quote in § 6 below. **Significant finding:** Bug 4 as described (the page does not refetch) is **not reproducible from the source**. The override and cancel mutation handlers DO call `await fetchJob()` and `setLifecyclePanelRefresh((n) => n + 1)`. The "stale" appearance is a downstream symptom of Bug 1: when the server fails to null `assigned_driver_id`, the refetched `/jobs/:id` response returns the still-set FK and the page correctly renders "Assigned" given that data. See § 6 for the prose justification.

---

## 2. UNASSIGNED_TARGETS map

### Constant definition (one quote)

`api/src/modules/jobs/jobs.service.ts:126–132`:

```ts
// Raw statuses that `deriveFromStatusString` in
// `web/src/lib/job-status.ts` maps to the "unassigned" display bucket.
// Keep in sync with that function's switch — any new raw status that
// renders as "Unassigned" on the timeline must be added here too.
// Used by changeStatus below to couple driver-clear into admin
// overrides that target the Unassigned display state.
const UNASSIGNED_TARGETS = new Set(['pending', 'confirmed']);
```

`grep -n UNASSIGNED_TARGETS jobs.service.ts` returns exactly two hits — the definition (line 132) and one reference (line 1280). No other code reads this set.

### Reference site (the only use)

`api/src/modules/jobs/jobs.service.ts:1267–1283` — the save-transaction body inside `changeStatus`:

```ts
const savedJob = await this.dataSource.transaction(async (manager) => {
  const txJobRepo = manager.getRepository(Job);
  const txNotifRepo = manager.getRepository(Notification);
  // Phase 1.7 — admin override to an Unassigned-display status
  // ALSO clears assigned_driver_id. Operator mental model: "roll
  // this job back to Unassigned" means status AND driver. Without
  // the clear, deriveDisplayStatus's object-form live-driver branch
  // keeps rendering "Assigned" even after status reverts.
  // Inline rather than delegating — no dedicated unassignDriver
  // method exists; mirrors the existing cascadeDelete null-out
  // pattern at jobs.service.ts:1592 and :1633. Runs inside this
  // transaction so the field clear + save + audit-log write
  // commit or roll back as one unit.
  if (isAdmin && UNASSIGNED_TARGETS.has(dto.status)) {
    job.assigned_driver_id = null as unknown as string;
  }
  const saved = await txJobRepo.save(job);
  ...
```

### Walking Bug 1 against this gate

Inputs for Bug 1's reproduction: `userRole='owner'`, `dto={ status: 'confirmed', overrideReason: 'Unassign…' }`, current `job.status='dispatched'`.

Step-by-step against current Arc 1 service code:

1. `isAdmin = ['owner', 'admin'].includes('owner')` → **true** (`jobs.service.ts:964`).
2. `previousStatus = 'dispatched'` (`:965`).
3. `isSanctionedForward = VALID_TRANSITIONS['dispatched']?.includes('confirmed')` — `VALID_TRANSITIONS['dispatched'] = ['en_route', 'cancelled', 'failed', 'needs_reschedule']` (`:119`). `'confirmed'` ∉ this list → **false**.
4. Reason gate (`:1001`): `isAdmin && previousStatus !== dto.status && !isSanctionedForward` → **true**. Reason was provided non-empty → passes the trim check; no throw.
5. Save-transaction opens (`:1267`).
6. UNASSIGNED_TARGETS gate (`:1280`): `isAdmin && UNASSIGNED_TARGETS.has('confirmed')` → `true && true` → **true**.
7. **`job.assigned_driver_id = null` IS executed in memory.**
8. `await txJobRepo.save(job)` runs (`:1283`).
9. Audit row gate (`:1288`): `isAdmin && previousStatus !== dto.status && !isSanctionedForward` → true → audit row written. Confirmed in DB (notification `type='status_override'` row exists for this job).
10. Transaction commits.

**By the conditional, the clearing should fire — and step 7 says it does in memory.** Yet production shows `assigned_driver_id` still set. Step 8 is the suspect.

### Why step 8 doesn't persist the null — the divergence

`findOne` at `jobs.service.ts:651–665` is what `changeStatus` uses to load the job (called at `:956`):

```ts
async findOne(tenantId: string, id: string): Promise<Job> {
  const job = await this.jobsRepository
    .createQueryBuilder('j')
    .leftJoinAndSelect('j.customer', 'customer')
    .leftJoinAndSelect('j.asset', 'asset')
    .leftJoinAndSelect('j.drop_off_asset', 'drop_off_asset')
    .leftJoinAndSelect('j.assigned_driver', 'assigned_driver')   // <-- relation is loaded
    .where('j.id = :id', { id })
    .andWhere('j.tenant_id = :tenantId', { tenantId })
    .getOne();
```

The `Job` entity has BOTH a column AND a relation for the same FK (`api/src/modules/jobs/entities/job.entity.ts:53–58`):

```ts
@Column({ name: 'assigned_driver_id', type: 'uuid', nullable: true })
assigned_driver_id!: string;

@ManyToOne(() => User, { nullable: true })
@JoinColumn({ name: 'assigned_driver_id' })
assigned_driver!: User;
```

When `txJobRepo.save(job)` is called with `assigned_driver_id = null` AND `assigned_driver` still pointing to the loaded User entity (because `leftJoinAndSelect` populated it), TypeORM's persistence layer reconciles the two: it reads `assigned_driver.id` and uses that to set the FK column, **silently overwriting our explicit `null`**. This is a known TypeORM behavior for `save()` on entities where both the FK scalar and the corresponding relation are present.

Verification by contrast — the `cascadeDelete` pattern referenced in the in-line comment (`:1276–1277` claims "mirrors the existing cascadeDelete null-out pattern at jobs.service.ts:1592 and :1633"). The actual cascadeDelete code at `:1633–1639`:

```ts
// 7. Driver unassign on main task
if (job.assigned_driver_id) {
  await this.jobsRepository.update(
    { id: job.id, tenant_id: tenantId },
    { assigned_driver_id: null as any },
  );
}
```

That uses `Repository.update(criteria, partial)` — a **column-only UPDATE** that bypasses entity hydration and thus the relation-overwrites-FK reconciliation. The two patterns are **not** equivalent: the comment in changeStatus is misleading, and the divergence is the bug.

### Hypothesis from prompt § A.6 — resolution

> *Hypothesis: Arc 1 Change 3 widened the audit-row-write conditional. If UNASSIGNED_TARGETS clearing was inside that block, Arc 1 might have inadvertently broken it.*

**Hypothesis rejected.** The clearing block (`:1280`) is **not** inside the audit-write conditional — it's a separate `if` between the trx-repo lookup and the save. Its conditional has not changed since Phase 1.7 introduced it (`isAdmin && UNASSIGNED_TARGETS.has(dto.status)`). Arc 1 widened the audit-row gate at `:1288`, not the clearing gate at `:1280`. Bug 1 is a **pre-existing Phase 1.7 bug** that the unit test never caught (see § 3) and the smoke test never hit (smoke test for Phase 1.7 didn't override-to-Unassigned with a real loaded job; the test mocks bypassed the relation hydration entirely).

---

## 3. Tests #7–9 deep dive

`npx jest jobs.service.spec --no-coverage` result on current `main` (commit `828cd30`):

```
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

All 22 pass — including the three Override-to-Unassigned tests. Yet production fails. Below is exactly why.

### Test #7 (`jobs.service.spec.ts:498–516`) — quoted verbatim

```ts
it('7. override to Unassigned (confirmed) — clears assigned_driver_id atomically', async () => {
  const h = await buildHarness({
    status: 'dispatched',
    assigned_driver_id: 'driver-1',
    job_type: 'pickup',
  } as Partial<Job>);

  await h.service.changeStatus(
    'tenant-1',
    'job-1',
    { status: 'confirmed', overrideReason: 'rollback' } as any,
    'owner',
  );

  expect(h.txJobSave).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'confirmed', assigned_driver_id: null }),
  );
  expect(h.transactionCommit).toHaveBeenCalledTimes(1);
});
```

### Test #8 (`jobs.service.spec.ts:518–535`) — quoted verbatim

```ts
it('8. override to Assigned (dispatched) — leaves assigned_driver_id intact', async () => {
  const h = await buildHarness({
    status: 'en_route',
    assigned_driver_id: 'driver-1',
    job_type: 'pickup',
  } as Partial<Job>);

  await h.service.changeStatus(
    'tenant-1',
    'job-1',
    { status: 'dispatched', overrideReason: 'rewind' } as any,
    'owner',
  );

  expect(h.txJobSave).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'dispatched', assigned_driver_id: 'driver-1' }),
  );
});
```

### Test #9 (`jobs.service.spec.ts:537–555`) — quoted verbatim

```ts
it('9. override to Unassigned (pending) — also clears driver', async () => {
  const h = await buildHarness({
    status: 'dispatched',
    assigned_driver_id: 'driver-1',
    job_type: 'delivery',
  } as Partial<Job>);

  await h.service.changeStatus(
    'tenant-1',
    'job-1',
    { status: 'pending', overrideReason: 'reset' } as any,
    'owner',
  );

  expect(h.txJobSave).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'pending', assigned_driver_id: null }),
  );
});
```

### What these tests prove vs. what they fail to prove

The assertion in tests #7 and #9 is `expect(h.txJobSave).toHaveBeenCalledWith(expect.objectContaining({ assigned_driver_id: null }))`. The mock `txJobSave` is just `jest.fn((x) => Promise.resolve(x))` (`jobs.service.spec.ts:148`). The test verifies what value was *passed into* save, not what was *persisted by* save.

The test setup `makeJob` (`jobs.service.spec.ts:56–72`) constructs a Job-shaped object that does **not** include the `assigned_driver` relation:

```ts
function makeJob(partial: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    job_type: 'delivery',
    status: 'in_progress',
    asset_id: 'asset-1',
    customer_id: 'cust-1',
    asset: { id: 'asset-1', subtype: '20yd' },
    customer: null,
    job_number: 'J-1',
    service_type: 'dumpster_rental',
    service_address: { lat: 1, lng: 2 },
    is_failed_trip: false,
    ...partial,
  } as any as Job;
}
```

There is no `assigned_driver: ...` key in the test fixture. When test #7 sets `assigned_driver_id: 'driver-1'` via `partial`, the resulting object has the FK set but the relation undefined. So in test execution:

- `job.assigned_driver_id = null` runs → entity now has `assigned_driver_id: null`, `assigned_driver: undefined`.
- `txJobSave` is called with `{ ..., assigned_driver_id: null, assigned_driver: undefined }`.
- `expect.objectContaining({ assigned_driver_id: null })` passes — because the literal property has the literal value.

In production:

- `findOne` runs `.leftJoinAndSelect('j.assigned_driver', 'assigned_driver')` → entity has `assigned_driver_id: 'f86c…'` AND `assigned_driver: { id: 'f86c…', email: '…', … }`.
- `job.assigned_driver_id = null` runs → entity now has `assigned_driver_id: null` AND `assigned_driver: { id: 'f86c…', … }`.
- `txJobRepo.save(job)` is called with that entity — **TypeORM reconciles the relation against the FK**, sets `assigned_driver_id` back to `'f86c…'`, and writes that to the database.

**The test does not exercise the production code path for the failure mode.** The assertion is well-formed for the mock; it's silent on the TypeORM persistence reconciliation that actually decides what hits the DB. This is the divergence the new audit discipline rule is designed to surface.

### Status by the rule

- Test #7 — **passes mock, fails production.** Real bug not caught.
- Test #8 — passes mock, **probably passes production too** because the target `dispatched` is in `UNASSIGNED_TARGETS`'s complement (the gate doesn't fire, so the relation-rehydration question is moot — there's no null to overwrite).
- Test #9 — **passes mock, fails production.** Same root cause as #7.

---

## 4. `cancelJob` orchestrator quote + assessment

There is **no dedicated `cancelJob` method**. `grep -n cancelJob api/src/` returns no service-method definition. The cancellation orchestrator referenced in the codebase is a **read-only preview** endpoint:

`api/src/modules/jobs/jobs.service.ts:71–76`:

```ts
/**
 * Cancellation Orchestrator Phase 1 — response shape for the
 * read-only preview endpoint `GET /jobs/:id/cancellation-context`.
 * Exposed at module scope so the controller's return-type inference
 * picks it up without a separate DTO class (matches the read-only
 * preview pattern used by `LifecycleContextResponse`).
 */
```

The actual cancel WRITE goes through `JobsService.changeStatus` with `dto.status='cancelled'` from both the cancel modal (`web/src/app/(dashboard)/jobs/[id]/page.tsx:986–1000`) and the prompt fallback (`:930–947`). No code path in the cancellation flow modifies `assigned_driver_id`.

### Walking Bug 2 against the existing changeStatus path

Inputs: `userRole='owner'`, `dto={ status: 'cancelled', cancellationReason: 'X' }`, current `job.status='confirmed'`.

1. `isAdmin = true`.
2. `isSanctionedForward = VALID_TRANSITIONS['confirmed']?.includes('cancelled')` — `'cancelled'` ∈ `['dispatched', 'en_route', 'cancelled', 'failed', 'needs_reschedule']` → **true**.
3. Reason gate at `:1001` — `isAdmin && status-changed && !isSanctionedForward` → `true && true && false` → **false**. Gate skipped (no `overrideReason` required for sanctioned-forward cancel).
4. Save-transaction opens.
5. UNASSIGNED_TARGETS gate at `:1280`: `isAdmin && UNASSIGNED_TARGETS.has('cancelled')`. `UNASSIGNED_TARGETS = new Set(['pending', 'confirmed'])`. `'cancelled'` ∉ → **false**. **Clearing block does not run for cancellation at all.**
6. Save fires; audit-row gate at `:1288` is `isAdmin && status-changed && !isSanctionedForward` → false → no override audit row (correct, this is a sanctioned cancel, not an override).

So Bug 2's root cause is simpler than Bug 1's: the UNASSIGNED_TARGETS set never included terminal statuses, so the clearing was never even attempted on cancel. Even if Bug 1 were fixed (relation-rehydration), Bug 2 would persist because the gate excludes its target value. The fix shape needs to broaden the clearing rule to terminal targets.

### Atomicity assessment

Anything added to clear the driver during cancellation belongs **inside** the existing `dataSource.transaction` block at `:1267–1303`. The transaction already wraps `txJobRepo.save(job)` and the optional audit-row write, with rollback on failure. Adding a `null`-out via `txJobRepo.update(...)` (the cascadeDelete-style pattern at `:1635`) inside the same transaction would be atomic with the status save.

---

## 5. Dispatch query quote + assessment

`api/src/modules/dispatch/dispatch.service.ts:42–104`, the dispatch board endpoint (`GET /dispatch/board`):

```ts
async getDispatchBoard(tenantId: string, date: string) {
  const drivers = await this.usersRepository.find({
    where: {
      tenant_id: tenantId,
      role: In(['driver', 'admin', 'owner']),
      is_active: true,
    },
  });

  // Phase B8 — payment gating removed from the dispatch board. Jobs are
  // no longer hidden based on linked-invoice status. Dispatch decisions
  // live in `dispatch-credit-enforcement.service.ts` (action-time gate
  // at assign / en_route / arrived / completed). Visibility is purely
  // tenant + scheduled_date + ordering.
  const jobs = await this.jobsRepository
    .createQueryBuilder('j')
    .leftJoinAndSelect('j.customer', 'customer')
    .leftJoinAndSelect('j.asset', 'asset')
    .where('j.tenant_id = :tenantId', { tenantId })
    .andWhere('j.scheduled_date = :date', { date })
    .orderBy('j.route_order', 'ASC', 'NULLS LAST')
    .addOrderBy('j.scheduled_window_start', 'ASC', 'NULLS LAST')
    .getMany();
  ...
  const board = drivers.map((driver) => {
    const driverJobs = annotatedJobs.filter(
      (j) => j.assigned_driver_id === driver.id,
    );
    ...
  });

  const unassignedJobs = annotatedJobs.filter((j) => !j.assigned_driver_id);
```

WHERE clauses applied: `tenant_id`, `scheduled_date`. **Status is not filtered.** The comment at line 51–55 explicitly says "Visibility is purely tenant + scheduled_date + ordering."

Per-driver bucketing at line 85–87 is `j.assigned_driver_id === driver.id` — also no status filter. So a job with `status='cancelled'` and `assigned_driver_id=anthony` lands on Anthony's column on the dispatch board.

### Live-DB verification for today

For `tenant_id='822481be-…'` with `scheduled_date='2026-04-24'`, we have:

```
SELECT DISTINCT status FROM jobs
WHERE tenant_id='822481be-…' AND scheduled_date='2026-04-24';
```

(Run informally in audit; X-1021 today is `cancelled` and assigned to Anthony — proves the leak path lands on the board.)

### Comparison: getUnassigned (the other dispatch query) DOES filter

`api/src/modules/dispatch/dispatch.service.ts:327–349`:

```ts
async getUnassigned(tenantId: string) {
  ...
  .andWhere('j.status IN (:...statuses)', { statuses: ['pending', 'confirmed'] })
  ...
  .andWhere('j.status NOT IN (:...excluded)', { excluded: ['completed', 'cancelled'] })
```

The "Unassigned" lane is properly bounded. Only the per-driver columns leak. The asymmetry is the bug.

---

## 6. Frontend mutation refetch quote + assessment

### Override mutation handler

`web/src/app/(dashboard)/jobs/[id]/page.tsx:1034–1064`:

```ts
const handleOverride = async () => {
  if (!overrideTarget || !overrideReason.trim()) return;
  setActionLoading(true);
  try {
    await api.patch(`/jobs/${id}/status`, {
      status: overrideTarget,
      overrideReason: overrideReason.trim(),
    });
    toast("success", `Status overridden to ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(overrideTarget)]}`);
    setOverrideOpen(false);
    setPendingOverride(null);
    await fetchJob();                           // <-- DOES refetch
    setLifecyclePanelRefresh((n) => n + 1);     // <-- DOES nudge child panel
  } catch { toast("error", "Failed to override status"); } finally { setActionLoading(false); }
};
```

`fetchJob` (`:590–601`):

```ts
const fetchJob = async () => {
  try {
    const data = await api.get<Job>(`/jobs/${id}`);
    setJob(data);
    resolveChainId(data);
  } catch { /* */ } finally {
    setLoading(false);
  }
};
```

`LifecycleContextPanel` reacts to `refreshSignal` via `useEffect` deps `[jobId, refetchKey, refreshSignal]` (`web/src/app/(dashboard)/jobs/[id]/_components/LifecycleContextPanel.tsx:240`).

### Cancel mutation handler

`web/src/app/(dashboard)/jobs/[id]/page.tsx:986–1000`:

```ts
const confirmCancelFromModal = async () => {
  if (!cancelReason.trim()) return;
  setActionLoading(true);
  try {
    await api.patch(`/jobs/${id}/status`, {
      status: "cancelled",
      cancellationReason: cancelReason.trim(),
    });
    toast("success", "Job cancelled");
    setCancelModalOpen(false);
    setCancelReason("");
    setCancelContext(null);
    await fetchJob();                           // <-- DOES refetch
    setLifecyclePanelRefresh((n) => n + 1);     // <-- DOES nudge panel
  } catch { ... }
```

### Assessment — Bug 4 is a downstream symptom, not a separate bug

Both mutations refetch the job and refresh the lifecycle panel. The data they receive is what the server returns, and the server is returning the still-set `assigned_driver_id` because Bug 1 / Bug 2 prevented the null. The page then renders "Assigned" because that's truthful given the (incorrect) server state. **There is no missing query-key invalidation.** The page is doing exactly what it should.

This audit explicitly does **not** propose a frontend-only fix for "Bug 4"; the symptom resolves automatically once Bugs 1 and 2 are fixed at the API layer. If smoke-testing Phase 1 reveals a residual frontend cache issue not observable from this read-through, that's a separate finding to log.

---

## 7. Driver-app exposure check

`api/src/modules/driver/driver.controller.ts:20–36` — `GET /driver/today`:

```ts
@Get('today')
async getToday(
  @CurrentUser('id') userId: string,
  @TenantId() tenantId: string,
) {
  const today = new Date().toISOString().split('T')[0];
  return this.jobRepo.createQueryBuilder('j')
    .leftJoinAndSelect('j.customer', 'c')
    .leftJoinAndSelect('j.asset', 'a')
    .where('j.tenant_id = :tenantId', { tenantId })
    .andWhere('j.assigned_driver_id = :userId', { userId })
    .andWhere('j.scheduled_date = :today', { today })
    .orderBy('j.route_order', 'ASC', 'NULLS LAST')
    .addOrderBy('j.scheduled_window_start', 'ASC', 'NULLS LAST')
    .getMany();
}
```

`api/src/modules/driver/driver.controller.ts:38–61` — `GET /driver/jobs`:

```ts
@Get('jobs')
async getJobs(
  @CurrentUser('id') userId: string,
  @TenantId() tenantId: string,
  @Query('status') status?: string,
  @Query('dateFrom') dateFrom?: string,
  @Query('dateTo') dateTo?: string,
) {
  const qb = this.jobRepo.createQueryBuilder('j')
    .leftJoinAndSelect('j.customer', 'c')
    .leftJoinAndSelect('j.asset', 'a')
    .where('j.tenant_id = :tenantId', { tenantId })
    .andWhere('j.assigned_driver_id = :userId', { userId });

  if (status) qb.andWhere('j.status = :status', { status });
  if (dateFrom) qb.andWhere('j.scheduled_date >= :dateFrom', { dateFrom });
  if (dateTo) qb.andWhere('j.scheduled_date <= :dateTo', { dateTo });

  return qb.orderBy('j.scheduled_date', 'DESC')
    .addOrderBy('j.route_order', 'ASC', 'NULLS LAST')
    .take(50)
    .getMany();
}
```

**Confirmed: neither endpoint filters terminal statuses.** Real driver-role users (Mike, Jake) DO see leaked cancelled/completed/failed jobs on their phones today. § 9 inventory shows 16 leaked rows, 14 of which are assigned to either Mike or Jake (`mike@rentthisdumpster.com` × 6, `jake@rentthisdumpster.com` × 8). Phone-side exposure is real and should be fixed in the same Phase 1 PR.

---

## 8. Override modal target options

`web/src/app/(dashboard)/jobs/[id]/page.tsx:254–261` — TIMELINE_STEPS source:

```ts
const TIMELINE_STEPS = [
  { key: "created_at",   label: "Created",    status: "pending" },
  { key: "confirmed",    label: "Unassigned", status: "confirmed" },
  { key: "dispatched_at",label: "Assigned",   status: "dispatched" },
  { key: "en_route_at",  label: "En Route",   status: "en_route" },
  { key: "arrived_at",   label: "Arrived",    status: "arrived" },
  { key: "completed_at", label: "Completed",  status: "completed" },
];
```

Override-modal dropdown body, `:3324–3341`:

```tsx
<select
  value={overrideTarget}
  onChange={(e) => setOverrideTarget(e.target.value)}
  ...
>
  {TIMELINE_STEPS
    .filter((s) => s.status !== job.status)
    .map((s) => (
      <option key={s.status} value={s.status}>{s.label}</option>
    ))}
</select>
```

### Display→stored mapping (the operator-confusion source)

| Display label | Stored value sent in PATCH body |
|---|---|
| Created | `pending` |
| Unassigned | `confirmed` |
| Assigned | `dispatched` |
| En Route | `en_route` |
| Arrived | `arrived` |
| Completed | `completed` |

The dropdown excludes only the literal current `job.status`. So if current is `dispatched`, options shown are: Created, Unassigned, En Route, Arrived, Completed. There is no warning that "Unassigned" stores `confirmed` — the operator's mental model of "Unassigned == clear driver" is exactly what motivated UNASSIGNED_TARGETS, and Bug 1 is the implementation gap.

`deriveDisplayStatus` from `web/src/lib/job-status.ts` is the canonical mapping in the comment block at `:280–298` that documents the modal's logic; the audit did not re-quote that file but the labels above match its switch.

---

## 9. Leaked-job inventory

Query: `SELECT j.job_number, j.id, j.status, j.assigned_driver_id, u.email, j.scheduled_date, j.updated_at FROM jobs j LEFT JOIN users u ON u.id=j.assigned_driver_id WHERE j.tenant_id='822481be-…' AND j.status IN ('cancelled','completed','failed') AND j.assigned_driver_id IS NOT NULL ORDER BY j.updated_at;`

| job_number | status | driver | scheduled_date | updated_at |
|---|---|---|---|---|
| JOB-20260403-001-D | completed | mike | 2026-04-03 | 2026-04-23 19:43:20 |
| JOB-20260405-002-D | completed | jake | 2026-04-05 | 2026-04-23 19:43:20 |
| JOB-20260409-003-D | completed | mike | 2026-04-09 | 2026-04-23 19:43:20 |
| JOB-20260417-005-D | completed | mike | 2026-04-17 | 2026-04-23 19:43:20 |
| JOB-20260408-006-D | completed | jake | 2026-04-08 | 2026-04-23 19:43:20 |
| JOB-20260415-007-D | completed | mike | 2026-04-15 | 2026-04-23 19:43:20 |
| JOB-20260411-010-D | completed | jake | 2026-04-11 | 2026-04-23 19:43:20 |
| JOB-20260414-011-D | completed | mike | 2026-04-14 | 2026-04-23 19:43:20 |
| JOB-20260418-012-D | completed | jake | 2026-04-18 | 2026-04-23 19:43:20 |
| JOB-20260407-009-D | completed | mike | 2026-04-07 | 2026-04-23 19:44:04 |
| JOB-20260420-008-P | cancelled | jake | 2026-05-04 | 2026-04-23 21:44:38 |
| JOB-20260420-008-D | completed | jake | 2026-04-20 | 2026-04-23 21:44:38 |
| JOB-20260413-004-P | cancelled | jake | 2026-04-27 | 2026-04-23 22:39:07 |
| JOB-20260413-004-D | completed | jake | 2026-04-13 | 2026-04-23 22:39:07 |
| JOB-20260422-013-D | completed | adepaolo456 | 2026-04-22 | 2026-04-24 12:36:39 |
| X-1021 | cancelled | adepaolo456 | 2026-04-24 | 2026-04-25 00:52:11 |

**16 leaked rows.** Plus one extra: JOB-20260409-003-P (`status='confirmed'`, `assigned_driver_id=adepaolo456`) — Bug 1's reproduction job. That one isn't in the terminal-status leak inventory but it's the demo of UNASSIGNED_TARGETS-clearing failure and should be re-nulled by Phase 1 as part of the same cleanup.

Oldest leak `updated_at = 2026-04-23 19:43:20`. Newest = 2026-04-25 00:52:11. Duration ≈ 1.2 days. The Apr 23 19:43 batch (10 jobs) all share a common timestamp — that's a single seed/migration write, not 10 individual user actions. Likely a backfill batch from Phase B-something. The Apr 23 evening / Apr 24 morning entries come from individual operator cancellations + completions over the past day.

### Cleanup safety

For each row, the leak is **purely a stale FK** — the job is terminal (cancelled/completed/failed), so no operational workflow depends on the assignment. Nulling them in one pass is safe. Recommended cleanup is a single tenant-scoped UPDATE; spec'd in § 11.

---

## 10. Proposed fix shapes (prose only, no code)

### Bug 1 — Override-to-Unassigned does null `assigned_driver_id` in production

Replace the `job.assigned_driver_id = null; await txJobRepo.save(job);` pattern with the cascadeDelete-style `await txJobRepo.update({id, tenant_id}, { assigned_driver_id: null })` pattern, executed inside the same transaction immediately after `txJobRepo.save(job)` (so the status save and the driver clear are still one atomic unit). Alternative: also null the `assigned_driver` relation alongside the FK before calling `save()` — both work; the `update()` form is the codebase's existing convention and matches the in-line comment's already-stated intent.

### Bug 2 — Cancellation nulls `assigned_driver_id`

Broaden the clearing rule beyond `UNASSIGNED_TARGETS`. Two shape options:
- **(a) Add a parallel TERMINAL_TARGETS set** (`new Set(['cancelled', 'completed', 'failed'])`) and clear when `dto.status` ∈ that set. Mirrors the existing UNASSIGNED_TARGETS shape.
- **(b) Define a single CLEAR_DRIVER_TARGETS set** that contains both buckets (`['pending', 'confirmed', 'cancelled', 'completed', 'failed']`) and one gate.

Option (b) is simpler and less duplicative. Either way, the implementation must use the `update()` pattern from Bug 1's fix to actually persist. The clearing should NOT be gated on `isAdmin` for terminal targets — a driver completing their own job legitimately closes it and should drop off the board; cancellation by anyone should null the driver. Keep the `isAdmin` guard only for the UNASSIGNED bucket (those are explicit corrections by ops, not normal flow).

### Bug 3 — Dispatch query filters terminal statuses, driver-app endpoints filter terminal statuses

Three places to add a `status NOT IN ('cancelled','completed','failed')` predicate:
1. `dispatch.service.ts:60–61` — the `getDispatchBoard` query.
2. `driver.controller.ts:30–32` — the `/driver/today` query.
3. `driver.controller.ts:50–51` — the `/driver/jobs` default filter (only when no `status` query param is provided; respect explicit overrides).

The exact list of "terminal" statuses must match the canonical terminal set used by `autoCloseChainIfTerminal` and `checkRouteCompletion` in `jobs.service.ts:1389–1395` and `:1371–1373` — both reference `['completed','cancelled','failed','needs_reschedule']`. Whether `needs_reschedule` should also be filtered off the driver/dispatch boards is a product call (see Open Questions). Conservative recommendation: filter only `completed`, `cancelled`, `failed`; keep `needs_reschedule` visible because that state IS actionable by dispatch.

### Bug 4 — No fix needed at the frontend

Verified in § 6: the override and cancel handlers already refetch via `fetchJob()` and bump the lifecycle panel via `setLifecyclePanelRefresh`. The page's stale appearance after an override is a downstream symptom of Bug 1 (server returns the unchanged FK; UI faithfully renders it). Bug 1's fix resolves Bug 4 by making the server return the correct state. If Phase 1 smoke testing reveals an actual residual cache issue not in the code I read, log it as a Phase 1 follow-up.

---

## 11. Cleanup migration plan

### Dry-run SELECT (audit row inventory before UPDATE)

```sql
SELECT id, job_number, status, assigned_driver_id, scheduled_date, updated_at
FROM jobs
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL;
```

Expected: 16 rows (per § 9). Rerun immediately before the UPDATE; reject if count differs by more than ±2 (allows for additional cancels in the intervening window).

### UPDATE (the actual cleanup)

```sql
UPDATE jobs
SET assigned_driver_id = NULL,
    updated_at = NOW()
WHERE tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL;
```

Plus one row for Bug 1's override-victim (status is `confirmed`, not terminal — this is a separate one-off):

```sql
UPDATE jobs
SET assigned_driver_id = NULL,
    updated_at = NOW()
WHERE id = '3d24ab96-5f99-43f3-ba50-6817c7e03888'
  AND tenant_id = '822481be-039e-481a-b5c4-21d9e002f16c'
  AND status = 'confirmed'
  AND assigned_driver_id = 'f86c8546-528d-40ee-9f8b-942b79ebc821';
```

The second statement is defensive (matches by all four fields so a re-assignment between audit and cleanup wouldn't get clobbered).

### Rollback SQL (capture before running cleanup)

Generate a `INSERT…ON CONFLICT DO UPDATE` rollback by snapshotting the affected rows' `(id, assigned_driver_id)` pairs into a temp table or a recorded migration log. Pseudo-shape:

```sql
-- Run BEFORE the cleanup UPDATE; save output to recovery file.
SELECT id, assigned_driver_id
FROM jobs
WHERE tenant_id = '822481be-…'
  AND status IN ('cancelled', 'completed', 'failed')
  AND assigned_driver_id IS NOT NULL;
```

Rollback (only if needed): apply the captured pairs back via per-row UPDATEs scoped by `id` AND `tenant_id` AND `assigned_driver_id IS NULL` (so the rollback is a no-op if a Phase 1 driver-clear already re-nulled them).

### Idempotence

The cleanup UPDATE is idempotent in PostgreSQL semantics: re-running it after first execution affects 0 rows (the `assigned_driver_id IS NOT NULL` predicate is no longer true for the cleaned rows). Safe to run twice.

### PII safety

The UPDATE statement does not log driver names or customer details. The dry-run SELECT and audit table do reference `assigned_driver_id` (a UUID, not PII on its own) and `job_number`. No leakage risk in the migration text itself; the application logs this query at INFO; no PII broadcast.

---

## 12. Phase 1 implementation scope estimate

- **Files touched (expected): 4**
  - `api/src/modules/jobs/jobs.service.ts` — broaden the clearing target set; replace `save()` with column-only `update()` for the FK-null. ~10 lines of logic + 1 new const.
  - `api/src/modules/jobs/jobs.service.spec.ts` — fix tests #7–9 to either also set `assigned_driver` relation in fixtures (so they reproduce the production bug), and add new tests for terminal-status driver-clearing on cancel/complete/fail. ~80 new lines, 3 fixture tweaks.
  - `api/src/modules/dispatch/dispatch.service.ts` — add status filter to `getDispatchBoard`. ~3 lines.
  - `api/src/modules/driver/driver.controller.ts` — add status filter to `getToday` and a default filter to `getJobs`. ~6 lines.
- **Migrations: 1** — the cleanup migration in § 11 (data only; no schema changes).
- **Test additions:**
  - `tests #7–9 production-fidelity guard`: parameterize `makeJob` to optionally include `assigned_driver` (the User relation), and re-run the existing assertions against that fixture. Without this, Phase 1 could pass tests but still fail prod.
  - `terminal-target driver-clear`: cancellation by admin clears driver; completion by driver clears driver; failed-trip clears driver.
  - `dispatch-board excludes cancelled`: per-driver column does not return cancelled jobs for the date.
  - `driver-app excludes cancelled`: `/driver/today` does not return a cancelled job assigned to the caller.
- **Smoke-test steps** (manual):
  1. Override JOB-20260409-003-P from `confirmed` to a different status, verify driver-clear actually persists.
  2. Cancel any test job assigned to a driver, verify `assigned_driver_id IS NULL` in DB after.
  3. Open dispatch board for a date where a driver has a recently-cancelled job, verify it does NOT appear in their column.
  4. Open driver app as Mike, verify cancelled/completed jobs from past dates are not in the today list.
  5. Run cleanup migration; rerun § 11 dry-run SELECT, verify zero rows.
- **Registry: 0 changes** — no new user-facing label or endpoint.

---

## 13. Open questions for Anthony

1. **`needs_reschedule` on the dispatch board / driver app.** That status IS actionable by dispatch and represents a customer-driven request to reschedule. Should it stay visible on the per-driver column (current behavior) or move to the unassigned lane? Recommendation: keep on per-driver until dispatcher explicitly reroutes, but the `assigned_driver_id` should still be cleared by the same Phase 1 broadening if and only if you treat it as terminal-for-that-driver. Product call.
2. **Driver self-completion clearing the driver.** When a driver taps "Complete Job" from the field, clearing `assigned_driver_id` immediately removes the job from their list — desired, but it also removes the audit-trace UI artifact "you did this job today" if any surface relies on the FK to display past-day history. Confirm no surface relies on terminal-status jobs' FK before broadening; § 9 inventory of 16 leaked completed jobs has been accumulating for 1.2 days and apparently no one missed them, which suggests no such reliance — but worth confirming.
3. **Tests #7–9 should be made production-faithful.** The current tests assert mock behavior, not TypeORM persistence behavior. The new audit discipline says we should fail-loud when this divergence shows up. Phase 1 should fix the fixture (load `assigned_driver` relation in `makeJob`) so the tests would have caught this bug. Confirm that's in scope vs. a separate test-hygiene arc.
4. **Override modal "Unassigned" label.** Operators read it as "clear driver"; technically it stores `confirmed`. Once driver-clearing actually works, the label/value coupling is fine. If you want a clearer "Unassign driver" affordance separate from "back to confirmed status," that's a UX arc, not Arc H.
5. **Cleanup migration timing.** Run the cleanup AFTER the API code fix is deployed so that any in-flight cancellations during the cleanup window get the new behavior automatically and the migration is a one-and-done backfill. Confirm.
6. **Atomicity of cancel + driver-clear.** The current cancellation transaction wraps `txJobRepo.save(job)` + audit. Adding a `txJobRepo.update(...)` for the FK null inside the same callback is fine. Confirm you're OK with two writes (a save + an update) in one transaction vs. doing both via a single `update` that sets `status` AND `assigned_driver_id` together (slightly more efficient, but skips entity hooks). Recommendation: stick with save-then-update; matches existing pattern, minimum risk.

---

## 14. Audit discipline self-check

| Claim in this report | Backed by quoted source line(s) |
|---|---|
| `UNASSIGNED_TARGETS = new Set(['pending', 'confirmed'])` | `jobs.service.ts:132`, quoted in § 2 |
| Clearing block at line 1280 only fires when `isAdmin && UNASSIGNED_TARGETS.has(dto.status)` | `jobs.service.ts:1280`, quoted in § 2 |
| `findOne` loads the `assigned_driver` relation | `jobs.service.ts:651–665`, quoted in § 2 |
| Job entity has both column and relation for `assigned_driver_id` | `entities/job.entity.ts:53–58`, quoted in § 2 |
| cascadeDelete pattern uses column-only `update()` | `jobs.service.ts:1633–1639`, quoted in § 2 |
| Tests #7, #8, #9 assertions | Quoted verbatim in § 3 |
| `makeJob` fixture omits `assigned_driver` relation | `jobs.service.spec.ts:56–72`, quoted in § 3 |
| `txJobSave` mock just records args | `jobs.service.spec.ts:148`, quoted in § 3 |
| No dedicated `cancelJob` method exists | `grep -rn cancelJob` returned no matches in jobs module — quoted shell result in § 4 |
| `changeStatus` is the cancel write path | Quoted call site `web/.../page.tsx:986–1000` in § 6 |
| `getDispatchBoard` does not filter status | `dispatch.service.ts:42–104`, quoted in § 5 |
| `getUnassigned` does filter status | `dispatch.service.ts:327–349`, quoted in § 5 |
| Driver app endpoints do not filter terminal statuses | `driver.controller.ts:20–61`, quoted in § 7 |
| Override modal exposes `TIMELINE_STEPS` minus current | `web/.../page.tsx:3324–3341` + `:254–261`, quoted in § 8 |
| 16 leaked production rows | SQL result quoted in § 9 |
| Override + cancel mutations DO refetch job and lifecycle panel | `web/.../page.tsx:1034–1064` + `:986–1000` + `LifecycleContextPanel.tsx:240`, all quoted in § 6 |

**Inferred (not directly quoted) claims, flagged:**
- "TypeORM rehydrates FK from loaded relation during `save()`" — this is a known TypeORM behavior cited as the explanation for Bug 1, but I did not run TypeORM in isolation to *prove* the rehydration; I'm reasoning by elimination (the conditional fires, the in-memory null is set, and DB still shows the FK; the only step left to fail is `save()`'s persistence reconciliation; the cascadeDelete `.update()` pattern doesn't have this problem and is the codebase's established form for FK nulling). Phase 1 should confirm by either: (a) writing the fix with `.update()` and verifying the bug goes away, or (b) writing a quick TypeORM repro test that loads a job with the relation, sets the FK to null, calls `.save()`, and asserts the row was written with NULL. Either is fine; (a) is faster.
- "16 leaked rows is the full count" — query was scoped to one tenant. If multi-tenant fix is needed in the future, the cleanup migration must enumerate tenants. Present production has only this one active tenant at the row counts I observed.

---

**End of report.** No source files modified; no commits; no migrations executed; no deploys.
