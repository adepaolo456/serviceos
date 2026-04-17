/**
 * Reporting DTO Phase 10 — Lifecycle-aware KPI report response contract.
 *
 * Shape returned by `GET /reporting/lifecycle`. Drives the rentals
 * dashboard's lifecycle view — summary KPIs + per-chain
 * performance rows + zero-filled trend series in a single call.
 *
 * Mirrors `getLifecycleReport(tenantId, startDate?, endDate?,
 * statusFilter, groupBy)` in `reporting.service.ts` (lines
 * 1032–1237). The method composes five queries (chain entities +
 * batched revenue / cost / exchange-count / address aggregates)
 * then assembles in-memory summary KPIs and a zero-filled trend
 * series via `buildTrend` / `buildEmptyTrend` helpers.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getLifecycleReport` changes, this DTO must change with it.
 * TypeScript enforces via the explicit
 * `Promise<LifecycleReportResponseDto>` return type.
 *
 * ─── Structural deviations from the module's prior pattern ───
 *
 * 1. snake_case wire format. FIRST module-internal naming-convention
 *    deviation in the reporting DTO project. All prior DTOs (Phases
 *    1 v2 / 2 / 3 / 4 cluster / 5 / 6 / 7 / 8 / 9) use camelCase.
 *    This DTO uses snake_case for every field at every level because
 *    the service deliberately emits snake_case and the primary
 *    consumer (`web/src/app/(dashboard)/reports/lifecycle/page.tsx`)
 *    declares mirror TypeScript interfaces in snake_case. No
 *    transform layer exists in either direction. Standing rule #3
 *    (Backend truth) governs: DTO mirrors service reality, not
 *    module convention. Intentional, not normalized.
 *
 * 2. No `period` field despite being windowed. FIRST windowed
 *    reporting endpoint that does not echo `period: PeriodDto` in
 *    the return envelope. Every prior windowed endpoint (profit,
 *    customers, revenue, drivers, dump-costs, dump-slips) included
 *    period. Lifecycle deliberately does not. Service behavior
 *    preserved; no service-side fix is in scope for this project.
 *
 * 3. Handler-level role guard. The `lifecycleReport` handler carries
 *    `@UseGuards(RolesGuard)` + `@Roles('owner', 'admin',
 *    'dispatcher')` — first reporting endpoint with explicit
 *    role-based authorization beyond tenant scoping. Not modeled in
 *    the DTO itself (DTO concerns the response body contract); the
 *    decorators are preserved byte-for-byte on the handler during
 *    annotation.
 *
 * ─── Risk #1 fourth revenue semantic (advisory, not collision) ───
 *
 * `summary.total_rental_revenue` is the FOURTH revenue-adjacent
 * semantic in the reporting module. It is rental-chain-scoped and
 * excludes voided invoices. Per-field JSDoc documents all four
 * semantics with commit citations. No wire-name collision fires
 * (snake_case vs camelCase precludes it); the three-way hard stop
 * from Phase 8's scope does not apply. Treatment is advisory
 * cross-reference only.
 *
 * ─── Risk #3 third *Percent-family variant ───
 *
 * `summary.exchange_rate` is the THIRD `*Percent`-family field,
 * introducing the count-over-count rate variant. Module-wide 0–100
 * scale holds across all three variants; formula family is
 * field-specific. Per-field JSDoc documents the three-variant
 * progression (Phase 1 v2 revenue-denominator → Phase 8
 * cost-denominator → Phase 10 count-over-count).
 */

import { ApiProperty } from '@nestjs/swagger';

export class LifecycleTrendPointDto {
  /**
   * Bucket key for the trend series. Granularity follows the
   * `?groupBy=` param:
   *   - `'day'` → `YYYY-MM-DD`
   *   - `'week'` → `YYYY-Www` (ISO week)
   *   - `'month'` → `YYYY-MM`
   * Default granularity is month when the param is unset or
   * unrecognized.
   */
  @ApiProperty({
    description:
      'Bucket key (YYYY-MM-DD / YYYY-Www / YYYY-MM per ?groupBy=). Default month.',
  })
  period: string;

