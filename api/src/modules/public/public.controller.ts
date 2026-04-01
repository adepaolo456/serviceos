import { Controller, Get, Post, Param, Query, Body, Headers, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PublicService } from './public.service';
import { CreatePublicBookingDto } from './dto/public-booking.dto';

@ApiTags('Public')
@Controller('public/tenant')
@Public()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Get tenant website info by slug' })
  getTenant(@Param('slug') slug: string) {
    return this.publicService.getTenantBySlug(slug);
  }

  @Get(':slug/services')
  @ApiOperation({ summary: 'Get tenant services and pricing' })
  getServices(@Param('slug') slug: string) {
    return this.publicService.getServices(slug);
  }

  @Get(':slug/availability')
  @ApiOperation({ summary: 'Check availability for a date and asset type' })
  getAvailability(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('serviceType') serviceType: string,
    @Query('assetSubtype') assetSubtype: string,
  ) {
    return this.publicService.getAvailability(slug, date, serviceType, assetSubtype);
  }

  @Post(':slug/booking')
  @ApiOperation({ summary: 'Create a booking from website or widget' })
  createBooking(
    @Param('slug') slug: string,
    @Body() body: CreatePublicBookingDto,
  ) {
    return this.publicService.createBooking(slug, body);
  }

  @Get(':slug/widget-config')
  @ApiOperation({ summary: 'Get widget configuration' })
  getWidgetConfig(
    @Param('slug') slug: string,
    @Headers('origin') origin: string,
  ) {
    return this.publicService.getWidgetConfig(slug, origin);
  }
}
