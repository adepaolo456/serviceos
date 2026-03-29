import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class DispatchBoardQueryDto {
  @ApiProperty({ example: '2026-03-29' })
  @IsString()
  date: string;
}

export class CreateRouteDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  driverId: string;

  @ApiProperty({ example: '2026-03-29' })
  @IsString()
  routeDate: string;

  @ApiPropertyOptional({
    example: { lat: 30.35, lng: -97.7, address: '100 Yard Rd, Austin TX' },
  })
  @IsOptional()
  @IsObject()
  startLocation?: Record<string, any>;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedDurationMin?: number;

  @ApiPropertyOptional({ example: 45.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalDistanceMiles?: number;

  @ApiPropertyOptional({
    enum: ['planned', 'active', 'completed'],
    default: 'planned',
  })
  @IsOptional()
  @IsString()
  @IsIn(['planned', 'active', 'completed'])
  status?: string;
}

export class ReorderDto {
  @ApiProperty({
    description: 'Job IDs in desired route order',
    example: [
      '550e8400-e29b-41d4-a716-446655440001',
      '550e8400-e29b-41d4-a716-446655440002',
    ],
  })
  @IsArray()
  @IsUUID('all', { each: true })
  jobIds: string[];
}
