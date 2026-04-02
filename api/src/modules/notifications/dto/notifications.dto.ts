import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const CHANNELS = ['sms', 'email', 'push'];
const TYPES = [
  'booking_confirmation',
  'on_the_way',
  'pickup_reminder',
  'overdue_alert',
  'invoice_sent',
  'invoice_reminder',
  'payment_failed',
];

export class SendNotificationDto {
  @ApiProperty({ enum: CHANNELS, example: 'sms' })
  @IsString()
  @IsIn(CHANNELS)
  channel: string;

  @ApiProperty({ enum: TYPES, example: 'booking_confirmation' })
  @IsString()
  @IsIn(TYPES)
  type: string;

  @ApiProperty({ example: '555-123-4567', description: 'Phone or email' })
  @IsString()
  @IsNotEmpty()
  recipient: string;

  @ApiPropertyOptional({ example: 'Your booking is confirmed' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({
    example: 'Hi Jane, your 20yd dumpster delivery is confirmed for March 30.',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: CHANNELS })
  @IsOptional()
  @IsString()
  @IsIn(CHANNELS)
  channel?: string;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsString()
  @IsIn(TYPES)
  type?: string;

  @ApiPropertyOptional({ enum: ['queued', 'sent', 'delivered', 'failed'] })
  @IsOptional()
  @IsString()
  @IsIn(['queued', 'sent', 'delivered', 'failed'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

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
