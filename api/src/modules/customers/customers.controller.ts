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
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ListCustomersQueryDto,
} from './dto/customer.dto';
import { TenantId, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly dashboardService: CustomerDashboardService,
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

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.remove(tenantId, id);
  }
}
