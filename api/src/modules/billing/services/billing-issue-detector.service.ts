import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { BillingIssue } from '../entities/billing-issue.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { JobCost } from '../entities/job-cost.entity';
import { Job } from '../../jobs/entities/job.entity';
import { PriceResolutionService } from '../../pricing/services/price-resolution.service';

@Injectable()
export class BillingIssueDetectorService {
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
  ) {}

  async detectAllForInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, tenant_id: tenantId },
      relations: ['line_items', 'job'],
    });
    if (!invoice) return [];

    const issues: BillingIssue[] = [];
    const today = new Date().toISOString().split('T')[0];
    const job = invoice.job;
    const lineItems = invoice.line_items || [];

    // Resolve pricing if we have a job with a size
    let resolvedPrice: any = null;
    if (job?.asset_subtype) {
      try {
        resolvedPrice = await this.priceResolution.resolvePrice(tenantId, invoice.customer_id, job.asset_subtype);
      } catch { /* no pricing rule found — skip price-dependent checks */ }
    }

    // 1. OVERDUE DAYS — check rental chain
    if (invoice.rental_chain_id) {
      const chain = await this.invoiceRepo.query(
        `SELECT * FROM rental_chains WHERE id = $1 AND status = 'active'`,
        [invoice.rental_chain_id],
      );
      if (chain.length > 0 && chain[0].expected_pickup_date && chain[0].expected_pickup_date < today) {
        const expectedDate = new Date(chain[0].expected_pickup_date);
        const overdueDays = Math.ceil((Date.now() - expectedDate.getTime()) / (1000 * 60 * 60 * 24));
        const hasOverageLine = lineItems.some(li => li.line_type === 'overage_days');

        if (!hasOverageLine && resolvedPrice) {
          // Auto-create overage line item
          const rate = resolvedPrice.daily_overage_rate;
          const lineItem = this.lineItemRepo.create({
            invoice_id: invoiceId,
            sort_order: lineItems.length,
            line_type: 'overage_days',
            name: `${overdueDays} Day Overage`,
            quantity: overdueDays,
            unit_rate: rate,
            amount: overdueDays * rate,
            net_amount: overdueDays * rate,
          });
          await this.lineItemRepo.save(lineItem);

          issues.push(await this.createIssueIfNotExists(tenantId, {
            issue_type: 'overdue_days',
            invoice_id: invoiceId,
            rental_chain_id: invoice.rental_chain_id,
            description: `${overdueDays} day rental overage auto-added`,
            auto_resolvable: true,
            calculated_amount: overdueDays * rate,
            days_overdue: overdueDays,
            status: 'auto_resolved',
          }));
        }
      }
    }

    // 2. WEIGHT OVERAGE
    if (job && resolvedPrice) {
      const dumpCosts = await this.jobCostRepo.find({
        where: { job_id: job.id, cost_type: 'dump_expense' },
      });
      for (const cost of dumpCosts) {
        if (cost.net_weight_tons && Number(cost.net_weight_tons) > resolvedPrice.weight_allowance_tons) {
          const hasWeightLine = lineItems.some(li => li.line_type === 'overage_weight');
          if (!hasWeightLine) {
            const excess = Number(cost.net_weight_tons) - resolvedPrice.weight_allowance_tons;
            const amount = Math.round(excess * resolvedPrice.overage_per_ton * 100) / 100;

            const lineItem = this.lineItemRepo.create({
              invoice_id: invoiceId,
              sort_order: lineItems.length + 1,
              line_type: 'overage_weight',
              name: `Weight Overage (${excess.toFixed(2)} tons)`,
              quantity: 1,
              unit_rate: amount,
              amount,
              net_amount: amount,
            });
            await this.lineItemRepo.save(lineItem);

            issues.push(await this.createIssueIfNotExists(tenantId, {
              issue_type: 'weight_overage',
              invoice_id: invoiceId,
              job_id: job.id,
              description: `Weight overage of ${excess.toFixed(2)} tons auto-added`,
              auto_resolvable: true,
              calculated_amount: amount,
              status: 'auto_resolved',
            }));
          }
        }
      }
    }

    // 3. MISSING DUMP SLIP
    if (job && job.status === 'completed') {
      if (!job.dump_ticket_number && !job.dump_ticket_photo) {
        issues.push(await this.createIssueIfNotExists(tenantId, {
          issue_type: 'missing_dump_slip',
          invoice_id: invoiceId,
          job_id: job.id,
          description: 'Missing dump slip data for completed job',
          status: 'open',
        }));
      }
    }

    // 4. SURCHARGE GAP — check if job has overage items but no matching surcharge line items
    if (job && job.dump_overage_items && Array.isArray(job.dump_overage_items) && job.dump_overage_items.length > 0) {
      const hasSurchargeLine = lineItems.some(li => li.line_type === 'surcharge');
      if (!hasSurchargeLine) {
        issues.push(await this.createIssueIfNotExists(tenantId, {
          issue_type: 'surcharge_gap',
          invoice_id: invoiceId,
          job_id: job.id,
          description: `Job has ${job.dump_overage_items.length} flagged surcharge items but no surcharge line items on invoice`,
          status: 'open',
        }));
      }
    }

    // 5. PAST DUE
    if (['sent', 'delivered', 'read'].includes(invoice.status) && invoice.due_date < today && Number(invoice.balance_due) > 0) {
      const daysPast = Math.ceil((Date.now() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24));
      issues.push(await this.createIssueIfNotExists(tenantId, {
        issue_type: 'past_due',
        invoice_id: invoiceId,
        description: `Invoice is ${daysPast} days past due with $${invoice.balance_due} outstanding`,
        days_overdue: daysPast,
        calculated_amount: Number(invoice.balance_due),
        status: 'open',
      }));
    }

    // 7. PRICE MISMATCH
    if (resolvedPrice && job) {
      const rentalLine = lineItems.find(li => li.line_type === 'rental');
      if (rentalLine && Number(rentalLine.unit_rate) !== resolvedPrice.base_price && invoice.pricing_tier_used !== 'invoice') {
        issues.push(await this.createIssueIfNotExists(tenantId, {
          issue_type: 'price_mismatch',
          invoice_id: invoiceId,
          description: `Rental line rate ($${rentalLine.unit_rate}) differs from resolved price ($${resolvedPrice.base_price})`,
          calculated_amount: Math.abs(Number(rentalLine.unit_rate) - resolvedPrice.base_price),
          status: 'open',
        }));
      }
    }

    return issues.filter(Boolean);
  }

  async detectAllForTenant(tenantId: string) {
    const invoices = await this.invoiceRepo.find({
      where: {
        tenant_id: tenantId,
        status: Not(In(['voided', 'paid'])),
      },
    });

    const allIssues: BillingIssue[] = [];
    for (const inv of invoices) {
      const issues = await this.detectAllForInvoice(tenantId, inv.id);
      allIssues.push(...issues);
    }

    // 6. NO INVOICE — check completed jobs with no invoice
    const jobsWithoutInvoice = await this.jobRepo
      .createQueryBuilder('j')
      .leftJoin(Invoice, 'i', 'i.job_id = j.id')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.status = :status', { status: 'completed' })
      .andWhere('i.id IS NULL')
      .getMany();

    for (const job of jobsWithoutInvoice) {
      const issue = await this.createIssueIfNotExists(tenantId, {
        issue_type: 'no_invoice',
        job_id: job.id,
        description: `Completed job ${job.job_number} has no linked invoice`,
        status: 'open',
      });
      if (issue) allIssues.push(issue);
    }

    return allIssues;
  }

  async findAll(tenantId: string, query: { status?: string; issueType?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.issueRepo
      .createQueryBuilder('bi')
      .where('bi.tenant_id = :tenantId', { tenantId });

    if (query.status) qb.andWhere('bi.status = :status', { status: query.status });
    if (query.issueType) qb.andWhere('bi.issue_type = :issueType', { issueType: query.issueType });

    qb.orderBy('bi.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getSummary(tenantId: string) {
    const rows = await this.issueRepo
      .createQueryBuilder('bi')
      .select('bi.issue_type', 'issue_type')
      .addSelect('COUNT(*)::int', 'count')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.status = :status', { status: 'open' })
      .groupBy('bi.issue_type')
      .getRawMany();
    return rows;
  }

  async resolveIssue(issueId: string, userId: string) {
    await this.issueRepo.update(issueId, {
      status: 'manually_resolved',
      resolved_by: userId,
      resolved_at: new Date(),
    });
    return this.issueRepo.findOneBy({ id: issueId });
  }

  async dismissIssue(issueId: string, userId: string) {
    await this.issueRepo.update(issueId, {
      status: 'dismissed',
      resolved_by: userId,
      resolved_at: new Date(),
    });
    return this.issueRepo.findOneBy({ id: issueId });
  }

  private async createIssueIfNotExists(
    tenantId: string,
    data: Partial<BillingIssue>,
  ): Promise<BillingIssue | null> {
    // Check for duplicate
    const existing = await this.issueRepo.findOne({
      where: {
        tenant_id: tenantId,
        invoice_id: data.invoice_id || undefined,
        job_id: data.job_id || undefined,
        issue_type: data.issue_type,
        status: 'open',
      } as any,
    });
    if (existing) return null;

    const issue = this.issueRepo.create({
      tenant_id: tenantId,
      ...data,
    });
    return this.issueRepo.save(issue);
  }
}
