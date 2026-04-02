import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { TenantId } from '../../common/decorators';
import { RentalChainsService } from './rental-chains.service';
import { CreateRentalChainDto } from './dto/create-rental-chain.dto';

@ApiTags('Rental Chains')
@ApiBearerAuth()
@Controller('rental-chains')
export class RentalChainsController {
  constructor(private readonly service: RentalChainsService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id/lifecycle')
  @ApiOperation({ summary: 'Get lifecycle drill-down for a rental chain' })
  getLifecycle(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
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
