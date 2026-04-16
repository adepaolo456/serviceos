import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsObject,
  IsInt,
  IsNumber,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateJobDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsUUID()
  assignedDriverId?: string;

  @ApiProperty({ example: 'delivery' })
  @IsString()
  @IsNotEmpty()
  jobType: string;

  @ApiPropertyOptional({ example: 'standard' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({
    example: 'normal',
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  scheduledWindowStart?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  scheduledWindowEnd?: string;

  @ApiPropertyOptional({
    example: {
      street: '456 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zip: '78702',
    },
  })
  @IsOptional()
  @IsObject()
  serviceAddress?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Place near the garage door' })
  @IsOptional()
  @IsString()
  placementNotes?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  rentalStartDate?: string;

  @ApiPropertyOptional({ example: '2026-04-08' })
  @IsOptional()
  @IsString()
  rentalEndDate?: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rentalDays?: number;

  @ApiPropertyOptional({ example: 150.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  basePrice?: number;

  @ApiPropertyOptional({ example: 175.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalPrice?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  depositAmount?: number;

  @ApiPropertyOptional({ example: 'website' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: '20yd', description: 'Asset subtype for pricing lookup' })
  @IsOptional()
  @IsString()
  assetSubtype?: string;
}

class ExchangeContextInput {
  @ApiPropertyOptional({ example: '15yd' })
  @IsOptional()
  @IsString()
  pickup_asset_subtype?: string;

  @ApiPropertyOptional({ example: '20yd' })
  @IsOptional()
  @IsString()
  dropoff_asset_subtype?: string;
}

export class UpdateJobDto extends PartialType(CreateJobDto) {
  @ApiPropertyOptional({ description: 'Force pricing recalculation even if no pricing-relevant fields changed' })
  @IsOptional()
  @IsBoolean()
  recalculate?: boolean;

  @ApiPropertyOptional({ description: 'Yard ID for distance recalculation' })
  @IsOptional()
  @IsUUID()
  yardId?: string;

  @ApiPropertyOptional({ enum: ['residential', 'commercial'], description: 'Rental type for day/rate policies' })
  @IsOptional()
  @IsString()
  @IsIn(['residential', 'commercial'])
  rentalType?: string;

  @ApiPropertyOptional({ description: 'Exchange context for tonnage calculation' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExchangeContextInput)
  exchange_context?: ExchangeContextInput;
}

export class ListJobsQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    enum: [
      'pending',
      'confirmed',
      'dispatched',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsUUID()
  assignedDriverId?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Optional enrichment mode. When set to "board", each job is decorated with linked_invoice, chain context, open_billing_issue_count, and dispatch_ready flag. Default (omitted) returns the original shape unchanged.',
    enum: ['board'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['board'])
  enrichment?: string;

  @ApiPropertyOptional({
    description:
      'When true, returns jobs whose scheduled_date is strictly before the server date, status is not in (completed, cancelled, failed, needs_reschedule), and completed_at is null. Each returned job is decorated with `days_overdue`. Ordering is scheduled_date ASC (oldest first). Combinable with pagination; other filters still apply if supplied.',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  stale?: boolean;
}

export class ChangeStatusDto {
  @ApiProperty({
    example: 'confirmed',
    enum: [
      'pending',
      'confirmed',
      'dispatched',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn([
    'pending',
    'confirmed',
    'dispatched',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'cancelled',
    'failed',
  ])
  status: string;

  @ApiPropertyOptional({ example: 'Customer requested cancellation' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;

  // Phase B3-Fix — operator-supplied reason when an admin/dispatcher
  // overrides a job's status. Previously the frontend sent a second
  // `PATCH /jobs/:id { driver_notes: ... }` call that was silently
  // stripped by the global `whitelist: true` ValidationPipe because
  // `UpdateJobDto` has no such field, so every override in the
  // system lost its reason. This field lets the reason travel with
  // the status change on the single canonical call; `changeStatus`
  // records it in the existing admin-override audit log body.
  @ApiPropertyOptional({ example: 'Driver tapped wrong button' })
  @IsOptional()
  @IsString()
  overrideReason?: string;

  // Phase 11A — drivers can pass the asset they are confirming on
  // arrival/completion in the same transition. When present, the
  // backend updates `jobs.asset_id` (with audit entry) before
  // enforcing the asset-required gate on `completed`.
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({
    description:
      'Explicit override when the chosen asset is already assigned to another active job. Logged in the asset_change_history audit trail.',
  })
  @IsOptional()
  @IsBoolean()
  overrideAssetConflict?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetChangeReason?: string;

  // Fix — flag set by the UI when the user confirmed an asset whose
  // subtype does not match the job's required size. Recorded in the
  // audit trail for traceability.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  assetSizeMismatch?: boolean;

  // Phase 14 — drop-off asset confirmation. Used by the driver app
  // on exchange jobs to capture the NEW dumpster being delivered,
  // and by office corrections that need to update both the pickup
  // and delivery asset in one transition. Routed through the
  // canonical assignAssetToJob path (conflict guard + audit trail
  // + tenant scope) alongside any assetId change.
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description:
      'Drop-off asset id for exchange job confirmations. Runs through the canonical asset assignment path with full conflict + audit guards.',
  })
  @IsOptional()
  @IsUUID()
  dropOffAssetId?: string;
}

// Phase 11A — dedicated DTO for `PATCH /jobs/:id/asset`
// (office-side asset correction after completion). Separate from the
// general UpdateJobDto so the correction surface is explicit and the
// audit trail always runs.
//
// Phase 14 — `assetId` is now optional because office corrections on
// exchange jobs may need to touch only the drop-off asset without
// changing the pickup asset. The service-side runtime check in
// `changeAsset` enforces that at least one of `assetId` or
// `dropOffAssetId` is provided.
export class UpdateJobAssetDto {
  // `null` means "explicit unassign" (remove the current asset). The
  // `@ValidateIf` lets class-validator skip UUID validation on null
  // while still rejecting non-UUID strings. Undefined is treated as
  // "not provided" by the runtime check in `changeAsset`.
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.assetId !== null)
  @IsUUID()
  assetId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overrideAssetConflict?: boolean;

  @ApiPropertyOptional({ example: 'Driver recorded wrong dumpster' })
  @IsOptional()
  @IsString()
  reason?: string;

  // Fix — size-mismatch flag, same semantics as on ChangeStatusDto.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sizeMismatch?: boolean;

  // Phase 14 — drop-off asset for exchange job corrections.
  // Symmetric to `assetId`; runs through the same canonical
  // `assignAssetToJob` path with conflict guard + audit trail.
  // Either this or `assetId` must be provided (runtime check
  // in changeAsset).
  @ApiPropertyOptional({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description:
      'Drop-off asset id for exchange corrections. Either this or assetId must be provided.',
  })
  @IsOptional()
  @IsUUID()
  dropOffAssetId?: string;
}

export class AssignDto {
  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @ValidateIf((o) => o.assetId !== null)
  @IsUUID()
  assetId?: string | null;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @ValidateIf((o) => o.assignedDriverId !== null)
  @IsUUID()
  assignedDriverId?: string | null;
}

export class CalendarQueryDto {
  @ApiProperty({
    example: '2026-04-01',
    description: 'Start date (YYYY-MM-DD)',
  })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({ example: 7, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
