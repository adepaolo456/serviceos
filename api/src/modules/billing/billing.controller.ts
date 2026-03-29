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
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  ListInvoicesQueryDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
} from './dto/billing.dto';
import { TenantId } from '../../common/decorators';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @ApiOperation({ summary: 'Create an invoice' })
  create(@TenantId() tenantId: string, @Body() dto: CreateInvoiceDto) {
    return this.billingService.createInvoice(tenantId, dto);
  }

  @Post('from-job/:jobId')
  @ApiOperation({ summary: 'Auto-generate invoice from a completed job' })
  createFromJob(
    @TenantId() tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.billingService.createFromJob(tenantId, jobId);
  }

  @Get()
  @ApiOperation({ summary: 'List invoices with filters' })
  findAll(@TenantId() tenantId: string, @Query() query: ListInvoicesQueryDto) {
    return this.billingService.findAllInvoices(tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billingService.findOneInvoice(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an invoice' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.billingService.updateInvoice(tenantId, id, dto);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Mark invoice as sent' })
  send(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.sendInvoice(tenantId, id);
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @ApiOperation({ summary: 'Record a payment' })
  create(@TenantId() tenantId: string, @Body() dto: CreatePaymentDto) {
    return this.billingService.createPayment(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments' })
  findAll(@TenantId() tenantId: string, @Query() query: ListPaymentsQueryDto) {
    return this.billingService.findAllPayments(tenantId, query);
  }
}