  /** Sum of chain revenues in the bucket, rounded to 2 decimals. */
  @ApiProperty({
    description: 'Sum of chain revenues in the bucket (rounded 2dp).',
  })
  revenue: number;

  /** Sum of chain costs in the bucket, rounded to 2 decimals. */
  @ApiProperty({
    description: 'Sum of chain costs in the bucket (rounded 2dp).',
  })
  cost: number;

  /** Sum of chain profits in the bucket, rounded to 2 decimals. */
  @ApiProperty({
    description: 'Sum of chain profits in the bucket (rounded 2dp).',
  })
  profit: number;

  /** Count of chains in the bucket with `status = 'completed'`. */
  @ApiProperty({
    description: "Count of chains in the bucket with status = 'completed'.",
  })
  completed_chains: number;
}

export class LifecycleChainRowDto {
  /** Rental chain UUID from `rental_chains.id`. */
  @ApiProperty({ description: 'Rental chain UUID from rental_chains.id.' })
  chain_id: string;

  /**
   * Customer display name — `${first_name} ${last_name}` trimmed,
   * with literal fallbacks `'(no name)'` (both names empty) or
   * `'(no customer)'` (customer relation missing). Always a string.
   *
   * Wire fallbacks differ from other reporting DTOs: Phase 3/4 use
   * `'Unknown Customer'`; Phase 7 uses `'Unknown'`; this DTO uses
   * `'(no name)'` / `'(no customer)'`. Preserved as-is — do not
   * normalize.
   */
  @ApiProperty({
    description:
      "Customer display name. Literal fallbacks '(no name)' or '(no customer)'; always string.",
  })
  customer_name: string;

  /**
   * Delivery address — joined `street, city, state` from the
   * drop-off job's service address JSON. Literal fallback `'—'`
   * (em-dash) when no parts present or address absent. Always a
   * string.
   */
  @ApiProperty({
    description:
      "Joined drop-off address (street, city, state). Em-dash '—' fallback when absent.",
  })
  address: string;

  /**
   * Dumpster size label from `rental_chains.dumpster_size`. Empty
   * string `''` fallback when the column is null on the entity
   * (distinct from the other string fields' fallbacks).
   */
  @ApiProperty({
    description:
      "Dumpster size from rental_chains.dumpster_size. Empty-string '' fallback.",
  })
  dumpster_size: string;

  /**
   * Drop-off date (YYYY-MM-DD) — `rental_chains.drop_off_date`. Used
   * as the window-filter axis for the endpoint's date range.
   */
  @ApiProperty({
    description:
      'Drop-off date from rental_chains.drop_off_date (YYYY-MM-DD). Window axis.',
  })
  drop_off_date: string;

  /**
   * Scheduled pickup date (YYYY-MM-DD), nullable. Null when pickup
   * is not yet scheduled for an active chain.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Scheduled pickup date from rental_chains.expected_pickup_date. Null when pickup not yet scheduled.',
  })
  expected_pickup_date: string | null;

  /**
   * Realized pickup date (YYYY-MM-DD), nullable. Null while the
   * chain is still active (pickup has not yet occurred).
   */
  @ApiProperty({
    nullable: true,
    description:
      'Realized pickup date from rental_chains.actual_pickup_date. Null until pickup occurs.',
  })
  actual_pickup_date: string | null;

  /**
   * Chain status — e.g., `'active'`, `'completed'`. Drives
   * downstream KPIs (active_rentals / completed_rentals /
   * overdue_rentals counts in summary).
   */
  @ApiProperty({
    description:
      "Chain status (e.g., 'active', 'completed'). Not enumerated at DTO layer.",
  })
  status: string;

  /**
   * Rental revenue for this chain — `COALESCE(SUM(invoices.total), 0)`
   * over non-voided invoices linked by `invoice.rental_chain_id`.
   * Summed into `summary.total_rental_revenue` (same-endpoint
   * aggregate; documented on the summary field).
   */
  @ApiProperty({
    description:
      'Rental revenue for this chain (SUM(invoices.total) where voided_at IS NULL and rental_chain_id matches).',
  })
  revenue: number;

