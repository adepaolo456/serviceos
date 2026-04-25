import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Arc J.1 — DTO for `POST /jobs/:id/cancel-with-financials`.
 *
 * Three-layer eligibility enforcement: this DTO is layer 1 (structural
 * validation). The service-layer guard (`cancelJobWithFinancials`)
 * re-checks against DB state — DTO can't see `amount_paid` so eligibility
 * by paid-status is layer 2's job. Modal UI (layer 3) prevents the
 * invalid combinations from being constructable.
 */
export class InvoiceDecisionDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  invoice_id!: string;

  @ApiProperty({
    enum: ['void_unpaid', 'refund_paid', 'credit_memo', 'keep_paid'],
  })
  @IsIn(['void_unpaid', 'refund_paid', 'credit_memo', 'keep_paid'])
  decision!: 'void_unpaid' | 'refund_paid' | 'credit_memo' | 'keep_paid';

  // Required only when decision === 'keep_paid'. Service-layer guard
  // re-checks; here is the first line of defense.
  @ApiPropertyOptional({
    description:
      "Required when decision is 'keep_paid'. The operator's documented reason for keeping the customer's payment without refund or credit.",
  })
  @ValidateIf((o: InvoiceDecisionDto) => o.decision === 'keep_paid')
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  reason?: string;
}

export class CancelWithFinancialsDto {
  @ApiProperty({ example: 'Customer requested cancellation' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  cancellationReason!: string;

  // No @ArrayMinSize: empty array is the valid Step-2-skipped path
  // (every linked invoice has zero paid AND zero balance, OR the job
  // has no linked invoices at all).
  //
  // Cap at 100 to defang DoS via huge arrays. Real-world cancellations
  // touch ≤5 invoices (chain length); 100 is a generous ceiling.
  @ApiProperty({ type: () => [InvoiceDecisionDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InvoiceDecisionDto)
  invoiceDecisions: InvoiceDecisionDto[] = [];
}
