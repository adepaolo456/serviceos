import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Asset)
    private assetsRepository: Repository<Asset>,
  ) {}

  async getDashboard(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];

    const [
      revenue,
      revenueThisMonth,
      jobs,
      jobsThisMonth,
      completedJobs,
      cancelledJobs,
      avgJobValue,
      customers,
      newCustomersThisMonth,
      assets,
      assetsByStatus,
    ] = await Promise.all([
      this.getTotalRevenue(tenantId),
      this.getRevenueAfter(tenantId, monthStart),
      this.getJobCount(tenantId),
      this.getJobCountAfter(tenantId, monthStart),
      this.getJobCountByStatus(tenantId, 'completed'),
      this.getJobCountByStatus(tenantId, 'cancelled'),
      this.getAverageJobValue(tenantId),
      this.getCustomerCount(tenantId),
      this.getCustomerCountAfter(tenantId, monthStart),
      this.getAssetCount(tenantId),
      this.getAssetsByStatus(tenantId),
    ]);

    const totalAssets = Number(assets);
    const onSite = assetsByStatus.find((s) => s.status === 'on_site');
    const inTransit = assetsByStatus.find((s) => s.status === 'in_transit');
    const deployed = Number(onSite?.count ?? 0) + Number(inTransit?.count ?? 0);
    const utilizationRate =
      totalAssets > 0 ? Math.round((deployed / totalAssets) * 10000) / 100 : 0;

    return {
      revenue: {
        total: Number(revenue),
        thisMonth: Number(revenueThisMonth),
      },
      jobs: {
        total: Number(jobs),
        thisMonth: Number(jobsThisMonth),
        completed: Number(completedJobs),
        cancelled: Number(cancelledJobs),
        averageValue: Number(avgJobValue),
      },
      customers: {
        total: Number(customers),
        newThisMonth: Number(newCustomersThisMonth),
      },
      assets: {
        total: totalAssets,
        byStatus: assetsByStatus.map((s) => ({
          status: s.status,
          count: Number(s.count),
        })),
        utilizationRate,
      },
    };
  }

  async getRevenueByDay(tenantId: string, startDate: string, endDate: string) {
    const rows = await this.invoicesRepository
      .createQueryBuilder('i')
      .select('DATE(i.paid_at)', 'date')
      .addSelect('SUM(i.total)', 'revenue')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.status = :status', { status: 'paid' })
      .andWhere('i.paid_at >= :startDate', { startDate })
      .andWhere('i.paid_at <= :endDate', { endDate: `${endDate} 23:59:59` })
      .groupBy('DATE(i.paid_at)')
      .orderBy('DATE(i.paid_at)', 'ASC')
      .getRawMany<{ date: string; revenue: string }>();

    return rows.map((r) => ({
      date: r.date,
      revenue: Number(r.revenue),
    }));
  }

  async getJobsByStatus(tenantId: string) {
    const rows = await this.jobsRepository
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('j.tenant_id = :tenantId', { tenantId })
      .groupBy('j.status')
      .orderBy('count', 'DESC')
      .getRawMany<{ status: string; count: number }>();

    return rows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    }));
  }

  /**
   * Tenant-wide operational blocker counts for the Jobs page top strip.
   * Each count is a scalar — the Jobs page reads these directly to
   * populate its tiles without paginating through all jobs. Zero mutation.
   *
   * Blocker definitions:
   *   - payment_blocked: jobs with a linked invoice whose status is not
   *     in ('paid','partial','voided') AND balance_due > 0, in a
   *     non-terminal job state. Matches the dispatch board + enrichment
   *     predicate at dispatch.service.ts:39 and jobs.service.ts
   *     enrichJobsForBoard's dispatch_ready derivation.
   *   - billing_issue: jobs with at least one `open` billing issue.
   *   - unassigned_active: jobs with no driver AND not in a terminal
   *     state (matches existing Jobs page "unassigned" semantics).
   */
  async getJobsByBlocker(tenantId: string): Promise<{
    payment_blocked: number;
    billing_issue: number;
    unassigned_active: number;
  }> {
    const [paymentBlockedRow, billingIssueRow, unassignedActiveRow] = await Promise.all([
      // payment_blocked: inner join invoices, scoped to tenant on both sides
      this.jobsRepository
        .createQueryBuilder('j')
        .innerJoin(
          'invoices',
          'inv',
          'inv.job_id = j.id AND inv.tenant_id = j.tenant_id',
        )
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.status NOT IN (:...terminalJobStatuses)', {
          terminalJobStatuses: ['completed', 'cancelled', 'voided'],
        })
        .andWhere('inv.status NOT IN (:...terminalInvoiceStatuses)', {
          terminalInvoiceStatuses: ['paid', 'partial', 'voided'],
        })
        .andWhere('inv.balance_due > 0')
        .select('COUNT(DISTINCT j.id)::int', 'count')
        .getRawOne<{ count: number }>(),

      // billing_issue: distinct jobs with at least one open billing issue
      this.jobsRepository
        .createQueryBuilder('j')
        .innerJoin(
          'billing_issues',
          'bi',
          'bi.job_id = j.id AND bi.tenant_id = j.tenant_id',
        )
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('bi.status = :openStatus', { openStatus: 'open' })
        .select('COUNT(DISTINCT j.id)::int', 'count')
        .getRawOne<{ count: number }>(),

      // unassigned_active: matches the Jobs page's existing "unassigned"
      // tile — jobs with no driver in non-terminal state.
      this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.assigned_driver_id IS NULL')
        .andWhere('j.status NOT IN (:...terminalJobStatuses)', {
          terminalJobStatuses: ['completed', 'cancelled'],
        })
        .select('COUNT(*)::int', 'count')
        .getRawOne<{ count: number }>(),
    ]);

    return {
      payment_blocked: Number(paymentBlockedRow?.count ?? 0),
      billing_issue: Number(billingIssueRow?.count ?? 0),
      unassigned_active: Number(unassignedActiveRow?.count ?? 0),
    };
  }

  /**
   * Jobs page top-strip summary counts. Multi-tenant scoped.
   *
   * `blocked` is a computed UI/analytics layer — NOT a job status and NOT
   * stored anywhere. A job is considered Blocked when:
   *   (a) it has at least one billing issue with `status = 'open'`, OR
   *   (b) it has `status = 'completed'` AND its linked invoice has
   *       `balance_due > 0` AND the invoice status is NOT in
   *       ('paid','partial','voided').
   *
   * The union is counted via COUNT(DISTINCT j.id), so a job matching both
   * conditions is counted once. The frontend per-row predicate
   * (`isJobBlocked` in jobs/page.tsx) applies the identical boolean so the
   * tile count and the row borders can never diverge.
   *
   * Security:
   *   - `tenant_id` is required and parameterised on every predicate.
   *   - Every JOIN condition includes `<alias>.tenant_id = j.tenant_id`
   *     (belt-and-suspenders against cross-tenant leakage if a row ever had
   *     a stale FK).
   *   - No raw string interpolation of tenantId.
   *   - Returns only scalar aggregates — no billing issue details, no
   *     invoice numbers, no customer data.
   */
  async getJobsSummary(tenantId: string): Promise<{
    unassigned: number;
    assigned: number;
    enRoute: number;
    completed: number;
    blocked: number;
  }> {
    const [
      unassignedCount,
      assignedCount,
      enRouteCount,
      completedCount,
      blockedRow,
    ] = await Promise.all([
      // unassigned: stored `pending` or `confirmed` — dispatch-ready but no
      // driver yet. Matches the existing Jobs page "unassigned" grouping.
      this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.status IN (:...statuses)', {
          statuses: ['pending', 'confirmed'],
        })
        .getCount(),

      // assigned: stored `dispatched` — driver attached, not yet moving.
      this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.status = :status', { status: 'dispatched' })
        .getCount(),

      // en_route: stored `en_route` — driver traveling.
      this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.status = :status', { status: 'en_route' })
        .getCount(),

      // completed: stored `completed` — job finished on-site.
      this.jobsRepository
        .createQueryBuilder('j')
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.status = :status', { status: 'completed' })
        .getCount(),

      // blocked: UNION of
      //   (open billing issue)
      //   OR (completed AND unpaid linked invoice)
      // Counted as DISTINCT jobs so overlapping matches collapse.
      this.jobsRepository
        .createQueryBuilder('j')
        .leftJoin(
          'billing_issues',
          'bi',
          'bi.job_id = j.id AND bi.tenant_id = j.tenant_id',
        )
        .leftJoin(
          'invoices',
          'inv',
          'inv.job_id = j.id AND inv.tenant_id = j.tenant_id',
        )
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere(
          `(
            (bi.id IS NOT NULL AND bi.status = :openIssueStatus)
            OR (
              j.status = :completedJobStatus
              AND inv.balance_due > 0
              AND inv.status NOT IN (:...paidInvoiceStatuses)
            )
          )`,
          {
            openIssueStatus: 'open',
            completedJobStatus: 'completed',
            paidInvoiceStatuses: ['paid', 'partial', 'voided'],
          },
        )
        .select('COUNT(DISTINCT j.id)::int', 'count')
        .getRawOne<{ count: number }>(),
    ]);

    return {
      unassigned: Number(unassignedCount),
      assigned: Number(assignedCount),
      enRoute: Number(enRouteCount),
      completed: Number(completedCount),
      blocked: Number(blockedRow?.count ?? 0),
    };
  }

  private async getTotalRevenue(tenantId: string): Promise<number> {
    const result = await this.invoicesRepository
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.total), 0)', 'total')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.status = :status', { status: 'paid' })
      .getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  private async getRevenueAfter(
    tenantId: string,
    after: string,
  ): Promise<number> {
    const result = await this.invoicesRepository
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.total), 0)', 'total')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.status = :status', { status: 'paid' })
      .andWhere('i.paid_at >= :after', { after })
      .getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  private async getJobCount(tenantId: string): Promise<number> {
    return this.jobsRepository.count({
      where: { tenant_id: tenantId },
    });
  }

  private async getJobCountAfter(
    tenantId: string,
    after: string,
  ): Promise<number> {
    return this.jobsRepository
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.created_at >= :after', { after })
      .getCount();
  }

  private async getJobCountByStatus(
    tenantId: string,
    status: string,
  ): Promise<number> {
    return this.jobsRepository.count({
      where: { tenant_id: tenantId, status },
    });
  }

  private async getAverageJobValue(tenantId: string): Promise<number> {
    const result = await this.jobsRepository
      .createQueryBuilder('j')
      .select('COALESCE(AVG(j.total_price), 0)', 'avg')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.total_price IS NOT NULL')
      .andWhere('j.total_price > 0')
      .getRawOne<{ avg: string }>();
    return Math.round(Number(result?.avg ?? 0) * 100) / 100;
  }

  private async getCustomerCount(tenantId: string): Promise<number> {
    return this.customersRepository.count({
      where: { tenant_id: tenantId, is_active: true },
    });
  }

  private async getCustomerCountAfter(
    tenantId: string,
    after: string,
  ): Promise<number> {
    return this.customersRepository
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.created_at >= :after', { after })
      .getCount();
  }

  private async getAssetCount(tenantId: string): Promise<number> {
    return this.assetsRepository.count({
      where: { tenant_id: tenantId },
    });
  }

  private async getAssetsByStatus(
    tenantId: string,
  ): Promise<Array<{ status: string; count: string }>> {
    return this.assetsRepository
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .groupBy('a.status')
      .getRawMany();
  }
}
