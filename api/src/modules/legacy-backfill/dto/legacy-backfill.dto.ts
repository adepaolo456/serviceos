import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, ArrayMinSize } from 'class-validator';

export class ApproveBackfillDto {
  @ApiProperty({
    description:
      'Ordered list of job IDs to link into a new rental chain. The order defines the sequence (delivery first, pickup last).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  job_ids!: string[];
}

export class RejectBackfillDto {
  @ApiProperty({
    description:
      'List of job IDs that form the rejected candidate. Stored as a sorted key so the same candidate does not re-surface.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  job_ids!: string[];

  @ApiPropertyOptional({ description: 'Optional reason for rejection, logged with the user id.' })
  @IsOptional()
  @IsString()
  reason?: string;
}
