import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import { TenantId, Public } from '../../common/decorators';

@ApiTags('Automation')
@ApiBearerAuth()
@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get('overdue')
  @ApiOperation({ summary: 'Get overdue jobs for the tenant' })
  getOverdue(@TenantId() tenantId: string) {
    return this.automationService.getOverdueJobs(tenantId);
  }

  @Post('overdue/scan')
  @ApiOperation({ summary: 'Manually trigger overdue scan' })
  scanOverdue(@TenantId() tenantId: string) {
    return this.automationService.scanOverdueRentals(tenantId);
  }

  @Post('overdue/:jobId/notify')
  @ApiOperation({ summary: 'Send overdue notification for a job' })
  notifyOverdue(@TenantId() tenantId: string, @Param('jobId') jobId: string) {
    return this.automationService.sendOverdueNotification(tenantId, jobId);
  }

  @Post('overdue/:jobId/action')
  @ApiOperation({ summary: 'Take action on an overdue job' })
  actionOverdue(
    @TenantId() tenantId: string,
    @Param('jobId') jobId: string,
    @Body() body: { action: string; days?: number },
  ) {
    return this.automationService.acknowledgeOverdue(tenantId, jobId, body.action, body.days);
  }

  @Post('send-overdue-reminders')
  @ApiOperation({ summary: 'Send reminder emails for overdue invoices' })
  sendOverdueReminders(@TenantId() tenantId: string) {
    return this.automationService.sendOverdueReminders(tenantId);
  }

  @Get('log')
  @ApiOperation({ summary: 'Get automation log' })
  getLog(@TenantId() tenantId: string) {
    return this.automationService.getLog(tenantId);
  }

  @Public()
  @Get('cron/overdue-scan')
  @ApiOperation({ summary: 'Cron: scan all tenants for overdue rentals' })
  async cronOverdueScan(@Query('secret') secret: string) {
    if (secret !== 'SERVICEOS_CRON_SECRET_2026') {
      return { error: 'Unauthorized' };
    }
    return this.automationService.scanOverdueRentals();
  }
}
