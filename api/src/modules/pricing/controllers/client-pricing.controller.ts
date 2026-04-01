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
import { ClientPricingOverride } from '../entities/client-pricing-override.entity';
import { CreateClientPricingOverrideDto } from '../dto/create-client-pricing-override.dto';
import { UpdateClientPricingOverrideDto } from '../dto/update-client-pricing-override.dto';

@ApiTags('Client Pricing Overrides')
@ApiBearerAuth()
@Controller('customers/:customerId/pricing-overrides')
export class ClientPricingController {
  constructor(
    @InjectRepository(ClientPricingOverride)
    private repo: Repository<ClientPricingOverride>,
  ) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    const today = new Date().toISOString().split('T')[0];
    return this.repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.pricing_rule', 'pr')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.customer_id = :customerId', { customerId })
      .andWhere('o.effective_from <= :today', { today })
      .andWhere('(o.effective_to IS NULL OR o.effective_to >= :today)', { today })
      .orderBy('o.created_at', 'DESC')
      .getMany();
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateClientPricingOverrideDto,
  ) {
    const override = this.repo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      pricing_rule_id: dto.pricing_rule_id,
      base_price: dto.base_price,
      weight_allowance_tons: dto.weight_allowance_tons,
      overage_per_ton: dto.overage_per_ton,
      daily_overage_rate: dto.daily_overage_rate,
      rental_days: dto.rental_days,
      effective_from: new Date().toISOString().split('T')[0],
    });
    return this.repo.save(override);
  }

  @Put(':id')
  async update(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientPricingOverrideDto,
  ) {
    const existing = await this.repo.findOne({
      where: { id, tenant_id: tenantId, customer_id: customerId },
    });
    if (!existing) throw new NotFoundException(`Pricing override ${id} not found`);
    Object.assign(existing, dto);
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
    if (!existing) throw new NotFoundException(`Pricing override ${id} not found`);
    await this.repo.delete(id);
    return { deleted: true };
  }
}
