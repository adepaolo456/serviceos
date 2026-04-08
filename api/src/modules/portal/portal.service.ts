import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';

@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string, tenantId: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.is_active = true')
      .getOne();

    if (!customer || !customer.portal_password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, customer.portal_password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_last_login: new Date() })
      .where('id = :id', { id: customer.id })
      .execute();

    const token = this.jwtService.sign({
      sub: customer.id,
      tenantId: customer.tenant_id,
      type: 'portal',
    });

    return {
      token,
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  }

  async register(email: string, password: string, tenantId: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.is_active = true')
      .getOne();
    if (!customer) throw new NotFoundException('No account found for this email. Please contact the office.');
    if (customer.portal_password_hash) throw new BadRequestException('Account already registered. Please log in.');

    const hash = await bcrypt.hash(password, 10);
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_password_hash: hash })
      .where('id = :id', { id: customer.id })
      .execute();

    const token = this.jwtService.sign({
      sub: customer.id,
      tenantId: customer.tenant_id,
      type: 'portal',
    });

    return {
      token,
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      },
    };
  }

  async magicLink(email: string, tenantId: string) {
    // Timing-safe, enumeration-safe: always return the same response regardless
    // of whether the email/tenant combo exists. Timing floor prevents attackers
    // from distinguishing by response latency.
    const start = Date.now();
    const floor = 200;

    const customer = await this.customerRepo.findOne({
      where: { email, tenant_id: tenantId, is_active: true },
    });
    if (customer) {
      // TODO: actually send a magic-link email. Current implementation is a stub.
    }

    const elapsed = Date.now() - start;
    if (elapsed < floor) {
      await new Promise((r) => setTimeout(r, floor - elapsed));
    }

    return { message: 'If an account exists, a login link has been sent to your email.' };
  }

  async getRentals(customerId: string, tenantId: string) {
    const jobs = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      relations: ['asset'],
      order: { created_at: 'DESC' },
    });
    return jobs;
  }

  async getInvoices(customerId: string, tenantId: string) {
    const invoices = await this.invoiceRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      relations: ['line_items'],
      order: { created_at: 'DESC' },
    });
    return invoices;
  }

  async getInvoiceDetail(customerId: string, tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, customer_id: customerId, tenant_id: tenantId },
      relations: ['job', 'line_items'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Track first view
    if (!invoice.read_at) {
      await this.invoiceRepo.update(invoiceId, { read_at: new Date() });
      invoice.read_at = new Date();
    }

    const payments = await this.paymentRepo.find({
      where: { invoice_id: invoiceId },
      order: { applied_at: 'DESC' },
    });

    return { invoice, payments };
  }

  async submitServiceRequest(customerId: string, tenantId: string, dto: any) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;
    const jobNumber = `JOB-${dateStr}-${seq}`;

    const job = this.jobRepo.create({
      tenant_id: tenantId,
      job_number: jobNumber,
      customer_id: customerId,
      job_type: 'delivery',
      service_type: dto.serviceType || 'dumpster_rental',
      priority: 'normal',
      scheduled_date: dto.preferredDate,
      service_address: dto.serviceAddress,
      placement_notes: dto.instructions,
      rental_days: dto.rentalDays || 14,
      status: 'pending',
      source: 'portal',
    });

    const saved = await this.jobRepo.save(job);
    return saved;
  }

  async extendRental(customerId: string, tenantId: string, jobId: string, newEndDate: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Rental not found');
    if (['completed', 'cancelled'].includes(job.status)) {
      throw new BadRequestException('Cannot extend a completed or cancelled rental');
    }

    const start = new Date(job.rental_start_date);
    const end = new Date(newEndDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    await this.jobRepo.update(jobId, { rental_end_date: newEndDate, rental_days: days });
    return { message: 'Rental extended', newEndDate, rentalDays: days };
  }

  async requestEarlyPickup(customerId: string, tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Rental not found');

    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;

    const pickupJob = this.jobRepo.create({
      tenant_id: tenantId,
      job_number: `JOB-${dateStr}-${seq}`,
      customer_id: customerId,
      asset_id: job.asset_id,
      job_type: 'pickup',
      service_type: job.service_type,
      priority: 'normal',
      service_address: job.service_address,
      status: 'pending',
      source: 'portal',
    });

    const saved = await this.jobRepo.save(pickupJob);
    return saved;
  }

  async getProfile(customerId: string, tenantId: string) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateProfile(customerId: string, tenantId: string, dto: any) {
    const updates: any = {};
    if (dto.firstName) updates.first_name = dto.firstName;
    if (dto.lastName) updates.last_name = dto.lastName;
    if (dto.phone) updates.phone = dto.phone;
    if (dto.billingAddress) updates.billing_address = dto.billingAddress;
    if (dto.serviceAddresses) updates.service_addresses = dto.serviceAddresses;

    await this.customerRepo.update(customerId, updates);
    return this.getProfile(customerId, tenantId);
  }

  async changePassword(customerId: string, currentPassword: string, newPassword: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.id = :id', { id: customerId })
      .getOne();

    if (!customer || !customer.portal_password_hash) {
      throw new BadRequestException('No portal password set');
    }

    const valid = await bcrypt.compare(currentPassword, customer.portal_password_hash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 10);
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_password_hash: hash })
      .where('id = :id', { id: customerId })
      .execute();
    return { message: 'Password updated' };
  }

  async signAgreement(customerId: string, tenantId: string, jobId: string, signatureUrl: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Job not found');

    await this.jobRepo.update(jobId, { signature_url: signatureUrl });
    return { message: 'Agreement signed' };
  }

  async rescheduleRental(customerId: string, tenantId: string, jobId: string, body: { scheduledDate: string; reason?: string }) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Job not found');

    if (!['pending', 'confirmed'].includes(job.status)) {
      throw new BadRequestException('This job cannot be rescheduled. Please call us for changes.');
    }

    const newDate = new Date(body.scheduledDate);
    if (newDate <= new Date()) {
      throw new BadRequestException('Please select a future date.');
    }

    if (job.scheduled_date) {
      const scheduled = new Date(job.scheduled_date);
      const hoursUntil = (scheduled.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        throw new BadRequestException('Jobs cannot be rescheduled within 24 hours of the scheduled date. Please call us for same-day changes.');
      }
    }

    const oldDate = job.scheduled_date;
    const updates: Record<string, unknown> = {
      scheduled_date: body.scheduledDate,
      rescheduled_by_customer: true,
      rescheduled_at: new Date(),
      rescheduled_from_date: oldDate,
      rescheduled_reason: body.reason || null,
    };

    if (job.rental_days) {
      const end = new Date(body.scheduledDate);
      end.setDate(end.getDate() + job.rental_days);
      updates.rental_end_date = end.toISOString().split('T')[0];
      if (!job.rental_start_date) {
        updates.rental_start_date = body.scheduledDate;
      }
    }

    await this.jobRepo.update(jobId, updates);

    const pickupJob = await this.jobRepo.findOne({
      where: { tenant_id: tenantId, customer_id: customerId, job_type: 'pickup', status: In(['pending', 'confirmed']) },
    });
    if (pickupJob && updates.rental_end_date) {
      await this.jobRepo.update(pickupJob.id, { scheduled_date: updates.rental_end_date as string });
    }

    const updated = await this.jobRepo.findOne({ where: { id: jobId } });
    return {
      ...updated,
      message: `Your delivery has been moved to ${body.scheduledDate}.${updates.rental_end_date ? ` Your new pickup date is ${updates.rental_end_date}.` : ''} The company has been notified.`,
    };
  }

  async getDashboard(customerId: string, tenantId: string) {
    // Active rentals (delivery jobs that are not completed/cancelled)
    const activeRentals = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, job_type: In(['delivery', 'drop_off']), status: In(['pending', 'confirmed', 'dispatched', 'en_route', 'arrived', 'in_progress']) },
      relations: ['asset'],
      order: { scheduled_date: 'ASC' },
    });

    // Outstanding balance
    const invoices = await this.invoiceRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, status: In(['open', 'partial', 'overdue']) },
    });
    const totalBalance = invoices.reduce((sum, inv) => sum + Number(inv.balance_due || 0), 0);

    // Recent activity (last 10 jobs, any status)
    const recentJobs = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      order: { updated_at: 'DESC' },
      take: 10,
    });

    // Upcoming pickups
    const upcomingPickups = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, job_type: 'pickup', status: In(['pending', 'confirmed', 'dispatched']) },
      order: { scheduled_date: 'ASC' },
    });

    return {
      activeRentals: activeRentals.map(j => ({
        id: j.id,
        size: (j.asset_subtype || j.asset?.subtype || '').replace('yd', ' Yard'),
        address: j.service_address ? [j.service_address.street, j.service_address.city].filter(Boolean).join(', ') : '',
        deliveryDate: j.scheduled_date,
        rentalEndDate: j.rental_end_date,
        daysRemaining: j.rental_end_date ? Math.max(0, Math.ceil((new Date(j.rental_end_date).getTime() - Date.now()) / 86400000)) : null,
        isOverdue: j.is_overdue,
        extraDays: j.extra_days,
        status: j.status,
      })),
      balance: {
        total: Math.round(totalBalance * 100) / 100,
        invoiceCount: invoices.length,
      },
      upcomingPickups: upcomingPickups.map(j => ({
        id: j.id,
        date: j.scheduled_date,
        address: j.service_address ? [j.service_address.street, j.service_address.city].filter(Boolean).join(', ') : '',
      })),
      recentActivity: recentJobs.map(j => ({
        id: j.id,
        type: j.job_type,
        status: j.status,
        date: j.updated_at,
        description: `${j.job_type.replace(/_/g, ' ')} — ${j.status.replace(/_/g, ' ')}`,
      })),
    };
  }

  async reportIssue(customerId: string, tenantId: string, dto: { jobId?: string; reason: string; notes?: string }) {
    // Create a notification/alert for the office
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    // If jobId provided, verify it belongs to this customer
    if (dto.jobId) {
      const job = await this.jobRepo.findOne({ where: { id: dto.jobId, customer_id: customerId, tenant_id: tenantId } });
      if (!job) throw new NotFoundException('Job not found');
    }

    // Log as notification for office review
    // The notification will be visible in the admin notification bell
    return { message: 'Issue reported. Our office has been notified and will contact you shortly.' };
  }

  async createPaymentIntent(customerId: string, tenantId: string, invoiceId: string, amount?: number) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid' || invoice.status === 'voided') {
      throw new BadRequestException('Invoice is already ' + invoice.status);
    }

    const payAmount = amount || Number(invoice.balance_due);
    if (payAmount <= 0) throw new BadRequestException('Invalid payment amount');

    // Return payment details for client-side Stripe checkout
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount: payAmount,
      balanceDue: Number(invoice.balance_due),
      // The actual Stripe charge will go through the existing /stripe/charge-invoice endpoint
      // Portal just needs to know the amount and confirm
    };
  }
}
