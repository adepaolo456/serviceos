import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { ClientNotificationOverride } from './entities/client-notification-override.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { TwilioService } from './services/twilio.service';
import { ResendEmailService } from './services/resend.service';
import {
  SendNotificationDto,
  ListNotificationsQueryDto,
} from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private prefRepo: Repository<NotificationPreference>,
    @InjectRepository(ClientNotificationOverride)
    private overrideRepo: Repository<ClientNotificationOverride>,
    @InjectRepository(ScheduledNotification)
    private scheduledRepo: Repository<ScheduledNotification>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
    private twilio: TwilioService,
    private resend: ResendEmailService,
  ) {}

  // ─── Queue a notification (existing API — kept for backward compat) ───

  async send(tenantId: string, dto: SendNotificationDto): Promise<Notification> {
    const notification = this.notifRepo.create({
      tenant_id: tenantId,
      channel: dto.channel,
      type: dto.type,
      recipient: dto.recipient,
      subject: dto.subject,
      body: dto.body,
      job_id: dto.jobId,
      customer_id: dto.customerId,
      status: 'queued',
    });
    const saved = await this.notifRepo.save(notification);

    // Immediately attempt to send
    await this.processOne(saved);

    return saved;
  }

  // ─── Dispatch with preference checking ───

  async dispatch(params: {
    tenantId: string;
    customerId: string;
    notificationType: string;
    subject?: string;
    emailBody?: string;
    smsBody?: string;
    jobId?: string;
    invoiceId?: string;
    forceSend?: boolean;
  }) {
    const customer = await this.customerRepo.findOne({
      where: { id: params.customerId, tenant_id: params.tenantId },
    });
    if (!customer) return;

    // Check preferences
    let emailEnabled = true;
    let smsEnabled = false;

    if (!params.forceSend) {
      const pref = await this.prefRepo.findOne({
        where: { tenant_id: params.tenantId, notification_type: params.notificationType },
      });
      if (pref) {
        emailEnabled = pref.email_enabled;
        smsEnabled = pref.sms_enabled;
      }

      const override = await this.overrideRepo.findOne({
        where: { customer_id: params.customerId, notification_type: params.notificationType, tenant_id: params.tenantId },
      });
      if (override) {
        if (override.email_enabled !== null) emailEnabled = override.email_enabled;
        if (override.sms_enabled !== null) smsEnabled = override.sms_enabled;
      }
    }

    // Dedup check (same type+customer+job within 1 hour)
    if (!params.forceSend) {
      const oneHourAgo = new Date(Date.now() - 3600_000);
      const recent = await this.notifRepo
        .createQueryBuilder('n')
        .where('n.tenant_id = :tid', { tid: params.tenantId })
        .andWhere('n.customer_id = :cid', { cid: params.customerId })
        .andWhere('n.type = :type', { type: params.notificationType })
        .andWhere('n.created_at > :since', { since: oneHourAgo })
        .getCount();
      if (recent > 0) return;
    }

    // Send email
    if (emailEnabled && customer.email && params.emailBody) {
      const notif = await this.notifRepo.save(this.notifRepo.create({
        tenant_id: params.tenantId,
        customer_id: params.customerId,
        channel: 'email',
        type: params.notificationType,
        recipient: customer.email,
        subject: params.subject || params.notificationType.replace(/_/g, ' '),
        body: params.emailBody,
        job_id: params.jobId || null,
        status: 'queued',
      }));
      await this.processOne(notif);
    }

    // Send SMS
    if (smsEnabled && customer.phone && params.smsBody) {
      const notif = await this.notifRepo.save(this.notifRepo.create({
        tenant_id: params.tenantId,
        customer_id: params.customerId,
        channel: 'sms',
        type: params.notificationType,
        recipient: customer.phone,
        body: params.smsBody,
        job_id: params.jobId || null,
        status: 'queued',
      }));
      await this.processOne(notif);
    }
  }

  // ─── Process a single notification via the real provider ───

  private async processOne(n: Notification) {
    try {
      if (n.channel === 'sms') {
        const result = await this.twilio.sendSms(n.recipient, n.body);
        n.status = result.success ? 'delivered' : 'failed';
        n.external_id = result.sid || null;
        n.error_message = result.error || null;
      } else if (n.channel === 'email') {
        const result = await this.resend.sendEmail({
          to: n.recipient,
          subject: n.subject || '',
          html: n.body,
        });
        n.status = result.success ? 'delivered' : 'failed';
        n.external_id = result.id || null;
        n.error_message = result.error || null;
      } else {
        n.status = 'failed';
        n.error_message = `Unsupported channel: ${n.channel}`;
      }
      if (n.status === 'delivered') n.sent_at = new Date();
    } catch (err: any) {
      n.status = 'failed';
      n.error_message = err.message;
    }
    await this.notifRepo.save(n);
  }

  // ─── Process queued (batch — for cron) ───

  async processQueuedNotifications(tenantId: string): Promise<number> {
    const queued = await this.notifRepo.find({
      where: { tenant_id: tenantId, status: 'queued' },
      order: { created_at: 'ASC' },
      take: 100,
    });
    for (const n of queued) await this.processOne(n);
    return queued.length;
  }

  // ─── Process scheduled notifications ───

  async processScheduled(tenantId?: string): Promise<number> {
    const now = new Date();
    const where: any = { status: 'pending', scheduled_for: LessThanOrEqual(now) };
    if (tenantId) where.tenant_id = tenantId;
    const pending = await this.scheduledRepo.find({
      where,
      take: 50,
    });

    let processed = 0;
    for (const sn of pending) {
      sn.status = 'sent';
      sn.processed_at = now;
      await this.scheduledRepo.save(sn);
      processed++;
    }
    return processed;
  }

  // ─── Schedule a future notification ───

  async schedule(params: {
    tenantId: string;
    customerId: string;
    notificationType: string;
    scheduledFor: Date;
    jobId?: string;
    invoiceId?: string;
  }) {
    return this.scheduledRepo.save(this.scheduledRepo.create({
      tenant_id: params.tenantId,
      customer_id: params.customerId,
      notification_type: params.notificationType,
      scheduled_for: params.scheduledFor,
      job_id: params.jobId || null,
      invoice_id: params.invoiceId || null,
    }));
  }

  // ─── Queries ───

  async findAll(tenantId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.notifRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.job', 'job')
      .leftJoinAndSelect('n.customer', 'customer')
      .where('n.tenant_id = :tenantId', { tenantId });

    if (query.channel) qb.andWhere('n.channel = :channel', { channel: query.channel });
    if (query.type) qb.andWhere('n.type = :type', { type: query.type });
    if (query.status) qb.andWhere('n.status = :status', { status: query.status });
    if (query.jobId) qb.andWhere('n.job_id = :jobId', { jobId: query.jobId });

    qb.orderBy('n.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getLogSummary(tenantId: string) {
    const rows = await this.notifRepo
      .createQueryBuilder('n')
      .select('n.type', 'type')
      .addSelect('n.channel', 'channel')
      .addSelect('n.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('n.tenant_id = :tenantId', { tenantId })
      .groupBy('n.type')
      .addGroupBy('n.channel')
      .addGroupBy('n.status')
      .getRawMany();

    const total = rows.reduce((s: number, r: any) => s + Number(r.count), 0);
    return { total, breakdown: rows };
  }

  async getPreferences(tenantId: string) {
    return this.prefRepo.find({
      where: { tenant_id: tenantId },
      order: { notification_type: 'ASC' },
    });
  }

  async updatePreference(tenantId: string, type: string, data: { email_enabled?: boolean; sms_enabled?: boolean }) {
    let pref = await this.prefRepo.findOne({
      where: { tenant_id: tenantId, notification_type: type },
    });
    if (!pref) {
      pref = this.prefRepo.create({ tenant_id: tenantId, notification_type: type });
    }
    if (data.email_enabled !== undefined) pref.email_enabled = data.email_enabled;
    if (data.sms_enabled !== undefined) pref.sms_enabled = data.sms_enabled;
    return this.prefRepo.save(pref);
  }

  async getClientOverrides(tenantId: string, customerId: string) {
    return this.overrideRepo.find({
      where: { tenant_id: tenantId, customer_id: customerId },
    });
  }

  async setClientOverride(tenantId: string, customerId: string, type: string, data: { email_enabled?: boolean | null; sms_enabled?: boolean | null }) {
    let ov = await this.overrideRepo.findOne({
      where: { customer_id: customerId, notification_type: type, tenant_id: tenantId },
    });
    if (!ov) {
      ov = this.overrideRepo.create({ tenant_id: tenantId, customer_id: customerId, notification_type: type });
    }
    if (data.email_enabled !== undefined) ov.email_enabled = data.email_enabled;
    if (data.sms_enabled !== undefined) ov.sms_enabled = data.sms_enabled;
    return this.overrideRepo.save(ov);
  }

  getTemplates() {
    return [
      { type: 'booking_confirmation', channels: ['sms', 'email'] },
      { type: 'delivery_reminder', channels: ['sms', 'email'] },
      { type: 'on_my_way', channels: ['sms', 'email'] },
      { type: 'service_completed', channels: ['sms', 'email'] },
      { type: 'pickup_reminder', channels: ['sms', 'email'] },
      { type: 'overdue_rental', channels: ['sms', 'email'] },
      { type: 'invoice_sent', channels: ['email'] },
      { type: 'payment_received', channels: ['sms', 'email'] },
    ];
  }
}
