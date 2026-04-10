import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards';
import { BillingAuditService } from '../services/billing-audit.service';
import { BulkCleanupScope, BulkCleanupScopeKind } from '../dto/billing-audit.dto';

/**
 * Phase 6 — billing-issues audit endpoints. Admin/owner only.
 *
 * Routes:
 *   GET  /billing-audit/report                     → audit report (read-only)
 *   GET  /billing-audit/cleanup/preview?kind=...   → preview a bulk cleanup
 *   POST /billing-audit/cleanup/execute            → execute a bulk cleanup
 *
 * Every route is gated by the existing RolesGuard with
 * @Roles('admin','owner') so non-admin users cannot trigger audit
 * scans or bulk cleanups. Tenant context comes from the existing
 * @TenantId() decorator — there is no way for an admin to scope a
 * cleanup outside their own tenant.
 */
@ApiTags('Billing Audit')
@ApiBearerAuth()
@Controller('billing-audit')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class BillingAuditController {
  constructor(private readonly auditService: BillingAuditService) {}

  @Get('report')
  @ApiOperation({
    summary:
      'Tenant-scoped audit report of all billing_issues — totals, types, ages, invoice states, eras, headline insights, and deterministic classification summary. Read-only.',
  })
  getReport(@TenantId() tenantId: string) {
    return this.auditService.getAuditReport(tenantId);
  }

  @Get('cleanup/preview')
  @ApiOperation({
    summary:
      'Preview a bulk cleanup action — returns counts and sample IDs without mutating. Operators must call /cleanup/execute with the same scope to actually run.',
  })
  previewCleanup(
    @TenantId() tenantId: string,
    @Query('kind') kind?: string,
    @Query('legacyCutoff') legacyCutoff?: string,
  ) {
    const scope = this.parseScope(kind, legacyCutoff);
    return this.auditService.previewBulkCleanup(tenantId, scope);
  }

  @Post('cleanup/execute')
  @ApiOperation({
    summary:
      'Execute a bulk cleanup. Idempotent. Tenant-scoped. Records resolved_by + audit category. Never touches invoice state. Returns the count of billing_issues rows updated.',
  })
  executeCleanup(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { kind?: string; legacyCutoff?: string; confirm?: boolean },
  ) {
    if (body.confirm !== true) {
      throw new BadRequestException(
        'Bulk cleanup requires explicit confirm:true in the request body. Run /cleanup/preview first to inspect counts.',
      );
    }
    const scope = this.parseScope(body.kind, body.legacyCutoff);
    return this.auditService.executeBulkCleanup(tenantId, userId, scope);
  }

  /**
   * Defensive parsing of the bulk-cleanup scope from query params or
   * request body. Whitelists the discriminated union to prevent
   * arbitrary kinds from reaching the service layer.
   */
  private parseScope(kind: string | undefined, legacyCutoff?: string): BulkCleanupScope {
    const allowed: ReadonlyArray<BulkCleanupScopeKind> = [
      'paid_invoice_payment_issues',
      'zero_balance_payment_issues',
      'completed_unpaid_now_paid',
      'missing_dump_slip_non_dump',
      'legacy_stale_only',
    ];
    if (!kind || !allowed.includes(kind as BulkCleanupScopeKind)) {
      throw new BadRequestException(
        `Bulk cleanup 'kind' is required and must be one of: ${allowed.join(', ')}`,
      );
    }
    return {
      kind: kind as BulkCleanupScopeKind,
      legacy_cutoff: legacyCutoff,
    };
  }
}
