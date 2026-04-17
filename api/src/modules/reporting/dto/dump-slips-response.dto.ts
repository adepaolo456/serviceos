/**
 * Reporting DTO Phase 9 — Dump-slips ticket-level report response contract.
 *
 * Shape returned by `GET /reporting/dump-slips`. Drives the
 * dump-slips audit table on the analytics dashboard — individual
 * ticket rows with facility breakdown and summary totals over a
 * date window, filterable by facility, search, and status.
 *
 * Mirrors `getDumpSlips(tenantId, startDate?, endDate?,
 * dumpLocationId?, search?, status?)` in `reporting.service.ts`
 * (lines 316–396). The method runs three raw SQL queries via
 * `this.ticketRepo.query(...)`:
 *   1. Summary aggregate (single row via `[summaryRows]` destructure).
 *   2. Per-facility breakdown (GROUP BY dump_location_id/name,
 *      ORDER BY dump_location_name).
 *   3. Ticket-level list (20 columns, ORDER BY submitted_at DESC).
 *
 * Data-fetch pattern note: unlike Phase 8's `getDumpCosts` which
 * uses `createQueryBuilder().getRawMany()` + `...f` spread (Phase 8
 * spread-pattern lint finding), this method uses explicit
 * field-by-field projection in `.map(...)` callbacks. No `...` spread
 * over raw-row results. The Phase 8 spread-pattern lint hypothesis
 * is tested in Phase 9's Section D.
 *
 * Standing rule (Phase 0): if the return literal in `getDumpSlips`
 * changes, this DTO must change with it. TypeScript enforces this
 * via the method's explicit `Promise<DumpSlipsResponseDto>` return
 * type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`). Phase 9 is
 * the FIFTH reuse of `PeriodDto` (after Phase 3 customers, Phase 5
 * revenue, Phase 6 drivers, Phase 8 dump-costs).
 *
 * ─── Cross-references to Phase 8 (`195e95f`) ───
 * Phase 8's `DumpCostsResponseDto` aggregates dump-ticket data at
 * the facility level with a different time axis and filter set.
 * Specifically:
 *   - Phase 9 time axis: `t.submitted_at` (ticket submission time).
 *   - Phase 8 time axis: `t.created_at` (ticket creation time).
 *   - Phase 9 accepts: ?dumpLocationId / ?search / ?status filters.
 *   - Phase 8 accepts: only date window.
 *
 * Same-named aggregate fields (`byFacility[].totalCost` etc.) will
 * DIVERGE between the two endpoints whenever submission time
 * differs from creation time OR Phase 9's filters are applied.
 * Per-field cross-references documented below.
 *
 * The ticket-level rows in `tickets[]` serve as the row-level
 * aggregation-source for Phase 8's facility aggregates — a new
 * cross-reference variant introduced in Phase 9 (row-level input
 * for cross-endpoint aggregate). See `DumpSlipTicketRowDto`.
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class DumpSlipsSummaryDto {
  /** Total number of ticket rows matching the filter set. */
  @ApiProperty({
    description: 'Total ticket count in the window + filter set (COUNT(*)).',
  })
  totalTickets: number;

  /** Sum of weight tons across matching tickets. */
  @ApiProperty({
    description: 'Sum of weight in tons (COALESCE(SUM(weight_tons), 0)).',
  })
  totalWeightTons: number;

  /**
   * Sum of dump-facility cost across matching tickets — from
   * `SUM(dump_tickets.total_cost)`.
   *
   * Aggregation-source note: the per-row input for this sum is
   * `tickets[].totalDumpCost` (same SQL column, projection-renamed
   * to `totalDumpCost` on the ticket-level row). See
   * `DumpSlipTicketRowDto.totalDumpCost` for the per-row field.
   */
  @ApiProperty({
    description:
      'Sum of dump-facility cost (SUM(total_cost)). Aggregates tickets[].totalDumpCost.',
  })
  totalDumpCost: number;

  /** Sum of fuel + environmental cost. */
  @ApiProperty({
    description: 'Sum of fuel + env cost (SUM(fuel_env_cost)).',
  })
  totalFuelEnvCost: number;

  /**
   * Sum of customer-facing charges across matching tickets — from
   * `SUM(dump_tickets.customer_charges)`.
   *
   * ⚠ Wire-name note: this field is `totalCustomerCharges` (plural),
   * matching `byFacility[].totalCustomerCharges`. The ticket-level
   * per-row field is inconsistently named `totalCustomerCharge`
   * (singular) — preserved as-is from the service return; see
   * `DumpSlipTicketRowDto.totalCustomerCharge` JSDoc.
   */
  @ApiProperty({
    description:
      'Sum of customer charges (SUM(customer_charges)). Aggregates tickets[].totalCustomerCharge (plural/singular rename at ticket level).',
  })
  totalCustomerCharges: number;

  /**
   * Absolute margin (USD) — `totalCustomerCharges − totalDumpCost`,
   * computed in-memory on the service return. Equivalent to the
   * Phase 8-style `totalMargin` on a different scoping (submission
   * time + filters vs Phase 8's creation time + date-only).
   */
  @ApiProperty({
    description:
      'Absolute margin (USD): totalCustomerCharges − totalDumpCost. Computed in-memory.',
  })
  totalMargin: number;
}

