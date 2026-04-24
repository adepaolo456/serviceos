import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamController } from './team.controller';
import { TimeEntry } from './time-entry.entity';
import { UserAuditLog } from './entities/user-audit-log.entity';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeEntry, User, Job, UserAuditLog]),
    AuthModule,
  ],
  controllers: [TeamController],
  providers: [UsersService],
})
export class TeamModule {}
