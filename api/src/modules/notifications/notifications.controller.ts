import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { NotificationsService } from './notifications.service';
import {
  SendNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';
import { TestNotificationDto } from './dto/test-notification.dto';
import { DispatchNotificationDto } from './dto/dispatch-notification.dto';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { checkRateLimit } from '../../common/rate-limiter';
import { normalizePhone } from '../../common/utils/phone';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  @Post('send')
  send(@TenantId() tenantId: string, @Body() dto: SendNotificationDto) {
    return this.notificationsService.send(tenantId, dto);
  }

  @Post('process')
  async process(@TenantId() tenantId: string) {
    const count = await this.notificationsService.processQueuedNotifications(tenantId);
    return { message: `${count} notification(s) processed`, count };
  }

  @Get('templates')
  getTemplates() {
    return this.notificationsService.getTemplates();
  }

  @Get()
  @Roles('admin', 'owner', 'dispatcher')
  findAll(@TenantId() tenantId: string, @Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.findAll(tenantId, query);
  }

  @Get('log/summary')
  @Roles('admin', 'owner', 'dispatcher')
  getLogSummary(@TenantId() tenantId: string) {
    return this.notificationsService.getLogSummary(tenantId);
  }

  @Get('preferences')
  @Roles('admin', 'owner', 'dispatcher')
  getPreferences(@TenantId() tenantId: string) {
    return this.notificationsService.getPreferences(tenantId);
  }

  @Put('preferences/:type')
  updatePreference(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Param('type') type: string,
    @Body() body: { email_enabled?: boolean; sms_enabled?: boolean },
  ) {
    // Field-level gating: only owner may mutate SMS preferences
    if (body.sms_enabled !== undefined && userRole !== 'owner') {
      throw new ForbiddenException('Only the account owner can modify SMS preferences');
    }
    return this.notificationsService.updatePreference(tenantId, type, body);
  }

  @Post('dispatch')
  async dispatch(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: DispatchNotificationDto,
  ) {
    const limitCheck = await checkRateLimit(
      this.dataSource,
      `${tenantId}:${userId}:notifications-dispatch`,
      '/notifications/dispatch',
      10,
      60,
      'email',
    );
    if (!limitCheck.allowed) {
      throw new HttpException(
        { error: 'Rate limit exceeded for /notifications/dispatch (10/hour)' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!body.emailBody && !body.smsBody) {
      throw new BadRequestException('Must provide emailBody or smsBody');
    }

    this.logger.log(`Dispatch notification by user=${userId} type=${body.notificationType} customer=${body.customerId}`);

    return this.notificationsService.dispatch({
      tenantId,
      customerId: body.customerId,
      notificationType: body.notificationType,
      subject: body.subject,
      emailBody: body.emailBody,
      smsBody: body.smsBody,
      jobId: body.jobId,
      invoiceId: body.invoiceId,
      forceSend: true,
    });
  }

  @Post('test')
  async testNotification(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() body: TestNotificationDto,
  ) {
    // Field-level gating: only owner may send test SMS
    if (body.phone && userRole !== 'owner') {
      throw new ForbiddenException('Only the account owner can send test SMS messages');
    }

    const limitCheck = await checkRateLimit(
      this.dataSource,
      `${tenantId}:${userId}:notifications-test`,
      '/notifications/test',
      10,
      60,
      'email',
    );
    if (!limitCheck.allowed) {
      throw new HttpException(
        { error: 'Rate limit exceeded for /notifications/test (10/hour)' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!body.email && !body.phone) {
      throw new BadRequestException('Must provide email or phone');
    }

    const results: any = {};
    if (body.email) {
      const notif = await this.notificationsService.send(tenantId, {
        channel: 'email',
        type: 'test',
        recipient: body.email,
        subject: 'ServiceOS Test Notification',
        body: '<h2>Test Email</h2><p>This is a test notification from ServiceOS. If you received this, email notifications are working correctly.</p>',
      });
      results.email = { status: notif.status, id: notif.external_id };
    }
    if (body.phone) {
      const normalized = normalizePhone(body.phone);
      if (!normalized) {
        throw new BadRequestException('Invalid phone number format');
      }
      const notif = await this.notificationsService.send(tenantId, {
        channel: 'sms',
        type: 'test',
        recipient: normalized,
        body: 'ServiceOS Test: SMS notifications are working correctly.',
      });
      results.sms = { status: notif.status, id: notif.external_id };
    }

    this.logger.log(`Test notification by user=${userId} recipient=${body.email || body.phone}`);
    return results;
  }
}
