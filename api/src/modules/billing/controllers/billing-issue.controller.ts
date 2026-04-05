import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser } from '../../../common/decorators';
import { BillingIssueDetectorService } from '../services/billing-issue-detector.service';

@ApiTags('Billing Issues')
@ApiBearerAuth()
@Controller('billing-issues')
export class BillingIssueController {
  constructor(private readonly detector: BillingIssueDetectorService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query()
    query: {
      status?: string;
      issueType?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.detector.findAll(tenantId, {
      status: query.status,
      issueType: query.issueType,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }

  @Get('summary')
  getSummary(@TenantId() tenantId: string) {
    return this.detector.getSummary(tenantId);
  }

  @Put(':id/resolve')
  resolve(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { reason?: string; notes?: string },
  ) {
    return this.detector.resolveIssue(tenantId, id, userId, body.reason, body.notes);
  }

  @Put(':id/dismiss')
  dismiss(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.detector.dismissIssue(tenantId, id, userId);
  }

  @Post('detect')
  forceDetect(@TenantId() tenantId: string) {
    return this.detector.detectAllForTenant(tenantId);
  }
}
