import { IsOptional, IsDateString, IsString, IsIn } from 'class-validator';

/**
 * Lifecycle-level update for a rental chain. This is the authoritative
 * path for changing lifecycle dates — the handler keeps `rental_chains`
 * and the linked pickup `jobs` row in sync so they never drift.
 */
export class UpdateRentalChainDto {
  @IsOptional()
  @IsDateString()
  expected_pickup_date?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'completed', 'cancelled'])
  status?: string;
}
