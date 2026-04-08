import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { QuotesController } from './quotes.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quote, Tenant, Customer]),
    NotificationsModule,
    TenantSettingsModule,
  ],
  controllers: [QuotesController],
})
export class QuotesModule {}
