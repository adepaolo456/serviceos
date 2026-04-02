import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LineItemDto {
  @ApiProperty({ example: 'Dumpster rental - 20yd, 7 days' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ example: 350 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ example: 350 })
  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ example: '2026-04-15' })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiProperty({
    type: [LineItemDto],
    example: [
      {
        description: 'Dumpster rental - 20yd, 7 days',
        quantity: 1,
        unitPrice: 350,
        amount: 350,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];

  @ApiPropertyOptional({ example: 0.0825 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ example: 'Net 30' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {
  @ApiPropertyOptional({ enum: ['draft', 'open', 'partial', 'paid', 'overdue', 'voided'] })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'open', 'partial', 'paid', 'overdue', 'voided'])
  status?: string;
}

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({
    enum: ['draft', 'open', 'partial', 'paid', 'overdue', 'voided'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'open', 'partial', 'paid', 'overdue', 'voided'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
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

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ example: 350 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({
    enum: ['card', 'ach', 'cash', 'check'],
    example: 'card',
  })
  @IsString()
  @IsIn(['card', 'ach', 'cash', 'check'])
  paymentMethod: string;

  @ApiPropertyOptional({
    enum: ['pending', 'succeeded', 'failed', 'refunded'],
    default: 'succeeded',
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'succeeded', 'failed', 'refunded'])
  status?: string;

  @ApiPropertyOptional({ example: 'Check #1234' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

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
