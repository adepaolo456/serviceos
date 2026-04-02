import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoiceRevision } from './entities/invoice-revision.entity';
import { Payment } from './entities/payment.entity';
import { CreditMemo } from './entities/credit-memo.entity';
import { BillingIssue } from './entities/billing-issue.entity';
import { JobCost } from './entities/job-cost.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { InvoiceService } from './services/invoice.service';
import { BillingIssueDetectorService } from './services/billing-issue-detector.service';
import { InvoiceController } from './controllers/invoice.controller';
import { BillingIssueController } from './controllers/billing-issue.controller';
import { BookingsController } from './bookings.controller';
import { BillingService } from './billing.service';
import { PaymentsController } from './billing.controller';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      InvoiceRevision,
      Payment,
      CreditMemo,
      BillingIssue,
      JobCost,
      Job,
      Customer,
      Asset,
      Tenant,
      Notification,
      PricingRule,
      RentalChain,
      TaskChainLink,
    ]),
    NotificationsModule,
    PricingModule,
  ],
  controllers: [InvoiceController, BillingIssueController, PaymentsController, BookingsController],
  providers: [InvoiceService, BillingIssueDetectorService, BillingService],
  exports: [InvoiceService, BillingService, BillingIssueDetectorService],
})
export class BillingModule {}
