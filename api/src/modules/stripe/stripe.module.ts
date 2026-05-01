import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { StripeEvent } from './entities/stripe-event.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, Customer, Invoice, Payment, Notification, SubscriptionPlan, StripeEvent]),
    // PR-C1c: provides InvoiceService so chargeInvoice / refundInvoice
    // can call the canonical reconcileBalance() writer (PR #20) instead
    // of writing invoice columns directly. BillingModule does NOT import
    // StripeModule — unidirectional dependency, no forwardRef needed.
    BillingModule,
  ],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
