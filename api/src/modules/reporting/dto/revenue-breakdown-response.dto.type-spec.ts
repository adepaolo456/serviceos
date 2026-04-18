/**
 * Type-only sanity check for `RevenueBreakdownResponseDto`.
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
 * Phase 13 note: FIRST use of the `INVOICED_LINE_ITEM` tag (reserved
 * in Track 2's spec v1, adopted here). Sentinel placed on
 * `totalInvoicedLineItem` — drifted to a string — to exercise the
 * newly-adopted tag's wire field at type level. First-use of a
 * reserved tag deserves the sentinel.
 *
 * ─── Fixture rubric (Step 3) ───
 * One representative fixture covering all 8 envelope fields + 6
 * breakdown fields. Numbers are illustrative:
 *   - period 2026-04 (matches example post-correction filter)
 *   - classification 'post-correction' to exercise non-default
 *   - totalInvoicedLineItem = 87500 (sum of breakdown fields would
 *     be 87500, but failedTripRevenue overlaps — see DTO file-level
 *     JSDoc note 4 for axis asymmetry)
 *   - collectionRate = 92.9 = Math.round((39 / 42) * 1000) / 10
 *     (1-decimal precision per Risk #3 formula)
 */

import type { RevenueBreakdownResponseDto } from './revenue-breakdown-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: RevenueBreakdownResponseDto = {
  classification: 'post-correction',
  cutoffDate: '2026-04-02',
  period: '2026-04',
  totalInvoicedLineItem: 87500,
  breakdown: {
    rental: 52000,
    distance: 8500,
    overage: 12000,
    surcharges: 4200,
    extraDayRevenue: 6800,
    failedTripRevenue: 4000,
  },
  invoiceCount: 42,
  paidCount: 39,
  collectionRate: 92.9,
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `totalInvoicedLineItem` is picked as the sentinel because:
//   1. Phase 13's primary structural contribution is adopting the
//      `INVOICED_LINE_ITEM` tag — first use of the reserved label
//      in Track 2's spec v1 vocabulary. Sentinel exercises that
//      invariant at its point of entry.
//   2. The wire-field type (number) is the load-bearing contract.
//      Drift from number → string would silently break every
//      downstream currency render, totaling chart, etc.
//   3. Alternatives considered and rejected:
//      - collectionRate drifted to string (Risk #3 reinforcement):
//        valid choice, but Risk #3 is reused-existing family here
//        (Phase 10 count-over-count); not a new structural
//        invariant.
//      - breakdown.failedTripRevenue drifted to string: exercises
//        the asymmetric-axis field, but that's a documentation
//        concern (JSDoc-warned, Phase-14-investigated), not a
//        type-level invariant Phase 13 introduces.
//      - breakdown nested-key drift (e.g., wrong field name):
//        exercises the closed-key contract on a sub-DTO, but
//        prior phases (7, 9) have well-defended that pattern.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: RevenueBreakdownResponseDto = {
  ..._validFixture,
  // @ts-expect-error — totalInvoicedLineItem must be number, not string.
  totalInvoicedLineItem: 'not-a-number',
};
void _invalidFixture;
