import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from './entities/route.entity';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { JobsModule } from '../jobs/jobs.module';
import { CustomersModule } from '../customers/customers.module';
import { DispatchService } from './dispatch.service';
import { DispatchCreditEnforcementService } from './dispatch-credit-enforcement.service';
import { DispatchController } from './dispatch.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Route, Job, User, Tenant]),
    JobsModule,
    CustomersModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchCreditEnforcementService],
  exports: [DispatchService, DispatchCreditEnforcementService],
})
export class DispatchModule {}
