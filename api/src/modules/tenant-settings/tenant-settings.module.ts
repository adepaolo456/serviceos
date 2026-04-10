import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './entities/tenant-settings.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreditAuditModule } from '../credit-audit/credit-audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantSettings, Tenant]),
    CreditAuditModule,
  ],
  controllers: [TenantSettingsController],
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class TenantSettingsModule {}