export class DumpSlipsByFacilityRowDto {
  /**
   * Facility UUID — from `dump_tickets.dump_location_id`. Non-nullable
   * per the entity (`@Column({ name: 'dump_location_id', type: 'uuid' })`
   * without `nullable: true`). Group key in the service's GROUP BY.
   */
  @ApiProperty({
    description: 'Facility UUID from dump_tickets.dump_location_id.',
  })
  dumpLocationId: string;

  /** Facility display name — from `dump_tickets.dump_location_name`; non-nullable per entity. */
  @ApiProperty({
    description: 'Facility display name from dump_tickets.dump_location_name.',
  })
  dumpLocationName: string;

  /** Ticket count at this facility within the filter set. */
  @ApiProperty({ description: 'Ticket count at this facility (COUNT(*)).' })
  ticketCount: number;

  /** Sum of weight tons at this facility. */
  @ApiProperty({
    description: 'Sum of weight tons at this facility (SUM(weight_tons)).',
  })
  totalWeight: number;

  /**
   * Sum of **tonnage-portion** dump cost at this facility — from
   * `SUM(dump_tickets.dump_tonnage_cost)` aliased in SQL as
   * `total_dump_cost`.
   *
   * ⚠ Wire-name note: this field is named `totalDumpCost` but
   * represents ONLY the tonnage component, NOT the overall dump
   * cost. The overall dump cost for the facility is in `totalCost`
   * below. Preserved as-is from the service's SQL alias, which
   * conflates the label "dump cost" with "tonnage cost" at this
   * aggregate level.
   */
  @ApiProperty({
    description:
      'Tonnage-portion dump cost at this facility (SUM(dump_tonnage_cost)). NOT the overall total — see totalCost for that.',
  })
  totalDumpCost: number;

  /** Sum of fuel + environmental cost at this facility. */
  @ApiProperty({
    description:
      'Sum of fuel + env cost at this facility (SUM(fuel_env_cost)).',
  })
  totalFuelEnv: number;

  /**
   * Sum of **overall** dump cost at this facility — from
   * `SUM(dump_tickets.total_cost)`. This is the field that directly
   * corresponds to Phase 8's `DumpCostsByFacilityRowDto.totalCost`
   * in the aggregate semantic — BUT with different scoping (Phase 9
   * uses `submitted_at` time axis + filters; Phase 8 uses
   * `created_at` + date-only). Values will diverge whenever
   * submission differs from creation OR filters narrow the Phase 9
   * set.
   */
  @ApiProperty({
    description:
      'Overall dump cost at this facility (SUM(total_cost)). Semantically parallels Phase 8 totalCost with different time axis/filters.',
  })
  totalCost: number;

  /**
   * Sum of customer-facing charges at this facility — from
   * `SUM(dump_tickets.customer_charges)`. Parallels Phase 8's
   * `DumpCostsByFacilityRowDto` indirectly (Phase 8 exposes
   * `totalCustomerCharges` on the DTO too). Same filter-divergence
   * note as `totalCost`.
   */
  @ApiProperty({
    description:
      'Sum of customer charges at this facility (SUM(customer_charges)). Parallels Phase 8 with different scoping.',
  })
  totalCustomerCharges: number;
}

export class DumpSlipTicketOverageItemDto {
  /** Overage line-item type — e.g. `'weight_overage'`, `'material'`. */
  @ApiProperty({ description: 'Overage item type identifier.' })
  type: string;

  /** Human-readable overage label for the UI. */
  @ApiProperty({ description: 'Human-readable overage label.' })
  label: string;

  /** Quantity of the overage (units depend on type). */
  @ApiProperty({ description: 'Overage quantity (units depend on type).' })
  quantity: number;

  /** Charge per unit applied to this overage. */
  @ApiProperty({ description: 'Charge per unit for this overage.' })
  chargePerUnit: number;

