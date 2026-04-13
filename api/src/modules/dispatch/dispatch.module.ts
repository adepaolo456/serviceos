import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Route } from './entities/route.entity';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { JobsModule } from '../jobs/jobs.module';
import { CustomersModule } from '../customers/customers.module';
import { CreditAuditModule } from '../credit-audit/credit-audit.module';
import { PermissionModule } from '../permissions/permission.module';
import { DispatchService } from './dispatch.service';
import { DispatchCreditEnforcementService } from './dispatch-credit-enforcement.service';
import { DispatchController } from './dispatch.controller';

@Module({
  imports: [
    // Phase B9 — Invoice is required so DispatchCreditEnforcementService
    // can look up the job's linked invoice in `enforceJobPrepayment`.
    // JobsModule already registers Invoice in its own forFeature list,
    // so both module-scoped instances of the enforcement service can
    // inject InvoiceRepository.
    TypeOrmModule.forFeature([Route, Job, User, Tenant, Invoice]),
    JobsModule,
    CustomersModule,
    CreditAuditModule,
    PermissionModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchCreditEnforcementService],
  exports: [DispatchService, DispatchCreditEnforcementService],
})
export class DispatchModule {}
