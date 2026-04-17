/**
 * Type-only sanity check for `RentalChainLifecycleResponseDto`.
 *
 * No Jest, no runtime assertions — the load-bearing check is
 * `tsc --noEmit`. This file exists to:
 *   1. Prove that a representative runtime-shape fixture compiles
 *      against the DTO (positive case).
 *   2. Prove the DTO actually rejects shape drift via `@ts-expect-error`
 *      (negative case — if the DTO ever stops catching the drift, the
 *      directive itself fails to compile and tsc errors out).
 *
 * The `.type-spec.ts` suffix is used so Jest does NOT attempt to run
 * this as a test (Jest globs `.spec.ts` only). TypeScript picks it up
 * via the project's default include pattern.
 */

import type { RentalChainLifecycleResponseDto } from './lifecycle-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: RentalChainLifecycleResponseDto = {
  rentalChain: {
    id: 'chain-uuid',
    status: 'active',
    dumpsterSize: '20-yard',
    rentalDays: 14,
    tenantRentalDays: 14,
    dropOffDate: '2026-04-01',
    expectedPickupDate: '2026-04-15',
    createdAt: new Date('2026-04-01T10:00:00Z'),
    classification: 'post-correction',
  },
  customer: {
    id: 'cust-uuid',
    name: 'Jane Doe',
    accountId: 'ACC-123',
  },
  jobs: [
    {
      id: 'job-uuid',
      linkId: 'link-uuid',
      linkStatus: 'scheduled',
      jobNumber: 'JOB-1001',
      taskType: 'pick_up',
      sequence_number: 2,
      status: 'pending',
      scheduledDate: '2026-04-15',
      completedAt: null,
      asset: { subtype: '20-yard', identifier: 'D-42' },
      driver: { name: 'Driver Smith' },
      classification: 'post-correction',
    },
    // Cover the optional / nullable branches that would not appear
    // when the underlying join populates them.
    {
      // id, jobNumber, status omitted (l.job?.* yielded undefined)
      linkId: 'link-orphan',
      linkStatus: 'cancelled',
      taskType: 'drop_off',
      sequence_number: 1,
      scheduledDate: '2026-04-01',
      completedAt: new Date('2026-04-01T14:00:00Z'),
      asset: null,
      driver: null,
      classification: null,
    },
  ],
  invoices: [
    {
      id: 'inv-uuid',
      invoiceNumber: 1042,
      total: 250.0,
      status: 'paid',
      balanceDue: 0,
      lineItems: [
        {
          id: 'li-uuid',
          line_type: 'rental',
          name: 'Dumpster rental',
          amount: 250.0,
          sort_order: 0,
        },
      ],
      pricingSnapshot: { rule_id: 'pr-uuid', tier: 'standard' },
      classification: 'legacy',
    },
  ],
  payments: [
    {
      id: 'pay-uuid',
      amount: 250.0,
      status: 'completed',
      paymentMethod: 'card',
      appliedAt: '2026-04-02T09:00:00Z',
    },
  ],
  dumpTickets: [
    {
      id: 'dt-uuid',
      ticketNumber: 'T-77',
      weightTons: 1.5,
      totalCost: 75.0,
      customerCharges: 80.0,
      wasteType: 'mixed',
    },
  ],
  jobCosts: [
    {
      id: 'jc-uuid',
      costType: 'disposal',
      amount: 75.0,
      description: 'Tipping fee',
    },
  ],
  financials: {
    totalRevenue: 250,
    totalCost: 75,
    profit: 175,
    marginPercent: 70,
  },
};
// Reference the binding so the unused-vars rule does not flag it.
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// If the DTO is ever weakened so this becomes valid, the
// `@ts-expect-error` directive itself becomes invalid and tsc errors
// with "Unused '@ts-expect-error' directive." That is the regression
// signal: the contract used to reject this fixture and no longer does.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: RentalChainLifecycleResponseDto = {
  ..._validFixture,
  jobs: [
    {
      ..._validFixture.jobs[0],
      // @ts-expect-error — sequence_number must be number, not string.
      // This is the load-bearing field shipped in Prereq-0 (commit
      // 0b764ad); accidental retyping would silently break the
      // canonical pickup-node selector's sequence-partition tiebreak.
      sequence_number: 'not-a-number',
    },
  ],
};
void _invalidFixture;
