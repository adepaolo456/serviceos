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
import { ClientSurchargeOverride } from '../entities/client-surcharge-override.entity';
import { CreateClientSurchargeOverrideDto } from '../dto/create-client-surcharge-override.dto';

@ApiTags('Client Surcharge Overrides')
@ApiBearerAuth()
@Controller('customers/:customerId/surcharge-overrides')
export class ClientSurchargeController {
  constructor(
    @InjectRepository(ClientSurchargeOverride)
    private repo: Repository<ClientSurchargeOverride>,
  ) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.repo.find({
      where: { tenant_id: tenantId, customer_id: customerId },
      relations: ['surcharge_template'],
      order: { created_at: 'DESC' },
    });
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateClientSurchargeOverrideDto,
  ) {
    const override = this.repo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      surcharge_template_id: dto.surcharge_template_id,
      amount: dto.amount,
      available_for_billing: dto.available_for_billing ?? true,
    });
    return this.repo.save(override);
  }

  @Put(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount?: number; available_for_billing?: boolean },
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId, customer_id: customerId },
    });
    if (!existing) throw new NotFoundException(`Surcharge override ${id} not found`);
    if (body.amount !== undefined) existing.amount = body.amount;
    if (body.available_for_billing !== undefined)
      existing.available_for_billing = body.available_for_billing;
    return this.repo.save(existing);
  }

  @Delete(':id')
  async remove(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId, customer_id: customerId },
    });
    if (!existing) throw new NotFoundException(`Surcharge override ${id} not found`);
    await this.repo.delete(id);
    return { deleted: true };
  }
}
