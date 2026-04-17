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
 */

export type RentalChainLifecycleClassification = 'legacy' | 'post-correction';

export interface RentalChainLifecycleChainDto {
  id: string;
  /** active | completed | cancelled */
  status: string;
  /** Nullable in DB (`rental_chains.dumpster_size` `nullable: true`). */
  dumpsterSize: string | null;
  /** Historical rental days at chain creation; default 14. */
  rentalDays: number;
  /** Live tenant default rental period (NOT the chain's snapshot). */
  tenantRentalDays: number;
  dropOffDate: string;
  /** Nullable in DB (`rental_chains.expected_pickup_date` `nullable: true`). */
  expectedPickupDate: string | null;
  /** TypeORM @CreateDateColumn — Date instance on the server, ISO string over the wire. */
  createdAt: Date;
  classification: RentalChainLifecycleClassification;
}

export interface RentalChainLifecycleCustomerDto {
  id: string;
  /** Concatenated `${first_name} ${last_name}`. */
  name: string;
  accountId: string;
}

export interface RentalChainLifecycleAssetDto {
  subtype: string;
  identifier: string;
}

export interface RentalChainLifecycleDriverDto {
  /** Concatenated `${first_name} ${last_name}`. */
  name: string;
}

export interface RentalChainLifecycleJobDto {
  /** `l.job?.id` — undefined if the underlying job row is missing. */
  id?: string;
  /** TaskChainLink primary key. */
  linkId: string;
  /** TaskChainLink.status. */
  linkStatus: string;
  /** `l.job?.job_number`. */
  jobNumber?: string;
  /** TaskChainLink.task_type — drop_off | pick_up | exchange. */
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
  sequence_number: number;
  /** `l.job?.status`. */
  status?: string;
  /** TaskChainLink.scheduled_date — date string YYYY-MM-DD. */
  scheduledDate: string;
  /** TaskChainLink.completed_at — Date or null when not yet completed. */
  completedAt: Date | null;
  asset: RentalChainLifecycleAssetDto | null;
  driver: RentalChainLifecycleDriverDto | null;
  classification: RentalChainLifecycleClassification | null;
}

export interface RentalChainLifecycleInvoiceLineItemDto {
  id: string;
  line_type: string;
  name: string;
  /** From `li.net_amount`. Numeric in DB; raw query returns string-ish that JSON.stringifies as number. */
  amount: number;
  sort_order: number;
}

export interface RentalChainLifecycleInvoiceDto {
  id: string;
  invoiceNumber: number;
  /** Coerced via `Number(i.total)`. */
  total: number;
  status: string;
  /** Coerced via `Number(i.balance_due)`. */
  balanceDue: number;
  /** Filtered to entries with truthy `id` (raw query json_agg can include nulls). */
  lineItems: RentalChainLifecycleInvoiceLineItemDto[];
  /** `invoices.pricing_rule_snapshot` JSONB column. */
  pricingSnapshot: Record<string, unknown> | null;
  classification: RentalChainLifecycleClassification;
}

export interface RentalChainLifecyclePaymentDto {
  id: string;
  /** Coerced via `Number(p.amount)`. */
  amount: number;
  status: string;
  paymentMethod: string;
  /** ISO timestamp string (raw query result). */
  appliedAt: string;
}

export interface RentalChainLifecycleDumpTicketDto {
  id: string;
  ticketNumber: string | null;
  /** Coerced via `Number(t.weight_tons)`. */
  weightTons: number;
  /** Coerced via `Number(t.total_cost)`. */
  totalCost: number;
  /** Coerced via `Number(t.customer_charges)`. */
  customerCharges: number;
  wasteType: string | null;
}

export interface RentalChainLifecycleJobCostDto {
  id: string;
  costType: string;
  /** Coerced via `Number(jc.amount)`. */
  amount: number;
  description: string | null;
}

export interface RentalChainLifecycleFinancialsDto {
  /** From `getFinancials` — coerced via `Number(...)`. */
  totalRevenue: number;
  totalCost: number;
  /** Rounded to 2 decimal places: `Math.round((revenue - cost) * 100) / 100`. */
  profit: number;
  /** Rounded to 2 decimal places. Zero when revenue is zero. */
  marginPercent: number;
}

export interface RentalChainLifecycleResponseDto {
  rentalChain: RentalChainLifecycleChainDto;
  customer: RentalChainLifecycleCustomerDto | null;
  jobs: RentalChainLifecycleJobDto[];
  invoices: RentalChainLifecycleInvoiceDto[];
  payments: RentalChainLifecyclePaymentDto[];
  dumpTickets: RentalChainLifecycleDumpTicketDto[];
  jobCosts: RentalChainLifecycleJobCostDto[];
  financials: RentalChainLifecycleFinancialsDto;
}
