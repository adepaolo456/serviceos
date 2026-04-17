/**
 * Type-only sanity check for `ProfitResponseDto`.
 *
 * No Jest, no runtime assertions — the load-bearing check is
 * `tsc --noEmit`. This file exists to:
 *   1. Prove that a representative runtime-shape fixture compiles
 *      against the DTO (positive case).
 *   2. Prove the DTO actually rejects shape drift via
 *      `@ts-expect-error` (negative case — if the DTO ever stops
 *      catching the drift, the directive itself fails to compile
 *      and tsc errors out with TS2578).
 *
 * The `.type-spec.ts` suffix matches the Follow-Up #3 backport's
 * convention (`lifecycle-response.dto.type-spec.ts`): Jest globs
 * `.spec.ts` only, so this file is picked up by `tsc` but NOT by
 * `jest`.
 */

import type { ProfitResponseDto } from './profit-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: ProfitResponseDto = {
  totalRevenue: 125000,
  totalDumpCosts: 42000,
  grossProfit: 83000,
  grossMarginPercent: 66.4,
  period: {
    start: '2026-01-01',
    end: '2026-03-31',
  },
};
// Reference the binding so the unused-vars rule does not flag it.
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// If the DTO is ever weakened so this becomes valid, the
// `@ts-expect-error` directive itself becomes invalid and tsc errors
// with "Unused '@ts-expect-error' directive." That is the regression
// signal: the contract used to reject this fixture and no longer
// does.
//
// `grossMarginPercent` is picked as the sentinel field because the
// Phase 0 audit called out percent-scale drift (0–100 vs 0–1) as the
// module-wide naming-drift risk pattern (Risk #3). Retyping it from
// `number` to `string` would be exactly the kind of drift that hurts
// downstream `.toFixed()` render sites silently.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: ProfitResponseDto = {
  ..._validFixture,
  // @ts-expect-error — grossMarginPercent must be number, not string.
  grossMarginPercent: 'not-a-number',
};
void _invalidFixture;
