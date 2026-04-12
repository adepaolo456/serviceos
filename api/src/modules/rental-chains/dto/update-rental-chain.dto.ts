import {
  IsOptional,
  IsDateString,
  IsString,
  IsIn,
  IsBoolean,
} from 'class-validator';

/**
 * Lifecycle-level update for a rental chain. This is the authoritative
 * path for changing lifecycle dates — the handler keeps `rental_chains`
 * and the linked `task_chain_links` + `jobs` rows in sync so they
 * never drift.
 *
 * Phase 8 extends this with `drop_off_date` so delivery rescheduling
 * also goes through the chain controller. When a delivery moves, the
 * default behavior is to shift all downstream exchange/pickup links by
 * the same day-offset, preserving the rental duration. Pass
 * `shift_downstream: false` to move only the delivery date (the
 * handler still validates that no scheduled downstream link ends up
 * before the new delivery).
 */
export class UpdateRentalChainDto {
  @IsOptional()
  @IsDateString()
  expected_pickup_date?: string;

  @IsOptional()
  @IsDateString()
  drop_off_date?: string;

  @IsOptional()
  @IsBoolean()
  shift_downstream?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'completed', 'cancelled'])
  status?: string;
}
