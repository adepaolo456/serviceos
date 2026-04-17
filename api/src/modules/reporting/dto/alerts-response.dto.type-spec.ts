/**
 * Type-only sanity check for `ReportingAlertsResponseDto`.
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
 * Phase 11 note: first closed-by-code TypeScript literal unions in
 * the module (`entityType`, `severity`, `classification`). Sentinel
 * placed on `alerts[].entityType` — drifted to a literal outside the
 * 5-value closed union — to exercise the new closed-union invariant
 * specifically. Sentinel rationale documented in Phase 11 Section C.
 *
 * ─── Row-scenario rubric for positive fixture (Step 3) ───
 * Row 1 — "invoice critical post-correction" — inherits
 *   check.severity='critical' for balance_mismatch with post
 *   count > 0.
 * Row 2 — "dump_ticket warning legacy" — integrity-check legacy
 *   variant, severity hardcoded 'info'... actually wait: the legacy
 *   branch of getAlerts always hardcodes severity 'info' (line
 *   785), so "warning legacy" can't happen from integrity checks.
 *   Adjusted below to use correct combinations per service logic.
 *
 * Corrected scenario rubric (matches service reality):
 * Row 1 — entityType='invoice', severity='critical',
 *   classification='post-correction', type='balance_mismatch'.
 * Row 2 — entityType='dump_ticket', severity='info',
 *   classification='legacy', type='duplicate_dump_tickets'.
 * Row 3 — entityType='system', severity='info',
 *   classification='legacy', type='invoices_without_chain'.
 *
 * unreadCount is 1 (only the 'critical' row counts; 'info' rows
 * are filtered out per service line 824).
 */

import type { ReportingAlertsResponseDto } from './alerts-response.dto';

// ─────────────────────────────────────────────────────────────────────
// Positive case — representative valid fixture must compile.
// ─────────────────────────────────────────────────────────────────────

const _validFixture: ReportingAlertsResponseDto = {
  generatedAt: '2026-04-17T14:30:00.000Z',
  unreadCount: 1,
  alerts: [
    // Row 1 — invoice critical post-correction (integrity check with
    // post-correction mismatches).
    {
      id: 'balance_mismatch:post:2026-04-17',
      type: 'balance_mismatch',
      severity: 'critical',
      classification: 'post-correction',
      title: 'Invoice balance mismatch',
      message:
        '3 post-correction invoices where balance_due != total - amount_paid',
      entityType: 'invoice',
      href: '/invoices',
      createdAt: '2026-04-17T14:30:00.000Z',
      read: false,
    },
    // Row 2 — dump_ticket info legacy (integrity-check legacy branch
    // always hardcodes severity 'info').
    {
      id: 'duplicate_dump_tickets:legacy:2026-04-17',
      type: 'duplicate_dump_tickets',
      severity: 'info',
      classification: 'legacy',
      title: 'Duplicate dump tickets (legacy)',
      message: '5 legacy records — informational only',
      entityType: 'dump_ticket',
      href: '/analytics',
      createdAt: '2026-04-17T14:30:00.000Z',
      read: false,
    },
    // Row 3 — system info legacy (fallback entityType path).
    {
      id: 'invoices_without_chain:legacy:2026-04-17',
      type: 'invoices_without_chain',
      severity: 'info',
      classification: 'legacy',
      title: 'Invoices without rental chain (legacy)',
      message: '12 legacy records — informational only',
      entityType: 'system',
      href: '/analytics',
      createdAt: '2026-04-17T14:30:00.000Z',
      read: false,
    },
  ],
};
void _validFixture;

// ─────────────────────────────────────────────────────────────────────
// Negative case — the DTO MUST reject this shape drift.
//
// `alerts[].entityType` is picked as the sentinel because:
//   1. Phase 11's primary contribution is the FIRST closed-by-code
//      TypeScript literal union pattern in the module. The sentinel
//      should exercise that invariant at its point of entry.
//   2. entityType's 5-value space is the broadest of the three new
//      closed unions (severity has 3, classification has 2), so
//      drift here is the most structurally novel — a union-width
//      mismatch that lower-cardinality unions don't exercise.
//   3. Entity type drift is the failure mode most likely to cause
//      downstream confusion: href routing + UI grouping both key off
//      this field.
//   4. Alternatives considered and rejected:
//      - alerts[].severity (closed union, second candidate):
//        narrower 3-value space; entityType is the phase's primary
//        new invariant.
//      - alerts[].classification (closed union, third candidate):
//        narrowest 2-value space; lower structural weight.
//      - unreadCount scalar drift: exercises type-level drift but
//        NOT the new closed-union pattern specifically.
// ─────────────────────────────────────────────────────────────────────

const _invalidFixture: ReportingAlertsResponseDto = {
  ..._validFixture,
  alerts: [
    {
      ..._validFixture.alerts[0],
      // @ts-expect-error — entityType must be one of the 5 closed-union literals.
      entityType: 'unrelated_value',
    },
    ..._validFixture.alerts.slice(1),
  ],
};
void _invalidFixture;
