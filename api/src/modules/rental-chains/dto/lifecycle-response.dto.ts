/**
 * Phase 2c Follow-Up #3 — Rental-chain lifecycle response contract.
 *
 * Shape returned by `GET /rental-chains/:id/lifecycle`. The rentals
 * admin page (`web/src/app/(dashboard)/rentals/[id]/page.tsx`) and
 * a secondary consumer on the Job Detail page both deserialize this
 * shape via manually-mirrored frontend interfaces.
 *
 * The `RentalChainLifecycle` prefix disambiguates this DTO family
 * from the existing `LifecycleContextResponse` in
 * `api/src/modules/jobs/dto/lifecycle-context.dto.ts` (a different
 * lifecycle shape owned by the jobs module — that one powers
 * the Connected Job Lifecycle panel; this one powers the rentals
 * lifecycle drill-down).
 *
 * **Standing rule:** if the projection literal in
 * `rental-chains.service.ts#getLifecycle` changes, this DTO must
 * change with it. TypeScript will enforce this now that the method
 * has an explicit return type — any field added/removed/renamed in
 * the literal without a matching DTO update will fail typecheck.
 *
 * Field-level conventions:
 * - Mixed casing (`scheduledDate` alongside `sequence_number`) is
 *   intentional and preserved verbatim — the projection is what it
 *   is; this DTO does not normalize it.
 * - `string | null` is used for nullable fields whose runtime origin
 *   is a TypeORM column declared `nullable: true` (e.g.
 *   `expectedPickupDate`). `?:` is used where the runtime value
 *   originates from optional chaining (e.g. `id: l.job?.id` →
 *   `id?: string`).
 * - `Record<string, unknown>` is used for genuinely-dynamic JSON
 *   columns (e.g. `pricingSnapshot`).
 *
 * ─── Class-based DTO convention ───
 * Converted from `export interface` to `export class` with
 * `@ApiProperty` decorators (Follow-Up #3 backport). Classes declared
 * bottom-up (leaf shapes first, parent `RentalChainLifecycleResponseDto`
 * last) so direct class references suffice — no forward-reference
 * closures required.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type RentalChainLifecycleClassification = 'legacy' | 'post-correction';

const CLASSIFICATION_VALUES: RentalChainLifecycleClassification[] = [
  'legacy',
  'post-correction',
];

export class RentalChainLifecycleCustomerDto {
  @ApiProperty()
  id: string;

  /** Concatenated `${first_name} ${last_name}`. */
  @ApiProperty({ description: 'Concatenated ${first_name} ${last_name}' })
  name: string;

  @ApiProperty()
  accountId: string;
}

export class RentalChainLifecycleAssetDto {
  @ApiProperty()
  subtype: string;

  @ApiProperty()
  identifier: string;
}

export class RentalChainLifecycleDriverDto {
  /** Concatenated `${first_name} ${last_name}`. */
  @ApiProperty({ description: 'Concatenated ${first_name} ${last_name}' })
  name: string;
}

export class RentalChainLifecycleInvoiceLineItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  line_type: string;

  @ApiProperty()
  name: string;

  /** From `li.net_amount`. Numeric in DB; raw query returns string-ish that JSON.stringifies as number. */
  @ApiProperty()
  amount: number;

  @ApiProperty()
  sort_order: number;
}

export class RentalChainLifecyclePaymentDto {
  @ApiProperty()
  id: string;

  /** Coerced via `Number(p.amount)`. */
  @ApiProperty()
  amount: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  paymentMethod: string;

  /** ISO timestamp string (raw query result). */
  @ApiProperty({ description: 'ISO timestamp string (raw query result).' })
  appliedAt: string;
}

export class RentalChainLifecycleDumpTicketDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  ticketNumber: string | null;

  /** Coerced via `Number(t.weight_tons)`. */
  @ApiProperty()
  weightTons: number;

  /** Coerced via `Number(t.total_cost)`. */
  @ApiProperty()
  totalCost: number;

  /** Coerced via `Number(t.customer_charges)`. */
  @ApiProperty()
  customerCharges: number;

  @ApiProperty({ nullable: true })
  wasteType: string | null;
}

export class RentalChainLifecycleJobCostDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  costType: string;

  /** Coerced via `Number(jc.amount)`. */
  @ApiProperty()
  amount: number;

  @ApiProperty({ nullable: true })
  description: string | null;
}

export class RentalChainLifecycleFinancialsDto {
  /** From `getFinancials` — coerced via `Number(...)`. */
  @ApiProperty()
  totalRevenue: number;

  @ApiProperty()
  totalCost: number;

  /** Rounded to 2 decimal places: `Math.round((revenue - cost) * 100) / 100`. */
  @ApiProperty()
  profit: number;

  /** Rounded to 2 decimal places. Zero when revenue is zero. */
  @ApiProperty()
  marginPercent: number;
}

export class RentalChainLifecycleChainDto {
  @ApiProperty()
  id: string;

  /** active | completed | cancelled */
  @ApiProperty({ description: 'active | completed | cancelled' })
  status: string;

  /** Nullable in DB (`rental_chains.dumpster_size` `nullable: true`). */
  @ApiProperty({
    nullable: true,
    description: 'Nullable in DB (rental_chains.dumpster_size nullable: true).',
  })
  dumpsterSize: string | null;

  /** Historical rental days at chain creation; default 14. */
  @ApiProperty({
    description: 'Historical rental days at chain creation; default 14.',
  })
  rentalDays: number;

