import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { JobCost } from '../billing/entities/job-cost.entity';
import { Job } from '../jobs/entities/job.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../auth/entities/user.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { ProfitResponseDto } from './dto/profit-response.dto';
import { AssetsResponseDto } from './dto/assets-response.dto';
import { CustomersResponseDto } from './dto/customers-response.dto';
import { RevenueSourceDetailResponseDto } from './dto/revenue-source-detail-response.dto';
import { RevenueDailyDetailResponseDto } from './dto/revenue-daily-detail-response.dto';
import { RevenueInvoicesResponseDto } from './dto/revenue-invoices-response.dto';
import { RevenueResponseDto } from './dto/revenue-response.dto';
import { DriversResponseDto } from './dto/drivers-response.dto';
import { AccountsReceivableResponseDto } from './dto/accounts-receivable-response.dto';

const CORRECTION_CUTOFF = '2026-04-02T00:00:00Z';
function classifyRecord(createdAt: string | Date): 'legacy' | 'post-correction' {
  return new Date(createdAt) < new Date(CORRECTION_CUTOFF) ? 'legacy' : 'post-correction';
}

/** Statuses that count as booked revenue. Drafts and voided invoices are excluded. */
const REVENUE_STATUSES = ['open', 'paid', 'partial'] as const;
/** SQL fragment for WHERE clause (parameterised queries) */
const REVENUE_STATUS_SQL = `i.status IN ('open', 'paid', 'partial')`;

