import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { TenantId, CurrentUser } from '../../common/decorators';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @ApiOperation({ summary: 'Record a payment' })
  create(@TenantId() tenantId: string, @Body() dto: { invoiceId: string; amount: number; paymentMethod: string; status?: string; notes?: string }) {
    return this.billingService.createPayment(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments' })
  findAll(@TenantId() tenantId: string, @Query() query: { invoiceId?: string; customerId?: string; page?: string; limit?: string }) {
    return this.billingService.findAllPayments(tenantId, {
      invoiceId: query.invoiceId,
      customerId: query.customerId,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
  }
}
