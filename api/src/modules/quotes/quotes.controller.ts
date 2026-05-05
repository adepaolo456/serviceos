import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Quote } from './quote.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { TenantId, CurrentUser } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { SmsService } from '../sms/sms.service';
import { SmsOptOutService } from '../sms/sms-opt-out.service';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { normalizePhone, isValidPhone } from '../../common/utils/phone';
import { getTenantRentalDays } from '../../common/utils/tenant-rental-days.util';
import { getTemplate, renderTemplate } from './quote-templates';
import { randomBytes } from 'crypto';

type DeliveryMethod = 'email' | 'sms' | 'both';

interface ChannelOutcome {
  attempted: boolean;
  ok: boolean;
  reason?: string;
  recipient?: string;
}

interface SendOutcome {
  email: ChannelOutcome;
  sms: ChannelOutcome;
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function buildTenantBookingUrl(slug: string, token: string): string {
  const baseDomain = process.env.TENANT_DOMAIN || 'rentthisapp.com';
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
    private settingsService: TenantSettingsService,
    private smsService: SmsService,
    private optOutService: SmsOptOutService,
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Centralized quote send context — used by create + resend + sms-preview so
  // every send path renders templates from the same source of truth.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build the canonical hosted-quote URL for a tenant + token.
   * Single source of truth — every send channel must use this.
   */
  private buildViewQuoteUrl(token: string): string {
    const webDomain = process.env.WEB_DOMAIN || 'app.rentthisapp.com';
    return `https://${webDomain}/quote/${encodeURIComponent(token)}`;
  }

  /**
   * Build the template substitution context shared by every quote channel.
   */
  private buildTemplateContext(args: {
    tenant: Tenant;
    customerName: string | null;
    assetSubtype: string;
    totalQuoted: number;
    deliveryAddress: Record<string, any> | null;
    expiresAt: Date;
    viewQuoteUrl: string;
  }): Record<string, string> {
    const addressStr = args.deliveryAddress
      ? [
          args.deliveryAddress.street,
          args.deliveryAddress.city,
          args.deliveryAddress.state,
          args.deliveryAddress.zip,
        ]
          .filter(Boolean)
          .join(', ')
      : '';
    return {
      customer_name: args.customerName || 'Customer',
      company_name: args.tenant.name,
      quote_price: `$${Number(args.totalQuoted).toFixed(2)}`,
      quote_link: args.viewQuoteUrl,
      dumpster_size: args.assetSubtype.replace('yd', ' Yard'),
      service_address: addressStr,
      expires_at: new Date(args.expiresAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      company_phone: (args.tenant as any).website_phone || '',
      company_email: (args.tenant as any).website_email || '',
    };
  }

  /**
   * Resolve and validate the delivery method against tenant + customer state.
   *
   * Returns the channels that should actually be attempted, plus per-channel
   * blocked reasons so the caller can surface partial-success messaging without
   * the UI having to re-derive the same rules.
   */
  private async resolveChannels(args: {
    requested: DeliveryMethod | undefined;
    settings: TenantSettings;
    customerEmail: string | null;
    customerPhone: string | null;
  }): Promise<{
    method: DeliveryMethod;
    email: { allowed: boolean; recipient: string | null; blockedReason?: string };
    sms: { allowed: boolean; recipient: string | null; blockedReason?: string };
  }> {
    const { settings } = args;

    // ── Email channel ──
    let emailAllowed = false;
    let emailRecipient: string | null = null;
    let emailBlocked: string | undefined;
    if (!settings.quotes_email_enabled) {
      emailBlocked = 'tenant_quotes_email_disabled';
    } else if (!args.customerEmail) {
      emailBlocked = 'no_customer_email';
    } else {
      emailAllowed = true;
      emailRecipient = args.customerEmail;
    }

    // ── SMS channel ──
    let smsAllowed = false;
    let smsRecipient: string | null = null;
    let smsBlocked: string | undefined;
    if (!settings.sms_enabled) {
      smsBlocked = 'tenant_sms_disabled';
    } else if (!settings.sms_phone_number) {
      smsBlocked = 'tenant_sms_number_missing';
    } else if (!settings.quotes_sms_enabled) {
      smsBlocked = 'tenant_quotes_sms_disabled';
    } else if (!args.customerPhone) {
      smsBlocked = 'no_customer_phone';
    } else {
      const normalized = normalizePhone(args.customerPhone);
      if (!normalized) {
        smsBlocked = 'invalid_customer_phone';
      } else if (await this.optOutService.isOptedOut(settings.tenant_id, normalized)) {
        // Tenant-scoped suppression — surfaces in the UI before the operator
        // attempts a send. Defense-in-depth: SmsService also re-checks at send time.
        smsBlocked = 'customer_opted_out';
      } else {
        smsAllowed = true;
        smsRecipient = normalized;
      }
    }

    // Resolve requested method against the tenant default + what is actually allowed.
    const def = (settings.default_quote_delivery_method as DeliveryMethod) || 'email';
    const requested: DeliveryMethod = args.requested || def;
    let method: DeliveryMethod = requested;

    // If the caller asked for both but only one is allowed, gracefully degrade.
    if (method === 'both' && !emailAllowed && !smsAllowed) {
      method = 'email'; // will produce all-failure outcome reflected in result
    } else if (method === 'both' && !emailAllowed) {
      method = 'sms';
    } else if (method === 'both' && !smsAllowed) {
      method = 'email';
    }

    return {
      method,
      email: { allowed: emailAllowed, recipient: emailRecipient, blockedReason: emailBlocked },
      sms: { allowed: smsAllowed, recipient: smsRecipient, blockedReason: smsBlocked },
    };
  }

  /**
   * Send the quote email — pure side-effect helper, never throws to caller.
   */
  private async sendQuoteEmail(args: {
    tenantId: string;
    tenant: Tenant;
    quote: Pick<
      Quote,
      | 'asset_subtype'
      | 'total_quoted'
      | 'base_price'
      | 'distance_surcharge'
      | 'rental_days'
      | 'included_tons'
      | 'overage_rate'
      | 'delivery_address'
      | 'expires_at'
    >;
    recipient: string;
    customerName: string;
    bookNowUrl: string;
    viewQuoteUrl: string;
    templateCtx: Record<string, string>;
    settings: TenantSettings;
  }): Promise<ChannelOutcome> {
    try {
      const addressStr = args.quote.delivery_address
        ? [
            args.quote.delivery_address.street,
            args.quote.delivery_address.city,
            args.quote.delivery_address.state,
            args.quote.delivery_address.zip,
          ]
            .filter(Boolean)
            .join(', ')
        : null;

      const html = buildQuoteEmailHtml({
        customerName: args.customerName,
        tenantName: args.tenant.name,
        assetSubtype: args.quote.asset_subtype,
        totalQuoted: Number(args.quote.total_quoted),
        basePrice: Number(args.quote.base_price),
        distanceSurcharge: Number(args.quote.distance_surcharge),
        rentalDays: args.quote.rental_days,
        includedTons: Number(args.quote.included_tons),
        overageRate: Number(args.quote.overage_rate),
        deliveryAddress: addressStr,
        bookNowUrl: args.bookNowUrl,
        viewQuoteUrl: args.viewQuoteUrl,
        tenantColor: (args.tenant as any).website_primary_color || undefined,
      });
      const subject = renderTemplate(
        getTemplate('quote_email_subject', args.settings.quote_templates),
        args.templateCtx,
      );
      await this.notificationsService.send(args.tenantId, {
        channel: 'email',
        type: 'quote_sent',
        recipient: args.recipient,
        subject,
        body: html,
      });
      return { attempted: true, ok: true, recipient: args.recipient };
    } catch (err: any) {
      this.logger.error(`Quote email send failed for tenant ${args.tenantId}: ${err.message}`);
      return { attempted: true, ok: false, reason: err.message || 'email_send_failed', recipient: args.recipient };
    }
  }

  /**
   * Send the quote SMS — uses the centralized SmsService and the tenant's
   * assigned number. Never throws to caller.
   */
  private async sendQuoteSms(args: {
    tenantId: string;
    quoteId: string | null;
    customerId: string | null;
    recipient: string;
    templateCtx: Record<string, string>;
    settings: TenantSettings;
  }): Promise<ChannelOutcome> {
    const body = renderTemplate(
      getTemplate('quote_sms_body', args.settings.quote_templates),
      args.templateCtx,
    );
    if (!body || !body.trim()) {
      return { attempted: true, ok: false, reason: 'empty_sms_body', recipient: args.recipient };
    }
    const result = await this.smsService.sendSms({
      tenantId: args.tenantId,
      to: args.recipient,
      body,
      source: 'quote_send',
      sourceId: args.quoteId || undefined,
      customerId: args.customerId || undefined,
    });
    if (!result.success) {
      return {
        attempted: true,
        ok: false,
        reason: result.error || 'sms_send_failed',
        recipient: args.recipient,
      };
    }
    return { attempted: true, ok: true, recipient: args.recipient };
  }

  /**
   * POST /quotes — Atomic: create quote + send via selected delivery method.
   * Used by Quick Quote drawer's send flow.
   *
   * Delivery method:
   *   - explicit `deliveryMethod` body field, or
   *   - tenant default (`default_quote_delivery_method`), or
   *   - 'email' fallback
   *
   * The send is per-channel additive: if email succeeds and SMS fails (or vice
   * versa), the quote is still marked sent and the response surfaces the real
   * per-channel outcome so the UI can show partial success.
   */
  @Post()
  @ApiOperation({ summary: 'Create a quote and send via email/sms/both' })
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
      deliveryMethod?: DeliveryMethod;
    },
  ) {
    const settings = await this.settingsService.getSettings(tenantId);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.quoteRepo.count({ where: { tenant_id: tenantId } });
    const quoteNumber = `QT-${dateStr}-${String(count + 1).padStart(3, '0')}`;

    const token = generateToken();
    const totalQuoted = body.totalQuoted ?? body.basePrice;

    // Customer lookup by email (do not create — just link if exists).
    //
    // Site #23 (prior silent-error-swallow audit, closed): the previous
    // try/catch masked DB errors as "no customer" — a genuine outage
    // would cause the quote to be created unlinked even when the
    // customer existed, breaking the downstream "convert quote to
    // booking" flow that assumes customer_id is populated when an
    // email match existed. Removed; findOne returning null is still
    // handled as the no-match case, but actual errors now propagate.
    let customerId: string | null = null;
    if (body.customerEmail) {
      const existing = await this.customerRepo.findOne({
        where: { tenant_id: tenantId, email: body.customerEmail.toLowerCase().trim() },
      });
      if (existing) customerId = existing.id;
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
      rental_days:
        body.rentalDays ||
        (await getTenantRentalDays(
          this.dataSource.getRepository(TenantSettings),
          tenantId,
        )),
      overage_rate: body.overageRate || 0,
      extra_day_rate: body.extraDayRate || 0,
      distance_surcharge: body.distanceSurcharge || 0,
      total_quoted: totalQuoted,
      status: 'draft',
      token,
      expires_at: new Date(Date.now() + settings.quote_expiration_days * 24 * 60 * 60 * 1000),
      created_by: userId,
    } as Partial<Quote>);

