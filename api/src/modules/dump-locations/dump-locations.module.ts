import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DumpLocationsController } from './dump-locations.controller';
import { DumpLocationsService } from './dump-locations.service';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './entities/dump-location.entity';
import { DumpTicket } from './entities/dump-ticket.entity';
import { Job } from '../jobs/entities/job.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { InvoiceLineItem } from '../billing/entities/invoice-line-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DumpLocation, DumpLocationRate, DumpLocationSurcharge, DumpTicket, Job, PricingRule, AutomationLog, Invoice, InvoiceLineItem])],
  controllers: [DumpLocationsController],
  providers: [DumpLocationsService],
})
export class DumpLocationsModule {}
