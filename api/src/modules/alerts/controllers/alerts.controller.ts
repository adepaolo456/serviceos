import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards';
import { AlertService } from '../services/alert.service';
import {
  AlertType,
  AlertSeverity,
  AlertEntityType,
} from '../dto/alert.dto';

/**
 * Phase 14 — Alerts / Exceptions API
 *
 * All routes are tenant-scoped via the global JwtAuthGuard +
 * @TenantId() decorator (same pattern as BillingIssueController).
 * RBAC:
 *   - Listing + summary + dismiss: dispatcher and above (default
 *     guard — dispatcher is level 3 in the role hierarchy).
 *   - Resolve: admin and above — this is the "resolve overrides"
 *     capability called out by the spec, used when an owner/admin
 *     wants to force-clear an alert that the detector still sees
 *     as active.
 */
@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
@UseGuards(RolesGuard)
export class AlertsController {
  constructor(private readonly alertService: AlertService) {}

  @Get()
  @Roles('dispatcher')
  list(
    @TenantId() tenantId: string,
    @Query()
    query: {
      severity?: AlertSeverity;
      alert_type?: AlertType;
      entity_type?: AlertEntityType;
      include_resolved?: string | boolean;
    },
  ) {
    return this.alertService.list(tenantId, {
      severity: query.severity,
      alert_type: query.alert_type,
      entity_type: query.entity_type,
      include_resolved:
        query.include_resolved === true ||
        query.include_resolved === 'true',
    });
  }

  @Get('summary')
  @Roles('dispatcher')
  getSummary(@TenantId() tenantId: string) {
    return this.alertService.getSummary(tenantId);
  }

  @Get(':id')
  @Roles('dispatcher')
  getById(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alertService.getById(tenantId, id);
  }

  @Put(':id/dismiss')
  @Roles('dispatcher')
  dismiss(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertService.dismiss(tenantId, id, userId);
  }

  @Put(':id/resolve')
  @Roles('admin')
  resolve(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertService.resolve(tenantId, id, userId);
  }
}
