import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Job } from '../jobs/entities/job.entity';
import { BillingService } from './billing.service';
import { InvoicesController, PaymentsController } from './billing.controller';
import { BookingsController } from './bookings.controller';
import { Customer } from '../customers/entities/customer.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Payment, Job, Customer, Tenant])],
  controllers: [InvoicesController, PaymentsController, BookingsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
