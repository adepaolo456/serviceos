import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Route } from './entities/route.entity';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../auth/entities/user.entity';
import { JobsService } from '../jobs/jobs.service';
import { CreateRouteDto, ReorderDto } from './dto/dispatch.dto';

@Injectable()
export class DispatchService {
  constructor(
    @InjectRepository(Route)
    private routesRepository: Repository<Route>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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

    const route = await this.routesRepository.find({
      where: { tenant_id: tenantId, route_date: date },
    });

    const routesByDriver = new Map(route.map((r) => [r.driver_id, r]));

    const board = drivers.map((driver) => {
      const driverJobs = jobs.filter((j) => j.assigned_driver_id === driver.id);
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

    const unassignedJobs = jobs.filter((j) => !j.assigned_driver_id);

    return { date, drivers: board, unassigned: unassignedJobs };
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
