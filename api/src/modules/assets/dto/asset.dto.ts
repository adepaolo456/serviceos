import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsNumber,
  IsObject,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAssetDto {
  @ApiProperty({
    enum: ['dumpster', 'pod', 'restroom'],
    example: 'dumpster',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['dumpster', 'pod', 'restroom'])
  assetType: string;

  @ApiPropertyOptional({ example: '20-yard' })
  @IsOptional()
  @IsString()
  subtype?: string;

  @ApiProperty({ example: 'DUMP-001' })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiPropertyOptional({
    enum: ['available', 'on_site', 'in_transit', 'maintenance', 'retired'],
    default: 'available',
    example: 'available',
  })
  @IsOptional()
  @IsString()
  @IsIn(['available', 'on_site', 'in_transit', 'maintenance', 'retired', 'reserved', 'deployed', 'full_staged'])
  status?: string;

  @ApiPropertyOptional({ example: 'good' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    enum: ['yard', 'customer_site', 'in_transit'],
    example: 'yard',
  })
  @IsOptional()
  @IsString()
  currentLocationType?: string;

  @ApiPropertyOptional({
    example: { lat: 30.2672, lng: -97.7431, address: '123 Yard Rd' },
  })
  @IsOptional()
  @IsObject()
  currentLocation?: Record<string, any>;

  @ApiPropertyOptional({ example: 4000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightCapacity?: number;

  @ApiPropertyOptional({ example: 15.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  dailyRate?: number;

  @ApiPropertyOptional({ example: 'Blue container, minor dent on left side' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: { color: 'blue', manufacturer: 'WasteCo' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}

export class ListAssetsQueryDto {
  @ApiPropertyOptional({
    enum: ['dumpster', 'pod', 'restroom'],
    description: 'Filter by asset type',
  })
  @IsOptional()
  @IsString()
  @IsIn(['dumpster', 'pod', 'restroom'])
  type?: string;

  @ApiPropertyOptional({ description: 'Filter by subtype' })
  @IsOptional()
  @IsString()
  subtype?: string;

  @ApiPropertyOptional({
    enum: ['available', 'on_site', 'in_transit', 'maintenance', 'retired'],
    description: 'Filter by status',
  })
  @IsOptional()
  @IsString()
  @IsIn(['available', 'on_site', 'in_transit', 'maintenance', 'retired', 'reserved', 'deployed', 'full_staged'])
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
