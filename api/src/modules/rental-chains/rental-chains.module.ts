import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { RentalChainsService } from './rental-chains.service';
import { RentalChainsController } from './rental-chains.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RentalChain, TaskChainLink, Job])],
  controllers: [RentalChainsController],
  providers: [RentalChainsService],
  exports: [RentalChainsService],
})
export class RentalChainsModule {}
