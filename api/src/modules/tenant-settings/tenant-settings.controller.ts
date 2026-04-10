import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantSettingsService } from './tenant-settings.service';
import {
  UpdateTenantSettingsDto,
  UpdateBrandingDto,
  UpdateOperationsDto,
  UpdateNotificationConfigDto,
  UpdateQuoteSettingsDto,
  UpdateQuoteTemplatesDto,
} from './dto/tenant-settings.dto';
import { UpdateCreditPolicyDto } from './dto/credit-policy.dto';
import { TenantId, Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Tenant Settings')
@Controller('tenant-settings')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('admin', 'owner')
export class TenantSettingsController {
  constructor(private readonly settingsService: TenantSettingsService) {}

  @Get()
  @Roles('dispatcher', 'admin', 'owner')
  @ApiOperation({ summary: 'Get tenant settings' })
  getSettings(@TenantId() tenantId: string) {
    return this.settingsService.getSettings(tenantId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update tenant settings (partial)' })
  updateSettings(
    @TenantId() tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.settingsService.updateSettings(tenantId, dto);
  }

  @Patch('branding')
  @ApiOperation({ summary: 'Update branding settings' })
  updateBranding(
    @TenantId() tenantId: string,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.settingsService.updateBranding(tenantId, dto);
  }

  @Patch('operations')
  @ApiOperation({ summary: 'Update operations settings' })
  updateOperations(
    @TenantId() tenantId: string,
    @Body() dto: UpdateOperationsDto,
  ) {
    return this.settingsService.updateOperations(tenantId, dto);
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Update notification config' })
  updateNotificationConfig(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: UpdateNotificationConfigDto,
  ) {
    return this.settingsService.updateNotificationConfig(tenantId, dto, userRole);
  }

  @Patch('quotes')
  @ApiOperation({ summary: 'Update quote & follow-up settings' })
  updateQuoteSettings(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: UpdateQuoteSettingsDto,
  ) {
    return this.settingsService.updateQuoteSettings(tenantId, dto, userRole);
  }

  @Post('sms/provision-number')
  @Roles('owner')
  @ApiOperation({ summary: 'Auto-provision an SMS number for the tenant' })
  provisionSmsNumber(@TenantId() tenantId: string) {
    return this.settingsService.provisionSmsNumber(tenantId);
  }

  @Patch('quote-templates')
  @ApiOperation({ summary: 'Update quote email/SMS templates' })
  updateQuoteTemplates(
    @TenantId() tenantId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: UpdateQuoteTemplatesDto,
  ) {
    return this.settingsService.updateQuoteTemplates(tenantId, dto, userRole);
  }

  /* ─── Phase 2: tenant credit policy ─────────────────────────── */
  // Storage lives in tenants.settings.credit_policy (JSONB on the
  // tenants table) per Phase 1 documentation. The service loads
  // the Tenant entity, mutates the JSONB key, and saves.

  @Get('credit-policy')
  @Roles('dispatcher', 'admin', 'owner')
  @ApiOperation({
    summary:
      'Read the tenant credit policy stored in tenants.settings.credit_policy. Returns an empty object when not configured.',
  })
  getCreditPolicy(@TenantId() tenantId: string) {
    return this.settingsService.getCreditPolicySettings(tenantId);
  }

  @Patch('credit-policy')
  @ApiOperation({
    summary:
      'Update the tenant credit policy. Partial — only fields present in the body are merged. Admin/owner only via the controller-level RolesGuard.',
  })
  updateCreditPolicy(
    @TenantId() tenantId: string,
    @Body() dto: UpdateCreditPolicyDto,
  ) {
    return this.settingsService.updateCreditPolicy(tenantId, dto);
  }
}
