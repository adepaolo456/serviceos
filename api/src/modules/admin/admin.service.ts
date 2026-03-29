import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Tenant) private tenantsRepo: Repository<Tenant>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Asset) private assetsRepo: Repository<Asset>,
  ) {}

  async getDashboard() {
    const [
      totalTenants,
      totalUsers,
      totalJobs,
      totalCustomers,
      totalAssets,
    ] = await Promise.all([
      this.tenantsRepo.count(),
      this.usersRepo.count(),
      this.jobsRepo.count(),
      this.customersRepo.count(),
      this.assetsRepo.count(),
    ]);

    // Subscription breakdown
    const tierCounts = await this.tenantsRepo
      .createQueryBuilder('t')
      .select('t.subscription_tier', 'tier')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.subscription_tier')
      .getRawMany();

    const activeSubs = await this.tenantsRepo.count({
      where: { subscription_status: 'active' },
    });

    // New signups this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const newSignups = await this.tenantsRepo
      .createQueryBuilder('t')
      .where('t.created_at >= :weekAgo', { weekAgo })
      .getCount();

    // MRR calculation
    const tierPrices: Record<string, number> = {
      starter: 99,
      professional: 249,
      business: 499,
    };
    let mrr = 0;
    for (const tc of tierCounts) {
      if (tc.tier && tierPrices[tc.tier]) {
        mrr += tierPrices[tc.tier] * Number(tc.count);
      }
    }

    return {
      totalTenants,
      totalUsers,
      totalJobs,
      totalCustomers,
      totalAssets,
      activeSubs,
      newSignupsThisWeek: newSignups,
      mrr,
      tierBreakdown: tierCounts.map((tc) => ({
        tier: tc.tier || 'trial',
        count: Number(tc.count),
      })),
    };
  }

  async listTenants(query: {
    search?: string;
    tier?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const qb = this.tenantsRepo
      .createQueryBuilder('t')
      .orderBy('t.created_at', 'DESC');

    if (query.search) {
      qb.andWhere('(t.name ILIKE :s OR t.slug ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    if (query.tier) {
      qb.andWhere('t.subscription_tier = :tier', { tier: query.tier });
    }

    const [tenants, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Get user counts and owner emails per tenant
    const tenantIds = tenants.map((t) => t.id);
    let userCounts: Record<string, number> = {};
    let ownerEmails: Record<string, string> = {};

    if (tenantIds.length > 0) {
      const counts = await this.usersRepo
        .createQueryBuilder('u')
        .select('u.tenant_id', 'tenantId')
        .addSelect('COUNT(*)', 'count')
        .where('u.tenant_id IN (:...ids)', { ids: tenantIds })
        .groupBy('u.tenant_id')
        .getRawMany();
      userCounts = Object.fromEntries(
        counts.map((c) => [c.tenantId, Number(c.count)]),
      );

      const owners = await this.usersRepo
        .createQueryBuilder('u')
        .select(['u.tenant_id', 'u.email'])
        .where('u.tenant_id IN (:...ids)', { ids: tenantIds })
        .andWhere('u.role = :role', { role: 'owner' })
        .getRawMany();
      ownerEmails = Object.fromEntries(
        owners.map((o) => [o.u_tenant_id, o.u_email]),
      );
    }

    // Get job counts per tenant
    let jobCounts: Record<string, number> = {};
    if (tenantIds.length > 0) {
      const jc = await this.jobsRepo
        .createQueryBuilder('j')
        .select('j.tenant_id', 'tenantId')
        .addSelect('COUNT(*)', 'count')
        .where('j.tenant_id IN (:...ids)', { ids: tenantIds })
        .groupBy('j.tenant_id')
        .getRawMany();
      jobCounts = Object.fromEntries(
        jc.map((c) => [c.tenantId, Number(c.count)]),
      );
    }

    return {
      data: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        businessType: t.business_type,
        subscriptionTier: t.subscription_tier || 'trial',
        subscriptionStatus: t.subscription_status || 'trialing',
        isActive: t.is_active,
        ownerEmail: ownerEmails[t.id] || '—',
        userCount: userCounts[t.id] || 0,
        jobCount: jobCounts[t.id] || 0,
        createdAt: t.created_at,
      })),
      meta: { total, page, limit },
    };
  }

  async getTenantDetail(tenantId: string) {
    const tenant = await this.tenantsRepo.findOne({
      where: { id: tenantId },
    });
    if (!tenant) return null;

    const [users, jobCount, customerCount, assetCount] = await Promise.all([
      this.usersRepo.find({
        where: { tenant_id: tenantId },
        order: { created_at: 'DESC' },
      }),
      this.jobsRepo.count({ where: { tenant_id: tenantId } }),
      this.customersRepo.count({ where: { tenant_id: tenantId } }),
      this.assetsRepo.count({ where: { tenant_id: tenantId } }),
    ]);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.business_type,
      subscriptionTier: tenant.subscription_tier || 'trial',
      subscriptionStatus: tenant.subscription_status || 'trialing',
      stripeCustomerId: tenant.stripe_customer_id,
      isActive: tenant.is_active,
      createdAt: tenant.created_at,
      trialEndsAt: tenant.trial_ends_at,
      jobCount,
      customerCount,
      assetCount,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
        isActive: u.is_active,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
      })),
    };
  }

  async updateTenant(
    tenantId: string,
    data: { subscriptionTier?: string; subscriptionStatus?: string; isActive?: boolean },
  ) {
    const update: Partial<Tenant> = {};
    if (data.subscriptionTier !== undefined)
      update.subscription_tier = data.subscriptionTier;
    if (data.subscriptionStatus !== undefined)
      update.subscription_status = data.subscriptionStatus;
    if (data.isActive !== undefined) update.is_active = data.isActive;

    await this.tenantsRepo.update(tenantId, update);
    return this.getTenantDetail(tenantId);
  }

  async getSubscriptions() {
    const tierPrices: Record<string, number> = {
      starter: 99,
      professional: 249,
      business: 499,
    };

    const activeTenants = await this.tenantsRepo.find({
      where: { subscription_status: 'active' },
      order: { created_at: 'DESC' },
    });

    // Get owner emails
    const ids = activeTenants.map((t) => t.id);
    let ownerEmails: Record<string, string> = {};
    if (ids.length > 0) {
      const owners = await this.usersRepo
        .createQueryBuilder('u')
        .select(['u.tenant_id', 'u.email'])
        .where('u.tenant_id IN (:...ids)', { ids })
        .andWhere('u.role = :role', { role: 'owner' })
        .getRawMany();
      ownerEmails = Object.fromEntries(
        owners.map((o) => [o.u_tenant_id, o.u_email]),
      );
    }

    const tierBreakdown = Object.entries(tierPrices).map(([tier, price]) => {
      const count = activeTenants.filter(
        (t) => t.subscription_tier === tier,
      ).length;
      return { tier, count, mrr: count * price };
    });

    const totalMrr = tierBreakdown.reduce((s, t) => s + t.mrr, 0);

    return {
      totalMrr,
      totalActive: activeTenants.length,
      tierBreakdown,
      subscribers: activeTenants.map((t) => ({
        id: t.id,
        name: t.name,
        tier: t.subscription_tier,
        status: t.subscription_status,
        ownerEmail: ownerEmails[t.id] || '—',
        mrr: tierPrices[t.subscription_tier || ''] || 0,
        createdAt: t.created_at,
      })),
    };
  }
}
