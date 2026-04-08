import { Controller, Get, Post, Put, Body, Query, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import {
  SendNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

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
    @Param('type') type: string,
    @Body() body: { email_enabled?: boolean; sms_enabled?: boolean },
  ) {
    return this.notificationsService.updatePreference(tenantId, type, body);
  }

  @Post('dispatch')
  dispatch(
    @TenantId() tenantId: string,
    @Body() body: { customerId: string; notificationType: string; subject?: string; emailBody?: string; smsBody?: string; jobId?: string; invoiceId?: string },
  ) {
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
    @Body() body: { email?: string; phone?: string; type?: string },
  ) {
    const results: any = {};
    if (body.email) {
      const notif = await this.notificationsService.send(tenantId, {
        channel: 'email',
        type: body.type || 'test',
        recipient: body.email,
        subject: 'ServiceOS Test Notification',
        body: '<h2>Test Email</h2><p>This is a test notification from ServiceOS. If you received this, email notifications are working correctly.</p>',
      });
      results.email = { status: notif.status, id: notif.external_id };
    }
    if (body.phone) {
      const notif = await this.notificationsService.send(tenantId, {
        channel: 'sms',
        type: body.type || 'test',
        recipient: body.phone,
        body: 'ServiceOS Test: SMS notifications are working correctly.',
      });
      results.sms = { status: notif.status, id: notif.external_id };
    }
    return results;
  }
}
