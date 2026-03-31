import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingTemplate } from './entities/pricing-template.entity';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { Yard } from '../yards/yard.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PricingRule, PricingTemplate, DeliveryZone, Yard, Tenant])],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
