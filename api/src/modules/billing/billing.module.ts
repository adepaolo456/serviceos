import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Job } from '../jobs/entities/job.entity';
import { BillingService } from './billing.service';
import { InvoicesController, PaymentsController } from './billing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Payment, Job])],
  controllers: [InvoicesController, PaymentsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
