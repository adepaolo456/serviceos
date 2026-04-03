import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { MapboxModule } from '../mapbox/mapbox.module';
import { GeocodeBackfillService } from './geocode-backfill.service';
import { GeocodeBackfillController } from './geocode-backfill.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, Customer]),
    MapboxModule,
  ],
  controllers: [GeocodeBackfillController],
  providers: [GeocodeBackfillService],
  exports: [GeocodeBackfillService],
})
export class GeocodingModule {}
