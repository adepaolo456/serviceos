import { Module, forwardRef } from '@nestjs/common';
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
    // Path α — createExchange reuses PricingService.calculate +
    // BillingService.createInternalInvoice so lifecycle-created
    // exchanges price + invoice identically to booking-wizard
    // exchanges. The dependency on BillingModule is now via forwardRef
    // because OrchestrationService (which lives in BillingModule)
    // depends back on RentalChainsService for the canonical exchange
    // path consolidation. Standard NestJS escape hatch — both modules
    // bootstrap normally; only the cyclic injection is deferred.
    PricingModule,
    forwardRef(() => BillingModule),
  ],
  controllers: [RentalChainsController],
  providers: [RentalChainsService],
  exports: [RentalChainsService],
})
export class RentalChainsModule {}
