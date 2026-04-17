/**
 * Shared period-bounds sub-DTO for reporting endpoints.
 *
 * Returned alongside aggregate KPIs to document the window the query
 * was evaluated over. Per Phase 0 scoping audit, this sub-shape appears
 * in 8 of 18 reporting endpoints — extracted here so Phases 1/3/5/6/7/8/10
 * can reuse a single type instead of each endpoint redeclaring
 * `{ start: string; end: string }`.
 *
 * Values are sourced from `dateRange(startDate, endDate)` in
 * `reporting.service.ts` — both fields are date-only strings in
 * `YYYY-MM-DD` form (NOT full ISO timestamps).
 *
 * Standing rule: if the reporting service's `dateRange` helper ever
 * starts returning something other than a date-only string, this type
 * must change with it. TypeScript will enforce that for every consumer
 * endpoint that annotates its return as `PeriodDto`.
 */

import { ApiProperty } from '@nestjs/swagger';

export class PeriodDto {
  /** Window start, `YYYY-MM-DD`, inclusive. */
  @ApiProperty({ description: 'Window start, YYYY-MM-DD, inclusive.' })
  start: string;

  /** Window end, `YYYY-MM-DD`, inclusive. */
  @ApiProperty({ description: 'Window end, YYYY-MM-DD, inclusive.' })
  end: string;
}
