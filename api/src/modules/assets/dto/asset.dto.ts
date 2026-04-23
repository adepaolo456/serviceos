import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
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
    enum: ['available', 'on_site', 'in_transit', 'maintenance'],
    default: 'available',
    example: 'available',
  })
  @IsOptional()
  @IsString()
  // 'retired' deliberately excluded — the dedicated /assets/:id/retire
  // endpoint is the only legal path to status='retired' because it
  // captures the required reason + actor + timestamp. Letting POST /assets
  // or PATCH /assets/:id set status='retired' would be a metadata-less
  // backdoor. See AssetsService.retire() and .update() retired-guard.
  @IsIn(['available', 'on_site', 'in_transit', 'maintenance', 'reserved', 'deployed', 'full_staged'])
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

export class RetireAssetDto {
  @ApiProperty({
    enum: ['sold', 'damaged', 'scrapped', 'other'],
    example: 'sold',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['sold', 'damaged', 'scrapped', 'other'])
  reason: string;

  @ApiPropertyOptional({ example: 'Sold to Acme Hauling 2026-04-20' })
  @IsOptional()
  @IsString()
  notes?: string;
}

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

  // Default false — retired assets are hidden from active inventory views.
  // Set to true to include retired rows in the response (used by the
  // Assets page "Include retired" toggle). An explicit status=retired
  // filter also returns retired rows regardless of this flag.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  includeRetired?: boolean;
}

export class NextAssetNumberQueryDto {
  @ApiProperty({
    enum: ['dumpster', 'pod', 'restroom'],
    example: 'dumpster',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['dumpster', 'pod', 'restroom'])
  assetType: string;

  @ApiProperty({ example: '10yd' })
  @IsString()
  @IsNotEmpty()
  subtype: string;
}
