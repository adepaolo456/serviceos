import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import {
  SendNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';
import { TenantId } from '../../common/decorators';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Queue a notification for sending' })
  send(@TenantId() tenantId: string, @Body() dto: SendNotificationDto) {
    return this.notificationsService.send(tenantId, dto);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get notification templates with placeholders' })
  getTemplates() {
    return this.notificationsService.getTemplates();
  }

  @Get()
  @ApiOperation({ summary: 'List notifications with filters' })
  findAll(
    @TenantId() tenantId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.findAll(tenantId, query);
  }
}
