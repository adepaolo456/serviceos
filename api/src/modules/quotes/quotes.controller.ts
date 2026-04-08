import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
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
  viewQuoteUrl: string;
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
      <p style="margin:16px 0 0;text-align:center;font-size:13px">
        <a href="${params.viewQuoteUrl}" style="color:${color};text-decoration:underline">View your full quote online</a>
      </p>
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
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
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

    // Best-effort customer lookup by email (do not create — just link if exists)
    let customerId: string | null = null;
    if (body.customerEmail) {
      try {
        const existing = await this.customerRepo.findOne({
          where: { tenant_id: tenantId, email: body.customerEmail.toLowerCase().trim() },
        });
        if (existing) customerId = existing.id;
      } catch { /* best-effort — null is fine */ }
    }

    const quote = this.quoteRepo.create({
      tenant_id: tenantId,
      quote_number: quoteNumber,
      customer_id: customerId,
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
          const webDomain = process.env.WEB_DOMAIN || 'serviceos-web-zeta.vercel.app';
          const viewQuoteUrl = `https://${webDomain}/quote/${encodeURIComponent(token)}`;
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
            viewQuoteUrl,
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

  @Get('summary')
  @ApiOperation({ summary: 'Get quote conversion summary stats' })
  async summary(
    @TenantId() tenantId: string,
    @Query('range') range?: string,
  ) {
    // Parse range: 7d, 30d, 90d — default 30d
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const all = await this.quoteRepo.createQueryBuilder('q')
      .where('q.tenant_id = :tenantId', { tenantId })
      .andWhere('q.created_at >= :cutoff', { cutoff })
      .getMany();

    const now = new Date();
    let totalSent = 0, viewed = 0, converted = 0, expired = 0, draft = 0, open = 0;
    for (const q of all) {
      if (q.status === 'draft') { draft++; continue; }
      if (q.status === 'sent' || q.status === 'converted') totalSent++;
      if (q.status === 'converted') { converted++; }
      else if (q.status === 'sent' && now > q.expires_at) { expired++; }
      else if (q.status === 'sent') { open++; }
      if ((q.view_count ?? 0) > 0) viewed++;
    }
    const conversionRate = totalSent > 0 ? Math.round((converted / totalSent) * 100) : 0;
    return { totalSent, viewed, converted, open, expired, draft, conversionRate, rangeDays: days };
  }

  @Get()
  @ApiOperation({ summary: 'List quotes for tenant' })
  async list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
    @Query('limit') limit?: string,
    @Query('hot') hot?: string,
  ) {
    const qb = this.quoteRepo.createQueryBuilder('q')
      .where('q.tenant_id = :tenantId', { tenantId })
      .orderBy('q.created_at', 'DESC')
      .take(Number(limit) || 50);

    if (search) {
      qb.andWhere(
        '(q.customer_name ILIKE :search OR q.quote_number ILIKE :search OR q.customer_email ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Derived status filter: "open" = sent + not expired, "expired" = sent + past expires_at
    if (status === 'open') {
      qb.andWhere('q.status = :s', { s: 'sent' }).andWhere('q.expires_at > NOW()');
    } else if (status === 'expired') {
      qb.andWhere('q.status = :s', { s: 'sent' }).andWhere('q.expires_at <= NOW()');
    } else if (status) {
      qb.andWhere('q.status = :s', { s: status });
    }

    if (customerId) {
      qb.andWhere(
        '(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN (SELECT email FROM customers WHERE id = :customerId AND tenant_id = :tenantId)))',
        { customerId, tenantId },
      );
    }

    // Hot quotes filter: active, not expired, viewed 2+ times
    if (hot === 'true') {
      qb.andWhere('q.status = :hotStatus', { hotStatus: 'sent' })
        .andWhere('q.expires_at > NOW()')
        .andWhere('COALESCE(q.view_count, 0) >= 2');
    }

    const [data, total] = await qb.getManyAndCount();

    // Compute derived status, hot flag, and follow-up priority
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const enriched = data.map((q) => {
      const isExpired = q.status === 'sent' && now > q.expires_at;
      const isHot = q.status === 'sent' && !isExpired && (q.view_count ?? 0) >= 2;
      const lastViewed = q.last_viewed_at ? new Date(q.last_viewed_at) : null;

      // Follow-up priority: needs_follow_up > stale > null
      let follow_up_priority: string | null = null;
      if (isHot && lastViewed && lastViewed >= twoHoursAgo) {
        follow_up_priority = 'needs_follow_up';
      } else if (isHot && lastViewed && lastViewed < oneDayAgo) {
        follow_up_priority = 'stale';
      }

      return {
        ...q,
        derived_status: isExpired ? 'expired' : q.status,
        is_hot: isHot,
        follow_up_priority,
      };
    });

    // Sort: needs_follow_up first, then by last_viewed_at desc, then view_count desc
    if (hot === 'true') {
      enriched.sort((a, b) => {
        const priorityOrder = { needs_follow_up: 0, stale: 2 } as Record<string, number>;
        const pa = a.follow_up_priority ? (priorityOrder[a.follow_up_priority] ?? 1) : 1;
        const pb = b.follow_up_priority ? (priorityOrder[b.follow_up_priority] ?? 1) : 1;
        if (pa !== pb) return pa - pb;
        const la = a.last_viewed_at ? new Date(a.last_viewed_at).getTime() : 0;
        const lb = b.last_viewed_at ? new Date(b.last_viewed_at).getTime() : 0;
        if (lb !== la) return lb - la;
        return (b.view_count ?? 0) - (a.view_count ?? 0);
      });
    }

    return { data: enriched, meta: { total } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single quote detail' })
  async detail(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { error: 'Quote not found' };
    const now = new Date();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const bookingUrl = quote.token && tenant ? buildTenantBookingUrl(tenant.slug, quote.token) : null;
    return {
      ...quote,
      derived_status: quote.status === 'sent' && now > quote.expires_at ? 'expired' : quote.status,
      booking_url: bookingUrl,
    };
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
   * POST /quotes/:id/resend — Re-send quote email using existing token.
   */
  @Post(':id/resend')
  @ApiOperation({ summary: 'Re-send quote email' })
  async resend(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { error: 'Quote not found' };
    if (!quote.customer_email) return { error: 'No email on quote' };
    if (quote.status === 'converted') return { error: 'Quote already converted' };

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { error: 'Tenant not found' };

    const bookNowUrl = buildTenantBookingUrl(tenant.slug, quote.token!);
    const webDomain = process.env.WEB_DOMAIN || 'serviceos-web-zeta.vercel.app';
    const viewQuoteUrl = `https://${webDomain}/quote/${encodeURIComponent(quote.token!)}`;
    const addressStr = quote.delivery_address
      ? [quote.delivery_address.street, quote.delivery_address.city, quote.delivery_address.state, quote.delivery_address.zip].filter(Boolean).join(', ')
      : null;

    const html = buildQuoteEmailHtml({
      customerName: quote.customer_name || 'Customer',
      tenantName: tenant.name,
      assetSubtype: quote.asset_subtype,
      totalQuoted: Number(quote.total_quoted),
      basePrice: Number(quote.base_price),
      distanceSurcharge: Number(quote.distance_surcharge),
      rentalDays: quote.rental_days,
      includedTons: Number(quote.included_tons),
      overageRate: Number(quote.overage_rate),
      deliveryAddress: addressStr,
      bookNowUrl,
      viewQuoteUrl,
      tenantColor: (tenant as any).website_primary_color || undefined,
    });

    await this.notificationsService.send(tenantId, {
      channel: 'email',
      type: 'quote_sent',
      recipient: quote.customer_email,
      subject: `Your Quote from ${tenant.name} — ${quote.asset_subtype.replace('yd', ' Yard')} Dumpster`,
      body: html,
    });

    if (quote.status === 'draft') {
      await this.quoteRepo.update(id, { status: 'sent' });
    }

    return { success: true, message: `Quote re-sent to ${quote.customer_email}` };
  }

  /**
   * Public: GET /quotes/:id/book — Legacy endpoint (kept for backward compat).
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
