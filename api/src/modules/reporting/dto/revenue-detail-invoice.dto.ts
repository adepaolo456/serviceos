/**
 * Shared invoice-row sub-DTO for revenue drill-down reporting endpoints.
 *
 * This shape is produced by the private `mapInvoiceRows(rows)` helper
 * in `reporting.service.ts` (lines 159–172), which is called by four
 * code paths spread across three endpoints:
 *
 *   - `GET /reporting/revenue/source-detail`
 *       → `getRevenueBySourceDetail(...)`           (line 186)
 *   - `GET /reporting/revenue/daily-detail`
 *       → `getRevenueByDailyDetail(...)`            (line 198)
 *   - `GET /reporting/revenue/invoices`             (two SQL variants)
 *       → `getRevenueInvoices(...)` 'collected'     (line 228)
 *       → `getRevenueInvoices(...)` default/other   (line 254)
 *
 * The 'collected' branch uses a distinct subquery for `amountPaid`
 * (pulling from `payments` directly with `p.status = 'completed'`)
 * instead of the invoice's denormalized `amount_paid` column, but it
 * projects the same 10-column SELECT list and passes through
 * `mapInvoiceRows`. Output shape: byte-identical across all four
 * paths — Phase 4-extract audit confirmed exact convergence
 * (Outcome A).
 *
 * Standing rule (Phase 0): if `mapInvoiceRows` or its upstream raw
 * SQL (`invoiceDetailSelect` on lines 149–157) changes, this DTO
 * must change with it. TypeScript will enforce that for every
 * consumer that imports `RevenueDetailInvoiceDto`. Each of Phases
 * 4a/b/c will activate this enforcement by annotating its
 * `Promise<XxxResponseDto>` return type on the service method.
 *
 * No type-spec test in this commit — shared sub-DTOs test via
 * their consumers' type-specs (precedent: `period.dto.ts` has no
 * standalone type-spec and is validated through
 * `profit-response.dto.type-spec.ts` and
 * `customers-response.dto.type-spec.ts`). The first consumer's
 * positive fixture (Phase 4a) will implicitly validate this DTO's
 * shape.
 *
 * ─── Type-precedent notes (matches Follow-Up #3) ───
 * - `invoiceNumber: number` — the `pg` driver returns INT4 columns
 *   as JS numbers by default; `RentalChainLifecycleInvoiceDto`
 *   (commit 5e5520f) declared this field as `number` and has been
 *   shipping to production without complaint. Matches that
 *   precedent over the looser frontend interface which declared
 *   `string` on `SourceDetailInvoice` (latent frontend-type drift;
 *   tolerated by JS implicit number→string coercion in render
 *   pipelines; Phase 4a consumers should tighten their frontend
 *   mirrors when they wire up).
 * - `createdAt: Date` — TIMESTAMP columns come back from `pg` as
 *   Date instances server-side; serialized to ISO string over the
 *   wire. Same precedent as
 *   `RentalChainLifecycleChainDto.createdAt`.
 *
 * ─── Nullability notes ───
 * - `jobId` / `jobNumber` are from `LEFT JOIN jobs j ON j.id = i.job_id`.
 *   If the invoice has no `job_id` linkage, both columns return NULL.
 *   Declared `string | null` per backend truth — more permissive than
 *   the frontend's `SourceDetailInvoice` interface which declared
 *   non-null string. In practice, revenue invoices typically have a
 *   job linkage, but the DTO models the actual contract so future
 *   consumers aren't surprised.
 */

import { ApiProperty } from '@nestjs/swagger';

export class RevenueDetailInvoiceDto {
  /** UUID from `invoices.id`. */
  @ApiProperty({ description: 'UUID from invoices.id.' })
  id: string;

  /** From `invoices.invoice_number` (INT4 → JS number via pg driver). */
  @ApiProperty({
    description:
      'From invoices.invoice_number (INT4 → JS number via pg driver).',
  })
  invoiceNumber: number;

  /**
   * Display name from
   * `COALESCE(NULLIF(TRIM(first_name + ' ' + last_name), ''), 'Unknown Customer')`.
   * Falls back to the literal `'Unknown Customer'` when both names
   * are empty or null on the joined customer row.
   */
  @ApiProperty({
    description:
      "Display name from customers; falls back to 'Unknown Customer' when both names are empty.",
  })
  customerName: string;

  /** Invoice total, coerced via `Number(r.total)`. */
  @ApiProperty({ description: 'Invoice total, coerced via Number(r.total).' })
  total: number;

  /**
   * Amount paid. In the default `getRevenueInvoices` path and the
   * source-detail / daily-detail methods, sourced from the
   * denormalized `invoices.amount_paid` column. In the 'collected'
   * branch (line 207–228), computed via a subquery over `payments`
   * with `status = 'completed'` (SUM of `amount - refunded_amount`).
   * Both paths `Number()`-coerce the result.
   */
  @ApiProperty({
    description:
      'Amount paid. Sourced from invoices.amount_paid in default path; from completed payments subquery in the collected branch.',
  })
  amountPaid: number;

  /** Balance due, coerced via `Number(r.balance_due)`. */
  @ApiProperty({
    description: 'Balance due, coerced via Number(r.balance_due).',
  })
  balanceDue: number;

  /** Invoice status (e.g. `open`, `paid`, `partial`, `voided`, `draft`). Not enumerated at the DTO layer. */
  @ApiProperty({
    description:
      'Invoice status (open, paid, partial, voided, draft, ...). Not enumerated at the DTO layer.',
  })
  status: string;

  /**
   * Invoice creation timestamp. `pg` returns TIMESTAMP columns as
   * Date instances server-side; JSON serialization produces an ISO
   * string on the wire. Matches the
   * `RentalChainLifecycleChainDto.createdAt` precedent.
   */
  @ApiProperty({
    type: Date,
    description:
      'TIMESTAMP from invoices.created_at. Date instance server-side; ISO string over the wire.',
  })
  createdAt: Date;

  /**
   * Linked job UUID from `LEFT JOIN jobs j ON j.id = i.job_id`.
   * `null` when the invoice has no job linkage (rare for revenue
   * invoices but structurally possible).
   */
  @ApiProperty({
    nullable: true,
    description: 'Linked job UUID; null when the invoice has no job linkage.',
  })
  jobId: string | null;

  /**
   * Linked job number from the same `LEFT JOIN`. Same nullability
   * as `jobId` — the two fields travel together (either both set or
   * both null based on whether the join matched).
   */
  @ApiProperty({
    nullable: true,
    description: 'Linked job number; null when the invoice has no job linkage.',
  })
  jobNumber: string | null;
}
