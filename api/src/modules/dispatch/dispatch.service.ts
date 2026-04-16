import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Route } from './entities/route.entity';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../auth/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { JobsService } from '../jobs/jobs.service';
import { CreateRouteDto, ReorderDto } from './dto/dispatch.dto';
import { getCreditPolicy } from '../tenants/credit-policy';

/**
 * Phase 2 (Dispatch Prepayment UX) — set of payment-terms values
 * that count as "prepay" for the per-job dispatch gate. Mirrors the
 * decision in `DispatchCreditEnforcementService.enforceJobPrepayment`
 * so the board badge and the action-time gate stay in lockstep.
 */
const PREPAY_TERMS = new Set(['due_on_receipt', 'cod']);
const PAID_INVOICE_STATUSES = ['paid', 'partial'];
const APP_DEFAULT_TENANT_TERMS = 'due_on_receipt';

@Injectable()
export class DispatchService {
  constructor(
    @InjectRepository(Route)
    private routesRepository: Repository<Route>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    // Phase 2 — Tenant + Invoice repos used by the additive
    // `computePaymentRequiredMap` helper below to pre-compute the
    // dispatch board's "Payment Required" badge per job.
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    private jobsService: JobsService,
  ) {}

  async getDispatchBoard(tenantId: string, date: string) {
    const drivers = await this.usersRepository.find({
      where: {
        tenant_id: tenantId,
        role: In(['driver', 'admin', 'owner']),
        is_active: true,
      },
    });

    // Phase B8 — payment gating removed from the dispatch board. Jobs are
    // no longer hidden based on linked-invoice status. Dispatch decisions
    // live in `dispatch-credit-enforcement.service.ts` (action-time gate
    // at assign / en_route / arrived / completed). Visibility is purely
    // tenant + scheduled_date + ordering.
    const jobs = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.scheduled_date = :date', { date })
      .orderBy('j.route_order', 'ASC', 'NULLS LAST')
      .addOrderBy('j.scheduled_window_start', 'ASC', 'NULLS LAST')
      .getMany();

    // Phase 2 (Dispatch Prepayment UX) — pre-compute per-job badge
    // status so the dispatch board can surface "Payment Required"
    // BEFORE the operator drags. Additive: does NOT affect visibility.
    const paymentMap = await this.computePaymentRequiredMap(tenantId, jobs);
    const annotatedJobs = jobs.map((j) => {
      const pm = paymentMap.get(j.id);
      return Object.assign({}, j, {
        payment_required: pm?.payment_required ?? false,
        linked_invoice_id: pm?.linked_invoice_id ?? null,
      });
    });

    const route = await this.routesRepository.find({
      where: { tenant_id: tenantId, route_date: date },
    });

    const routesByDriver = new Map(route.map((r) => [r.driver_id, r]));

    const board = drivers.map((driver) => {
      const driverJobs = annotatedJobs.filter(
        (j) => j.assigned_driver_id === driver.id,
      );
      return {
        driver: {
          id: driver.id,
          firstName: driver.first_name,
          lastName: driver.last_name,
          phone: driver.phone,
        },
        route: routesByDriver.get(driver.id) ?? null,
        jobs: driverJobs,
        jobCount: driverJobs.length,
      };
    });

    const unassignedJobs = annotatedJobs.filter((j) => !j.assigned_driver_id);

    return { date, drivers: board, unassigned: unassignedJobs };
  }

