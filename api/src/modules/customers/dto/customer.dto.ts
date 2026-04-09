import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  IsObject,
  IsInt,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @ApiProperty({ enum: ['residential', 'commercial'], default: 'residential' })
  @IsOptional()
  @IsString()
  @IsIn(['residential', 'commercial'])
  type?: string;

  @ApiPropertyOptional({ example: 'Acme Construction' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({ example: 'jane@acme.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '555-234-5678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: {
      street: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    },
  })
  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, any>;

  @ApiPropertyOptional({
    example: [
      {
        street: '456 Oak Ave',
        city: 'Austin',
        state: 'TX',
        zip: '78702',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  serviceAddresses?: Record<string, any>[];

  @ApiPropertyOptional({ example: 'Prefers morning deliveries' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'Gate code 4921. Drop behind white fence, away from mailbox.' })
  @IsOptional()
  @IsString()
  driverInstructions?: string;

  @ApiPropertyOptional({ example: ['vip', 'repeat'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 'website' })
  @IsOptional()
  @IsString()
  leadSource?: string;

  @ApiPropertyOptional({ example: 'standard' })
  @IsOptional()
  @IsString()
  pricingTier?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  discountPercentage?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  exemptExtraDayCharges?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  customPricing?: Record<string, { basePrice?: number; includedTons?: number; overageRate?: number }>;

  @ApiPropertyOptional({ example: 'VIP customer - negotiated rates' })
  @IsOptional()
  @IsString()
  pricingNotes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Search by name, email, or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['residential', 'commercial'] })
  @IsOptional()
  @IsString()
  @IsIn(['residential', 'commercial'])
  type?: string;

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
