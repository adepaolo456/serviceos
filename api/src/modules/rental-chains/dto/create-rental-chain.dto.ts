import { IsUUID, IsOptional, IsDateString, IsString, IsNumber } from 'class-validator';

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
}
