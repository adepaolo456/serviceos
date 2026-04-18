/**
 * Reporting DTO Phase 1 — Profit report response contract.
 *
 * Shape returned by `GET /reporting/profit`. Consumed by the Profit
 * tab on `web/src/app/(dashboard)/analytics/page.tsx` (verified clean
 * in Phase 2c Follow-Up #4.5 Site #4).
 *
 * Mirrors `getProfit(tenantId, startDate?, endDate?)` in
 * `reporting.service.ts`. The method composes `getRevenue(...)` +
 * `getDumpCosts(...)` and the returned values are sourced from those
 * sub-aggregates — see per-field JSDocs for exact upstream origin.
 *
 * Standing rule (Phase 0): if the return literal in `getProfit` changes,
 * this DTO must change with it. TypeScript enforces it via the method's
 * explicit `Promise<ProfitResponseDto>` return type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`).
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class ProfitResponseDto {
  /**
   * Semantic: COLLECTED
   * Source: getRevenue(...).totalCollected (pass-through)
   * Scope: Revenue-status payments; windowed by applied_at (inherited from Phase 5 getRevenue)
   *
   * Revenue **collected** (payments applied) in the window.
   * Sourced from `getRevenue(...).totalCollected` (pass-through).
   *
   * Naming note: this field was renamed from `totalRevenue` to
   * `totalCollected` to align the wire name with the actual
   * semantic (payments-applied, not invoiced). The wire name now
   * matches `RevenueResponseDto.totalCollected` (Phase 5) — both
   * represent the same collected-revenue semantic at the window
   * level.
   *
   * Distinct from `RevenueResponseDto.totalRevenue` (Phase 5),
   * which represents INVOICED revenue (`SUM(invoices.total)`).
   * Collected and invoiced diverge whenever invoices are issued
   * without matching completed payments in the same window.
   */
  @ApiProperty({
    description:
      'Revenue collected (payments applied). Sourced from getRevenue(...).totalCollected.',
  })
  totalCollected: number;

  /** From `getDumpCosts(...).totalDumpCosts`. Plain currency. */
  @ApiProperty({
    description: 'From getDumpCosts(...).totalDumpCosts. Plain currency.',
  })
  totalDumpCosts: number;

  /** `totalCollected − totalDumpCosts`, computed in-memory (never stored). */
  @ApiProperty({
    description: 'totalCollected − totalDumpCosts, computed in-memory.',
  })
  grossProfit: number;

  /**
   * Gross margin percentage in the **0–100 range** (not 0–1).
   * Formula: `(grossProfit / totalCollected) * 100`, or `0` when `totalCollected === 0`.
   *
   * Module-wide convention: all `*Percent`-suffixed fields across the reporting
   * module use the 0–100 range (per Phase 0 Risk #3).
   */
  @ApiProperty({
    description:
      'Gross margin percentage in 0–100 range (module convention). 0 when totalCollected is 0.',
  })
  grossMarginPercent: number;

  /** Window bounds — shared sub-DTO reused across 8 reporting endpoints. */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds — shared sub-DTO reused across 8 reporting endpoints.',
  })
  period: PeriodDto;
}
