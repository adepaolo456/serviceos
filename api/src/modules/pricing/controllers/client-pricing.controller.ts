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
import { ClientPricingOverride } from '../entities/client-pricing-override.entity';
import { CreateClientPricingOverrideDto } from '../dto/create-client-pricing-override.dto';

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
    return this.repo.find({
      where: { tenant_id: tenantId, customer_id: customerId },
      relations: ['pricing_rule'],
      order: { created_at: 'DESC' },
    });
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateClientPricingOverrideDto>,
  ) {
    await this.repo.update(id, body as any);
    return this.repo.findOneBy({ id });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.repo.delete(id);
    return { deleted: true };
  }
}