@Injectable()
export class ReportingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(JobCost) private jobCostRepo: Repository<JobCost>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(DumpTicket) private ticketRepo: Repository<DumpTicket>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(RentalChain) private chainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink) private linkRepo: Repository<TaskChainLink>,
    private dataSource: DataSource,
  ) {}

  private dateRange(s?: string, e?: string) {
    const now = new Date();
    const start = s || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = e || now.toISOString().split('T')[0];
    return { start, end };
  }

  async getRevenue(tenantId: string, startDate?: string, endDate?: string, grouping?: string): Promise<RevenueResponseDto> {
    const { start, end } = this.dateRange(startDate, endDate);

    const endTs = end + 'T23:59:59';

    const totals = await this.invoiceRepo.createQueryBuilder('i')
      .select('SUM(i.total)', 'totalRevenue')
      .addSelect(`SUM(CASE WHEN i.status IN ('open', 'partial') THEN i.balance_due ELSE 0 END)`, 'totalOutstanding')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status IN (:...rstats)', { rstats: [...REVENUE_STATUSES] })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: endTs })
      .getRawOne();

    // Collected: sum of actual completed payments, net of refunds,
    // filtered by payment applied_at within the date range.
    const collected = await this.dataSource.query(
      `SELECT COALESCE(SUM(p.amount - p.refunded_amount), 0) as "totalCollected"
       FROM payments p
       WHERE p.tenant_id = $1
         AND p.status = 'completed'
         AND p.applied_at >= $2
         AND p.applied_at <= $3`,
      [tenantId, start, endTs],
    );

    const overdue = await this.invoiceRepo.createQueryBuilder('i')
      .select('SUM(i.balance_due)', 'totalOverdue')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status IN (:...statuses)', { statuses: ['open', 'partial'] })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: endTs })
      .andWhere('i.due_date < :today', { today: new Date().toISOString().split('T')[0] })
      .getRawOne();

    // Revenue by source: JOIN through jobs to get source with counts.
    const bySource = await this.dataSource.query(
      `SELECT COALESCE(j.source, 'other') as source,
              SUM(i.total) as amount,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE i.status = 'paid')::int as "paidCount",
              SUM(CASE WHEN i.status IN ('open', 'partial') THEN i.balance_due ELSE 0 END) as outstanding
       FROM invoices i
       LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1
         AND ${REVENUE_STATUS_SQL}
         AND i.created_at >= $2
         AND i.created_at <= $3
       GROUP BY COALESCE(j.source, 'other')
       ORDER BY SUM(i.total) DESC`,
      [tenantId, start, endTs],
    );

    // Time-grouped revenue with counts (daily/weekly/monthly).
    const groupExpr = grouping === 'weekly'
      ? "DATE_TRUNC('week', i.created_at)::date"
      : grouping === 'monthly'
      ? "DATE_TRUNC('month', i.created_at)::date"
      : "DATE(i.created_at)";

    const periodRevenue = await this.dataSource.query(
      `SELECT ${groupExpr} as date,
              SUM(i.total) as amount,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE i.status = 'paid')::int as "paidCount"
       FROM invoices i
       WHERE i.tenant_id = $1
         AND ${REVENUE_STATUS_SQL}
         AND i.created_at >= $2
         AND i.created_at <= $3
         AND i.created_at IS NOT NULL
       GROUP BY ${groupExpr}
       ORDER BY ${groupExpr} DESC`,
      [tenantId, start, endTs],
    );

    return {
      totalRevenue: Number(totals?.totalRevenue) || 0,
      totalCollected: Number(collected[0]?.totalCollected) || 0,
      totalOutstanding: Number(totals?.totalOutstanding) || 0,
      totalOverdue: Number(overdue?.totalOverdue) || 0,
      revenueBySource: bySource.map(r => ({
        source: r.source || 'other',
        amount: Number(r.amount),
        count: Number(r.count),
        paidCount: Number(r.paidCount),
        outstanding: Number(r.outstanding),
      })),
      dailyRevenue: periodRevenue.map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : typeof d.date === 'string' ? d.date.split('T')[0] : null,
        amount: Number(d.amount),
        count: Number(d.count),
        paidCount: Number(d.paidCount),
      })),
      grouping: grouping || 'daily',
      period: { start, end },
    };
  }

  /** Shared SELECT for invoice drill-down queries */
  private invoiceDetailSelect = `
    SELECT i.id, i.invoice_number as "invoiceNumber",
           COALESCE(NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), 'Unknown Customer') as "customerName",
           i.total, i.amount_paid as "amountPaid",
           i.balance_due as "balanceDue", i.status, i.created_at as "createdAt",
           j.id as "jobId", j.job_number as "jobNumber"
    FROM invoices i
    LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
    LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id`;

  private mapInvoiceRows(rows: any[]) {
    return rows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      customerName: r.customerName,
      total: Number(r.total),
      amountPaid: Number(r.amountPaid),
      balanceDue: Number(r.balanceDue),
      status: r.status,
      createdAt: r.createdAt,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
    }));
  }

  async getRevenueBySourceDetail(tenantId: string, source: string, startDate?: string, endDate?: string): Promise<RevenueSourceDetailResponseDto> {
    const { start, end } = this.dateRange(startDate, endDate);
    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
         AND ${REVENUE_STATUS_SQL}
         AND i.created_at >= $2
         AND i.created_at <= $3
         AND COALESCE(j.source, 'other') = $4
       ORDER BY i.created_at DESC`,
      [tenantId, start, end + 'T23:59:59', source],
    );
    return { source, invoices: this.mapInvoiceRows(rows) };
  }

  async getRevenueByDailyDetail(tenantId: string, date: string): Promise<RevenueDailyDetailResponseDto> {
    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
         AND ${REVENUE_STATUS_SQL}
         AND DATE(i.created_at) = $2
       ORDER BY i.created_at DESC`,
      [tenantId, date],
    );
    return { date, invoices: this.mapInvoiceRows(rows) };
  }

  async getRevenueInvoices(tenantId: string, filter: string, startDate?: string, endDate?: string): Promise<RevenueInvoicesResponseDto> {
    const { start, end } = this.dateRange(startDate, endDate);
    const endTs = end + 'T23:59:59';

    // Collected: query invoices that received completed payments in the date range,
    // using payment applied_at as the time axis (money actually received).
    if (filter === 'collected') {
      const rows = await this.dataSource.query(
        `SELECT DISTINCT ON (i.id)
                i.id, i.invoice_number as "invoiceNumber",
                COALESCE(NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), 'Unknown Customer') as "customerName",
                i.total,
                (SELECT COALESCE(SUM(p2.amount - p2.refunded_amount), 0) FROM payments p2
                 WHERE p2.invoice_id = i.id AND p2.status = 'completed') as "amountPaid",
                i.balance_due as "balanceDue", i.status, i.created_at as "createdAt",
                j.id as "jobId", j.job_number as "jobNumber"
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
         LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
         LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
         WHERE p.tenant_id = $1
           AND p.status = 'completed'
           AND p.applied_at >= $2
           AND p.applied_at <= $3
         ORDER BY i.id, i.created_at DESC`,
        [tenantId, start, endTs],
      );
      return { filter, invoices: this.mapInvoiceRows(rows) };
    }

    let statusFilter = REVENUE_STATUS_SQL;
    let whereExtra = '';
    const params: any[] = [tenantId, start, endTs];

    if (filter === 'outstanding') {
      statusFilter = `i.status IN ('open', 'partial')`;
      whereExtra = ` AND i.balance_due > 0`;
    } else if (filter === 'overdue') {
      statusFilter = `i.status IN ('open', 'partial')`;
      whereExtra = ` AND i.due_date < $4`;
      params.push(new Date().toISOString().split('T')[0]);
    }

    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
         AND ${statusFilter}
         AND i.created_at >= $2
         AND i.created_at <= $3
         ${whereExtra}
       ORDER BY i.created_at DESC`,
      params,
    );
    return { filter, invoices: this.mapInvoiceRows(rows) };
  }

  async getDumpCosts(tenantId: string, startDate?: string, endDate?: string) {
    const { start, end } = this.dateRange(startDate, endDate);

    const totals = await this.ticketRepo.createQueryBuilder('t')
      .select('SUM(t.total_cost)', 'totalDumpCosts')
      .addSelect('SUM(t.customer_charges)', 'totalCustomerCharges')
      .where('t.tenant_id = :tid', { tid: tenantId })
      .andWhere('t.created_at >= :start', { start })
      .andWhere('t.created_at <= :end', { end: end + 'T23:59:59' })
      .getRawOne();

    const dumpCosts = Number(totals?.totalDumpCosts) || 0;
    const custCharges = Number(totals?.totalCustomerCharges) || 0;

    const byFacility = await this.ticketRepo.createQueryBuilder('t')
      .select('t.dump_location_id', 'dumpLocationId')
      .addSelect('t.dump_location_name', 'dumpLocationName')
      .addSelect('SUM(t.total_cost)', 'totalCost')
      .addSelect('COUNT(*)', 'tripCount')
      .addSelect('AVG(t.total_cost)', 'averageCostPerTrip')
      .where('t.tenant_id = :tid', { tid: tenantId })
      .andWhere('t.created_at >= :start', { start })
      .andWhere('t.created_at <= :end', { end: end + 'T23:59:59' })
      .groupBy('t.dump_location_id')
      .addGroupBy('t.dump_location_name')
      .getRawMany();

    const byWasteType = await this.ticketRepo.createQueryBuilder('t')
      .select('t.waste_type', 'wasteType')
      .addSelect('SUM(t.total_cost)', 'totalCost')
      .addSelect('SUM(t.weight_tons)', 'totalWeight')
      .where('t.tenant_id = :tid', { tid: tenantId })
      .andWhere('t.created_at >= :start', { start })
      .andWhere('t.created_at <= :end', { end: end + 'T23:59:59' })
      .groupBy('t.waste_type')
      .getRawMany();

    return {
      totalDumpCosts: dumpCosts,
      totalCustomerCharges: custCharges,
      totalMargin: custCharges - dumpCosts,
      marginPercent: dumpCosts > 0 ? ((custCharges - dumpCosts) / dumpCosts * 100) : 0,
      costsByFacility: byFacility.map(f => ({ ...f, totalCost: Number(f.totalCost), tripCount: Number(f.tripCount), averageCostPerTrip: Number(f.averageCostPerTrip) })),
      costsByWasteType: byWasteType.map(w => ({ ...w, totalCost: Number(w.totalCost), totalWeight: Number(w.totalWeight) })),
      period: { start, end },
    };
  }

  async getDumpSlips(tenantId: string, startDate?: string, endDate?: string, dumpLocationId?: string, search?: string, status?: string) {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const start = startDate || monday.toISOString().split('T')[0];
    const end = endDate || now.toISOString().split('T')[0];

    const baseWhere = `t.tenant_id = $1 AND t.submitted_at >= $2 AND t.submitted_at <= $3`;
    const params: any[] = [tenantId, start, end + 'T23:59:59'];
    let extraWhere = '';
    let paramIdx = 4;

    if (dumpLocationId) { extraWhere += ` AND t.dump_location_id = $${paramIdx}`; params.push(dumpLocationId); paramIdx++; }
    if (status) {
      if (status === 'invoiced') { extraWhere += ` AND t.invoiced = true`; }
      else { extraWhere += ` AND t.status = $${paramIdx}`; params.push(status); paramIdx++; }
    }
    if (search) { extraWhere += ` AND (t.ticket_number ILIKE $${paramIdx} OR CONCAT(c.first_name, ' ', c.last_name) ILIKE $${paramIdx})`; params.push(`%${search}%`); paramIdx++; }

    const [summaryRows] = await this.ticketRepo.query(
      `SELECT COUNT(*) as total_tickets, COALESCE(SUM(t.weight_tons),0) as total_weight, COALESCE(SUM(t.total_cost),0) as total_dump_cost, COALESCE(SUM(t.fuel_env_cost),0) as total_fuel_env, COALESCE(SUM(t.customer_charges),0) as total_customer_charges FROM dump_tickets t LEFT JOIN jobs j ON t.job_id = j.id LEFT JOIN customers c ON j.customer_id = c.id WHERE ${baseWhere}${extraWhere}`,
      params,
    );
    const summary = summaryRows;

    const byFacility = await this.ticketRepo.query(
      `SELECT t.dump_location_id, t.dump_location_name, COUNT(*) as ticket_count, COALESCE(SUM(t.weight_tons),0) as total_weight, COALESCE(SUM(t.dump_tonnage_cost),0) as total_dump_cost, COALESCE(SUM(t.fuel_env_cost),0) as total_fuel_env, COALESCE(SUM(t.total_cost),0) as total_cost, COALESCE(SUM(t.customer_charges),0) as total_customer_charges FROM dump_tickets t LEFT JOIN jobs j ON t.job_id = j.id LEFT JOIN customers c ON j.customer_id = c.id WHERE ${baseWhere}${extraWhere} GROUP BY t.dump_location_id, t.dump_location_name ORDER BY t.dump_location_name`,
      params,
    );

    const tickets = await this.ticketRepo.query(
      `SELECT t.id, t.ticket_number, t.submitted_at, t.job_id, j.job_number, CONCAT(c.first_name, ' ', c.last_name) as customer_name, t.dump_location_name, t.waste_type, t.weight_tons, t.dump_tonnage_cost, t.fuel_env_cost, t.dump_surcharge_cost, t.total_cost, t.customer_tonnage_charge, t.customer_surcharge_charge, t.customer_charges, t.overage_items, t.status, t.invoiced, t.invoice_id FROM dump_tickets t LEFT JOIN jobs j ON t.job_id = j.id LEFT JOIN customers c ON j.customer_id = c.id WHERE ${baseWhere}${extraWhere} ORDER BY t.submitted_at DESC`,
      params,
    );

    return {
      summary: {
        totalTickets: Number(summary.total_tickets),
        totalWeightTons: Number(summary.total_weight),
        totalDumpCost: Number(summary.total_dump_cost),
        totalFuelEnvCost: Number(summary.total_fuel_env),
        totalCustomerCharges: Number(summary.total_customer_charges),
        totalMargin: Number(summary.total_customer_charges) - Number(summary.total_dump_cost),
      },
      byFacility: byFacility.map(f => ({
        dumpLocationId: f.dump_location_id,
        dumpLocationName: f.dump_location_name,
        ticketCount: Number(f.ticket_count),
        totalWeight: Number(f.total_weight),
        totalDumpCost: Number(f.total_dump_cost),
        totalFuelEnv: Number(f.total_fuel_env),
        totalCost: Number(f.total_cost),
        totalCustomerCharges: Number(f.total_customer_charges),
      })),
      tickets: tickets.map(t => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        submittedAt: t.submitted_at,
        jobId: t.job_id,
        jobNumber: t.job_number,
        customerName: t.customer_name,
        dumpLocationName: t.dump_location_name,
        wasteType: t.waste_type,
        weightTons: Number(t.weight_tons),
        dumpTonnageCost: Number(t.dump_tonnage_cost),
        fuelEnvCost: Number(t.fuel_env_cost),
        dumpSurchargeCost: Number(t.dump_surcharge_cost),
        totalDumpCost: Number(t.total_cost),
        customerTonnageCharge: Number(t.customer_tonnage_charge),
        customerSurchargeCharge: Number(t.customer_surcharge_charge),
        totalCustomerCharge: Number(t.customer_charges),
        overageItems: t.overage_items || [],
        status: t.status,
        invoiced: t.invoiced,
        invoiceId: t.invoice_id,
      })),
      period: { start, end },
    };
  }

  async getProfit(
    tenantId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ProfitResponseDto> {
    const revenue = await this.getRevenue(tenantId, startDate, endDate);
    const costs = await this.getDumpCosts(tenantId, startDate, endDate);
    const gross = revenue.totalCollected - costs.totalDumpCosts;

    return {
      totalRevenue: revenue.totalCollected,
      totalDumpCosts: costs.totalDumpCosts,
      grossProfit: gross,
      grossMarginPercent: revenue.totalCollected > 0 ? (gross / revenue.totalCollected * 100) : 0,
      period: revenue.period,
    };
  }

  async getDriverProductivity(tenantId: string, startDate?: string, endDate?: string): Promise<DriversResponseDto> {
    const { start, end } = this.dateRange(startDate, endDate);

    const stats = await this.jobRepo.createQueryBuilder('j')
      .leftJoin('j.assigned_driver', 'd')
      .select('j.assigned_driver_id', 'driverId')
      .addSelect("CONCAT(d.first_name, ' ', d.last_name)", 'driverName')
      .addSelect('COUNT(*)', 'totalJobs')
      .addSelect(`SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END)`, 'completedJobs')
      .addSelect(`SUM(CASE WHEN j.is_failed_trip = true THEN 1 ELSE 0 END)`, 'failedJobs')
      .addSelect(`SUM(CASE WHEN j.job_type = 'delivery' THEN 1 ELSE 0 END)`, 'deliveries')
      .addSelect(`SUM(CASE WHEN j.job_type = 'pickup' THEN 1 ELSE 0 END)`, 'pickups')
      .addSelect(`SUM(CASE WHEN j.job_type = 'exchange' THEN 1 ELSE 0 END)`, 'exchanges')
      .addSelect(`SUM(CASE WHEN j.job_type = 'dump_run' THEN 1 ELSE 0 END)`, 'dumpRuns')
      .where('j.tenant_id = :tid', { tid: tenantId })
      .andWhere('j.assigned_driver_id IS NOT NULL')
      .andWhere('j.scheduled_date >= :start', { start })
      .andWhere('j.scheduled_date <= :end', { end })
      .groupBy('j.assigned_driver_id')
      .addGroupBy('d.first_name')
      .addGroupBy('d.last_name')
      .getRawMany();

    return {
      driverStats: stats.map(s => ({
        driverId: s.driverId,
        driverName: s.driverName,
        totalJobs: Number(s.totalJobs),
        completedJobs: Number(s.completedJobs),
        failedJobs: Number(s.failedJobs),
        deliveries: Number(s.deliveries),
        pickups: Number(s.pickups),
        exchanges: Number(s.exchanges),
        dumpRuns: Number(s.dumpRuns),
      })),
      period: { start, end },
    };
  }

  async getAssetUtilization(tenantId: string): Promise<AssetsResponseDto> {
    const total = await this.assetRepo.count({ where: { tenant_id: tenantId } });
    const byStatus = await this.assetRepo.createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenant_id = :tid', { tid: tenantId })
      .groupBy('a.status')
      .getRawMany();

    const bySize = await this.assetRepo.createQueryBuilder('a')
      .select('a.subtype', 'subtype')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`SUM(CASE WHEN a.status = 'available' THEN 1 ELSE 0 END)`, 'available')
      .addSelect(`SUM(CASE WHEN a.status = 'deployed' THEN 1 ELSE 0 END)`, 'deployed')
      .addSelect(`SUM(CASE WHEN a.status = 'full_staged' THEN 1 ELSE 0 END)`, 'staged')
      .where('a.tenant_id = :tid', { tid: tenantId })
      .groupBy('a.subtype')
      .getRawMany();

    return {
      totalAssets: total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, Number(s.count)])),
      bySize: bySize.map(s => ({ subtype: s.subtype, total: Number(s.total), available: Number(s.available), deployed: Number(s.deployed), staged: Number(s.staged) })),
    };
  }

  async getCustomerAnalytics(
    tenantId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<CustomersResponseDto> {
    const { start, end } = this.dateRange(startDate, endDate);
    const endTs = end + 'T23:59:59';

    const total = await this.customerRepo.count({ where: { tenant_id: tenantId, is_active: true } });
    const newInPeriod = await this.customerRepo.createQueryBuilder('c')
      .where('c.tenant_id = :tid', { tid: tenantId })
      .andWhere('c.created_at >= :start', { start })
      .andWhere('c.created_at <= :end', { end: endTs })
      .getCount();

    const byType = await this.customerRepo.createQueryBuilder('c')
      .select('c.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('c.tenant_id = :tid', { tid: tenantId })
      .andWhere('c.is_active = true')
      .groupBy('c.type')
      .getRawMany();

    // Top customers by actual invoiced revenue within the date range,
    // not the denormalized lifetime_revenue column.
    const top = await this.dataSource.query(
      `SELECT c.id as "customerId",
              COALESCE(NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), 'Unknown Customer') as name,
              c.type,
              COUNT(DISTINCT j.id)::int as "totalJobs",
              COALESCE(SUM(i.total), 0) as "totalSpend"
       FROM customers c
       LEFT JOIN jobs j ON j.customer_id = c.id AND j.tenant_id = c.tenant_id
         AND j.scheduled_date >= $2 AND j.scheduled_date <= $3
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.tenant_id = c.tenant_id
         AND ${REVENUE_STATUS_SQL} AND i.created_at >= $2 AND i.created_at <= $4
       WHERE c.tenant_id = $1 AND c.is_active = true
       GROUP BY c.id, c.first_name, c.last_name, c.type
       HAVING COALESCE(SUM(i.total), 0) > 0 OR COUNT(DISTINCT j.id) > 0
       ORDER BY COALESCE(SUM(i.total), 0) DESC
       LIMIT 20`,
      [tenantId, start, end, endTs],
    );

    return {
      totalCustomers: total,
      newCustomersInPeriod: newInPeriod,
      customersByType: Object.fromEntries(byType.map(t => [t.type, Number(t.count)])),
      topCustomers: top.map((c: any) => ({
        customerId: c.customerId,
        name: c.name,
        type: c.type,
        totalJobs: Number(c.totalJobs),
        totalSpend: Number(c.totalSpend),
      })),
      period: { start, end },
    };
  }

  async getAccountsReceivable(
    tenantId: string,
  ): Promise<AccountsReceivableResponseDto> {
    const today = new Date().toISOString().split('T')[0];

    const totals = await this.invoiceRepo.createQueryBuilder('i')
      .select(`SUM(CASE WHEN i.status IN ('open', 'partial') THEN i.balance_due ELSE 0 END)`, 'totalOutstanding')
      .addSelect(`SUM(CASE WHEN i.status IN ('open', 'partial') AND i.due_date < '${today}' THEN i.balance_due ELSE 0 END)`, 'totalOverdue')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .getRawOne();

    // Aging buckets
    const aging = await this.invoiceRepo.createQueryBuilder('i')
      .select(`
        SUM(CASE WHEN i.due_date >= '${today}' THEN i.balance_due ELSE 0 END) as current_amount,
        COUNT(CASE WHEN i.due_date >= '${today}' THEN 1 END) as current_count,
        SUM(CASE WHEN i.due_date < '${today}' AND i.due_date >= '${today}'::date - 30 THEN i.balance_due ELSE 0 END) as days30_amount,
        COUNT(CASE WHEN i.due_date < '${today}' AND i.due_date >= '${today}'::date - 30 THEN 1 END) as days30_count,
        SUM(CASE WHEN i.due_date < '${today}'::date - 30 AND i.due_date >= '${today}'::date - 60 THEN i.balance_due ELSE 0 END) as days60_amount,
        COUNT(CASE WHEN i.due_date < '${today}'::date - 30 AND i.due_date >= '${today}'::date - 60 THEN 1 END) as days60_count,
        SUM(CASE WHEN i.due_date < '${today}'::date - 60 AND i.due_date >= '${today}'::date - 90 THEN i.balance_due ELSE 0 END) as days90_amount,
        COUNT(CASE WHEN i.due_date < '${today}'::date - 60 AND i.due_date >= '${today}'::date - 90 THEN 1 END) as days90_count,
        SUM(CASE WHEN i.due_date < '${today}'::date - 90 THEN i.balance_due ELSE 0 END) as days90plus_amount,
        COUNT(CASE WHEN i.due_date < '${today}'::date - 90 THEN 1 END) as days90plus_count
      `)
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status IN (:...statuses)', { statuses: ['open', 'partial'] })
      .andWhere('i.balance_due > 0')
      .getRawOne();

    const overdueList = await this.invoiceRepo.createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'c')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status IN (:...statuses)', { statuses: ['open', 'partial'] })
      .andWhere('i.due_date < :today', { today })
      .andWhere('i.balance_due > 0')
      .orderBy('i.due_date', 'ASC')
      .take(50)
      .getMany();

    return {
      totalOutstanding: Number(totals?.totalOutstanding) || 0,
      totalOverdue: Number(totals?.totalOverdue) || 0,
      aging: {
        current: { count: Number(aging?.current_count) || 0, amount: Number(aging?.current_amount) || 0 },
        days30: { count: Number(aging?.days30_count) || 0, amount: Number(aging?.days30_amount) || 0 },
        days60: { count: Number(aging?.days60_count) || 0, amount: Number(aging?.days60_amount) || 0 },
        days90: { count: Number(aging?.days90_count) || 0, amount: Number(aging?.days90_amount) || 0 },
        days90plus: { count: Number(aging?.days90plus_count) || 0, amount: Number(aging?.days90plus_amount) || 0 },
      },
      overdueInvoices: overdueList.map(inv => ({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}` : 'Unknown',
        amount: Number(inv.balance_due),
        dueDate: inv.due_date,
        daysPastDue: Math.ceil((Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24)),
      })),
    };
  }

  async getIntegrityCheck(tenantId: string) {
    const checks: Array<{ name: string; description: string; legacy_count: number; post_correction_count: number; severity: string; note: string }> = [];
    const cutoff = CORRECTION_CUTOFF;

    // 1. Balance mismatch: invoices where balance_due != total - amount_paid (within $0.01)
    const balanceMismatch = await this.invoiceRepo.query(
      `SELECT id, created_at FROM invoices WHERE tenant_id = $1 AND voided_at IS NULL
       AND ABS(balance_due - (total - amount_paid)) > 0.01`,
      [tenantId],
    );
    const bmLegacy = balanceMismatch.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const bmPost = balanceMismatch.length - bmLegacy;
    checks.push({ name: 'balance_mismatch', description: 'Invoices where balance_due != total - amount_paid', legacy_count: bmLegacy, post_correction_count: bmPost, severity: bmPost > 0 ? 'critical' : 'info', note: bmPost > 0 ? `${bmPost} post-correction mismatches need investigation` : bmLegacy > 0 ? `${bmLegacy} legacy records` : 'All clean' });

    // 2. Duplicate dump tickets
    const dupes = await this.ticketRepo.query(
      `SELECT job_id, ticket_number, MIN(created_at) as created_at FROM dump_tickets WHERE tenant_id = $1
       GROUP BY job_id, ticket_number HAVING COUNT(*) > 1`,
      [tenantId],
    );
    const dupLegacy = dupes.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const dupPost = dupes.length - dupLegacy;
    checks.push({ name: 'duplicate_dump_tickets', description: 'Dump tickets with same job_id + ticket_number', legacy_count: dupLegacy, post_correction_count: dupPost, severity: dupPost > 0 ? 'critical' : 'info', note: dupPost > 0 ? 'Unique constraint may be missing' : 'Clean' });

    // 3. Paid without payment
    const paidNoPayment = await this.invoiceRepo.query(
      `SELECT i.id, i.created_at FROM invoices i
       WHERE i.tenant_id = $1 AND i.status = 'paid' AND i.voided_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'completed')`,
      [tenantId],
    );
    const pnpLegacy = paidNoPayment.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const pnpPost = paidNoPayment.length - pnpLegacy;
    checks.push({ name: 'paid_without_payment', description: 'Invoices marked paid but no payment record exists', legacy_count: pnpLegacy, post_correction_count: pnpPost, severity: pnpPost > 0 ? 'warning' : 'info', note: pnpPost > 0 ? `${pnpPost} post-correction records` : pnpLegacy > 0 ? `${pnpLegacy} legacy records (pre-correction)` : 'Clean' });

    // 4. Orphaned payments
    const orphanedPayments = await this.invoiceRepo.query(
      `SELECT p.id, p.applied_at as created_at FROM payments p
       WHERE p.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id)`,
      [tenantId],
    );
    const opLegacy = orphanedPayments.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const opPost = orphanedPayments.length - opLegacy;
    checks.push({ name: 'orphaned_payments', description: 'Payments not linked to any invoice', legacy_count: opLegacy, post_correction_count: opPost, severity: opPost > 0 ? 'warning' : 'info', note: opPost > 0 ? `${opPost} post-correction orphans` : 'Clean' });

    // 5. Jobs without invoice
    const jobsNoInvoice = await this.jobRepo.query(
      `SELECT j.id, j.created_at FROM jobs j
       WHERE j.tenant_id = $1 AND j.status != 'cancelled'
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id)`,
      [tenantId],
    );
    const jniLegacy = jobsNoInvoice.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const jniPost = jobsNoInvoice.length - jniLegacy;
    checks.push({ name: 'jobs_without_invoice', description: 'Jobs that have no linked invoice', legacy_count: jniLegacy, post_correction_count: jniPost, severity: jniPost > 0 ? 'warning' : 'info', note: jniPost > 0 ? `${jniPost} post-correction jobs missing invoices` : jniLegacy > 0 ? `${jniLegacy} legacy records` : 'Clean' });

    // 6. Dump tickets without job_cost
    const ticketsNoCost = await this.ticketRepo.query(
      `SELECT t.id, t.created_at FROM dump_tickets t
       WHERE t.tenant_id = $1
       AND NOT EXISTS (SELECT 1 FROM job_costs jc WHERE jc.job_id = t.job_id AND jc.dump_ticket_number = t.ticket_number)`,
      [tenantId],
    );
    const tncLegacy = ticketsNoCost.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const tncPost = ticketsNoCost.length - tncLegacy;
    checks.push({ name: 'dump_tickets_without_job_cost', description: 'Dump tickets with no corresponding job_cost record', legacy_count: tncLegacy, post_correction_count: tncPost, severity: tncPost > 0 ? 'warning' : 'info', note: tncPost > 0 ? `${tncPost} missing job_costs` : tncLegacy > 0 ? `${tncLegacy} legacy records` : 'Clean' });

    // 7. Invoices without chain
    const invoicesNoChain = await this.invoiceRepo.query(
      `SELECT i.id, i.created_at FROM invoices i
       WHERE i.tenant_id = $1 AND i.job_id IS NOT NULL AND i.rental_chain_id IS NULL AND i.voided_at IS NULL`,
      [tenantId],
    );
    const incLegacy = invoicesNoChain.filter((r: any) => new Date(r.created_at) < new Date(cutoff)).length;
    const incPost = invoicesNoChain.length - incLegacy;
    checks.push({ name: 'invoices_without_chain', description: 'Job-linked invoices not linked to a rental chain', legacy_count: incLegacy, post_correction_count: incPost, severity: incPost > 0 ? 'info' : 'info', note: incPost > 0 ? `${incPost} post-correction records` : incLegacy > 0 ? `${incLegacy} legacy records` : 'Clean' });

    // Sort: critical → warning → info, then alphabetical
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    checks.sort((a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 3) - (severityOrder[b.severity as keyof typeof severityOrder] ?? 3) || a.name.localeCompare(b.name));

    return {
      timestamp: new Date().toISOString(),
      correctionCutoff: CORRECTION_CUTOFF,
      checks,
      summary: {
        critical: checks.filter(c => c.severity === 'critical').length,
        warning: checks.filter(c => c.severity === 'warning').length,
        info: checks.filter(c => c.severity === 'info').length,
      },
    };
  }

  async getRevenueBreakdown(tenantId: string, period?: string, classification?: string) {
    const date = period || new Date().toISOString().slice(0, 7); // YYYY-MM
    const startOfMonth = `${date}-01`;
    const endOfMonth = new Date(new Date(startOfMonth).getFullYear(), new Date(startOfMonth).getMonth() + 1, 0).toISOString().split('T')[0];

    let dateFilter = `i.created_at >= '${startOfMonth}' AND i.created_at <= '${endOfMonth}T23:59:59'`;
    if (classification === 'post-correction') {
      dateFilter += ` AND i.created_at >= '${CORRECTION_CUTOFF}'`;
    } else if (classification === 'legacy') {
      dateFilter += ` AND i.created_at < '${CORRECTION_CUTOFF}'`;
    }

    const result = await this.invoiceRepo.query(
      `SELECT
         COALESCE(SUM(li.net_amount), 0) as total,
         COALESCE(SUM(CASE WHEN li.line_type = 'rental' THEN li.net_amount ELSE 0 END), 0) as rental,
         COALESCE(SUM(CASE WHEN li.line_type = 'fee' THEN li.net_amount ELSE 0 END), 0) as distance,
         COALESCE(SUM(CASE WHEN li.line_type = 'overage' THEN li.net_amount ELSE 0 END), 0) as overage,
         COALESCE(SUM(CASE WHEN li.line_type = 'surcharge_item' THEN li.net_amount ELSE 0 END), 0) as surcharges,
         COALESCE(SUM(CASE WHEN li.line_type = 'overage_days' THEN li.net_amount ELSE 0 END), 0) as extra_day_revenue,
         COALESCE(SUM(CASE WHEN i.source = 'failed_trip' THEN li.net_amount ELSE 0 END), 0) as failed_trip_revenue,
         COUNT(DISTINCT i.id) as invoice_count,
         COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid') as paid_count
       FROM invoices i
       LEFT JOIN invoice_line_items li ON li.invoice_id = i.id
       WHERE i.tenant_id = $1 AND ${REVENUE_STATUS_SQL} AND ${dateFilter}`,
      [tenantId],
    );

    const row = result[0] || {};
    const totalRevenue = Number(row.total) || 0;
    const paidCount = Number(row.paid_count) || 0;
    const invoiceCount = Number(row.invoice_count) || 0;

    return {
      classification: classification || 'all',
      cutoffDate: CORRECTION_CUTOFF.split('T')[0],
      period: date,
      totalRevenue,
      breakdown: {
        rental: Number(row.rental) || 0,
        distance: Number(row.distance) || 0,
        overage: Number(row.overage) || 0,
        surcharges: Number(row.surcharges) || 0,
        extraDayRevenue: Number(row.extra_day_revenue) || 0,
        failedTripRevenue: Number(row.failed_trip_revenue) || 0,
      },
      invoiceCount,
      paidCount,
      collectionRate: invoiceCount > 0 ? Math.round((paidCount / invoiceCount) * 1000) / 10 : 0,
    };
  }

  async getAlerts(tenantId: string) {
    const integrity = await this.getIntegrityCheck(tenantId);
    const alerts: Array<{
      id: string; type: string; severity: string; classification: string;
      title: string; message: string; entityType: string; href: string;
      createdAt: string; read: boolean;
    }> = [];

    const now = new Date().toISOString();

    for (const check of integrity.checks) {
      if (check.post_correction_count > 0) {
        alerts.push({
          id: `${check.name}:post:${now.split('T')[0]}`,
          type: check.name,
          severity: check.severity,
          classification: 'post-correction',
          title: this.alertTitle(check.name),
          message: `${check.post_correction_count} post-correction ${check.description.toLowerCase()}`,
          entityType: this.alertEntityType(check.name),
          href: this.alertHref(check.name),
          createdAt: now,
          read: false,
        });
      }
      if (check.legacy_count > 0) {
        alerts.push({
          id: `${check.name}:legacy:${now.split('T')[0]}`,
          type: check.name,
          severity: 'info',
          classification: 'legacy',
          title: `${this.alertTitle(check.name)} (legacy)`,
          message: `${check.legacy_count} legacy records — informational only`,
          entityType: this.alertEntityType(check.name),
          href: this.alertHref(check.name),
          createdAt: now,
          read: false,
        });
      }
    }

    // Add overdue invoices as warning
    const overdue = await this.invoiceRepo.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(balance_due), 0) as total
       FROM invoices WHERE tenant_id = $1 AND status IN ('open', 'partial')
       AND sent_at < NOW() - INTERVAL '30 days' AND voided_at IS NULL
       AND created_at >= $2`,
      [tenantId, CORRECTION_CUTOFF],
    );
    if (Number(overdue[0]?.cnt) > 0) {
      alerts.push({
        id: `overdue_invoice:${now.split('T')[0]}`,
        type: 'overdue_invoice',
        severity: 'warning',
        classification: 'post-correction',
        title: 'Overdue invoices',
        message: `${overdue[0].cnt} invoices overdue totaling $${Number(overdue[0].total).toFixed(2)}`,
        entityType: 'invoice',
        href: '/invoices',
        createdAt: now,
        read: false,
      });
    }

    // Sort: critical → warning → info
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    const unreadCount = alerts.filter(a => a.severity !== 'info').length;

    return {
      generatedAt: now,
      unreadCount,
      alerts,
    };
  }

  private alertTitle(name: string): string {
    const titles: Record<string, string> = {
      balance_mismatch: 'Invoice balance mismatch',
      duplicate_dump_tickets: 'Duplicate dump tickets',
      paid_without_payment: 'Paid without payment record',
      orphaned_payments: 'Orphaned payments',
      jobs_without_invoice: 'Jobs without invoice',
      dump_tickets_without_job_cost: 'Dump tickets without job cost',
      invoices_without_chain: 'Invoices without rental chain',
    };
    return titles[name] || name.replace(/_/g, ' ');
  }

  private alertEntityType(name: string): string {
    if (name.includes('invoice') || name.includes('balance') || name.includes('paid')) return 'invoice';
    if (name.includes('dump') || name.includes('ticket')) return 'dump_ticket';
    if (name.includes('job')) return 'job';
    if (name.includes('payment')) return 'payment';
    return 'system';
  }

  private alertHref(name: string): string {
    if (name.includes('invoice') || name.includes('balance') || name.includes('paid')) return '/invoices';
    if (name.includes('dump') || name.includes('ticket')) return '/analytics';
    if (name.includes('job')) return '/jobs';
    if (name.includes('payment')) return '/invoices';
    return '/analytics';
  }

  async getDailySummary(tenantId: string) {
    const today = new Date().toISOString().split('T')[0];

    const revenue = await this.invoiceRepo.query(
      `SELECT COALESCE(SUM(total), 0) as revenue FROM invoices
       WHERE tenant_id = $1 AND created_at::date = $2 AND ${REVENUE_STATUS_SQL}`,
      [tenantId, today],
    );
    const ar = await this.invoiceRepo.query(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('open','partial') THEN balance_due ELSE 0 END), 0) as open_ar,
              COALESCE(SUM(CASE WHEN status IN ('open','partial') AND sent_at < NOW() - INTERVAL '30 days' THEN balance_due ELSE 0 END), 0) as overdue_ar
       FROM invoices WHERE tenant_id = $1 AND ${REVENUE_STATUS_SQL}`,
      [tenantId],
    );
    const jobs = await this.jobRepo.query(
      `SELECT COUNT(*) FILTER (WHERE created_at::date = $2) as created,
              COUNT(*) FILTER (WHERE status = 'completed' AND completed_at::date = $2) as completed
       FROM jobs WHERE tenant_id = $1`,
      [tenantId, today],
    );
    const integrity = await this.getIntegrityCheck(tenantId);

    return {
      date: today,
      revenue: Number(revenue[0]?.revenue) || 0,
      openAR: Number(ar[0]?.open_ar) || 0,
      overdueAR: Number(ar[0]?.overdue_ar) || 0,
      jobsCreated: Number(jobs[0]?.created) || 0,
      jobsCompleted: Number(jobs[0]?.completed) || 0,
      alerts: integrity.summary,
    };
  }

  async sendCriticalAlertEmail(tenantId: string, alertType: string, message: string, href: string): Promise<boolean> {
    // Dedup: check if same alert already sent in last 24 hours
    const recent = await this.invoiceRepo.query(
      `SELECT COUNT(*) as cnt FROM notifications
       WHERE tenant_id = $1 AND type = 'admin_alert' AND channel = 'email'
       AND body LIKE $2 AND sent_at > NOW() - INTERVAL '24 hours'`,
      [tenantId, `%${alertType}%`],
    );
    if (Number(recent[0]?.cnt) > 0) return false; // Already sent

    // Rate limit: max 5 admin emails per hour
    const hourCount = await this.invoiceRepo.query(
      `SELECT COUNT(*) as cnt FROM notifications
       WHERE tenant_id = $1 AND type = 'admin_alert' AND channel = 'email'
       AND sent_at > NOW() - INTERVAL '1 hour'`,
      [tenantId],
    );
    if (Number(hourCount[0]?.cnt) >= 5) return false; // Rate limited

    // Get admin email from tenant
    const tenant = await this.invoiceRepo.query(
      `SELECT website_email, name FROM tenants WHERE id = $1`, [tenantId],
    );
    const adminEmail = tenant[0]?.website_email;
    if (!adminEmail) return false;

    // Log the notification (for dedup tracking)
    await this.invoiceRepo.query(
      `INSERT INTO notifications (id, tenant_id, channel, type, recipient, subject, body, status, sent_at, created_at)
       VALUES (gen_random_uuid(), $1, 'email', 'admin_alert', $2, $3, $4, 'delivered', NOW(), NOW())`,
      [tenantId, adminEmail, `ServiceOS Alert: ${alertType.replace(/_/g, ' ')}`, `Alert: ${alertType} — ${message}. View: ${href}`],
    );

    return true;
  }

  async getInvoicesCsv(tenantId: string, status?: string, from?: string, to?: string): Promise<string> {
    const qb = this.invoiceRepo.createQueryBuilder('i')
      .leftJoin('i.customer', 'c')
      .select([
        'i.invoice_number', "CONCAT(c.first_name, ' ', c.last_name) as customer_name",
        'i.total', 'i.amount_paid', 'i.balance_due', 'i.status',
        'i.created_at', 'i.sent_at',
      ])
      .where('i.tenant_id = :tid', { tid: tenantId });

    if (status) qb.andWhere('i.status = :status', { status });
    if (from) qb.andWhere('i.created_at >= :from', { from });
    if (to) qb.andWhere('i.created_at <= :to', { to: to + 'T23:59:59' });
    qb.orderBy('i.created_at', 'DESC');

    const rows = await qb.getRawMany();

    const header = 'Invoice Number,Customer,Total,Amount Paid,Balance Due,Status,Created,Sent';
    const csvRows = rows.map(r =>
      [r.i_invoice_number, `"${(r.customer_name || '').replace(/"/g, '""')}"`, r.i_total, r.i_amount_paid, r.i_balance_due, r.i_status, r.i_created_at, r.i_sent_at || ''].join(',')
    );
    return [header, ...csvRows].join('\n');
  }

  async getExceptions(tenantId: string) {
    // Critical: billing inconsistencies (invoice total != sum of line items)
    let inconsistencies: any[] = [];
    try {
      inconsistencies = await this.dataSource.query(`
        SELECT i.id, i.invoice_number, i.total,
          COALESCE(SUM(li.net_amount), 0) as line_total
        FROM invoices i
        LEFT JOIN invoice_line_items li ON li.invoice_id = i.id
        WHERE i.tenant_id = $1 AND i.status != 'voided'
        GROUP BY i.id
        HAVING ABS(i.total - COALESCE(SUM(li.net_amount), 0)) > 0.01
        LIMIT 10
      `, [tenantId]);
    } catch { /* table may not have expected schema yet */ }

    // Action required counts
    const needsReschedule = await this.jobRepo.count({
      where: { tenant_id: tenantId, status: 'needs_reschedule' } as any,
    });
    const overdueInvoices = await this.invoiceRepo.count({
      where: { tenant_id: tenantId, status: 'overdue' } as any,
    });
    const overdueRentals = await this.jobRepo.count({
      where: { tenant_id: tenantId, is_overdue: true } as any,
    });

    return {
      critical: { inconsistencies },
      actionRequired: { needsReschedule, overdueInvoices, overdueRentals },
    };
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 13 — Lifecycle KPI report
  // ─────────────────────────────────────────────────────────

  /**
   * Lifecycle-aware KPI report. All financial math mirrors the
   * single source of truth already used by
   * `RentalChainsService.getFinancials`:
   *   - revenue = SUM(invoices.total) WHERE invoices.rental_chain_id
   *     matches AND voided_at IS NULL
   *   - cost = SUM(job_costs.amount) via task_chain_links join
   *   - profit = revenue - cost (never stored)
   *
   * Date-basis choices (explicit, so future devs don't mix them):
   *   - Chain window filter: `rental_chains.drop_off_date` between
   *     start/end. The window is when the rental STARTED.
   *   - Trend grouping: same `drop_off_date` basis, bucketed by
   *     day / week / month. Gaps are filled with zero rows so the
   *     frontend chart is continuous.
   *   - Completed count: chains whose `drop_off_date` falls in the
   *     window AND `status = 'completed'`.
   *   - Active / overdue: point-in-time on the returned chain set
   *     (ignores the window for existence — so if a chain dropped
   *     off inside the window and is still active today, it counts).
   *   - Average rental duration: completed chains in the window,
   *     `actual_pickup_date - drop_off_date` in days.
   *
   * Revenue date-basis note: existing `/reporting/revenue` uses
   * `invoices.created_at` which is NOT necessarily aligned with the
   * chain's `drop_off_date`. For lifecycle reporting we intentionally
   * window by `drop_off_date` (the rental-level basis) rather than
   * invoice created_at, because a rental is the unit of measurement
   * here. This can diverge from the invoice-windowed revenue report
   * and that's expected — different lenses on the same ledger.
   *
   * Batch strategy (avoids N+1):
   *   1. One query: chains in window + customer + delivery link+job
   *   2. One query: SUM(invoice.total) GROUP BY rental_chain_id
   *   3. One query: SUM(job_costs.amount) GROUP BY rental_chain_id
   *      (joined via task_chain_links)
   *   4. One query: COUNT(*) WHERE task_type='exchange' GROUP BY
   *      rental_chain_id
   *   5. One query: standalone job count (no chain linkage)
   * Everything else is assembled in memory. 50 chains = ~5 queries.
   */
  async getLifecycleReport(
    tenantId: string,
    startDate?: string,
    endDate?: string,
    statusFilter: 'active' | 'completed' | 'all' = 'all',
    groupBy: 'day' | 'week' | 'month' = 'month',
  ) {
    const { start, end } = this.dateRange(startDate, endDate);
    const today = new Date().toISOString().split('T')[0];

    // ── 1. Chains in window with delivery job address ──
    const chainQb = this.chainRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.customer', 'customer')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.drop_off_date >= :start', { start })
      .andWhere('c.drop_off_date <= :end', { end });
    if (statusFilter === 'active') {
      chainQb.andWhere('c.status = :st', { st: 'active' });
    } else if (statusFilter === 'completed') {
      chainQb.andWhere('c.status = :st', { st: 'completed' });
    }
    chainQb.orderBy('c.drop_off_date', 'DESC');
    const chains = await chainQb.getMany();

    const chainIds = chains.map((c) => c.id);

    // Short-circuit if no chains — still return the full shape with
    // empty data so the frontend chart can render the zero-filled
    // trend series.
    if (chainIds.length === 0) {
      const standaloneJobs = await this.countStandaloneJobs(tenantId);
      return {
        summary: {
          total_rental_revenue: 0,
          total_lifecycle_cost: 0,
          total_profit: 0,
          average_rental_duration: 0,
          active_rentals: 0,
          overdue_rentals: 0,
          completed_rentals: 0,
          exchange_rate: 0,
          revenue_per_chain: 0,
          profit_per_chain: 0,
          standalone_jobs: standaloneJobs,
        },
        chains: [],
        trend: this.buildEmptyTrend(start, end, groupBy),
      };
    }

    // ── 2. Revenue per chain (batched) ──
    const revenueRows = await this.invoiceRepo
      .createQueryBuilder('i')
      .select('i.rental_chain_id', 'chain_id')
      .addSelect('COALESCE(SUM(i.total), 0)', 'revenue')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.rental_chain_id IN (:...chainIds)', { chainIds })
      .andWhere('i.voided_at IS NULL')
      .groupBy('i.rental_chain_id')
      .getRawMany<{ chain_id: string; revenue: string }>();
    const revenueByChain = new Map<string, number>();
    for (const r of revenueRows) {
      revenueByChain.set(r.chain_id, Number(r.revenue) || 0);
    }

    // ── 3. Cost per chain (batched via task_chain_links join) ──
    const costRows = await this.dataSource.query<
      Array<{ chain_id: string; cost: string }>
    >(
      `SELECT tcl.rental_chain_id AS chain_id, COALESCE(SUM(jc.amount), 0) AS cost
       FROM job_costs jc
       INNER JOIN task_chain_links tcl ON tcl.job_id = jc.job_id
       WHERE jc.tenant_id = $1
         AND tcl.rental_chain_id = ANY($2::uuid[])
       GROUP BY tcl.rental_chain_id`,
      [tenantId, chainIds],
    );
    const costByChain = new Map<string, number>();
    for (const r of costRows) {
      costByChain.set(r.chain_id, Number(r.cost) || 0);
    }

    // ── 4. Exchange counts per chain (batched) ──
    const exchangeRows = await this.linkRepo
      .createQueryBuilder('l')
      .select('l.rental_chain_id', 'chain_id')
      .addSelect('COUNT(*)', 'count')
      .where('l.rental_chain_id IN (:...chainIds)', { chainIds })
      .andWhere('l.task_type = :ex', { ex: 'exchange' })
      .andWhere('l.status != :cancelled', { cancelled: 'cancelled' })
      .groupBy('l.rental_chain_id')
      .getRawMany<{ chain_id: string; count: string }>();
    const exchangeByChain = new Map<string, number>();
    for (const r of exchangeRows) {
      exchangeByChain.set(r.chain_id, Number(r.count) || 0);
    }

    // ── 5. Delivery addresses per chain via task_chain_links + jobs ──
    const addressRows = await this.dataSource.query<
      Array<{ chain_id: string; address: Record<string, string> | null }>
    >(
      `SELECT tcl.rental_chain_id AS chain_id, j.service_address AS address
       FROM task_chain_links tcl
       INNER JOIN jobs j ON j.id = tcl.job_id
       WHERE tcl.rental_chain_id = ANY($1::uuid[])
         AND tcl.task_type = 'drop_off'
         AND j.tenant_id = $2`,
      [chainIds, tenantId],
    );
    const addressByChain = new Map<string, string>();
    for (const r of addressRows) {
      const a = r.address ?? {};
      const parts = [a.street, a.city, a.state].filter(Boolean);
      addressByChain.set(r.chain_id, parts.join(', ') || '—');
    }

    // ── Assemble chain rows ──
    const chainRows = chains.map((c) => {
      const revenue = revenueByChain.get(c.id) ?? 0;
      const cost = costByChain.get(c.id) ?? 0;
      const exchangeCount = exchangeByChain.get(c.id) ?? 0;
      const duration =
        c.actual_pickup_date && c.drop_off_date
          ? this.daysBetween(c.drop_off_date, c.actual_pickup_date)
          : null;
      return {
        chain_id: c.id,
        customer_name: c.customer
          ? `${c.customer.first_name ?? ''} ${c.customer.last_name ?? ''}`.trim() ||
            '(no name)'
          : '(no customer)',
        address: addressByChain.get(c.id) ?? '—',
        dumpster_size: c.dumpster_size ?? '',
        drop_off_date: c.drop_off_date,
        expected_pickup_date: c.expected_pickup_date,
        actual_pickup_date: c.actual_pickup_date ?? null,
        status: c.status,
        revenue,
        cost,
        profit: Math.round((revenue - cost) * 100) / 100,
        duration_days: duration,
        exchange_count: exchangeCount,
      };
    });

    // ── Summary KPIs ──
    const totalRevenue = chainRows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = chainRows.reduce((s, r) => s + r.cost, 0);
    const totalProfit = Math.round((totalRevenue - totalCost) * 100) / 100;

    const completedChains = chainRows.filter((r) => r.status === 'completed');
    const activeChains = chainRows.filter((r) => r.status === 'active');
    const overdueChains = activeChains.filter(
      (r) => r.expected_pickup_date && r.expected_pickup_date < today,
    );
    const chainsWithExchange = chainRows.filter((r) => r.exchange_count > 0);
    const avgDuration =
      completedChains.length > 0
        ? Math.round(
            (completedChains.reduce(
              (s, r) => s + (r.duration_days ?? 0),
              0,
            ) /
              completedChains.length) *
              10,
          ) / 10
        : 0;

    const revenuePerChain =
      chainRows.length > 0
        ? Math.round((totalRevenue / chainRows.length) * 100) / 100
        : 0;
    const profitPerChain =
      chainRows.length > 0
        ? Math.round((totalProfit / chainRows.length) * 100) / 100
        : 0;
    const exchangeRate =
      chainRows.length > 0
        ? Math.round((chainsWithExchange.length / chainRows.length) * 1000) / 10
        : 0;

    // ── Standalone jobs — cleanup metric, kept separate from KPIs ──
    const standaloneJobs = await this.countStandaloneJobs(tenantId);

    // ── Trend with zero-filled gaps ──
    const trend = this.buildTrend(chainRows, start, end, groupBy);

    return {
      summary: {
        total_rental_revenue: Math.round(totalRevenue * 100) / 100,
        total_lifecycle_cost: Math.round(totalCost * 100) / 100,
        total_profit: totalProfit,
        average_rental_duration: avgDuration,
        active_rentals: activeChains.length,
        overdue_rentals: overdueChains.length,
        completed_rentals: completedChains.length,
        exchange_rate: exchangeRate,
        revenue_per_chain: revenuePerChain,
        profit_per_chain: profitPerChain,
        standalone_jobs: standaloneJobs,
      },
      chains: chainRows,
      trend,
    };
  }

  /** Count jobs in this tenant that are not part of any rental chain. */
  private async countStandaloneJobs(tenantId: string): Promise<number> {
    const row = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*) AS count
       FROM jobs j
       WHERE j.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM task_chain_links tcl
           INNER JOIN rental_chains rc ON rc.id = tcl.rental_chain_id
           WHERE tcl.job_id = j.id AND rc.tenant_id = j.tenant_id
         )`,
      [tenantId],
    );
    return Number(row[0]?.count ?? 0);
  }

  private daysBetween(from: string, to: string): number {
    const a = new Date(`${from}T00:00:00Z`).getTime();
    const b = new Date(`${to}T00:00:00Z`).getTime();
    return Math.round((b - a) / 86400000);
  }

  /** Bucket label for a YYYY-MM-DD date at the given granularity. */
  private periodKey(
    date: string,
    groupBy: 'day' | 'week' | 'month',
  ): string {
    if (groupBy === 'day') return date;
    const d = new Date(`${date}T00:00:00Z`);
    if (groupBy === 'month') {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    // week: ISO week number
    const tmp = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /**
   * Walk every bucket between start and end at the given granularity
   * and return an ordered list of period keys. Used for zero-filling
   * the trend series so the chart has no gaps.
   */
  private buildPeriodSequence(
    start: string,
    end: string,
    groupBy: 'day' | 'week' | 'month',
  ): string[] {
    const seq: string[] = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    const seen = new Set<string>();
    while (cursor.getTime() <= endDate.getTime()) {
      const key = this.periodKey(
        cursor.toISOString().split('T')[0],
        groupBy,
      );
      if (!seen.has(key)) {
        seen.add(key);
        seq.push(key);
      }
      if (groupBy === 'day') {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      } else if (groupBy === 'week') {
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      } else {
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
    return seq;
  }

  private buildEmptyTrend(
    start: string,
    end: string,
    groupBy: 'day' | 'week' | 'month',
  ) {
    return this.buildPeriodSequence(start, end, groupBy).map((period) => ({
      period,
      revenue: 0,
      cost: 0,
      profit: 0,
      completed_chains: 0,
    }));
  }

  private buildTrend(
    chainRows: Array<{
      drop_off_date: string;
      status: string;
      revenue: number;
      cost: number;
      profit: number;
    }>,
    start: string,
    end: string,
    groupBy: 'day' | 'week' | 'month',
  ) {
    const seq = this.buildPeriodSequence(start, end, groupBy);
    const byPeriod = new Map<
      string,
      { revenue: number; cost: number; profit: number; completed_chains: number }
    >();
    for (const key of seq) {
      byPeriod.set(key, { revenue: 0, cost: 0, profit: 0, completed_chains: 0 });
    }
    for (const r of chainRows) {
      if (!r.drop_off_date) continue;
      const key = this.periodKey(r.drop_off_date, groupBy);
      const bucket = byPeriod.get(key);
      if (!bucket) continue; // chain outside the requested window (shouldn't happen)
      bucket.revenue += r.revenue;
      bucket.cost += r.cost;
      bucket.profit += r.profit;
      if (r.status === 'completed') bucket.completed_chains += 1;
    }
    return seq.map((period) => ({
      period,
      revenue: Math.round((byPeriod.get(period)?.revenue ?? 0) * 100) / 100,
      cost: Math.round((byPeriod.get(period)?.cost ?? 0) * 100) / 100,
      profit: Math.round((byPeriod.get(period)?.profit ?? 0) * 100) / 100,
      completed_chains: byPeriod.get(period)?.completed_chains ?? 0,
    }));
  }
}
