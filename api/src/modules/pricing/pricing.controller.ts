import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import {
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
  ListPricingRulesQueryDto,
  CalculatePriceDto,
} from './dto/pricing.dto';
import { TenantId } from '../../common/decorators';

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a pricing rule' })
  create(@TenantId() tenantId: string, @Body() dto: CreatePricingRuleDto) {
    return this.pricingService.create(tenantId, dto);
  }

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate price for a job' })
  calculate(@TenantId() tenantId: string, @Body() dto: CalculatePriceDto) {
    return this.pricingService.calculate(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List pricing rules' })
  findAll(
    @TenantId() tenantId: string,
    @Query() query: ListPricingRulesQueryDto,
  ) {
    return this.pricingService.findAll(tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a pricing rule by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pricingService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a pricing rule' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePricingRuleDto,
  ) {
    return this.pricingService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a pricing rule' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricingService.remove(tenantId, id);
  }

  @Get('pricing-templates')
  @ApiOperation({ summary: 'List pricing templates' })
  listTemplates(@TenantId() tenantId: string) {
    return this.pricingService.listTemplates(tenantId);
  }

  @Post('pricing-templates')
  @ApiOperation({ summary: 'Create pricing template' })
  createTemplate(@TenantId() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.pricingService.createTemplate(tenantId, body);
  }

  @Patch('pricing-templates/:id')
  @ApiOperation({ summary: 'Update pricing template' })
  updateTemplate(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.pricingService.updateTemplate(id, body);
  }

  @Delete('pricing-templates/:id')
  @ApiOperation({ summary: 'Delete pricing template' })
  deleteTemplate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.pricingService.deleteTemplate(id);
  }
}
