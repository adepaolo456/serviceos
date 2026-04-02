import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DumpLocationsController } from './dump-locations.controller';
import { DumpLocationsService } from './dump-locations.service';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './entities/dump-location.entity';
import { DumpTicket } from './entities/dump-ticket.entity';
import { Job } from '../jobs/entities/job.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { InvoiceLineItem } from '../billing/entities/invoice-line-item.entity';
import { JobCost } from '../billing/entities/job-cost.entity';
import { Payment } from '../billing/entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DumpLocation, DumpLocationRate, DumpLocationSurcharge, DumpTicket, Job, PricingRule, Notification, Invoice, InvoiceLineItem, JobCost, Payment])],
  controllers: [DumpLocationsController],
  providers: [DumpLocationsService],
})
export class DumpLocationsModule {}
