import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { UpdateChecklistStepDto } from './dto/onboarding.dto';
import { CurrentUser, TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Setup')
@Controller('setup')
@ApiBearerAuth()
export class SetupController {
  constructor(private readonly setupService: OnboardingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get setup status with data-derived completion' })
  getStatus(@TenantId() tenantId: string) {
    return this.setupService.getOnboardingProgress(tenantId);
  }

  @Get('checklist')
  @ApiOperation({ summary: 'Get setup checklist' })
  getChecklist(@TenantId() tenantId: string) {
    return this.setupService.getChecklist(tenantId);
  }

  @Patch('checklist/:stepKey')
  @ApiOperation({ summary: 'Update a setup step status' })
  updateStep(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('stepKey') stepKey: string,
    @Body() dto: UpdateChecklistStepDto,
  ) {
    return this.setupService.updateChecklistStep(
      tenantId,
      stepKey,
      dto.status,
      userId,
    );
  }

  @Post('reset')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset setup checklist (admin only)' })
  resetChecklist(@TenantId() tenantId: string) {
    return this.setupService.resetChecklist(tenantId);
  }
}
