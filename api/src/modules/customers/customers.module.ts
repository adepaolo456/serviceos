import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { Quote } from '../quotes/quote.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { CustomerNote } from '../notes/note.entity';
import { CustomersService } from './customers.service';
import { CustomerDashboardService } from './customer-dashboard.service';
import { CustomersController } from './customers.controller';
import { MapboxModule } from '../mapbox/mapbox.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      Invoice,
      Job,
      Quote,
      BillingIssue,
      RentalChain,
      TaskChainLink,
      CustomerNote,
    ]),
    MapboxModule,
    SmsModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerDashboardService],
  exports: [CustomersService],
})
export class CustomersModule {}
