/**
 * Reporting DTO Phase 3 — Customer analytics report response contract.
 *
 * Shape returned by `GET /reporting/customers`. Consumed by the
 * Customers tab on `web/src/app/(dashboard)/analytics/page.tsx`
 * (verified clean in Phase 2c Follow-Up #4.5 Site #7).
 *
 * Mirrors `getCustomerAnalytics(tenantId, startDate?, endDate?)` in
 * `reporting.service.ts` (lines 469–522). This is a period-aggregate
 * endpoint — `period: PeriodDto` marks the window bounds. First reuse
 * of the shared `PeriodDto` sub-DTO extracted in Phase 1 v2.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getCustomerAnalytics` changes, this DTO must change with it.
 * TypeScript enforces it via the method's explicit
 * `Promise<CustomersResponseDto>` return type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`).
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class TopCustomerRowDto {
  /** UUID from `customers.id`. */
  @ApiProperty({ description: 'UUID from customers.id.' })
  customerId: string;

  /**
   * Display name — `COALESCE(NULLIF(TRIM(first_name + ' ' + last_name), ''), 'Unknown Customer')`.
   * Falls back to the literal string `'Unknown Customer'` when both
   * `first_name` and `last_name` are empty or null on the customer row.
   */
  @ApiProperty({
    description:
      "Display name from first_name + last_name; falls back to 'Unknown Customer' when both are empty.",
  })
  name: string;

  /** Customer type from `customers.type` (e.g. `residential`, `commercial`). */
  @ApiProperty({
    description:
      'Customer type from customers.type (e.g. residential, commercial).',
  })
  type: string;

  /**
   * Distinct job count per customer within the window. Computed from
   * `COUNT(DISTINCT j.id)` where `jobs.scheduled_date` falls between
   * the window bounds.
   */
  @ApiProperty({
    description:
      'Distinct jobs per customer within the window (COUNT DISTINCT on scheduled_date).',
  })
  totalJobs: number;

  /**
   * Invoiced revenue per customer within the window — `SUM(i.total)`
   * over invoices with REVENUE_STATUS (`open`/`paid`/`partial`) and
   * `i.created_at` in the window.
   *
   * ⚠ Semantic note: this is **invoiced** revenue, NOT collected. The
   * service comment at line 488–489 explicitly states "actual invoiced
   * revenue within the date range, not the denormalized
   * `lifetime_revenue` column." Distinct from
   * `ProfitResponseDto.totalRevenue` (which is collected revenue per
   * Risk #1). When rendering a "top customers by spend" chart, be
   * aware the figure represents what the customer was billed, not
   * what they've actually paid.
   */
  @ApiProperty({
    description:
      'Invoiced revenue per customer in the window (SUM(invoices.total) with open/paid/partial status). NOT collected revenue.',
  })
  totalSpend: number;
}

export class CustomersResponseDto {
  /**
   * Total **active** customers for the tenant (point-in-time, not
   * windowed). Counts rows where `customers.is_active = true`.
   */
  @ApiProperty({
    description:
      'Total active customers for the tenant (point-in-time; is_active = true).',
  })
  totalCustomers: number;

  /** Customers created within the window (`customers.created_at` in `[start, endTs]`). */
  @ApiProperty({
    description:
      'Customers created within the window (customers.created_at in window).',
  })
  newCustomersInPeriod: number;

  /**
   * Count-by-type map with **dynamic keys** — keys are whatever
   * `customers.type` values currently exist in the DB for this
   * tenant's active customers (typical examples: `residential`,
   * `commercial`, but the set is not enumerated on the backend).
   * Values are non-negative integer counts.
   *
   * Swagger schema note: modeled as an open object (additionalProperties),
   * matching `AssetsResponseDto.byStatus`'s precedent for dynamic-key
   * reporting maps.
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Dynamic-key map from customers.type values to counts. Keys are not enumerated.',
  })
  customersByType: Record<string, number>;

  /**
   * Top 20 customers by invoiced spend within the window, ordered
   * `SUM(invoices.total) DESC`. Filtered to rows with either spend > 0
   * or at least one job — customers with zero activity are excluded.
   */
  @ApiProperty({
    type: [TopCustomerRowDto],
    description:
      'Top 20 customers by invoiced spend in the window, SUM(invoices.total) DESC, LIMIT 20.',
  })
  topCustomers: TopCustomerRowDto[];

  /** Window bounds — shared sub-DTO reused across 8 reporting endpoints. */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds — shared sub-DTO reused across 8 reporting endpoints.',
  })
  period: PeriodDto;
}
