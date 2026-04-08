import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../admin/admin.guard';
import { SmsReleaseService } from './sms-release.service';
import { CurrentUser } from '../../common/decorators';

/**
 * ServiceOS admin endpoints — gated by SuperAdminGuard. These are the ONLY
 * endpoints in the system that actually release a number from Twilio.
 */
@ApiTags('Admin — SMS Release Requests')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/sms-release-requests')
export class SmsReleaseAdminController {
  constructor(private readonly service: SmsReleaseService) {}

  @Get()
  @ApiOperation({ summary: 'List SMS number release requests (defaults to all)' })
  async list(@Query('status') status?: string) {
    return this.service.listForAdmin(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail view including tenant + recent SMS activity context' })
  async detail(@Param('id') id: string) {
    return this.service.getDetailForAdmin(id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release the number from Twilio and clear tenant assignment' })
  async release(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
    @Body() body: { notes?: string },
  ) {
    return this.service.releaseAndApprove(id, reviewerId, body?.notes);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject the release request without touching Twilio' })
  async reject(
    @Param('id') id: string,
    @CurrentUser('id') reviewerId: string,
    @Body() body: { notes?: string },
  ) {
    return this.service.reject(id, reviewerId, body?.notes);
  }

  @Post(':id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reconcile a request where Twilio release succeeded but DB cleanup failed',
  })
  async reconcile(@Param('id') id: string) {
    return this.service.reconcile(id);
  }
}
