import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { SetupChecklist } from './entities/setup-checklist.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Yard } from '../yards/yard.entity';
import { Asset } from '../assets/entities/asset.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SetupChecklist,
      Tenant,
      TenantSettings,
      PricingRule,
      Yard,
      Asset,
    ]),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
