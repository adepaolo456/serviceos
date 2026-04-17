/**
 * Type-only sanity check for `AssetsResponseDto`.
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
 * The `.type-spec.ts` suffix matches the Phase 1 v2 template: Jest
 * globs `.spec.ts` only, so this file is picked up by `tsc` but NOT
 * by `jest`.
 */

import type { AssetsResponseDto } from './assets-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: AssetsResponseDto = {
  totalAssets: 42,
  byStatus: {
    available: 18,
    deployed: 20,
    full_staged: 3,
    maintenance: 1,
  },
  bySize: [
    {
      subtype: '20-yard',
      total: 20,
      available: 10,
      deployed: 9,
      staged: 1,
    },
    {
      subtype: '30-yard',
      total: 22,
      available: 8,
      deployed: 11,
      staged: 2,
    },
  ],
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
// `bySize[].total` is picked as the sentinel because it is the most
// structurally-load-bearing field in the response: every consumer
// (analytics Assets tab + dashboard fleet-summary widget) reads the
// integer counts, and retyping `total` from `number` to `string` is
// the exact shape of drift that would silently break
// `formatCurrency`-adjacent numeric render pipelines downstream. Also
// mirrors the per-row integer-count fields — catches drift on the
// general class of count fields, not just one.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: AssetsResponseDto = {
  ..._validFixture,
  bySize: [
    {
      ..._validFixture.bySize[0],
      // @ts-expect-error — total must be number, not string.
      total: 'not-a-number',
    },
    ..._validFixture.bySize.slice(1),
  ],
};
void _invalidFixture;
