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
import { SurchargeTemplate } from '../entities/surcharge-template.entity';
import { CreateSurchargeTemplateDto } from '../dto/create-surcharge-template.dto';

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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateSurchargeTemplateDto>,
  ) {
    await this.repo.update(id, body as any);
    return this.repo.findOneBy({ id });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.repo.update(id, { is_active: false });
    return { deleted: true };
  }
}
