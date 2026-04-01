import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser } from '../../../common/decorators';
import { InvoiceService } from '../services/invoice.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { UpdateInvoiceDto } from '../dto/update-invoice.dto';
import { CreateLineItemDto } from '../dto/create-line-item.dto';
import { UpdateLineItemDto } from '../dto/update-line-item.dto';
import { ApplyPaymentDto } from '../dto/apply-payment.dto';
import { VoidInvoiceDto } from '../dto/void-invoice.dto';
import { FindPriceDto } from '../dto/find-price.dto';
import { ListInvoicesQueryDto } from '../dto/list-invoices-query.dto';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.createInvoice(tenantId, userId, dto);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: ListInvoicesQueryDto) {
    return this.invoiceService.findAllInvoices(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoiceService.findOneInvoice(tenantId, id);
  }

  @Put(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.updateInvoice(tenantId, userId, id, dto);
  }

  @Post(':id/void')
  void(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.invoiceService.voidInvoice(tenantId, userId, id, dto.reason);
  }

  @Post(':id/send')
  send(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { method?: string },
  ) {
    return this.invoiceService.sendInvoice(tenantId, id, body.method || 'email');
  }

  @Post(':id/duplicate')
  duplicate(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoiceService.duplicateInvoice(tenantId, userId, id);
  }

  @Get(':id/revisions')
  getRevisions(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.getRevisions(id);
  }

  @Post(':id/line-items')
  addLineItem(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLineItemDto,
  ) {
    return this.invoiceService.addLineItem(tenantId, id, dto);
  }

  @Put(':id/line-items/:lineItemId')
  updateLineItem(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @Body() dto: UpdateLineItemDto,
  ) {
    return this.invoiceService.updateLineItem(tenantId, id, lineItemId, dto);
  }

  @Delete(':id/line-items/:lineItemId')
  removeLineItem(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
  ) {
    return this.invoiceService.removeLineItem(tenantId, id, lineItemId);
  }

  @Post(':id/payments')
  applyPayment(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPaymentDto,
  ) {
    return this.invoiceService.applyPayment(tenantId, userId, id, dto);
  }

  @Post('find-price')
  findPrice(@TenantId() tenantId: string, @Body() dto: FindPriceDto) {
    return this.invoiceService.findPrice(tenantId, dto);
  }
}
