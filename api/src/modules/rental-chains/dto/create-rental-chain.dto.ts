import { IsUUID, IsOptional, IsDateString, IsString, IsNumber, IsIn } from 'class-validator';

/**
 * Canonical source vocabulary for jobs.source.
 *
 * THREE-PLACE CONTRACT — adding a new value requires updating:
 *   1. This array (API validation via @IsIn)
 *   2. SOURCE_DISPLAY_LABELS in web/src/lib/utils.ts (UI labels)
 *   3. chk_jobs_source_whitelist DB CHECK constraint (Supabase migration)
 *
 * Order here must match SOURCE_DISPLAY_LABELS key order for
 * readability / grep parity.
 */
export const JOB_SOURCE_VALUES = [
  'phone',
  'portal',
  'manual',
  'schedule_next',
  'rescheduled_from_failure',
  'exchange',
  'marketplace',
  'automation',
  'dispatch',
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
