/**
 * Reporting DTO Phase 5 — Revenue report response contract.
 *
 * Shape returned by `GET /reporting/revenue`. Main revenue aggregate
 * endpoint — distinct from the Phase 4 drill-downs (source-detail,
 * daily-detail, invoices). Drives the headline revenue tiles plus
 * per-source and per-date breakdown charts on the analytics
 * dashboard.
 *
 * Mirrors `getRevenue(tenantId, startDate?, endDate?, grouping?)` in
 * `reporting.service.ts` (lines 52–149). The method composes four
 * separate SQL aggregates: invoice totals (invoiced + outstanding),
 * completed payments (collected), overdue balance, per-source
 * breakdown, and a time-grouped revenue series (daily / weekly /
 * monthly).
 *
 * Standing rule (Phase 0): if the return literal in `getRevenue`
 * changes, this DTO must change with it. TypeScript enforces this
 * via the method's explicit `Promise<RevenueResponseDto>` return
 * type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`). Phase 5 is
 * the second reuse of `PeriodDto` (after Phase 3 — customers).
 *
 * ─── Risk #1 cross-reference (closes the collision loop) ───
 * This DTO's `totalRevenue` field is the **invoiced** half of the
 * Phase 0 Risk #1 collision. Its `totalCollected` field is the
 * **collected** half — and is the exact upstream source that
 * `ProfitResponseDto.totalRevenue` (Phase 1 v2, `86266d7`) pulls
 * through `getRevenue(...).totalCollected`. After Phase 5 ships,
 * both sides of the collision are explicitly documented.
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class RevenueBySourceRowDto {
  /**
   * Lead source label — `COALESCE(jobs.source, 'other')` with an
   * outer `|| 'other'` fallback, so the field is never null or empty.
   * Keys are whatever `jobs.source` values currently exist for this
   * tenant (not enumerated server-side).
   */
  @ApiProperty({
    description:
      "Lead source label from COALESCE(jobs.source, 'other'); never null, falls back to 'other'.",
  })
  source: string;

  /**
   * Semantic: INVOICED_WINDOWED
   * Source: SUM(invoices.total) GROUP BY COALESCE(j.source)
   * Scope: Revenue-status; windowed by created_at
   *
   * Per-source **invoiced** revenue — `SUM(invoices.total)` for the source.
   */
  @ApiProperty({
    description: 'Per-source invoiced revenue (SUM(invoices.total)).',
  })
  amount: number;

  /** Invoice count for the source — `COUNT(*)`. */
  @ApiProperty({ description: 'Invoice count for the source (COUNT(*)).' })
  count: number;

  /** Paid-invoice count for the source — `COUNT(*) FILTER (WHERE status = 'paid')`. */
  @ApiProperty({
    description:
      "Paid-invoice count for the source (COUNT(*) FILTER (WHERE status = 'paid')).",
  })
  paidCount: number;

  /**
   * Per-source outstanding balance —
   * `SUM(CASE WHEN status IN ('open', 'partial') THEN balance_due ELSE 0 END)`.
   */
  @ApiProperty({
    description:
      "Per-source outstanding balance (SUM(balance_due) where status IN ('open','partial')).",
  })
  outstanding: number;
}

export class RevenueDailyRowDto {
  /**
   * Bucket date in `YYYY-MM-DD` form. SELECT returns
   * `${groupExpr}::date` where `groupExpr` is
   * `DATE_TRUNC('week' | 'month', ...)::date` or `DATE(...)` per the
   * `?grouping=` query param. Service defensively handles Date vs
   * string driver output and falls back to `null` on neither — that
   * fallback is why the type is nullable (in practice the pg driver
   * always returns a Date for `::date` columns and the fallback
   * rarely fires).
   */
  @ApiProperty({
    nullable: true,
    description:
      'Bucket date (YYYY-MM-DD). Null only on defensive fallback when the raw driver value is neither Date nor string.',
  })
  date: string | null;

  /**
   * Semantic: INVOICED_WINDOWED
   * Source: SUM(invoices.total) per date bucket
   * Scope: Revenue-status; windowed by created_at
   *
   * Per-bucket **invoiced** revenue — `SUM(invoices.total)` in the bucket.
   */
  @ApiProperty({
    description: 'Per-bucket invoiced revenue (SUM(invoices.total)).',
  })
  amount: number;

  /** Invoice count in the bucket — `COUNT(*)`. */
  @ApiProperty({ description: 'Invoice count in the bucket (COUNT(*)).' })
  count: number;

  /** Paid-invoice count in the bucket. */
  @ApiProperty({ description: 'Paid-invoice count in the bucket.' })
  paidCount: number;
}

