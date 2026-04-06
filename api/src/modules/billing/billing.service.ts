import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Payment } from './entities/payment.entity';
import { CreditMemo } from './entities/credit-memo.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
    @InjectRepository(PricingRule)
    private pricingRepo: Repository<PricingRule>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  private async getNextInvoiceNumber(tenantId: string): Promise<number> {
    const result = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`,
      [tenantId],
    );
    return result[0].num;
  }

  async createInvoice(
    tenantId: string,
    dto: {
      customerId: string;
      jobId?: string;
      dueDate?: string;
      lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
      taxRate?: number;
      discountAmount?: number;
      notes?: string;
    },
  ): Promise<Invoice> {
    const invoiceNumber = await this.getNextInvoiceNumber(tenantId);
    const today = new Date().toISOString().split('T')[0];

    const invoice = this.invoicesRepository.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: dto.customerId,
      job_id: dto.jobId || null,
      invoice_date: today,
      due_date: dto.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      summary_of_work: dto.notes,
      tax_amount: 0,
    });

    const saved = await this.invoicesRepository.save(invoice);

    // Create line items
    const taxRate = dto.taxRate ?? 0;
    const discountAmount = dto.discountAmount ?? 0;

    for (let i = 0; i < dto.lineItems.length; i++) {
      const li = dto.lineItems[i];
      const amount = li.amount || li.quantity * li.unitPrice;
      const lineItem = this.lineItemRepo.create({
        invoice_id: saved.id,
        sort_order: i,
        line_type: 'service',
        name: li.description,
        quantity: li.quantity,
        unit_rate: li.unitPrice,
        amount,
        net_amount: amount,
        is_taxable: taxRate > 0,
        tax_rate: taxRate,
        tax_amount: taxRate > 0 ? Math.round(amount * taxRate * 100) / 100 : 0,
      });
      await this.lineItemRepo.save(lineItem);
    }

    // Recalculate
    await this.recalculate(saved.id);

    // Resolve rental chain from job
    if (dto.jobId) {
      try {
        const link = await this.dataSource.query(
          'SELECT rental_chain_id FROM task_chain_links WHERE job_id = $1 LIMIT 1',
          [dto.jobId],
        );
        if (link?.[0]?.rental_chain_id) {
          await this.invoicesRepository.update(saved.id, { rental_chain_id: link[0].rental_chain_id });
        }
      } catch { /* non-fatal */ }
    }

    return this.findOneInvoice(tenantId, saved.id);
  }

  async findAllInvoices(tenantId: string, query: { status?: string; customerId?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.invoicesRepository
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'customer')
      .leftJoinAndSelect('i.job', 'job')
      .leftJoinAndSelect('i.line_items', 'line_items')
      .where('i.tenant_id = :tenantId', { tenantId });

    if (query.status) qb.andWhere('i.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('i.customer_id = :customerId', { customerId: query.customerId });
    if (query.dateFrom) qb.andWhere('i.created_at >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('i.created_at <= :dateTo', { dateTo: `${query.dateTo} 23:59:59` });

    qb.orderBy('i.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneInvoice(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['customer', 'job', 'job.asset', 'line_items', 'payments'],
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async updateInvoice(tenantId: string, id: string, dto: any): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, id);
    const derivedStatuses = ['paid', 'partial', 'open', 'voided'];
    if (dto.status && derivedStatuses.includes(dto.status)) {
      throw new BadRequestException('Statuses "open", "partial", "paid", and "voided" are system-derived and cannot be set directly.');
    }
    if (dto.customerId !== undefined) invoice.customer_id = dto.customerId;
    if (dto.jobId !== undefined) invoice.job_id = dto.jobId;
    if (dto.dueDate !== undefined) invoice.due_date = dto.dueDate;
    if (dto.notes !== undefined) invoice.summary_of_work = dto.notes;
    if (dto.status !== undefined) invoice.status = dto.status;
    return this.invoicesRepository.save(invoice);
  }

  async sendInvoice(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, id);
    if (invoice.status !== 'draft') {
      throw new BadRequestException(`Cannot send invoice with status "${invoice.status}"`);
    }
    invoice.status = 'open';
    invoice.sent_at = new Date();
    invoice.sent_method = 'email';
    const saved = await this.invoicesRepository.save(invoice);

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
          subject: `Invoice #${saved.invoice_number} - $${saved.total}`,
          body: `Hi ${cust.first_name} ${cust.last_name},\n\nInvoice #${saved.invoice_number} for $${saved.total} has been sent. Due by ${saved.due_date}.\n\nThank you for your business!`,
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
    if (invoice.status === 'voided') {
      throw new BadRequestException('Cannot edit a voided invoice');
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const isPaid = invoice.status === 'paid';

    if (body.notes !== undefined) {
      if (invoice.summary_of_work !== body.notes) {
        changes.notes = { from: invoice.summary_of_work, to: body.notes };
        invoice.summary_of_work = body.notes as string;
      }
    }

    if (!isPaid) {
      if (body.lineItems !== undefined) {
        const newItems = body.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>;
        changes.line_items = { from: invoice.line_items, to: newItems };
        // Delete existing line items and re-create
        await this.lineItemRepo.delete({ invoice_id: id });
        for (let i = 0; i < newItems.length; i++) {
          const li = newItems[i];
          const amount = Math.round(li.quantity * li.unitPrice * 100) / 100;
          const lineItem = this.lineItemRepo.create({
            invoice_id: id,
            sort_order: i,
            line_type: 'service',
            name: li.description,
            quantity: li.quantity,
            unit_rate: li.unitPrice,
            amount,
            net_amount: amount,
          });
          await this.lineItemRepo.save(lineItem);
        }
      }

      if (body.dueDate !== undefined && body.dueDate !== invoice.due_date) {
        changes.due_date = { from: invoice.due_date, to: body.dueDate };
        invoice.due_date = body.dueDate as string;
      }
    }

    await this.invoicesRepository.save(invoice);
    if (changes.line_items) {
      await this.recalculate(id);
    }

    const saved = await this.findOneInvoice(tenantId, id);

    // Audit log
    if (Object.keys(changes).length > 0) {
      try {
        await this.notifRepo.save(this.notifRepo.create({
          tenant_id: tenantId,
          channel: 'automation',
          type: 'invoice_edited',
          recipient: 'system',
          body: JSON.stringify({
            entity_type: 'invoice',
            entity_id: id,
            invoice_number: invoice.invoice_number,
            action: 'edited',
            user_id: userId,
            user_name: userName,
            changes,
          }),
          status: 'logged',
          sent_at: new Date(),
        }));
      } catch { /* best effort */ }
    }

    // Size change cascade
    const newSubtype = body.newAssetSubtype as string | undefined;
    if (newSubtype && !isPaid && saved.job_id) {
      try {
        const cascadeResult = await this.cascadeSizeChange(tenantId, saved, newSubtype, userId, userName);
        return { ...saved, cascade: cascadeResult } as any;
      } catch { /* best effort */ }
    }

    return saved;
  }

  private async cascadeSizeChange(
    tenantId: string,
    invoice: Invoice,
    newSubtype: string,
    userId?: string,
    userName?: string,
  ) {
    const oldTotal = Number(invoice.total);

    const rule = await this.pricingRepo.findOne({
      where: { tenant_id: tenantId, asset_subtype: newSubtype, is_active: true },
    });
    if (!rule) throw new BadRequestException(`No pricing rule found for ${newSubtype}`);

    const newBasePrice = Number(rule.base_price);
    const newDeliveryFee = Number(rule.delivery_fee) || 0;
    const rentalDays = Number(rule.rental_period_days) || 7;
    const newTotal = newBasePrice + newDeliveryFee;
    const difference = newTotal - oldTotal;

    // Replace line items
    await this.lineItemRepo.delete({ invoice_id: invoice.id });
    const rentalItem = this.lineItemRepo.create({
      invoice_id: invoice.id, sort_order: 0, line_type: 'rental',
      name: `${newSubtype} Dumpster Rental`, quantity: 1, unit_rate: newBasePrice,
      amount: newBasePrice, net_amount: newBasePrice,
    });
    await this.lineItemRepo.save(rentalItem);

    if (newDeliveryFee > 0) {
      const deliveryItem = this.lineItemRepo.create({
        invoice_id: invoice.id, sort_order: 1, line_type: 'fee',
        name: 'Delivery Fee', quantity: 1, unit_rate: newDeliveryFee,
        amount: newDeliveryFee, net_amount: newDeliveryFee,
      });
      await this.lineItemRepo.save(deliveryItem);
    }

    await this.recalculate(invoice.id);
    const updated = await this.findOneInvoice(tenantId, invoice.id);

    // Update the linked job
    let assetWarning: string | null = null;
    const job = await this.jobsRepository.findOne({ where: { id: invoice.job_id, tenant_id: tenantId } });
    if (job) {
      const oldSubtype = job.asset_subtype;
      job.asset_subtype = newSubtype;
      job.base_price = newBasePrice;
      job.total_price = newTotal;
      job.rental_days = rentalDays;
      job.extra_day_rate = Number(rule.extra_day_rate) || 0;
      await this.jobsRepository.save(job);

      if (job.asset_id && oldSubtype !== newSubtype) {
        await this.assetRepo.update(job.asset_id, {
          status: 'available', current_job_id: null, current_location_type: 'yard',
        } as any);

        const available = await this.assetRepo
          .createQueryBuilder('a')
          .where('a.tenant_id = :tenantId', { tenantId })
          .andWhere('a.subtype = :subtype', { subtype: newSubtype })
          .andWhere('a.status NOT IN (:...excluded)', { excluded: ['reserved', 'deployed', 'on_site', 'in_transit'] })
          .andWhere('a.current_job_id IS NULL')
          .orderBy('a.created_at', 'DESC')
          .getOne();

        if (available) {
          await this.assetRepo.update(available.id, { status: 'reserved', current_job_id: job.id } as any);
          await this.jobsRepository.update(job.id, { asset_id: available.id });
        } else {
          await this.jobsRepository.update(job.id, { asset_id: null } as any);
          assetWarning = `No ${newSubtype} assets available — asset needs manual assignment`;
        }
      }

      const pickupJobs = await this.jobsRepository.find({
        where: { tenant_id: tenantId, parent_job_id: job.id, job_type: 'pickup' },
      });
      for (const pickup of pickupJobs) {
        pickup.asset_subtype = newSubtype;
        pickup.base_price = newBasePrice;
        pickup.total_price = newTotal;
        if (job.asset_id) pickup.asset_id = job.asset_id;
        await this.jobsRepository.save(pickup);
      }

      await this.notifRepo.save(this.notifRepo.create({
        tenant_id: tenantId, job_id: job.id, channel: 'automation', type: 'size_change_cascade',
        recipient: 'system',
        body: JSON.stringify({
          entity_type: 'invoice', entity_id: invoice.id,
          old_subtype: oldSubtype, new_subtype: newSubtype,
          old_total: oldTotal, new_total: newTotal, difference,
          asset_warning: assetWarning,
          user_id: userId, user_name: userName,
        }),
        status: 'logged', sent_at: new Date(),
      }));
    }

    return {
      upgrade: difference > 0, downgrade: difference < 0,
      difference: Math.abs(difference), newTotal: updated.total,
      newBalanceDue: updated.balance_due, credit: 0, assetWarning,
    };
  }

  async getInvoiceHistory(tenantId: string, id: string) {
    await this.findOneInvoice(tenantId, id);
    const logs = await this.notifRepo.find({
      where: { tenant_id: tenantId, channel: 'automation' },
      order: { created_at: 'DESC' },
    });
    return logs.filter(log => {
      try {
        const details = JSON.parse(log.body) as Record<string, unknown>;
        return (
          (details.entity_type === 'invoice' && details.entity_id === id) ||
          (details.invoiceId === id)
        );
      } catch { return false; }
    }).slice(0, 50);
  }

  async markOverdueInvoices(tenantId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.invoicesRepository
      .createQueryBuilder()
      .update()
      .set({ status: 'overdue' })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: 'open' })
      .andWhere('due_date < :today', { today })
      .execute();
    return result.affected || 0;
  }

  async createFromJob(tenantId: string, jobId: string): Promise<Invoice> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId, tenant_id: tenantId },
      relations: ['customer', 'asset'],
    });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (job.status !== 'completed') {
      throw new BadRequestException(`Job must be completed to generate an invoice (current: "${job.status}")`);
    }

    const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = [];
    const basePrice = Number(job.base_price) || 0;
    if (basePrice > 0) {
      const rentalDays = job.rental_days || 1;
      lineItems.push({
        description: `${job.service_type ?? job.job_type} - ${job.asset?.identifier ?? 'Service'}${rentalDays > 1 ? `, ${rentalDays} days` : ''}`,
        quantity: 1, unitPrice: basePrice, amount: basePrice,
      });
    }

    const totalPrice = Number(job.total_price) || 0;
    const extraCharges = totalPrice - basePrice;
    if (extraCharges > 0) {
      lineItems.push({
        description: 'Additional charges (delivery, distance, extra days)',
        quantity: 1, unitPrice: extraCharges, amount: extraCharges,
      });
    }

    if (lineItems.length === 0) {
      lineItems.push({
        description: `${job.service_type ?? job.job_type} - Job #${job.job_number}`,
        quantity: 1, unitPrice: totalPrice, amount: totalPrice,
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

  async createPayment(tenantId: string, dto: { invoiceId: string; amount: number; paymentMethod: string; status?: string; notes?: string }): Promise<Payment> {
    const invoice = await this.findOneInvoice(tenantId, dto.invoiceId);
    if (invoice.status === 'voided') throw new BadRequestException('Cannot pay a voided invoice');

    const status = dto.status ?? 'completed';
    const payment = this.paymentsRepository.create({
      tenant_id: tenantId,
      invoice_id: dto.invoiceId,
      amount: dto.amount,
      payment_method: dto.paymentMethod,
      status,
      notes: dto.notes,
    });
    const savedPayment = await this.paymentsRepository.save(payment);

    if (status === 'completed') {
      // Derive balance from actual payments
      const allPayments = await this.paymentsRepository.find({
        where: { invoice_id: dto.invoiceId, status: 'completed' },
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);
      const newStatus = balanceDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : invoice.status;
      const paidAt = newStatus === 'paid' ? new Date() : invoice.paid_at;
      await this.invoicesRepository.update(dto.invoiceId, {
        amount_paid: Math.round(totalPaid * 100) / 100,
        balance_due: balanceDue,
        status: newStatus,
        paid_at: paidAt,
      });
    }

    return savedPayment;
  }

  async findAllPayments(tenantId: string, query: { invoiceId?: string; customerId?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.paymentsRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.invoice', 'invoice')
      .where('p.tenant_id = :tenantId', { tenantId });

    if (query.invoiceId) qb.andWhere('p.invoice_id = :invoiceId', { invoiceId: query.invoiceId });
    if (query.customerId) qb.andWhere('invoice.customer_id = :customerId', { customerId: query.customerId });

    qb.orderBy('p.applied_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

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
    const liRepo = manager ? manager.getRepository(InvoiceLineItem) : this.lineItemRepo;
    const invoiceNumber = await this.getNextInvoiceNumber(tenantId);
    const today = new Date().toISOString().split('T')[0];
    const isPaid = params.status === 'paid';
    const now = new Date();

    const invoice = repo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: params.customerId,
      job_id: params.jobId || null,
      status: params.status || 'open',
      invoice_date: today,
      due_date: params.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      summary_of_work: params.notes,
      paid_at: isPaid ? now : null,
    } as Partial<Invoice>);

    const saved = await repo.save(invoice);

    // Create line items
    let subtotal = 0;
    for (let i = 0; i < params.lineItems.length; i++) {
      const li = params.lineItems[i];
      const amount = li.amount || li.quantity * li.unitPrice;
      subtotal += amount;
      const lineItem = liRepo.create({
        invoice_id: saved.id,
        sort_order: i,
        line_type: 'service',
        name: li.description,
        quantity: li.quantity,
        unit_rate: li.unitPrice,
        amount,
        net_amount: amount,
      });
      await liRepo.save(lineItem);
    }

    const discount = params.discountAmount ?? 0;
    const total = Math.round((subtotal - discount) * 100) / 100;

    await repo.update(saved.id, {
      subtotal,
      total,
      amount_paid: isPaid ? total : 0,
      balance_due: isPaid ? 0 : total,
    });

    return repo.findOne({ where: { id: saved.id } }) as Promise<Invoice>;
  }

  async hasInvoice(tenantId: string, jobId: string, source: string): Promise<boolean> {
    // Source is now tracked at the line item level or summary
    const count = await this.invoicesRepository.count({
      where: { tenant_id: tenantId, job_id: jobId },
    });
    return count > 0;
  }

  async voidInternalInvoice(invoiceId: string, reason?: string): Promise<void> {
    const invoice = await this.invoicesRepository.findOneBy({ id: invoiceId });
    if (!invoice || invoice.status === 'voided') return;

    await this.invoicesRepository.update(invoiceId, {
      voided_at: new Date(),
      balance_due: 0,
    });

    // Create credit memo for the voided amount
    try {
      const memoResult = await this.dataSource.query(
        `SELECT COALESCE(MAX(memo_number), 0) + 1 as num FROM credit_memos WHERE tenant_id = $1`,
        [invoice.tenant_id],
      );
      const creditMemoRepo = this.dataSource.getRepository(CreditMemo);
      await creditMemoRepo.save(creditMemoRepo.create({
        tenant_id: invoice.tenant_id,
        memo_number: memoResult[0].num,
        original_invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        amount: Number(invoice.total),
        reason: reason || 'Internal void',
        status: 'applied',
      }));
    } catch { /* credit memo is best-effort */ }
  }

  private async recalculate(invoiceId: string) {
    const items = await this.lineItemRepo.find({ where: { invoice_id: invoiceId } });
    const subtotal = items.reduce((s, li) => s + Number(li.net_amount), 0);
    const taxAmount = items.reduce((s, li) => s + Number(li.tax_amount), 0);
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const invoice = await this.invoicesRepository.findOneBy({ id: invoiceId });
    const balanceDue = Math.max(0, Math.round((total - Number(invoice?.amount_paid || 0)) * 100) / 100);

    await this.invoicesRepository.update(invoiceId, {
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      total,
      balance_due: balanceDue,
    });
  }
}
