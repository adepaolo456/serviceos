import { IsUUID, IsOptional, IsDateString, IsString, IsNumber, IsIn } from 'class-validator';

// Canonical whitelist of jobs.source values. Mirrored for display in
// web/src/lib/utils.ts SOURCE_DISPLAY_LABELS — keep both sides aligned
// when adding values. Future backlog: extract to a shared monorepo
// package so API validation and web display import from one file.
export const JOB_SOURCE_VALUES = [
  'phone',
  'portal',
  'manual',
  'schedule_next',
  'rescheduled_from_failure',
  'exchange',
  'marketplace',
  'other',
] as const;

export type JobSource = (typeof JOB_SOURCE_VALUES)[number];

export class CreateRentalChainDto {
  @IsUUID()
  customer_id: string;

  @IsOptional()
  @IsUUID()
  asset_id?: string;

  @IsDateString()
  drop_off_date: string;

  @IsOptional()
  @IsUUID()
  pricing_rule_id?: string;

  @IsString()
  dumpster_size: string;

  @IsOptional()
  @IsNumber()
  rental_days?: number;

  @IsOptional()
  @IsString()
  @IsIn(JOB_SOURCE_VALUES)
  source?: JobSource;
}
