import { IsUUID, IsOptional, IsNumber } from 'class-validator';

export class CreateClientPricingOverrideDto {
  @IsUUID()
  customer_id: string;

  @IsUUID()
  pricing_rule_id: string;

  @IsOptional()
  @IsNumber()
  base_price?: number;

  @IsOptional()
  @IsNumber()
  weight_allowance_tons?: number;

  @IsOptional()
  @IsNumber()
  overage_per_ton?: number;

  @IsOptional()
  @IsNumber()
  daily_overage_rate?: number;

  @IsOptional()
  @IsNumber()
  rental_days?: number;
}
