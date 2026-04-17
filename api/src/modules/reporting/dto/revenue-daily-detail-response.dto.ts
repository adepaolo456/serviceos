/**
 * Reporting DTO Phase 4b — Daily-detail invoice drill-down response contract.
 *
 * Shape returned by `GET /reporting/revenue/daily-detail`. Drives the
 * invoice-level drill-down that opens when a user clicks a single day
 * on the daily-revenue chart.
 *
 * Mirrors `getRevenueByDailyDetail(tenantId, date)` in
 * `reporting.service.ts` (lines 190–200). The method filters invoices
 * by `DATE(i.created_at) = $date` (exact calendar-day match on the
 * invoice creation timestamp) within revenue status, ordered
 * `i.created_at DESC`, and returns the echoed date plus the mapped
 * invoice rows.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getRevenueByDailyDetail` changes — or if the shared
 * `mapInvoiceRows` helper's output shape changes — this DTO must
 * change with it. TypeScript enforces this via the method's explicit
 * `Promise<RevenueDailyDetailResponseDto>` return type.
 *
 * Shared sub-DTO: `RevenueDetailInvoiceDto` (see
 * `./revenue-detail-invoice.dto.ts`), extracted in Phase 4-extract
 * (`ce0b7e7`) and first validated by Phase 4a (`19414b5`). Phase 4b
 * is the second consumer — re-exercises the same sub-DTO on a
 * different envelope, reinforcing that the extraction holds across
 * multiple call sites.
 */

import { ApiProperty } from '@nestjs/swagger';
import { RevenueDetailInvoiceDto } from './revenue-detail-invoice.dto';

export class RevenueDailyDetailResponseDto {
  /**
   * Echoed date from the request — the value matched against
   * `DATE(invoices.created_at)` in the WHERE clause. Returned
   * verbatim from the `?date=` query param; not parsed, normalized,
   * or reformatted server-side. Frontend supplies `YYYY-MM-DD` by
   * convention.
   */
  @ApiProperty({
    description:
      'Echoed date from the request (YYYY-MM-DD by convention); matches DATE(invoices.created_at) in the filter.',
  })
  date: string;

  /**
   * Invoice-level rows for the matched day, ordered by
   * `invoices.created_at DESC`. Rows come from the shared
   * `mapInvoiceRows` helper — same shape as Phase 4a/c.
   */
  @ApiProperty({
    type: [RevenueDetailInvoiceDto],
    description:
      'Invoice rows for the day, ordered by invoices.created_at DESC. Shape via shared mapInvoiceRows helper.',
  })
  invoices: RevenueDetailInvoiceDto[];
}
