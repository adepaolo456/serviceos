import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Duplicated from notifications.dto.ts (file-local TYPES const there is not exported).
// Kept in sync manually — test-notification.dto.ts chose the same duplicate-over-share pattern.
const TYPES = [
  'booking_confirmation',
  'on_the_way',
  'pickup_reminder',
  'overdue_alert',
  'invoice_sent',
  'invoice_reminder',
  'payment_failed',
];

export class DispatchNotificationDto {
  @ApiProperty({ example: '<uuid>' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: TYPES, example: 'invoice_reminder' })
  @IsString()
  @IsIn(TYPES)
  notificationType: string;

  @ApiPropertyOptional({ example: 'Your invoice is past due' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ example: '<p>Your invoice...</p>' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  emailBody?: string;

  @ApiPropertyOptional({ example: 'Reminder: invoice past due' })
  @IsOptional()
  @IsString()
  @MaxLength(1600)
  smsBody?: string;

  @ApiPropertyOptional({ example: '<uuid>' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ example: '<uuid>' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}
