/**
 * Reporting DTO Phase 12 — Data integrity check response contract.
 *
 * Shape returned by `GET /reporting/integrity-check`. Drives
 * internal data-quality monitoring by running 7 integrity queries
 * and emitting one row per check with legacy vs post-correction
 * record counts, severity, and a human-readable note.
 *
 * Mirrors `getIntegrityCheck(tenantId)` in `reporting.service.ts`
 * (lines 611–702). The method runs 7 independent SQL queries
 * (balance_mismatch, duplicate_dump_tickets, paid_without_payment,
 * orphaned_payments, jobs_without_invoice,
 * dump_tickets_without_job_cost, invoices_without_chain), filters
 * each against `CORRECTION_CUTOFF` to partition into legacy vs
 * post-correction counts, assembles 7 check rows, sorts by
 * severity (critical → warning → info) then alphabetically, and
 * computes summary counts across the severity taxonomy.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getIntegrityCheck` changes, this DTO must change with it.
 * TypeScript enforces via the explicit
 * `Promise<IntegrityCheckResponseDto>` return type.
 *
 * ─── Structural notes ───
 *
 * 1. POINT-IN-TIME endpoint, no `PeriodDto`. No date-window params
 *    on the handler. Every request regenerates the full check set
 *    from the current state of the 7 integrity queries.
 *
 * 2. FIRST mixed-case wire format in the reporting module.
 *    Top-level envelope fields use camelCase (`timestamp`,
 *    `correctionCutoff`). `checks[]` row has two snake_case count
 *    fields (`legacy_count`, `post_correction_count`) alongside
 *    single-word convention-free fields (`name`, `description`,
 *    `severity`, `note`). Phase 10 (lifecycle) was uniform
 *    snake_case; pre-Phase-10 was uniform camelCase. Phase 12 is
 *    the first endpoint where the two conventions coexist in the
 *    same envelope. Per standing rule #3 (Backend truth): DTO
 *    mirrors service reality — snake_case count fields preserved
 *    as-is, not normalized.
 *
 * 3. FIRST cross-DTO closed-union re-documentation.
 *    `checks[].severity` has the SAME 3-literal value space
 *    (`'critical' | 'warning' | 'info'`) as
 *    `ReportingAlertRowDto.severity` (Phase 11, `c5de40b`). Each
 *    DTO declares its own local literal union — there is no
 *    shared `ReportingSeverity` type. JSDoc cross-references the
 *    Phase 11 precedent without creating code coupling. Future
 *    endpoints with divergent severity taxonomies can diverge
 *    without cross-DTO refactor friction.
 *
 * 4. DETERMINISTIC 7-row `checks[]` cardinality. The method
 *    always returns exactly one row per integrity check (currently
 *    7), even when `legacy_count === 0` and
 *    `post_correction_count === 0`. Unlike zero-state
 *    short-circuits elsewhere in the module (Phase 10 lifecycle
 *    empty-envelope path), every check row is always present.
 *    Consumers can rely on fixed cardinality for chart rendering.
 *
 * 5. PHASE 11 DEBT PAYBACK. This commit narrows the service's
 *    local `checks` array annotation (reporting.service.ts:612)
 *    to `IntegrityCheckRowDto[]`, which makes THREE prior inline
 *    casts redundant and removes them in the same commit:
 *      - reporting.service.ts:690 — two
 *        `as keyof typeof severityOrder` casts in the sort
 *        comparator (pre-existing upstream debt).
 *      - reporting.service.ts:768 — Phase 11's
 *        `as 'critical' | 'warning' | 'info'` cast in `getAlerts`
 *        (debt explicitly tracked by Phase 11 for Phase 12
 *        payback).
 *    All three casts disappear because `check.severity` / `a.severity` /
 *    `b.severity` are now the narrowed literal union rather than
 *    `string`. Debt payback lives in the same commit that
 *    creates the narrowing to preserve causal-chain clarity.
 *
 * ─── Consumer context (audit-verified) ───
 *
 * No frontend consumer fetches this endpoint. Backend callers:
 *   - `getAlerts` (reporting.service.ts:758) — loops
 *     `integrity.checks[*]`; Phase 11's cast is removed here.
 *   - `getDailySummary` (reporting.service.ts:881) — reads
 *     `integrity.summary` only; shape-neutral to severity
 *     narrowing.
 *   - Handler (reporting.controller.ts:165) — pass-through.
 * The admin guide page references this endpoint in prose only
 * (documentation literal in a `<code>` block, not an API call).
 */

import { ApiProperty } from '@nestjs/swagger';

export class IntegrityCheckRowDto {
  /**
   * Identifier of the integrity check.
   *
   * Open string, extensible by adding integrity checks to
   * `getIntegrityCheck` in reporting.service.ts. Known values
   * (non-exhaustive, current cardinality 7):
   *   - `balance_mismatch`
   *   - `duplicate_dump_tickets`
   *   - `paid_without_payment`
   *   - `orphaned_payments`
   *   - `jobs_without_invoice`
   *   - `dump_tickets_without_job_cost`
   *   - `invoices_without_chain`
   *
   * Consistent with `ReportingAlertRowDto.type` (Phase 11,
   * `c5de40b`) — new integrity checks are expected and do NOT
   * require a DTO change. Consumers should treat this field as
   * an opaque identifier, not a closed set.
   */
  @ApiProperty({
    type: 'string',
    description:
      'Integrity check identifier (open extensible string). Known values documented in JSDoc.',
  })
  name: string;

