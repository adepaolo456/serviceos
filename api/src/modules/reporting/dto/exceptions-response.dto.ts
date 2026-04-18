/**
 * Reporting DTO Phase 14 — Operational & billing exceptions response contract.
 *
 * Shape returned by `GET /reporting/exceptions`. Drives the
 * operations-dashboard exceptions panel — surfaces invoice-vs-line-item
 * divergence + action-required counts in a compact envelope.
 *
 * Mirrors `getExceptions(tenantId)` in `reporting.service.ts` (lines
 * 963–994). The method composes one raw SQL query (`dataSource.query`,
 * wrapped in try/catch with empty-array fallback) + three TypeORM
 * entity `count()` calls.
 *
 * Standing rule (Phase 0): if the return literal in `getExceptions`
 * changes, this DTO must change with it. TypeScript enforces this
 * via the explicit `Promise<ExceptionsResponseDto>` return type.
 *
 * ─── Structural notes ───
 *
 * 1. POINT-IN-TIME endpoint, no `PeriodDto`. No date-window params.
 *    Every request regenerates the full envelope from current state.
 *
 * 2. FIRST try/catch-defensive query endpoint in the module.
 *    `inconsistencies` is initialized to `[]` at line 965, then the
 *    raw SQL query at line 967 is wrapped in `try { ... } catch { }`.
 *    On query failure (service comment: "table may not have expected
 *    schema yet"), `inconsistencies` silently stays empty and the
 *    envelope returns successfully. This is migration-resilience
 *    behavior for an evolving line-item schema. Wire contract for
 *    `inconsistencies` is non-nullable array (may be empty).
 *
 * 3. SECOND mixed-case DTO in the module (Phase 12 integrity-check
 *    was first). `inconsistencies[]` rows preserve SQL aliases
 *    `invoice_number` and `line_total` as wire field names because
 *    the service does NOT project SQL rows via `.map(...)`. Other
 *    fields and the envelope use camelCase. Per standing rule #3
 *    (Backend truth): DTO mirrors service emission verbatim.
 *
 * 4. FIRST pg decimal type-drift surface documented. The pg driver
 *    returns NUMERIC/DECIMAL columns as strings by default (preserves
 *    precision). Unlike other reporting endpoints that `Number()`-
 *    coerce via `.map(...)` projection, `getExceptions` does NOT
 *    project the raw SQL row. Wire-level runtime types of `total` and
 *    `line_total` may be `string` rather than `number`. DTO types as
 *    `number` per module convention (matches Phase 4-extract
 *    `RevenueDetailInvoiceDto.total` precedent); JSDoc on each
 *    affected field documents the drift surface. Coercion is a
 *    separate workstream if ever needed — Phase 14 documents,
 *    does not fix.
 *
 * 5. SERVER-SIDE 10-row cap on `inconsistencies[]` via SQL `LIMIT 10`.
 *    This is a display list for the operations dashboard, not a full
 *    audit list. Consumers cannot paginate; no offset param exists.
 *    Phase 7 `OverdueInvoiceRowDto[]` cap-at-50 precedent.
 *
 * 6. PHASE 13 AXIS-ASYMMETRY FLAG — BINARY CLOSURE.
 *
 *    Phase 13 (`29f1f8d`) flagged `RevenueBreakdownByTypeDto.failedTripRevenue`
 *    as having a different filter axis (`invoices.source` vs `line_type`)
 *    than its 5 sibling fields. The flag carried two implicit sub-concerns;
 *    Phase 14 produces a binary closure on each:
 *
 *      • Data-integrity concern — YES, ADDRESSED.
 *        The `inconsistencies[]` query at line 967 explicitly validates
 *        `invoice.total = SUM(line_items.net_amount)` per invoice via
 *        `HAVING ABS(i.total - COALESCE(SUM(li.net_amount), 0)) > 0.01`.
 *        Consumers of this endpoint detect per-invoice integrity
 *        violations directly. If `inconsistencies[]` returns empty, the
 *        invariant holds for the tenant; the Phase 13 axis asymmetry is
 *        purely a product-classification choice. If non-empty, the
 *        asymmetry is compounded by underlying integrity issues that
 *        require investigation.
 *
 *      • Classification concern — NO, NOT ADDRESSED.
 *        Whether `failed_trip` should be modeled via `line_type` instead
 *        of `invoices.source` is a product-layer modeling question. This
 *        endpoint surfaces data integrity, not classification correctness.
 *        Remains open as a separate product-review item; NOT routed to
 *        Phase 15.
 */

import { ApiProperty } from '@nestjs/swagger';

export class ExceptionsBillingInconsistencyDto {
  /** Invoice UUID from `invoices.id`. Primary key, non-null. */
  @ApiProperty({ description: 'Invoice UUID from invoices.id.' })
  id: string;