  /**
   * Phase 2 (Dispatch Prepayment UX) — additive board annotation.
   *
   * For each job in the board, decide whether the dispatch
   * prepayment gate would block an assign attempt. Mirrors the
   * decision in `DispatchCreditEnforcementService.enforceJobPrepayment`
   * but read-only and batched across the whole board so we don't
   * issue N queries per render.
   *
   * Conditions for `payment_required = true`:
   *   1. Job has a customer AND a positive total_price
   *   2. Effective payment terms (customer override → tenant default
   *      → app default) is in `PREPAY_TERMS`
   *   3. No linked invoice exists in `('paid', 'partial')` (direct
   *      via `invoices.job_id` OR chain via
   *      `invoices.rental_chain_id` matching the job's chain link)
   *
   * `linked_invoice_id` returns the most relevant unpaid invoice id
   * for the "View Invoice" navigation in the blocking modal — null
   * when no invoice exists at all (operator should open Customer
   * Billing instead).
   *
   * Tenant-scoped: tenant lookup + invoice query both filter by
   * `tenantId`. The `task_chain_links` join is bounded by the
   * tenant-scoped invoice rows, not by a global table read.
   */
  private async computePaymentRequiredMap(
    tenantId: string,
    jobs: Job[],
  ): Promise<
    Map<string, { payment_required: boolean; linked_invoice_id: string | null }>
  > {
    const result = new Map<
      string,
      { payment_required: boolean; linked_invoice_id: string | null }
    >();
    if (jobs.length === 0) return result;

    // Resolve effective tenant default terms once (precedence:
    // tenant.settings.credit_policy.default_payment_terms → app default).
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    const policy = tenant ? getCreditPolicy(tenant) : {};
    const tenantDefaultTerms =
      policy.default_payment_terms ?? APP_DEFAULT_TENANT_TERMS;

    // Filter to candidate jobs: positive price, has a customer, and
    // effective payment terms in the prepay set. Non-candidates get
    // `payment_required: false` by absence from the result map.
    const candidateIds: string[] = [];
    for (const j of jobs) {
      const price = Number(j.total_price) || 0;
      if (price <= 0) continue;
      if (!j.customer_id) continue;
      const customerTerms = (j.customer?.payment_terms as string | null) || null;
      const effectiveTerms = customerTerms || tenantDefaultTerms;
      if (PREPAY_TERMS.has(effectiveTerms)) candidateIds.push(j.id);
    }
    if (candidateIds.length === 0) return result;

    // Single batched query: pull every linked invoice (paid or unpaid,
    // direct or chain) for all candidate jobs in one round trip.
    const rows = await this.invoicesRepository
      .createQueryBuilder('inv')
      .leftJoin(
        'task_chain_links',
        'tcl',
        'tcl.rental_chain_id = inv.rental_chain_id',
      )
      .select('inv.id', 'invoice_id')
      .addSelect('inv.status', 'invoice_status')
      .addSelect('inv.job_id', 'direct_job_id')
      .addSelect('tcl.job_id', 'chain_job_id')
      .where('inv.tenant_id = :tenantId', { tenantId })
      .andWhere(
        '(inv.job_id IN (:...ids) OR tcl.job_id IN (:...ids))',
        { ids: candidateIds },
      )
      .getRawMany<{
        invoice_id: string;
        invoice_status: string;
        direct_job_id: string | null;
        chain_job_id: string | null;
      }>();

    // Chain-leak fix: invoices with a direct `job_id` are the canonical
    // payment source for that specific job. Do not cross-link them to
    // other jobs on the same rental_chain_id. Prior behavior treated any
    // paid invoice on the chain as satisfying prepay for every job on
    // the chain, which allowed exchange jobs to dispatch without payment
    // whenever the original delivery invoice was paid. Chain-only
    // invoices (invoice.job_id IS NULL) still fall back to chain
    // matching for legacy compatibility.
    const candidateSet = new Set(candidateIds);
    const invoicesByJob = new Map<
      string,
      Array<{ id: string; status: string }>
    >();
    for (const r of rows) {
      // Direct match: invoice.job_id = candidate_job_id. Job-direct
      // invoices are the canonical payment source for that job; never
      // let them satisfy prepay for sibling jobs on the same chain.
      if (r.direct_job_id && candidateSet.has(r.direct_job_id)) {
        if (!invoicesByJob.has(r.direct_job_id)) {
          invoicesByJob.set(r.direct_job_id, []);
        }
        invoicesByJob.get(r.direct_job_id)!.push({
          id: r.invoice_id,
          status: r.invoice_status,
        });
        continue;
      }

      // Chain fallback: legacy support for rental-chain-scoped
      // invoices that predate the per-job invoicing model. Only fires
      // when the invoice has no direct job_id (chain-only).
      if (
        !r.direct_job_id &&
        r.chain_job_id &&
        candidateSet.has(r.chain_job_id)
      ) {
        if (!invoicesByJob.has(r.chain_job_id)) {
          invoicesByJob.set(r.chain_job_id, []);
        }
        invoicesByJob.get(r.chain_job_id)!.push({
          id: r.invoice_id,
          status: r.invoice_status,
        });
      }
    }

    for (const jobId of candidateIds) {
      const invs = invoicesByJob.get(jobId) ?? [];
      const hasPaid = invs.some((i) => PAID_INVOICE_STATUSES.includes(i.status));
      if (hasPaid) {
        // Customer is prepay but the gate is satisfied. No badge.
        continue;
      }
      // No paid invoice → block. Surface the most relevant unpaid
      // invoice id for the modal's "View Invoice" link. Skip voided.
      const primary =
        invs.find((i) => i.status !== 'voided' && i.status !== 'void') ?? null;
      result.set(jobId, {
        payment_required: true,
        linked_invoice_id: primary?.id ?? null,
      });
    }

    return result;
  }

  async createRoute(tenantId: string, dto: CreateRouteDto): Promise<Route> {
    const jobCount = await this.jobsRepository.count({
      where: {
        tenant_id: tenantId,
        assigned_driver_id: dto.driverId,
        scheduled_date: dto.routeDate,
      },
    });

    const route = this.routesRepository.create({
      tenant_id: tenantId,
      driver_id: dto.driverId,
      route_date: dto.routeDate,
      status: dto.status ?? 'planned',
      start_location: dto.startLocation,
      total_stops: jobCount,
      total_distance_miles: dto.totalDistanceMiles,
      estimated_duration_min: dto.estimatedDurationMin,
    });
    return this.routesRepository.save(route);
  }

