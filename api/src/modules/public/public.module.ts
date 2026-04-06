import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Quote } from '../quotes/quote.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, PricingRule, Asset, Job, Customer, Quote]), BillingModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
