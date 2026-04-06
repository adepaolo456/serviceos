import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantId, CurrentUser, Public } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { randomBytes } from 'crypto';

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function buildTenantBookingUrl(slug: string, token: string): string {
  const baseDomain = process.env.TENANT_DOMAIN || 'serviceos.com';
  return `https://${slug}.${baseDomain}/site/book?quote=${encodeURIComponent(token)}`;
}

function buildQuoteEmailHtml(params: {
  customerName: string;
  tenantName: string;
  assetSubtype: string;
  totalQuoted: number;
  basePrice: number;
  distanceSurcharge: number;
  rentalDays: number;
  includedTons: number;
  overageRate: number;
  deliveryAddress: string | null;
  bookNowUrl: string;
  tenantColor?: string;
}): string {
  const color = params.tenantColor || '#10b981';
  const addressLine = params.deliveryAddress
    ? `<tr><td style="color:#666;padding:4px 0">Delivery to</td><td style="text-align:right;padding:4px 0">${params.deliveryAddress}</td></tr>`
    : '';
  const distanceLine = params.distanceSurcharge > 0
    ? `<tr><td style="color:#666;padding:4px 0">Distance surcharge</td><td style="text-align:right;padding:4px 0">$${Number(params.distanceSurcharge).toFixed(2)}</td></tr>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:${color};padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">${params.tenantName}</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Your Dumpster Rental Quote</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 20px;font-size:15px;color:#333">Hi ${params.customerName},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#555">Here's your quote for a <strong>${params.assetSubtype.replace('yd', ' Yard')}</strong> dumpster rental:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333">
        <tr><td style="color:#666;padding:4px 0">Base price</td><td style="text-align:right;padding:4px 0">$${Number(params.basePrice).toFixed(2)}</td></tr>
        ${distanceLine}
        <tr><td style="color:#666;padding:4px 0">Rental period</td><td style="text-align:right;padding:4px 0">${params.rentalDays} days</td></tr>
        <tr><td style="color:#666;padding:4px 0">Included tonnage</td><td style="text-align:right;padding:4px 0">${params.includedTons} tons</td></tr>
        <tr><td style="color:#666;padding:4px 0">Overage rate</td><td style="text-align:right;padding:4px 0">$${Number(params.overageRate).toFixed(2)}/ton</td></tr>
        ${addressLine}
        <tr style="border-top:2px solid #eee">
          <td style="padding:12px 0 4px;font-weight:700;font-size:16px">Total</td>
          <td style="text-align:right;padding:12px 0 4px;font-weight:700;font-size:20px;color:${color}">$${Number(params.totalQuoted).toFixed(2)}</td>
        </tr>
      </table>
      <p style="margin:20px 0 4px;font-size:12px;color:#999">This quote is valid for 30 days.</p>
      <a href="${params.bookNowUrl}" style="display:block;text-align:center;margin:24px 0 0;padding:14px 24px;background:${color};color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:15px">
        Book Now
      </a>
    </div>
  </div>
</body>
</html>`;
}

