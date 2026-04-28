import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from './entities/job.entity';
import { JobPricingAudit } from './entities/job-pricing-audit.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { ClientPricingOverride } from '../pricing/entities/client-pricing-override.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { BillingModule } from '../billing/billing.module';
import { PricingModule } from '../pricing/pricing.module';
import { RentalChainsModule } from '../rental-chains/rental-chains.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomersModule } from '../customers/customers.module';
import { CreditAuditModule } from '../credit-audit/credit-audit.module';
import { PermissionModule } from '../permissions/permission.module';
import { AlertsModule } from '../alerts/alerts.module';
import { StripeModule } from '../stripe/stripe.module';
import { MapboxModule } from '../mapbox/mapbox.module';
import { DispatchCreditEnforcementService } from '../dispatch/dispatch-credit-enforcement.service';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobPricingAudit, Asset, PricingRule, ClientPricingOverride, Notification, Customer, Route, Invoice, BillingIssue, CreditMemo, Payment, Tenant, RentalChain, TaskChainLink, DumpTicket]),
    BillingModule,
    PricingModule,
    RentalChainsModule,
    NotificationsModule,
    CustomersModule,
    CreditAuditModule,
    PermissionModule,
    // Phase 15 — JobsService injects AlertService to inline alert
    // indicators in the /jobs/:id/lifecycle-context response.
    AlertsModule,
    // Arc J.1 — cancellation orchestrator calls
    // StripeService.createRefundForPaymentIntent post-commit for
    // `refund_paid` decisions on card payments with a
    // stripe_payment_intent_id present.
    StripeModule,
    MapboxModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, DispatchCreditEnforcementService],
  exports: [JobsService],
})
export class JobsModule {}
