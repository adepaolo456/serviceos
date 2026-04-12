import { IsOptional, IsDateString, IsString, IsUUID } from 'class-validator';

/**
 * Create a new exchange on an existing rental chain. The chain's
 * currently-scheduled pickup link is cancelled, an `exchange` link is
 * inserted in its place, and a fresh pickup link is appended after the
 * exchange. The new pickup date is derived from
 * `tenant_settings.default_rental_period_days` unless the caller passes
 * an explicit `override_pickup_date`.
 */
export class CreateExchangeDto {
  @IsDateString()
  exchange_date!: string;

  @IsOptional()
  @IsString()
  dumpster_size?: string;

  @IsOptional()
  @IsUUID()
  asset_id?: string;

  /** If set, replaces the auto-calculated pickup date. */
  @IsOptional()
  @IsDateString()
  override_pickup_date?: string;
}
