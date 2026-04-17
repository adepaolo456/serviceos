/**
 * Reporting DTO Phase 11 — Admin alerts feed response contract.
 *
 * Shape returned by `GET /reporting/alerts`. Drives the notification
 * bell in the dashboard header (`web/src/components/notification-bell.tsx`)
 * with a live-derived feed of admin-visible alerts.
 *
 * Mirrors `getAlerts(tenantId)` in `reporting.service.ts` (lines
 * 756–831). The method synthesizes the alert feed in-memory from
 * two sources:
 *   1. `getIntegrityCheck(tenantId)` — loops over 7 integrity checks
 *      and emits up to two alerts per check (post-correction +
 *      legacy variants) when counts are nonzero.
 *   2. A direct overdue-invoice query — emits one warning alert
 *      when ≥ 1 invoice is past 30 days overdue.
 *
 * Standing rule (Phase 0): if the return literal in `getAlerts`
 * changes, this DTO must change with it. TypeScript enforces via
 * the explicit `Promise<ReportingAlertsResponseDto>` return type.
 *
 * ─── Structural notes ───
 *
 * 1. POINT-IN-TIME endpoint, no `PeriodDto`. No date-window params
 *    on the handler. Every request regenerates the full alert set
 *    from the current state of integrity checks + overdue invoices.
 *
 * 2. STATELESS FEED. No persistence — every request synthesizes
 *    fresh. Consequently, `alerts[].read` is emitted as `false` on
 *    every row; read-state tracking is entirely client-side (see
 *    `notification-bell.tsx`'s `readIds` Set).
 *
 * 3. FIRST closed-by-code TypeScript literal unions in the module.
 *    Three fields model closed value spaces as literal unions:
 *    `entityType` (5 literals), `severity` (3 literals),
 *    `classification` (2 literals). All value spaces are controlled
 *    entirely by backend code — no DB enum, no tenant config. A
 *    new value requires a coordinated code change including this
 *    DTO; the literal unions intentionally produce a compile-time
 *    break if the service emits a new value without corresponding
 *    DTO update. This establishes the standing pattern for Phase
 *    12+: when a value space is fully backend-code-controlled,
 *    model it as a TypeScript literal union.
 *
 * 4. ONE open extensible string. `alerts[].type` is deliberately
 *    NOT a closed union — it carries integrity-check names + the
 *    `'overdue_invoice'` literal, and new integrity checks are
 *    expected to be added to `getIntegrityCheck` without DTO
 *    coupling. Consumers should treat this field as an opaque
 *    identifier, not a closed set.
 *
 * 5. TWO INDEPENDENT "alert" subsystems in the codebase. This DTO
 *    covers `GET /reporting/alerts` (derived live-data synthesis).
 *    A separate `/alerts` + `/alerts/summary` endpoint pair (Phase
 *    14 persisted-alerts subsystem at `api/src/modules/alerts/`)
 *    has its own module DTO and unrelated entity-type taxonomy
 *    (`'job' | 'rental_chain' | 'asset' | 'invoice' | 'customer'`).
 *    The two subsystems share only the word "alert." No
 *    cross-reference between them.
 */

import { ApiProperty } from '@nestjs/swagger';

export class ReportingAlertRowDto {
  /**
   * Alert row identifier — a deterministic synthetic ID composed of
   * `type:classification:date` (or `type:date` for overdue-invoice).
   * Stable within a single day; regenerated every request. Client
   * uses this as the key for read-state tracking.
   */
  @ApiProperty({
    description:
      'Synthetic alert ID (type:classification:date). Stable within a single day; stateless across requests.',
  })
  id: string;

  /**
   * Alert type identifier.
   *
   * Open string, extensible by adding integrity checks to
   * `getIntegrityCheck` in `reporting.service.ts`. Known values
   * (non-exhaustive):
   *   - `balance_mismatch`
   *   - `duplicate_dump_tickets`
   *   - `paid_without_payment`
   *   - `orphaned_payments`
   *   - `jobs_without_invoice`
   *   - `dump_tickets_without_job_cost`
   *   - `invoices_without_chain`
   *   - `overdue_invoice`
   *
   * Unlike the closed-union fields on this row (`severity`,
   * `classification`, `entityType`), new `type` values are expected
   * and do NOT require a DTO change. Consumers reading this field
   * should treat it as an opaque identifier, not a closed set.
   */
  @ApiProperty({
    description:
      "Alert type identifier (integrity-check name or 'overdue_invoice'). Open string — extensible by future integrity checks. Known values documented in JSDoc.",
  })
  type: string;

  /**
   * Alert severity.
   *
   * Closed-by-code value space — all writes produce one of the
   * enumerated literals. Values are determined in
   * `reporting.service.ts`:
   *   - Integrity-check severities (lines 622–685) emit
   *     `'critical' | 'warning' | 'info'` via ternary expressions
   *     on post-correction counts.
   *   - `getAlerts` row 1 (line 771) inherits `check.severity`.
   *   - `getAlerts` row 2 (line 785) hardcodes `'info'` for the
   *     legacy variant.
   *   - `getAlerts` row 3 (line 809) hardcodes `'warning'` for the
   *     overdue-invoice alert.
   *
   * A new severity value requires a coordinated code change
   * including this DTO. The TypeScript literal union intentionally
   * produces a compile-time break if the service emits an unlisted
   * value.
   */
  @ApiProperty({
    enum: ['critical', 'warning', 'info'],
    description:
      "Alert severity. Closed-by-code value space: 'critical' | 'warning' | 'info'.",
  })
  severity: 'critical' | 'warning' | 'info';

