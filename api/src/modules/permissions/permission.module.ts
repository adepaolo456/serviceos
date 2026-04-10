import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { CreditAuditModule } from '../credit-audit/credit-audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), CreditAuditModule],
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
