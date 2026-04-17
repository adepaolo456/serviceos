/**
 * Type-only sanity check for `DumpSlipsResponseDto`.
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
 * Phase 9 note: first Tier-C phase (20 fields per ticket row).
 * Fifth reuse of `PeriodDto`. Positive fixture exercises distinct
 * null-pattern business conditions (not just "one arbitrary field
 * null"). Sentinel placed at the deepest array leaf
 * (`tickets[].overageItems[].total`) — double-nested currency field
 * — to exercise the array-within-array type-preservation invariant
 * that Phase 9 introduces. Sentinel rationale in Section C.
 *
 * ─── Null-pattern rubric for positive fixture (Phase 9 Step 3) ───
 * Row 1 — "fully populated": all nullable fields set (baseline).
 * Row 2 — "legacy-data nulls": ticketNumber null (created before
 *   ticket-number capture became mandatory). submittedAt set (not
 *   legacy-era).
 * Row 3 — "workflow-state nulls": invoiceId null (ticket not yet
 *   invoiced; invoiced flag false).
 * Row 4 — "operational/relational nulls": jobNumber null (LEFT JOIN
 *   yielded no match — defensive edge case). submittedAt null
 *   (submission time wasn't captured — rare but allowed by entity).
 *
 * Together these four rows cover the four distinct null-pattern
 * business categories identified in Phase 9 Section A.
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a-c / Phase 5 / Phase 6 / Phase 7 / Phase 8 template.
 */

