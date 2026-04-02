import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In, IsNull, Not } from 'typeorm';
import { AutomationLog } from './entities/automation-log.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(AutomationLog) private logRepo: Repository<AutomationLog>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(PricingRule) private pricingRepo: Repository<PricingRule>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    private notificationsService: NotificationsService,
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
      });

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

        await this.logRepo.save(this.logRepo.create({
          tenant_id: job.tenant_id,
          job_id: job.id,
          type: 'overdue_notification',
          status: 'sent',
          details: {
            customerName: job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : null,
            extraDays, charges, rate,
            assetIdentifier: job.asset?.identifier,
          },
        }));
      }
    }

    // Log the scan
    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId || 'all',
      type: 'overdue_scan',
      status: 'completed',
      details: { overdueCount: jobs.length, totalExtraCharges, notificationsSent, date: today },
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

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      type: 'overdue_notification',
      status: 'sent',
      details: {
        customerName: job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : null,
        extraDays: job.extra_days,
        charges: job.extra_day_charges,
      },
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

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      type: 'overdue_action',
      status: 'completed',
      details: { action, days },
    }));

    return { message: `Action '${action}' completed`, jobId, action };
  }

  async getLog(tenantId: string) {
    return this.logRepo.find({
      where: { tenant_id: tenantId },
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

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId,
      type: 'overdue_reminders',
      status: 'completed',
      details: { overdueCount: overdueInvoices.length, remindersSent },
    }));

    return { overdueCount: overdueInvoices.length, remindersSent };
  }
}