@ApiTags('Quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  private readonly logger = new Logger(QuotesController.name);

  constructor(
    @InjectRepository(Quote) private quoteRepo: Repository<Quote>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * POST /quotes — Atomic: create quote + send email + mark as sent.
   * Used by Quick Quote drawer's Email Quote flow.
   */
  @Post()
  @ApiOperation({ summary: 'Create and email a quote' })
  async create(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: {
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      deliveryAddress?: Record<string, any>;
      assetSubtype: string;
      basePrice: number;
      includedTons?: number;
      rentalDays?: number;
      overageRate?: number;
      extraDayRate?: number;
      distanceSurcharge?: number;
      totalQuoted?: number;
    },
  ) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.quoteRepo.count({ where: { tenant_id: tenantId } });
    const quoteNumber = `QT-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    const token = generateToken();
    const totalQuoted = body.totalQuoted ?? body.basePrice;

    const quote = this.quoteRepo.create({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      customer_name: body.customerName || null,
      customer_email: body.customerEmail || null,
      customer_phone: body.customerPhone || null,
      delivery_address: body.deliveryAddress || null,
      asset_subtype: body.assetSubtype,
      base_price: body.basePrice,
      included_tons: body.includedTons || 0,
      rental_days: body.rentalDays || 14,
      overage_rate: body.overageRate || 0,
      extra_day_rate: body.extraDayRate || 0,
      distance_surcharge: body.distanceSurcharge || 0,
      total_quoted: totalQuoted,
      status: 'draft',
      token,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_by: userId,
    } as Partial<Quote>);

    const saved = await this.quoteRepo.save(quote);

    // If email provided, send quote email and mark as sent
    if (body.customerEmail && body.customerName) {
      try {
        const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
        if (tenant) {
          const bookNowUrl = buildTenantBookingUrl(tenant.slug, token);
          const addressStr = body.deliveryAddress
            ? [body.deliveryAddress.street, body.deliveryAddress.city, body.deliveryAddress.state, body.deliveryAddress.zip].filter(Boolean).join(', ')
            : null;

          const html = buildQuoteEmailHtml({
            customerName: body.customerName,
            tenantName: tenant.name,
            assetSubtype: body.assetSubtype,
            totalQuoted,
            basePrice: body.basePrice,
            distanceSurcharge: body.distanceSurcharge || 0,
            rentalDays: body.rentalDays || 14,
            includedTons: body.includedTons || 0,
            overageRate: body.overageRate || 0,
            deliveryAddress: addressStr,
            bookNowUrl,
            tenantColor: (tenant as any).website_primary_color || undefined,
          });

          await this.notificationsService.send(tenantId, {
            channel: 'email',
            type: 'quote_sent',
            recipient: body.customerEmail,
            subject: `Your Quote from ${tenant.name} — ${body.assetSubtype.replace('yd', ' Yard')} Dumpster`,
            body: html,
          });

          await this.quoteRepo.update(saved.id, { status: 'sent' });
          saved.status = 'sent';
        }
      } catch (err: any) {
        this.logger.error(`Failed to send quote email: ${err.message}`);
        // Quote is still saved as draft — don't fail the whole request
      }
    }

    return saved;
  }

  @Get()
  @ApiOperation({ summary: 'List quotes for tenant' })
  async list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.quoteRepo.createQueryBuilder('q')
      .where('q.tenant_id = :tenantId', { tenantId })
      .orderBy('q.created_at', 'DESC')
      .take(Number(limit) || 50);

    if (status) qb.andWhere('q.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { total } };
  }

  /**
   * POST /quotes/:id/convert — Mark a quote as converted when booking completes.
   */
  @Post(':id/convert')
  @ApiOperation({ summary: 'Mark quote as converted' })
  async convert(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { bookedJobId?: string },
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { error: 'Quote not found' };

    await this.quoteRepo.update(id, {
      status: 'converted',
      booked_job_id: body.bookedJobId || null,
    });

    return { success: true, quoteNumber: quote.quote_number };
  }

  /**
   * Public: GET /quotes/:id/book — Legacy endpoint (kept for backward compat).
   * New flow uses GET /public/tenant/:slug/quote/:token instead.
   */
  @Public()
  @Get(':id/book')
  @ApiOperation({ summary: 'Validate quote for booking (legacy)' })
  async bookFromQuote(@Param('id', ParseUUIDPipe) id: string) {
    const quote = await this.quoteRepo.findOne({ where: { id } });
    if (!quote) return { valid: false, error: 'Quote not found' };
    if (new Date() > quote.expires_at) return { valid: false, expired: true, message: 'This quote has expired' };
    return {
      valid: true,
      quoteId: quote.id,
      expiresAt: quote.expires_at,
      size: quote.asset_subtype,
    };
  }
}
