import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverController } from './driver.controller';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [TypeOrmModule.forFeature([Job, Asset]), JobsModule],
  controllers: [DriverController],
})
export class DriverModule {}
