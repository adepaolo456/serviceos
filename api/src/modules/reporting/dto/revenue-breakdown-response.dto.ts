/**
 * Reporting DTO Phase 13 — Revenue breakdown response contract.
 *
 * Shape returned by `GET /reporting/revenue-breakdown`. Drives the
 * line-item-based revenue analysis with optional classification
 * filter (all / post-correction / legacy), single-month windowed.
 *
 * Mirrors `getRevenueBreakdown(tenantId, period?, classification?)`
 * in `reporting.service.ts` (lines 708–759). The method runs a
 * single SQL aggregate query over `invoice_line_items LEFT JOIN
 * invoices`, then constructs the envelope in-memory.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getRevenueBreakdown` changes, this DTO must change with it.
 * TypeScript enforces this via the explicit
 * `Promise<RevenueBreakdownResponseDto>` return type.
 *
 * ─── Structural notes ───
 *
 * 1. SINGLE-MONTH WINDOWED endpoint (first in the module). Unlike
 *    Phase 5/8/9 which take arbitrary date ranges, or Phases 11/12
 *    which are point-in-time, this endpoint takes a `period` query
 *    param in `YYYY-MM` format (defaulting to current month). The
 *    SQL filters strictly between start-of-month and end-of-month.
 *    Wire echoes `period` as a string — NOT as a `PeriodDto`.
 *    PeriodDto's from/to model doesn't apply when the window is a
 *    calendar month.
 *
 * 2. FIRST USE of the `INVOICED_LINE_ITEM` tag. The label was
 *    reserved in Track 2's spec v1 vocabulary (commit `a57404c`)
 *    but never applied. Phase 13 adopts it on
 *    `totalInvoicedLineItem` — the first INVOICED_LINE_ITEM
 *    variant in the module. Distinct from Phase 5's
 *    `RevenueResponseDto.totalRevenue` (`INVOICED_WINDOWED`) which
 *    sums `invoices.total`; this DTO sums `invoice_line_items.net_amount`.
 *
 * 3. MULTI-SEMANTIC-RENAME nested object. The `breakdown`
 *    sub-DTO has 6 fields; 4 of them encode a wire-name semantic
 *    distinct from their SQL source:
 *      - `distance` ← `line_type = 'fee'`
 *      - `surcharges` ← `line_type = 'surcharge_item'` (singular→plural)
 *      - `extraDayRevenue` ← `line_type = 'overage_days'` (semantic + case)
 *      - `failedTripRevenue` ← `invoices.source = 'failed_trip'` (different filter axis)
 *    `rental` and `overage` are direct line_type matches. Per-field
 *    JSDoc documents each rename to prevent future readers from
 *    assuming all fields share a dimension.
 *
 * 4. ⚠ AXIS ASYMMETRY in `breakdown`. Five of six fields filter by
 *    `line_type`; `failedTripRevenue` filters by the parent invoice's
 *    `source` column. Summing all 6 fields does NOT equal
 *    `totalInvoicedLineItem` — `failedTripRevenue` overlaps with
 *    whichever line_type partitions its parent invoices' line items
 *    fall into. This asymmetry is intentional in current service
 *    behavior. **Flagged for Phase 14 investigation.**
 *    `/reporting/exceptions` (Phase 14 target) audits invoice-vs-
 *    line-item integrity; whether this asymmetry is product
 *    classification or latent inconsistency is Phase 14's call.
 *
 * 5. `cutoffDate` ECHO PATTERN. The DTO emits the
 *    `CORRECTION_CUTOFF` constant on every response so consumers
 *    display the cutoff date without hardcoding it client-side.
 *    Same pattern as Phase 12 `IntegrityCheckResponseDto.correctionCutoff`.
 */

import { ApiProperty } from '@nestjs/swagger';

export class RevenueBreakdownByTypeDto {
  /**
   * Rental revenue — `SUM(invoice_line_items.net_amount)` filtered
   * by `line_type = 'rental'`. Direct line_type match (no rename).
   */
  @ApiProperty({
    description: "Rental revenue (SUM(net_amount) WHERE line_type = 'rental').",
  })
  rental: number;

