import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportingService } from './reporting.service';
import { TenantId } from '../../common/decorators';

@ApiTags('Reporting')
@ApiBearerAuth()
@Controller('reporting')
export class ReportingController {
  constructor(private readonly service: ReportingService) {}

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue report' })
  revenue(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getRevenue(tid, s, e);
  }

  @Get('dump-costs')
  @ApiOperation({ summary: 'Dump costs report' })
  dumpCosts(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getDumpCosts(tid, s, e);
  }

  @Get('profit')
  @ApiOperation({ summary: 'Profit report' })
  profit(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getProfit(tid, s, e);
  }

  @Get('drivers')
  @ApiOperation({ summary: 'Driver productivity report' })
  drivers(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getDriverProductivity(tid, s, e);
  }

  @Get('assets')
  @ApiOperation({ summary: 'Asset utilization report' })
  assets(@TenantId() tid: string) {
    return this.service.getAssetUtilization(tid);
  }

  @Get('customers')
  @ApiOperation({ summary: 'Customer analytics report' })
  customers(@TenantId() tid: string, @Query('startDate') s?: string, @Query('endDate') e?: string) {
    return this.service.getCustomerAnalytics(tid, s, e);
  }

  @Get('accounts-receivable')
  @ApiOperation({ summary: 'Accounts receivable aging report' })
  receivables(@TenantId() tid: string) {
    return this.service.getAccountsReceivable(tid);
  }
}
