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

@ApiTags('Onboarding')
@Controller('onboarding')
@ApiBearerAuth()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('checklist')
  @ApiOperation({ summary: 'Get onboarding checklist with derived status' })
  getChecklist(@TenantId() tenantId: string) {
    return this.onboardingService.getChecklist(tenantId);
  }

  @Patch('checklist/:stepKey')
  @ApiOperation({ summary: 'Update a checklist step status' })
  updateChecklistStep(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('stepKey') stepKey: string,
    @Body() dto: UpdateChecklistStepDto,
  ) {
    return this.onboardingService.updateChecklistStep(
      tenantId,
      stepKey,
      dto.status,
      userId,
    );
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get onboarding progress summary' })
  getProgress(@TenantId() tenantId: string) {
    return this.onboardingService.getOnboardingProgress(tenantId);
  }

  @Post('reset')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset onboarding checklist (admin only)' })
  resetChecklist(@TenantId() tenantId: string) {
    return this.onboardingService.resetChecklist(tenantId);
  }
}