  /**
   * Lifecycle cost for this chain — `SUM(job_costs.amount)` for jobs
   * linked via `task_chain_links`. Summed into
   * `summary.total_lifecycle_cost`.
   */
  @ApiProperty({
    description:
      'Lifecycle cost for this chain (SUM(job_costs.amount) via task_chain_links).',
  })
  cost: number;

  /**
   * Profit for this chain — `Math.round((revenue − cost) * 100) / 100`.
   * Computed in-memory; never stored. Summed into
   * `summary.total_profit`.
   */
  @ApiProperty({
    description: 'Profit: (revenue − cost) rounded 2dp. Computed in-memory.',
  })
  profit: number;

  /**
   * Rental duration in whole days — derived from
   * `drop_off_date → actual_pickup_date`. Nullable: null when
   * either pickup date is missing. Completed chains with both
   * dates present contribute to `summary.average_rental_duration`.
   */
  @ApiProperty({
    nullable: true,
    description:
      'Rental duration in days (drop_off_date → actual_pickup_date). Null when either date missing.',
  })
  duration_days: number | null;

  /**
   * Count of non-cancelled exchange tasks on this chain (from
   * `task_chain_links` with `task_type = 'exchange'` and
   * `status != 'cancelled'`). Used in the `summary.exchange_rate`
   * numerator (chain counts toward numerator iff this value > 0).
   */
  @ApiProperty({
    description:
      'Non-cancelled exchange-task count on this chain. Contributes to summary.exchange_rate when > 0.',
  })
  exchange_count: number;
}

export class LifecycleSummaryDto {
  /**
   * Total rental revenue for chains whose drop_off_date falls within
   * the window. Formula:
   *   Σ invoices.total WHERE
   *     invoice.rental_chain_id IN (window-filtered chain ids)
   *     AND invoice.voided_at IS NULL
   *
   * ⚠ FOURTH revenue-adjacent semantic in the reporting module.
   * Semantically proximate but NOT interchangeable with:
   *   - ProfitResponseDto.totalRevenue (Phase 1 v2, `86266d7`):
   *     COLLECTED — payments-applied basis, all invoices.
   *   - RevenueResponseDto.totalRevenue (Phase 5, `dd7fea8`):
   *     INVOICED — SUM(invoices.total) revenue-status, windowed by
   *     invoice.created_at.
   *   - DumpCostsResponseDto.totalCustomerCharges (Phase 8,
   *     `195e95f`): DUMP-TICKET-SCOPED customer charges.
   *   - This field: RENTAL-CHAIN-SCOPED invoiced, windowed by
   *     chain.drop_off_date, voided invoices excluded.
   *
   * No wire-name collision (snake_case vs camelCase precludes it),
   * so the three-way hard stop from Phase 8's scope does not apply.
   * Documented here as advisory cross-reference only — consumers
   * needing invoiced-all or collected semantics should use the
   * upstream DTO, not this field.
   */
  @ApiProperty({
    description:
      'Rental-chain-scoped invoiced revenue (SUM(invoices.total), voided excluded, windowed by chain.drop_off_date). Fourth revenue semantic; advisory cross-reference on JSDoc.',
  })
  total_rental_revenue: number;

  /**
   * Total lifecycle cost for chains in the window — `SUM(job_costs.amount)`
   * for jobs linked to these chains via `task_chain_links`. Distinct
   * from dump-cost endpoints: this sum is job-cost-based, not
   * dump-ticket-based.
   */
  @ApiProperty({
    description:
      'Sum of job_costs.amount for jobs linked to window chains via task_chain_links (rounded 2dp).',
  })
  total_lifecycle_cost: number;

  /** Total profit — `Math.round((totalRevenue − totalCost) * 100) / 100`. */
  @ApiProperty({
    description:
      'Total profit (totalRevenue − totalCost) rounded 2dp. Computed in-memory.',
  })
  total_profit: number;

  /**
   * Mean rental duration in days across COMPLETED chains with both
   * drop-off and actual-pickup dates. 1-decimal rounding. Zero when
   * no completed chains in the window.
   */
  @ApiProperty({
    description:
      'Mean rental duration (days) across completed chains with both dates. 1-decimal rounding.',
  })
  average_rental_duration: number;

  /** Count of chains in window with `status = 'active'`. */
  @ApiProperty({
    description: "Count of chains in window with status = 'active'.",
  })
  active_rentals: number;

