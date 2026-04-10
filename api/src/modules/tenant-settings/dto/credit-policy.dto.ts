/**
 * Phase 2 — Credit-control: tenant credit policy DTOs.
 *
 * The tenant credit policy lives in `tenants.settings.credit_policy`
 * (JSONB) per the Phase 1 documentation. These DTOs validate the
 * write payload before the service merges it into the JSONB blob.
 *
 * Each rule is its own optional sub-object with its own validation
 * so partial updates work cleanly — operators can enable just one
 * rule without having to send the whole policy.
 *
 * Phase 2 stores these values but does not enforce them. Future
 * phases will read the same JSONB blob via getCreditPolicy() and
 * apply the rules at booking / dispatch / blocked-job evaluation
 * time.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_TERMS } from '../../customers/payment-terms';
import type { PaymentTerms } from '../../customers/payment-terms';

const POLICY_MODES = ['warn', 'block'] as const;

export class ArThresholdRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Total open AR threshold (USD).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  threshold?: number;

  @ApiPropertyOptional({ enum: POLICY_MODES })
  @IsOptional()
  @IsIn(POLICY_MODES as unknown as string[])
  mode?: 'warn' | 'block';
}

export class OverdueRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Days past due that triggers the rule.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  days_overdue?: number;

  @ApiPropertyOptional({ enum: POLICY_MODES })
  @IsOptional()
  @IsIn(POLICY_MODES as unknown as string[])
  mode?: 'warn' | 'block';
}

export class UnpaidExceptionsRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ enum: POLICY_MODES })
  @IsOptional()
  @IsIn(POLICY_MODES as unknown as string[])
  mode?: 'warn' | 'block';
}

/* ─── Phase 5: Dispatch enforcement ─── */

class DispatchBlockActionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  assignment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  en_route?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  arrived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

class DispatchEnforcementDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  block_on_hold?: boolean;

  @ApiPropertyOptional({ type: DispatchBlockActionsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DispatchBlockActionsDto)
  block_actions?: DispatchBlockActionsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allow_override?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  override_roles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  require_override_reason?: boolean;
}

/**
 * Patch payload for `tenants.settings.credit_policy`. Every field is
 * optional — only the fields present in the request body get merged
 * into the existing JSONB blob. To clear a field, send `null`. To
 * leave a field unchanged, omit it.
 */
export class UpdateCreditPolicyDto {
  @ApiPropertyOptional({
    enum: PAYMENT_TERMS,
    nullable: true,
    description:
      'Default payment terms applied when a customer has no own override (customers.payment_terms is NULL).',
  })
  @IsOptional()
  @IsIn([null, ...PAYMENT_TERMS])
  default_payment_terms?: PaymentTerms | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Default credit limit (USD) applied when a customer has no own override (customers.credit_limit is NULL). null = no default limit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  default_credit_limit?: number | null;

  @ApiPropertyOptional({ type: ArThresholdRuleDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ArThresholdRuleDto)
  ar_threshold_block?: ArThresholdRuleDto;

  @ApiPropertyOptional({ type: OverdueRuleDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OverdueRuleDto)
  overdue_block?: OverdueRuleDto;

  @ApiPropertyOptional({ type: UnpaidExceptionsRuleDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UnpaidExceptionsRuleDto)
  unpaid_exceptions_block?: UnpaidExceptionsRuleDto;

  @ApiPropertyOptional({
    description:
      'When true, operators with sufficient role can override an automatic block on a per-action basis (future phase).',
  })
  @IsOptional()
  @IsBoolean()
  allow_office_override?: boolean;

  @ApiPropertyOptional({ type: () => DispatchEnforcementDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DispatchEnforcementDto)
  dispatch_enforcement?: DispatchEnforcementDto;
}
