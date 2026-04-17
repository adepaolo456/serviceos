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
   * Revenue **collected** (payments applied) in the window.
   *
   * ⚠ Semantic collision flagged in Phase 0 Risk #1:
   * `GET /reporting/profit.totalRevenue` === `getRevenue(...).totalCollected`.
   * This is NOT the same value as `GET /reporting/revenue.totalRevenue`
   * (which represents invoiced revenue from `SUM(invoices.total)`).
   * Do NOT cross-wire the two values in downstream code — they diverge
   * whenever invoices are issued without matching completed payments
   * in the same window.
   */
  @ApiProperty({
    description:
      'Revenue collected (payments applied). Sourced from getRevenue(...).totalCollected — NOT .totalRevenue.',
  })
  totalRevenue: number;

  /** From `getDumpCosts(...).totalDumpCosts`. Plain currency. */
  @ApiProperty({
    description: 'From getDumpCosts(...).totalDumpCosts. Plain currency.',
  })
  totalDumpCosts: number;

  /** `totalRevenue − totalDumpCosts`, computed in-memory (never stored). */
  @ApiProperty({
    description: 'totalRevenue − totalDumpCosts, computed in-memory.',
  })
  grossProfit: number;

  /**
   * Gross margin percentage in the **0–100 range** (not 0–1).
   * Formula: `(grossProfit / totalRevenue) * 100`, or `0` when `totalRevenue === 0`.
   *
   * Module-wide convention: all `*Percent`-suffixed fields across the reporting
   * module use the 0–100 range (per Phase 0 Risk #3).
   */
  @ApiProperty({
    description:
      'Gross margin percentage in 0–100 range (module convention). 0 when totalRevenue is 0.',
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
