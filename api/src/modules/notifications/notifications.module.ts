import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { ClientNotificationOverride } from './entities/client-notification-override.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TwilioService } from './services/twilio.service';
import { ResendEmailService } from './services/resend.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      ClientNotificationOverride,
      ScheduledNotification,
      Customer,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, TwilioService, ResendEmailService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