  /** Live tenant default rental period (NOT the chain's snapshot). */
  @ApiProperty({
    description:
      "Live tenant default rental period (NOT the chain's snapshot).",
  })
  tenantRentalDays: number;

  @ApiProperty()
  dropOffDate: string;

  /** Nullable in DB (`rental_chains.expected_pickup_date` `nullable: true`). */
  @ApiProperty({
    nullable: true,
    description:
      'Nullable in DB (rental_chains.expected_pickup_date nullable: true).',
  })
  expectedPickupDate: string | null;

  /** TypeORM @CreateDateColumn — Date instance on the server, ISO string over the wire. */
  @ApiProperty({
    type: Date,
    description:
      'TypeORM @CreateDateColumn — Date instance on the server, ISO string over the wire.',
  })
  createdAt: Date;

  @ApiProperty({ enum: CLASSIFICATION_VALUES })
  classification: RentalChainLifecycleClassification;
}

export class RentalChainLifecycleJobDto {
  /** `l.job?.id` — undefined if the underlying job row is missing. */
  @ApiPropertyOptional({
    description: 'l.job?.id — undefined if the underlying job row is missing.',
  })
  id?: string;

  /** TaskChainLink primary key. */
  @ApiProperty({ description: 'TaskChainLink primary key.' })
  linkId: string;

  /** TaskChainLink.status. */
  @ApiProperty({ description: 'TaskChainLink.status.' })
  linkStatus: string;

  /** `l.job?.job_number`. */
  @ApiPropertyOptional({ description: 'l.job?.job_number.' })
  jobNumber?: string;

  /** TaskChainLink.task_type — drop_off | pick_up | exchange. */
  @ApiProperty({
    description: 'TaskChainLink.task_type — drop_off | pick_up | exchange.',
  })
  taskType: string;

  /**
   * Phase 2c-Prereq-0 (commit `0b764ad`) — operator-intent ordering
   * within the chain, sourced from `task_chain_links.sequence_number`
   * (NOT from any column on jobs). Required for the canonical
   * pickup-node selector to pick the correct row when multiple
   * non-cancelled pickups coexist (e.g. back-dated exchange).
   *
   * Snake_case is preserved verbatim — the projection literal uses
   * `sequence_number` mixed in with camelCase siblings.
   */
  @ApiProperty({
    description:
      'Operator-intent ordering within the chain (task_chain_links.sequence_number). Snake_case preserved to match the projection literal. See Prereq-0 commit 0b764ad.',
  })
  sequence_number: number;

  /** `l.job?.status`. */
  @ApiPropertyOptional({ description: 'l.job?.status.' })
  status?: string;

  /** TaskChainLink.scheduled_date — date string YYYY-MM-DD. */
  @ApiProperty({
    description: 'TaskChainLink.scheduled_date — date string YYYY-MM-DD.',
  })
  scheduledDate: string;

  /** TaskChainLink.completed_at — Date or null when not yet completed. */
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'TaskChainLink.completed_at — Date or null when not yet completed.',
  })
  completedAt: Date | null;

  @ApiProperty({ type: RentalChainLifecycleAssetDto, nullable: true })
  asset: RentalChainLifecycleAssetDto | null;

  @ApiProperty({ type: RentalChainLifecycleDriverDto, nullable: true })
  driver: RentalChainLifecycleDriverDto | null;

  @ApiProperty({ enum: CLASSIFICATION_VALUES, nullable: true })
  classification: RentalChainLifecycleClassification | null;
}

export class RentalChainLifecycleInvoiceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceNumber: number;

  /** Coerced via `Number(i.total)`. */
  @ApiProperty()
  total: number;

  @ApiProperty()
  status: string;

  /** Coerced via `Number(i.balance_due)`. */
  @ApiProperty()
  balanceDue: number;

  /** Filtered to entries with truthy `id` (raw query json_agg can include nulls). */
  @ApiProperty({
    type: [RentalChainLifecycleInvoiceLineItemDto],
    description:
      'Filtered to entries with truthy id (raw query json_agg can include nulls).',
  })
  lineItems: RentalChainLifecycleInvoiceLineItemDto[];

  /** `invoices.pricing_rule_snapshot` JSONB column. */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'invoices.pricing_rule_snapshot JSONB column.',
  })
  pricingSnapshot: Record<string, unknown> | null;

  @ApiProperty({ enum: CLASSIFICATION_VALUES })
  classification: RentalChainLifecycleClassification;
}

export class RentalChainLifecycleResponseDto {
  @ApiProperty({ type: RentalChainLifecycleChainDto })
  rentalChain: RentalChainLifecycleChainDto;

  @ApiProperty({ type: RentalChainLifecycleCustomerDto, nullable: true })
  customer: RentalChainLifecycleCustomerDto | null;

  @ApiProperty({ type: [RentalChainLifecycleJobDto] })
  jobs: RentalChainLifecycleJobDto[];

  @ApiProperty({ type: [RentalChainLifecycleInvoiceDto] })
  invoices: RentalChainLifecycleInvoiceDto[];

  @ApiProperty({ type: [RentalChainLifecyclePaymentDto] })
  payments: RentalChainLifecyclePaymentDto[];

  @ApiProperty({ type: [RentalChainLifecycleDumpTicketDto] })
  dumpTickets: RentalChainLifecycleDumpTicketDto[];

  @ApiProperty({ type: [RentalChainLifecycleJobCostDto] })
  jobCosts: RentalChainLifecycleJobCostDto[];

  @ApiProperty({ type: RentalChainLifecycleFinancialsDto })
  financials: RentalChainLifecycleFinancialsDto;
}
