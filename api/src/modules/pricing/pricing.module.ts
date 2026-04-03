import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingTemplate } from './entities/pricing-template.entity';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { ClientPricingOverride } from './entities/client-pricing-override.entity';
import { SurchargeTemplate } from './entities/surcharge-template.entity';
import { ClientSurchargeOverride } from './entities/client-surcharge-override.entity';
import { TermsTemplate } from './entities/terms-template.entity';
import { TenantFee } from './entities/tenant-fee.entity';
import { PricingSnapshot } from './entities/pricing-snapshot.entity';
import { Yard } from '../yards/yard.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from './pricing.service';
import { PriceResolutionService } from './services/price-resolution.service';
import { PricingController } from './pricing.controller';
import { SurchargeTemplateController } from './controllers/surcharge-template.controller';
import { TermsTemplateController } from './controllers/terms-template.controller';
import { ClientPricingController } from './controllers/client-pricing.controller';
import { ClientSurchargeController } from './controllers/client-surcharge.controller';
import { TenantFeeController } from './controllers/tenant-fee.controller';
import { PricingQaController } from './controllers/pricing-qa.controller';
import { Job } from '../jobs/entities/job.entity';
import { JobPricingAudit } from '../jobs/entities/job-pricing-audit.entity';
import { Invoice } from '../billing/entities/invoice.entity';

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
      TenantFee,
      PricingSnapshot,
      Yard,
      Tenant,
      Job,
      JobPricingAudit,
      Invoice,
    ]),
  ],
  controllers: [
    PricingController,
    SurchargeTemplateController,
    TermsTemplateController,
    ClientPricingController,
    ClientSurchargeController,
    TenantFeeController,
    PricingQaController,
  ],
  providers: [PricingService, PriceResolutionService],
  exports: [PricingService, PriceResolutionService],
})
export class PricingModule {}
