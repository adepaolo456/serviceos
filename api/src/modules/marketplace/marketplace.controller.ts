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
import { MarketplaceService } from './marketplace.service';
import {
  CreateMarketplaceBookingDto,
  ListMarketplaceBookingsQueryDto,
  RejectBookingDto,
  AvailabilityQueryDto,
  MarketplacePricingQueryDto,
} from './dto/marketplace.dto';
import { Public, TenantId } from '../../common/decorators';

@ApiTags('Marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Public()
  @Post('bookings')
  @ApiOperation({ summary: 'Webhook: receive booking from marketplace' })
  createBooking(@Body() dto: CreateMarketplaceBookingDto) {
    return this.marketplaceService.createBooking(dto);
  }

  @Public()
  @Get('availability')
  @ApiOperation({ summary: 'Check asset availability (public)' })
  getAvailability(@Query() query: AvailabilityQueryDto) {
    return this.marketplaceService.getAvailability(
      query.tenantId,
      query.type,
      query.subtype,
      query.date,
    );
  }

  @Public()
  @Get('pricing')
  @ApiOperation({ summary: 'Get price quote (public)' })
  getPricing(@Query() query: MarketplacePricingQueryDto) {
    return this.marketplaceService.getPricing(
      query.tenantId,
      query.serviceType,
      query.assetSubtype,
      query.lat,
      query.lng,
    );
  }

  @Get('bookings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List marketplace bookings' })
  findAll(
    @TenantId() tenantId: string,
    @Query() query: ListMarketplaceBookingsQueryDto,
  ) {
    return this.marketplaceService.findAll(tenantId, query);
  }

  @Patch('bookings/:id/accept')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept booking (creates customer + job)',
  })
  accept(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.marketplaceService.accept(tenantId, id);
  }

  @Patch('bookings/:id/reject')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a marketplace booking' })
  reject(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectBookingDto,
  ) {
    return this.marketplaceService.reject(tenantId, id, dto);
  }
}
