import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { RentalChainsService } from './rental-chains.service';
import { RentalChainsController } from './rental-chains.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RentalChain, TaskChainLink, Job, TenantSettings]),
  ],
  controllers: [RentalChainsController],
  providers: [RentalChainsService],
  exports: [RentalChainsService],
})
export class RentalChainsModule {}
