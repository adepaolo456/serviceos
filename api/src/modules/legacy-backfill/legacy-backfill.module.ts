import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { LegacyBackfillController } from './legacy-backfill.controller';
import { LegacyBackfillService } from './legacy-backfill.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, Customer, RentalChain, TaskChainLink, Tenant]),
  ],
  controllers: [LegacyBackfillController],
  providers: [LegacyBackfillService],
})
export class LegacyBackfillModule {}
