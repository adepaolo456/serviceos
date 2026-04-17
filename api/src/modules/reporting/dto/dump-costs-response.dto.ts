/**
 * Reporting DTO Phase 8 — Dump costs report response contract.
 *
 * Shape returned by `GET /reporting/dump-costs`. Drives the dump-cost
 * breakdown panel on the analytics dashboard — total dump-facility
 * costs and corresponding customer charges within a date window,
 * plus per-facility and per-waste-type breakdowns.
 *
 * Mirrors `getDumpCosts(tenantId, startDate?, endDate?)` in
 * `reporting.service.ts` (lines 263–309). The method composes three
 * SQL aggregates over `dump_tickets` filtered by `t.created_at` in
 * the window: overall totals (single `getRawOne()`), per-facility
 * GROUP BY `dump_location_id/dump_location_name`, per-waste-type
 * GROUP BY `waste_type`.
 *
 * Standing rule (Phase 0): if the return literal in `getDumpCosts`
 * changes, this DTO must change with it. TypeScript enforces this
 * via the method's explicit `Promise<DumpCostsResponseDto>` return
 * type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`). Phase 8 is
 * the FOURTH reuse of `PeriodDto` (after Phase 3 customers, Phase 5
 * revenue, Phase 6 drivers) — shared-sub-DTO pattern continues to
 * hold across half the windowed reporting cluster.
 *
 * ─── Risk #3 note ───
 * This DTO contains `marginPercent` — the second `*Percent` field to
 * ship in the reporting module after Phase 1 v2's `grossMarginPercent`
 * (`86266d7`). Module-wide 0-100 convention holds (verified `* 100`
 * in the service formula at line 304). However, the formulas are
 * NOT interchangeable across the two fields — Phase 1 v2 divides
 * margin by REVENUE (standard gross margin); this DTO divides margin
 * by DUMP COST (markup-over-cost). Per-field JSDoc documents the
 * distinction explicitly.
 *
 * ─── totalCustomerCharges note ───
 * `totalCustomerCharges` is a THIRD revenue-adjacent semantic — it
 * represents what customers were charged for dump-ticket activity
 * specifically (from `dump_tickets.customer_charges`). It is NOT
 * the same as `RevenueResponseDto.totalRevenue` (INVOICED, from
 * `invoices.total`) or `ProfitResponseDto.totalRevenue` (COLLECTED,
 * from `payments.amount - refunded_amount`). Documented in-field
 * without triggering the Risk #1 three-way collision — no wire-name
 * collision exists.
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class DumpCostsByFacilityRowDto {
  /**
   * Facility UUID — from `dump_tickets.dump_location_id`. Nullable
   * because the column can be null on tickets recorded before a
   * facility is assigned or in edge cases; GROUP BY preserves NULL
   * as a distinct group. No server-side COALESCE fallback.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Facility UUID from dump_tickets.dump_location_id. Null preserved through GROUP BY.',
  })
  dumpLocationId: string | null;

  /**
   * Facility display name — from `dump_tickets.dump_location_name`.
   * Same nullability as `dumpLocationId` (they travel together in
   * the group key).
   */
  @ApiProperty({
    nullable: true,
    description:
      'Facility display name from dump_tickets.dump_location_name. Nullable, same group as dumpLocationId.',
  })
  dumpLocationName: string | null;

  /** Sum of dump-facility costs at this facility — `Number(SUM(t.total_cost))`. */
  @ApiProperty({
    description: 'Sum of dump-facility costs at this facility (USD).',
  })
  totalCost: number;

  /** Trip count at this facility — `Number(COUNT(*))`. */
  @ApiProperty({ description: 'Trip count at this facility (COUNT(*)).' })
  tripCount: number;

  /** Mean cost per trip — `Number(AVG(t.total_cost))`. */
  @ApiProperty({
    description: 'Mean cost per trip at this facility (AVG(total_cost)).',
  })
  averageCostPerTrip: number;
}

export class DumpCostsByWasteTypeRowDto {
  /**
   * Waste type label — from `dump_tickets.waste_type`. Nullable
   * because the column can be null; GROUP BY preserves NULL as a
   * distinct group. No server-side COALESCE fallback.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Waste type from dump_tickets.waste_type. Null preserved through GROUP BY.',
  })
  wasteType: string | null;

  /** Sum of costs for this waste type — `Number(SUM(t.total_cost))`. */
  @ApiProperty({ description: 'Sum of costs for this waste type (USD).' })
  totalCost: number;

  /** Sum of weight in tons for this waste type — `Number(SUM(t.weight_tons))`. */
  @ApiProperty({
    description: 'Sum of tonnage for this waste type (SUM(weight_tons)).',
  })
  totalWeight: number;
}

