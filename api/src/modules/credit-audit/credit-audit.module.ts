import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditAuditService } from './credit-audit.service';
import { CreditAuditController } from './credit-audit.controller';
import { CreditAnalyticsService } from './credit-analytics.service';
import { CreditAnalyticsController } from './credit-analytics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CreditAuditEvent, Customer])],
  controllers: [CreditAuditController, CreditAnalyticsController],
  providers: [CreditAuditService, CreditAnalyticsService],
  exports: [CreditAuditService],
})
export class CreditAuditModule {}