export class RevenueResponseDto {
  /**
   * Semantic: INVOICED_WINDOWED
   * Source: SUM(invoices.total)
   * Scope: Revenue-status invoices; windowed by created_at
   *
   * Revenue **invoiced** in the window — `SUM(invoices.total)` over
   * invoices with revenue status (`open`/`paid`/`partial`) and
   * `created_at` in the window.
   *
   * ⚠ Semantic collision flagged in Phase 0 Risk #1:
   * `GET /reporting/revenue.totalRevenue` === `SUM(invoices.total)`
   * (INVOICED revenue over invoice creation time), NOT payments
   * applied. This is NOT the same value as
   * `GET /reporting/profit.totalRevenue` (which represents COLLECTED
   * revenue via `getRevenue(...).totalCollected`). Do NOT cross-wire
   * the two values in downstream code — they diverge whenever
   * invoices are issued without matching completed payments in the
   * same window.
   *
   * See `ProfitResponseDto.totalRevenue` (Phase 1 v2, `86266d7`) for
   * the other side of this collision.
   */
  @ApiProperty({
    description:
      'Revenue invoiced in the window (SUM(invoices.total)). NOT the same as profit.totalRevenue (collected).',
  })
  totalRevenue: number;

  /**
   * Semantic: COLLECTED
   * Source: SUM(payments.amount − refunded_amount) for completed payments
   * Scope: Windowed by applied_at
   *
   * Revenue **collected** in the window — `SUM(payments.amount - refunded_amount)`
   * over completed payments (`payments.status = 'completed'`) with
   * `applied_at` in the window. Time axis is `payments.applied_at`
   * (money actually received), not invoice creation time.
   *
   * This is the exact upstream source that
   * `ProfitResponseDto.totalRevenue` consumes — Phase 1 v2 wired it
   * through `getRevenue(...).totalCollected` to represent collected
   * revenue in the profit report. The Risk #1 cross-reference
   * documented on `totalRevenue` above names this field as the
   * collected counterpart.
   */
  @ApiProperty({
    description:
      'Revenue collected in the window (SUM(payments.amount - refunded_amount) over completed payments by applied_at). Upstream of ProfitResponseDto.totalRevenue.',
  })
  totalCollected: number;

  /**
   * Semantic: OUTSTANDING_WINDOWED
   * Source: SUM(CASE WHEN status IN (open,partial) THEN balance_due ELSE 0)
   * Scope: Revenue-status invoices; windowed by created_at
   *
   * Total outstanding balance from invoices with status in
   * (`open`, `partial`) and `created_at` in the window —
   * `SUM(CASE WHEN status IN ('open', 'partial') THEN balance_due ELSE 0 END)`.
   */
  @ApiProperty({
    description:
      "Total outstanding balance (SUM(balance_due) where status IN ('open','partial')) in the window.",
  })
  totalOutstanding: number;

  /**
   * Semantic: OVERDUE_WINDOWED
   * Source: SUM(balance_due) WHERE open/partial AND due_date < today
   * Scope: Windowed by created_at; due_date < today
   *
   * Total overdue balance — `SUM(balance_due)` over invoices with
   * status in (`open`, `partial`) AND `due_date < today`. Evaluated
   * against server's current date, not the window end.
   */
  @ApiProperty({
    description:
      "Total overdue balance (SUM(balance_due) where status IN ('open','partial') AND due_date < today).",
  })
  totalOverdue: number;

  /**
   * Per-lead-source breakdown of invoiced revenue + paid/outstanding
   * counts, ordered `SUM(i.total) DESC`. Source labels come from
   * `COALESCE(jobs.source, 'other')` — set is not enumerated
   * server-side.
   */
  @ApiProperty({
    type: [RevenueBySourceRowDto],
    description:
      'Per-source breakdown of invoiced revenue + paid/outstanding counts, ordered SUM(total) DESC.',
  })
  revenueBySource: RevenueBySourceRowDto[];

  /**
   * Time-bucketed invoiced revenue series. Bucket granularity is
   * controlled by the `?grouping=` query param: `'weekly'` →
   * `DATE_TRUNC('week', ...)`, `'monthly'` → `DATE_TRUNC('month', ...)`,
   * any other value (including `'daily'` or unspecified) → `DATE(...)`.
   * Ordered by bucket date DESC.
   */
  @ApiProperty({
    type: [RevenueDailyRowDto],
    description:
      'Time-bucketed invoiced revenue series (daily/weekly/monthly per ?grouping=), ordered bucket DESC.',
  })
  dailyRevenue: RevenueDailyRowDto[];

  /**
   * Echo of the `?grouping=` query param, defaulted to `'daily'`
   * when unspecified. Service recognizes `'weekly'` and `'monthly'`
   * as SQL-affecting values; any other string is echoed back but
   * treated as daily-grouping SQL. Typed as `string` to match the
   * pass-through behavior — tightening to a literal union is
   * deferred.
   */
  @ApiProperty({
    description:
      "Echo of ?grouping= (daily/weekly/monthly), defaulting to 'daily'.",
  })
  grouping: string;

  /** Window bounds — shared sub-DTO reused across 8 reporting endpoints. */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds — shared sub-DTO reused across 8 reporting endpoints.',
  })
  period: PeriodDto;
}
