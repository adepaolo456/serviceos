import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantId, CurrentUser, Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards';
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
    return this.invoiceService.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoiceService.findOne(tenantId, id);
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
  voidInvoice(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.invoiceService.voidInvoice(tenantId, userId, id, dto);
  }

  @Post(':id/send')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'dispatcher')
  send(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { method?: string },
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.invoiceService.sendInvoice(
      tenantId,
      id,
      body.method || 'email',
      userId,
      userRole,
    );
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
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLineItemDto,
  ) {
    return this.invoiceService.addLineItem(tenantId, userId, id, dto);
  }

  @Put(':id/line-items/:lineItemId')
  updateLineItem(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @Body() dto: UpdateLineItemDto,
  ) {
    return this.invoiceService.updateLineItem(tenantId, userId, id, lineItemId, dto);
  }

  @Delete(':id/line-items/:lineItemId')
  removeLineItem(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
  ) {
    return this.invoiceService.removeLineItem(tenantId, userId, id, lineItemId);
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

  @Patch(':id/collections')
  updateCollections(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      lastContactMethod?: string;
      contactNotes?: string;
      promiseToPayDate?: string;
      promiseToPayAmount?: number;
      disputeStatus?: string;
      disputeNotes?: string;
    },
  ) {
    return this.invoiceService.updateCollections(tenantId, id, body);
  }

  @Get('credit-memos/by-customer/:customerId')
  getCustomerCreditMemos(
    @TenantId() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.invoiceService.getCustomerCreditMemos(tenantId, customerId);
  }

  @Get(':id/credit-memos')
  getCreditMemos(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoiceService.getCreditMemos(tenantId, id);
  }

  @Post('find-price')
  findPrice(@TenantId() tenantId: string, @Body() dto: FindPriceDto) {
    return this.invoiceService.findPrice(tenantId, dto);
  }
}
