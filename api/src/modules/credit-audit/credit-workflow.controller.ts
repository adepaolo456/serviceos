import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditWorkflowService } from './credit-workflow.service';

@ApiTags('Credit Workflow')
@ApiBearerAuth()
@Controller('credit-workflow')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditWorkflowController {
  constructor(private readonly workflowService: CreditWorkflowService) {}

  @Get('customers')
  @ApiOperation({
    summary:
      'Credit review queue — customers needing credit-related attention. Admin/owner only.',
  })
  getQueue(
    @TenantId() tenantId: string,
    @Query() query: { page?: string; limit?: string },
  ) {
    return this.workflowService.getQueue(tenantId, {
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }
}