  /**
   * Distance / fee revenue — `SUM(invoice_line_items.net_amount)`
   * filtered by `line_type = 'fee'`.
   *
   * Wire-name rename: SQL line_type is `'fee'`; wire field is
   * `distance`. The product-level concept (mileage / distance fees)
   * is exposed under the friendlier wire name; underlying line_type
   * is the more general `'fee'` enum value.
   */
  @ApiProperty({
    description:
      "Distance/fee revenue (SUM(net_amount) WHERE line_type = 'fee'). Wire-name rename from line_type.",
  })
  distance: number;

  /**
   * Overage revenue — `SUM(invoice_line_items.net_amount)` filtered
   * by `line_type = 'overage'`. Direct line_type match (no rename).
   * Distinct from `extraDayRevenue` below, which uses a different
   * line_type (`'overage_days'`).
   */
  @ApiProperty({
    description:
      "Overage revenue (SUM(net_amount) WHERE line_type = 'overage').",
  })
  overage: number;

  /**
   * Surcharge revenue — `SUM(invoice_line_items.net_amount)`
   * filtered by `line_type = 'surcharge_item'`.
   *
   * Wire-name rename: SQL line_type is singular `'surcharge_item'`;
   * wire field is plural `surcharges`. Plural-on-wire matches
   * frontend rendering convention for category aggregates.
   */
  @ApiProperty({
    description:
      "Surcharge revenue (SUM(net_amount) WHERE line_type = 'surcharge_item'). Singular→plural rename.",
  })
  surcharges: number;

  /**
   * Extra-day revenue — `SUM(invoice_line_items.net_amount)`
   * filtered by `line_type = 'overage_days'`.
   *
   * Wire-name rename: SQL line_type is `'overage_days'`; wire field
   * is `extraDayRevenue` (semantic + camelCase). The product-level
   * concept (charges for extra rental days beyond the included
   * window) is exposed under the friendlier wire name; underlying
   * line_type carries the older `overage_days` SQL enum value.
   */
  @ApiProperty({
    description:
      "Extra-day revenue (SUM(net_amount) WHERE line_type = 'overage_days'). Semantic + case rename.",
  })
  extraDayRevenue: number;

  /**
   * Failed-trip revenue — `SUM(invoice_line_items.net_amount)`
   * filtered by `invoices.source = 'failed_trip'` (NOT by line_type).
   *
   * ⚠ AXIS ASYMMETRY: the other 5 fields in this object filter by
   * `line_type`; this field filters by the parent invoice's `source`
   * column. Summing all 6 fields does NOT equal
   * `totalInvoicedLineItem` — `failedTripRevenue` overlaps with
   * whichever line_type partitions its parent invoices' line items
   * fall into.
   *
   * This asymmetry is intentional in current service behavior and is
   * flagged for Phase 14 investigation. See file-level JSDoc note 4.
   */
  @ApiProperty({
    description:
      "Failed-trip revenue (SUM(net_amount) WHERE invoices.source = 'failed_trip'). AXIS ASYMMETRY: filters by source, not line_type.",
  })
  failedTripRevenue: number;
}

export class RevenueBreakdownResponseDto {
  /**
   * Classification filter echo — echoes the `classification` query
   * parameter value back to the client.
   *
   * Open extensible string. Service recognizes three modifiers with
   * distinct filter behavior:
   *   - `'all'` — no filter (default when param omitted or unrecognized)
   *   - `'post-correction'` — filters to invoices created on or after
   *     CORRECTION_CUTOFF (2026-04-02)
   *   - `'legacy'` — filters to invoices created before CORRECTION_CUTOFF
   *
   * Values other than these three (including client-supplied strings)
   * echo back verbatim while the service applies the 'all' filter
   * (unfiltered query). Consumers should treat this field as an
   * opaque identifier indicating the filter state, not a closed enum.
   */
  @ApiProperty({
    description:
      "Echoed classification filter ('all' | 'post-correction' | 'legacy' | other). Open extensible string.",
  })
  classification: string;

  /**
   * Date constant echo — `CORRECTION_CUTOFF` formatted as YYYY-MM-DD.
   *
   * Emitted on every response so consumers can display the cutoff
   * date used by the `'post-correction'` and `'legacy'` filter
   * branches without hardcoding it client-side. Same emission
   * pattern as Phase 12 `IntegrityCheckResponseDto.correctionCutoff`
   * (`121a06b`).
   */
  @ApiProperty({
    description:
      'CORRECTION_CUTOFF as YYYY-MM-DD. Echoed for client display without hardcoding.',
  })
  cutoffDate: string;

