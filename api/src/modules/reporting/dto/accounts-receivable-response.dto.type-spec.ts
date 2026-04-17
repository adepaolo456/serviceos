/**
 * Type-only sanity check for `AccountsReceivableResponseDto`.
 *
 * No Jest, no runtime assertions — the load-bearing check is
 * `tsc --noEmit`. This file exists to:
 *   1. Prove a representative runtime-shape fixture compiles against
 *      the DTO (positive case).
 *   2. Prove the DTO rejects shape drift via `@ts-expect-error`
 *      (negative case — if the DTO ever stops catching the drift, the
 *      directive itself fails to compile and tsc errors out with
 *      TS2578).
 *
 * Phase 7 note: point-in-time endpoint (no `PeriodDto`). Shape is
 * 2 levels deep — scalars + `aging` fixed-key container +
 * `overdueInvoices` array. Sentinel placed on `overdueInvoices[].amount`
 * (deepest array-leaf currency field) to exercise the array-of-sub-DTO
 * spread pattern consistent with Phase 3/4a-c/5/6 sentinel placements
 * — rationale documented in Phase 7 Section C.
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a-c / Phase 5 / Phase 6 template: Jest globs `.spec.ts`
 * only, so this file is picked up by `tsc` but NOT by `jest`.
 */

import type { AccountsReceivableResponseDto } from './accounts-receivable-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
//
// AR-realistic distribution: current bucket holds the majority of
// balance (healthy book); tails shrink as aging increases. Three
// overdue rows exercise a range of daysPastDue values.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: AccountsReceivableResponseDto = {
  totalOutstanding: 84250.75,
  totalOverdue: 12840.25,
  aging: {
    current: { count: 58, amount: 71410.5 },
    days30: { count: 12, amount: 7200 },
    days60: { count: 5, amount: 3150.25 },
    days90: { count: 2, amount: 1490 },
    days90plus: { count: 1, amount: 1000 },
  },
  overdueInvoices: [
    {
      invoiceId: 'inv-uuid-1',
      invoiceNumber: 1042,
      customerName: 'Jane Doe',
      amount: 420.5,
      dueDate: '2026-03-15',
      daysPastDue: 33,
    },
    {
      invoiceId: 'inv-uuid-2',
      invoiceNumber: 1058,
      customerName: 'Acme Construction LLC',
      amount: 2800,
      dueDate: '2026-02-10',
      daysPastDue: 66,
    },
    {
      invoiceId: 'inv-uuid-3',
      invoiceNumber: 1071,
      customerName: 'Unknown',
      amount: 1000,
      dueDate: '2025-12-20',
      daysPastDue: 118,
    },
  ],
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `overdueInvoices[].amount` is picked as the sentinel because:
//   1. It is the DEEPEST leaf with business significance — a currency
//      field in an array element. Type drift at an array leaf is the
//      hardest defect to catch without a leaf-level sentinel; any
//      higher-level sentinel passes through even when leaves drift.
//   2. Array elements lose structural typing guarantees when spread;
//      sentinel reinforces the per-row contract.
//   3. Exercises the nested-array-spread pattern consistent with
//      Phase 3 `topCustomers[].totalSpend`, Phase 4a-c
//      `invoices[].total`, Phase 5 `totalRevenue`, and Phase 6
//      `driverStats[].totalJobs` — though this is the first phase
//      where a fixed-key sibling container (`aging`) was also an
//      option and was explicitly rejected.
//   4. `aging.*` alternatives (e.g. `aging.current.amount`) exercise
//      fixed-key traversal but not array-spread type preservation;
//      this is a shallower invariant to protect.
//   5. Top-level `totalOutstanding` / `totalOverdue` alternatives
//      carry the Risk #1-adjacent semantic (cross-reference to
//      Phase 5), but structurally they're flat scalars — weaker
//      test of nested typing than a leaf array field.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: AccountsReceivableResponseDto = {
  ..._validFixture,
  overdueInvoices: [
    {
      ..._validFixture.overdueInvoices[0],
      // @ts-expect-error — amount must be number, not string.
      amount: 'not-a-number',
    },
    ..._validFixture.overdueInvoices.slice(1),
  ],
};
void _invalidFixture;
