import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SmsReleaseService } from './sms-release.service';
import { TenantId, CurrentUser } from '../../common/decorators';

/**
 * Tenant-facing endpoints. Tenants CANNOT release a Twilio number directly —
 * they can only request removal. The actual provider release is gated behind
 * the ServiceOS admin endpoints in sms-release-admin.controller.ts.
 */
@ApiTags('SMS Number Release')
@ApiBearerAuth()
@Controller('tenant-settings/sms/release-request')
export class SmsReleaseController {
  constructor(private readonly service: SmsReleaseService) {}

  @Get()
  @ApiOperation({ summary: 'Get current pending + most recent release request for tenant' })
  async getStatus(@TenantId() tenantId: string) {
    return this.service.getTenantStatus(tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Tenant requests removal of their assigned SMS number' })
  async create(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createReleaseRequest(tenantId, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Tenant cancels their own pending release request' })
  async cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.cancelOwnRequest(tenantId, id);
  }
}
