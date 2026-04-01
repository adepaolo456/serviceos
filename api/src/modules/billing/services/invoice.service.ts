import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { InvoiceRevision } from '../entities/invoice-revision.entity';
import { Payment } from '../entities/payment.entity';
import { CreditMemo } from '../entities/credit-memo.entity';
import { BillingIssue } from '../entities/billing-issue.entity';
import { JobCost } from '../entities/job-cost.entity';
import { Job } from '../../jobs/entities/job.entity';
import { PriceResolutionService, ResolvedPrice } from '../../pricing/services/price-resolution.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { UpdateInvoiceDto } from '../dto/update-invoice.dto';
import { CreateLineItemDto } from '../dto/create-line-item.dto';
import { UpdateLineItemDto } from '../dto/update-line-item.dto';
import { ApplyPaymentDto } from '../dto/apply-payment.dto';
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
    @InjectRepository(BillingIssue)
    private billingIssueRepo: Repository<BillingIssue>,
    @InjectRepository(JobCost)
    private jobCostRepo: Repository<JobCost>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
    private priceResolution: PriceResolutionService,
    private dataSource: DataSource,
  ) {}

  async createInvoice(tenantId: string, userId: string, dto: CreateInvoiceDto): Promise<Invoice> {
    // 1. Get next invoice number
    const result = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`,
      [tenantId],
    );
    const invoiceNumber = result[0].num;

    // 2. Resolve pricing if no line_items provided
    let resolvedPrice: ResolvedPrice | null = null;
    let job: Job | null = null;
    if (dto.job_id) {
      job = await this.jobRepo.findOne({ where: { id: dto.job_id, tenant_id: tenantId } });
    }

    if ((!dto.line_items || dto.line_items.length === 0) && job) {
      const size = job.asset_subtype;
      if (size) {
        resolvedPrice = await this.priceResolution.resolvePrice(tenantId, dto.customer_id, size);
      }
    }

    // 3. Create invoice record
    const today = new Date().toISOString().split('T')[0];
    const dueDate = dto.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoice = this.invoiceRepo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: dto.customer_id,
      customer_type: dto.customer_type || 'residential',
      billing_address: dto.billing_address,
      service_address: dto.service_address,
      invoice_date: dto.invoice_date || today,
      due_date: dueDate,
      service_date: dto.service_date,
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

    const savedInvoice = await this.invoiceRepo.save(invoice);

    // 4. Create line items
    if (dto.line_items && dto.line_items.length > 0) {
      for (let i = 0; i < dto.line_items.length; i++) {
        await this.createLineItemFromDto(savedInvoice.id, dto.line_items[i], i);
      }
    } else if (resolvedPrice) {
      // 5. Auto-create rental line item
      const customerType = dto.customer_type || 'residential';
      const size = job?.asset_subtype || 'dumpster';
      await this.createLineItemFromDto(savedInvoice.id, {
        line_type: 'rental',
        name: `${size} Dumpster - ${customerType}`,
        quantity: 1,
        unit_rate: resolvedPrice.base_price,
      }, 0);
    }

    // 6. Recalculate totals
    await this.recalculateTotals(savedInvoice);

    // 7. Generate summary of work
    await this.generateSummaryOfWork(savedInvoice, resolvedPrice);

    // 8. Create initial revision
    const freshInvoice = await this.findOneInvoice(tenantId, savedInvoice.id);
    await this.createRevision(freshInvoice, null, userId, 'Invoice created');

    return freshInvoice;
  }

  async updateInvoice(tenantId: string, userId: string, invoiceId: string, dto: UpdateInvoiceDto): Promise<Invoice> {
    const invoice = await this.findOneInvoice(tenantId, invoiceId);
    const oldSnapshot = this.snapshotInvoice(invoice);

    // Apply updates
    if (dto.customer_id !== undefined) invoice.customer_id = dto.customer_id;
    if (dto.customer_type !== undefined) invoice.customer_type = dto.customer_type;
    if (dto.billing_address !== undefined) invoice.billing_address = dto.billing_address;
    if (dto.service_address !== undefined) invoice.service_address = dto.service_address;
    if (dto.invoice_date !== undefined) invoice.invoice_date = dto.invoice_date;
    if (dto.due_date !== undefined) invoice.due_date = dto.due_date;
    if (dto.service_date !== undefined) invoice.service_date = dto.service_date;
    if (dto.job_id !== undefined) invoice.job_id = dto.job_id;
    if (dto.rental_chain_id !== undefined) invoice.rental_chain_id = dto.rental_chain_id;
    if (dto.project_name !== undefined) invoice.project_name = dto.project_name;
    if (dto.po_number !== undefined) invoice.po_number = dto.po_number;
    if (dto.terms_template_id !== undefined) invoice.terms_template_id = dto.terms_template_id;
    if (dto.status !== undefined) invoice.status = dto.status;
    if (dto.summary_of_work !== undefined) invoice.summary_of_work = dto.summary_of_work;
    if (dto.terms_text !== undefined) invoice.terms_text = dto.terms_text;

    // Replace line items if provided
    if (dto.line_items !== undefined) {
      await this.lineItemRepo.delete({ invoice_id: invoiceId });
      for (let i = 0; i < dto.line_items.length; i++) {
        await this.createLineItemFromDto(invoiceId, dto.line_items[i], i);
      }
    }

    invoice.updated_by = userId;
    await this.invoiceRepo.save(invoice);

    // Recalculate
    await this.recalculateTotals(invoice);

    // Increment revision
    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);

    // Create revision
    const updated = await this.findOneInvoice(tenantId, invoiceId);
    await this.createRevision(updated, oldSnapshot, userId, 'Invoice updated');

    return updated;
  }

  async voidInvoice(tenantId: string, userId: string, invoiceId: string, reason: string) {
    const invoice = await this.findOneInvoice(tenantId, invoiceId);

    invoice.status = 'voided';
    invoice.voided_at = new Date();
    invoice.updated_by = userId;
    await this.invoiceRepo.save(invoice);

    // Create credit memo
    const memoResult = await this.dataSource.query(
      `SELECT COALESCE(MAX(memo_number), 0) + 1 as num FROM credit_memos WHERE tenant_id = $1`,
      [tenantId],
    );
    const memoNumber = memoResult[0].num;

    const creditMemo = this.creditMemoRepo.create({
      tenant_id: tenantId,
      memo_number: memoNumber,
      original_invoice_id: invoiceId,
      customer_id: invoice.customer_id,
      amount: Number(invoice.total),
      reason,
      created_by: userId,
    });
    const savedMemo = await this.creditMemoRepo.save(creditMemo);

    // Create revision
    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);
    await this.createRevision(invoice, null, userId, `Invoice voided: ${reason}`);

    return { invoice, creditMemo: savedMemo };
  }

  async applyPayment(tenantId: string, userId: string, invoiceId: string, dto: ApplyPaymentDto) {
    const invoice = await this.findOneInvoice(tenantId, invoiceId);

    const payment = this.paymentRepo.create({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      amount: dto.amount,
      payment_method: dto.payment_method,
      stripe_payment_intent_id: dto.stripe_payment_intent_id,
      reference_number: dto.reference_number,
      notes: dto.notes,
      applied_by: userId,
    });
    const savedPayment = await this.paymentRepo.save(payment);

    // Update invoice
    invoice.amount_paid = Math.round((Number(invoice.amount_paid) + dto.amount) * 100) / 100;
    invoice.balance_due = Math.round((Number(invoice.total) - Number(invoice.amount_paid)) * 100) / 100;
    if (invoice.balance_due < 0) invoice.balance_due = 0;

    if (invoice.balance_due <= 0) {
      invoice.status = 'paid';
      invoice.paid_at = new Date();
    } else if (Number(invoice.amount_paid) > 0) {
      invoice.status = 'partial';
    }

    invoice.updated_by = userId;
    await this.invoiceRepo.save(invoice);

    // Create revision
    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);
    await this.createRevision(invoice, null, userId, `Payment of $${dto.amount} applied via ${dto.payment_method}`);

    return { invoice, payment: savedPayment };
  }

  async addLineItem(tenantId: string, invoiceId: string, dto: CreateLineItemDto) {
    await this.findOneInvoice(tenantId, invoiceId);

    const maxResult = await this.lineItemRepo
      .createQueryBuilder('li')
      .select('COALESCE(MAX(li.sort_order), -1)', 'max')
      .where('li.invoice_id = :invoiceId', { invoiceId })
      .getRawOne();
    const sortOrder = (maxResult?.max ?? -1) + 1;

    const lineItem = await this.createLineItemFromDto(invoiceId, dto, sortOrder);

    const invoice = await this.findOneInvoice(tenantId, invoiceId);
    await this.recalculateTotals(invoice);

    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);
    await this.createRevision(invoice, null, null, `Line item added: ${dto.name}`);

    return lineItem;
  }

  async updateLineItem(tenantId: string, invoiceId: string, lineItemId: string, dto: UpdateLineItemDto) {
    await this.findOneInvoice(tenantId, invoiceId);

    const lineItem = await this.lineItemRepo.findOne({
      where: { id: lineItemId, invoice_id: invoiceId },
    });
    if (!lineItem) throw new NotFoundException(`Line item ${lineItemId} not found`);

    if (dto.line_type !== undefined) lineItem.line_type = dto.line_type;
    if (dto.name !== undefined) lineItem.name = dto.name;
    if (dto.description !== undefined) lineItem.description = dto.description;
    if (dto.quantity !== undefined) lineItem.quantity = dto.quantity;
    if (dto.unit_rate !== undefined) lineItem.unit_rate = dto.unit_rate;
    if (dto.is_taxable !== undefined) lineItem.is_taxable = dto.is_taxable;
    if (dto.tax_rate !== undefined) lineItem.tax_rate = dto.tax_rate;
    if (dto.discount_amount !== undefined) lineItem.discount_amount = dto.discount_amount;
    if (dto.discount_type !== undefined) lineItem.discount_type = dto.discount_type;
    if (dto.service_date !== undefined) lineItem.service_date = dto.service_date;
    if (dto.service_address !== undefined) lineItem.service_address = dto.service_address;

    this.calculateLineItem(lineItem);
    await this.lineItemRepo.save(lineItem);

    const invoice = await this.findOneInvoice(tenantId, invoiceId);
    await this.recalculateTotals(invoice);

    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);
    await this.createRevision(invoice, null, null, `Line item updated: ${lineItem.name}`);

    return lineItem;
  }

  async removeLineItem(tenantId: string, invoiceId: string, lineItemId: string) {
    await this.findOneInvoice(tenantId, invoiceId);
    await this.lineItemRepo.delete({ id: lineItemId, invoice_id: invoiceId });

    const invoice = await this.findOneInvoice(tenantId, invoiceId);
    await this.recalculateTotals(invoice);

    invoice.revision += 1;
    await this.invoiceRepo.save(invoice);
    await this.createRevision(invoice, null, null, 'Line item removed');
  }

  async findPrice(tenantId: string, dto: FindPriceDto) {
    return this.priceResolution.resolvePrice(tenantId, dto.customer_id, dto.dumpster_size);
  }

  async duplicateInvoice(tenantId: string, userId: string, invoiceId: string): Promise<Invoice> {
    const original = await this.findOneInvoice(tenantId, invoiceId);

    const result = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`,
      [tenantId],
    );
    const invoiceNumber = result[0].num;

    const newInvoice = this.invoiceRepo.create({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      customer_id: original.customer_id,
      customer_type: original.customer_type,
      billing_address: original.billing_address,
      service_address: original.service_address,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
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
      status: 'draft',
    });
    const saved = await this.invoiceRepo.save(newInvoice);

    // Clone line items
    if (original.line_items) {
      for (const li of original.line_items) {
        const clone = this.lineItemRepo.create({
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
        });
        await this.lineItemRepo.save(clone);
      }
    }

    await this.recalculateTotals(saved);
    return this.findOneInvoice(tenantId, saved.id);
  }

  async getRevisions(invoiceId: string) {
    return this.revisionRepo.find({
      where: { invoice_id: invoiceId },
      order: { revision_number: 'DESC' },
    });
  }

  async findAllInvoices(tenantId: string, query: ListInvoicesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.invoiceRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'customer')
      .leftJoinAndSelect('i.job', 'job')
      .leftJoinAndSelect('i.line_items', 'line_items')
      .where('i.tenant_id = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('i.status = :status', { status: query.status });
    }
    if (query.customerId) {
      qb.andWhere('i.customer_id = :customerId', { customerId: query.customerId });
    }
    if (query.dateFrom) {
      qb.andWhere('i.created_at >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('i.created_at <= :dateTo', { dateTo: `${query.dateTo} 23:59:59` });
    }
    if (query.search) {
      qb.andWhere(
        `(CAST(i.invoice_number AS TEXT) ILIKE :search OR customer.first_name ILIKE :search OR customer.last_name ILIKE :search OR customer.company_name ILIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('i.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOneInvoice(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['customer', 'job', 'line_items', 'payments', 'revisions'],
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async sendInvoice(tenantId: string, invoiceId: string, method: string) {
    const invoice = await this.findOneInvoice(tenantId, invoiceId);
    invoice.status = 'sent';
    invoice.sent_at = new Date();
    invoice.sent_method = method || 'email';
    return this.invoiceRepo.save(invoice);
  }

  // ─── Private Helpers ───

  private async createLineItemFromDto(invoiceId: string, dto: CreateLineItemDto, sortOrder: number): Promise<InvoiceLineItem> {
    const lineItem = this.lineItemRepo.create({
      invoice_id: invoiceId,
      sort_order: sortOrder,
      line_type: dto.line_type,
      name: dto.name,
      description: dto.description,
      quantity: dto.quantity,
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
    this.calculateLineItem(lineItem);
    return this.lineItemRepo.save(lineItem);
  }

  private calculateLineItem(li: InvoiceLineItem) {
    li.amount = Math.round(Number(li.quantity) * Number(li.unit_rate) * 100) / 100;
    li.net_amount = Math.round((li.amount - Number(li.discount_amount || 0)) * 100) / 100;
    li.tax_amount = li.is_taxable
      ? Math.round(li.net_amount * Number(li.tax_rate || 0) * 100) / 100
      : 0;
  }

  private async recalculateTotals(invoice: Invoice) {
    const lineItems = await this.lineItemRepo.find({ where: { invoice_id: invoice.id } });

    const subtotal = lineItems.reduce((sum, li) => sum + Number(li.net_amount), 0);
    const taxAmount = lineItems.reduce((sum, li) => sum + Number(li.tax_amount), 0);
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    const balanceDue = Math.max(0, Math.round((total - Number(invoice.amount_paid)) * 100) / 100);

    // COGS
    const jobCosts = await this.jobCostRepo.find({ where: { invoice_id: invoice.id } });
    const totalCogs = jobCosts.reduce((sum, jc) => sum + Number(jc.amount), 0);
    const profit = Math.round((total - totalCogs) * 100) / 100;

    await this.invoiceRepo.update(invoice.id, {
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      total,
      balance_due: balanceDue,
      total_cogs: Math.round(totalCogs * 100) / 100,
      profit,
    });

    // Update in-memory
    invoice.subtotal = Math.round(subtotal * 100) / 100;
    invoice.tax_amount = Math.round(taxAmount * 100) / 100;
    invoice.total = total;
    invoice.balance_due = balanceDue;
    invoice.total_cogs = Math.round(totalCogs * 100) / 100;
    invoice.profit = profit;
  }

  private async generateSummaryOfWork(invoice: Invoice, pricingData: ResolvedPrice | null) {
    let summary = '';
    const serviceDate = invoice.service_date || invoice.invoice_date;

    if (invoice.job_id) {
      const job = await this.jobRepo.findOne({ where: { id: invoice.job_id } });
      if (job) {
        const size = job.asset_subtype || 'dumpster';
        const rentalDays = pricingData?.rental_days || job.rental_days || 14;
        const weightAllowance = pricingData?.weight_allowance_tons || 0;
        const overagePerTon = pricingData?.overage_per_ton || 0;
        const dailyRate = pricingData?.daily_overage_rate || 0;

        if (job.job_type === 'delivery' || job.job_type === 'drop_off') {
          summary = `Your ${size} dumpster rental is scheduled for delivery on ${serviceDate}. This rental includes a ${rentalDays} day rental period with a weight allowance of ${weightAllowance} tons. If you exceed your weight allowance, you will be charged at a rate of $${overagePerTon} per ton. Daily overage after ${rentalDays} days: $${dailyRate}/day.`;
        } else if (job.job_type === 'exchange') {
          summary = `Your ${size} dumpster is scheduled for exchange on ${serviceDate}. Weight allowance: ${weightAllowance} tons at $${overagePerTon}/ton overage.`;
        } else if (job.job_type === 'pickup' || job.job_type === 'pick_up') {
          summary = `Your ${size} dumpster pickup is scheduled for ${serviceDate}.`;
        } else {
          summary = `Service scheduled for ${serviceDate}.`;
        }
      }
    } else {
      summary = `Service scheduled for ${serviceDate}.`;
    }

    invoice.summary_of_work = summary;
    await this.invoiceRepo.update(invoice.id, { summary_of_work: summary });
  }

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
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax_amount,
      total: invoice.total,
      amount_paid: invoice.amount_paid,
      balance_due: invoice.balance_due,
      summary_of_work: invoice.summary_of_work,
      terms_text: invoice.terms_text,
      project_name: invoice.project_name,
      po_number: invoice.po_number,
      line_items: invoice.line_items?.map(li => ({
        id: li.id,
        name: li.name,
        quantity: li.quantity,
        unit_rate: li.unit_rate,
        net_amount: li.net_amount,
      })),
    };
  }

  private async createRevision(
    invoice: Invoice,
    oldSnapshot: Record<string, any> | null,
    userId: string | null,
    changeSummary: string,
  ) {
    const currentSnapshot = this.snapshotInvoice(invoice);
    const changes: Record<string, any> = {};

    if (oldSnapshot) {
      for (const key of Object.keys(currentSnapshot)) {
        const oldVal = oldSnapshot[key];
        const newVal = currentSnapshot[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes[key] = { from: oldVal, to: newVal };
        }
      }
    }

    const revision = this.revisionRepo.create({
      invoice_id: invoice.id,
      revision_number: invoice.revision,
      snapshot: currentSnapshot,
      changes,
      change_summary: changeSummary,
      changed_by: userId,
    });
    await this.revisionRepo.save(revision);
  }
}
