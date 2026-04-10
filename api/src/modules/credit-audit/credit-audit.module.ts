import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { CreditCollectionEvent } from './credit-collection-event.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditAuditService } from './credit-audit.service';
import { CreditAuditController } from './credit-audit.controller';
import { CreditAnalyticsService } from './credit-analytics.service';
import { CreditAnalyticsController } from './credit-analytics.controller';
import { CreditWorkflowService } from './credit-workflow.service';
import { CreditWorkflowController } from './credit-workflow.controller';
import { CreditCollectionService } from './credit-collection.service';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [TypeOrmModule.forFeature([CreditAuditEvent, CreditCollectionEvent, Customer]), forwardRef(() => PermissionModule)],
  controllers: [CreditAuditController, CreditAnalyticsController, CreditWorkflowController],
  providers: [CreditAuditService, CreditAnalyticsService, CreditWorkflowService, CreditCollectionService],
  exports: [CreditAuditService],
})
export class CreditAuditModule {}
