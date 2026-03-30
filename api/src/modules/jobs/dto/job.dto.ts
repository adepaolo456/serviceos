import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsObject,
  IsInt,
  IsNumber,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateJobDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  @IsNotEmpty()
  customerId: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsUUID()
  assignedDriverId?: string;

  @ApiProperty({ example: 'delivery' })
  @IsString()
  @IsNotEmpty()
  jobType: string;

  @ApiPropertyOptional({ example: 'standard' })
  @IsOptional()
  @IsString()
  serviceType?: string;

  @ApiPropertyOptional({
    example: 'normal',
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  scheduledWindowStart?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  scheduledWindowEnd?: string;

  @ApiPropertyOptional({
    example: {
      street: '456 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zip: '78702',
    },
  })
  @IsOptional()
  @IsObject()
  serviceAddress?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Place near the garage door' })
  @IsOptional()
  @IsString()
  placementNotes?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  rentalStartDate?: string;

  @ApiPropertyOptional({ example: '2026-04-08' })
  @IsOptional()
  @IsString()
  rentalEndDate?: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rentalDays?: number;

  @ApiPropertyOptional({ example: 150.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  basePrice?: number;

  @ApiPropertyOptional({ example: 175.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalPrice?: number;

  @ApiPropertyOptional({ example: 50.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  depositAmount?: number;

  @ApiPropertyOptional({ example: 'website' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class UpdateJobDto extends PartialType(CreateJobDto) {}

export class ListJobsQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    enum: [
      'pending',
      'confirmed',
      'dispatched',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsUUID()
  assignedDriverId?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsString()
  dateTo?: string;

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

export class ChangeStatusDto {
  @ApiProperty({
    example: 'confirmed',
    enum: [
      'pending',
      'confirmed',
      'dispatched',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn([
    'pending',
    'confirmed',
    'dispatched',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'cancelled',
  ])
  status: string;

  @ApiPropertyOptional({ example: 'Customer requested cancellation' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

export class AssignDto {
  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @ValidateIf((o) => o.assetId !== null)
  @IsUUID()
  assetId?: string | null;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @ValidateIf((o) => o.assignedDriverId !== null)
  @IsUUID()
  assignedDriverId?: string | null;
}

export class CalendarQueryDto {
  @ApiProperty({
    example: '2026-04-01',
    description: 'Start date (YYYY-MM-DD)',
  })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiPropertyOptional({ example: 7, default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;
}
