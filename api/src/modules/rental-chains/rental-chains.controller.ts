import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { TenantId } from '../../common/decorators';
import { RentalChainsService } from './rental-chains.service';
import { CreateRentalChainDto } from './dto/create-rental-chain.dto';
import { UpdateRentalChainDto } from './dto/update-rental-chain.dto';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { RescheduleExchangeDto } from './dto/reschedule-exchange.dto';
import { RentalChainLifecycleResponseDto } from './dto/lifecycle-response.dto';

@ApiTags('Rental Chains')
@ApiBearerAuth()
@Controller('rental-chains')
export class RentalChainsController {
  constructor(private readonly service: RentalChainsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(tenantId, { customerId, status });
  }

  @Get(':id/lifecycle')
  @ApiOperation({ summary: 'Get lifecycle drill-down for a rental chain' })
  getLifecycle(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RentalChainLifecycleResponseDto> {
    return this.service.getLifecycle(tenantId, id);
  }

  @Get(':id/financials')
  @ApiOperation({ summary: 'Get financial summary for a rental chain' })
  getFinancials(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getFinancials(tenantId, id);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateRentalChainDto) {
    return this.service.createChain(tenantId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update lifecycle-level fields on a rental chain (authoritative date sync path)',
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalChainDto,
  ) {
    return this.service.updateChain(tenantId, id, dto);
  }

  @Post(':id/exchanges')
  @ApiOperation({
    summary:
      'Schedule an exchange on a rental chain — inserts exchange link, resequences pickup, recalculates pickup date from tenant_settings.default_rental_period_days',
  })
  async createExchange(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExchangeDto,
  ) {
    // Discipline boundary — the service now returns { chain, createdJobs }
    // so JobsService delegation callers (Path B / Path γ) can read the
    // newly-created jobs without DB heuristics. The HTTP response contract
    // for this endpoint is unchanged — consumers still receive only the
    // RentalChain, preserving wire-compatibility with the Exchange Modal
    // (schedule-exchange-modal.tsx).
    const { chain } = await this.service.createExchange(tenantId, id, dto);
    return chain;
  }

  @Patch(':id/exchanges/:linkId')
  @ApiOperation({
    summary:
      'Reschedule an existing exchange — updates exchange link + downstream pickup using tenant rental rules',
  })
  rescheduleExchange(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: RescheduleExchangeDto,
  ) {
    return this.service.rescheduleExchange(tenantId, id, linkId, dto);
  }

  @Put(':id/links/:linkId')
  updateLink(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateLinkStatus(tenantId, id, linkId, body.status);
  }
}
