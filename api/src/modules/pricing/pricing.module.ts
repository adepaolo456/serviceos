import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingTemplate } from './entities/pricing-template.entity';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { ClientPricingOverride } from './entities/client-pricing-override.entity';
import { SurchargeTemplate } from './entities/surcharge-template.entity';
import { ClientSurchargeOverride } from './entities/client-surcharge-override.entity';
import { TermsTemplate } from './entities/terms-template.entity';
import { Yard } from '../yards/yard.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from './pricing.service';
import { PriceResolutionService } from './services/price-resolution.service';
import { PricingController } from './pricing.controller';
import { SurchargeTemplateController } from './controllers/surcharge-template.controller';
import { TermsTemplateController } from './controllers/terms-template.controller';
import { ClientPricingController } from './controllers/client-pricing.controller';
import { ClientSurchargeController } from './controllers/client-surcharge.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PricingRule,
      PricingTemplate,
      DeliveryZone,
      ClientPricingOverride,
      SurchargeTemplate,
      ClientSurchargeOverride,
      TermsTemplate,
      Yard,
      Tenant,
    ]),
  ],
  controllers: [
    PricingController,
    SurchargeTemplateController,
    TermsTemplateController,
    ClientPricingController,
    ClientSurchargeController,
  ],
  providers: [PricingService, PriceResolutionService],
  exports: [PricingService, PriceResolutionService],
})
export class PricingModule {}
