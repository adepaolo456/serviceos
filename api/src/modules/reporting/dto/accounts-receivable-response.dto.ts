/**
 * Reporting DTO Phase 7 — Accounts-receivable aging response contract.
 *
 * Shape returned by `GET /reporting/accounts-receivable`. Drives the
 * AR aging dashboard — point-in-time view of outstanding and overdue
 * balance, bucketed by days-past-due, plus a capped list of the
 * oldest overdue invoices.
 *
 * Mirrors `getAccountsReceivable(tenantId)` in `reporting.service.ts`
 * (lines 534–591). POINT-IN-TIME endpoint — no date window, no
 * `startDate`/`endDate` query params, no `PeriodDto` in the return.
 * Matches the `AssetsResponseDto` (Phase 2) precedent for non-windowed
 * reporting endpoints.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getAccountsReceivable` changes, this DTO must change with it.
 * TypeScript enforces this via the method's explicit
 * `Promise<AccountsReceivableResponseDto>` return type.
 *
 * ─── Cross-references to Phase 5 (`dd7fea8`) ───
 * Both `totalOutstanding` and `totalOverdue` appear on this DTO AND
 * on `RevenueResponseDto`. They are SEMANTICALLY ADJACENT but use
 * DIFFERENT inclusion filters — see per-field JSDocs. Do not model
 * them as equivalent:
 *   - This DTO's fields are ALL-TIME (no window filter; every open
 *     /partial invoice counts, regardless of when it was created).
 *   - Revenue's fields are WINDOWED by `invoices.created_at` in
 *     the `?startDate=`/`?endDate=` range.
 * They will diverge whenever the window is narrower than the full
 * invoice history.
 */

import { ApiProperty } from '@nestjs/swagger';

export class AgingBucketDto {
  /** Count of invoices in the bucket. */
  @ApiProperty({ description: 'Count of open/partial invoices in the bucket.' })
  count: number;

  /**
   * Semantic: OUTSTANDING_ALL_TIME
   * Source: SUM(balance_due) per aging bucket
   * Scope: All-time; bucketed by due_date gap
   *
   * Sum of `balance_due` for invoices in the bucket (USD).
   * Always `Number()`-coerced server-side; always a real number,
   * never null (service substitutes `0` on empty buckets).
   */
  @ApiProperty({
    description: 'Sum of balance_due for invoices in the bucket (USD).',
  })
  amount: number;
}

export class AgingBucketsDto {
  /**
   * Not-yet-due bucket — invoices with `due_date >= today`. Typically
   * the largest amount in a healthy AR book; an outsized
   * `current.amount` relative to overdue buckets is a good signal.
   */
  @ApiProperty({
    type: AgingBucketDto,
    description: 'Not-yet-due bucket (due_date >= today).',
  })
  current: AgingBucketDto;

  /** 1–30 days past due — `due_date` in `[today - 30, today)`. */
  @ApiProperty({
    type: AgingBucketDto,
    description: '1–30 days past due (due_date in [today - 30, today)).',
  })
  days30: AgingBucketDto;

  /** 31–60 days past due — `due_date` in `[today - 60, today - 30)`. */
  @ApiProperty({
    type: AgingBucketDto,
    description: '31–60 days past due (due_date in [today - 60, today - 30)).',
  })
  days60: AgingBucketDto;

  /** 61–90 days past due — `due_date` in `[today - 90, today - 60)`. */
  @ApiProperty({
    type: AgingBucketDto,
    description: '61–90 days past due (due_date in [today - 90, today - 60)).',
  })
  days90: AgingBucketDto;

  /**
   * 90+ days past due — `due_date < today - 90`. Catch-all for the
   * tail; a healthy book keeps this near zero.
   */
  @ApiProperty({
    type: AgingBucketDto,
    description: '90+ days past due (due_date < today - 90).',
  })
  days90plus: AgingBucketDto;
}

export class OverdueInvoiceRowDto {
  /** Invoice UUID from `invoices.id`. */
  @ApiProperty({ description: 'Invoice UUID from invoices.id.' })
  invoiceId: string;

  /**
   * Invoice number — INT4 column from `invoices.invoice_number`.
   * `number` per Phase 4-extract precedent (pg driver returns INT4
   * as JS number).
   */
  @ApiProperty({ description: 'Invoice number from invoices.invoice_number.' })
  invoiceNumber: number;

  /**
   * Display name — `${customer.first_name} ${customer.last_name}`
   * when the customer relation loads, otherwise the literal string
   * `'Unknown'`. Note: this fallback is `'Unknown'` (single word), NOT
   * `'Unknown Customer'` as used by Phase 3/4 DTOs. Wire contract
   * preserved as-is; frontend consumers should not assume a unified
   * fallback string across AR and other reports.
   */
  @ApiProperty({
    description:
      "Display name; falls back to 'Unknown' (NOT 'Unknown Customer') when the customer relation is absent.",
  })
  customerName: string;

