import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const SERVICE_TYPES = [
  'dumpster_rental',
  'pod_storage',
  'restroom_service',
  'landscaping',
];

const ASSET_SUBTYPES = ['10yd', '15yd', '20yd', '30yd', '40yd'];

export class CreatePricingRuleDto {
  @ApiProperty({ example: 'Standard 20yd Dumpster' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: SERVICE_TYPES,
    example: 'dumpster_rental',
  })
  @IsString()
  @IsIn(SERVICE_TYPES)
  serviceType: string;

  @ApiPropertyOptional({ enum: ASSET_SUBTYPES, example: '20yd' })
  @IsOptional()
  @IsString()
  @IsIn(ASSET_SUBTYPES)
  assetSubtype?: string;

  @ApiPropertyOptional({
    enum: ['residential', 'commercial'],
    description: 'Null applies to both',
  })
  @IsOptional()
  @IsString()
  @IsIn(['residential', 'commercial'])
  customerType?: string;

  @ApiProperty({ example: 350 })
  @IsNumber()
  @Min(0)
  basePrice: number;

  @ApiPropertyOptional({ example: 7, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rentalPeriodDays?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraDayRate?: number;

  @ApiPropertyOptional({ example: 15, description: 'Free delivery radius' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  includedMiles?: number;

  @ApiPropertyOptional({ example: 3.5, description: 'Per mile beyond radius' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perMileCharge?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxServiceMiles?: number;

  @ApiPropertyOptional({ example: 2, description: 'Tons included in base' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  includedTons?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overagePerTon?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({ example: 75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pickupFee?: number;

  @ApiPropertyOptional({ example: 0, description: 'Exchange discount percentage (0-100). Exchange priced same as delivery minus this discount.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  exchangeFee?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requireDeposit?: boolean;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @ApiPropertyOptional({ example: 0.0825, description: 'e.g. 8.25% = 0.0825' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;
}

export class UpdatePricingRuleDto extends PartialType(CreatePricingRuleDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListPricingRulesQueryDto {
  @ApiPropertyOptional({ enum: SERVICE_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(SERVICE_TYPES)
  serviceType?: string;

  @ApiPropertyOptional({ enum: ASSET_SUBTYPES })
  @IsOptional()
  @IsString()
  @IsIn(ASSET_SUBTYPES)
  assetSubtype?: string;

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
}

export class CalculatePriceDto {
  @ApiProperty({ enum: SERVICE_TYPES, example: 'dumpster_rental' })
  @IsString()
  @IsIn(SERVICE_TYPES)
  serviceType: string;

  @ApiProperty({ enum: ASSET_SUBTYPES, example: '20yd' })
  @IsString()
  @IsIn(ASSET_SUBTYPES)
  assetSubtype: string;

  @ApiProperty({
    enum: ['delivery', 'pickup', 'exchange'],
    example: 'delivery',
  })
  @IsString()
  @IsIn(['delivery', 'pickup', 'exchange'])
  jobType: string;

  @ApiPropertyOptional({
    enum: ['residential', 'commercial'],
    example: 'residential',
  })
  @IsOptional()
  @IsString()
  @IsIn(['residential', 'commercial'])
  customerType?: string;

  @ApiProperty({ example: 30.2672, description: 'Customer latitude' })
  @IsNumber()
  customerLat: number;

  @ApiProperty({ example: -97.7431, description: 'Customer longitude' })
  @IsNumber()
  customerLng: number;

  @ApiPropertyOptional({ example: 30.35, description: 'Yard latitude (auto-fetched from primary yard if omitted)' })
  @IsOptional()
  @IsNumber()
  yardLat?: number;

  @ApiPropertyOptional({ example: -97.7, description: 'Yard longitude (auto-fetched from primary yard if omitted)' })
  @IsOptional()
  @IsNumber()
  yardLng?: number;

  @ApiPropertyOptional({ example: 14, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rentalDays?: number;
}
