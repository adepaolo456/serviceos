import { Controller, Post, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';
import { PortalService } from './portal.service';
import { PortalLoginDto, PortalMagicLinkDto, PortalRegisterDto } from './portal.dto';
import { checkRateLimit } from '../../common/rate-limiter';

@Controller('portal/auth')
export class PortalAuthController {
  constructor(
    private portalService: PortalService,
    private readonly dataSource: DataSource,
  ) {}

  private async enforceRateLimit(
    req: Request,
    endpoint: string,
    max: number,
    windowMinutes: number,
  ): Promise<void> {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const result = await checkRateLimit(this.dataSource, ip, endpoint, max, windowMinutes);
    if (!result.allowed) {
      throw new HttpException(
        { statusCode: 429, message: 'Too many requests. Try again later.', retryAfter: result.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Public()
  @Post('login')
  login(@Body() dto: PortalLoginDto) {
    return this.portalService.login(dto.email, dto.password, dto.tenantId);
  }

  @Public()
  @Post('register')
  register(@Body() dto: PortalRegisterDto) {
    return this.portalService.register(dto.email, dto.password, dto.tenantId);
  }

  @Public()
  @Post('magic-link')
  async magicLink(@Body() dto: PortalMagicLinkDto, @Req() req: Request) {
    await this.enforceRateLimit(req, '/portal/auth/magic-link', 5, 15);
    return this.portalService.magicLink(dto.email, dto.tenantId);
  }
}
