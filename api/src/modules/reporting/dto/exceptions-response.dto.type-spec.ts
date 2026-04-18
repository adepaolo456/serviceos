/**
 * Type-only sanity check for `ExceptionsResponseDto`.
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
 * Phase 14 note: sentinel placed on `inconsistencies[].total` — the
 * pg decimal type-drift surface. Drift to `string` exercises the
 * type invariant most novel to this phase: DTO declares `number`
 * per module convention even though the runtime wire representation
 * may be string (pg driver default for DECIMAL columns).
 *
 * Alternative sentinel (`actionRequired.overdueInvoices` drifted)
 * was rejected — counts are module-typical and not novel to Phase 14.
 * The pg-decimal field is the unique structural invariant.
 */

import type { ExceptionsResponseDto } from './exceptions-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: ExceptionsResponseDto = {
  critical: {
    inconsistencies: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        invoice_number: 1042,
        total: 500.0,
        line_total: 487.5,
      },
    ],
  },
  actionRequired: {
    needsReschedule: 3,
    overdueInvoices: 12,
    overdueRentals: 2,
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `inconsistencies[].total` is picked as the sentinel because:
//   1. Phase 14's most novel structural invariant is the pg decimal
//      type-drift surface — DTO declares `number` while runtime may
//      be `string`. Sentinel exercises that the TYPE CONTRACT remains
//      `number` even if runtime drifts.
//   2. Drift from `number` → `string` would be the exact wire-type
//      misalignment that downstream `formatCurrency()` consumers
//      would silently fail on.
//   3. Alternatives considered and rejected:
//      - actionRequired.overdueInvoices drifted: counts are
//        module-typical; not novel to Phase 14.
//      - inconsistencies[].invoice_number drifted: snake_case
//        passthrough is Phase 12 precedent; not novel to Phase 14.
//      - critical.inconsistencies drifted to non-array: closed-key
//        invariant on a sub-DTO; well-defended in prior phases.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: ExceptionsResponseDto = {
  ..._validFixture,
  critical: {
    inconsistencies: [
      {
        ..._validFixture.critical.inconsistencies[0],
        // @ts-expect-error — total must be number, not string.
        total: 'not-a-number',
      },
    ],
  },
};
void _invalidFixture;
