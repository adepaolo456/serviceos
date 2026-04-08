import { Controller, Get, Post, Param, Query, Body, Headers, Req, NotFoundException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { PublicService } from './public.service';
import { CreatePublicBookingDto } from './dto/public-booking.dto';
import { checkRateLimit } from '../../common/rate-limiter';

@ApiTags('Public')
@Controller('public/tenant')
@Public()
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly dataSource: DataSource,
  ) {}

  private extractIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown'
    );
  }

  private async enforceRateLimit(
    req: Request,
    endpoint: string,
    max: number,
    windowMinutes: number,
  ): Promise<void> {
    const ip = this.extractIp(req);
    const result = await checkRateLimit(this.dataSource, ip, endpoint, max, windowMinutes);
    if (!result.allowed) {
      throw new HttpException(
        { statusCode: 429, message: 'Too many requests. Try again later.', retryAfter: result.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // Static routes MUST come before parameterized :slug routes
  @Get('quote/:token')
  @ApiOperation({ summary: 'Get hosted quote page data by token (no slug needed)' })
  async getHostedQuote(@Req() req: Request, @Param('token') token: string) {
    await this.enforceRateLimit(req, 'public-hosted-quote', 30, 15);
    return this.publicService.getHostedQuote(token);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get tenant website info by slug' })
  async getTenant(@Req() req: Request, @Param('slug') slug: string) {
    await this.enforceRateLimit(req, 'public-read', 60, 1);
    return this.publicService.getTenantBySlug(slug);
  }

  @Get(':slug/services')
  @ApiOperation({ summary: 'Get tenant services and pricing' })
  async getServices(@Req() req: Request, @Param('slug') slug: string) {
    await this.enforceRateLimit(req, 'public-read', 60, 1);
    return this.publicService.getServices(slug);
  }

  @Get(':slug/availability')
  @ApiOperation({ summary: 'Check availability for a date and asset type' })
  async getAvailability(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('serviceType') serviceType: string,
    @Query('assetSubtype') assetSubtype: string,
  ) {
    await this.enforceRateLimit(req, 'public-read', 60, 1);
    return this.publicService.getAvailability(slug, date, serviceType, assetSubtype);
  }

  @Post(':slug/booking')
  @ApiOperation({ summary: 'Create a booking from website or widget' })
  async createBooking(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Body() body: CreatePublicBookingDto,
  ) {
    await this.enforceRateLimit(req, 'public-booking', 10, 15);
    return this.publicService.createBooking(slug, body);
  }

  @Get(':slug/widget-config')
  @ApiOperation({ summary: 'Get widget configuration' })
  async getWidgetConfig(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Headers('origin') origin: string,
  ) {
    await this.enforceRateLimit(req, 'public-read', 60, 1);
    return this.publicService.getWidgetConfig(slug, origin);
  }

  @Get(':slug/quote/:token')
  @ApiOperation({ summary: 'Look up a quote by token for booking hydration' })
  async getQuoteByToken(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Param('token') token: string,
  ) {
    await this.enforceRateLimit(req, 'public-quote-token', 30, 15);
    return this.publicService.getQuoteByToken(slug, token);
  }

}
