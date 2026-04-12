import { IsOptional, IsDateString } from 'class-validator';

/**
 * Reschedule an existing exchange task. The exchange link's
 * scheduled_date and its linked exchange job are updated, and the
 * immediately-downstream pickup link (if one exists and is scheduled)
 * is recalculated from `tenant_settings.default_rental_period_days`
 * unless an explicit `override_pickup_date` is supplied.
 */
export class RescheduleExchangeDto {
  @IsDateString()
  exchange_date!: string;

  @IsOptional()
  @IsDateString()
  override_pickup_date?: string;
}
