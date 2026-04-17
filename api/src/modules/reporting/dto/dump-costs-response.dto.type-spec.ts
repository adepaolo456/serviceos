/**
 * Type-only sanity check for `DumpCostsResponseDto`.
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
 * Phase 8 note: fourth reuse of `PeriodDto` (after Phase 3 customers,
 * Phase 5 revenue, Phase 6 drivers). Second `*Percent` field in the
 * module (after Phase 1 v2's `grossMarginPercent`). Sentinel placed
 * on `marginPercent` — the Risk #3 field specifically — to reinforce
 * the 0-100 scale contract at the type level, complementing the
 * JSDoc documentation side. Sentinel placement rationale documented
 * in Phase 8 Section C.
 *
 * Positive fixture exercises:
 *   - Both nullable group-key fields (dumpLocationId, wasteType) with
 *     at least one null-group row each — GROUP BY NULL preservation.
 *   - Realistic markup numbers (marginPercent = 42.7, not 0.427) to
 *     visually test the 0-100 scale.
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a-c / Phase 5 / Phase 6 / Phase 7 template.
 */

import type { DumpCostsResponseDto } from './dump-costs-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: DumpCostsResponseDto = {
  totalDumpCosts: 18400,
  totalCustomerCharges: 26260,
  totalMargin: 7860,
  marginPercent: 42.7,
  costsByFacility: [
    {
      dumpLocationId: 'facility-uuid-1',
      dumpLocationName: 'Regional Transfer Station',
      totalCost: 12800,
      tripCount: 47,
      averageCostPerTrip: 272.34,
    },
    {
      dumpLocationId: 'facility-uuid-2',
      dumpLocationName: 'County Landfill',
      totalCost: 5200,
      tripCount: 18,
      averageCostPerTrip: 288.89,
    },
    {
      dumpLocationId: null,
      dumpLocationName: null,
      totalCost: 400,
      tripCount: 2,
      averageCostPerTrip: 200,
    },
  ],
  costsByWasteType: [
    {
      wasteType: 'construction_debris',
      totalCost: 11200,
      totalWeight: 68.5,
    },
    {
      wasteType: 'household',
      totalCost: 7200,
      totalWeight: 42.1,
    },
    {
      wasteType: null,
      totalCost: 0,
      totalWeight: 0,
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
// `marginPercent` is picked as the sentinel because:
//   1. Phase 8's primary contribution is Risk #3 re-application —
//      the first *Percent field to ship since Phase 1 v2's
//      grossMarginPercent. The sentinel should exercise the
//      ratio-typed-as-number invariant that IS this phase's new
//      contribution.
//   2. Percent fields are particularly prone to silent breakage: a
//      string percent value will concat cleanly with '%' at the UI
//      layer and look superficially correct, masking downstream
//      arithmetic bugs (averaging, formatting with toFixed, etc.).
//      Type-level enforcement at the DTO boundary is the only real
//      defense.
//   3. Alternatives explicitly considered:
//      - costsByFacility[].totalCost (deepest array-leaf currency
//        field, Phase 7 precedent): exercises nested-array-spread
//        type preservation, but that pattern is already
//        well-defended across Phases 3/4a-c/5/6/7. Phase 8 adds no
//        new structural invariant for the spread pattern.
//      - totalMargin or totalCustomerCharges (top-level currency
//        scalars): structurally flat; weaker test than the new
//        ratio-type invariant.
//   4. The sentinel placement trades Phase 7's
//      "structurally-deepest" discipline for "semantically-aligned
//      to the phase's primary contribution" — a principled
//      one-phase exception, documented here and in Section C.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: DumpCostsResponseDto = {
  ..._validFixture,
  // @ts-expect-error — marginPercent must be number, not string.
  marginPercent: 'not-a-number',
};
void _invalidFixture;
