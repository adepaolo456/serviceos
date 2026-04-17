/**
 * Type-only sanity check for `LifecycleReportResponseDto`.
 *
 * No Jest, no runtime assertions — the load-bearing check is
 * `tsc --noEmit`. This file exists to:
 *   1. Prove a representative runtime-shape fixture compiles against
 *      the DTO (positive case).
 *   2. Prove the DTO rejects shape drift via `@ts-expect-error`
 *      (negative case — if the DTO ever stops catching the drift, the
 *      directive itself fails to compile and tsc errors out with
 *      TS2578).
 *
 * Phase 10 note: FIRST snake_case DTO in the module. Positive
 * fixture is the wire-contract reference — every field is
 * snake_case to mirror the service's return verbatim. Sentinel
 * placed on `summary.exchange_rate` (Risk #3 count-over-count
 * variant) to reinforce the 0–100 invariant at the type level —
 * especially since this is the first count-over-count Risk #3
 * field in the module. Sentinel rationale documented in Phase 10
 * Section C.
 *
 * ─── Chain-row scenario rubric for positive fixture (Step 3) ───
 * Row 1 — "active, pickup not yet scheduled": expected_pickup_date
 *   set; actual_pickup_date null; duration_days null; status
 *   'active'.
 * Row 2 — "completed, full timeline": all three date fields set;
 *   duration_days computed; status 'completed'.
 * Row 3 — "overdue active, pickup delayed past expected":
 *   expected_pickup_date in the past; actual_pickup_date still
 *   null; duration_days null; status 'active'. Contributes to
 *   summary.overdue_rentals.
 *
 * The `.type-spec.ts` suffix matches the module's template: Jest
 * globs `.spec.ts` only, so this file is picked up by `tsc` but
 * NOT by `jest`.
 */

import type { LifecycleReportResponseDto } from './lifecycle-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// All fields snake_case per wire contract.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: LifecycleReportResponseDto = {
  summary: {
    total_rental_revenue: 28420.5,
    total_lifecycle_cost: 12800,
    total_profit: 15620.5,
    average_rental_duration: 11.3,
    active_rentals: 18,
    overdue_rentals: 3,
    completed_rentals: 42,
    exchange_rate: 42.7,
    revenue_per_chain: 473.67,
    profit_per_chain: 260.34,
    standalone_jobs: 7,
  },
  chains: [
    // Row 1 — active, pickup not yet scheduled.
    {
      chain_id: 'chain-uuid-1',
      customer_name: 'Jane Doe',
      address: '123 Main St, Portland, OR',
      dumpster_size: '20yd',
      drop_off_date: '2026-03-01',
      expected_pickup_date: '2026-05-01',
      actual_pickup_date: null,
      status: 'active',
      revenue: 820,
      cost: 340,
      profit: 480,
      duration_days: null,
      exchange_count: 0,
    },
    // Row 2 — completed, full timeline.
    {
      chain_id: 'chain-uuid-2',
      customer_name: 'Acme Construction LLC',
      address: '456 Industrial Ave, Seattle, WA',
      dumpster_size: '30yd',
      drop_off_date: '2026-02-10',
      expected_pickup_date: '2026-02-24',
      actual_pickup_date: '2026-02-24',
      status: 'completed',
      revenue: 1450,
      cost: 620,
      profit: 830,
      duration_days: 14,
      exchange_count: 1,
    },
    // Row 3 — overdue active: expected pickup past, no actual yet.
    {
      chain_id: 'chain-uuid-3',
      customer_name: '(no name)',
      address: '—',
      dumpster_size: '',
      drop_off_date: '2026-01-15',
      expected_pickup_date: '2026-02-15',
      actual_pickup_date: null,
      status: 'active',
      revenue: 600,
      cost: 280,
      profit: 320,
      duration_days: null,
      exchange_count: 0,
    },
  ],
  trend: [
    {
      period: '2026-01',
      revenue: 4200,
      cost: 1820,
      profit: 2380,
      completed_chains: 8,
    },
    {
      period: '2026-02',
      revenue: 10800,
      cost: 4640,
      profit: 6160,
      completed_chains: 19,
    },
    {
      period: '2026-03',
      revenue: 13420.5,
      cost: 6340,
      profit: 7080.5,
      completed_chains: 15,
    },
  ],
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `summary.exchange_rate` is picked as the sentinel because:
//   1. Phase 10's primary contribution includes the THIRD Risk #3
//      variant (count-over-count rate). The sentinel should exercise
//      the ratio-typed-as-number invariant specifically at the new
//      variant's point of entry.
//   2. Percent fields are prone to silent breakage: a string percent
//      concatenates cleanly with '%' at the UI layer, masking
//      downstream arithmetic bugs. Type-level enforcement at the DTO
//      boundary is the only real defense.
//   3. Alternatives considered and rejected:
//      - chains[].revenue / trend[].profit (array-leaf currency):
//        exercises the array-spread invariant, but that pattern is
//        already well-defended across Phases 3/4a-c/5/6/7/8/9. Phase
//        10 adds no new structural invariant there.
//      - summary.total_rental_revenue (Risk #1 fourth-semantic
//        advisory): carries documented semantic load, but as an
//        advisory cross-reference it does not introduce a new type
//        invariant — the JSDoc is the defense, not the sentinel.
//      - chains[] nullable drift (string | null → string | undefined):
//        exercises nullability precision but not the new count-over-
//        count Risk #3 pattern.
//   4. Matches Phase 8's discipline: when a new Risk #3 variant is
//      the phase's primary structural contribution, sentinel goes
//      on that field.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: LifecycleReportResponseDto = {
  ..._validFixture,
  summary: {
    ..._validFixture.summary,
    // @ts-expect-error — exchange_rate must be number, not string.
    exchange_rate: 'not-a-number',
  },
};
void _invalidFixture;
