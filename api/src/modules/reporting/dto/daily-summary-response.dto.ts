/**
 * Reporting DTO Phase 15 — Daily operational summary response contract.
 *
 * Shape returned by `GET /reporting/daily-summary`. Drives the
 * operations-dashboard daily-rollup card — combines day-scoped revenue
 * + AR balances + job counts + integrity-check severity summary into
 * a flat 7-field envelope for the current day.
 *
 * Mirrors `getDailySummary(tenantId)` in `reporting.service.ts` (lines
 * 874–905). The method composes three inline SQL queries + one
 * cross-method call:
 *   - Revenue query (single-day windowed by `created_at::date = today`)
 *   - AR query (two aggregates: `open_ar` + `overdue_ar`)
 *   - Jobs query (two counters: created today + completed today)
 *   - `this.getIntegrityCheck(tenantId)` — Phase 12 cross-method call
 *
 * Standing rule (Phase 0): if the return literal in `getDailySummary`
 * changes, this DTO must change with it. TypeScript enforces this
 * via the explicit `Promise<DailySummaryResponseDto>` return type.
 *
 * ─── Structural notes ───
 *
 * 1. FIRST cross-phase DTO import reuse in the reporting module.
 *    `alerts: IntegrityCheckSummaryDto` is imported from Phase 12
 *    (`integrity-check-response.dto.ts` lines 203–221). Phase 12
 *    designed `IntegrityCheckSummaryDto` explicitly for cross-endpoint
 *    reuse (that file's JSDoc names `getDailySummary` as a consumer);
 *    Phase 15 closes a documented design loop. No new sub-DTO class
 *    is created.
 *
 * 2. FIRST MIXED type enforcement profile. Phases 11–14 were all
 *    AUDIT-ONLY profiles (every wire-field value absorbed through
 *    TypeORM's `any[]` buffer; TSC could not catch shape mismatches
 *    between service emission and DTO declaration). Phase 15
 *    introduces 1 strictly TSC-enforced field (`alerts` via
 *    cross-phase import) alongside 5 audit-enforced scalars and 1
 *    inferred scalar. Methodology milestone: any change to Phase 12's
 *    `IntegrityCheckSummaryDto` will fail Phase 15's typecheck at
 *    build time.
 *
 * 3. FIRST roll-up summary endpoint. Fundamentally different
 *    structural class from prior-phase endpoints (query / drill-down
 *    / aggregate / audit / breakdown). Stitches day-scoped scalars
 *    with cross-phase summary import. No row arrays; no nested
 *    sub-objects beyond the cross-phase `alerts` reference.
 *
 * 4. SINGLE-DAY windowed — today hardcoded via
 *    `new Date().toISOString().split('T')[0]`. No `period` query
 *    param, no override, no `PeriodDto`. Consistent with Phase 13's
 *    windowing-implicit treatment (Phase 13 used YYYY-MM format
 *    defaulting to current month; Phase 15 is more restrictive —
 *    current day only, no caller choice).
 *
 * 5. `overdueAR` is the FOURTH variant in the overdue taxonomy —
 *    balance-aggregate + sent-aged + all-time. Intentionally untagged
 *    with disambiguation JSDoc per Path F Track 2 spec v1
 *    preservation (δ decision). See `overdueAR` per-field JSDoc for
 *    the four-variant inventory + filter-axis divergence.
 *
 * 6. Revenue + openAR REUSE EXISTING TAGS from Phases 5 + 7 —
 *    `INVOICED_WINDOWED` and `OUTSTANDING_ALL_TIME`. No new
 *    vocabulary labels introduced; arc-close vocabulary v1 lock
 *    preserved.
 *
 * 7. ARC COMPLETION NOTE. Phase 15 is the 17th and final endpoint
 *    formalization in the Phase 0 sequence. With Phase 15 shipped:
 *    17 formalized + 1 out-of-scope (`invoices/export` CSV stream) =
 *    18 @Get handlers covered. Path F vocabulary is permanently
 *    locked at v1. Post-arc opportunistic work (`@ApiOkResponse`
 *    sweep across all 17 handlers) is unblocked as a separate
 *    workstream.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IntegrityCheckSummaryDto } from './integrity-check-response.dto';

export class DailySummaryResponseDto {
  /**
   * Current day in `YYYY-MM-DD` form.
   *
   * Sourced from `new Date().toISOString().split('T')[0]` at request
   * time. Used by the service as the window boundary for revenue
   * + jobs queries; echoed on the wire so consumers can display
   * without parsing their own timestamp.
   */
  @ApiProperty({
    description:
      'Current day in YYYY-MM-DD form. Computed server-side at request time.',
  })
  date: string;

  /**
   * Semantic: INVOICED_WINDOWED
   * Source: COALESCE(SUM(invoices.total), 0) for revenue-status invoices
   * Scope: Single-day windowed by created_at::date = today
   *
   * Total invoiced revenue for the current calendar day. Tag reuse
   * from Phase 5 `RevenueResponseDto.totalRevenue` (`86266d7` /
   * `a57404c`): same semantic (invoices.total aggregation for
   * revenue-status invoices), narrower window (single day vs Phase
   * 5's configurable range).
   *
   * Single-day windowing is a specialization of Phase 5's
   * INVOICED_WINDOWED semantic, not a distinct semantic — the tag
   * applies unchanged.
   */
  @ApiProperty({
    description:
      'Invoiced revenue for the current day (SUM(invoices.total) with revenue-status filter; created_at::date = today).',
  })
  revenue: number;

  /**
   * Semantic: OUTSTANDING_ALL_TIME
   * Source: COALESCE(SUM(CASE WHEN status IN ('open','partial') THEN balance_due ELSE 0 END), 0)
   * Scope: All-time; no window
   *
   * Total outstanding balance across all open/partial invoices for
   * the tenant. Tag reuse from Phase 7
   * `AccountsReceivableResponseDto.totalOutstanding` (`a57404c`):
   * identical formula, identical semantic.
   */
  @ApiProperty({
    description:
      "All-time outstanding AR balance (SUM(balance_due) WHERE status IN ('open','partial')).",
  })
  openAR: number;

  /**
   * Total overdue accounts-receivable balance — aged by invoice send time.
   *
   * Formula: `COALESCE(SUM(CASE WHEN status IN ('open','partial') AND
   * sent_at < NOW() - INTERVAL '30 days' THEN balance_due ELSE 0 END), 0)`.
   *
   * ⚠ FILTER AXIS DIVERGENCE: This field uses `sent_at < NOW() - 30 days`
   * (aging measured from invoice send time), NOT `due_date < today`
   * (contractual payment deadline). Semantically distinct from:
   *   - Phase 5 `RevenueResponseDto.totalOverdue` (Semantic:
   *     OVERDUE_WINDOWED) — due-aged, created-at-windowed balance
   *   - Phase 7 `AccountsReceivableResponseDto.totalOverdue`
   *     (Semantic: OVERDUE_ALL_TIME) — due-aged, all-time balance
   *   - Phase 14 `ExceptionsActionRequiredDto.overdueInvoices` —
   *     row count with status='overdue' flag (all-time)
   *
   * Phase 15's overdueAR is the FOURTH variant in the overdue
   * taxonomy: balance-aggregate + sent-aged + all-time. Intentionally
   * UNTAGGED per Path F Track 2 spec v1 (Clarification A):
   * single-field heuristic falling outside primary-aggregate
   * vocabulary does not warrant vocabulary expansion. Precedent:
   * Phase 14 `overdueInvoices` (also untagged with disambiguation
   * JSDoc).
   *
   * Consumers that want "contractually overdue" should use Phase 5
   * or Phase 7's `totalOverdue`. Consumers tracking "invoices going
   * stale" should use this field.
   */
  @ApiProperty({
    description:
      'Sent-aged overdue AR balance (SUM(balance_due) WHERE open/partial AND sent_at < NOW() - 30 days). DIFFERENT filter axis from Phase 5/7 totalOverdue.',
  })
  overdueAR: number;

  /** Jobs created today — `COUNT(*) FILTER (WHERE created_at::date = today)`. */
  @ApiProperty({
    description: 'Count of jobs created today (created_at::date = today).',
  })
  jobsCreated: number;

  /** Jobs completed today — `COUNT(*) FILTER (WHERE status='completed' AND completed_at::date = today)`. */
  @ApiProperty({
    description:
      "Count of jobs completed today (status='completed' AND completed_at::date = today).",
  })
  jobsCompleted: number;

  /**
   * Severity-rollup of integrity check findings for this tenant.
   *
   * Reused from Phase 12 `IntegrityCheckSummaryDto` (`121a06b`) —
   * same 3-field summary (`{ critical, warning, info }` counts) that
   * the integrity-check endpoint emits under its own `summary` field.
   *
   * Phase 12 explicitly designed this sub-DTO for cross-endpoint
   * reuse (see that file's file-level JSDoc naming `getDailySummary`
   * as a consumer). Phase 15 closes a documented design loop: the
   * service's in-method call `const integrity = await
   * this.getIntegrityCheck(...)` propagates the Phase 12-typed
   * return; `integrity.summary` satisfies `IntegrityCheckSummaryDto`
   * at the type level.
   *
   * This is the first cross-phase DTO import in the reporting module.
   * TSC enforces shape compatibility strictly: any change to Phase
   * 12's `IntegrityCheckSummaryDto` will fail Phase 15's typecheck
   * at build time.
   */
  @ApiProperty({
    type: IntegrityCheckSummaryDto,
    description:
      'Integrity check severity rollup reused from Phase 12 IntegrityCheckSummaryDto.',
  })
  alerts: IntegrityCheckSummaryDto;
}
