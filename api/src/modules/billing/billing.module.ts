import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Job } from '../jobs/entities/job.entity';
import { BillingService } from './billing.service';
import { InvoicesController, PaymentsController } from './billing.controller';
import { BookingsController } from './bookings.controller';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Payment, Job, Customer, Asset, Tenant]), NotificationsModule],
  controllers: [InvoicesController, PaymentsController, BookingsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
