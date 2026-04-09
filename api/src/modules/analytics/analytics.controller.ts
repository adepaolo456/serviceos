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

  @Get('jobs-blocked')
  @ApiOperation({
    summary:
      'Full tenant-scoped list of Blocked jobs for the Jobs page drill-down. Uses the identical shared predicate as jobs-summary.blocked so counts and the list cannot drift. Optional dateFrom/dateTo filter on scheduled_date, matching the existing Jobs page date semantics. Returns enriched job rows (linked_invoice, open_billing_issue_count, chain, dispatch_ready) compatible with the existing /jobs?enrichment=board response shape.',
  })
  getJobsBlocked(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.analyticsService.getJobsBlocked(tenantId, dateFrom, dateTo);
  }
}
