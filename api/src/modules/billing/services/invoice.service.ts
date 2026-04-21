import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Like } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { InvoiceRevision } from '../entities/invoice-revision.entity';
import { Payment } from '../entities/payment.entity';
import { CreditMemo } from '../entities/credit-memo.entity';
import { JobCost } from '../entities/job-cost.entity';
import { Job } from '../../jobs/entities/job.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { TaskChainLink } from '../../rental-chains/entities/task-chain-link.entity';
import { PriceResolutionService, ResolvedPrice } from '../../pricing/services/price-resolution.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { UpdateInvoiceDto } from '../dto/update-invoice.dto';
import { CreateLineItemDto } from '../dto/create-line-item.dto';
import { UpdateLineItemDto } from '../dto/update-line-item.dto';
import { ApplyPaymentDto } from '../dto/apply-payment.dto';
import { VoidInvoiceDto } from '../dto/void-invoice.dto';
import { FindPriceDto } from '../dto/find-price.dto';
import { ListInvoicesQueryDto } from '../dto/list-invoices-query.dto';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(InvoiceRevision)
    private revisionRepo: Repository<InvoiceRevision>,
    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,
    @InjectRepository(CreditMemo)
    private creditMemoRepo: Repository<CreditMemo>,
    @InjectRepository(JobCost)
    private jobCostRepo: Repository<JobCost>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
    @InjectRepository(TaskChainLink)
    private taskChainLinkRepo: Repository<TaskChainLink>,
    private priceResolution: PriceResolutionService,
    private notificationsService: NotificationsService,
    private dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────

  async createInvoice(
    tenantId: string,
    userId: string,
    dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    // 1. Next invoice number
    const numResult = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`,
      [tenantId],
    );
    const invoiceNumber: number = numResult[0].num;

    // 2. Look up customer for defaults
    const customer = await this.customerRepo.findOne({
      where: { id: dto.customer_id, tenant_id: tenantId },
    });
    if (!customer) throw new NotFoundException(`Customer ${dto.customer_id} not found`);

    const customerType = dto.customer_type || customer.type || 'residential';
    const billingAddress = dto.billing_address || customer.billing_address;

    // 3. Load job if provided
    let job: Job | null = null;
    let dumpsterSize: string | null = null;
    if (dto.job_id) {
      job = await this.jobRepo.findOne({
        where: { id: dto.job_id, tenant_id: tenantId },
      });
      if (job) dumpsterSize = job.asset_subtype;
    }

    // 4. Resolve pricing
    let resolvedPrice: ResolvedPrice | null = null;
    if (dumpsterSize) {
      try {
        resolvedPrice = await this.priceResolution.resolvePrice(
          tenantId,
          dto.customer_id,
          dumpsterSize,
        );
      } catch {
        /* no pricing rule for this size — skip auto-pricing */
      }
    }

    // 5. Create invoice entity
    const today = new Date().toISOString().split('T')[0];
    const dueDate =
      dto.due_date ||
      new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

    const invoice = this.invoiceRepo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: dto.customer_id,
      customer_type: customerType,
      billing_address: billingAddress,
      service_address: dto.service_address || job?.service_address,
      invoice_date: dto.invoice_date || today,
      due_date: dueDate,
      service_date: dto.service_date || job?.scheduled_date,
      job_id: dto.job_id || null,
      rental_chain_id: dto.rental_chain_id || null,
      project_name: dto.project_name,
      po_number: dto.po_number,
      terms_template_id: dto.terms_template_id || null,
      pricing_tier_used: resolvedPrice?.tier_used || 'global',
      pricing_rule_snapshot: resolvedPrice as any,
      created_by: userId,
      updated_by: userId,
    });
    const saved = await this.invoiceRepo.save(invoice);

    // 6b. Resolve rental chain if not provided
    if (!dto.rental_chain_id && dto.job_id) {
      const chainId = await this.resolveRentalChainId(dto.job_id);
      if (chainId) {
        await this.invoiceRepo.update(saved.id, { rental_chain_id: chainId });
      }
    }

    // 7. Create line items from dto
    if (dto.line_items && dto.line_items.length > 0) {
      for (let i = 0; i < dto.line_items.length; i++) {
        await this.buildAndSaveLineItem(saved.id, dto.line_items[i], i);
      }
    } else if (resolvedPrice) {
      // 8. Auto-create rental line item
      const label =
        `${dumpsterSize} Dumpster — ${customerType.charAt(0).toUpperCase() + customerType.slice(1)}`;
      await this.buildAndSaveLineItem(saved.id, {
        line_type: 'rental',
        name: label,
        quantity: 1,
        unit_rate: resolvedPrice.base_price,
        source: resolvedPrice.tier_used,
        source_id: resolvedPrice.pricing_rule_id,
      }, 0);
    }

    // 9. Recalculate totals
    await this.recalculateTotals(saved);

    // 10. Generate summary of work
    await this.generateSummaryOfWork(saved, resolvedPrice);

    // 11. Render terms template
    const templateId = dto.terms_template_id;
    if (templateId && resolvedPrice) {
      try {
        const rendered = await this.priceResolution.renderTermsTemplate(
          templateId,
          resolvedPrice,
        );
        saved.terms_text = rendered;
        await this.invoiceRepo.update(saved.id, { terms_text: rendered });
      } catch { /* template render failed — non-fatal */ }
    }

    // 12. Initial revision
    const fresh = await this.findOne(tenantId, saved.id);
    await this.createRevision(fresh, null, userId, 'Invoice created');

    // 13. Return with all relations
    return fresh;
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────

  async updateInvoice(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.findOne(tenantId, invoiceId);

    const derivedStatuses = ['paid', 'partial', 'open', 'voided'];
    if (dto.status && derivedStatuses.includes(dto.status)) {
      throw new BadRequestException(
        'Statuses "open", "partial", "paid", and "voided" are system-derived and cannot be set directly.'
      );
    }

    const oldSnapshot = this.snapshotInvoice(invoice);

    // Apply scalar fields
    const scalarFields: (keyof UpdateInvoiceDto)[] = [
      'customer_id', 'customer_type', 'billing_address', 'service_address',
      'invoice_date', 'due_date', 'service_date', 'job_id', 'rental_chain_id',
      'project_name', 'po_number', 'terms_template_id', 'status',
      'summary_of_work', 'terms_text',
    ];
    for (const field of scalarFields) {
      if (dto[field] !== undefined) {
        (invoice as any)[field] = dto[field];
      }
    }
    // Build update payload from changed fields
    const updatePayload: Record<string, any> = { updated_by: userId };
    for (const field of scalarFields) {
      if (dto[field] !== undefined) updatePayload[field] = dto[field];
    }

    // Replace line items if provided
    if (dto.line_items !== undefined) {
      await this.lineItemRepo.delete({ invoice_id: invoiceId });
      for (let i = 0; i < dto.line_items.length; i++) {
        await this.buildAndSaveLineItem(invoiceId, dto.line_items[i], i);
      }
    }

    await this.invoiceRepo.update(invoiceId, updatePayload);

    // Recalculate
    const refreshed = await this.findOne(tenantId, invoiceId);
    await this.recalculateTotals(refreshed);

    // Regenerate summary if job/service context changed
    if (
      dto.service_date !== undefined ||
      dto.job_id !== undefined ||
      dto.customer_id !== undefined
    ) {
      await this.generateSummaryOfWork(refreshed, null);
    }

    // Revision
    await this.invoiceRepo.update(invoiceId, { revision: refreshed.revision + 1 });

    const updated = await this.findOne(tenantId, invoiceId);
    const changeSummary = this.buildChangeSummary(oldSnapshot, updated);
    await this.createRevision(updated, oldSnapshot, userId, changeSummary);

    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // VOID
  // ─────────────────────────────────────────────────────────

  async voidInvoice(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: VoidInvoiceDto,
  ) {
    const invoice = await this.findOne(tenantId, invoiceId);

    if (invoice.status === 'voided') {
      throw new BadRequestException('Invoice is already voided');
    }

    await this.invoiceRepo.update(invoiceId, {
      voided_at: new Date(),
      updated_by: userId,
    });
    await this.reconcileBalance(invoiceId);

    // Credit memo
    const memoResult = await this.dataSource.query(
      `SELECT COALESCE(MAX(memo_number), 0) + 1 as num FROM credit_memos WHERE tenant_id = $1`,
      [tenantId],
    );

    const creditMemo = this.creditMemoRepo.create({
      tenant_id: tenantId,
      memo_number: memoResult[0].num,
      original_invoice_id: invoiceId,
      customer_id: invoice.customer_id,
      amount: Number(invoice.total),
      reason: dto.reason,
      created_by: userId,
    });
    const savedMemo = await this.creditMemoRepo.save(creditMemo);

    // Revision
    await this.invoiceRepo.update(invoiceId, { revision: invoice.revision + 1 });
    const voidedInvoice = await this.findOne(tenantId, invoiceId);
    await this.createRevision(
      voidedInvoice,
      null,
      userId,
      `Invoice voided: ${dto.reason}`,
    );

    return { invoice: voidedInvoice, creditMemo: savedMemo };
  }

  // ─────────────────────────────────────────────────────────
  // APPLY PAYMENT
  // ─────────────────────────────────────────────────────────

  async applyPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: ApplyPaymentDto,
  ) {
    const invoice = await this.findOne(tenantId, invoiceId);

    if (invoice.status === 'voided') {
      throw new BadRequestException('Cannot apply payment to voided invoice');
    }

    // Create payment record
    const payment = this.paymentRepo.create({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      amount: dto.amount,
      payment_method: dto.payment_method,
      stripe_payment_intent_id: dto.stripe_payment_intent_id,
      reference_number: dto.reference_number,
      notes: dto.notes,
      status: 'completed',
      applied_by: userId,
    });
    const savedPayment = await this.paymentRepo.save(payment);

    await this.reconcileBalance(invoiceId);
    const updated = await this.findOne(tenantId, invoiceId);
    await this.createRevision(updated, null, userId, `Payment of $${dto.amount} applied via ${dto.payment_method}`);
    return { invoice: updated, payment: savedPayment };
  }

  // ─────────────────────────────────────────────────────────
  // LINE ITEM CRUD
  // ─────────────────────────────────────────────────────────

  async addLineItem(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: CreateLineItemDto,
  ): Promise<InvoiceLineItem> {
    const invoice = await this.findOne(tenantId, invoiceId);

    const maxResult = await this.lineItemRepo
      .createQueryBuilder('li')
      .select('COALESCE(MAX(li.sort_order), -1)', 'max')
      .where('li.invoice_id = :invoiceId', { invoiceId })
      .getRawOne();
    const sortOrder = (Number(maxResult?.max) || 0) + 1;

    const lineItem = await this.buildAndSaveLineItem(invoiceId, dto, sortOrder);

    await this.recalculateTotals(invoice);

    await this.invoiceRepo.update(invoiceId, {
      revision: invoice.revision + 1,
      updated_by: userId,
    });
    await this.createRevision(
      await this.findOne(tenantId, invoiceId),
      null,
      userId,
      `Added line item: ${dto.name}`,
    );

    return lineItem;
  }

  async updateLineItem(
    tenantId: string,
    userId: string,
    invoiceId: string,
    lineItemId: string,
    dto: UpdateLineItemDto,
  ): Promise<InvoiceLineItem> {
    const invoice = await this.findOne(tenantId, invoiceId);

    const lineItem = await this.lineItemRepo.findOne({
      where: { id: lineItemId, invoice_id: invoiceId },
    });
    if (!lineItem) {
      throw new NotFoundException(`Line item ${lineItemId} not found`);
    }

    // Apply updates
    const fields: (keyof UpdateLineItemDto)[] = [
      'line_type', 'name', 'description', 'quantity', 'unit_rate',
      'is_taxable', 'tax_rate', 'discount_amount', 'discount_type',
      'service_date', 'service_address', 'source', 'source_id',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) (lineItem as any)[f] = dto[f];
    }

    this.calculateLineItem(lineItem);
    await this.lineItemRepo.save(lineItem);

    await this.recalculateTotals(invoice);

    await this.invoiceRepo.update(invoiceId, {
      revision: invoice.revision + 1,
      updated_by: userId,
    });
    await this.createRevision(
      await this.findOne(tenantId, invoiceId),
      null,
      userId,
      `Updated line item: ${lineItem.name}`,
    );

    return lineItem;
  }

  async removeLineItem(
    tenantId: string,
    userId: string,
    invoiceId: string,
    lineItemId: string,
  ): Promise<void> {
    const invoice = await this.findOne(tenantId, invoiceId);

    const lineItem = await this.lineItemRepo.findOne({
      where: { id: lineItemId, invoice_id: invoiceId },
    });
    if (!lineItem) {
      throw new NotFoundException(`Line item ${lineItemId} not found`);
    }
    const removedName = lineItem.name;

    await this.lineItemRepo.delete({ id: lineItemId, invoice_id: invoiceId });

    await this.recalculateTotals(invoice);

    await this.invoiceRepo.update(invoiceId, {
      revision: invoice.revision + 1,
      updated_by: userId,
    });
    await this.createRevision(
      await this.findOne(tenantId, invoiceId),
      null,
      userId,
      `Removed line item: ${removedName}`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: ListInvoicesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const qb = this.invoiceRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'customer')
      .leftJoinAndSelect('i.job', 'job')
      .leftJoinAndSelect('i.line_items', 'li')
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
      qb.andWhere('i.invoice_date >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('i.invoice_date <= :dateTo', { dateTo: query.dateTo });
    }
    if (query.search) {
      qb.andWhere(
        `(CAST(i.invoice_number AS TEXT) ILIKE :search
          OR customer.first_name ILIKE :search
          OR customer.last_name ILIKE :search
          OR customer.company_name ILIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('i.invoice_number', 'DESC')
      .addOrderBy('li.sort_order', 'ASC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCreditMemos(tenantId: string, invoiceId: string) {
    return this.creditMemoRepo.find({
      where: { original_invoice_id: invoiceId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
  }

  async getCustomerCreditMemos(tenantId: string, customerId: string) {
    return this.creditMemoRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(tenantId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, tenant_id: tenantId },
      relations: ['customer', 'job', 'line_items', 'payments'],
    });
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    // Load 5 most recent revisions separately for efficiency
    invoice.revisions = await this.revisionRepo.find({
      where: { invoice_id: invoiceId },
      order: { revision_number: 'DESC' },
      take: 5,
    });

    // Sort line items by sort_order
    if (invoice.line_items) {
      invoice.line_items.sort((a, b) => a.sort_order - b.sort_order);
    }
    // Sort payments by applied_at desc
    if (invoice.payments) {
      invoice.payments.sort(
        (a, b) =>
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime(),
      );
    }

    return invoice;
  }

  async sendInvoice(tenantId: string, invoiceId: string, method: string) {
    const invoice = await this.findOne(tenantId, invoiceId);

    // Guard: do not resend if already open, partial, paid, or voided
    if (invoice.status !== 'draft') {
      throw new BadRequestException(`Invoice is already ${invoice.status} — cannot send again`);
    }

    await this.invoiceRepo.update(invoiceId, {
      sent_at: new Date(),
      sent_method: method || 'email',
    });
    await this.reconcileBalance(invoiceId);

    // Send email to customer if they have one
    if (invoice.customer?.email) {
      try {
        await this.notificationsService.send(tenantId, {
          channel: 'email',
          type: 'invoice_sent',
          recipient: invoice.customer.email,
          subject: `Invoice #${invoice.invoice_number}`,
          body: `<p>Hello ${invoice.customer.first_name},</p><p>Invoice <strong>#${invoice.invoice_number}</strong> for <strong>$${Number(invoice.total).toFixed(2)}</strong> has been sent to you.</p><p>Due date: ${invoice.due_date}</p>`,
          customerId: invoice.customer_id,
        });
      } catch { /* email send is best-effort */ }
    }

    return this.findOne(tenantId, invoiceId);
  }

  async duplicateInvoice(
    tenantId: string,
    userId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    const original = await this.findOne(tenantId, invoiceId);

    const numResult = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`,
      [tenantId],
    );

    const dup = this.invoiceRepo.create({
      tenant_id: tenantId,
      invoice_number: numResult[0].num,
      revision: 1,
      status: 'open',
      customer_id: original.customer_id,
      customer_type: original.customer_type,
      billing_address: original.billing_address,
      service_address: original.service_address,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 30 * 86_400_000)
        .toISOString()
        .split('T')[0],
      service_date: original.service_date,
      job_id: original.job_id,
      rental_chain_id: original.rental_chain_id,
      project_name: original.project_name,
      po_number: original.po_number,
      terms_template_id: original.terms_template_id,
      terms_text: original.terms_text,
      pricing_tier_used: original.pricing_tier_used,
      pricing_rule_snapshot: original.pricing_rule_snapshot,
      summary_of_work: original.summary_of_work,
      created_by: userId,
      updated_by: userId,
    });
    const saved = await this.invoiceRepo.save(dup);

    // Clone line items
    if (original.line_items) {
      for (const li of original.line_items) {
        await this.lineItemRepo.save(
          this.lineItemRepo.create({
            invoice_id: saved.id,
            sort_order: li.sort_order,
            line_type: li.line_type,
            name: li.name,
            description: li.description,
            quantity: li.quantity,
            unit_rate: li.unit_rate,
            amount: li.amount,
            discount_amount: li.discount_amount,
            discount_type: li.discount_type,
            net_amount: li.net_amount,
            is_taxable: li.is_taxable,
            tax_rate: li.tax_rate,
            tax_amount: li.tax_amount,
            service_date: li.service_date,
            service_address: li.service_address,
            source: li.source,
            source_id: li.source_id,
            cogs: li.cogs,
          }),
        );
      }
    }

    await this.recalculateTotals(saved);

    // Initial revision on the duplicate
    const fresh = await this.findOne(tenantId, saved.id);
    await this.createRevision(
      fresh,
      null,
      userId,
      `Duplicated from invoice #${original.invoice_number}`,
    );

    return fresh;
  }

  async getRevisions(invoiceId: string) {
    return this.revisionRepo.find({
      where: { invoice_id: invoiceId },
      order: { revision_number: 'DESC' },
    });
  }

  async updateCollections(tenantId: string, invoiceId: string, dto: {
    lastContactMethod?: string;
    contactNotes?: string;
    promiseToPayDate?: string;
    promiseToPayAmount?: number;
    disputeStatus?: string;
    disputeNotes?: string;
  }): Promise<void> {
    const invoice = await this.findOne(tenantId, invoiceId);
    const updates: any = {};

    if (dto.lastContactMethod) {
      updates.last_contacted_at = new Date();
      updates.last_contact_method = dto.lastContactMethod;
      updates.contact_attempt_count = (invoice.contact_attempt_count || 0) + 1;
    }
    if (dto.promiseToPayDate) updates.promise_to_pay_date = dto.promiseToPayDate;
    if (dto.promiseToPayAmount !== undefined) updates.promise_to_pay_amount = dto.promiseToPayAmount;
    if (dto.disputeStatus) updates.dispute_status = dto.disputeStatus;
    if (dto.disputeNotes !== undefined) updates.dispute_notes = dto.disputeNotes;

    if (Object.keys(updates).length > 0) {
      await this.invoiceRepo.update(invoiceId, updates);
    }
  }

  async findPrice(tenantId: string, dto: FindPriceDto) {
    const pricing = await this.priceResolution.resolvePrice(
      tenantId,
      dto.customer_id,
      dto.dumpster_size,
    );

    // Legacy — delivery zone resolution is informational only, not used for pricing. Distance-band model replaces this.
    const addr = dto.service_address;
    const addrString = addr
      ? [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ')
      : undefined;

    try {
      const zone = await this.priceResolution.resolveDeliveryZone(
        tenantId,
        addr?.lat ? Number(addr.lat) : undefined,
        addr?.lng ? Number(addr.lng) : undefined,
        addrString,
      );
      if (zone) pricing.delivery_zone = zone;
    } catch { /* delivery zone resolution is optional */ }

    return pricing;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: LINE ITEM MATH
  // ─────────────────────────────────────────────────────────

  private async buildAndSaveLineItem(
    invoiceId: string,
    dto: CreateLineItemDto,
    sortOrder: number,
  ): Promise<InvoiceLineItem> {
    const li = this.lineItemRepo.create({
      invoice_id: invoiceId,
      sort_order: sortOrder,
      line_type: dto.line_type,
      name: dto.name,
      description: dto.description,
      quantity: dto.quantity ?? 1,
      unit_rate: dto.unit_rate,
      is_taxable: dto.is_taxable ?? false,
      tax_rate: dto.tax_rate ?? 0,
      discount_amount: dto.discount_amount ?? 0,
      discount_type: dto.discount_type,
      service_date: dto.service_date,
      service_address: dto.service_address,
      source: dto.source,
      source_id: dto.source_id,
    });
    this.calculateLineItem(li);
    return this.lineItemRepo.save(li);
  }

  private calculateLineItem(li: InvoiceLineItem): void {
    const qty = Number(li.quantity);
    const rate = Number(li.unit_rate);
    li.amount = Math.round(qty * rate * 100) / 100;

    let discountAmt = Number(li.discount_amount || 0);
    if (li.discount_type === 'percent' && discountAmt > 0) {
      discountAmt = Math.round(li.amount * (discountAmt / 100) * 100) / 100;
      li.discount_amount = discountAmt;
    }

    li.net_amount = Math.round((li.amount - discountAmt) * 100) / 100;
    li.tax_amount = (li.is_taxable && Number(li.tax_rate || 0) > 0)
      ? Math.round(li.net_amount * Number(li.tax_rate) * 100) / 100
      : 0;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: RECALCULATE TOTALS
  // ─────────────────────────────────────────────────────────

  private async recalculateTotals(invoice: Invoice): Promise<void> {
    // Fresh query — never trust stale relations
    const lineItems = await this.lineItemRepo.find({
      where: { invoice_id: invoice.id },
    });

    const subtotal = lineItems.reduce(
      (sum, li) => sum + Number(li.net_amount),
      0,
    );
    const taxAmount = lineItems.reduce(
      (sum, li) => sum + Number(li.tax_amount),
      0,
    );
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    // COGS
    const jobCosts = await this.jobCostRepo.find({
      where: { invoice_id: invoice.id },
    });
    const totalCogs = jobCosts.reduce(
      (sum, jc) => sum + Number(jc.amount),
      0,
    );
    const profit = Math.round((total - totalCogs) * 100) / 100;

    const updates = {
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      total,
      total_cogs: Math.round(totalCogs * 100) / 100,
      profit,
    };

    await this.invoiceRepo.update(invoice.id, updates);

    // Sync in-memory object
    Object.assign(invoice, updates);

    // Derive balance_due and status from payments
    await this.reconcileBalance(invoice.id);
  }

  // ─────────────────────────────────────────────────────────
  // RECONCILE BALANCE — single source of truth for status/amounts
  // ─────────────────────────────────────────────────────────

  async reconcileBalance(invoiceId: string): Promise<void> {
    const payments = await this.paymentRepo.find({
      where: { invoice_id: invoiceId, status: 'completed' },
    });
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    const invoice = await this.invoiceRepo.findOneOrFail({ where: { id: invoiceId } });

    const amountPaid = Math.round(totalPaid * 100) / 100;
    const balanceDue = Math.max(Math.round((Number(invoice.total) - totalPaid) * 100) / 100, 0);

    let status: string;
    if (invoice.voided_at) {
      status = 'voided';
    } else if (totalPaid >= Number(invoice.total) && totalPaid > 0) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partial';
    } else {
      status = 'open';
    }

    // Handle overpayment — idempotent credit memo
    const overpayment = Math.round(Math.max(totalPaid - Number(invoice.total), 0) * 100) / 100;
    if (overpayment > 0) {
      const existingMemo = await this.creditMemoRepo.findOne({
        where: { original_invoice_id: invoiceId, reason: Like('%Overpayment%') },
      });
      if (!existingMemo) {
        await this.creditMemoRepo.save(this.creditMemoRepo.create({
          tenant_id: invoice.tenant_id,
          original_invoice_id: invoiceId,
          customer_id: invoice.customer_id,
          amount: overpayment,
          reason: `Overpayment on invoice #${invoice.invoice_number}`,
          status: 'issued',
        }));
      } else if (Math.round(Number(existingMemo.amount) * 100) !== Math.round(overpayment * 100)) {
        await this.creditMemoRepo.update(existingMemo.id, { amount: overpayment });
      }
    }

    const paidAt = (status === 'paid' && !invoice.paid_at) ? new Date() : invoice.paid_at;

    // TODO: Remove after Phase 2 validation
    console.log(`[reconcileBalance] invoice=${invoiceId} total=${invoice.total} totalPaid=${totalPaid} balanceDue=${balanceDue} status=${status}`);

    await this.invoiceRepo.update(invoiceId, {
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status,
      paid_at: paidAt,
    });
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: resolveRentalChainId
  // ─────────────────────────────────────────────────────────

  private async resolveRentalChainId(jobId: string | null): Promise<string | null> {
    if (!jobId) return null;
    const link = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });
    return link ? link.rental_chain_id : null;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: GENERATE SUMMARY OF WORK
  // ─────────────────────────────────────────────────────────

  private async generateSummaryOfWork(
    invoice: Invoice,
    pricingData: ResolvedPrice | null,
  ): Promise<void> {
    const serviceDate = invoice.service_date || invoice.invoice_date;
    let summary: string;

    if (!invoice.job_id) {
      summary = `Service scheduled for ${serviceDate}.`;
    } else {
      const job = await this.jobRepo.findOne({
        where: { id: invoice.job_id },
      });

      if (!job) {
        summary = `Service scheduled for ${serviceDate}.`;
      } else {
        const size = job.asset_subtype || 'dumpster';
        /**
         * Deliberate carve-out from the `|| 14` fallback cleanup arc.
         *
         * This `|| 14` fallback is intentionally preserved. The computed
         * `rentalDays` is used exclusively for display-only email summary text
         * (rendered at lines ~924-926 as "This rental includes a ${rentalDays}
         * day rental period"). It does NOT drive billing math, extra-day
         * calculation, overdue determination, or any persisted state — the
         * actual billing path reads `pricing_rules.rental_period_days` via the
         * pricing services upstream.
         *
         * Replacing this fallback with the shared `getTenantRentalDays` helper
         * would add an async DB call to the email-send path with zero
         * correctness benefit. The helper is canonical for rental duration
         * resolution in billing/lifecycle/pricing contexts; this site's use is
         * cosmetic.
         *
         * Arc lineage:
         * - Phase 1 (95c85ca): extracted `getTenantRentalDays` to shared util
         * - Phase 2 (74991d5): applied helper at 3 HIGH + 1 MEDIUM sites
         *   using pattern-aware injection (Option β — honoring each file's
         *   documented TenantSettings access convention)
         * - Phase 3 (this commit): documents this site's deliberate exemption
         *
         * Source-of-truth note: the 14-day default aligned to by the
         * rest of the arc lives at `tenant_settings.default_rental_period_days`
         * (not `pricing_rules.rental_period_days`, which defaults to 7 and is
         * semantically distinct). This site's `|| 14` is unrelated to either
         * canonical source — it is purely a display safety net.
         */
        const rentalDays = pricingData?.rental_days || job.rental_days || 14;
        const weight = pricingData?.weight_allowance_tons || 0;
        const overagePerTon = pricingData?.overage_per_ton || 0;
        const dailyRate = pricingData?.daily_overage_rate || 0;
        const jt = job.job_type;

        if (jt === 'delivery' || jt === 'drop_off') {
          summary =
            `Your ${size} dumpster rental is scheduled for delivery on ${serviceDate}. ` +
            `This rental includes a ${rentalDays} day rental period with a weight allowance of ${weight} tons. ` +
            `If you exceed your weight allowance, you will be charged at a rate of $${overagePerTon} per ton. ` +
            `Daily overage after ${rentalDays} days: $${dailyRate}/day.`;
        } else if (jt === 'exchange') {
          summary =
            `Your ${size} dumpster is scheduled for exchange on ${serviceDate}. ` +
            `Weight allowance: ${weight} tons at $${overagePerTon}/ton overage.`;
        } else if (jt === 'pickup' || jt === 'pick_up') {
          summary = `Your ${size} dumpster pickup is scheduled for ${serviceDate}.`;
        } else {
          summary = `Service scheduled for ${serviceDate}.`;
        }
      }
    }

    invoice.summary_of_work = summary;
    await this.invoiceRepo.update(invoice.id, { summary_of_work: summary });
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: SNAPSHOTS & REVISIONS
  // ─────────────────────────────────────────────────────────

  private snapshotInvoice(invoice: Invoice): Record<string, any> {
    return {
      status: invoice.status,
      customer_id: invoice.customer_id,
      customer_type: invoice.customer_type,
      billing_address: invoice.billing_address,
      service_address: invoice.service_address,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      service_date: invoice.service_date,
      subtotal: Number(invoice.subtotal),
      tax_amount: Number(invoice.tax_amount),
      total: Number(invoice.total),
      amount_paid: Number(invoice.amount_paid),
      balance_due: Number(invoice.balance_due),
      total_cogs: Number(invoice.total_cogs),
      profit: Number(invoice.profit),
      summary_of_work: invoice.summary_of_work,
      terms_text: invoice.terms_text,
      project_name: invoice.project_name,
      po_number: invoice.po_number,
      pricing_tier_used: invoice.pricing_tier_used,
      line_items: (invoice.line_items || []).map((li) => ({
        id: li.id,
        line_type: li.line_type,
        name: li.name,
        quantity: Number(li.quantity),
        unit_rate: Number(li.unit_rate),
        amount: Number(li.amount),
        discount_amount: Number(li.discount_amount),
        net_amount: Number(li.net_amount),
        tax_amount: Number(li.tax_amount),
      })),
    };
  }

  private async createRevision(
    invoice: Invoice,
    oldSnapshot: Record<string, any> | null,
    userId: string | null,
    changeSummary: string,
  ): Promise<void> {
    const currentSnapshot = this.snapshotInvoice(invoice);
    const changes: Record<string, { from: any; to: any }> = {};

    if (oldSnapshot) {
      for (const key of Object.keys(currentSnapshot)) {
        const oldVal = oldSnapshot[key];
        const newVal = currentSnapshot[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes[key] = { from: oldVal, to: newVal };
        }
      }
    }

    await this.revisionRepo.save(
      this.revisionRepo.create({
        invoice_id: invoice.id,
        revision_number: invoice.revision,
        snapshot: currentSnapshot,
        changes,
        change_summary: changeSummary,
        changed_by: userId,
      }),
    );
  }

  private buildChangeSummary(
    oldSnap: Record<string, any>,
    invoice: Invoice,
  ): string {
    const newSnap = this.snapshotInvoice(invoice);
    const parts: string[] = [];

    if (oldSnap.status !== newSnap.status) {
      parts.push(`Status changed from ${oldSnap.status} to ${newSnap.status}`);
    }

    const oldCount = (oldSnap.line_items || []).length;
    const newCount = (newSnap.line_items || []).length;
    if (oldCount !== newCount) {
      const diff = newCount - oldCount;
      parts.push(
        diff > 0
          ? `Added ${diff} line item${diff > 1 ? 's' : ''}`
          : `Removed ${Math.abs(diff)} line item${Math.abs(diff) > 1 ? 's' : ''}`,
      );
    }

    if (oldSnap.total !== newSnap.total) {
      parts.push(`Total changed from $${oldSnap.total} to $${newSnap.total}`);
    }

    if (oldSnap.due_date !== newSnap.due_date) {
      parts.push(`Due date changed to ${newSnap.due_date}`);
    }

    return parts.length > 0 ? parts.join('; ') : 'Invoice updated';
  }
}
