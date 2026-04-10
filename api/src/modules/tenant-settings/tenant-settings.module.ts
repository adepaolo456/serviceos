import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './entities/tenant-settings.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

@Module({
  // Phase 2 — Tenant entity registered alongside TenantSettings so
  // the new credit-policy methods can load/update the JSONB settings
  // column on the tenants table.
  imports: [TypeOrmModule.forFeature([TenantSettings, Tenant])],
  controllers: [TenantSettingsController],
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class TenantSettingsModule {}
