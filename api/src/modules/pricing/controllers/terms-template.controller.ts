import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId } from '../../../common/decorators';
import { TermsTemplate } from '../entities/terms-template.entity';
import { CreateTermsTemplateDto } from '../dto/create-terms-template.dto';

@ApiTags('Terms Templates')
@ApiBearerAuth()
@Controller('terms-templates')
export class TermsTemplateController {
  constructor(
    @InjectRepository(TermsTemplate)
    private repo: Repository<TermsTemplate>,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.repo.find({
      where: { tenant_id: tenantId },
      order: { name: 'ASC' },
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateTermsTemplateDto>,
  ) {
    await this.repo.update(id, body as any);
    return this.repo.findOneBy({ id });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.repo.delete(id);
    return { deleted: true };
  }

  @Post(':id/render')
  async render(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: Record<string, any>,
  ) {
    const template = await this.repo.findOneBy({ id });
    if (!template) return { rendered: '' };

    let text = template.template_body;
    for (const [key, value] of Object.entries(data)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
    return { rendered: text };
  }
}
