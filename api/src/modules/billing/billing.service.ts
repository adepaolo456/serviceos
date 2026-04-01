import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Job } from '../jobs/entities/job.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  ListInvoicesQueryDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
} from './dto/billing.dto';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(AutomationLog)
    private logRepo: Repository<AutomationLog>,
    private notificationsService: NotificationsService,
  ) {}

  async createInvoice(
    tenantId: string,
    dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    const subtotal = dto.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const taxRate = dto.taxRate ?? 0;
    const discountAmount = dto.discountAmount ?? 0;
    const taxAmount =
      Math.round((subtotal - discountAmount) * taxRate * 100) / 100;
    const total =
      Math.round((subtotal - discountAmount + taxAmount) * 100) / 100;

    const invoice = this.invoicesRepository.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: dto.customerId,
      job_id: dto.jobId,
      due_date: dto.dueDate,
      line_items: dto.lineItems,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      discount_amount: discountAmount,
      total,
      amount_paid: 0,
      balance_due: total,
      notes: dto.notes,
    });

    return this.invoicesRepository.save(invoice);
  }

  async findAllInvoices(tenantId: string, query: ListInvoicesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.invoicesRepository
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'customer')
      .leftJoinAndSelect('i.job', 'job')
      .where('i.tenant_id = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('i.status = :status', { status: query.status });
    }

    if (query.customerId) {
      qb.andWhere('i.customer_id = :customerId', {
        customerId: query.customerId,
      });
    }

    if (query.dateFrom) {
      qb.andWhere('i.created_at >= :dateFrom', { dateFrom: query.dateFrom });
    }

    if (query.dateTo) {
      qb.andWhere('i.created_at <= :dateTo', {
        dateTo: `${query.dateTo} 23:59:59`,
      });
    }

    qb.orderBy('i.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneInvoice(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['customer', 'job'],
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  async updateInvoice(
    tenantId: string,
    id: string,
    dto: UpdateInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, id);

    if (dto.customerId !== undefined) invoice.customer_id = dto.customerId;
    if (dto.jobId !== undefined) invoice.job_id = dto.jobId;
    if (dto.dueDate !== undefined) invoice.due_date = dto.dueDate;
    if (dto.notes !== undefined) invoice.notes = dto.notes;
    if (dto.status !== undefined) invoice.status = dto.status;

    if (dto.lineItems !== undefined) {
      invoice.line_items = dto.lineItems;
      const subtotal = dto.lineItems.reduce(
        (sum, item) => sum + item.amount,
        0,
      );
      const taxRate =
        dto.taxRate !== undefined ? dto.taxRate : Number(invoice.tax_rate);
      const discountAmount =
        dto.discountAmount !== undefined
          ? dto.discountAmount
          : Number(invoice.discount_amount);
      const taxAmount =
        Math.round((subtotal - discountAmount) * taxRate * 100) / 100;
      const total =
        Math.round((subtotal - discountAmount + taxAmount) * 100) / 100;

      invoice.subtotal = subtotal;
      invoice.tax_rate = taxRate;
      invoice.tax_amount = taxAmount;
      invoice.discount_amount = discountAmount;
      invoice.total = total;
      invoice.balance_due =
        Math.round((total - Number(invoice.amount_paid)) * 100) / 100;
    } else {
      if (dto.taxRate !== undefined) invoice.tax_rate = dto.taxRate;
      if (dto.discountAmount !== undefined)
        invoice.discount_amount = dto.discountAmount;
    }

    return this.invoicesRepository.save(invoice);
  }

  async sendInvoice(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, id);
    if (invoice.status !== 'draft') {
      throw new BadRequestException(
        `Cannot send invoice with status "${invoice.status}"`,
      );
    }
    invoice.status = 'sent';
    invoice.sent_at = new Date();
    const saved = await this.invoicesRepository.save(invoice);

    // Queue invoice sent notification
    try {
      const invoiceWithCustomer = await this.invoicesRepository.findOne({
        where: { id },
        relations: ['customer'],
      });
      const cust = invoiceWithCustomer?.customer;
      if (cust?.email) {
        await this.notificationsService.send(tenantId, {
          channel: 'email',
          type: 'invoice_sent',
          recipient: cust.email,
          subject: `Invoice ${saved.invoice_number} - $${saved.total}`,
          body: `Hi ${cust.first_name} ${cust.last_name},\n\nInvoice ${saved.invoice_number} for $${saved.total} has been sent. Due by ${saved.due_date}.\n\nThank you for your business!`,
          customerId: cust.id,
          jobId: saved.job_id,
        });
      }
    } catch { /* best effort */ }

    return saved;
  }

  async editInvoice(
    tenantId: string,
    id: string,
    body: Record<string, unknown>,
    userId?: string,
    userName?: string,
  ): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, id);

    if (invoice.status === 'void') {
      throw new BadRequestException('Cannot edit a voided invoice');
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const isPaid = invoice.status === 'paid';

    // Paid invoices: only notes editable
    if (body.notes !== undefined) {
      if (invoice.notes !== body.notes) {
        changes.notes = { from: invoice.notes, to: body.notes };
        invoice.notes = body.notes as string;
      }
    }

    if (!isPaid) {
      if (body.lineItems !== undefined) {
        const newItems = body.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>;
        changes.line_items = { from: invoice.line_items, to: newItems };
        invoice.line_items = newItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          amount: Math.round(li.quantity * li.unitPrice * 100) / 100,
        }));
      }

      if (body.dueDate !== undefined && body.dueDate !== invoice.due_date) {
        changes.due_date = { from: invoice.due_date, to: body.dueDate };
        invoice.due_date = body.dueDate as string;
      }

      if (body.discountAmount !== undefined) {
        const newDisc = Number(body.discountAmount);
        if (newDisc !== Number(invoice.discount_amount)) {
          changes.discount_amount = { from: invoice.discount_amount, to: newDisc };
          invoice.discount_amount = newDisc;
        }
      }
    }

    // Recalculate totals if line items or discount changed
    if (changes.line_items || changes.discount_amount) {
      const subtotal = invoice.line_items.reduce((s, li) => s + li.amount, 0);
      const discount = Number(invoice.discount_amount) || 0;
      const taxRate = Number(invoice.tax_rate) || 0;
      const taxAmount = Math.round((subtotal - discount) * taxRate * 100) / 100;
      const total = Math.round((subtotal - discount + taxAmount) * 100) / 100;

      invoice.subtotal = subtotal;
      invoice.tax_amount = taxAmount;
      invoice.total = total;
      invoice.balance_due = Math.round((total - Number(invoice.amount_paid)) * 100) / 100;
    }

    const saved = await this.invoicesRepository.save(invoice);

    // Audit log
    if (Object.keys(changes).length > 0) {
      try {
        await this.logRepo.save(this.logRepo.create({
          tenant_id: tenantId,
          type: 'invoice_edited',
          status: 'completed',
          details: {
            entity_type: 'invoice',
            entity_id: id,
            invoice_number: invoice.invoice_number,
            action: 'edited',
            user_id: userId,
            user_name: userName,
            changes,
          },
        }));
      } catch { /* best effort */ }
    }

    return saved;
  }

  async getInvoiceHistory(tenantId: string, id: string) {
    await this.findOneInvoice(tenantId, id);

    const logs = await this.logRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    // Filter to logs related to this invoice
    return logs.filter(log => {
      const details = log.details as Record<string, unknown> || {};
      return (
        (details.entity_type === 'invoice' && details.entity_id === id) ||
        (details.invoiceId === id) ||
        (log.job_id && details.invoice_number)
      );
    }).slice(0, 50);
  }

  async markOverdueInvoices(tenantId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.invoicesRepository
      .createQueryBuilder()
      .update()
      .set({ status: 'overdue' })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: 'sent' })
      .andWhere('due_date < :today', { today })
      .execute();
    return result.affected || 0;
  }

  async createFromJob(tenantId: string, jobId: string): Promise<Invoice> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId, tenant_id: tenantId },
      relations: ['customer', 'asset'],
    });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (job.status !== 'completed') {
      throw new BadRequestException(
        `Job must be completed to generate an invoice (current: "${job.status}")`,
      );
    }

    const lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }> = [];

    const basePrice = Number(job.base_price) || 0;
    if (basePrice > 0) {
      const rentalDays = job.rental_days || 1;
      lineItems.push({
        description: `${job.service_type ?? job.job_type} - ${job.asset?.identifier ?? 'Service'}${rentalDays > 1 ? `, ${rentalDays} days` : ''}`,
        quantity: 1,
        unitPrice: basePrice,
        amount: basePrice,
      });
    }

    const totalPrice = Number(job.total_price) || 0;
    const extraCharges = totalPrice - basePrice;
    if (extraCharges > 0) {
      lineItems.push({
        description: 'Additional charges (delivery, distance, extra days)',
        quantity: 1,
        unitPrice: extraCharges,
        amount: extraCharges,
      });
    }

    if (lineItems.length === 0) {
      lineItems.push({
        description: `${job.service_type ?? job.job_type} - Job #${job.job_number}`,
        quantity: 1,
        unitPrice: totalPrice,
        amount: totalPrice,
      });
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    return this.createInvoice(tenantId, {
      customerId: job.customer_id,
      jobId: job.id,
      lineItems,
      dueDate: dueDate.toISOString().split('T')[0],
      notes: `Invoice for Job #${job.job_number}`,
    });
  }

  async createPayment(
    tenantId: string,
    dto: CreatePaymentDto,
  ): Promise<Payment> {
    const invoice = await this.findOneInvoice(tenantId, dto.invoiceId);

    if (invoice.status === 'void') {
      throw new BadRequestException('Cannot pay a voided invoice');
    }

    const status = dto.status ?? 'succeeded';
    const now = new Date();

    const payment = this.paymentsRepository.create({
      tenant_id: tenantId,
      invoice_id: dto.invoiceId,
      customer_id: invoice.customer_id,
      amount: dto.amount,
      payment_method: dto.paymentMethod,
      status,
      notes: dto.notes,
      processed_at: status === 'succeeded' ? now : undefined,
    });
    const savedPayment = await this.paymentsRepository.save(payment);

    if (status === 'succeeded') {
      const newAmountPaid =
        Math.round((Number(invoice.amount_paid) + dto.amount) * 100) / 100;
      const newBalance =
        Math.round((Number(invoice.total) - newAmountPaid) * 100) / 100;

      invoice.amount_paid = newAmountPaid;
      invoice.balance_due = Math.max(0, newBalance);

      if (invoice.balance_due <= 0) {
        invoice.status = 'paid';
        invoice.paid_at = now;
      }

      await this.invoicesRepository.save(invoice);
    }

    return savedPayment;
  }

  async findAllPayments(tenantId: string, query: ListPaymentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.paymentsRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.invoice', 'invoice')
      .leftJoinAndSelect('p.customer', 'customer')
      .where('p.tenant_id = :tenantId', { tenantId });

    if (query.invoiceId) {
      qb.andWhere('p.invoice_id = :invoiceId', {
        invoiceId: query.invoiceId,
      });
    }

    if (query.customerId) {
      qb.andWhere('p.customer_id = :customerId', {
        customerId: query.customerId,
      });
    }

    qb.orderBy('p.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Internal invoice creation for automated flows (job creation, failed trips,
   * pickup completion, exchanges, public bookings). Accepts source/type metadata
   * and an optional EntityManager for transactional use.
   */
  async createInternalInvoice(
    tenantId: string,
    params: {
      customerId: string;
      jobId?: string;
      source: string;
      invoiceType: string;
      status?: string;
      lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
      paymentMethod?: string;
      notes?: string;
      discountAmount?: number;
      dueDate?: string;
    },
    manager?: EntityManager,
  ): Promise<Invoice> {
    const repo = manager ? manager.getRepository(Invoice) : this.invoicesRepository;
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    const subtotal = params.lineItems.reduce((s, li) => s + li.amount, 0);
    const discount = params.discountAmount ?? 0;
    const total = Math.round((subtotal - discount) * 100) / 100;
    const isPaid = params.status === 'paid';
    const now = new Date();

    const invoice = repo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: params.customerId,
      job_id: params.jobId || null,
      status: params.status || 'draft',
      source: params.source,
      invoice_type: params.invoiceType,
      payment_method: params.paymentMethod,
      due_date: params.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      subtotal,
      discount_amount: discount,
      total,
      amount_paid: isPaid ? total : 0,
      balance_due: isPaid ? 0 : total,
      line_items: params.lineItems,
      notes: params.notes,
      paid_at: isPaid ? now : null,
    } as Partial<Invoice>);

    return repo.save(invoice);
  }

  async hasInvoice(tenantId: string, jobId: string, source: string): Promise<boolean> {
    const count = await this.invoicesRepository.count({
      where: { tenant_id: tenantId, job_id: jobId, source },
    });
    return count > 0;
  }

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.invoicesRepository
      .createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.invoice_number LIKE :prefix', {
        prefix: `INV-${year}-%`,
      })
      .getCount();
    const seq = String(count + 1).padStart(4, '0');
    return `INV-${year}-${seq}`;
  }
}
