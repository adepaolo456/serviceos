import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamController } from './team.controller';
import { TimeEntry } from './time-entry.entity';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TimeEntry, User, Job])],
  controllers: [TeamController],
})
export class TeamModule {}
