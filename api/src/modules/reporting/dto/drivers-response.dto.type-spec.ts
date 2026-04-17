/**
 * Type-only sanity check for `DriversResponseDto`.
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
 * Phase 6 note: third reuse of `PeriodDto` (after Phase 3 customers
 * and Phase 5 revenue). No *Percent fields (Risk #3 not applicable);
 * no currency collision surface (Risk #1 not applicable). Cleanly
 * mechanical phase — positive fixture uses plain driver-realistic
 * counts.
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a-c / Phase 5 template: Jest globs `.spec.ts` only, so this
 * file is picked up by `tsc` but NOT by `jest`.
 */

import type { DriversResponseDto } from './drivers-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
//
// Two per-driver rows with realistic job-mix distributions.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: DriversResponseDto = {
  driverStats: [
    {
      driverId: 'driver-uuid-1',
      driverName: 'Alex Martinez',
      totalJobs: 84,
      completedJobs: 78,
      failedJobs: 2,
      deliveries: 36,
      pickups: 30,
      exchanges: 12,
      dumpRuns: 6,
    },
    {
      driverId: 'driver-uuid-2',
      driverName: 'Samira Okafor',
      totalJobs: 67,
      completedJobs: 64,
      failedJobs: 1,
      deliveries: 28,
      pickups: 24,
      exchanges: 10,
      dumpRuns: 5,
    },
  ],
  period: {
    start: '2026-01-01',
    end: '2026-03-31',
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `driverStats[].totalJobs` is picked as the sentinel because:
//   1. It is the structural denominator for every derived rate a
//      consumer might compute (completion rate, failure rate, job-mix
//      percentages) — drift from `number` to `string` would silently
//      break every client-side ratio calculation.
//   2. It is the most prominent sort key for leaderboard views.
//   3. No *Percent field exists on this endpoint (Risk #3 not
//      applicable), so the sentinel falls on the next-most-structural
//      numeric — the count totalJobs.
//   4. Exercises the nested-array spread pattern consistent with
//      Phase 3 / 4a-c / 5's sentinel placements.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: DriversResponseDto = {
  ..._validFixture,
  driverStats: [
    {
      ..._validFixture.driverStats[0],
      // @ts-expect-error — totalJobs must be number, not string.
      totalJobs: 'not-a-number',
    },
    ..._validFixture.driverStats.slice(1),
  ],
};
void _invalidFixture;
