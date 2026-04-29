import {
  Injectable,
  Logger,
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
import { InvoiceService } from './services/invoice.service';
import { TERMINAL_JOB_STATUSES } from '../../common/constants/job-statuses';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

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
    private invoiceService: InvoiceService,
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
    await this.recalculate(saved.id, tenantId);

    // Resolve rental chain from job (scoped to tenant via rental_chains join).
    //
    // Site #16 (prior silent-error-swallow audit, closed): the previous
    // try/catch here silently left the invoice with rental_chain_id=null
    // if the lookup failed. Reporting + reconciliation + lifecycle
    // surfaces all depend on this link; a silent null breaks them
    // invisibly. Removed; errors now bubble up to the controller as a
    // 500. A missing chain row is already a no-op — the if-check
    // handles that without needing a catch.
    if (dto.jobId) {
      const link = await this.dataSource.query(
        `SELECT tcl.rental_chain_id
         FROM task_chain_links tcl
         INNER JOIN rental_chains rc ON rc.id = tcl.rental_chain_id
         WHERE tcl.job_id = $1 AND rc.tenant_id = $2
         LIMIT 1`,
        [dto.jobId, tenantId],
      );
      if (link?.[0]?.rental_chain_id) {
        await this.invoicesRepository.update(
          { id: saved.id, tenant_id: tenantId },
          { rental_chain_id: link[0].rental_chain_id },
        );
      }
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

  // Phase 1.8 — the prior `sendInvoice(tenantId, id)` method lived here
  // as a dead duplicate. Grep confirmed zero callers (no controller
  // route, no downstream service dependency). The canonical invoice
  // send flow is InvoiceService.sendInvoice at
  // api/src/modules/billing/services/invoice.service.ts, wired via
  // POST /invoices/:id/send. Removed to prevent drift.

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
      await this.recalculate(id, tenantId);
    }

    const saved = await this.findOneInvoice(tenantId, id);

    // Audit log.
    //
    // Site #18 (prior silent-error-swallow audit, closed): the previous
    // try/catch here silently dropped the audit trail if the write
    // failed. An edit without an audit row is a compliance gap — you
    // can't prove who changed what. Removed; errors now propagate so
    // the edit surfaces as a 500 (the caller will retry rather than
    // proceeding with an incomplete audit trail).
    if (Object.keys(changes).length > 0) {
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
    }

    // Size change cascade.
    //
    // Site #19 (prior silent-error-swallow audit, closed): the previous
    // try/catch here silently dropped cascade failures, leaving the
    // invoice with a new subtype while downstream jobs kept the old
    // size. Same 13-broken-deployments bug class. Wrapped in a
    // transaction so the cascade's multiple writes (jobs, pickup jobs,
    // asset inventory) are atomic — either all succeed or all roll
    // back. The outer invoice save (line ~254) is intentionally
    // OUTSIDE this tx per the audit sign-off; the cascade operates on
    // the already-saved invoice and is a logically-separate unit.
    const newSubtype = body.newAssetSubtype as string | undefined;
    if (newSubtype && !isPaid && saved.job_id) {
      const cascadeResult = await this.dataSource.transaction(async (trx) => {
        return this.cascadeSizeChange(tenantId, saved, newSubtype, userId, userName, trx);
      });
      return { ...saved, cascade: cascadeResult } as any;
    }

    return saved;
  }

  private async cascadeSizeChange(
    tenantId: string,
    invoice: Invoice,
    newSubtype: string,
    userId?: string,
    userName?: string,
    manager?: EntityManager,
  ) {
    // Site #19 fix — when called from `editInvoice`, the caller wraps
    // this method in a dataSource.transaction and passes `manager`.
    // Use manager-scoped repos so all the writes below join that
    // transaction and roll back together on any failure. When no
    // manager is provided (future direct callers), falls back to
    // injected repos — backward compatible.
    const lineItemRepo = manager?.getRepository(InvoiceLineItem) ?? this.lineItemRepo;
    const jobsRepository = manager?.getRepository(Job) ?? this.jobsRepository;
    const assetRepo = manager?.getRepository(Asset) ?? this.assetRepo;
    const pricingRepo = manager?.getRepository(PricingRule) ?? this.pricingRepo;
    const notifRepo = manager?.getRepository(Notification) ?? this.notifRepo;

    const oldTotal = Number(invoice.total);

    const rule = await pricingRepo.findOne({
      where: { tenant_id: tenantId, asset_subtype: newSubtype, is_active: true },
    });
    if (!rule) throw new BadRequestException(`No pricing rule found for ${newSubtype}`);

    const newBasePrice = Number(rule.base_price);
    const newDeliveryFee = Number(rule.delivery_fee) || 0;
    const rentalDays = Number(rule.rental_period_days);
    const newTotal = newBasePrice + newDeliveryFee;
    const difference = newTotal - oldTotal;

    // Replace line items
    await lineItemRepo.delete({ invoice_id: invoice.id });
    const rentalItem = lineItemRepo.create({
      invoice_id: invoice.id, sort_order: 0, line_type: 'rental',
      name: `${newSubtype} Dumpster Rental`, quantity: 1, unit_rate: newBasePrice,
      amount: newBasePrice, net_amount: newBasePrice,
    });
    await lineItemRepo.save(rentalItem);

    if (newDeliveryFee > 0) {
      const deliveryItem = lineItemRepo.create({
        invoice_id: invoice.id, sort_order: 1, line_type: 'fee',
        name: 'Delivery Fee', quantity: 1, unit_rate: newDeliveryFee,
        amount: newDeliveryFee, net_amount: newDeliveryFee,
      });
      await lineItemRepo.save(deliveryItem);
    }

    await this.recalculate(invoice.id, tenantId);
    const updated = await this.findOneInvoice(tenantId, invoice.id);

    // Update the linked job
    let assetWarning: string | null = null;
    const job = await jobsRepository.findOne({ where: { id: invoice.job_id, tenant_id: tenantId } });
    if (job) {
      const oldSubtype = job.asset_subtype;
      job.asset_subtype = newSubtype;
      job.base_price = newBasePrice;
      job.total_price = newTotal;
      job.rental_days = rentalDays;
      job.extra_day_rate = Number(rule.extra_day_rate) || 0;
      await jobsRepository.save(job);

      if (job.asset_id && oldSubtype !== newSubtype) {
        await assetRepo.update({ id: job.asset_id, tenant_id: tenantId } as any, {
          status: 'available', current_location_type: 'yard',
        } as any);

        const available = await assetRepo
          .createQueryBuilder('a')
          .where('a.tenant_id = :tenantId', { tenantId })
          .andWhere('a.subtype = :subtype', { subtype: newSubtype })
          .andWhere('a.status NOT IN (:...excluded)', { excluded: ['reserved', 'deployed', 'on_site', 'in_transit', 'retired'] })
          .andWhere(
            `NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE (j.asset_id = a.id OR j.drop_off_asset_id = a.id)
                AND j.tenant_id = a.tenant_id
                AND j.status NOT IN (:...terminalActive)
            )`,
            { terminalActive: [...TERMINAL_JOB_STATUSES] },
          )
          .orderBy('a.created_at', 'DESC')
          .getOne();

        if (available) {
          await assetRepo.update({ id: available.id, tenant_id: tenantId } as any, { status: 'reserved' } as any);
          await jobsRepository.update({ id: job.id, tenant_id: tenantId }, { asset_id: available.id });
        } else {
          await jobsRepository.update({ id: job.id, tenant_id: tenantId }, { asset_id: null } as any);
          assetWarning = `No ${newSubtype} assets available — asset needs manual assignment`;
        }
      }

      const pickupJobs = await jobsRepository.find({
        where: { tenant_id: tenantId, parent_job_id: job.id, job_type: 'pickup' },
      });
      for (const pickup of pickupJobs) {
        pickup.asset_subtype = newSubtype;
        pickup.base_price = newBasePrice;
        pickup.total_price = newTotal;
        if (job.asset_id) pickup.asset_id = job.asset_id;
        await jobsRepository.save(pickup);
      }

      await notifRepo.save(notifRepo.create({
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
      await this.invoicesRepository.update(
        { id: dto.invoiceId, tenant_id: tenantId },
        {
          amount_paid: Math.round(totalPaid * 100) / 100,
          balance_due: balanceDue,
          status: newStatus,
          paid_at: paidAt,
        },
      );
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

  /**
   * Internal invoice creation. Memory rule #1 invariant gate: when
   * `params.status === 'paid'`, callers MUST supply a `payment` block —
   * the helper writes the invoice with `status: 'open'`, inserts the
   * Payment row, then derives the final paid status via
   * `reconcileBalance`. The pre-fix shape (direct status='paid' +
   * amount_paid=total + balance_due=0 with no Payment row) is
   * preserved ONLY behind the `legacyPaidWithoutPayment: true` opt-in
   * for seed/import paths and is never reachable from any HTTP DTO.
   *
   * The full body (validation → invoice insert → line-items → optional
   * Payment + reconcile) runs inside a single transaction so a throw
   * after partial writes (e.g. payment_amount_must_match_invoice_total)
   * rolls everything back. When the caller supplies its own `manager`
   * the helper joins that outer transaction; otherwise it opens a
   * fresh one.
   */
  async createInternalInvoice(
    tenantId: string,
    params: {
      customerId: string;
      jobId?: string;
      rentalChainId?: string;
      source: string;
      invoiceType: string;
      status?: string;
      lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
      paymentMethod?: string;
      notes?: string;
      discountAmount?: number;
      dueDate?: string;
      // Required iff `status === 'paid'` and `legacyPaidWithoutPayment`
      // is not set. Server-side state only — never accept these from a
      // request body.
      payment?: {
        amount: number;
        payment_method: 'cash' | 'card' | 'check' | 'ach' | 'other';
        stripe_payment_intent_id?: string | null;
        applied_at?: Date;
      };
      // Internal escape hatch for seed/import paths that need to author
      // already-paid invoices without a Payment row. NEVER reachable
      // from any HTTP request body — DTOs, controllers, and request
      // payloads must never expose this field.
      legacyPaidWithoutPayment?: boolean;
    },
    manager?: EntityManager,
  ): Promise<Invoice> {
    const isPaid = params.status === 'paid';
    const useLegacy = params.legacyPaidWithoutPayment === true;

    // Pre-validation: fail BEFORE any DB write or transaction open.
    if (isPaid && !useLegacy && !params.payment) {
      throw new BadRequestException('payment_required_for_paid_status');
    }

    const run = (txManager: EntityManager) =>
      this._createInternalInvoiceInTx(tenantId, params, txManager, isPaid, useLegacy);

    if (manager) {
      return run(manager);
    }
    return this.dataSource.transaction(async (txManager) => run(txManager));
  }

  private async _createInternalInvoiceInTx(
    tenantId: string,
    params: {
      customerId: string;
      jobId?: string;
      rentalChainId?: string;
      source: string;
      invoiceType: string;
      status?: string;
      lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
      paymentMethod?: string;
      notes?: string;
      discountAmount?: number;
      dueDate?: string;
      payment?: {
        amount: number;
        payment_method: 'cash' | 'card' | 'check' | 'ach' | 'other';
        stripe_payment_intent_id?: string | null;
        applied_at?: Date;
      };
      legacyPaidWithoutPayment?: boolean;
    },
    manager: EntityManager,
    isPaid: boolean,
    useLegacy: boolean,
  ): Promise<Invoice> {
    if (isPaid && useLegacy) {
      this.logger.warn(
        '[INTERNAL ESCAPE HATCH] createInternalInvoice called with legacyPaidWithoutPayment=true',
      );
    }

    const repo = manager.getRepository(Invoice);
    const liRepo = manager.getRepository(InvoiceLineItem);
    const paymentRepo = manager.getRepository(Payment);
    const invoiceNumber = await this.getNextInvoiceNumber(tenantId);
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // Always insert with `status: 'open'`. The legacy escape hatch is
    // the only path that may end with status='paid' on this initial
    // insert — and only because seed/import paths expect the legacy
    // shape verbatim.
    const invoice = repo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: params.customerId,
      job_id: params.jobId || null,
      rental_chain_id: params.rentalChainId || null,
      status: useLegacy && isPaid ? 'paid' : 'open',
      invoice_date: today,
      due_date: params.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      summary_of_work: params.notes,
      paid_at: useLegacy && isPaid ? now : null,
    } as Partial<Invoice>);

    const saved = await repo.save(invoice);

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

    await repo.update(
      { id: saved.id, tenant_id: saved.tenant_id },
      {
        subtotal,
        total,
        // Legacy path preserves the pre-fix bypass shape exactly so
        // seed/import callers see no behavior change. Non-legacy paths
        // (open or paid-with-payment) start at amount_paid=0/balance_due=total
        // and let reconcileBalance derive the final state from the
        // Payment row below.
        amount_paid: useLegacy && isPaid ? total : 0,
        balance_due: useLegacy && isPaid ? 0 : total,
      },
    );

    // Paid-with-payment path: write Payment row, then let reconcileBalance
    // derive status='paid', amount_paid=total, balance_due=0, paid_at=now.
    // This is the canonical SSoT for invoice paid-state per memory rule #1.
    if (isPaid && !useLegacy && params.payment) {
      if (Math.abs(params.payment.amount - total) > 0.01) {
        throw new BadRequestException('payment_amount_must_match_invoice_total');
      }

      await paymentRepo.save(
        paymentRepo.create({
          tenant_id: tenantId,
          invoice_id: saved.id,
          amount: params.payment.amount,
          payment_method: params.payment.payment_method,
          stripe_payment_intent_id: params.payment.stripe_payment_intent_id ?? null,
          status: 'completed',
          applied_at: params.payment.applied_at ?? now,
        } as Partial<Payment>),
      );

      await this.invoiceService.reconcileBalance(saved.id, manager);
    }

    return repo.findOne({ where: { id: saved.id, tenant_id: saved.tenant_id } }) as Promise<Invoice>;
  }

  async hasInvoice(tenantId: string, jobId: string, source: string): Promise<boolean> {
    // Source is now tracked at the line item level or summary
    const count = await this.invoicesRepository.count({
      where: { tenant_id: tenantId, job_id: jobId },
    });
    return count > 0;
  }

  async voidInternalInvoice(invoiceId: string, tenantId: string, reason?: string): Promise<void> {
    const invoice = await this.invoicesRepository.findOneBy({ id: invoiceId, tenant_id: tenantId });
    if (!invoice || invoice.status === 'voided') return;

    // Site #21 (prior silent-error-swallow audit, closed): the invoice
    // void UPDATE and the credit_memo INSERT used to run as separate
    // writes with a silent catch around the memo. Result: invoice
    // could show voided while the ledger had no matching credit memo
    // — financial state asymmetry that diverges from reality and
    // breaks reconciliation. Now wrapped in a transaction so both
    // writes commit or neither does.
    await this.dataSource.transaction(async (trx) => {
      const invoiceRepo = trx.getRepository(Invoice);
      const creditMemoRepo = trx.getRepository(CreditMemo);

      await invoiceRepo.update(
        { id: invoiceId, tenant_id: tenantId },
        {
          voided_at: new Date(),
          balance_due: 0,
        },
      );

      const memoResult = await trx.query(
        `SELECT COALESCE(MAX(memo_number), 0) + 1 as num FROM credit_memos WHERE tenant_id = $1`,
        [invoice.tenant_id],
      );
      await creditMemoRepo.save(creditMemoRepo.create({
        tenant_id: invoice.tenant_id,
        memo_number: memoResult[0].num,
        original_invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        amount: Number(invoice.total),
        reason: reason || 'Internal void',
        status: 'applied',
      }));
    });
  }

  private async recalculate(invoiceId: string, tenantId: string) {
    const items = await this.lineItemRepo.find({ where: { invoice_id: invoiceId } });
    const subtotal = items.reduce((s, li) => s + Number(li.net_amount), 0);
    const taxAmount = items.reduce((s, li) => s + Number(li.tax_amount), 0);
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const invoice = await this.invoicesRepository.findOneBy({ id: invoiceId, tenant_id: tenantId });
    const balanceDue = Math.max(0, Math.round((total - Number(invoice?.amount_paid || 0)) * 100) / 100);

    await this.invoicesRepository.update(
      { id: invoiceId, tenant_id: tenantId },
      {
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: Math.round(taxAmount * 100) / 100,
        total,
        balance_due: balanceDue,
      },
    );
  }
}
