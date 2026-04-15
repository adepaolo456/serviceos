import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  RawBody,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as crypto from 'crypto';
import { MarketplaceService } from './marketplace.service';
import {
  AvailabilityQueryDto,
  CreateMarketplaceBookingDto,
  ListMarketplaceBookingsQueryDto,
  MarketplacePricingQueryDto,
  RejectBookingDto,
} from './dto/marketplace.dto';
import { Public, TenantId } from '../../common/decorators';

// Replay window for marketplace webhooks. Matches Stripe / GitHub conventions —
// loose enough to absorb minor clock skew, tight enough to defeat replay.
const MARKETPLACE_REPLAY_WINDOW_SEC = 300;

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

@ApiTags('Marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('bookings')
  @ApiOperation({
    summary: 'Webhook: receive booking from marketplace (HMAC required, disabled by default)',
  })
  async createBooking(
    @Headers('x-marketplace-key-id') keyId: string | undefined,
    @Headers('x-marketplace-timestamp') timestampHeader: string | undefined,
    @Headers('x-marketplace-signature') signatureHeader: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
  ) {
    // Deployment-level enable gate. Independent of any per-integration row so
    // a fresh deploy never accidentally accepts webhooks before the operator
    // has provisioned an integration row and rotated secrets.
    if (
      this.configService.get<string>('MARKETPLACE_WEBHOOK_ENABLED') !== 'true'
    ) {
      throw new ForbiddenException(
        'Marketplace webhook integration is not enabled',
      );
    }

    if (!keyId || !timestampHeader || !signatureHeader || !rawBody) {
      throw new BadRequestException(
        'Missing required marketplace webhook headers or body',
      );
    }

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (!Number.isFinite(timestamp)) {
      throw new BadRequestException('Invalid X-Marketplace-Timestamp');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > MARKETPLACE_REPLAY_WINDOW_SEC) {
      throw new UnauthorizedException('Timestamp outside replay window');
    }

    // Header may use any case for the sha256= prefix or hex digits; normalize
    // before comparison. The computed signature from createHmac().digest('hex')
    // is always lowercase, so we lowercase the inbound side to match. We do
    // this BEFORE the integration lookup so a malformed header gets a clean
    // 400 without burning a DB round-trip.
    const normalizedSig = signatureHeader.toLowerCase();
    if (!normalizedSig.startsWith('sha256=')) {
      throw new BadRequestException(
        'X-Marketplace-Signature must use the sha256= prefix',
      );
    }

    // 404 if unknown key, 403 if the row exists but enabled=false. The
    // distinction matters so an integrator can tell "wrong key" from
    // "right key, off right now".
    const integration = await this.marketplaceService.resolveIntegration(keyId);

    // HMAC-SHA256 over `${timestamp}.${rawBody}`, hex-encoded, prefixed
    // with `sha256=` — same shape as Stripe / GitHub webhook signatures.
    const signedPayload = `${timestampHeader}.${rawBody.toString('utf8')}`;
    const computed =
      'sha256=' +
      crypto
        .createHmac('sha256', integration.signing_secret)
        .update(signedPayload)
        .digest('hex');

    if (!timingSafeStringEqual(normalizedSig, computed)) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Body is now signed-trusted. Parse and validate it manually (the global
    // ValidationPipe does not run on this route because we did not use the
    // @Body() typed-DTO decorator). Tenant comes from the verified
    // integration row, never from anything in the body.
    const dto = await this.parseAndValidateBookingDto(rawBody);
    return this.marketplaceService.createBooking(integration.tenant_id, dto);
  }

  private async parseAndValidateBookingDto(
    rawBody: Buffer,
  ): Promise<CreateMarketplaceBookingDto> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed JSON body');
    }

    const dto = plainToInstance(CreateMarketplaceBookingDto, parsed, {
      enableImplicitConversion: true,
    });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      const flat = errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .filter(Boolean)
        .join('; ');
      throw new BadRequestException(`Invalid booking payload: ${flat}`);
    }
    return dto;
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
