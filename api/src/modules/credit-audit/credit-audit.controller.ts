import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditAuditService } from './credit-audit.service';
import { PermissionService } from '../permissions/permission.service';

@ApiTags('Credit Audit')
@ApiBearerAuth()
@Controller('credit-audit')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditAuditController {
  constructor(
    private readonly auditService: CreditAuditService,
    private readonly permissionService: PermissionService,
  ) {}

  @Get('events')
  @ApiOperation({
    summary:
      'Paginated credit audit events. Admin/owner only. Tenant-scoped.',
  })
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Query()
    query: {
      eventType?: string;
      userId?: string;
      customerId?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    },
  ) {
    if (!(await this.permissionService.hasPermission(tenantId, userRole, 'credit_audit_view'))) {
      throw new ForbiddenException('Insufficient permissions for credit audit view');
    }
    return this.auditService.findAll(tenantId, {
      eventType: query.eventType,
      userId: query.userId,
      customerId: query.customerId,
      from: query.from,
      to: query.to,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }
}
