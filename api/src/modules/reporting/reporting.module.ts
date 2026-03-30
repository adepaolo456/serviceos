import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Job, DumpTicket, Asset, Customer, User])],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
