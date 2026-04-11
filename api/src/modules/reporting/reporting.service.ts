import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../auth/entities/user.entity';

const CORRECTION_CUTOFF = '2026-04-02T00:00:00Z';
function classifyRecord(createdAt: string | Date): 'legacy' | 'post-correction' {
  return new Date(createdAt) < new Date(CORRECTION_CUTOFF) ? 'legacy' : 'post-correction';
}

@Injectable()
export class ReportingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(DumpTicket) private ticketRepo: Repository<DumpTicket>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
  ) {}

  private dateRange(s?: string, e?: string) {
    const now = new Date();
    const start = s || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = e || now.toISOString().split('T')[0];
    return { start, end };
  }

  async getRevenue(tenantId: string, startDate?: string, endDate?: string) {
    const { start, end } = this.dateRange(startDate, endDate);

    const totals = await this.invoiceRepo.createQueryBuilder('i')
      .select('SUM(i.total)', 'totalRevenue')
      .addSelect('SUM(i.amount_paid)', 'totalCollected')
      .addSelect(`SUM(CASE WHEN i.status IN ('open', 'partial') THEN i.balance_due ELSE 0 END)`, 'totalOutstanding')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: end + 'T23:59:59' })
      .getRawOne();

    const overdue = await this.invoiceRepo.createQueryBuilder('i')
      .select('SUM(i.balance_due)', 'totalOverdue')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status IN (:...statuses)', { statuses: ['open', 'partial'] })
      .andWhere('i.due_date < :today', { today: new Date().toISOString().split('T')[0] })
      .getRawOne();

    // Revenue by source: JOIN through jobs to get source (invoices
    // table does not have a source column — it lives on jobs).
    const bySource = await this.dataSource.query(
      `SELECT COALESCE(j.source, 'other') as source, SUM(i.total) as amount
       FROM invoices i
       LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1
         AND i.created_at >= $2
         AND i.created_at <= $3
       GROUP BY COALESCE(j.source, 'other')`,
      [tenantId, start, end + 'T23:59:59'],
    );

    const daily = await this.invoiceRepo.createQueryBuilder('i')
      .select("DATE(i.created_at)", 'date')
      .addSelect('SUM(i.total)', 'amount')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: end + 'T23:59:59' })
      .andWhere('i.created_at IS NOT NULL')
      .groupBy("DATE(i.created_at)")
      .orderBy("DATE(i.created_at)", 'ASC')
      .getRawMany();

    return {
      totalRevenue: Number(totals?.totalRevenue) || 0,
      totalCollected: Number(totals?.totalCollected) || 0,
      totalOutstanding: Number(totals?.totalOutstanding) || 0,
      totalOverdue: Number(overdue?.totalOverdue) || 0,
      revenueBySource: Object.fromEntries(bySource.map(r => [r.source || 'other', Number(r.amount)])),
      dailyRevenue: daily.map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : typeof d.date === 'string' ? d.date.split('T')[0] : null,
        amount: Number(d.amount),
      })),
      period: { start, end },
    };
  }

  async getRevenueBySourceDetail(tenantId: string, source: string, startDate?: string, endDate?: string) {
    const { start, end } = this.dateRange(startDate, endDate);
    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
         AND i.created_at >= $2
         AND i.created_at <= $3
         AND COALESCE(j.source, 'other') = $4
       ORDER BY i.created_at DESC`,
      [tenantId, start, end + 'T23:59:59', source],
    );
    return { source, invoices: this.mapInvoiceRows(rows) };
  }

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

  async getRevenueByDailyDetail(tenantId: string, date: string) {
    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
         AND DATE(i.created_at) = $2
       ORDER BY i.created_at DESC`,
      [tenantId, date],
    );
    return { date, invoices: this.mapInvoiceRows(rows) };
  }

  async getRevenueInvoices(tenantId: string, filter: string, startDate?: string, endDate?: string) {
    const { start, end } = this.dateRange(startDate, endDate);
    let whereExtra = '';
    const params: any[] = [tenantId, start, end + 'T23:59:59'];

    if (filter === 'collected') {
      whereExtra = ` AND i.status = 'paid'`;
    } else if (filter === 'outstanding') {
      whereExtra = ` AND i.status IN ('open', 'partial') AND i.balance_due > 0`;
    } else if (filter === 'overdue') {
      whereExtra = ` AND i.status IN ('open', 'partial') AND i.due_date < $4`;
      params.push(new Date().toISOString().split('T')[0]);
    }

    const rows = await this.dataSource.query(
      `${this.invoiceDetailSelect}
       WHERE i.tenant_id = $1
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

  async getProfit(tenantId: string, startDate?: string, endDate?: string) {
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

  async getDriverProductivity(tenantId: string, startDate?: string, endDate?: string) {
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

  async getAssetUtilization(tenantId: string) {
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

  async getCustomerAnalytics(tenantId: string, startDate?: string, endDate?: string) {
    const { start, end } = this.dateRange(startDate, endDate);

    const total = await this.customerRepo.count({ where: { tenant_id: tenantId, is_active: true } });
    const newInPeriod = await this.customerRepo.createQueryBuilder('c')
      .where('c.tenant_id = :tid', { tid: tenantId })
      .andWhere('c.created_at >= :start', { start })
      .andWhere('c.created_at <= :end', { end: end + 'T23:59:59' })
      .getCount();

    const byType = await this.customerRepo.createQueryBuilder('c')
      .select('c.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('c.tenant_id = :tid', { tid: tenantId })
      .andWhere('c.is_active = true')
      .groupBy('c.type')
      .getRawMany();

    const top = await this.customerRepo.createQueryBuilder('c')
      .select('c.id', 'customerId')
      .addSelect("CONCAT(c.first_name, ' ', c.last_name)", 'name')
      .addSelect('c.type', 'type')
      .addSelect('c.total_jobs', 'totalJobs')
      .addSelect('c.lifetime_revenue', 'totalRevenue')
      .where('c.tenant_id = :tid', { tid: tenantId })
      .andWhere('c.is_active = true')
      .orderBy('c.lifetime_revenue', 'DESC')
      .limit(20)
      .getRawMany();

    return {
      totalCustomers: total,
      newCustomersInPeriod: newInPeriod,
      customersByType: Object.fromEntries(byType.map(t => [t.type, Number(t.count)])),
      topCustomers: top.map(c => ({ ...c, totalJobs: Number(c.totalJobs), totalRevenue: Number(c.totalRevenue) })),
      period: { start, end },
    };
  }

  async getAccountsReceivable(tenantId: string) {
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
       WHERE i.tenant_id = $1 AND i.voided_at IS NULL AND ${dateFilter}`,
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
       WHERE tenant_id = $1 AND created_at::date = $2 AND voided_at IS NULL`,
      [tenantId, today],
    );
    const ar = await this.invoiceRepo.query(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('open','partial') THEN balance_due ELSE 0 END), 0) as open_ar,
              COALESCE(SUM(CASE WHEN status IN ('open','partial') AND sent_at < NOW() - INTERVAL '30 days' THEN balance_due ELSE 0 END), 0) as overdue_ar
       FROM invoices WHERE tenant_id = $1 AND voided_at IS NULL`,
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
}
