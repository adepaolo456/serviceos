import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId } from '../../../common/decorators';
import { ClientSurchargeOverride } from '../entities/client-surcharge-override.entity';

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
    });
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: { surcharge_template_id: string; amount: number; available_for_billing?: boolean },
  ) {
    const override = this.repo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      surcharge_template_id: body.surcharge_template_id,
      amount: body.amount,
      available_for_billing: body.available_for_billing ?? true,
    });
    return this.repo.save(override);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount?: number; available_for_billing?: boolean },
  ) {
    await this.repo.update(id, body);
    return this.repo.findOneBy({ id });
  }
}