  /** Computed line-item total — typically `quantity * chargePerUnit`. */
  @ApiProperty({
    description: 'Overage line-item total (usually quantity * chargePerUnit).',
  })
  total: number;
}

export class DumpSlipTicketRowDto {
  // ─── Ticket identity ───
  /** Dump-ticket UUID from `dump_tickets.id`. */
  @ApiProperty({ description: 'Dump-ticket UUID from dump_tickets.id.' })
  id: string;

  /**
   * Ticket number. Nullable per entity (`@Column({ name: 'ticket_number', nullable: true })`)
   * — older tickets created before ticket-number capture was
   * mandatory may be null.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Ticket number from dump_tickets.ticket_number. Nullable on legacy tickets created before the field was mandatory.',
  })
  ticketNumber: string | null;

  /**
   * Ticket submission timestamp. Entity column is
   * `type: 'timestamptz', nullable: true`; pg driver returns
   * TIMESTAMPTZ as `Date` instance server-side; JSON serializes to
   * ISO string over the wire. Nullable on tickets where submission
   * time wasn't captured (rare operational case).
   */
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'TIMESTAMPTZ from dump_tickets.submitted_at. Date server-side; ISO string on wire. Nullable when submission time was not captured.',
  })
  submittedAt: Date | null;

  // ─── Relational (job / customer) ───
  /** Linked job UUID — non-nullable per ticket entity (ticket must have a job). */
  @ApiProperty({ description: 'Linked job UUID from dump_tickets.job_id.' })
  jobId: string;

  /**
   * Linked job number from `LEFT JOIN jobs`. Nullable as a defensive
   * LEFT-JOIN posture — if the joined `jobs` row is missing
   * (orphaned, which shouldn't happen per FK constraint but the
   * query tolerates), null surfaces here.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Linked job number from LEFT JOIN jobs. Nullable defensively; FK constraint should prevent orphans in practice.',
  })
  jobNumber: string | null;

  /**
   * Customer display name — `CONCAT(customers.first_name, ' ', customers.last_name)`
   * via LEFT JOIN. Always a string (never null): Postgres `CONCAT`
   * treats NULL inputs as empty strings (distinct from the `||`
   * operator), so missing customer rows produce a single-space
   * string rather than NULL. Precedent documented in Phase 6
   * drivers DTO.
   */
  @ApiProperty({
    description:
      "Customer display name from CONCAT(first_name, ' ', last_name). Always a string per Postgres CONCAT NULL-as-empty semantics.",
  })
  customerName: string;

  // ─── Location / classification ───
  /** Dump facility name — non-nullable per entity. */
  @ApiProperty({
    description:
      'Dump facility display name from dump_tickets.dump_location_name.',
  })
  dumpLocationName: string;

  /** Waste type label — non-nullable per entity. */
  @ApiProperty({
    description: 'Waste type label from dump_tickets.waste_type.',
  })
  wasteType: string;

  // ─── Weight ───
  /** Ticket weight in tons — `Number()`-coerced from `decimal(8,2)`. */
  @ApiProperty({ description: 'Weight in tons (Number(weight_tons)).' })
  weightTons: number;

  // ─── Cost components (dump side) ───
  /** Tonnage-portion of dump cost — `Number(dump_tonnage_cost)`. */
  @ApiProperty({
    description: 'Tonnage-portion dump cost (Number(dump_tonnage_cost)).',
  })
  dumpTonnageCost: number;

  /** Fuel + environmental cost — `Number(fuel_env_cost)`. */
  @ApiProperty({ description: 'Fuel + env cost (Number(fuel_env_cost)).' })
  fuelEnvCost: number;

  /** Dump-facility surcharge — `Number(dump_surcharge_cost)`. */
  @ApiProperty({
    description: 'Dump facility surcharge (Number(dump_surcharge_cost)).',
  })
  dumpSurchargeCost: number;

  /**
   * Overall dump cost for this ticket — `Number(dump_tickets.total_cost)`.
   *
   * ⚠ Projection-rename note: the SQL column is `total_cost` but
   * the wire field is `totalDumpCost`. Preserved as-is from service
   * return (line 385).
   *
   * Aggregation-source cross-reference: this field is the row-level
   * input for `DumpCostsResponseDto.costsByFacility[].totalCost`
   * (Phase 8, `195e95f`) when aggregated with Phase 8's scoping
   * (`t.created_at` time axis, date-only filter). Also aggregates
   * into this DTO's `byFacility[].totalCost` with different scoping
   * (`t.submitted_at` time axis, additional filters). Row-level
   * field is the Σ input for both aggregate views; the aggregates
   * will diverge between endpoints whenever scoping differs.
   */
  @ApiProperty({
    description:
      'Overall dump cost (Number(total_cost)). Column name is total_cost on entity; renamed to totalDumpCost on wire. Row-level Σ input for Phase 8 facility aggregate.',
  })
  totalDumpCost: number;

  // ─── Cost components (customer side) ───
  /** Tonnage-portion customer charge — `Number(customer_tonnage_charge)`. */
  @ApiProperty({
    description:
      'Tonnage-portion customer charge (Number(customer_tonnage_charge)).',
  })
  customerTonnageCharge: number;

  /** Surcharge customer charge — `Number(customer_surcharge_charge)`. */
  @ApiProperty({
    description:
      'Surcharge customer charge (Number(customer_surcharge_charge)).',
  })
  customerSurchargeCharge: number;

  /**
   * Total customer-facing charge for this ticket — `Number(dump_tickets.customer_charges)`.
   *
   * ⚠ Wire-name inconsistency: this field is named `totalCustomerCharge`
   * (SINGULAR), while `summary.totalCustomerCharges` and
   * `byFacility[].totalCustomerCharges` are PLURAL. Preserved
   * as-is from service return (line 388). Documented so frontend
   * consumers don't assume the aggregate and row-level names match.
   *
   * Aggregation-source cross-reference: this field is the row-level
   * input for `DumpCostsResponseDto.costsByFacility[].totalCustomerCharges`
   * (Phase 8, `195e95f`) with Phase 8's scoping.
   */
  @ApiProperty({
    description:
      'Total customer charge (Number(customer_charges)). Wire name singular; summary/byFacility plural. Row-level Σ input for Phase 8 aggregates.',
  })
  totalCustomerCharge: number;

  // ─── Structured overage data ───
  /**
   * Overage line items — JSONB column with default `'[]'`. Fallback
   * to `[]` in service when value is falsy. Always an array, never
   * null; may be empty.
   */
  @ApiProperty({
    type: [DumpSlipTicketOverageItemDto],
    description:
      'Overage line items from jsonb column. Always an array (default empty); never null.',
  })
  overageItems: DumpSlipTicketOverageItemDto[];

  // ─── Workflow state ───
  /** Ticket status — e.g. `'submitted'`, `'approved'`, `'voided'`. Default `'submitted'`. */
  @ApiProperty({
    description:
      "Ticket status (e.g., 'submitted', 'approved', 'voided'). Not enumerated at DTO layer.",
  })
  status: string;

  /** Whether the ticket has been rolled into an invoice (entity default `false`). */
  @ApiProperty({
    description: 'True when the ticket has been invoiced; default false.',
  })
  invoiced: boolean;

  /**
   * Invoice UUID once the ticket is invoiced. Nullable until
   * `invoiced = true` (entity `@Column({ nullable: true })`).
   */
  @ApiProperty({
    nullable: true,
    description:
      'Invoice UUID once invoiced. Null until invoiced = true (workflow-state nullable).',
  })
  invoiceId: string | null;
}

