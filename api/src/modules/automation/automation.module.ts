import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Quote } from '../quotes/quote.entity';
import { SmsMessage } from '../sms/sms-message.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, Customer, PricingRule, Tenant, Invoice, Notification, Quote, SmsMessage]),
    NotificationsModule,
    TenantSettingsModule,
    SmsModule,
  ],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
