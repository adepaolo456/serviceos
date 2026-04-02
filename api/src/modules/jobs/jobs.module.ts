import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { BillingModule } from '../billing/billing.module';
import { RentalChainsModule } from '../rental-chains/rental-chains.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, Asset, PricingRule, AutomationLog, Customer, Route, Invoice, CreditMemo, RentalChain, TaskChainLink]),
    BillingModule,
    RentalChainsModule,
    NotificationsModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
