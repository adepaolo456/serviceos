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
import { SurchargeTemplate } from '../entities/surcharge-template.entity';
import { CreateSurchargeTemplateDto } from '../dto/create-surcharge-template.dto';
import { UpdateSurchargeTemplateDto } from '../dto/update-surcharge-template.dto';

@ApiTags('Surcharge Templates')
@ApiBearerAuth()
@Controller('surcharge-templates')
export class SurchargeTemplateController {
  constructor(
    @InjectRepository(SurchargeTemplate)
    private repo: Repository<SurchargeTemplate>,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.repo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateSurchargeTemplateDto) {
    const template = this.repo.create({
      tenant_id: tenantId,
      name: dto.name,
      default_amount: dto.default_amount,
      is_taxable: dto.is_taxable ?? false,
    });
    return this.repo.save(template);
  }

  @Put(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSurchargeTemplateDto,
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) throw new NotFoundException(`Surcharge template ${id} not found`);
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
    if (!existing) throw new NotFoundException(`Surcharge template ${id} not found`);
    existing.is_active = false;
    await this.repo.save(existing);
    return { deleted: true };
  }
}