  /**
   * Human-readable per-check description. Editorial string tied
   * to the check's identity — each integrity check has a static
   * description authored at push time.
   */
  @ApiProperty({
    description:
      'Per-check editorial description. Static string authored at push time.',
  })
  description: string;

  /**
   * Count of legacy records (created before `CORRECTION_CUTOFF`)
   * matching this integrity check's query. Snake_case wire name
   * preserved from service emission (first mixed-case DTO in the
   * module — see file-level JSDoc structural note 2).
   *
   * Legacy = rows with `created_at < CORRECTION_CUTOFF`
   * (`CORRECTION_CUTOFF = '2026-04-02T00:00:00Z'`).
   */
  @ApiProperty({
    type: 'number',
    description:
      'Count of legacy records (created_at < CORRECTION_CUTOFF). Snake_case wire field preserved.',
  })
  legacy_count: number;

  /**
   * Count of post-correction records (created on or after
   * `CORRECTION_CUTOFF`) matching this integrity check's query.
   * Snake_case wire name preserved from service emission.
   *
   * Post-correction = rows with `created_at >= CORRECTION_CUTOFF`.
   * These are actionable: post-correction records are not tolerable
   * under the current data pipeline; non-zero counts drive alerts
   * (see `ReportingAlertRowDto` Phase 11).
   */
  @ApiProperty({
    type: 'number',
    description:
      'Count of post-correction records (created_at >= CORRECTION_CUTOFF). Snake_case wire field preserved.',
  })
  post_correction_count: number;

  /**
   * Severity classification of this integrity check's result.
   *
   * Closed-by-code value space — all writes produce one of the
   * three enumerated literals. Values are determined by 7 ternary
   * expressions inside `getIntegrityCheck` (reporting.service.ts
   * lines 623, 633, 644, 654, 665, 676, 686). A new value requires
   * a coordinated code change including this DTO; the TypeScript
   * literal union intentionally produces a compile-time break if
   * the service emits a new literal without corresponding DTO
   * update.
   *
   * Cross-reference: same 3-literal value space as
   * `ReportingAlertRowDto.severity` (Phase 11, `c5de40b`). Each
   * DTO declares its own local literal union; there is no shared
   * `ReportingSeverity` type. This is deliberate — DTOs remain
   * self-contained wire contracts, and future endpoints may
   * diverge (e.g., introduce a 4th severity) without refactoring
   * code-level coupling. Shared semantics documented by
   * cross-reference; not enforced by shared type.
   */
  @ApiProperty({
    enum: ['critical', 'warning', 'info'],
    description:
      "Severity classification. Closed-by-code: 'critical' | 'warning' | 'info'. Cross-references ReportingAlertRowDto.severity (Phase 11).",
  })
  severity: 'critical' | 'warning' | 'info';

  /**
   * Human-readable dynamic note. Built per-request from ternary
   * expressions on the legacy and post-correction counts — e.g.,
   * `"${N} post-correction mismatches need investigation"` or
   * `'All clean'`. Open string, different on every request.
   */
  @ApiProperty({
    description:
      'Per-request human-readable note. Dynamic string composed from counts.',
  })
  note: string;
}

export class IntegrityCheckSummaryDto {
  /** Count of `checks[]` rows with `severity === 'critical'`. */
  @ApiProperty({
    description: "Count of checks with severity === 'critical'.",
  })
  critical: number;

  /** Count of `checks[]` rows with `severity === 'warning'`. */
  @ApiProperty({
    description: "Count of checks with severity === 'warning'.",
  })
  warning: number;

  /** Count of `checks[]` rows with `severity === 'info'`. */
  @ApiProperty({
    description: "Count of checks with severity === 'info'.",
  })
  info: number;
}

export class IntegrityCheckResponseDto {
  /**
   * ISO timestamp of integrity check synthesis — server-side now
   * when the request was handled. Distinct from `correctionCutoff`
   * below: this field is request-time, that field is a constant.
   */
  @ApiProperty({
    description:
      'ISO timestamp of integrity check synthesis (server-side now).',
  })
  timestamp: string;

  /**
   * ISO constant `CORRECTION_CUTOFF = '2026-04-02T00:00:00Z'`.
   * The cutoff that partitions `legacy_count` from
   * `post_correction_count` on every row. Emitted on every
   * response so consumers can display the cutoff date without
   * hardcoding it client-side.
   */
  @ApiProperty({
    description:
      'ISO constant CORRECTION_CUTOFF. Partition boundary between legacy and post-correction records.',
  })
  correctionCutoff: string;

  /**
   * Integrity check rows — deterministic 7-row cardinality (see
   * file-level structural note 4). Sorted critical → warning →
   * info, then alphabetical by name.
   */
  @ApiProperty({
    type: [IntegrityCheckRowDto],
    description:
      'Integrity check rows. Deterministic 7-row cardinality. Sorted by severity then name.',
  })
  checks: IntegrityCheckRowDto[];

  /**
   * Severity-rollup summary across the 7 check rows. Counts sum
   * to 7 always (every row contributes to exactly one bucket).
   * Read by `getDailySummary` as the `alerts` field of its own
   * return.
   */
  @ApiProperty({
    type: IntegrityCheckSummaryDto,
    description:
      'Severity-rollup summary across checks[]. Counts sum to 7 (deterministic cardinality).',
  })
  summary: IntegrityCheckSummaryDto;
}
