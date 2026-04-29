import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketplaceBooking } from './entities/marketplace-booking.entity';
import { MarketplaceIntegration } from './entities/marketplace-integration.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingModule } from '../pricing/pricing.module';
import { JobsModule } from '../jobs/jobs.module';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketplaceBooking,
      MarketplaceIntegration,
      Customer,
      Job,
      Asset,
      Tenant,
    ]),
    PricingModule,
    // Marketplace `accept()` delegates job creation to JobsService so
    // it inherits the SSoT pricing/numbering path. The dependency is
    // mechanically safe: JobsModule does not (transitively) import
    // MarketplaceModule.
    JobsModule,
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
