/**
 * Type-only sanity check for `IntegrityCheckResponseDto`.
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
 * Phase 12 note: FIRST cross-DTO closed-union re-documentation.
 * Sentinel placed on `checks[].severity` drifted to an
 * out-of-union literal to exercise the new pattern at its point
 * of entry — first time a closed 3-literal union declared in
 * Phase 11 is re-declared verbatim in a second DTO without shared
 * type extraction. Sentinel rationale documented in Phase 12
 * Section C.
 *
 * ─── Row-scenario rubric for positive fixture (Step 3) ───
 * Row 1 — critical post-correction: entityType-analog
 *   balance_mismatch; legacy 12 + post 3; severity 'critical'.
 * Row 2 — warning legacy-only: duplicate_dump_tickets; legacy 4 +
 *   post 0; severity 'warning'.
 * Row 3 — info baseline: invoices_without_chain; legacy 0 + post
 *   0; severity 'info'.
 *
 * Together the three rows exercise every severity literal exactly
 * once, matching the summary rollup ({ critical: 1, warning: 1,
 * info: 1 }).
 */

import type { IntegrityCheckResponseDto } from './integrity-check-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: IntegrityCheckResponseDto = {
  timestamp: '2026-04-17T14:30:00.000Z',
  correctionCutoff: '2026-04-02T00:00:00Z',
  checks: [
    {
      name: 'balance_mismatch',
      description: 'Invoices where balance_due != total - amount_paid',
      legacy_count: 12,
      post_correction_count: 3,
      severity: 'critical',
      note: '3 post-correction mismatches need investigation',
    },
    {
      name: 'duplicate_dump_tickets',
      description: 'Dump tickets with same job_id + ticket_number',
      legacy_count: 4,
      post_correction_count: 0,
      severity: 'warning',
      note: '4 legacy records',
    },
    {
      name: 'invoices_without_chain',
      description: 'Job-linked invoices not linked to a rental chain',
      legacy_count: 0,
      post_correction_count: 0,
      severity: 'info',
      note: 'All clean',
    },
  ],
  summary: {
    critical: 1,
    warning: 1,
    info: 1,
  },
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `checks[].severity` is picked as the sentinel because:
//   1. Phase 12's primary new invariant is the FIRST cross-DTO
//      closed-union re-documentation — severity's 3-literal value
//      space declared locally in this DTO, cross-referenced to
//      Phase 11's `ReportingAlertRowDto.severity` without shared
//      type extraction. Sentinel exercises the pattern at its
//      point of entry.
//   2. Consistent with Phase 11's sentinel choice (closed-union
//      field): future observers seeing both phases' sentinels on
//      severity fields will recognize the pattern alignment.
//   3. Alternatives considered and rejected:
//      - `summary.critical` scalar drift: exercises type-level
//        drift but NOT the new cross-DTO closed-union pattern.
//      - `checks[].legacy_count` drifted to string: tests snake_case
//        numeric field but also NOT the new cross-DTO pattern.
//      - `checks[].name` drifted to disallowed literal: `name` is
//        open extensible string (per Phase 11 precedent) — no
//        closed-set invariant to test.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: IntegrityCheckResponseDto = {
  ..._validFixture,
  checks: [
    {
      ..._validFixture.checks[0],
      // @ts-expect-error — severity must be one of the 3 closed-union literals.
      severity: 'error',
    },
    ..._validFixture.checks.slice(1),
  ],
};
void _invalidFixture;