import type { DumpSlipsResponseDto } from './dump-slips-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: DumpSlipsResponseDto = {
  summary: {
    totalTickets: 47,
    totalWeightTons: 182.75,
    totalDumpCost: 9840.5,
    totalFuelEnvCost: 1420,
    totalCustomerCharges: 14400,
    totalMargin: 4559.5,
  },
  byFacility: [
    {
      dumpLocationId: 'facility-uuid-1',
      dumpLocationName: 'Regional Transfer Station',
      ticketCount: 32,
      totalWeight: 128.5,
      totalDumpCost: 5120,
      totalFuelEnv: 960,
      totalCost: 6200,
      totalCustomerCharges: 9600,
    },
    {
      dumpLocationId: 'facility-uuid-2',
      dumpLocationName: 'County Landfill',
      ticketCount: 15,
      totalWeight: 54.25,
      totalDumpCost: 2720,
      totalFuelEnv: 460,
      totalCost: 3640.5,
      totalCustomerCharges: 4800,
    },
  ],
  tickets: [
    // Row 1 — fully populated baseline.
    {
      id: 'ticket-uuid-1',
      ticketNumber: 'T-2026-0142',
      submittedAt: new Date('2026-03-15T09:30:00Z'),
      jobId: 'job-uuid-1',
      jobNumber: 'J-2026-0842',
      customerName: 'Jane Doe',
      dumpLocationName: 'Regional Transfer Station',
      wasteType: 'construction_debris',
      weightTons: 3.8,
      dumpTonnageCost: 152,
      fuelEnvCost: 28,
      dumpSurchargeCost: 15,
      totalDumpCost: 195,
      customerTonnageCharge: 228,
      customerSurchargeCharge: 22,
      totalCustomerCharge: 275,
      overageItems: [
        {
          type: 'weight_overage',
          label: 'Weight over 3t',
          quantity: 0.8,
          chargePerUnit: 25,
          total: 20,
        },
      ],
      status: 'approved',
      invoiced: true,
      invoiceId: 'invoice-uuid-501',
    },
    // Row 2 — legacy-data nulls: ticketNumber missing (created before
    // the ticket-number field was mandatory); everything else set.
    {
      id: 'ticket-uuid-2',
      ticketNumber: null,
      submittedAt: new Date('2025-08-04T14:10:00Z'),
      jobId: 'job-uuid-2',
      jobNumber: 'J-2025-0320',
      customerName: 'Acme Construction LLC',
      dumpLocationName: 'Regional Transfer Station',
      wasteType: 'construction_debris',
      weightTons: 5.2,
      dumpTonnageCost: 208,
      fuelEnvCost: 30,
      dumpSurchargeCost: 15,
      totalDumpCost: 253,
      customerTonnageCharge: 312,
      customerSurchargeCharge: 25,
      totalCustomerCharge: 337,
      overageItems: [],
      status: 'approved',
      invoiced: true,
      invoiceId: 'invoice-uuid-211',
    },
    // Row 3 — workflow-state nulls: ticket not yet invoiced.
    {
      id: 'ticket-uuid-3',
      ticketNumber: 'T-2026-0145',
      submittedAt: new Date('2026-03-16T08:00:00Z'),
      jobId: 'job-uuid-3',
      jobNumber: 'J-2026-0850',
      customerName: 'Bob Smith',
      dumpLocationName: 'County Landfill',
      wasteType: 'household',
      weightTons: 2.1,
      dumpTonnageCost: 84,
      fuelEnvCost: 22,
      dumpSurchargeCost: 10,
      totalDumpCost: 116,
      customerTonnageCharge: 126,
      customerSurchargeCharge: 14,
      totalCustomerCharge: 140,
      overageItems: [],
      status: 'submitted',
      invoiced: false,
      invoiceId: null,
    },
    // Row 4 — operational/relational nulls: jobNumber null (LEFT JOIN
    // defensive edge) + submittedAt null (capture missed).
    {
      id: 'ticket-uuid-4',
      ticketNumber: 'T-2026-0146',
      submittedAt: null,
      jobId: 'job-uuid-4',
      jobNumber: null,
      customerName: 'Unknown Customer',
      dumpLocationName: 'County Landfill',
      wasteType: 'other',
      weightTons: 1.5,
      dumpTonnageCost: 60,
      fuelEnvCost: 20,
      dumpSurchargeCost: 8,
      totalDumpCost: 88,
      customerTonnageCharge: 90,
      customerSurchargeCharge: 10,
      totalCustomerCharge: 100,
      overageItems: [],
      status: 'submitted',
      invoiced: false,
      invoiceId: null,
    },
  ],
  period: {
    start: '2026-03-09',
    end: '2026-03-16',
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `tickets[].overageItems[].total` is picked as the sentinel because:
//   1. It is the DEEPEST leaf introduced in Phase 9 — a currency
//      field nested two array levels deep (tickets[] →
//      overageItems[] → total). No prior phase has exercised the
//      array-within-array type-preservation invariant at the
//      sentinel. Phase 9 introduces it; the sentinel should
//      exercise it.
//   2. Currency drift (number → string) on a nested-nested leaf is
//      the hardest defect to catch without a sentinel at that exact
//      level. Any higher-level sentinel (row-level
//      `totalCustomerCharge`, container-level `summary.totalMargin`)
//      passes through even when inner leaves drift.
//   3. Alternatives explicitly considered:
//      - `tickets[].totalCustomerCharge` (deepest single-array leaf,
//        Phase 7 precedent): already-defended structural invariant
//        across Phases 3/4a-c/5/6/7. Phase 9 adds no new pattern
//        there.
//      - `summary.totalMargin` (fixed-key container leaf): shallow.
//        Phase 7 precedent prefers deeper.
//      - A nullable field's type-precision drift (e.g.,
//        `ticketNumber: string | null` → `string | undefined`):
//        exercises nullability precision but not the new Phase 9
//        array-within-array structural invariant.
//   4. Phase 8 placed the sentinel on the Risk #3 field (principled
//      one-phase deviation for its primary contribution). Phase 9
//      returns to Phase 7's structurally-deepest discipline,
//      applied to the new double-nested context.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: DumpSlipsResponseDto = {
  ..._validFixture,
  tickets: [
    {
      ..._validFixture.tickets[0],
      overageItems: [
        {
          ..._validFixture.tickets[0].overageItems[0],
          // @ts-expect-error — total must be number, not string.
          total: 'not-a-number',
        },
      ],
    },
    ..._validFixture.tickets.slice(1),
  ],
};
void _invalidFixture;
