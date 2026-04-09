import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { RevenueQueryDto } from './dto/analytics.dto';
import { TenantId } from '../../common/decorators';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard summary stats' })
  getDashboard(@TenantId() tenantId: string) {
    return this.analyticsService.getDashboard(tenantId);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue grouped by day' })
  getRevenue(@TenantId() tenantId: string, @Query() query: RevenueQueryDto) {
    return this.analyticsService.getRevenueByDay(
      tenantId,
      query.startDate,
      query.endDate,
    );
  }

  @Get('jobs-by-status')
  @ApiOperation({ summary: 'Get job counts by status' })
  getJobsByStatus(@TenantId() tenantId: string) {
    return this.analyticsService.getJobsByStatus(tenantId);
  }

  @Get('jobs-by-blocker')
  @ApiOperation({
    summary:
      'Tenant-wide blocker counts for the Jobs page top strip (payment_blocked, billing_issue, unassigned_active)',
  })
  getJobsByBlocker(@TenantId() tenantId: string) {
    return this.analyticsService.getJobsByBlocker(tenantId);
  }

  @Get('jobs-summary')
  @ApiOperation({
    summary:
      'Jobs page top-strip counts (unassigned, assigned, enRoute, completed, blocked). Multi-tenant scoped. Blocked is a computed UI layer, not a stored job status.',
  })
  getJobsSummary(@TenantId() tenantId: string) {
    return this.analyticsService.getJobsSummary(tenantId);
  }
}