  /**
   * Window period in YYYY-MM format. Defaults to current month when
   * the `?period=` query param is omitted. The SQL filters strictly
   * between start-of-month and end-of-month derived from this value.
   *
   * Single-month windowed endpoint — see file-level JSDoc note 1.
   * Distinct from `PeriodDto`'s from/to model used by arbitrary-range
   * windowed endpoints (Phase 5/8/9).
   */
  @ApiProperty({
    description:
      'Window period in YYYY-MM format. Defaults to current month. Drives SQL window.',
  })
  period: string;

  /**
   * Semantic: INVOICED_LINE_ITEM
   * Source: COALESCE(SUM(invoice_line_items.net_amount), 0)
   * Scope: Revenue-status invoices; single-month windowed by created_at; optional classification filter
   *
   * Total revenue aggregated from invoice line items (not invoice
   * totals) in the specified month. Distinct from Phase 5's
   * `RevenueResponseDto.totalRevenue` (`INVOICED_WINDOWED`) — that
   * field sums `invoices.total` across a configurable window; this
   * field sums `invoice_line_items.net_amount` within a single
   * calendar month with optional classification filter.
   *
   * Line-item sourcing + classification filter make this the first
   * INVOICED_LINE_ITEM variant in the module. Tag label was reserved
   * in Track 2's spec v1 vocabulary (`a57404c`) and is adopted here
   * for the first time.
   */
  @ApiProperty({
    description:
      'Total invoiced revenue from line items in the period. SUM(invoice_line_items.net_amount) with revenue-status + classification filter.',
  })
  totalInvoicedLineItem: number;

  /**
   * Per-line-type revenue breakdown, fixed-key sub-DTO with 6 fields.
   * Fields are NOT a partition of `totalInvoicedLineItem` — see
   * `failedTripRevenue` axis asymmetry note on the sub-DTO and
   * file-level JSDoc note 4.
   */
  @ApiProperty({
    type: RevenueBreakdownByTypeDto,
    description:
      'Per-line-type revenue breakdown. Fixed-key sub-DTO; not a partition (see failedTripRevenue axis asymmetry).',
  })
  breakdown: RevenueBreakdownByTypeDto;

  /**
   * Distinct invoice count in the period — `COUNT(DISTINCT invoices.id)`
   * over revenue-status invoices matching the filter.
   */
  @ApiProperty({
    description: 'Distinct invoice count in the period (COUNT(DISTINCT id)).',
  })
  invoiceCount: number;

  /**
   * Distinct paid-invoice count — `COUNT(DISTINCT invoices.id)
   * FILTER (WHERE status = 'paid')` over revenue-status invoices
   * matching the filter.
   */
  @ApiProperty({
    description:
      "Distinct paid-invoice count (COUNT(DISTINCT id) FILTER (status = 'paid')).",
  })
  paidCount: number;

  /**
   * Collection rate — paid-invoice percentage with 1-decimal precision.
   *
   * Formula: `invoiceCount > 0 ? Math.round((paidCount / invoiceCount)
   * * 1000) / 10 : 0`. Algebraically equivalent to
   * `Math.round((paidCount / invoiceCount) * 100 * 10) / 10`; the
   * `* 1000 / 10` form preserves 1-decimal precision through integer
   * rounding.
   *
   * Range: 0–100 (module convention — see Phase 0 Risk #3).
   * Nullability: number, never null. Returns 0 when invoiceCount === 0.
   *
   * Risk #3 family: count-over-count variant. Same family as Phase 10
   * `LifecycleSummaryDto.exchange_rate` (`650acfb`) — ratio of two
   * count aggregates expressed as a percentage. Differs from
   * revenue-denominator variant (Phase 1v2 `grossMarginPercent`,
   * `86266d7`) and cost-denominator variant (Phase 8 `marginPercent`,
   * `195e95f`).
   */
  @ApiProperty({
    description:
      'Collection rate paidCount/invoiceCount on 0–100 scale, 1-decimal precision. Returns 0 when invoiceCount === 0.',
  })
  collectionRate: number;
}
