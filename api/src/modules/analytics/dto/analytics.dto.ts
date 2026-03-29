import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RevenueQueryDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  startDate: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsString()
  endDate: string;
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
