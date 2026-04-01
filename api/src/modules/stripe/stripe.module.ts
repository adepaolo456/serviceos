import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Customer, Invoice, Payment, AutomationLog, SubscriptionPlan])],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
