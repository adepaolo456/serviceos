/**
 * Reporting DTO Phase 6 — Driver productivity report response contract.
 *
 * Shape returned by `GET /reporting/drivers`. Drives the driver
 * productivity / leaderboard view on the analytics dashboard —
 * per-driver job counts broken down by completion status and job
 * type within a date window.
 *
 * Mirrors `getDriverProductivity(tenantId, startDate?, endDate?)` in
 * `reporting.service.ts` (lines 409–446). The method runs a single
 * GROUP BY query over `jobs` LEFT JOIN'd to `users` (drivers),
 * filtered by `j.assigned_driver_id IS NOT NULL` and
 * `j.scheduled_date` in the window.
 *
 * Standing rule (Phase 0): if the return literal in
 * `getDriverProductivity` changes, this DTO must change with it.
 * TypeScript enforces this via the method's explicit
 * `Promise<DriversResponseDto>` return type.
 *
 * Shared sub-DTO: `PeriodDto` (see `./period.dto.ts`). Phase 6 is
 * the third reuse of `PeriodDto` (after Phase 3 customers and
 * Phase 5 revenue) — shared-sub-DTO pattern continues to hold.
 */

import { ApiProperty } from '@nestjs/swagger';
import { PeriodDto } from './period.dto';

export class DriverStatsRowDto {
  /**
   * Driver UUID — from `jobs.assigned_driver_id`. The service
   * filters `IS NOT NULL` in WHERE before grouping, so this field
   * is always a real driver ID (never null, never an "unassigned"
   * aggregate row).
   */
  @ApiProperty({
    description:
      'Driver UUID from jobs.assigned_driver_id. Never null — service filters IS NOT NULL in WHERE before grouping.',
  })
  driverId: string;

  /**
   * Display name — `CONCAT(users.first_name, ' ', users.last_name)`.
   * Postgres `CONCAT` treats NULL inputs as empty strings (distinct
   * from the `||` operator), so the result is always a string but
   * may be whitespace-only when both name fields are null on the
   * joined user row. Not typically the case for real drivers.
   */
  @ApiProperty({
    description:
      "Display name from CONCAT(first_name, ' ', last_name). Always a string (never null) per Postgres CONCAT NULL-as-empty semantics.",
  })
  driverName: string;

  /** Total jobs assigned to the driver in the window — `COUNT(*)`. */
  @ApiProperty({ description: 'Total jobs in the window (COUNT(*)).' })
  totalJobs: number;

  /** Completed jobs — `SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`. */
  @ApiProperty({
    description:
      "Completed jobs in the window (SUM(CASE WHEN status = 'completed')).",
  })
  completedJobs: number;

  /** Failed-trip count — `SUM(CASE WHEN is_failed_trip = true THEN 1 ELSE 0 END)`. */
  @ApiProperty({
    description:
      'Failed trips in the window (SUM(CASE WHEN is_failed_trip = true)).',
  })
  failedJobs: number;

  /** Delivery-type job count. */
  @ApiProperty({
    description: "Delivery job count (SUM(CASE WHEN job_type = 'delivery')).",
  })
  deliveries: number;

  /** Pickup-type job count. */
  @ApiProperty({
    description: "Pickup job count (SUM(CASE WHEN job_type = 'pickup')).",
  })
  pickups: number;

  /** Exchange-type job count. */
  @ApiProperty({
    description: "Exchange job count (SUM(CASE WHEN job_type = 'exchange')).",
  })
  exchanges: number;

  /** Dump-run-type job count. */
  @ApiProperty({
    description: "Dump-run job count (SUM(CASE WHEN job_type = 'dump_run')).",
  })
  dumpRuns: number;
}

export class DriversResponseDto {
  /**
   * Per-driver productivity rows, one row per driver with
   * `assigned_driver_id IS NOT NULL` and at least one job
   * `scheduled_date` in the window. Order is whatever the underlying
   * GROUP BY produces — not explicitly sorted server-side; consumers
   * that need a leaderboard should sort client-side on the field of
   * interest (typically `completedJobs` DESC or `totalJobs` DESC).
   */
  @ApiProperty({
    type: [DriverStatsRowDto],
    description:
      'Per-driver productivity rows (one row per assigned driver in the window). No server-side ordering.',
  })
  driverStats: DriverStatsRowDto[];

  /** Window bounds — shared sub-DTO reused across 8 reporting endpoints. */
  @ApiProperty({
    type: PeriodDto,
    description:
      'Window bounds — shared sub-DTO reused across 8 reporting endpoints.',
  })
  period: PeriodDto;
}
