import { Controller, Get, Query, UseGuards, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditWorkflowService } from './credit-workflow.service';
import { PermissionService } from '../permissions/permission.service';

@ApiTags('Credit Workflow')
@ApiBearerAuth()
@Controller('credit-workflow')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditWorkflowController {
  constructor(
    private readonly workflowService: CreditWorkflowService,
    @Inject(forwardRef(() => PermissionService))
    private readonly permissionService: PermissionService,
  ) {}

  @Get('customers')
  @ApiOperation({
    summary:
      'Credit review queue — customers needing credit-related attention. Admin/owner only.',
  })
  async getQueue(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: { page?: string; limit?: string },
  ) {
    if (!(await this.permissionService.hasPermission(tenantId, userRole, 'credit_queue_manage'))) {
      throw new ForbiddenException('Insufficient permissions for credit queue');
    }
    return this.workflowService.getQueue(tenantId, {
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }
}
