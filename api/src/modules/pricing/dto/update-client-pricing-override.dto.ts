import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateClientPricingOverrideDto } from './create-client-pricing-override.dto';

export class UpdateClientPricingOverrideDto extends PartialType(
  OmitType(CreateClientPricingOverrideDto, ['customer_id', 'pricing_rule_id'] as const),
) {}
