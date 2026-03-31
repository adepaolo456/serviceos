import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Job } from '../jobs/entities/job.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class ReportingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(DumpTicket) private ticketRepo: Repository<DumpTicket>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(User) private userRepo: Repository<User>,
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
      .addSelect(`SUM(CASE WHEN i.status = 'sent' THEN i.balance_due ELSE 0 END)`, 'totalOutstanding')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: end + 'T23:59:59' })
      .getRawOne();

    const overdue = await this.invoiceRepo.createQueryBuilder('i')
      .select('SUM(i.balance_due)', 'totalOverdue')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status = :status', { status: 'sent' })
      .andWhere('i.due_date < :today', { today: new Date().toISOString().split('T')[0] })
      .getRawOne();

    const bySource = await this.invoiceRepo.createQueryBuilder('i')
      .select('i.source', 'source')
      .addSelect('SUM(i.total)', 'amount')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: end + 'T23:59:59' })
      .groupBy('i.source')
      .getRawMany();

    const daily = await this.invoiceRepo.createQueryBuilder('i')
      .select("DATE(i.created_at)", 'date')
      .addSelect('SUM(i.amount_paid)', 'amount')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.created_at >= :start', { start })
      .andWhere('i.created_at <= :end', { end: end + 'T23:59:59' })
      .groupBy("DATE(i.created_at)")
      .orderBy("DATE(i.created_at)", 'ASC')
      .getRawMany();

    return {
      totalRevenue: Number(totals?.totalRevenue) || 0,
      totalCollected: Number(totals?.totalCollected) || 0,
      totalOutstanding: Number(totals?.totalOutstanding) || 0,
      totalOverdue: Number(overdue?.totalOverdue) || 0,
      revenueBySource: Object.fromEntries(bySource.map(r => [r.source || 'other', Number(r.amount)])),
      dailyRevenue: daily.map(d => ({ date: d.date, amount: Number(d.amount) })),
      period: { start, end },
    };
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
      .select(`SUM(CASE WHEN i.status = 'sent' THEN i.balance_due ELSE 0 END)`, 'totalOutstanding')
      .addSelect(`SUM(CASE WHEN i.status = 'sent' AND i.due_date < '${today}' THEN i.balance_due ELSE 0 END)`, 'totalOverdue')
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
      .andWhere('i.status = :status', { status: 'sent' })
      .andWhere('i.balance_due > 0')
      .getRawOne();

    const overdueList = await this.invoiceRepo.createQueryBuilder('i')
      .leftJoinAndSelect('i.customer', 'c')
      .where('i.tenant_id = :tid', { tid: tenantId })
      .andWhere('i.status = :status', { status: 'sent' })
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
}