  /**
   * Invoice number — pg INT4 passthrough from SQL alias `invoice_number`.
   *
   * Snake_case wire name preserved intentionally: the service does NOT
   * project SQL rows via `.map(...)` in this endpoint, so SQL aliases
   * pass through verbatim (same pattern as Phase 12 integrity-check).
   */
  @ApiProperty({
    description:
      'Invoice number from invoices.invoice_number (INT4). Snake_case wire name preserved from SQL alias.',
  })
  invoice_number: number;

  /**
   * Stored invoice total — `invoices.total` value as recorded on the
   * invoice row.
   *
   * ⚠ PG DECIMAL TYPE-DRIFT SURFACE: The pg driver returns NUMERIC/DECIMAL
   * columns as strings by default (to preserve precision). Unlike other
   * reporting endpoints that `Number()`-coerce via `.map(...)` projection,
   * `getExceptions` at reporting.service.ts:963 does NOT project the raw
   * SQL row. The runtime wire representation depends on pg client
   * behavior and may be `string` rather than `number`.
   *
   * DTO types this field as `number` for consistency with module
   * convention (see `RevenueDetailInvoiceDto.total` at Phase 4-extract
   * as precedent). Consumers should not assume TypeScript type matches
   * runtime type without verification. Documented here, not fixed —
   * coercion is a separate workstream if ever needed.
   */
  @ApiProperty({
    description:
      'Stored invoice total (invoices.total). PG decimal type-drift: runtime may be string; typed as number per convention.',
  })
  total: number;

  /**
   * Sum of invoice line-item net amounts — `COALESCE(SUM(li.net_amount), 0)`.
   *
   * Snake_case wire name preserved from SQL alias (Phase 12 mixed-case
   * pattern). `COALESCE(..., 0)` guarantees numeric value; never null.
   *
   * ⚠ PG DECIMAL TYPE-DRIFT SURFACE: see `total` field JSDoc for full
   * context — same pg driver behavior applies.
   */
  @ApiProperty({
    description:
      'Sum of line-item net amounts (COALESCE(SUM(net_amount), 0)). PG decimal type-drift: see total field.',
  })
  line_total: number;
}

export class ExceptionsCriticalDto {
  /**
   * Invoice-vs-line-item divergence list — rows where stored
   * `invoices.total` diverges from `SUM(invoice_line_items.net_amount)`
   * by more than $0.01.
   *
   * SQL: `HAVING ABS(i.total - COALESCE(SUM(li.net_amount), 0)) > 0.01`.
   * Capped server-side at 10 rows (`LIMIT 10`) — this is a display list
   * for the operations dashboard, not a full audit list. Consumers
   * cannot paginate.
   *
   * Guaranteed non-null array: initialized to `[]` at line 965; the
   * wrapping try/catch at lines 966–977 preserves the empty array on
   * query failure (silent fallback). May be empty when no divergences
   * exist or when the query fails.
   *
   * This query addresses the data-integrity invariant underpinning the
   * Phase 13 axis-asymmetry flag (breakdown.failedTripRevenue). See
   * file-level JSDoc note 6 for the binary flag-closure detail.
   */
  @ApiProperty({
    type: [ExceptionsBillingInconsistencyDto],
    description:
      'Invoice-vs-line-item divergence > $0.01. Capped at 10 server-side. Empty on query failure (silent fallback).',
  })
  inconsistencies: ExceptionsBillingInconsistencyDto[];
}

export class ExceptionsActionRequiredDto {
  /** Count of jobs with `status = 'needs_reschedule'`. */
  @ApiProperty({
    description: "Count of jobs with status = 'needs_reschedule'.",
  })
  needsReschedule: number;

  /**
   * Count of invoices with `status = 'overdue'`.
   *
   * Disambiguation: this is a row COUNT, not a currency aggregate.
   * Distinct from:
   *   - Phase 5 `RevenueResponseDto.totalOverdue` (`OVERDUE_WINDOWED`,
   *     balance aggregate in window)
   *   - Phase 7 `AccountsReceivableResponseDto.totalOverdue`
   *     (`OVERDUE_ALL_TIME`, balance aggregate all-time)
   *
   * This field is not in the 7-label Path F vocabulary (no
   * `Semantic:` tag) because it aggregates row count, not currency.
   */
  @ApiProperty({
    description:
      "Count of invoices with status = 'overdue'. Row count, not balance aggregate (distinct from totalOverdue tagged fields).",
  })
  overdueInvoices: number;

  /** Count of jobs with `is_overdue = true`. */
  @ApiProperty({
    description: 'Count of jobs with is_overdue = true.',
  })
  overdueRentals: number;
}

export class ExceptionsResponseDto {
  /** Critical exceptions — billing inconsistencies above $0.01 divergence. */
  @ApiProperty({
    type: ExceptionsCriticalDto,
    description:
      'Critical exceptions — billing inconsistencies above $0.01 divergence.',
  })
  critical: ExceptionsCriticalDto;

  /** Action-required counts — operational follow-up summary. */
  @ApiProperty({
    type: ExceptionsActionRequiredDto,
    description: 'Action-required counts — operational follow-up summary.',
  })
  actionRequired: ExceptionsActionRequiredDto;
}
