import { Controller, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { GetSuggestionsDto } from './dto/ai.dto';
import { TenantId, CurrentUser } from '../../common/decorators';

@ApiTags('AI')
@Controller('ai')
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('setup-suggestions')
  @ApiOperation({ summary: 'Get AI setup suggestions for a section' })
  getSuggestions(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: GetSuggestionsDto,
  ) {
    return this.aiService.getSetupSuggestions(
      dto.section,
      tenantId,
      userId,
      dto.context,
    );
  }
}
