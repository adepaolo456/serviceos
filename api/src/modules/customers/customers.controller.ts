import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CustomerDashboardService } from './customer-dashboard.service';
import { CustomerCreditService } from './services/customer-credit.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ListCustomersQueryDto,
} from './dto/customer.dto';
import {
  UpdateCustomerCreditSettingsDto,
  SetCustomerCreditHoldDto,
} from './dto/customer-credit.dto';
import { TenantId, Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly dashboardService: CustomerDashboardService,
    private readonly creditService: CustomerCreditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new customer' })
  create(@TenantId() tenantId: string, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List customers with search and pagination' })
  findAll(@TenantId() tenantId: string, @Query() query: ListCustomersQueryDto) {
    return this.customersService.findAll(tenantId, query);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search customers by name or company' })
  search(
    @TenantId() tenantId: string,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.search(tenantId, q, limit ? parseInt(limit, 10) : 5);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by ID' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(tenantId, id, dto);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get customer balance' })
  getBalance(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.getCustomerBalance(tenantId, id);
  }

  @Get(':id/dashboard')
  @ApiOperation({
    summary: 'Aggregated customer dashboard payload (one round trip)',
  })
  getDashboard(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dashboardService.getCustomerDashboard(tenantId, id);
  }

  /* ─── Phase 2: customer credit / accounting state ─────────── */
  // Read endpoint — computes the full per-customer accounting state
  // (open AR, past-due, credit limit, payment terms, hold reasons)
  // in a single round trip via CustomerCreditService. No mutation.
  // Phase 2 has zero existing consumers; future phases will read this.

  @Get(':id/credit-state')
  @ApiOperation({
    summary:
      'Compute the full credit / AR / hold state for a customer. Read-only. Single round trip via CustomerCreditService. Phase 2 of the credit-control redesign.',
  })
  getCreditState(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.creditService.getCustomerCreditState(tenantId, id);
  }

  @Patch(':id/credit-settings')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @ApiOperation({
    summary:
      'Update customer-level payment_terms and/or credit_limit. Pass null to clear an override and fall back to the tenant default. Admin/owner only.',
  })
  updateCreditSettings(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerCreditSettingsDto,
  ) {
    return this.creditService.updateCreditSettings(tenantId, id, {
      payment_terms: dto.payment_terms,
      credit_limit: dto.credit_limit,
    }, userId);
  }

  @Post(':id/credit-hold')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @ApiOperation({
    summary:
      'Set the manual credit hold flag with a required reason. Stamps set_by + set_at for audit. Admin/owner only.',
  })
  setCreditHold(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCustomerCreditHoldDto,
  ) {
    return this.creditService.setCreditHold(tenantId, id, userId, dto.reason);
  }

  @Delete(':id/credit-hold')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @ApiOperation({
    summary:
      'Release the manual credit hold. Stamps released_by + released_at while leaving the original set_by/set_at/reason intact for forensic history. Admin/owner only.',
  })
  releaseCreditHold(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.creditService.releaseCreditHold(tenantId, id, userId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.remove(tenantId, id);
  }
}
