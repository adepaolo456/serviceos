/**
 * Reporting DTO Phase 4c — Filtered invoice list response contract.
 *
 * Shape returned by `GET /reporting/revenue/invoices`. Drives the
 * filtered invoice list shown under the revenue tiles on the
 * analytics dashboard (all / collected / outstanding / overdue).
 *
 * Mirrors `getRevenueInvoices(tenantId, filter, startDate?, endDate?)`
 * in `reporting.service.ts` (lines 203–257). The method has two code
 * branches:
 *
 *   - `collected` branch (lines 209–231): `SELECT DISTINCT ON (i.id)`
 *     joining `payments → invoices`, with `amountPaid` computed from
 *     a payments subquery (`SUM(amount - refunded_amount)` over
 *     completed payments). Time axis is `payments.applied_at`.
 *
 *   - Default branch (lines 233–256): reads from `invoiceDetailSelect`
 *     (so `amountPaid` is the denormalized `invoices.amount_paid`
 *     column). Handles `outstanding` (status IN open/partial AND
 *     balance_due > 0), `overdue` (status IN open/partial AND
 *     due_date < today), and the implicit default (all revenue-status
 *     invoices in the window). Time axis is `invoices.created_at`.
 *
 * Both branches return the SAME envelope: `{ filter, invoices }`
 * where `invoices` goes through the shared `mapInvoiceRows` helper.
 * Per-row shape is byte-identical (Phase 4-extract Outcome A).
 *
 * Standing rule (Phase 0): if the return literal in either branch of
 * `getRevenueInvoices` changes — or if the shared `mapInvoiceRows`
 * helper's output shape changes — this DTO must change with it.
 * TypeScript enforces this via the method's explicit
 * `Promise<RevenueInvoicesResponseDto>` return type (checks BOTH
 * branches uniformly).
 *
 * Shared sub-DTO: `RevenueDetailInvoiceDto` (see
 * `./revenue-detail-invoice.dto.ts`), extracted in Phase 4-extract
 * (`ce0b7e7`). Phase 4c is the third and final consumer — closes the
 * revenue cluster.
 */

import { ApiProperty } from '@nestjs/swagger';
import { RevenueDetailInvoiceDto } from './revenue-detail-invoice.dto';

export class RevenueInvoicesResponseDto {
  /**
   * Echoed filter key from the request. Returned verbatim from the
   * `?filter=` query param; not normalized or constrained server-side.
   * Service recognizes `collected`, `outstanding`, `overdue` as
   * discriminators and treats any other value (including `all`) as
   * the default branch. Typed as `string` to match that pass-through
   * behavior — tightening to a literal union is deferred to a
   * separate handler-hardening prompt.
   */
  @ApiProperty({
    description:
      'Echoed filter key from the request (collected, outstanding, overdue, all, or any other string).',
  })
  filter: string;

  /**
   * Invoice-level rows for the matched filter, ordered per branch:
   * `i.created_at DESC` in the default branch, `i.id, i.created_at DESC`
   * in the `collected` branch. Rows come from the shared
   * `mapInvoiceRows` helper — same shape as Phase 4a/b.
   */
  @ApiProperty({
    type: [RevenueDetailInvoiceDto],
    description:
      'Invoice rows matching the filter. Shape via shared mapInvoiceRows helper — same across both collected and default branches.',
  })
  invoices: RevenueDetailInvoiceDto[];
}
