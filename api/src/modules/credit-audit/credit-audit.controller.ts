import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditAuditService } from './credit-audit.service';

@ApiTags('Credit Audit')
@ApiBearerAuth()
@Controller('credit-audit')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditAuditController {
  constructor(private readonly auditService: CreditAuditService) {}

  @Get('events')
  @ApiOperation({
    summary:
      'Paginated credit audit events. Admin/owner only. Tenant-scoped.',
  })
  findAll(
    @TenantId() tenantId: string,
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
