import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, TenantId } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { GeocodeBackfillService } from './geocode-backfill.service';

@ApiTags('Geocoding')
@ApiBearerAuth()
@Controller('geocoding')
export class GeocodeBackfillController {
  constructor(private readonly backfillService: GeocodeBackfillService) {}

  @Post('backfill')
  @UseGuards(RolesGuard)
  @Roles('owner')
  @ApiOperation({ summary: 'Backfill missing geocodes for tenant records (admin)' })
  async backfill(
    @TenantId() tenantId: string,
    @Body() body: {
      batch_size?: number;
      dry_run?: boolean;
      include_jobs?: boolean;
      include_customers?: boolean;
      skip_verified?: boolean;
    },
  ) {
    return this.backfillService.backfill({
      tenant_id: tenantId,
      batch_size: body.batch_size,
      dry_run: body.dry_run,
      include_jobs: body.include_jobs,
      include_customers: body.include_customers,
      skip_verified: body.skip_verified,
    });
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'List records needing manual geocode review' })
  async reviewQueue(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.backfillService.getFailedRecords(tenantId, limit ? parseInt(limit, 10) : 50);
  }
}
