import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, In, IsNull, Not } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Quote } from '../quotes/quote.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { getTemplate, renderTemplate } from '../quotes/quote-templates';
import { SmsMessage } from '../sms/sms-message.entity';
import { SmsService } from '../sms/sms.service';
import { normalizePhone } from '../../common/utils/phone';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(PricingRule) private pricingRepo: Repository<PricingRule>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectRepository(Quote) private quoteRepo: Repository<Quote>,
    @InjectRepository(SmsMessage) private smsMessageRepo: Repository<SmsMessage>,
    private notificationsService: NotificationsService,
    private settingsService: TenantSettingsService,
    private smsService: SmsService,
    private dataSource: DataSource,
  ) {}

  async scanOverdueRentals(tenantId?: string) {
    const today = new Date().toISOString().split('T')[0];

    const qb = this.jobRepo.createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'c')
      .leftJoinAndSelect('j.asset', 'a')
      .where('j.rental_end_date IS NOT NULL')
      .andWhere('j.rental_end_date < :today', { today })
      .andWhere('j.status IN (:...statuses)', { statuses: ['confirmed', 'dispatched', 'en_route', 'arrived', 'in_progress'] })
      .andWhere('j.job_type = :type', { type: 'delivery' });

    if (tenantId) {
      qb.andWhere('j.tenant_id = :tid', { tid: tenantId });
    }

    const jobs = await qb.getMany();
    let notificationsSent = 0;
    let totalExtraCharges = 0;

    for (const job of jobs) {
      const endDate = new Date(job.rental_end_date);
      const todayDate = new Date(today);
      const extraDays = Math.max(0, Math.ceil((todayDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)));
      const rate = Number(job.extra_day_rate) || 0;
      const charges = extraDays * rate;

      // Check if customer is exempt from extra day charges
      const isExempt = job.customer?.exempt_extra_day_charges;
      const finalCharges = isExempt ? 0 : charges;

      await this.jobRepo.update(job.id, {
        extra_days: extraDays,
        extra_day_charges: finalCharges,
        is_overdue: true,
        extra_day_last_calculated_at: new Date(),
      } as any);

      totalExtraCharges += finalCharges;

      // Send notification if not notified or last notification was 3+ days ago
      const shouldNotify = !job.overdue_notified_at ||
        (new Date().getTime() - new Date(job.overdue_notified_at).getTime()) > 3 * 24 * 60 * 60 * 1000;

      if (shouldNotify) {
        await this.jobRepo.update(job.id, {
          overdue_notified_at: new Date(),
          overdue_notification_count: (job.overdue_notification_count || 0) + 1,
        });
        notificationsSent++;

        await this.notifRepo.save(this.notifRepo.create({
          tenant_id: job.tenant_id,
          job_id: job.id,
          channel: 'automation',
          type: 'overdue_notification',
          recipient: 'system',
          body: JSON.stringify({
            customerName: job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : null,
            extraDays, charges, rate,
            assetIdentifier: job.asset?.identifier,
          }),
          status: 'logged',
          sent_at: new Date(),
        }));
      }
    }

    // Log the scan
    await this.notifRepo.save(this.notifRepo.create({
      tenant_id: tenantId || 'all',
      channel: 'automation',
      type: 'overdue_scan',
      recipient: 'system',
      body: JSON.stringify({ overdueCount: jobs.length, totalExtraCharges, notificationsSent, date: today }),
      status: 'logged',
      sent_at: new Date(),
    }));

    return { overdueCount: jobs.length, totalExtraCharges, notificationsSent, date: today };
  }

  async getOverdueJobs(tenantId: string) {
    return this.jobRepo.createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'c')
      .leftJoinAndSelect('j.asset', 'a')
      .where('j.tenant_id = :tid', { tid: tenantId })
      .andWhere('j.is_overdue = true')
      .andWhere('j.status NOT IN (:...done)', { done: ['completed', 'cancelled'] })
      .orderBy('j.extra_days', 'DESC')
      .getMany();
  }

  async sendOverdueNotification(tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, tenant_id: tenantId },
      relations: ['customer', 'asset'],
    });
    if (!job) throw new NotFoundException('Job not found');

    // Log the notification (actual SMS/email via Resend later)
    console.log(`[automation] Overdue notification for job ${job.job_number}: ${job.extra_days} days overdue, $${job.extra_day_charges} charges`);

    await this.jobRepo.update(jobId, {
      overdue_notified_at: new Date(),
      overdue_notification_count: (job.overdue_notification_count || 0) + 1,
    });

    await this.notifRepo.save(this.notifRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      channel: 'automation',
      type: 'overdue_notification',
      recipient: 'system',
      body: JSON.stringify({
        customerName: job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : null,
        extraDays: job.extra_days,
        charges: job.extra_day_charges,
      }),
      status: 'logged',
      sent_at: new Date(),
    }));

    return { message: 'Notification sent', jobId, extraDays: job.extra_days };
  }

  async acknowledgeOverdue(tenantId: string, jobId: string, action: string, days?: number) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, tenant_id: tenantId },
      relations: ['customer', 'asset'],
    });
    if (!job) throw new NotFoundException('Job not found');

    const updates: Record<string, unknown> = {};

    switch (action) {
      case 'extend': {
        const extendDays = days || 7;
        const currentEnd = new Date(job.rental_end_date);
        currentEnd.setDate(currentEnd.getDate() + extendDays);
        updates.rental_end_date = currentEnd.toISOString().split('T')[0];
        updates.rental_days = (job.rental_days || 0) + extendDays;
        updates.is_overdue = false;
        updates.extra_days = 0;
        updates.extra_day_charges = 0;
        break;
      }
      case 'schedule_pickup': {
        // Create a pickup job
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const seq = Math.floor(Math.random() * 9000) + 1000;
        const pickupJob = this.jobRepo.create({
          tenant_id: tenantId,
          job_number: `JOB-${dateStr}-${seq}`,
          customer_id: job.customer_id,
          asset_id: job.asset_id,
          job_type: 'pickup',
          service_type: job.service_type,
          priority: 'high',
          service_address: job.service_address,
          status: 'pending',
          source: 'automation',
        });
        await this.jobRepo.save(pickupJob);
        break;
      }
      case 'waive':
        updates.extra_day_charges = 0;
        break;
      case 'dismiss':
        updates.is_overdue = false;
        break;
      default:
        throw new BadRequestException(`Unknown action: ${action}`);
    }

    if (Object.keys(updates).length > 0) {
      await this.jobRepo.update(jobId, updates);
    }

    await this.notifRepo.save(this.notifRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      channel: 'automation',
      type: 'overdue_action',
      recipient: 'system',
      body: JSON.stringify({ action, days }),
      status: 'logged',
      sent_at: new Date(),
    }));

    return { message: `Action '${action}' completed`, jobId, action };
  }

  async getLog(tenantId: string) {
    return this.notifRepo.find({
      where: { tenant_id: tenantId, channel: 'automation' },
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  async sendOverdueReminders(tenantId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find open invoices that were sent more than 7 days ago
    const overdueInvoices = await this.invoiceRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'c')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.status = :status', { status: 'open' })
      .andWhere('i.sent_at IS NOT NULL')
      .andWhere('i.sent_at < :cutoff', { cutoff: sevenDaysAgo })
      .getMany();

    let remindersSent = 0;
    const maxPerRun = 20;

    for (const invoice of overdueInvoices) {
      if (remindersSent >= maxPerRun) break;

      // Dedup: check if a reminder was sent within the last 7 days
      const recentReminder = await this.notifRepo
        .createQueryBuilder('n')
        .where('n.tenant_id = :tenantId', { tenantId })
        .andWhere('n.type = :type', { type: 'invoice_reminder' })
        .andWhere('n.customer_id = :cid', { cid: invoice.customer_id })
        .andWhere('n.body LIKE :invRef', { invRef: `%#${invoice.invoice_number}%` })
        .andWhere('n.created_at > :since', { since: sevenDaysAgo })
        .getCount();

      if (recentReminder > 0) continue;

      const customer = invoice.customer;
      if (!customer?.email) continue;

      try {
        await this.notificationsService.send(tenantId, {
          channel: 'email',
          type: 'invoice_reminder',
          recipient: customer.email,
          subject: `Reminder: Invoice #${invoice.invoice_number} is overdue`,
          body: `<p>Hello ${customer.first_name},</p><p>This is a friendly reminder that invoice <strong>#${invoice.invoice_number}</strong> for <strong>$${Number(invoice.balance_due).toFixed(2)}</strong> is overdue.</p><p>Please arrange payment at your earliest convenience.</p>`,
          customerId: customer.id,
        });
        remindersSent++;
      } catch (err) {
        this.logger.warn(`Failed to send reminder for invoice #${invoice.invoice_number}: ${err}`);
      }
    }

    await this.notifRepo.save(this.notifRepo.create({
      tenant_id: tenantId,
      channel: 'automation',
      type: 'overdue_reminders',
      recipient: 'system',
      body: JSON.stringify({ overdueCount: overdueInvoices.length, remindersSent }),
      status: 'logged',
      sent_at: new Date(),
    }));

    return { overdueCount: overdueInvoices.length, remindersSent };
  }

  /**
   * Process automatic quote follow-ups across all enabled tenants.
   * Runs via Vercel Cron — must be idempotent and safe for overlapping executions.
   */
  async processQuoteFollowUps() {
    const now = new Date();
    let processed = 0, sent = 0, skipped = 0;

    // Find all tenants with follow-ups enabled
    const enabledTenants = await this.dataSource.query(
      `SELECT tenant_id, quote_follow_up_delay_hours, quote_templates,
              sms_enabled, quotes_sms_enabled, sms_phone_number
       FROM tenant_settings
       WHERE quote_follow_up_enabled = true`,
    );

    for (const ts of enabledTenants) {
      const delayMs = (ts.quote_follow_up_delay_hours ?? 24) * 60 * 60 * 1000;
      const cutoff = new Date(now.getTime() - delayMs);

      // Find eligible quotes: sent, not expired, not followed up, last_sent before cutoff
      const eligible = await this.quoteRepo.createQueryBuilder('q')
        .where('q.tenant_id = :tenantId', { tenantId: ts.tenant_id })
        .andWhere('q.status = :status', { status: 'sent' })
        .andWhere('q.auto_follow_up_sent_at IS NULL')
        .andWhere('q.expires_at > :now', { now })
        .andWhere('q.customer_email IS NOT NULL')
        .andWhere("q.customer_email != ''")
        .andWhere('q.last_sent_at IS NOT NULL')
        .andWhere('q.last_sent_at <= :cutoff', { cutoff })
        .take(20)
        .getMany();

      for (const quote of eligible) {
        processed++;

        // Atomic claim: only proceed if we successfully mark it
        const claimed = await this.quoteRepo.createQueryBuilder()
          .update(Quote)
          .set({ auto_follow_up_sent_at: now })
          .where('id = :id AND auto_follow_up_sent_at IS NULL', { id: quote.id })
          .execute();

        if (!claimed.affected || claimed.affected === 0) {
          skipped++;
          continue; // Another execution already claimed this quote
        }

        // Load tenant for branding
        const tenant = await this.tenantRepo.findOne({ where: { id: ts.tenant_id } });
        if (!tenant) { skipped++; continue; }

        // Build template context
        const webDomain = process.env.WEB_DOMAIN || 'serviceos-web-zeta.vercel.app';
        const viewQuoteUrl = quote.token ? `https://${webDomain}/quote/${encodeURIComponent(quote.token)}` : '';
        const addressStr = quote.delivery_address
          ? [quote.delivery_address.street, quote.delivery_address.city, quote.delivery_address.state, quote.delivery_address.zip].filter(Boolean).join(', ')
          : '';

        const ctx = {
          customer_name: quote.customer_name || 'Customer',
          company_name: tenant.name,
          quote_price: `$${Number(quote.total_quoted).toFixed(2)}`,
          quote_link: viewQuoteUrl,
          dumpster_size: (quote.asset_subtype || '').replace('yd', ' Yard'),
          service_address: addressStr,
          expires_at: new Date(quote.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          company_phone: (tenant as any).website_phone || '',
          company_email: (tenant as any).website_email || '',
        };

        const templates = ts.quote_templates || null;
        const subject = renderTemplate(getTemplate('followup_email_subject', templates), ctx);
        const body = renderTemplate(getTemplate('followup_email_body', templates), ctx);

        try {
          await this.notificationsService.send(ts.tenant_id, {
            channel: 'email',
            type: 'quote_follow_up',
            recipient: quote.customer_email,
            subject,
            body,
          });
          sent++;
          this.logger.log(`Follow-up sent for quote ${quote.quote_number} to ${quote.customer_email}`);
        } catch (err: any) {
          this.logger.error(`Follow-up failed for quote ${quote.id}: ${err.message}`);
          // Claim stays — we don't retry in V1 to avoid spam
        }

        // SMS follow-up — piggybacks on the same atomic claim as the email send.
        // Independent of email success/failure so one channel can't block the other.
        // All four conditions must be true; otherwise silently skip (no log, no retry).
        if (
          ts.sms_enabled === true &&
          ts.quotes_sms_enabled === true &&
          !!ts.sms_phone_number &&
          !!quote.customer_phone
        ) {
          try {
            const smsBody = renderTemplate(getTemplate('followup_sms_body', templates), ctx);
            const smsResult = await this.smsService.sendSms({
              tenantId: ts.tenant_id,
              to: quote.customer_phone,
              body: smsBody,
              source: 'quote_follow_up',
              sourceId: quote.id,
              customerId: quote.customer_id || undefined,
            });
            if (!smsResult.success) {
              this.logger.warn(
                `SMS follow-up for quote ${quote.id} did not send: ${smsResult.error}`,
              );
            }
          } catch (err: any) {
            this.logger.error(
              `SMS follow-up threw for quote ${quote.id}: ${err.message}`,
            );
          }
        }
      }
    }

    return { processed, sent, skipped, timestamp: now.toISOString() };
  }

  /**
   * Handle inbound SMS from Twilio webhook.
   * Routes to tenant by matching To number, attempts customer match by From number.
   */
  async handleInboundSms(payload: Record<string, string>) {
    const rawFrom = payload.From || payload.from || '';
    const rawTo = payload.To || payload.to || '';
    const body = payload.Body || payload.body || '';
    const messageSid = payload.MessageSid || payload.messageSid || null;

    const normalizedTo = normalizePhone(rawTo);
    const normalizedFrom = normalizePhone(rawFrom);

    if (!normalizedTo || !normalizedFrom) {
      this.logger.warn(`Inbound SMS: invalid numbers From=${rawFrom} To=${rawTo}`);
      return;
    }

    // Route to tenant by assigned phone number
    const tenantRow = await this.dataSource.query(
      `SELECT tenant_id FROM tenant_settings WHERE sms_phone_number = $1 AND sms_enabled = true LIMIT 1`,
      [normalizedTo],
    );

    if (!tenantRow || tenantRow.length === 0) {
      this.logger.warn(`Inbound SMS: no tenant for number ${normalizedTo}`);
      return;
    }

    const tenantId = tenantRow[0].tenant_id;

    // Attempt customer match by normalized phone
    let customerId: string | null = null;
    try {
      const customerRow = await this.dataSource.query(
        `SELECT id FROM customers WHERE tenant_id = $1 AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $2 LIMIT 1`,
        [tenantId, normalizedFrom.replace(/\D/g, '')],
      );
      if (customerRow && customerRow.length > 0) {
        customerId = customerRow[0].id;
      }
    } catch { /* best-effort matching */ }

    // Write inbound message record
    const message = this.smsMessageRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      direction: 'inbound',
      from_number: normalizedFrom,
      to_number: normalizedTo,
      body,
      provider: 'twilio',
      provider_message_sid: messageSid,
      status: 'received',
      source_type: 'inbound',
    });
    await this.smsMessageRepo.save(message);

    this.logger.log(`Inbound SMS from ${normalizedFrom} to ${normalizedTo} (tenant ${tenantId})`);
  }
}
