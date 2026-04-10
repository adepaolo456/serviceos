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
import { BillingAuditService } from './services/billing-audit.service';
import { BookingCreditEnforcementService } from './services/booking-credit-enforcement.service';
import { InvoiceController } from './controllers/invoice.controller';
import { BillingIssueController } from './controllers/billing-issue.controller';
import { BillingAuditController } from './controllers/billing-audit.controller';
import { BookingsController } from './bookings.controller';
import { BillingService } from './billing.service';
import { PaymentsController } from './billing.controller';
import { CustomersModule } from '../customers/customers.module';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingModule } from '../pricing/pricing.module';
import { MapboxModule } from '../mapbox/mapbox.module';
import { OrchestrationService } from './services/orchestration.service';
import { BookingCompletionService } from './services/booking-completion.service';
import { CreditAuditModule } from '../credit-audit/credit-audit.module';
import { PermissionModule } from '../permissions/permission.module';

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
    MapboxModule,
    // Phase 4B — CustomersModule exports CustomerCreditService which
    // BookingCreditEnforcementService depends on. This is a one-way
    // dependency: CustomersModule does NOT import BillingModule.
    CustomersModule,
    CreditAuditModule,
    PermissionModule,
  ],
  controllers: [InvoiceController, BillingIssueController, BillingAuditController, PaymentsController, BookingsController],
  providers: [InvoiceService, BillingIssueDetectorService, BillingAuditService, BookingCreditEnforcementService, BillingService, OrchestrationService, BookingCompletionService],
  exports: [InvoiceService, BillingService, BillingIssueDetectorService, BillingAuditService, BookingCreditEnforcementService, OrchestrationService, BookingCompletionService],
})
export class BillingModule {}
