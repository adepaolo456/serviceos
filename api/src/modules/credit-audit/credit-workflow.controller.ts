import { Controller, Get, Post, Query, Body, UseGuards, ForbiddenException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { CreditWorkflowService } from './credit-workflow.service';
import { CreditCollectionService, CollectionEventType } from './credit-collection.service';
import { PermissionService } from '../permissions/permission.service';

@ApiTags('Credit Workflow')
@ApiBearerAuth()
@Controller('credit-workflow')
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class CreditWorkflowController {
  constructor(
    private readonly workflowService: CreditWorkflowService,
    private readonly collectionService: CreditCollectionService,
    @Inject(forwardRef(() => PermissionService))
    private readonly permissionService: PermissionService,
  ) {}

  private async checkQueue(tenantId: string, role: string) {
    if (!(await this.permissionService.hasPermission(tenantId, role, 'credit_queue_manage'))) {
      throw new ForbiddenException('Insufficient permissions for credit queue');
    }
  }

  @Get('customers')
  @ApiOperation({ summary: 'Credit review queue.' })
  async getQueue(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: { page?: string; limit?: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    return this.workflowService.getQueue(tenantId, {
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  /* ── Collection actions ── */

  @Post('reminder')
  @ApiOperation({ summary: 'Log a reminder sent to customer.' })
  async reminder(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() body: { customer_id: string; note?: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    return this.recordAction(tenantId, userId, body.customer_id, 'reminder_sent', body.note);
  }

  @Post('contacted')
  @ApiOperation({ summary: 'Mark customer as contacted.' })
  async contacted(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() body: { customer_id: string; note?: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    return this.recordAction(tenantId, userId, body.customer_id, 'marked_contacted', body.note);
  }

  @Post('note')
  @ApiOperation({ summary: 'Add a collections note for a customer.' })
  async addNote(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() body: { customer_id: string; note: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    if (!body.note?.trim()) throw new BadRequestException('Note is required');
    return this.recordAction(tenantId, userId, body.customer_id, 'note_added', body.note);
  }

  @Post('escalate')
  @ApiOperation({ summary: 'Escalate a customer for review.' })
  async escalate(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() body: { customer_id: string; note?: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    return this.recordAction(tenantId, userId, body.customer_id, 'escalated', body.note);
  }

  /* ── Timeline ── */

  @Get('timeline')
  @ApiOperation({ summary: 'Collections timeline for a customer.' })
  async getTimeline(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Query() query: { customer_id: string; limit?: string },
  ) {
    await this.checkQueue(tenantId, userRole);
    if (!query.customer_id) throw new BadRequestException('customer_id is required');
    return this.collectionService.getTimeline(
      tenantId,
      query.customer_id,
      query.limit ? parseInt(query.limit) : 50,
    );
  }

  private async recordAction(
    tenantId: string, userId: string, customerId: string,
    eventType: CollectionEventType, note?: string,
  ) {
    if (!customerId) throw new BadRequestException('customer_id is required');
    return this.collectionService.recordAction({
      tenantId, customerId, userId, eventType, note,
    });
  }
}
