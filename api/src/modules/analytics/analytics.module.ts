import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';
import { HelpAnalyticsEvent } from './entities/help-analytics-event.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { HelpAnalyticsController } from './help-analytics.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Job, Customer, Asset, HelpAnalyticsEvent]),
    JobsModule,
  ],
  controllers: [AnalyticsController, HelpAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
