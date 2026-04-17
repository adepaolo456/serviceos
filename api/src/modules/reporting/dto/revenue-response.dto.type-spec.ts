/**
 * Type-only sanity check for `RevenueResponseDto`.
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
 * Phase 5 note: this is the SECOND reuse of `PeriodDto` (after Phase
 * 3 — customers). Positive fixture uses runtime-accurate types,
 * including `date: string | null` in `dailyRevenue` rows (at least
 * one row exercises the null path).
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a/b/c template: Jest globs `.spec.ts` only, so this file is
 * picked up by `tsc` but NOT by `jest`.
 */

import type { RevenueResponseDto } from './revenue-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
//
// Two revenueBySource rows, three dailyRevenue rows (one with
// `date: null` to exercise the nullable-string contract from the
// service's defensive fallback).
// ─────────────────────────────────────────────────────────────────────

const _validFixture: RevenueResponseDto = {
  totalRevenue: 48200.75,
  totalCollected: 41875.5,
  totalOutstanding: 6325.25,
  totalOverdue: 1200,
  revenueBySource: [
    {
      source: 'google_ads',
      amount: 28400.5,
      count: 42,
      paidCount: 36,
      outstanding: 3100,
    },
    {
      source: 'other',
      amount: 19800.25,
      count: 31,
      paidCount: 28,
      outstanding: 3225.25,
    },
  ],
  dailyRevenue: [
    {
      date: '2026-03-30',
      amount: 2400,
      count: 4,
      paidCount: 3,
    },
    {
      date: '2026-03-29',
      amount: 1850.75,
      count: 3,
      paidCount: 3,
    },
    {
      date: null,
      amount: 0,
      count: 0,
      paidCount: 0,
    },
  ],
  grouping: 'daily',
  period: {
    start: '2026-01-01',
    end: '2026-03-31',
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `totalRevenue` is picked as the sentinel because:
//   1. It is the Risk #1-load-bearing field — its JSDoc explicitly
//      warns against cross-wiring with profit.totalRevenue. A type
//      drift here (number → string) would silently compromise the
//      very invariant the DTO was introduced to enforce.
//   2. It is the single most consequential numeric on the endpoint
//      (the headline revenue tile).
//   3. Choosing the top-level Risk #1 field over a nested array
//      field reinforces the Risk #1 convention at the type level,
//      complementing the JSDoc documentation side.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: RevenueResponseDto = {
  ..._validFixture,
  // @ts-expect-error — totalRevenue must be number, not string.
  totalRevenue: 'not-a-number',
};
void _invalidFixture;
