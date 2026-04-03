import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantFee } from '../entities/tenant-fee.entity';
import { TenantId } from '../../../common/decorators';

@ApiTags('Tenant Fees')
@ApiBearerAuth()
@Controller('tenant-fees')
export class TenantFeeController {
  constructor(
    @InjectRepository(TenantFee)
    private feeRepo: Repository<TenantFee>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active fees for tenant' })
  async list(@TenantId() tenantId: string) {
    return this.feeRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { fee_key: 'ASC' },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom tenant fee' })
  async create(
    @TenantId() tenantId: string,
    @Body() body: { fee_key: string; label: string; amount: number; is_percentage?: boolean; applies_to?: string },
  ) {
    const fee = this.feeRepo.create({
      tenant_id: tenantId,
      fee_key: body.fee_key,
      label: body.label,
      amount: body.amount,
      is_percentage: body.is_percentage ?? false,
      applies_to: body.applies_to ?? 'all',
    });
    return this.feeRepo.save(fee);
  }

  @Patch(':feeKey')
  @ApiOperation({ summary: 'Update a tenant fee by fee_key' })
  async update(
    @TenantId() tenantId: string,
    @Param('feeKey') feeKey: string,
    @Body() body: { amount?: number; label?: string; is_active?: boolean; is_percentage?: boolean; applies_to?: string },
  ) {
    const fee = await this.feeRepo.findOne({
      where: { tenant_id: tenantId, fee_key: feeKey },
    });
    if (!fee) {
      // Auto-create if not found (convenience for seeded keys)
      return this.feeRepo.save(this.feeRepo.create({
        tenant_id: tenantId,
        fee_key: feeKey,
        label: body.label || feeKey.replace(/_/g, ' '),
        amount: body.amount ?? 0,
        is_percentage: body.is_percentage ?? false,
        is_active: body.is_active ?? true,
        applies_to: body.applies_to ?? 'all',
      }));
    }
    if (body.amount !== undefined) fee.amount = body.amount;
    if (body.label !== undefined) fee.label = body.label;
    if (body.is_active !== undefined) fee.is_active = body.is_active;
    if (body.is_percentage !== undefined) fee.is_percentage = body.is_percentage;
    if (body.applies_to !== undefined) fee.applies_to = body.applies_to;
    return this.feeRepo.save(fee);
  }
}
