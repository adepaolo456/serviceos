/**
 * Type-only sanity check for `RevenueDailyDetailResponseDto`.
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
 * Phase 4b note: this is the SECOND consumer of the shared
 * `RevenueDetailInvoiceDto` (extracted in Phase 4-extract `ce0b7e7`,
 * first validated by Phase 4a `19414b5`). The positive fixture uses
 * runtime-accurate types — `createdAt` as `Date` (pg driver returns
 * TIMESTAMP as Date), `invoiceNumber` as `number` (INT4),
 * `jobId`/`jobNumber` nullable (LEFT JOIN may miss). If this fixture
 * fails to compile, it indicates drift in `revenue-detail-invoice.dto.ts`
 * — NOT a fixture bug.
 *
 * The `.type-spec.ts` suffix matches Phase 1 v2 / Phase 2 / Phase 3 /
 * Phase 4a template: Jest globs `.spec.ts` only, so this file is
 * picked up by `tsc` but NOT by `jest`.
 */

import type { RevenueDailyDetailResponseDto } from './revenue-daily-detail-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
//
// Two invoice rows; the second has jobId/jobNumber = null to exercise
// the `string | null` contract on the LEFT JOIN columns.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: RevenueDailyDetailResponseDto = {
  date: '2026-02-14',
  invoices: [
    {
      id: 'inv-uuid-1',
      invoiceNumber: 1042,
      customerName: 'Jane Doe',
      total: 420.5,
      amountPaid: 420.5,
      balanceDue: 0,
      status: 'paid',
      createdAt: new Date('2026-02-14T10:30:00Z'),
      jobId: 'job-uuid-1',
      jobNumber: 'J-2026-0142',
    },
    {
      id: 'inv-uuid-2',
      invoiceNumber: 1043,
      customerName: 'Unknown Customer',
      total: 180,
      amountPaid: 0,
      balanceDue: 180,
      status: 'open',
      createdAt: new Date('2026-02-14T16:45:00Z'),
      jobId: null,
      jobNumber: null,
    },
  ],
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `invoices[].total` is picked as the sentinel because:
//   1. It is the most structurally-load-bearing numeric field on the
//      row — drift from `number` to `string` would silently break
//      every downstream currency render.
//   2. It exercises the nested-array spread pattern matching Phase 3's
//      `topCustomers[].totalSpend` and Phase 4a's `invoices[].total`
//      sentinel choices.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: RevenueDailyDetailResponseDto = {
  ..._validFixture,
  invoices: [
    {
      ..._validFixture.invoices[0],
      // @ts-expect-error — total must be number, not string.
      total: 'not-a-number',
    },
    ..._validFixture.invoices.slice(1),
  ],
};
void _invalidFixture;
