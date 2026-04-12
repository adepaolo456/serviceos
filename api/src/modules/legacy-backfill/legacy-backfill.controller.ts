import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, TenantId } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { LegacyBackfillService } from './legacy-backfill.service';
import {
  ApproveBackfillDto,
  RejectBackfillDto,
} from './dto/legacy-backfill.dto';

/**
 * Phase 12 — Owner-only surface for reviewing and linking legacy
 * standalone jobs into rental chains. All mutations are explicit —
 * nothing auto-links. Existing chains are never overwritten.
 */
@ApiTags('Legacy Backfill')
@ApiBearerAuth()
@Controller('admin/legacy-backfill')
@UseGuards(RolesGuard)
@Roles('owner')
export class LegacyBackfillController {
  constructor(private readonly service: LegacyBackfillService) {}

  @Get('audit')
  @ApiOperation({
    summary:
      'Read-only audit: count chained vs standalone jobs, unlinked exchanges, and candidate chain summary.',
  })
  async audit(@TenantId() tenantId: string) {
    return this.service.getAudit(tenantId);
  }

  @Get('candidates')
  @ApiOperation({
    summary:
      'List candidate chains detected from the tenant\'s standalone jobs. Read-only.',
  })
  async candidates(@TenantId() tenantId: string) {
    return this.service.getCandidates(tenantId);
  }

  @Post('approve')
  @ApiOperation({
    summary:
      'Approve a candidate — creates a rental_chain and task_chain_links in a single transaction after identity + conflict checks.',
  })
  async approve(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: ApproveBackfillDto,
  ) {
    return this.service.approve(tenantId, userId, userEmail, dto.job_ids);
  }

  @Post('reject')
  @ApiOperation({
    summary:
      'Reject a candidate — records the sorted job-id fingerprint so the same candidate does not re-surface.',
  })
  async reject(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: RejectBackfillDto,
  ) {
    return this.service.reject(
      tenantId,
      userId,
      userEmail,
      dto.job_ids,
      dto.reason ?? null,
    );
  }
}