  async findOneRoute(tenantId: string, id: string) {
    const route = await this.routesRepository.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['driver'],
    });
    if (!route) {
      throw new NotFoundException(`Route ${id} not found`);
    }

    const jobs = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id = :driverId', {
        driverId: route.driver_id,
      })
      .andWhere('j.scheduled_date = :date', { date: route.route_date })
      .orderBy('j.route_order', 'ASC', 'NULLS LAST')
      .addOrderBy('j.scheduled_window_start', 'ASC', 'NULLS LAST')
      .getMany();

    return { ...route, jobs };
  }

  async reorderRoute(tenantId: string, id: string, dto: ReorderDto) {
    const route = await this.routesRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!route) {
      throw new NotFoundException(`Route ${id} not found`);
    }

    const updates = dto.jobIds.map((jobId, index) =>
      this.jobsRepository.update(
        { id: jobId, tenant_id: tenantId },
        { route_order: index + 1 },
      ),
    );
    await Promise.all(updates);

    route.total_stops = dto.jobIds.length;
    await this.routesRepository.save(route);

    return this.findOneRoute(tenantId, id);
  }

  async getUnassigned(tenantId: string) {
    // Phase B8 — payment gating removed (see `getDispatchBoard` note above).
    // Unassigned list mirrors that policy: every pending/confirmed job the
    // dispatcher can see on the board is a candidate for assignment.
    return this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id IS NULL')
      .andWhere('j.status IN (:...statuses)', { statuses: ['pending', 'confirmed'] })
      .orderBy('j.scheduled_date', 'ASC')
      .addOrderBy('j.created_at', 'DESC')
      .getMany();
  }

  async optimizeRoute(tenantId: string, driverId: string, date: string) {
    const jobs = await this.jobsRepository
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id = :driverId', { driverId })
      .andWhere('j.scheduled_date = :date', { date })
      .andWhere('j.status NOT IN (:...excluded)', { excluded: ['completed', 'cancelled'] })
      .getMany();

    if (jobs.length <= 1) return { jobs, message: 'Nothing to optimize' };

    // Nearest-neighbor ordering using service_address lat/lng
    const hasCoords = jobs.every(j => j.service_address?.lat && j.service_address?.lng);
    let ordered: Job[];

    if (hasCoords) {
      const remaining = [...jobs];
      ordered = [remaining.shift()!];
      while (remaining.length > 0) {
        const last = ordered[ordered.length - 1];
        const lastLat = Number(last.service_address?.lat);
        const lastLng = Number(last.service_address?.lng);
        let closest = 0;
        let closestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const lat = Number(remaining[i].service_address?.lat);
          const lng = Number(remaining[i].service_address?.lng);
          const dist = (lat - lastLat) ** 2 + (lng - lastLng) ** 2;
          if (dist < closestDist) { closestDist = dist; closest = i; }
        }
        ordered.push(remaining.splice(closest, 1)[0]);
      }
    } else {
      // Fallback: sort by scheduled window start
      ordered = [...jobs].sort((a, b) =>
        (a.scheduled_window_start || '').localeCompare(b.scheduled_window_start || ''),
      );
    }

    // Update route_order
    await Promise.all(
      ordered.map((job, i) =>
        this.jobsRepository.update({ id: job.id, tenant_id: tenantId }, { route_order: i + 1 }),
      ),
    );

    // Update route total_stops if route exists
    const route = await this.routesRepository.findOne({
      where: { tenant_id: tenantId, driver_id: driverId, route_date: date },
    });
    if (route) {
      route.total_stops = ordered.length;
      await this.routesRepository.save(route);
    }

    return { jobs: ordered.map((j, i) => ({ ...j, route_order: i + 1 })), optimized: hasCoords };
  }

  async sendRoutes(tenantId: string, driverIds: string[], date: string) {
    let jobsDispatched = 0;

    for (const driverId of driverIds) {
      const jobs = await this.jobsRepository.find({
        where: {
          tenant_id: tenantId,
          assigned_driver_id: driverId,
          scheduled_date: date,
          status: 'confirmed',
        },
      });

      for (const job of jobs) {
        try {
          await this.jobsService.changeStatus(tenantId, job.id, { status: 'dispatched' } as any, 'dispatcher');
          jobsDispatched++;
        } catch { /* skip jobs that can't transition */ }
      }

      // Set actual_start_time on route if exists
      const route = await this.routesRepository.findOne({
        where: { tenant_id: tenantId, driver_id: driverId, route_date: date },
      });
      if (route && !route.actual_start_time) {
        route.actual_start_time = new Date();
        route.status = 'active';
        await this.routesRepository.save(route);
      }
    }

    return { message: 'Routes sent', jobsDispatched };
  }

  async checkRouteCompletion(tenantId: string, driverId: string, date: string): Promise<void> {
    const jobs = await this.jobsRepository.find({
      where: {
        tenant_id: tenantId,
        assigned_driver_id: driverId,
        scheduled_date: date,
      },
    });

    if (jobs.length === 0) return;
    const allDone = jobs.every(j => ['completed', 'cancelled', 'failed'].includes(j.status));
    if (!allDone) return;

    const route = await this.routesRepository.findOne({
      where: { tenant_id: tenantId, driver_id: driverId, route_date: date },
    });
    if (route && route.status !== 'completed') {
      route.status = 'completed';
      route.actual_end_time = new Date();
      await this.routesRepository.save(route);
    }
  }
}
