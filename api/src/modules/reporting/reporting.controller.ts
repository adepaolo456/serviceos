import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportingService } from './reporting.service';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { ProfitResponseDto } from './dto/profit-response.dto';
import { AssetsResponseDto } from './dto/assets-response.dto';
import { CustomersResponseDto } from './dto/customers-response.dto';

@ApiTags('Reporting')
@ApiBearerAuth()
@Controller('reporting')
export class ReportingController {
  constructor(private readonly service: ReportingService) {}

  @Get('revenue/source-detail')
  @ApiOperation({ summary: 'Invoice-level detail for a revenue source' })
  revenueSourceDetail(
    @TenantId() tid: string,
    @Query('source') source: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
  ) {
    return this.service.getRevenueBySourceDetail(tid, source, s, e);
  }

  @Get('revenue/daily-detail')
  @ApiOperation({ summary: 'Invoice-level detail for a single day' })
  revenueDailyDetail(
    @TenantId() tid: string,
    @Query('date') date: string,
  ) {
    return this.service.getRevenueByDailyDetail(tid, date);
  }

  @Get('revenue/invoices')
  @ApiOperation({ summary: 'Filtered invoice list for revenue tiles' })
  revenueInvoices(
    @TenantId() tid: string,
    @Query('filter') filter: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
  ) {
    return this.service.getRevenueInvoices(tid, filter, s, e);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue report' })
  revenue(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string, @Query('grouping') g?: string) {
    return this.service.getRevenue(tid, s, e, g);
  }

  @Get('lifecycle')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'dispatcher')
  @ApiOperation({
    summary:
      'Phase 13 — lifecycle-aware KPI report. Returns summary, per-chain rows, and zero-filled trend series in a single call. Reuses the same financial truth (invoices.rental_chain_id + job_costs via task_chain_links) as the lifecycle detail endpoint.',
  })
  lifecycleReport(
    @TenantId() tid: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
    @Query('status') status?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const normalizedStatus =
      status === 'active' || status === 'completed' ? status : 'all';
    const normalizedGroupBy =
      groupBy === 'day' || groupBy === 'week' || groupBy === 'month'
        ? groupBy
        : 'month';
    return this.service.getLifecycleReport(
      tid,
      s,
      e,
      normalizedStatus,
      normalizedGroupBy,
    );
  }

  @Get('dump-costs')
  @ApiOperation({ summary: 'Dump costs report' })
  dumpCosts(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getDumpCosts(tid, s, e);
  }

  @Get('dump-slips')
  @ApiOperation({ summary: 'Dump slip ticket-level report' })
  dumpSlips(
    @TenantId() tid: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
    @Query('dumpLocationId') loc?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getDumpSlips(tid, s, e, loc, search, status);
  }

  @Get('profit')
  @ApiOperation({ summary: 'Profit report' })
  profit(
    @TenantId() tid: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
  ): Promise<ProfitResponseDto> {
    return this.service.getProfit(tid, s, e);
  }

  @Get('drivers')
  @ApiOperation({ summary: 'Driver productivity report' })
  drivers(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getDriverProductivity(tid, s, e);
  }

  @Get('assets')
  @ApiOperation({ summary: 'Asset utilization report' })
  assets(@TenantId() tid: string): Promise<AssetsResponseDto> {
    return this.service.getAssetUtilization(tid);
  }

  @Get('customers')
  @ApiOperation({ summary: 'Customer analytics report' })
  customers(
    @TenantId() tid: string,
    @Query('startDate') s?: string,
    @Query('endDate') e?: string,
  ): Promise<CustomersResponseDto> {
    return this.service.getCustomerAnalytics(tid, s, e);
  }

  @Get('accounts-receivable')
  @ApiOperation({ summary: 'Accounts receivable aging report' })
  receivables(@TenantId() tid: string) {
    return this.service.getAccountsReceivable(tid);
  }

  @Get('integrity-check')
  @ApiOperation({ summary: 'Data integrity check' })
  integrityCheck(@TenantId() tid: string) {
    return this.service.getIntegrityCheck(tid);
  }

  @Get('revenue-breakdown')
  @ApiOperation({ summary: 'Revenue breakdown by line type' })
  revenueBreakdown(@TenantId() tid: string, @Query('period') period?: string, @Query('classification') classification?: string) {
    return this.service.getRevenueBreakdown(tid, period, classification);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Admin alerts from live data' })
  getAlerts(@TenantId() tid: string) {
    return this.service.getAlerts(tid);
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Operational and billing exceptions' })
  exceptions(@TenantId() tid: string) {
    return this.service.getExceptions(tid);
  }

  @Get('daily-summary')
  @ApiOperation({ summary: 'Daily operational summary' })
  dailySummary(@TenantId() tid: string) {
    return this.service.getDailySummary(tid);
  }

  @Get('invoices/export')
  @ApiOperation({ summary: 'Export invoices as CSV' })
  async exportInvoices(
    @TenantId() tid: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Res() res?: any,
  ) {
    const csv = await this.service.getInvoicesCsv(tid, status, from, to);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
    res.send(csv);
  }
}
