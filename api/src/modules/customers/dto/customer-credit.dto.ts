/**
 * Phase 2 — Credit-control: DTOs for customer credit write paths.
 *
 * Validated with class-validator (matches the existing
 * customer.dto.ts pattern). Every field is parameter-bound on the
 * service side; class-validator gives us belt-and-suspenders type
 * checking + a clean OpenAPI/Swagger contract.
 *
 * Strictly read by:
 *   - CustomersController.updateCreditSettings
 *   - CustomersController.setCreditHold
 *   - CustomersController.releaseCreditHold (no body — uses URL only)
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PAYMENT_TERMS } from '../payment-terms';
import type { PaymentTerms } from '../payment-terms';

/**
 * Update payment terms and/or credit limit on a customer. Both
 * fields are optional — pass `null` to clear an override (fall back
 * to tenant default), pass `undefined` (omit) to leave unchanged.
 *
 * Atomic — both updates are applied in one save.
 */
export class UpdateCustomerCreditSettingsDto {
  @ApiPropertyOptional({
    enum: PAYMENT_TERMS,
    nullable: true,
    description:
      "Customer-specific payment terms override. Pass null to clear and fall back to the tenant default. Allowed values: " +
      PAYMENT_TERMS.join(', '),
  })
  @IsOptional()
  @IsIn([null, ...PAYMENT_TERMS])
  payment_terms?: PaymentTerms | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Customer-specific credit limit override (USD). Pass null to clear and fall back to the tenant default. Must be a non-negative number when set.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  credit_limit?: number | null;
}

/**
 * Set the manual credit hold flag on a customer. The reason is
 * required so the audit trail has forensic context — empty strings
 * are rejected at the validator level.
 */
export class SetCustomerCreditHoldDto {
  @ApiProperty({
    description:
      'Why this hold is being set. Required and non-empty. Stored in customers.credit_hold_reason and surfaced in future audit / hold-status UI.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
