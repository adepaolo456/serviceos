import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMarketplaceBookingDto {
  @ApiProperty({ example: 'RT-2026-ABC123' })
  @IsString()
  @IsNotEmpty()
  marketplaceBookingId: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  tenantId: string;

  @ApiProperty({ example: 'dumpster_rental' })
  @IsString()
  @IsNotEmpty()
  listingType: string;

  @ApiPropertyOptional({ example: '20yd' })
  @IsOptional()
  @IsString()
  assetSubtype?: string;

  @ApiProperty({ example: 'Jane Smith' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsString()
  @IsNotEmpty()
  customerEmail: string;

  @ApiPropertyOptional({ example: '555-234-5678' })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({
    example: {
      street: '456 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zip: '78702',
      lat: 30.2672,
      lng: -97.7431,
    },
  })
  @IsOptional()
  @IsObject()
  serviceAddress?: Record<string, any>;

  @ApiProperty({ example: '2026-04-01' })
  @IsString()
  @IsNotEmpty()
  requestedDate: string;

  @ApiPropertyOptional({ example: 7, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  rentalDays?: number;

  @ApiPropertyOptional({ example: 'Place in driveway, not on grass' })
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiProperty({ example: 450 })
  @IsNumber()
  @Min(0)
  quotedPrice: number;

  @ApiPropertyOptional({ example: 45, description: 'Marketplace commission' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  marketplaceFee?: number;
}

export class ListMarketplaceBookingsQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'accepted', 'rejected', 'converted'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'accepted', 'rejected', 'converted'])
  status?: string;

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

export class RejectBookingDto {
  @ApiProperty({ example: 'No available units for requested date' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AvailabilityQueryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  tenantId: string;

  @ApiProperty({ example: 'dumpster' })
  @IsString()
  type: string;

  @ApiPropertyOptional({ example: '20yd' })
  @IsOptional()
  @IsString()
  subtype?: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsString()
  date: string;
}

export class MarketplacePricingQueryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  tenantId: string;

  @ApiProperty({ example: 'dumpster_rental' })
  @IsString()
  serviceType: string;

  @ApiProperty({ example: '20yd' })
  @IsString()
  assetSubtype: string;

  @ApiProperty({ example: 30.2672 })
  @Type(() => Number)
  @IsNumber()
  lat: number;

  @ApiProperty({ example: -97.7431 })
  @Type(() => Number)
  @IsNumber()
  lng: number;
}