export class DumpCostsResponseDto {
  /**
   * Total dump-facility costs paid by the tenant in the window —
   * `Number(SUM(dump_tickets.total_cost))` filtered by
   * `t.created_at` in the window. This is the raw cost owed to
   * dump facilities per their pricing (tonnage + surcharges + fuel
   * + env fees), NOT what the tenant charges its customers.
   */
  @ApiProperty({
    description:
      'Total dump-facility costs paid in the window (SUM(dump_tickets.total_cost)).',
  })
  totalDumpCosts: number;

  /**
   * Total amount charged to customers for dump-ticket activity in
   * the window — `Number(SUM(dump_tickets.customer_charges))`.
   *
   * ⚠ Cross-reference note: this is a distinct revenue-adjacent
   * semantic — NOT the same as `RevenueResponseDto.totalRevenue`
   * (INVOICED, sourced from `invoices.total`) nor
   * `ProfitResponseDto.totalRevenue` (COLLECTED, sourced from
   * `payments.amount - refunded_amount`). This field represents
   * the dump-ticket-scoped customer-facing charge total, which may
   * flow through to invoice line items but is reported here in
   * ticket-native aggregation. Do not cross-wire with the two
   * `totalRevenue` fields — wire names differ, but the semantic
   * adjacency is worth naming.
   */
  @ApiProperty({
    description:
      'Total customer charges for dump-ticket activity in the window (SUM(dump_tickets.customer_charges)). Distinct from revenue.totalRevenue and profit.totalRevenue.',
  })
  totalCustomerCharges: number;

  /**
   * Absolute margin (USD) — `totalCustomerCharges − totalDumpCosts`.
   * Positive means the tenant marks up dump activity above its
   * facility cost; negative means the tenant undercharges customers
   * relative to facility cost (a red flag on a healthy book).
   */
  @ApiProperty({
    description:
      'Absolute margin (USD): totalCustomerCharges − totalDumpCosts.',
  })
  totalMargin: number;

  /**
   * Markup over dump cost, expressed on a 0–100 scale (e.g., 42.7 =
   * 42.7%, not 0.427).
   *
   * Formula: `((totalCustomerCharges − totalDumpCosts) / totalDumpCosts) * 100`
   *   where:
   *     - Numerator: absolute margin (what the tenant earns above
   *       facility cost on dump activity in the window).
   *     - Denominator: totalDumpCosts (what the tenant paid to dump
   *       facilities in the window).
   * Guard: returns `0` when `totalDumpCosts === 0` to prevent
   * divide-by-zero.
   *
   * ⚠ Name-vs-formula distinction from Phase 1 v2's
   * `grossMarginPercent` (`86266d7`): Phase 1 v2 uses
   * `(grossProfit / totalRevenue) * 100` — a REVENUE denominator
   * (standard gross margin). This field uses a COST denominator —
   * mathematically a MARKUP-OVER-COST, not a margin-over-revenue.
   * The two ratios will diverge whenever the tenant's markup is
   * nonzero; they measure related but distinct concepts. Named
   * `marginPercent` by service convention; documented here so a
   * future reader does not assume formula equivalence with Phase 1
   * v2.
   *
   * Module-wide 0-100 convention established in Phase 1 v2
   * (`86266d7`). All `*Percent` fields in this module use 0-100
   * scale; the SCALE is portable across fields even when the
   * FORMULA is not.
   */
  @ApiProperty({
    description:
      'Markup over dump cost in 0–100 range. (custCharges − dumpCosts) / dumpCosts * 100. 0 when dumpCosts is 0.',
  })
  marginPercent: number;

  /**
   * Per-facility cost breakdown, grouped by
   * `dump_location_id / dump_location_name`. One row per facility
   * (plus potentially one NULL-group row). No server-side ordering.
   */
  @ApiProperty({
    type: [DumpCostsByFacilityRowDto],
    description:
      'Per-facility cost breakdown, grouped by dump_location_id/name. Null group preserved. No server ordering.',
  })
  costsByFacility: DumpCostsByFacilityRowDto[];

  /**
   * Per-waste-type cost + weight breakdown, grouped by
   * `waste_type`. One row per distinct waste type (plus potentially
   * one NULL-group row). No server-side ordering.
   */
  @ApiProperty({
    type: [DumpCostsByWasteTypeRowDto],
    description:
      'Per-waste-type cost + weight breakdown, grouped by waste_type. Null group preserved. No server ordering.',
  })
  costsByWasteType: DumpCostsByWasteTypeRowDto[];

  /** Window bounds — shared sub-DTO reused across 8 reporting endpoints. */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds — shared sub-DTO reused across 8 reporting endpoints.',
  })
  period: PeriodDto;
}
