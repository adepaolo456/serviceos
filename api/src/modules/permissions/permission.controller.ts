import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { PermissionService, TeamPermissions } from './permission.service';
import { CreditAuditService } from '../credit-audit/credit-audit.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionController {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly auditService: CreditAuditService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get resolved permissions for the current user.' })
  getMyPermissions(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.permissionService.getPermissions(tenantId, userRole);
  }

  @Get('config')
  @UseGuards(RolesGuard)
  @Roles('owner')
  @ApiOperation({ summary: 'Get full team permissions config. Owner only.' })
  async getConfig(@TenantId() tenantId: string) {
    // Return resolved config for all configurable roles
    const [admin, dispatcher, office] = await Promise.all([
      this.permissionService.getPermissions(tenantId, 'admin'),
      this.permissionService.getPermissions(tenantId, 'dispatcher'),
      this.permissionService.getPermissions(tenantId, 'office'),
    ]);
    return { admin, dispatcher, office };
  }

  @Patch('config')
  @UseGuards(RolesGuard)
  @Roles('owner')
  @ApiOperation({ summary: 'Update team permissions config. Owner only.' })
  async updateConfig(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: Partial<TeamPermissions>,
  ) {
    const result = await this.permissionService.updatePermissions(tenantId, body);
    this.auditService.record({
      tenantId,
      eventType: 'team_permissions_updated' as any,
      userId,
      metadata: { changed_roles: Object.keys(body) },
    });
    return result;
  }
}
