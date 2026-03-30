import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationLog } from './entities/automation-log.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AutomationLog, Job, Customer, PricingRule, Tenant])],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
