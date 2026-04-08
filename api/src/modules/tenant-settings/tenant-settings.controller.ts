import { Controller, Get, Patch, Body } from '@nestjs/common';
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
import { TenantId } from '../../common/decorators';

@ApiTags('Tenant Settings')
@Controller('tenant-settings')
@ApiBearerAuth()
export class TenantSettingsController {
  constructor(private readonly settingsService: TenantSettingsService) {}

  @Get()
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
    @Body() dto: UpdateNotificationConfigDto,
  ) {
    return this.settingsService.updateNotificationConfig(tenantId, dto);
  }

  @Patch('quotes')
  @ApiOperation({ summary: 'Update quote & follow-up settings' })
  updateQuoteSettings(
    @TenantId() tenantId: string,
    @Body() dto: UpdateQuoteSettingsDto,
  ) {
    return this.settingsService.updateQuoteSettings(tenantId, dto);
  }

  @Patch('quote-templates')
  @ApiOperation({ summary: 'Update quote email/SMS templates' })
  updateQuoteTemplates(
    @TenantId() tenantId: string,
    @Body() dto: UpdateQuoteTemplatesDto,
  ) {
    return this.settingsService.updateQuoteTemplates(tenantId, dto);
  }
}
