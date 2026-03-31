import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { Customer } from '../customers/entities/customer.entity';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Job, Asset, Invoice, PricingRule, AutomationLog, Customer])],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
