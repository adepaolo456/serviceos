import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditAuditService } from './credit-audit.service';
import { CreditAuditController } from './credit-audit.controller';
import { CreditAnalyticsService } from './credit-analytics.service';
import { CreditAnalyticsController } from './credit-analytics.controller';
import { CreditWorkflowService } from './credit-workflow.service';
import { CreditWorkflowController } from './credit-workflow.controller';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [TypeOrmModule.forFeature([CreditAuditEvent, Customer]), forwardRef(() => PermissionModule)],
  controllers: [CreditAuditController, CreditAnalyticsController, CreditWorkflowController],
  providers: [CreditAuditService, CreditAnalyticsService, CreditWorkflowService],
  exports: [CreditAuditService],
})
export class CreditAuditModule {}
