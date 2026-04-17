/**
 * Reporting DTO Phase 4a — Source-detail invoice drill-down response contract.
 *
 * Shape returned by `GET /reporting/revenue/source-detail`. Drives the
 * invoice-level drill-down that opens when a user clicks a revenue
 * source row on the analytics dashboard.
 *
 * Mirrors `getRevenueBySourceDetail(tenantId, source, startDate?, endDate?)`
 * in `reporting.service.ts` (lines 174–187). The method filters invoices
 * by `COALESCE(j.source, 'other') = $source` within the date window and
 * returns the echoed source key plus the mapped invoice rows.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getRevenueBySourceDetail` changes — or if the shared
 * `mapInvoiceRows` helper's output shape changes — this DTO must
 * change with it. TypeScript enforces this via the method's explicit
 * `Promise<RevenueSourceDetailResponseDto>` return type.
 *
 * Shared sub-DTO: `RevenueDetailInvoiceDto` (see
 * `./revenue-detail-invoice.dto.ts`), extracted in Phase 4-extract
 * (`ce0b7e7`). Phase 4a is its first consumer — typecheck of this
 * module is what activates shape enforcement on the extracted DTO
 * against real service output.
 */

import { ApiProperty } from '@nestjs/swagger';
import { RevenueDetailInvoiceDto } from './revenue-detail-invoice.dto';

export class RevenueSourceDetailResponseDto {
  /**
   * Echoed source key from the request — the value matched against
   * `COALESCE(jobs.source, 'other')` in the WHERE clause. Returned
   * verbatim from the `?source=` query param; not looked up or
   * normalized server-side.
   */
  @ApiProperty({
    description:
      'Echoed source key from the request; matches COALESCE(jobs.source, "other") in the filter.',
  })
  source: string;

  /**
   * Invoice-level rows for the matched source, ordered by
   * `invoices.created_at DESC`. Rows come from the shared
   * `mapInvoiceRows` helper — same shape as Phase 4b/c.
   */
  @ApiProperty({
    type: [RevenueDetailInvoiceDto],
    description:
      'Invoice rows for the source, ordered by invoices.created_at DESC. Shape via shared mapInvoiceRows helper.',
  })
  invoices: RevenueDetailInvoiceDto[];
}
