/**
 * Type-only sanity check for `CustomersResponseDto`.
 *
 * No Jest, no runtime assertions — the load-bearing check is
 * `tsc --noEmit`. This file exists to:
 *   1. Prove that a representative runtime-shape fixture compiles
 *      against the DTO (positive case).
 *   2. Prove the DTO actually rejects shape drift via
 *      `@ts-expect-error` (negative case — if the DTO ever stops
 *      catching the drift, the directive itself fails to compile
 *      and tsc errors out with TS2578).
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 template:
 * Jest globs `.spec.ts` only, so this file is picked up by `tsc`
 * but NOT by `jest`.
 */

import type { CustomersResponseDto } from './customers-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: CustomersResponseDto = {
  totalCustomers: 247,
  newCustomersInPeriod: 18,
  customersByType: {
    residential: 212,
    commercial: 35,
  },
  topCustomers: [
    {
      customerId: 'cust-uuid-1',
      name: 'Jane Doe',
      type: 'residential',
      totalJobs: 7,
      totalSpend: 4820.5,
    },
    {
      customerId: 'cust-uuid-2',
      name: 'Acme Construction LLC',
      type: 'commercial',
      totalJobs: 12,
      totalSpend: 18400,
    },
  ],
  period: {
    start: '2026-01-01',
    end: '2026-03-31',
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
// signal: the contract used to reject this fixture and no longer
// does.
//
// `topCustomers[].totalSpend` is picked as the sentinel because:
//   1. It is the most structurally-load-bearing numeric field —
//      analytics renders it as currency; drift from `number` to
//      `string` would silently break every downstream
//      `formatCurrency(...)` pipeline.
//   2. It carries the Risk #1-adjacent semantic (invoiced, NOT
//      collected), so drift-detection here reinforces the per-field
//      documentation invariant Phase 3 is establishing.
//   3. It exercises the nested-array spread pattern matching Phase 2's
//      sentinel choice.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: CustomersResponseDto = {
  ..._validFixture,
  topCustomers: [
    {
      ..._validFixture.topCustomers[0],
      // @ts-expect-error — totalSpend must be number, not string.
      totalSpend: 'not-a-number',
    },
    ..._validFixture.topCustomers.slice(1),
  ],
};
void _invalidFixture;
