import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { RentalChainsService } from './rental-chains.service';
import { RentalChainsController } from './rental-chains.controller';
import { PricingModule } from '../pricing/pricing.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RentalChain, TaskChainLink, Job, TenantSettings]),
    // Path α — createExchange now reuses the booking-wizard pricing
    // engine (PricingService.calculate) and the canonical billing path
    // (BillingService.createInternalInvoice) so lifecycle-created
    // exchanges are priced + invoiced identically to booking-wizard
    // exchanges. One-way deps: neither module imports RentalChainsModule.
    PricingModule,
    BillingModule,
  ],
  controllers: [RentalChainsController],
  providers: [RentalChainsService],
  exports: [RentalChainsService],
})
export class RentalChainsModule {}