  /**
   * Alert classification — distinguishes alerts triggered by the
   * post-correction data set (actionable, post-2026-04-02) from
   * alerts about legacy pre-correction records (informational).
   *
   * Closed-by-code value space. Values are determined in
   * `reporting.service.ts`:
   *   - Line 772: `'post-correction'` (integrity-check
   *     post_correction_count > 0 branch).
   *   - Line 786: `'legacy'` (integrity-check legacy_count > 0
   *     branch).
   *   - Line 810: `'post-correction'` (overdue-invoice alert).
   *
   * A new classification value requires a coordinated code change
   * including this DTO.
   */
  @ApiProperty({
    enum: ['post-correction', 'legacy'],
    description:
      "Alert classification. Closed-by-code value space: 'post-correction' | 'legacy'.",
  })
  classification: 'post-correction' | 'legacy';

  /** Human-readable alert title for UI headline. */
  @ApiProperty({ description: 'Human-readable alert title.' })
  title: string;

  /**
   * Human-readable alert body. Includes formatted counts and dollar
   * amounts for context (e.g., "3 invoices overdue totaling $1,240.50").
   */
  @ApiProperty({
    description: 'Human-readable alert body with counts/amounts.',
  })
  message: string;

  /**
   * Entity taxonomy for routing + UI grouping.
   *
   * Closed-by-code value space. Values are produced by the
   * `alertEntityType(name)` helper (`reporting.service.ts:846–852`)
   * via substring matching on the check name, plus one hardcoded
   * literal for the overdue-invoice alert:
   *   - `'invoice'` — when check name contains `invoice` / `balance` /
   *     `paid`, plus hardcoded for overdue-invoice alert (line 813).
   *   - `'dump_ticket'` — when check name contains `dump` / `ticket`.
   *   - `'job'` — when check name contains `job`.
   *   - `'payment'` — when check name contains `payment`.
   *   - `'system'` — fallback for anything else.
   *
   * Observed write sites: `reporting.service.ts:775`, `:789`, `:813`.
   *
   * A new entityType value requires a coordinated code change
   * including this DTO and the `alertEntityType` helper.
   */
  @ApiProperty({
    enum: ['invoice', 'dump_ticket', 'job', 'payment', 'system'],
    description:
      "Alert entity taxonomy. Closed-by-code: 'invoice' | 'dump_ticket' | 'job' | 'payment' | 'system'.",
  })
  entityType: 'invoice' | 'dump_ticket' | 'job' | 'payment' | 'system';

  /**
   * Deep-link path into the canonical UI page for this alert's
   * subject. Produced by the `alertHref(name)` helper
   * (`reporting.service.ts:854–860`). Relative path (e.g.,
   * `/invoices`, `/jobs`, `/analytics`). Not a full URL.
   */
  @ApiProperty({
    description:
      'Deep-link path (relative) into the canonical UI page for this alert subject.',
  })
  href: string;

  /**
   * Alert timestamp — ISO string, equal to the envelope
   * `generatedAt` on every row (stateless feed; all alerts in a
   * response carry the same synthesis timestamp).
   */
  @ApiProperty({
    description:
      'ISO timestamp of alert synthesis. Equals envelope generatedAt on every row (stateless feed).',
  })
  createdAt: string;

  /**
   * Read-state flag. Always emitted as `false` by the server — the
   * alert feed is stateless and every request regenerates the full
   * set. Read-state is tracked client-side (see
   * `web/src/components/notification-bell.tsx` `readIds` Set).
   *
   * Typed as `boolean` rather than `false` literal to preserve the
   * wire contract's flexibility if server-side read persistence is
   * ever introduced without breaking existing consumers.
   */
  @ApiProperty({
    description:
      'Read-state flag. Always false from server (stateless feed); read-state is client-managed.',
  })
  read: boolean;
}

export class ReportingAlertsResponseDto {
  /** ISO timestamp of alert synthesis — i.e., the server's now when the request was handled. */
  @ApiProperty({
    description:
      'ISO timestamp of alert synthesis (server-side now at request handle time).',
  })
  generatedAt: string;

  /**
   * Count of alerts with severity NOT equal to `'info'` — i.e.,
   * the count of alerts that should surface an unread badge on the
   * notification bell. Filter applied in
   * `reporting.service.ts:824`: `alerts.filter(a => a.severity !== 'info').length`.
   */
  @ApiProperty({
    description:
      "Count of non-info alerts (alerts.filter(a => a.severity !== 'info').length).",
  })
  unreadCount: number;

  /**
   * Alert rows, sorted by severity — `critical` → `warning` → `info`
   * (service-side sort at line 822). No per-endpoint row cap; the
   * full synthesized set is returned.
   */
  @ApiProperty({
    type: [ReportingAlertRowDto],
    description:
      'Alert rows ordered by severity (critical → warning → info). No server-side cap.',
  })
  alerts: ReportingAlertRowDto[];
}
