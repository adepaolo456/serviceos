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
