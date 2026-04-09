/**
 * Customer Dashboard aggregator.
 *
 * Composes existing services and repositories to return a single
 * denormalized payload for `GET /customers/:id/dashboard`. Does NOT
 * duplicate any business logic — all derivation lives in pure helpers
 * in `customer-dashboard.helpers.ts`, and balance math is reused from
 * `CustomersService.getCustomerBalance()`.
 *
 * Tenant isolation is preserved at every query boundary. The FIRST
 * call is `customersService.findOne(tenantId, customerId)` which
 * throws 404 if the customer is not in this tenant, so no downstream
 * query ever sees a cross-tenant customer id.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { Quote } from '../quotes/quote.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { CustomerNote } from '../notes/note.entity';
import { CustomersService } from './customers.service';
import { SmsOptOutService } from '../sms/sms-opt-out.service';
import { normalizePhone } from '../../common/utils/phone';
import {
  deriveStatusStrip,
  deriveServiceSites,
  deriveFinancialSnapshot,
  countExpiringQuotes,
  indexChainedJobs,
} from './customer-dashboard.helpers';
import type {
  CustomerDashboardResponse,
  CustomerDashboardIssue,
  CustomerDashboardChain,
  CustomerDashboardJobLink,
  CustomerDashboardStandaloneJob,
} from './customer-dashboard.types';

@Injectable()
export class CustomerDashboardService {
  constructor(
    @InjectRepository(Customer)
    private customersRepo: Repository<Customer>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
    @InjectRepository(Quote)
    private quoteRepo: Repository<Quote>,
    @InjectRepository(BillingIssue)
    private billingIssueRepo: Repository<BillingIssue>,
    @InjectRepository(RentalChain)
    private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private chainLinkRepo: Repository<TaskChainLink>,
    @InjectRepository(CustomerNote)
    private customerNoteRepo: Repository<CustomerNote>,
    private customersService: CustomersService,
    private smsOptOutService: SmsOptOutService,
  ) {}

  /**
   * Main aggregator entry point. Throws 404 if the customer is not in
   * this tenant (via the first `findOne` call). Every subsequent query
   * is also tenant-scoped — belt and suspenders.
   */
  async getCustomerDashboard(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerDashboardResponse> {
    // Tenant-scoped customer lookup — throws NotFoundException if absent.
    const customer = await this.customersService.findOne(tenantId, customerId);

    // Parallel fetches — all tenant-scoped.
    const [
      invoices,
      jobs,
      quotes,
      billingIssues,
      rentalChains,
      chainLinks,
      internalNotes,
      smsOptedOut,
    ] = await Promise.all([
      this.loadInvoices(tenantId, customerId),
      this.loadJobs(tenantId, customerId),
      this.loadActiveQuotes(tenantId, customerId),
      this.loadBillingIssuesForCustomer(tenantId, customerId),
      this.loadRentalChains(tenantId, customerId),
      this.loadChainLinksForCustomer(tenantId, customerId),
      this.loadInternalNotes(tenantId, customerId),
      this.checkSmsOptOut(tenantId, customer.phone),
    ]);

    // ── Derived ────────────────────────────────────────────────────
    const financial = deriveFinancialSnapshot(
      invoices.map((i) => ({
        id: i.id,
        status: i.status,
        total: Number(i.total) || 0,
        balance_due: Number(i.balance_due) || 0,
        due_date: i.due_date,
        created_at: i.created_at,
      })),
    );
    const serviceSites = deriveServiceSites(customer.service_addresses);
    const expiringQuoteCount = countExpiringQuotes(
      quotes.map((q) => ({ status: q.status, expires_at: q.expires_at })),
    );

    // Dispatch blocker = jobs with an unpaid linked invoice (status not in
    // paid/partial). Mirrors the real dispatch-board gating rule at
    // `dispatch.service.ts:39` without duplicating the query there.
    const dispatchBlockerCount = this.countDispatchBlockers(jobs, invoices);

    const statusStrip = deriveStatusStrip({
      netBalance: financial.outstandingBalance,
      overdueInvoiceCount: financial.overdueCount,
      overdueThirtyPlusCount: financial.overdueThirtyPlusCount,
      openBillingIssueCount: billingIssues.length,
      dispatchBlockerCount,
      smsOptedOut,
      geocodeFailureCount: serviceSites.geocodeFailureCount,
      expiringQuoteCount,
    });

    // ── Jobs timeline composition ──────────────────────────────────
    const { chainedJobIds } = indexChainedJobs(
      chainLinks.map((l) => ({
        id: l.id,
        rental_chain_id: l.rental_chain_id,
        job_id: l.job_id,
        sequence_number: l.sequence_number,
        task_type: l.task_type,
        status: l.status,
        previous_link_id: l.previous_link_id,
        next_link_id: l.next_link_id,
        scheduled_date: l.scheduled_date,
      })),
    );

    const jobsById = new Map(jobs.map((j) => [j.id, j]));
    const invoicesByJobId = new Map(
      invoices.filter((i) => i.job_id).map((i) => [i.job_id, i]),
    );

    const chains: CustomerDashboardChain[] = rentalChains.map((chain) => {
      const links = chainLinks
        .filter((l) => l.rental_chain_id === chain.id)
        .sort((a, b) => a.sequence_number - b.sequence_number)
        .map((l): CustomerDashboardJobLink => {
          const job = jobsById.get(l.job_id);
          const linkedInvoice = invoicesByJobId.get(l.job_id);
          return {
            linkId: l.id,
            sequenceNumber: l.sequence_number,
            taskType: l.task_type,
            linkStatus: l.status,
            scheduledDate: l.scheduled_date,
            jobId: l.job_id,
            jobNumber: job?.job_number ?? '',
            jobStatus: job?.status ?? 'unknown',
            jobType: job?.job_type ?? l.task_type,
            assetSubtype: job?.asset_subtype ?? null,
            linkedInvoiceStatus: linkedInvoice?.status ?? null,
            previousLinkId: l.previous_link_id,
            nextLinkId: l.next_link_id,
          };
        });
      return {
        chainId: chain.id,
        status: chain.status,
        dropOffDate: chain.drop_off_date,
        expectedPickupDate: chain.expected_pickup_date ?? null,
        dumpsterSize: chain.dumpster_size ?? null,
        links,
      };
    });

    const standaloneJobs: CustomerDashboardStandaloneJob[] = jobs
      .filter((j) => !chainedJobIds.has(j.id))
      .map((j) => ({
        id: j.id,
        jobNumber: j.job_number,
        jobType: j.job_type,
        jobStatus: j.status,
        scheduledDate: j.scheduled_date ?? null,
        assetSubtype: j.asset_subtype ?? null,
        totalPrice: Number(j.total_price) || 0,
        linkedInvoiceStatus: invoicesByJobId.get(j.id)?.status ?? null,
      }));

    // ── Issues composition ─────────────────────────────────────────
    const issues: CustomerDashboardIssue[] = [];

    for (const bi of billingIssues) {
      issues.push({
        id: bi.id,
        category: 'billing',
        description: bi.description,
        severity: bi.auto_resolvable ? 'warning' : 'critical',
        link: `/billing-issues/${bi.id}`,
        createdAt: bi.created_at?.toISOString?.() ?? null,
      });
    }

    if (serviceSites.geocodeFailureCount > 0) {
      issues.push({
        id: `geocode-${customerId}`,
        category: 'address',
        description: `${serviceSites.geocodeFailureCount} service address${serviceSites.geocodeFailureCount === 1 ? '' : 'es'} could not be geocoded`,
        severity: 'warning',
        link: `/customers/${customerId}`,
        createdAt: null,
      });
    }

    if (smsOptedOut) {
      issues.push({
        id: `sms-optout-${customerId}`,
        category: 'sms_blocked',
        description:
          'Customer has opted out of SMS. Outbound SMS is suppressed until they reply START.',
        severity: 'info',
        link: null,
        createdAt: null,
      });
    }

    // ── Identity composition ───────────────────────────────────────
    return {
      identity: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        companyName: customer.company_name ?? null,
        type: customer.type,
        accountId: customer.account_id ?? null,
        phone: customer.phone ?? null,
        email: customer.email ?? null,
        tags: Array.isArray(customer.tags) ? customer.tags : [],
        isActive: customer.is_active,
        smsStatus: !customer.phone
          ? 'no_phone'
          : smsOptedOut
            ? 'opted_out'
            : 'enabled',
      },
      statusStrip,
      serviceSites,
      jobsTimeline: { chains, standaloneJobs },
      financial,
      issues,
      notes: {
        internal: internalNotes.map((n) => ({
          id: n.id,
          content: n.content,
          type: n.type,
          authorName: n.author_name ?? null,
          createdAt: n.created_at.toISOString(),
        })),
        driverInstructions: customer.driver_instructions ?? null,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Data-loading helpers — all tenant-scoped.
  // ─────────────────────────────────────────────────────────────

  private loadInvoices(tenantId: string, customerId: string): Promise<Invoice[]> {
    return this.invoiceRepo
      .createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.customer_id = :customerId', { customerId })
      .orderBy('i.created_at', 'DESC')
      .getMany();
  }

  private loadJobs(tenantId: string, customerId: string): Promise<Job[]> {
    return this.jobRepo
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.customer_id = :customerId', { customerId })
      .orderBy('j.scheduled_date', 'DESC', 'NULLS LAST')
      .addOrderBy('j.created_at', 'DESC')
      .getMany();
  }

  private loadActiveQuotes(tenantId: string, customerId: string): Promise<Quote[]> {
    return this.quoteRepo
      .createQueryBuilder('q')
      .where('q.tenant_id = :tenantId', { tenantId })
      .andWhere('q.customer_id = :customerId', { customerId })
      .andWhere('q.status IN (:...statuses)', { statuses: ['draft', 'sent'] })
      .getMany();
  }

  /**
   * Customer-scoped billing issues. `billing_issues` has no direct
   * customer_id column, so we join through invoices OR jobs — either of
   * which may carry the link. Both joins are tenant-scoped.
   */
  private loadBillingIssuesForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<BillingIssue[]> {
    return this.billingIssueRepo
      .createQueryBuilder('bi')
      .leftJoin('invoices', 'inv', 'inv.id = bi.invoice_id AND inv.tenant_id = :tenantId')
      .leftJoin('jobs', 'j', 'j.id = bi.job_id AND j.tenant_id = :tenantId')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.status = :status', { status: 'open' })
      .andWhere(
        '(inv.customer_id = :customerId OR j.customer_id = :customerId)',
        { customerId },
      )
      .orderBy('bi.created_at', 'DESC')
      .getMany();
  }

  private loadRentalChains(
    tenantId: string,
    customerId: string,
  ): Promise<RentalChain[]> {
    return this.rentalChainRepo
      .createQueryBuilder('rc')
      .where('rc.tenant_id = :tenantId', { tenantId })
      .andWhere('rc.customer_id = :customerId', { customerId })
      .orderBy('rc.drop_off_date', 'DESC')
      .getMany();
  }

  /**
   * Chain links for this customer — filter through the rental_chains
   * join so we only see links belonging to THIS customer's chains.
   * Tenant-scoped via the chain filter.
   */
  private loadChainLinksForCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<TaskChainLink[]> {
    return this.chainLinkRepo
      .createQueryBuilder('tcl')
      .innerJoin(
        'rental_chains',
        'rc',
        'rc.id = tcl.rental_chain_id AND rc.tenant_id = :tenantId AND rc.customer_id = :customerId',
      )
      .setParameters({ tenantId, customerId })
      .orderBy('tcl.rental_chain_id', 'ASC')
      .addOrderBy('tcl.sequence_number', 'ASC')
      .getMany();
  }

  private loadInternalNotes(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerNote[]> {
    return this.customerNoteRepo.find({
      where: { tenant_id: tenantId, customer_id: customerId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Look up SMS opt-out state for the customer's phone. Normalizes to
   * E.164 first (required by SmsOptOutService.isOptedOut contract).
   * Returns false for null/invalid phones — UI maps that to 'no_phone'.
   */
  private async checkSmsOptOut(
    tenantId: string,
    phone: string | null | undefined,
  ): Promise<boolean> {
    if (!phone) return false;
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    return this.smsOptOutService.isOptedOut(tenantId, normalized);
  }

  /**
   * Count jobs that would be hidden from the dispatch board due to an
   * unpaid linked invoice. Mirrors `dispatch.service.ts:39` gating rule
   * without duplicating the query. Paid/partial invoices do NOT block.
   */
  private countDispatchBlockers(jobs: Job[], invoices: Invoice[]): number {
    const invoicesByJobId = new Map(
      invoices.filter((i) => i.job_id).map((i) => [i.job_id, i]),
    );
    let count = 0;
    for (const job of jobs) {
      // Only count blockers for jobs that are still operationally active.
      if (['completed', 'cancelled', 'voided'].includes(job.status)) continue;
      const inv = invoicesByJobId.get(job.id);
      if (!inv) continue; // No linked invoice → visible on board (manual/legacy)
      if (inv.status === 'paid' || inv.status === 'partial') continue;
      if (inv.status === 'voided' || inv.status === 'draft') continue;
      count += 1;
    }
    return count;
  }
}