export class DumpSlipsResponseDto {
  /** Summary aggregates across the filtered ticket set. */
  @ApiProperty({
    type: DumpSlipsSummaryDto,
    description: 'Summary aggregates across the filtered ticket set.',
  })
  summary: DumpSlipsSummaryDto;

  /**
   * Per-facility breakdown of the filtered ticket set, ordered by
   * `dump_location_name`. See per-field JSDoc for the two
   * wire-name-vs-semantic notes (`totalDumpCost` is tonnage-only;
   * `totalCost` is overall).
   */
  @ApiProperty({
    type: [DumpSlipsByFacilityRowDto],
    description:
      'Per-facility breakdown, ordered by dump_location_name. See sub-DTO JSDoc for semantic notes.',
  })
  byFacility: DumpSlipsByFacilityRowDto[];

  /**
   * Ticket-level rows matching the filter set, ordered by
   * `submitted_at DESC`. No server-side row cap — the full matching
   * set is returned. Consumers should paginate client-side or apply
   * tighter filters if the set is large.
   */
  @ApiProperty({
    type: [DumpSlipTicketRowDto],
    description:
      'Ticket-level rows, ordered by submitted_at DESC. No server-side cap.',
  })
  tickets: DumpSlipTicketRowDto[];

  /**
   * Window bounds. If the caller omits `startDate`, the service
   * defaults to Monday of the current week; if `endDate` is omitted,
   * the service defaults to today. Shared sub-DTO reused across 8
   * reporting endpoints; Phase 9 is the fifth consumer.
   */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds. Defaults to Monday-of-this-week → today when unspecified. Fifth PeriodDto consumer.',
  })
  period: PeriodDto;
}
