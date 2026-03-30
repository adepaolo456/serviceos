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

  async login(email: string, password: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
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

  async register(email: string, password: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
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

  async magicLink(email: string) {
    const customer = await this.customerRepo.findOne({ where: { email, is_active: true } });
    if (!customer) throw new NotFoundException('No account found for this email');
    // Placeholder — in production, send email with a signed magic link
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
      order: { created_at: 'DESC' },
    });
    return invoices;
  }

  async getInvoiceDetail(customerId: string, tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, customer_id: customerId, tenant_id: tenantId },
      relations: ['job'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const payments = await this.paymentRepo.find({
      where: { invoice_id: invoiceId } as any,
      order: { created_at: 'DESC' },
    });

    return { invoice, payments };
  }

  async submitServiceRequest(customerId: string, tenantId: string, dto: any) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    // Generate job number
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

    await this.jobRepo.update(jobId, {
      rental_end_date: newEndDate,
      rental_days: days,
    });

    return { message: 'Rental extended', newEndDate, rentalDays: days };
  }

  async requestEarlyPickup(customerId: string, tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Rental not found');

    // Create a pickup job
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

  async getProfile(customerId: string) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateProfile(customerId: string, dto: any) {
    const updates: any = {};
    if (dto.firstName) updates.first_name = dto.firstName;
    if (dto.lastName) updates.last_name = dto.lastName;
    if (dto.phone) updates.phone = dto.phone;
    if (dto.billingAddress) updates.billing_address = dto.billingAddress;
    if (dto.serviceAddresses) updates.service_addresses = dto.serviceAddresses;

    await this.customerRepo.update(customerId, updates);
    return this.getProfile(customerId);
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
}
