import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DumpLocationsController } from './dump-locations.controller';
import { DumpLocationsService } from './dump-locations.service';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './entities/dump-location.entity';
import { Job } from '../jobs/entities/job.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DumpLocation, DumpLocationRate, DumpLocationSurcharge, Job, PricingRule, AutomationLog])],
  controllers: [DumpLocationsController],
  providers: [DumpLocationsService],
})
export class DumpLocationsModule {}
