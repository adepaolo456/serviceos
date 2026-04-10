import { Controller, Get, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditAnalyticsService } from './credit-analytics.service';
import { PermissionService } from '../permissions/permission.service';

@ApiTags('Credit Analytics')
@ApiBearerAuth()
@Controller('credit-analytics')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditAnalyticsController {
  constructor(
    private readonly analyticsService: CreditAnalyticsService,
    private readonly permissionService: PermissionService,
  ) {}

  private async check(tenantId: string, role: string) {
    if (!(await this.permissionService.hasPermission(tenantId, role, 'credit_analytics_view'))) {
      throw new ForbiddenException('Insufficient permissions for credit analytics');
    }
  }

  @Get('summary')
  @ApiOperation({ summary: 'Credit control summary metrics. Admin/owner only.' })
  async getSummary(@TenantId() tenantId: string, @CurrentUser('role') role: string) {
    await this.check(tenantId, role);
    return this.analyticsService.getSummary(tenantId);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Daily credit event trends (last 30 days). Admin/owner only.' })
  async getTrends(@TenantId() tenantId: string, @CurrentUser('role') role: string) {
    await this.check(tenantId, role);
    return this.analyticsService.getTrends(tenantId);
  }

  @Get('top-customers')
  @ApiOperation({ summary: 'Top 10 customers by credit event count. Admin/owner only.' })
  async getTopCustomers(@TenantId() tenantId: string, @CurrentUser('role') role: string) {
    await this.check(tenantId, role);
    return this.analyticsService.getTopCustomers(tenantId);
  }

  @Get('top-users')
  @ApiOperation({ summary: 'Top 10 users by override count. Admin/owner only.' })
  async getTopUsers(@TenantId() tenantId: string, @CurrentUser('role') role: string) {
    await this.check(tenantId, role);
    return this.analyticsService.getTopUsers(tenantId);
  }
}
