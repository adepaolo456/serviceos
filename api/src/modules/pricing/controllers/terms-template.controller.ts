import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId } from '../../../common/decorators';
import { TermsTemplate } from '../entities/terms-template.entity';
import { CreateTermsTemplateDto } from '../dto/create-terms-template.dto';
import { UpdateTermsTemplateDto } from '../dto/update-terms-template.dto';
import { PriceResolutionService } from '../services/price-resolution.service';

@ApiTags('Terms Templates')
@ApiBearerAuth()
@Controller('terms-templates')
export class TermsTemplateController {
  constructor(
    @InjectRepository(TermsTemplate)
    private repo: Repository<TermsTemplate>,
    private priceResolution: PriceResolutionService,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.repo.find({
      where: { tenant_id: tenantId },
      order: { is_default: 'DESC', name: 'ASC' },
    });
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateTermsTemplateDto) {
    const template = this.repo.create({
      tenant_id: tenantId,
      name: dto.name,
      client_type: dto.client_type,
      template_body: dto.template_body,
      is_default: dto.is_default ?? false,
    });
    return this.repo.save(template);
  }

  @Put(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTermsTemplateDto,
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException(`Terms template ${id} not found`);
    Object.assign(existing, dto);
    return this.repo.save(existing);
  }

  @Delete(':id')
  async remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException(`Terms template ${id} not found`);
    await this.repo.delete(id);
    return { deleted: true };
  }

  @Post(':id/render')
  async render(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { customer_id?: string; dumpster_size?: string; [key: string]: any },
  ) {
    // If customer_id and dumpster_size provided, auto-resolve pricing
    if (body.customer_id && body.dumpster_size) {
      const resolved = await this.priceResolution.resolvePrice(
        tenantId,
        body.customer_id,
        body.dumpster_size,
      );
      const rendered = await this.priceResolution.renderTermsTemplate(id, resolved);
      return { rendered_text: rendered };
    }

    // Otherwise use raw data from body
    const rendered = await this.priceResolution.renderTermsTemplate(id, body);
    return { rendered_text: rendered };
  }
}