  /**
   * Count of active chains with `expected_pickup_date < today`
   * (server's current date). Subset of `active_rentals`.
   */
  @ApiProperty({
    description:
      'Count of active chains with expected_pickup_date < today. Subset of active_rentals.',
  })
  overdue_rentals: number;

  /** Count of chains in window with `status = 'completed'`. */
  @ApiProperty({
    description: "Count of chains in window with status = 'completed'.",
  })
  completed_rentals: number;

  /**
   * Exchange rate expressed on a 0–100 scale (e.g., 42.7 = 42.7%,
   * not 0.427) with 1-decimal rounding.
   *
   * Formula: (chainsWithExchange.length / chainRows.length) * 1000 / 10
   *   where:
   *     - Numerator: count of chains with ≥1 non-cancelled exchange
   *       in the window.
   *     - Denominator: total chains in the window (status-filtered).
   *   Ratio meaning: percentage of rentals that required a container
   *   swap during their lifecycle.
   *   Guard: division by zero is not possible (upstream short-circuit
   *   returns zero-filled envelope when chainRows.length === 0).
   *
   * THIRD *Percent-family variant in the reporting module. Formula
   * family progression:
   *   - Phase 1 v2 (`86266d7`) grossMarginPercent — REVENUE-denominator
   *     margin: (totalRevenue − totalCost) / totalRevenue * 100
   *   - Phase 8 (`195e95f`) marginPercent — COST-denominator markup:
   *     (customerCharges − dumpCosts) / dumpCosts * 100
   *   - Phase 10 exchange_rate — COUNT-OVER-COUNT rate:
   *     chainsWithExchange / chainRows * 100
   *
   * Module-wide 0–100 SCALE convention established in Phase 1 v2
   * holds across all three variants. FORMULA FAMILY is field-specific;
   * do not assume cross-field compatibility on the basis of the
   * suffix alone.
   */
  @ApiProperty({
    description:
      'Exchange rate 0–100 (percent of chains with ≥1 non-cancelled exchange). Third *Percent-family variant — count-over-count.',
  })
  exchange_rate: number;

  /**
   * Mean revenue per chain — `totalRevenue / chainRows.length`,
   * rounded 2dp. Zero when no chains in the window.
   */
  @ApiProperty({
    description: 'Mean revenue per chain (rounded 2dp).',
  })
  revenue_per_chain: number;

  /**
   * Mean profit per chain — `totalProfit / chainRows.length`,
   * rounded 2dp. Zero when no chains in the window.
   */
  @ApiProperty({
    description: 'Mean profit per chain (rounded 2dp).',
  })
  profit_per_chain: number;

  /**
   * Count of jobs in this tenant not part of any rental chain —
   * tenant-scope cleanup metric, not window-filtered. Kept
   * separate from the KPIs to avoid conflating chain metrics with
   * chain-free job cleanup.
   */
  @ApiProperty({
    description:
      'Count of tenant jobs not linked to any rental chain (tenant-scope cleanup metric; NOT window-filtered).',
  })
  standalone_jobs: number;
}

export class LifecycleReportResponseDto {
  /** Summary KPIs across the filtered chain set. */
  @ApiProperty({
    type: LifecycleSummaryDto,
    description: 'Summary KPIs across the filtered chain set.',
  })
  summary: LifecycleSummaryDto;

  /**
   * Per-chain performance rows, ordered by `drop_off_date DESC`. No
   * server-side row cap — full matching set is returned. Consumers
   * that expect large sets should tighten filters.
   */
  @ApiProperty({
    type: [LifecycleChainRowDto],
    description:
      'Per-chain rows, ordered by drop_off_date DESC. No server-side cap.',
  })
  chains: LifecycleChainRowDto[];

  /**
   * Zero-filled trend series. Bucket granularity per `?groupBy=`
   * (day / week / month). Every bucket in the window is present,
   * even ones with no data (so consumer charts render gap-free).
   */
  @ApiProperty({
    type: [LifecycleTrendPointDto],
    description:
      'Zero-filled trend series (day/week/month per ?groupBy=). All buckets present.',
  })
  trend: LifecycleTrendPointDto[];
}
