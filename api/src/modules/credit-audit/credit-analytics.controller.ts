import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditAnalyticsService } from './credit-analytics.service';

@ApiTags('Credit Analytics')
@ApiBearerAuth()
@Controller('credit-analytics')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditAnalyticsController {
  constructor(private readonly analyticsService: CreditAnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Credit control summary metrics. Admin/owner only.' })
  getSummary(@TenantId() tenantId: string) {
    return this.analyticsService.getSummary(tenantId);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Daily credit event trends (last 30 days). Admin/owner only.' })
  getTrends(@TenantId() tenantId: string) {
    return this.analyticsService.getTrends(tenantId);
  }

  @Get('top-customers')
  @ApiOperation({ summary: 'Top 10 customers by credit event count. Admin/owner only.' })
  getTopCustomers(@TenantId() tenantId: string) {
    return this.analyticsService.getTopCustomers(tenantId);
  }

  @Get('top-users')
  @ApiOperation({ summary: 'Top 10 users by override count. Admin/owner only.' })
  getTopUsers(@TenantId() tenantId: string) {
    return this.analyticsService.getTopUsers(tenantId);
  }
}