  /**
   * Semantic: OUTSTANDING_ALL_TIME
   * Source: Number(invoices.balance_due) row-level
   * Scope: All-time; per-invoice, status open/partial, due_date < today
   *
   * Outstanding amount on the invoice — `Number(invoices.balance_due)`.
   * Projection rename: entity column `balance_due` → wire field
   * `amount`.
   */
  @ApiProperty({
    description: 'Outstanding amount (Number(invoices.balance_due)).',
  })
  amount: number;

  /**
   * Invoice due date in `YYYY-MM-DD` form. Sourced from the typeorm
   * entity field `due_date`, which is declared as `string` (typeorm
   * returns DATE columns as YYYY-MM-DD strings by default, not Date
   * instances).
   */
  @ApiProperty({
    description: 'Due date from invoices.due_date, in YYYY-MM-DD form.',
  })
  dueDate: string;

  /**
   * Days past due, computed server-side at request time:
   * `Math.ceil((Date.now() - new Date(dueDate)) / 86_400_000)`.
   * Always positive (rows are already filtered `due_date < today`);
   * value reflects the server clock at the moment of the request,
   * not a stored column.
   */
  @ApiProperty({
    description:
      'Days past due (server-computed: ceil((now - dueDate) / day)). Always positive.',
  })
  daysPastDue: number;
}

export class AccountsReceivableResponseDto {
  /**
   * Semantic: OUTSTANDING_ALL_TIME
   * Source: SUM(balance_due) WHERE status IN (open, partial)
   * Scope: All-time; no window
   *
   * Total outstanding balance across ALL open/partial invoices for
   * the tenant, regardless of creation date.
   * Formula: `SUM(balance_due) WHERE status IN ('open', 'partial')`.
   *
   * ⚠ Cross-reference: `RevenueResponseDto.totalOutstanding` (Phase 5,
   * `dd7fea8`) uses the SAME status filter but adds a WINDOWED
   * filter on `invoices.created_at`. The two fields are equal only
   * when the revenue window spans the full invoice history;
   * otherwise AR's figure is larger. Do NOT cross-wire the two —
   * name collision is intentional (both fields describe
   * "outstanding"), but the inclusion filters differ.
   */
  @ApiProperty({
    description:
      "All-time outstanding balance (SUM(balance_due) WHERE status IN ('open','partial')). Distinct from revenue.totalOutstanding which is windowed.",
  })
  totalOutstanding: number;

  /**
   * Semantic: OVERDUE_ALL_TIME
   * Source: SUM(balance_due) WHERE open/partial AND due_date < today
   * Scope: All-time; due_date < today
   *
   * Total overdue balance across ALL open/partial invoices with
   * `due_date < today`, regardless of creation date.
   * Formula: `SUM(balance_due) WHERE status IN ('open', 'partial')
   * AND due_date < today`.
   *
   * ⚠ Cross-reference: `RevenueResponseDto.totalOverdue` (Phase 5,
   * `dd7fea8`) uses the SAME status + overdue filters but adds a
   * WINDOWED filter on `invoices.created_at`. The two fields are
   * equal only when the revenue window spans the full invoice
   * history; otherwise AR's figure is larger.
   */
  @ApiProperty({
    description:
      'All-time overdue balance (SUM(balance_due) WHERE open/partial AND due_date < today). Distinct from revenue.totalOverdue which is windowed.',
  })
  totalOverdue: number;

  /**
   * Aging-bucket breakdown of all open/partial invoices with
   * `balance_due > 0`. Buckets are fixed (current / 30 / 60 / 90 /
   * 90+), not dynamic — keys are enumerated at the DTO level.
   */
  @ApiProperty({
    type: AgingBucketsDto,
    description:
      'Fixed-key aging bucket breakdown (current/days30/days60/days90/days90plus).',
  })
  aging: AgingBucketsDto;

  /**
   * List of overdue invoices (status in open/partial, `due_date <
   * today`, `balance_due > 0`), ordered `due_date ASC`, capped at
   * **50 rows** server-side via `.take(50)`. This is a display list
   * for the AR dashboard's "oldest outstanding" panel — not a
   * complete audit list. Consumers that need the full set should
   * paginate via a dedicated endpoint.
   */
  @ApiProperty({
    type: [OverdueInvoiceRowDto],
    description:
      'Overdue invoices ordered by due_date ASC, CAPPED AT 50 ROWS server-side. Not a full audit list.',
  })
  overdueInvoices: OverdueInvoiceRowDto[];
}
