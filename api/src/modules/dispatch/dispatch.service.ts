import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Route } from './entities/route.entity';
import { Job } from '../jobs/entities/job.entity';
import { User } from '../auth/entities/user.entity';
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
  ) {}

  async getDispatchBoard(tenantId: string, date: string) {
    const drivers = await this.usersRepository.find({
      where: {
        tenant_id: tenantId,
        role: In(['driver', 'admin', 'owner']),
        is_active: true,
      },
    });

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
    return this.jobsRepository.find({
      where: {
        tenant_id: tenantId,
        assigned_driver_id: IsNull(),
        status: In(['pending', 'confirmed']),
      },
      relations: ['customer', 'asset'],
      order: { scheduled_date: 'ASC', created_at: 'DESC' },
    });
  }
}
