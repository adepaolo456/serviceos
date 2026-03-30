import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Job } from './entities/job.entity';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
} from './dto/job.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
  ) {}

  async create(tenantId: string, dto: CreateJobDto): Promise<Job> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const countToday = await this.jobsRepository
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.created_at::date = CURRENT_DATE')
      .getCount();

    const seq = String(countToday + 1).padStart(3, '0');
    const jobNumber = `JOB-${dateStr}-${seq}`;

    const job = this.jobsRepository.create({
      tenant_id: tenantId,
      job_number: jobNumber,
      customer_id: dto.customerId,
      asset_id: dto.assetId,
      assigned_driver_id: dto.assignedDriverId,
      job_type: dto.jobType,
      service_type: dto.serviceType,
      priority: dto.priority ?? 'normal',
      scheduled_date: dto.scheduledDate,
      scheduled_window_start: dto.scheduledWindowStart,
      scheduled_window_end: dto.scheduledWindowEnd,
      service_address: dto.serviceAddress,
      placement_notes: dto.placementNotes,
      rental_start_date: dto.rentalStartDate,
      rental_end_date: dto.rentalEndDate,
      rental_days: dto.rentalDays,
      base_price: dto.basePrice,
      total_price: dto.totalPrice,
      deposit_amount: dto.depositAmount,
      source: dto.source,
    });

    return this.jobsRepository.save(job);
  }

  async findAll(tenantId: string, query: ListJobsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .leftJoinAndSelect('j.assigned_driver', 'assigned_driver')
      .where('j.tenant_id = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('j.status = :status', { status: query.status });
    }

    if (query.customerId) {
      qb.andWhere('j.customer_id = :customerId', {
        customerId: query.customerId,
      });
    }

    if (query.assignedDriverId) {
      qb.andWhere('j.assigned_driver_id = :assignedDriverId', {
        assignedDriverId: query.assignedDriverId,
      });
    }

    if (query.dateFrom) {
      qb.andWhere('j.scheduled_date >= :dateFrom', {
        dateFrom: query.dateFrom,
      });
    }

    if (query.dateTo) {
      qb.andWhere('j.scheduled_date <= :dateTo', { dateTo: query.dateTo });
    }

    qb.orderBy('j.scheduled_date', 'ASC')
      .addOrderBy('j.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantId: string, id: string): Promise<Job> {
    const job = await this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .leftJoinAndSelect('j.assigned_driver', 'assigned_driver')
      .where('j.id = :id', { id })
      .andWhere('j.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return job;
  }

  async update(tenantId: string, id: string, dto: UpdateJobDto): Promise<Job> {
    const job = await this.findOne(tenantId, id);

    if (dto.customerId !== undefined) job.customer_id = dto.customerId;
    if (dto.assetId !== undefined) job.asset_id = dto.assetId;
    if (dto.assignedDriverId !== undefined)
      job.assigned_driver_id = dto.assignedDriverId;
    if (dto.jobType !== undefined) job.job_type = dto.jobType;
    if (dto.serviceType !== undefined) job.service_type = dto.serviceType;
    if (dto.priority !== undefined) job.priority = dto.priority;
    if (dto.scheduledDate !== undefined) job.scheduled_date = dto.scheduledDate;
    if (dto.scheduledWindowStart !== undefined)
      job.scheduled_window_start = dto.scheduledWindowStart;
    if (dto.scheduledWindowEnd !== undefined)
      job.scheduled_window_end = dto.scheduledWindowEnd;
    if (dto.serviceAddress !== undefined)
      job.service_address = dto.serviceAddress;
    if (dto.placementNotes !== undefined)
      job.placement_notes = dto.placementNotes;
    if (dto.rentalStartDate !== undefined)
      job.rental_start_date = dto.rentalStartDate;
    if (dto.rentalEndDate !== undefined)
      job.rental_end_date = dto.rentalEndDate;
    if (dto.rentalDays !== undefined) job.rental_days = dto.rentalDays;
    if (dto.basePrice !== undefined) job.base_price = dto.basePrice;
    if (dto.totalPrice !== undefined) job.total_price = dto.totalPrice;
    if (dto.depositAmount !== undefined) job.deposit_amount = dto.depositAmount;
    if (dto.source !== undefined) job.source = dto.source;

    return this.jobsRepository.save(job);
  }

  async changeStatus(
    tenantId: string,
    id: string,
    dto: ChangeStatusDto,
  ): Promise<Job> {
    const job = await this.findOne(tenantId, id);

    const allowed = VALID_TRANSITIONS[job.status];
    if (!allowed || !allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from '${job.status}' to '${dto.status}'`,
      );
    }

    job.status = dto.status;

    const now = new Date();
    switch (dto.status) {
      case 'dispatched':
        job.dispatched_at = now;
        break;
      case 'en_route':
        job.en_route_at = now;
        break;
      case 'arrived':
        job.arrived_at = now;
        break;
      case 'in_progress':
        // Rental starts when delivered — set rental dates if not already set
        if (!job.rental_start_date) {
          job.rental_start_date = now.toISOString().split('T')[0];
        }
        if (!job.rental_end_date && job.rental_days) {
          const end = new Date(job.rental_start_date);
          end.setDate(end.getDate() + (job.rental_days || 7));
          job.rental_end_date = end.toISOString().split('T')[0];
        }
        break;
      case 'completed':
        job.completed_at = now;
        break;
      case 'cancelled':
        job.cancelled_at = now;
        if (dto.cancellationReason) {
          job.cancellation_reason = dto.cancellationReason;
        }
        break;
    }

    return this.jobsRepository.save(job);
  }

  async assignJob(
    tenantId: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<Job> {
    // First verify the job exists and belongs to this tenant
    const job = await this.findOne(tenantId, id);

    const updates: Record<string, unknown> = {};

    if ('assetId' in body) {
      updates.asset_id = body.assetId || null;
    }

    if ('assignedDriverId' in body) {
      const newDriverId = (body.assignedDriverId as string) || null;
      updates.assigned_driver_id = newDriverId;

      if (newDriverId && job.status === 'pending') {
        updates.status = 'confirmed';
      }
      if (!newDriverId && job.status === 'confirmed') {
        updates.status = 'pending';
      }
    }

    // Use .update() instead of .save() to avoid TypeORM re-setting
    // the FK from the eagerly-loaded relation object
    await this.jobsRepository.update(
      { id, tenant_id: tenantId },
      updates,
    );

    return this.findOne(tenantId, id);
  }

  async findByDateRange(tenantId: string, date: string, days: number) {
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + days);

    const endDateStr = endDate.toISOString().slice(0, 10);

    return this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .leftJoinAndSelect('j.assigned_driver', 'assigned_driver')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.scheduled_date >= :startDate', { startDate: date })
      .andWhere('j.scheduled_date <= :endDate', { endDate: endDateStr })
      .orderBy('j.scheduled_date', 'ASC')
      .addOrderBy('j.scheduled_window_start', 'ASC')
      .getMany();
  }

  async findUnassigned(tenantId: string) {
    return this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.assigned_driver_id IS NULL')
      .andWhere('j.status IN (:...statuses)', {
        statuses: ['pending', 'confirmed'],
      })
      .orderBy('j.scheduled_date', 'ASC')
      .getMany();
  }

  async rescheduleJob(
    tenantId: string,
    jobId: string,
    body: { scheduledDate: string; reason?: string; source?: string; timeWindow?: string },
  ): Promise<Job> {
    const job = await this.findOne(tenantId, jobId);

    if (['completed', 'cancelled'].includes(job.status)) {
      throw new BadRequestException('Cannot reschedule a completed or cancelled job');
    }

    const oldDate = job.scheduled_date;
    const updates: Record<string, unknown> = {
      scheduled_date: body.scheduledDate,
      rescheduled_from_date: oldDate,
      rescheduled_reason: body.reason || null,
    };

    if (body.source === 'portal') {
      updates.rescheduled_by_customer = true;
      updates.rescheduled_at = new Date();
    }

    // Recalculate rental_end_date if rental_days is set and rental hasn't started
    if (job.rental_days && !job.rental_start_date) {
      const end = new Date(body.scheduledDate);
      end.setDate(end.getDate() + job.rental_days);
      updates.rental_end_date = end.toISOString().split('T')[0];
      updates.rental_start_date = body.scheduledDate;
    }

    // Update time window if provided
    if (body.timeWindow) {
      if (body.timeWindow === 'morning') { updates.scheduled_window_start = '08:00'; updates.scheduled_window_end = '12:00'; }
      else if (body.timeWindow === 'afternoon') { updates.scheduled_window_start = '12:00'; updates.scheduled_window_end = '17:00'; }
      else { updates.scheduled_window_start = '08:00'; updates.scheduled_window_end = '17:00'; }
    }

    await this.jobsRepository.update({ id: jobId, tenant_id: tenantId }, updates);

    // Update linked pickup job if exists
    if (updates.rental_end_date) {
      const pickupJob = await this.jobsRepository.findOne({
        where: {
          tenant_id: tenantId,
          customer_id: job.customer_id,
          job_type: 'pickup',
          status: In(['pending', 'confirmed', 'dispatched']),
        },
      });
      if (pickupJob) {
        await this.jobsRepository.update(pickupJob.id, { scheduled_date: updates.rental_end_date as string });
      }
    }

    return this.findOne(tenantId, jobId);
  }
}
