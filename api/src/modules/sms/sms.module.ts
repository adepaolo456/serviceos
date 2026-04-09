import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsMessage } from './sms-message.entity';
import { SmsOptOut } from './sms-opt-out.entity';
import { SmsService } from './sms.service';
import { SmsOptOutService } from './sms-opt-out.service';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SmsMessage, SmsOptOut]),
    TenantSettingsModule,
  ],
  providers: [SmsService, SmsOptOutService],
  exports: [SmsService, SmsOptOutService],
})
export class SmsModule {}
