import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEmail,
  IsUUID,
  IsInt,
  IsObject,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddressDto {
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  lat?: number;

  @IsOptional()
  lng?: number;

  @IsOptional()
  @IsString()
  formatted?: string;
}

export class CreatePublicBookingDto {
  // --- Service identification (accept either pattern) ---

  @ApiPropertyOptional({ description: 'Pricing rule ID (frontend pattern)' })
  @ValidateIf((o) => !o.assetSubtype || !o.serviceType)
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ description: 'Asset subtype (legacy pattern)' })
  @ValidateIf((o) => !o.serviceId)
  @IsString()
  @IsNotEmpty()
  assetSubtype?: string;

  @ApiPropertyOptional({ description: 'Service type (legacy pattern)', default: 'dumpster_rental' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  // --- Scheduling (accept either field name) ---

  @ApiPropertyOptional({ description: 'Delivery date (frontend pattern, YYYY-MM-DD)' })
  @ValidateIf((o) => !o.scheduledDate)
  @IsString()
  @IsNotEmpty()
  deliveryDate?: string;

  @ApiPropertyOptional({ description: 'Scheduled date (legacy pattern, YYYY-MM-DD)' })
  @ValidateIf((o) => !o.deliveryDate)
  @IsString()
  @IsNotEmpty()
  scheduledDate?: string;

  // --- Address (accept either pattern) ---

  @ApiPropertyOptional({ description: 'Address object (frontend pattern)' })
  @IsOptional()
  @IsObject()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ description: 'Service address string or object (legacy pattern)' })
  @IsOptional()
  serviceAddress?: string | Record<string, any>;

  // --- Rental ---

  @ApiPropertyOptional({ description: 'Rental period in days', default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  rentalDays?: number;

  @ApiPropertyOptional({ description: 'Time window: morning, afternoon, any' })
  @IsOptional()
  @IsString()
  timeWindow?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  placementNotes?: string;

  // --- Customer info ---

  @ApiProperty({ description: 'Customer full name' })
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiProperty({ description: 'Customer email' })
  @IsEmail()
  @IsNotEmpty()
  customerEmail!: string;

  @ApiProperty({ description: 'Customer phone' })
  @IsString()
  @IsNotEmpty()
  customerPhone!: string;

  // --- Optional metadata ---

  @ApiPropertyOptional({ description: 'Booking source override' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Quote ID for conversion tracking' })
  @IsOptional()
  @IsUUID()
  quoteId?: string;
}
