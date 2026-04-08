import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, DataSource } from 'typeorm';
import { BillingIssue } from '../entities/billing-issue.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { JobCost } from '../entities/job-cost.entity';
import { Job } from '../../jobs/entities/job.entity';
import { PriceResolutionService, ResolvedPrice } from '../../pricing/services/price-resolution.service';

@Injectable()
export class BillingIssueDetectorService {
  private staleCleanupLastRun = new Map<string, number>();
  private readonly STALE_CLEANUP_COOLDOWN_MS = 60_000; // 1 minute

  private shouldRunStaleCleanup(tenantId: string): boolean {
    const lastRun = this.staleCleanupLastRun.get(tenantId) || 0;
    return Date.now() - lastRun >= this.STALE_CLEANUP_COOLDOWN_MS;
  }

  private markStaleCleanupRun(tenantId: string): void {
    this.staleCleanupLastRun.set(tenantId, Date.now());
  }

  constructor(
    @InjectRepository(BillingIssue)
    private issueRepo: Repository<BillingIssue>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(JobCost)
    private jobCostRepo: Repository<JobCost>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
    private priceResolution: PriceResolutionService,
    private dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────
  // DETECT ALL FOR A SINGLE INVOICE
  // ─────────────────────────────────────────────────────────

  async detectAllForInvoice(
    tenantId: string,
    invoiceId: string,
  ): Promise<BillingIssue[]> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, tenant_id: tenantId },
      relations: ['line_items', 'job'],
    });
    if (!invoice) return [];

    const issues: BillingIssue[] = [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const job = invoice.job;
    const lineItems = invoice.line_items || [];

    // Resolve pricing if we have a job with a size
    let resolved: ResolvedPrice | null = null;
    const dumpsterSize =
      job?.asset_subtype || this.extractSizeFromLineItems(lineItems);
    if (dumpsterSize) {
      try {
        resolved = await this.priceResolution.resolvePrice(
          tenantId,
          invoice.customer_id,
          dumpsterSize,
        );
      } catch {
        /* no pricing rule — skip price-dependent checks */
      }
    }

    // ── CHECK 1: Overdue rental days (AUTO-RESOLVE) ──
    if (invoice.rental_chain_id) {
      const issue = await this.checkOverdueDays(
        tenantId,
        invoiceId,
        invoice,
        lineItems,
        resolved,
        today,
        todayStr,
      );
      if (issue) issues.push(issue);
    }

    // ── CHECK 2: Weight overage (AUTO-RESOLVE) ──
    if (job && resolved) {
      const issue = await this.checkWeightOverage(
        tenantId,
        invoiceId,
        job,
        lineItems,
        resolved,
      );
      if (issue) issues.push(issue);
    }

    // ── CHECK 3: Missing dump slip (FLAG) ──
    // Only check on job types that involve dumping — not delivery/drop-off
    const DUMP_ELIGIBLE_TYPES = ['pick_up', 'dump_and_return', 'haul', 'swap', 'exchange'];
    if (job && job.status === 'completed' && DUMP_ELIGIBLE_TYPES.includes(job.job_type)) {
      const issue = await this.checkMissingDumpSlip(
        tenantId,
        invoiceId,
        job,
      );
      if (issue) issues.push(issue);
    }

    // ── CHECK 4: Surcharge gap (FLAG) ──
    if (job) {
      const issue = await this.checkSurchargeGap(
        tenantId,
        invoiceId,
        job,
        lineItems,
      );
      if (issue) issues.push(issue);
    }

    // ── CHECK 5: Past due payment (FLAG) ──
    {
      const issue = await this.checkPastDue(
        tenantId,
        invoiceId,
        invoice,
        todayStr,
        today,
      );
      if (issue) issues.push(issue);
    }

    // ── CHECK 7: Price mismatch (FLAG) ──
    if (resolved) {
      const issue = await this.checkPriceMismatch(
        tenantId,
        invoiceId,
        invoice,
        lineItems,
        resolved,
      );
      if (issue) issues.push(issue);
    }

    return issues.filter(Boolean) as BillingIssue[];
  }

  // ─────────────────────────────────────────────────────────
  // CHECK 6: Missing invoice for completed job
  // ─────────────────────────────────────────────────────────

  async detectMissingInvoice(
    tenantId: string,
    jobId: string,
  ): Promise<BillingIssue | null> {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, tenant_id: tenantId },
    });
    if (!job || job.status !== 'completed') return null;

    const invoiceCount = await this.invoiceRepo.count({
      where: { job_id: jobId, tenant_id: tenantId },
    });
    if (invoiceCount > 0) return null;

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'no_invoice',
      job_id: jobId,
      description: `Completed job ${job.job_number} has no linked invoice`,
      auto_resolvable: false,
      status: 'open',
    });
  }

  // ─────────────────────────────────────────────────────────
  // DETECT ALL FOR ENTIRE TENANT
  // ─────────────────────────────────────────────────────────

  async detectAllForTenant(tenantId: string) {
    // Auto-resolve stale issues before detecting new ones (force — always run on explicit detect)
    await this.resolveStaleIssues(tenantId, true);

    // Invoice-level checks
    const invoices = await this.invoiceRepo.find({
      where: {
        tenant_id: tenantId,
        status: Not(In(['voided', 'paid'])),
      },
      select: ['id'],
    });

    const allIssues: BillingIssue[] = [];
    for (const inv of invoices) {
      const found = await this.detectAllForInvoice(tenantId, inv.id);
      allIssues.push(...found);
    }

    // Check 6: Jobs without invoices
    const jobsWithoutInvoice = await this.jobRepo
      .createQueryBuilder('j')
      .leftJoin(Invoice, 'i', 'i.job_id = j.id')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.status = :status', { status: 'completed' })
      .andWhere('i.id IS NULL')
      .getMany();

    for (const job of jobsWithoutInvoice) {
      const issue = await this.detectMissingInvoice(tenantId, job.id);
      if (issue) allIssues.push(issue);
    }

    // Build summary
    const byType: Record<string, number> = {};
    for (const issue of allIssues) {
      byType[issue.issue_type] = (byType[issue.issue_type] || 0) + 1;
    }

    return {
      total_issues_found: allIssues.length,
      by_type: byType,
      issues: allIssues,
    };
  }

  // ─────────────────────────────────────────────────────────
  // RESOLVE / DISMISS
  // ─────────────────────────────────────────────────────────

  async resolveIssue(tenantId: string, issueId: string, userId: string, reason?: string, notes?: string, linkedInvoiceId?: string) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId, tenant_id: tenantId },
    });
    if (!issue) throw new NotFoundException(`Billing issue ${issueId} not found`);

    issue.status = 'manually_resolved';
    issue.resolved_by = userId;
    issue.resolved_at = new Date();
    if (reason) issue.resolution_reason = reason;
    if (notes) issue.resolution_notes = notes;
    if (linkedInvoiceId) issue.invoice_id = linkedInvoiceId;
    return this.issueRepo.save(issue);
  }

  async getIssueDetail(tenantId: string, issueId: string) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId, tenant_id: tenantId },
      relations: ['job', 'job.customer', 'invoice'],
    });
    if (!issue) throw new NotFoundException(`Billing issue ${issueId} not found`);
    return issue;
  }

  async dismissIssue(tenantId: string, issueId: string, userId: string) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId, tenant_id: tenantId },
    });
    if (!issue) throw new NotFoundException(`Billing issue ${issueId} not found`);

    issue.status = 'dismissed';
    issue.resolved_by = userId;
    issue.resolved_at = new Date();
    return this.issueRepo.save(issue);
  }

  // ─────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: {
      status?: string;
      issueType?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.issueRepo
      .createQueryBuilder('bi')
      .where('bi.tenant_id = :tenantId', { tenantId });

    if (query.status === 'all') {
      // No status filter — return every status
    } else if (query.status) {
      qb.andWhere('bi.status = :status', { status: query.status });
    } else {
      // Default: actionable issues only
      qb.andWhere('bi.status IN (:...statuses)', {
        statuses: ['open'],
      });
    }
    if (query.issueType)
      qb.andWhere('bi.issue_type = :issueType', {
        issueType: query.issueType,
      });

    qb.orderBy('bi.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSummary(tenantId: string) {
    // Clean up stale issues before counting (throttled — at most once per minute per tenant)
    await this.resolveStaleIssues(tenantId);

    const rows = await this.issueRepo
      .createQueryBuilder('bi')
      .select('bi.issue_type', 'issue_type')
      .addSelect('COUNT(*)::int', 'count')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.status IN (:...statuses)', { statuses: ['open'] })
      .groupBy('bi.issue_type')
      .getRawMany<{ issue_type: string; count: number }>();

    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.issue_type] = Number(r.count);

    return { total, by_type: byType };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: Auto-resolve stale issues
  // ─────────────────────────────────────────────────────────

  private async resolveStaleIssues(tenantId: string, force = false): Promise<void> {
    if (!force && !this.shouldRunStaleCleanup(tenantId)) return;

    const openStatuses = ['open', 'auto_resolved'];

    // Pass 1: Stale past_due_payment — invoice balance paid or zero
    await this.issueRepo
      .createQueryBuilder()
      .update(BillingIssue)
      .set({
        status: 'auto_resolved',
        resolved_at: () => 'NOW()',
        resolution_reason: 'auto_cleared_balance_paid',
      })
      .where(
        'id IN (' +
          this.issueRepo
            .createQueryBuilder('bi')
            .select('bi.id')
            .innerJoin(Invoice, 'inv', 'inv.id = bi.invoice_id')
            .where('bi.tenant_id = :tenantId')
            .andWhere('bi.issue_type = :pastDueType')
            .andWhere('bi.status IN (:...openStatuses)')
            .andWhere('(inv.balance_due <= 0 OR inv.status IN (:...paidStatuses))')
            .getQuery() +
          ')',
      )
      .setParameters({
        tenantId,
        pastDueType: 'past_due_payment',
        openStatuses,
        paidStatuses: ['paid', 'voided'],
      })
      .execute();

    // Pass 2: Stale price_mismatch — invoice closed
    await this.issueRepo
      .createQueryBuilder()
      .update(BillingIssue)
      .set({
        status: 'auto_resolved',
        resolved_at: () => 'NOW()',
        resolution_reason: 'auto_cleared_invoice_closed',
      })
      .where(
        'id IN (' +
          this.issueRepo
            .createQueryBuilder('bi')
            .select('bi.id')
            .innerJoin(Invoice, 'inv', 'inv.id = bi.invoice_id')
            .where('bi.tenant_id = :tenantId')
            .andWhere('bi.issue_type = :mismatchType')
            .andWhere('bi.status IN (:...openStatuses)')
            .andWhere('inv.status IN (:...closedStatuses)')
            .getQuery() +
          ')',
      )
      .setParameters({
        tenantId,
        mismatchType: 'price_mismatch',
        openStatuses,
        closedStatuses: ['paid', 'voided'],
      })
      .execute();

    // Pass 3: False-positive missing_dump_slip — non-dump-eligible job types
    const dumpEligible = ['pick_up', 'dump_and_return', 'haul', 'swap', 'exchange'];
    await this.issueRepo
      .createQueryBuilder()
      .update(BillingIssue)
      .set({
        status: 'auto_resolved',
        resolved_at: () => 'NOW()',
        resolution_reason: 'auto_cleared_not_dump_eligible',
      })
      .where(
        'id IN (' +
          this.issueRepo
            .createQueryBuilder('bi')
            .select('bi.id')
            .innerJoin(Job, 'j', 'j.id = bi.job_id')
            .where('bi.tenant_id = :tenantId')
            .andWhere('bi.issue_type = :dumpSlipType')
            .andWhere('bi.status IN (:...openStatuses)')
            .andWhere('j.job_type NOT IN (:...dumpTypes)')
            .getQuery() +
          ')',
      )
      .setParameters({
        tenantId,
        dumpSlipType: 'missing_dump_slip',
        openStatuses,
        dumpTypes: dumpEligible,
      })
      .execute();

    this.markStaleCleanupRun(tenantId);
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: Individual checks
  // ─────────────────────────────────────────────────────────

  private async checkOverdueDays(
    tenantId: string,
    invoiceId: string,
    invoice: Invoice,
    lineItems: InvoiceLineItem[],
    resolved: ResolvedPrice | null,
    today: Date,
    todayStr: string,
  ): Promise<BillingIssue | null> {
    const chains = await this.dataSource.query(
      `SELECT * FROM rental_chains WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [invoice.rental_chain_id, tenantId],
    );
    if (!chains.length) return null;

    const chain = chains[0];
    if (
      !chain.expected_pickup_date ||
      chain.expected_pickup_date >= todayStr
    )
      return null;

    const expectedDate = new Date(chain.expected_pickup_date);
    const overdueDays = Math.ceil(
      (today.getTime() - expectedDate.getTime()) / 86_400_000,
    );
    if (overdueDays <= 0) return null;

    const dailyRate = resolved?.daily_overage_rate || 0;
    if (dailyRate <= 0) return null;

    const existingLine = lineItems.find(
      (li) => li.line_type === 'overage_days',
    );

    if (existingLine) {
      // Update if days changed
      if (Number(existingLine.quantity) !== overdueDays) {
        existingLine.quantity = overdueDays;
        existingLine.unit_rate = dailyRate;
        existingLine.amount =
          Math.round(overdueDays * dailyRate * 100) / 100;
        existingLine.net_amount = existingLine.amount;
        existingLine.name = `${overdueDays} Day Rental Overage`;
        await this.lineItemRepo.save(existingLine);
        await this.recalculateInvoiceTotals(invoice);
      }
      return null; // Already handled
    }

    // Create new overage line item
    const amount = Math.round(overdueDays * dailyRate * 100) / 100;
    const maxSort = lineItems.reduce(
      (m, li) => Math.max(m, li.sort_order),
      -1,
    );

    await this.lineItemRepo.save(
      this.lineItemRepo.create({
        invoice_id: invoiceId,
        sort_order: maxSort + 1,
        line_type: 'overage_days',
        name: `${overdueDays} Day Rental Overage`,
        quantity: overdueDays,
        unit_rate: dailyRate,
        amount,
        net_amount: amount,
        source: 'auto_overage',
      }),
    );

    await this.recalculateInvoiceTotals(invoice);

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'overdue_days',
      invoice_id: invoiceId,
      rental_chain_id: invoice.rental_chain_id,
      description: `Auto-created ${overdueDays} day overage charge at $${dailyRate}/day = $${amount}`,
      auto_resolvable: true,
      calculated_amount: amount,
      days_overdue: overdueDays,
      status: 'auto_resolved',
    });
  }

  private async checkWeightOverage(
    tenantId: string,
    invoiceId: string,
    job: Job,
    lineItems: InvoiceLineItem[],
    resolved: ResolvedPrice,
  ): Promise<BillingIssue | null> {
    const dumpCosts = await this.jobCostRepo.find({
      where: { job_id: job.id, tenant_id: tenantId, cost_type: 'dump_expense' },
    });

    // Sum all weights across all dump costs for this job
    const totalWeight = dumpCosts.reduce(
      (sum, c) => sum + (Number(c.net_weight_tons) || 0),
      0,
    );
    if (totalWeight <= resolved.weight_allowance_tons) return null;

    const hasWeightLine = lineItems.some(
      (li) => li.line_type === 'overage_weight',
    );
    if (hasWeightLine) return null;

    const excessTons =
      Math.round((totalWeight - resolved.weight_allowance_tons) * 100) / 100;
    const amount =
      Math.round(excessTons * resolved.overage_per_ton * 100) / 100;

    const maxSort = lineItems.reduce(
      (m, li) => Math.max(m, li.sort_order),
      -1,
    );

    await this.lineItemRepo.save(
      this.lineItemRepo.create({
        invoice_id: invoiceId,
        sort_order: maxSort + 1,
        line_type: 'overage_weight',
        name: `Weight Overage (${excessTons} tons over ${resolved.weight_allowance_tons} ton allowance)`,
        quantity: 1,
        unit_rate: amount,
        amount,
        net_amount: amount,
        source: 'auto_overage',
      }),
    );

    const invoice = await this.invoiceRepo.findOneBy({ id: invoiceId, tenant_id: tenantId });
    if (invoice) await this.recalculateInvoiceTotals(invoice);

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'weight_overage',
      invoice_id: invoiceId,
      job_id: job.id,
      description: `Weight overage of ${excessTons} tons auto-added ($${amount})`,
      auto_resolvable: true,
      calculated_amount: amount,
      status: 'auto_resolved',
    });
  }

  private async checkMissingDumpSlip(
    tenantId: string,
    invoiceId: string,
    job: Job,
  ): Promise<BillingIssue | null> {
    // Job entity has: dump_ticket_number, dump_ticket_photo, dump_weight_tons
    const hasDumpData =
      job.dump_ticket_number &&
      job.dump_weight_tons != null &&
      Number(job.dump_weight_tons) > 0;

    if (hasDumpData) return null;

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'missing_dump_slip',
      invoice_id: invoiceId,
      job_id: job.id,
      description:
        'Missing dump slip information for completed job. Required: ticket number, net weight, ticket image.',
      auto_resolvable: false,
      status: 'open',
    });
  }

  private async checkSurchargeGap(
    tenantId: string,
    invoiceId: string,
    job: Job,
    lineItems: InvoiceLineItem[],
  ): Promise<BillingIssue | null> {
    // Job entity has dump_overage_items (jsonb array of surcharge items flagged by driver)
    if (
      !job.dump_overage_items ||
      !Array.isArray(job.dump_overage_items) ||
      job.dump_overage_items.length === 0
    )
      return null;

    const hasSurchargeLine = lineItems.some(
      (li) => li.line_type === 'surcharge',
    );
    if (hasSurchargeLine) return null;

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'surcharge_gap',
      invoice_id: invoiceId,
      job_id: job.id,
      description: `Driver flagged ${job.dump_overage_items.length} surcharge item(s) that are not on the invoice`,
      auto_resolvable: false,
      status: 'open',
    });
  }

  private async checkPastDue(
    tenantId: string,
    invoiceId: string,
    invoice: Invoice,
    todayStr: string,
    today: Date,
  ): Promise<BillingIssue | null> {
    if (
      !['open', 'partial', 'delivered', 'read'].includes(invoice.status) ||
      invoice.due_date >= todayStr ||
      Number(invoice.balance_due) <= 0
    )
      return null;

    const daysPastDue = Math.ceil(
      (today.getTime() - new Date(invoice.due_date).getTime()) / 86_400_000,
    );

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'past_due_payment',
      invoice_id: invoiceId,
      description: `Invoice is ${daysPastDue} days past due. Balance: $${invoice.balance_due}`,
      days_overdue: daysPastDue,
      calculated_amount: Number(invoice.balance_due),
      auto_resolvable: false,
      status: 'open',
    });
  }

  private async checkPriceMismatch(
    tenantId: string,
    invoiceId: string,
    invoice: Invoice,
    lineItems: InvoiceLineItem[],
    resolved: ResolvedPrice,
  ): Promise<BillingIssue | null> {
    // Skip intentional pricing overrides
    if (invoice.pricing_tier_used === 'invoice') return null;

    const rentalLine = lineItems.find((li) => li.line_type === 'rental');
    if (!rentalLine) return null;

    // Skip manually created line items (no pricing engine source)
    if (!rentalLine.source && !rentalLine.source_id && !invoice.pricing_rule_snapshot) return null;

    // Skip lines with intentional discounts applied
    if (Number(rentalLine.discount_amount) > 0) return null;

    const invoiceRate = Number(rentalLine.unit_rate);
    if (invoiceRate === resolved.base_price) return null;

    // Check if this mismatch was previously resolved/dismissed — do not re-create
    const previouslyResolved = await this.issueRepo.findOne({
      where: {
        tenant_id: tenantId,
        issue_type: 'price_mismatch',
        invoice_id: invoiceId,
        status: In(['manually_resolved', 'dismissed']),
      },
    });
    if (previouslyResolved) return null;

    return this.createIssueIfNotExists(tenantId, {
      issue_type: 'price_mismatch',
      invoice_id: invoiceId,
      description: `Invoice rate ($${invoiceRate}) doesn't match current pricing ($${resolved.base_price}) for this customer/size`,
      calculated_amount: Math.abs(invoiceRate - resolved.base_price),
      auto_resolvable: false,
      status: 'open',
    });
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE: Helpers
  // ─────────────────────────────────────────────────────────

  private async createIssueIfNotExists(
    tenantId: string,
    data: Partial<BillingIssue>,
  ): Promise<BillingIssue | null> {
    const where: any = {
      tenant_id: tenantId,
      issue_type: data.issue_type,
      status: 'open',
    };
    if (data.invoice_id) where.invoice_id = data.invoice_id;
    if (data.job_id) where.job_id = data.job_id;

    // Also check auto_resolved for auto-resolvable issues
    if (data.status === 'auto_resolved') {
      where.status = In(['open', 'auto_resolved']);
    }

    const existing = await this.issueRepo.findOne({ where });
    if (existing) return null;

    return this.issueRepo.save(
      this.issueRepo.create({ tenant_id: tenantId, ...data }),
    );
  }

  private async recalculateInvoiceTotals(invoice: Invoice): Promise<void> {
    const items = await this.lineItemRepo.find({
      where: { invoice_id: invoice.id },
    });
    const subtotal = items.reduce(
      (s, li) => s + Number(li.net_amount),
      0,
    );
    const taxAmount = items.reduce(
      (s, li) => s + Number(li.tax_amount),
      0,
    );
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    const balanceDue = Math.max(
      0,
      Math.round((total - Number(invoice.amount_paid)) * 100) / 100,
    );

    await this.invoiceRepo.update(invoice.id, {
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      total,
      balance_due: balanceDue,
    });
  }

  private extractSizeFromLineItems(
    lineItems: InvoiceLineItem[],
  ): string | null {
    const rental = lineItems.find((li) => li.line_type === 'rental');
    if (!rental) return null;
    // Try to extract size like "20yd" from name like "20yd Dumpster — Residential"
    const match = rental.name.match(/(\d+yd)/i);
    return match ? match[1] : null;
  }
}