    const saved = await this.quoteRepo.save(quote);

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      return { ...saved, send: { email: { attempted: false, ok: false, reason: 'tenant_missing' }, sms: { attempted: false, ok: false, reason: 'tenant_missing' } } };
    }

    const channels = await this.resolveChannels({
      requested: body.deliveryMethod,
      settings,
      customerEmail: body.customerEmail || null,
      customerPhone: body.customerPhone || null,
    });

    const viewQuoteUrl = this.buildViewQuoteUrl(token);
    const bookNowUrl = buildTenantBookingUrl(tenant.slug, token);
    const templateCtx = this.buildTemplateContext({
      tenant,
      customerName: body.customerName || null,
      assetSubtype: body.assetSubtype,
      totalQuoted,
      deliveryAddress: body.deliveryAddress || null,
      expiresAt: saved.expires_at,
      viewQuoteUrl,
    });

    const wantEmail = channels.method === 'email' || channels.method === 'both';
    const wantSms = channels.method === 'sms' || channels.method === 'both';

    const outcome: SendOutcome = {
      email: {
        attempted: false,
        ok: false,
        reason: channels.email.blockedReason,
        recipient: channels.email.recipient || undefined,
      },
      sms: {
        attempted: false,
        ok: false,
        reason: channels.sms.blockedReason,
        recipient: channels.sms.recipient || undefined,
      },
    };

    if (wantEmail && channels.email.allowed && channels.email.recipient) {
      outcome.email = await this.sendQuoteEmail({
        tenantId,
        tenant,
        quote: saved,
        recipient: channels.email.recipient,
        customerName: body.customerName || 'Customer',
        bookNowUrl,
        viewQuoteUrl,
        templateCtx,
        settings,
      });
    }

    if (wantSms && channels.sms.allowed && channels.sms.recipient) {
      outcome.sms = await this.sendQuoteSms({
        tenantId,
        quoteId: saved.id,
        customerId,
        recipient: channels.sms.recipient,
        templateCtx,
        settings,
      });
    }

    // Mark sent only if at least one channel actually succeeded.
    if (outcome.email.ok || outcome.sms.ok) {
      await this.quoteRepo.update(saved.id, { status: 'sent', last_sent_at: new Date() });
      saved.status = 'sent';
      saved.last_sent_at = new Date();
    }

    return { ...saved, send: outcome, resolved_method: channels.method };
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
        '(q.customer_id = :customerId OR (q.customer_id IS NULL AND q.customer_email IN (SELECT email FROM customers WHERE id = :customerId AND tenant_id = :customersTenantId)))',
        { customerId, customersTenantId: tenantId },
      );
    }

    // Load tenant settings for thresholds
    const settings = await this.settingsService.getSettings(tenantId);
    const hotThreshold = settings.hot_quote_view_threshold ?? 2;
    const recencyMs = (settings.follow_up_recency_minutes ?? 120) * 60 * 1000;
    const expiringSoonMs = (settings.expiring_soon_hours ?? 48) * 60 * 60 * 1000;

    // Hot quotes filter: active, not expired, viewed >= threshold
    if (hot === 'true') {
      qb.andWhere('q.status = :hotStatus', { hotStatus: 'sent' })
        .andWhere('q.expires_at > NOW()')
        .andWhere('COALESCE(q.view_count, 0) >= :hotThreshold', { hotThreshold });
    }

    const [data, total] = await qb.getManyAndCount();

    // Compute derived status, hot flag, follow-up priority, and expiry urgency
    const now = new Date();
    const recencyCutoff = new Date(now.getTime() - recencyMs);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const inExpiringSoon = new Date(now.getTime() + expiringSoonMs);

    const enriched = data.map((q) => {
      // Defensive: legacy quote rows may have null expires_at. Guard every
      // Date operation so a single bad row cannot crash the list endpoint.
      const rawExpires = q.expires_at as Date | string | null | undefined;
      let expiresAt: Date | null = null;
      if (rawExpires != null) {
        const parsed = rawExpires instanceof Date ? rawExpires : new Date(rawExpires);
        if (!isNaN(parsed.getTime())) expiresAt = parsed;
      }

      const isExpired =
        q.status === 'sent' && expiresAt !== null && now > expiresAt;
      const isHot = q.status === 'sent' && !isExpired && (q.view_count ?? 0) >= hotThreshold;
      const lastViewed = q.last_viewed_at ? new Date(q.last_viewed_at) : null;

      // Follow-up priority
      let follow_up_priority: string | null = null;
      if (isHot && lastViewed && lastViewed >= recencyCutoff) {
        follow_up_priority = 'needs_follow_up';
      } else if (isHot && lastViewed && lastViewed < oneDayAgo) {
        follow_up_priority = 'stale';
      }

      // Expiry urgency (active quotes only — skip rows with no usable expiry)
      let expires_urgency: string | null = null;
      if (!isExpired && q.status === 'sent' && expiresAt !== null) {
        if (expiresAt <= in24h) expires_urgency = 'expires_today';
        else if (expiresAt <= inExpiringSoon) expires_urgency = 'expiring_soon';
      }

      const hoursUntilExpiry =
        !isExpired && expiresAt !== null
          ? Math.max(
              0,
              Math.round((expiresAt.getTime() - now.getTime()) / 3600000),
            )
          : 0;

      return {
        ...q,
        derived_status: isExpired ? 'expired' : q.status,
        is_hot: isHot,
        follow_up_priority,
        expires_urgency,
        hours_until_expiry: hoursUntilExpiry,
      };
    });

    // Sort: needs_follow_up first, expiring soon boosted, then recency, then views
    if (hot === 'true') {
      enriched.sort((a, b) => {
        const priorityOrder = { needs_follow_up: 0, stale: 3 } as Record<string, number>;
        let pa = a.follow_up_priority ? (priorityOrder[a.follow_up_priority] ?? 2) : 2;
        let pb = b.follow_up_priority ? (priorityOrder[b.follow_up_priority] ?? 2) : 2;
        // Boost expiring quotes within their tier
        if (a.expires_urgency === 'expires_today' && pa > 0) pa = Math.min(pa, 1);
        if (b.expires_urgency === 'expires_today' && pb > 0) pb = Math.min(pb, 1);
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
   * POST /quotes/:id/resend — Re-send a quote via email/sms/both using the
   * existing hosted-quote token. Returns per-channel outcome so the UI can
   * show partial-success messaging without re-deriving validation rules.
   */
  @Post(':id/resend')
  @ApiOperation({ summary: 'Re-send quote via email/sms/both' })
  async resend(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { deliveryMethod?: DeliveryMethod } = {},
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { error: 'Quote not found' };
    if (quote.status === 'converted') return { error: 'Quote already converted' };
    if (!quote.token) return { error: 'Quote has no hosted link token' };

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { error: 'Tenant not found' };

    const settings = await this.settingsService.getSettings(tenantId);

    const channels = await this.resolveChannels({
      requested: body.deliveryMethod,
      settings,
      customerEmail: quote.customer_email || null,
      customerPhone: quote.customer_phone || null,
    });

    const viewQuoteUrl = this.buildViewQuoteUrl(quote.token);
    const bookNowUrl = buildTenantBookingUrl(tenant.slug, quote.token);
    const templateCtx = this.buildTemplateContext({
      tenant,
      customerName: quote.customer_name || null,
      assetSubtype: quote.asset_subtype,
      totalQuoted: Number(quote.total_quoted),
      deliveryAddress: quote.delivery_address,
      expiresAt: quote.expires_at,
      viewQuoteUrl,
    });

    const wantEmail = channels.method === 'email' || channels.method === 'both';
    const wantSms = channels.method === 'sms' || channels.method === 'both';

    const outcome: SendOutcome = {
      email: {
        attempted: false,
        ok: false,
        reason: channels.email.blockedReason,
        recipient: channels.email.recipient || undefined,
      },
      sms: {
        attempted: false,
        ok: false,
        reason: channels.sms.blockedReason,
        recipient: channels.sms.recipient || undefined,
      },
    };

    if (wantEmail && channels.email.allowed && channels.email.recipient) {
      outcome.email = await this.sendQuoteEmail({
        tenantId,
        tenant,
        quote,
        recipient: channels.email.recipient,
        customerName: quote.customer_name || 'Customer',
        bookNowUrl,
        viewQuoteUrl,
        templateCtx,
        settings,
      });
    }

    if (wantSms && channels.sms.allowed && channels.sms.recipient) {
      outcome.sms = await this.sendQuoteSms({
        tenantId,
        quoteId: quote.id,
        customerId: quote.customer_id,
        recipient: channels.sms.recipient,
        templateCtx,
        settings,
      });
    }

    // Update last_sent_at + status only if at least one channel succeeded.
    if (outcome.email.ok || outcome.sms.ok) {
      await this.quoteRepo.update(id, {
        ...(quote.status === 'draft' ? { status: 'sent' } : {}),
        last_sent_at: new Date(),
      });
    }

    return { send: outcome, resolved_method: channels.method };
  }

  /**
   * POST /quotes/:id/sms-preview — Render the quote SMS body with the real
   * template + tenant context so the UI can show a controlled preview before
   * the user explicitly confirms an SMS send. NEVER sends anything.
   */
  @Post(':id/sms-preview')
  @ApiOperation({ summary: 'Render SMS body preview for a quote (no send)' })
  async smsPreview(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const quote = await this.quoteRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!quote) return { valid: false, reason: 'quote_not_found' };
    if (!quote.token) return { valid: false, reason: 'no_token' };

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { valid: false, reason: 'tenant_missing' };

    const settings = await this.settingsService.getSettings(tenantId);
    const channels = await this.resolveChannels({
      requested: 'sms',
      settings,
      customerEmail: quote.customer_email || null,
      customerPhone: quote.customer_phone || null,
    });

    const viewQuoteUrl = this.buildViewQuoteUrl(quote.token);
    const templateCtx = this.buildTemplateContext({
      tenant,
      customerName: quote.customer_name || null,
      assetSubtype: quote.asset_subtype,
      totalQuoted: Number(quote.total_quoted),
      deliveryAddress: quote.delivery_address,
      expiresAt: quote.expires_at,
      viewQuoteUrl,
    });

    const renderedBody = renderTemplate(
      getTemplate('quote_sms_body', settings.quote_templates),
      templateCtx,
    );

    const valid = channels.sms.allowed && !!renderedBody.trim();
    return {
      valid,
      reason: valid ? undefined : channels.sms.blockedReason || 'empty_body',
      body: renderedBody,
      recipient: channels.sms.recipient,
      from_number: settings.sms_phone_number,
      character_count: renderedBody.length,
    };
  }

  /**
   * POST /quotes/preview-sms — Stateless SMS preview for a quote that has not
   * been created yet (used by the Quick Quote drawer). Renders the SMS body
   * from the in-progress quote payload + tenant template + a placeholder link.
   */
  @Post('preview-sms')
  @ApiOperation({ summary: 'Preview SMS body for an in-progress quote (no quote row)' })
  async previewSmsForDraft(
    @TenantId() tenantId: string,
    @Body() body: {
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      deliveryAddress?: Record<string, any>;
      assetSubtype: string;
      totalQuoted: number;
    },
  ) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { valid: false, reason: 'tenant_missing' };
    const settings = await this.settingsService.getSettings(tenantId);

    const channels = await this.resolveChannels({
      requested: 'sms',
      settings,
      customerEmail: body.customerEmail || null,
      customerPhone: body.customerPhone || null,
    });

    // Use a stable preview placeholder for the link — the real token is created on send.
    const previewLink = `https://${process.env.WEB_DOMAIN || 'app.rentthisapp.com'}/quote/preview`;
    const expiresAt = new Date(Date.now() + settings.quote_expiration_days * 24 * 60 * 60 * 1000);
    const templateCtx = this.buildTemplateContext({
      tenant,
      customerName: body.customerName || null,
      assetSubtype: body.assetSubtype,
      totalQuoted: body.totalQuoted,
      deliveryAddress: body.deliveryAddress || null,
      expiresAt,
      viewQuoteUrl: previewLink,
    });

    const renderedBody = renderTemplate(
      getTemplate('quote_sms_body', settings.quote_templates),
      templateCtx,
    );

    const valid = channels.sms.allowed && !!renderedBody.trim();
    return {
      valid,
      reason: valid ? undefined : channels.sms.blockedReason || 'empty_body',
      body: renderedBody,
      recipient: channels.sms.recipient,
      from_number: settings.sms_phone_number,
      character_count: renderedBody.length,
    };
  }

}
