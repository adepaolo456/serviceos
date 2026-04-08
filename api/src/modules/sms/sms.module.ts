import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsMessage } from './sms-message.entity';
import { SmsService } from './sms.service';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SmsMessage]),
    TenantSettingsModule,
  ],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
