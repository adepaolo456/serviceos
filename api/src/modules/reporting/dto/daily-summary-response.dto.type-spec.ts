/**
 * Type-only sanity check for `DailySummaryResponseDto`.
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
 * Phase 15 note: sentinel placed on the `alerts` field — the
 * cross-phase import invariant. Drift to a string exercises the
 * type contract most novel to this phase: `alerts` must be
 * structurally compatible with Phase 12's
 * `IntegrityCheckSummaryDto`. If Phase 12 ever changes the sub-DTO
 * shape in a way that breaks Phase 15's contract, this sentinel
 * fires first.
 *
 * Alternative sentinels rejected:
 *   - `revenue` drift: tagged scalar, but scalar-type drift is
 *     module-typical, not novel to Phase 15.
 *   - `overdueAR` drift: the δ-decided field, but δ-decision affects
 *     documentation, not type contract.
 */

import type { DailySummaryResponseDto } from './daily-summary-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: DailySummaryResponseDto = {
  date: '2026-04-17',
  revenue: 18750,
  openAR: 42800,
  overdueAR: 12500,
  jobsCreated: 8,
  jobsCompleted: 6,
  alerts: {
    critical: 0,
    warning: 2,
    info: 5,
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `alerts` is picked as the sentinel because:
//   1. Phase 15's primary structural contribution is the first
//      cross-phase DTO import reuse. Sentinel exercises that
//      invariant at its point of entry.
//   2. Phase 12's IntegrityCheckSummaryDto is the load-bearing
//      cross-phase contract; drift there would propagate to Phase
//      15 at build time. Sentinel catches this class of drift.
//   3. Alternatives considered and rejected:
//      - revenue: 'not-a-number' — scalar drift is module-typical.
//      - overdueAR: 'not-a-number' — δ-decision affects docs, not type.
//      - alerts.critical: 'not-a-number' — exercises sub-DTO field
//        type, but the outer-shape invariant is more novel.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: DailySummaryResponseDto = {
  ..._validFixture,
  // @ts-expect-error — alerts must be IntegrityCheckSummaryDto, not string.
  alerts: 'not-an-object',
};
void _invalidFixture;
