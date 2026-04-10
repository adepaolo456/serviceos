import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { CreditAuditService } from './credit-audit.service';
import { CreditAuditController } from './credit-audit.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CreditAuditEvent])],
  controllers: [CreditAuditController],
  providers: [CreditAuditService],
  exports: [CreditAuditService],
})
export class CreditAuditModule {}
