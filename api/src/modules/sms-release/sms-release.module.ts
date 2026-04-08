import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsNumberReleaseRequest } from './entities/sms-number-release-request.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { SmsMessage } from '../sms/sms-message.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { SmsReleaseService } from './sms-release.service';
import { SmsReleaseController } from './sms-release.controller';
import { SmsReleaseAdminController } from './sms-release-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SmsNumberReleaseRequest,
      TenantSettings,
      SmsMessage,
      Tenant,
      User,
    ]),
  ],
  controllers: [SmsReleaseController, SmsReleaseAdminController],
  providers: [SmsReleaseService],
  exports: [SmsReleaseService],
})
export class SmsReleaseModule {}
