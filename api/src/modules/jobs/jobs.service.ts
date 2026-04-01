import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { Customer } from '../customers/entities/customer.entity';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
} from './dto/job.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled', 'failed'],
  dispatched: ['en_route', 'cancelled', 'failed'],
  en_route: ['arrived', 'cancelled', 'failed'],
  arrived: ['in_progress', 'cancelled', 'failed'],
  in_progress: ['completed', 'cancelled', 'failed'],
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(PricingRule)
    private pricingRepo: Repository<PricingRule>,
    @InjectRepository(AutomationLog)
    private logRepo: Repository<AutomationLog>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
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

    // Auto-calculate pricing if assetSubtype provided but no explicit price
    let basePrice = dto.basePrice;
    let totalPrice = dto.totalPrice;
    let rentalDays = dto.rentalDays;
    let discountPercentage = 0;
    let discountAmount = 0;

    if (dto.assetSubtype && !dto.basePrice) {
      const rule = await this.pricingRepo.findOne({
        where: { tenant_id: tenantId, asset_subtype: dto.assetSubtype, is_active: true },
      });
      if (rule) {
        basePrice = Number(rule.base_price);
        rentalDays = rentalDays ?? rule.rental_period_days ?? 14;

        // Check customer discount
        if (dto.customerId) {
          const customer = await this.customerRepo.findOne({ where: { id: dto.customerId } });
          if (customer?.discount_percentage) {
            discountPercentage = Number(customer.discount_percentage);
            discountAmount = Math.round(basePrice * discountPercentage) / 100;
          }
        }

        totalPrice = basePrice - discountAmount;
      }
    }

    const job = this.jobsRepository.create({
      tenant_id: tenantId,
      job_number: jobNumber,
      customer_id: dto.customerId,
      asset_id: dto.assetId,
      assigned_driver_id: dto.assignedDriverId,
      job_type: dto.jobType,
      service_type: dto.serviceType,
      asset_subtype: dto.assetSubtype || undefined,
      priority: dto.priority ?? 'normal',
      scheduled_date: dto.scheduledDate,
      scheduled_window_start: dto.scheduledWindowStart,
      scheduled_window_end: dto.scheduledWindowEnd,
      service_address: dto.serviceAddress,
      placement_notes: dto.placementNotes,
      rental_start_date: dto.rentalStartDate,
      rental_end_date: dto.rentalEndDate,
      rental_days: rentalDays,
      base_price: basePrice,
      total_price: totalPrice,
      deposit_amount: dto.depositAmount,
      discount_percentage: discountPercentage || undefined,
      discount_amount: discountAmount || undefined,
      source: dto.source,
    } as Partial<Job>);

    const savedJob = await this.jobsRepository.save(job);

    // Reserve asset if one was assigned at creation
    if (savedJob.asset_id) {
      await this.assetRepo.update(savedJob.asset_id, {
        status: 'reserved',
        current_job_id: savedJob.id,
      } as any);
    }

    // Auto-create POS invoice for delivery jobs with a price
    const price = Number(savedJob.total_price) || 0;
    if (savedJob.job_type === 'delivery' && price > 0) {
      const existingInvoice = await this.invoiceRepo.findOne({
        where: { tenant_id: tenantId, job_id: savedJob.id, source: 'booking' },
      });
      if (!existingInvoice) {
        const bp = Number(savedJob.base_price) || price;
        const disc = Number(savedJob.discount_amount) || 0;
        const discPct = Number(savedJob.discount_percentage) || 0;
        const now = new Date();
        const invSeq = await this.invoiceRepo
          .createQueryBuilder('i')
          .where('i.tenant_id = :tenantId', { tenantId })
          .getCount();
        const invNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(invSeq + 1).padStart(3, '0')}`;

        const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = [
          { description: `${dto.assetSubtype || ''} Dumpster Rental`.trim(), quantity: 1, unitPrice: bp, amount: bp },
        ];
        if (disc > 0) {
          lineItems.push({ description: `Customer discount (${discPct}%)`, quantity: 1, unitPrice: -disc, amount: -disc });
        }

        await this.invoiceRepo.save(this.invoiceRepo.create({
          tenant_id: tenantId,
          invoice_number: invNumber,
          customer_id: savedJob.customer_id,
          job_id: savedJob.id,
          status: 'paid',
          source: 'booking',
          invoice_type: 'rental',
          subtotal: bp,
          total: price,
          amount_paid: price,
          balance_due: 0,
          discount_amount: disc,
          paid_at: now,
          payment_method: 'card',
          line_items: lineItems,
          notes: 'Paid at time of booking',
        } as Partial<Invoice>));
      }
    }

    return savedJob;
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
    userRole?: string,
  ): Promise<Job> {
    const job = await this.findOne(tenantId, id);
    const isAdmin = ['owner', 'admin', 'dispatcher'].includes(userRole || '');
    const previousStatus = job.status;

    // Drivers must follow forward-only transitions; dispatchers/owners can override
    if (!isAdmin) {
      const allowed = VALID_TRANSITIONS[job.status];
      if (!allowed || !allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from '${job.status}' to '${dto.status}'`,
        );
      }
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
      case 'failed':
        job.cancelled_at = now;
        break;
    }

    // Handle failed trip — create failure invoice + replacement job
    if (dto.status === 'failed') {
      job.is_failed_trip = true;
      job.failed_reason = (dto as any).reason || (dto as any).cancellationReason || '';
      job.failed_reason_code = (dto as any).reasonCode || null;
      job.failed_at = now;
      job.cancelled_at = now;

      // Auto-create replacement job
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9000) + 1000;
      const replacement = this.jobsRepository.create({
        tenant_id: tenantId,
        job_number: `JOB-${dateStr}-${seq}`,
        customer_id: job.customer_id,
        job_type: job.job_type,
        service_type: job.service_type,
        priority: job.priority,
        service_address: job.service_address,
        placement_notes: job.placement_notes,
        scheduled_window_start: job.scheduled_window_start,
        scheduled_window_end: job.scheduled_window_end,
        rental_days: job.rental_days,
        base_price: job.base_price,
        total_price: job.total_price,
        status: 'pending',
        source: 'rescheduled_from_failure',
        parent_job_id: job.id,
      } as Partial<Job>);
      const savedReplacement = await this.jobsRepository.save(replacement);

      // Update failed job's linked_job_ids
      const linked = Array.isArray(job.linked_job_ids) ? [...job.linked_job_ids] : [];
      linked.push(savedReplacement.id);
      job.linked_job_ids = linked;

      // Create failure charge invoice
      const pricingRule = await this.pricingRepo.findOne({
        where: { tenant_id: tenantId, asset_subtype: job.asset?.subtype || undefined, is_active: true },
      });
      const baseFee = pricingRule ? Number(pricingRule.failed_trip_base_fee) || 150 : 150;

      const invNumber = `INV-${now.getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
      const failureInvoice = this.invoiceRepo.create({
        tenant_id: tenantId,
        invoice_number: invNumber,
        customer_id: job.customer_id,
        job_id: job.id,
        status: 'sent',
        source: 'failed_trip',
        invoice_type: 'failure_charge',
        subtotal: baseFee,
        total: baseFee,
        amount_paid: 0,
        balance_due: baseFee,
        line_items: [{ description: 'Failed pickup/delivery charge', quantity: 1, unitPrice: baseFee, amount: baseFee }],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        notes: `Driver arrived but job could not be completed. Reason: ${job.failed_reason || 'Not specified'}`,
      } as Partial<Invoice>);
      const savedInvoice = await this.invoiceRepo.save(failureInvoice);

      // Log
      await this.logRepo.save(this.logRepo.create({
        tenant_id: tenantId,
        job_id: job.id,
        type: 'failed_trip_charge',
        status: 'completed',
        details: {
          invoiceId: savedInvoice.id,
          invoiceNumber: savedInvoice.invoice_number,
          amount: baseFee,
          replacementJobId: savedReplacement.id,
          replacementJobNumber: savedReplacement.job_number,
          reason: job.failed_reason,
        },
      }));
    }

    // Combined final invoice at pickup completion
    if (dto.status === 'completed' && job.job_type === 'pickup' && job.parent_job_id) {
      // Find root delivery job
      const rootJob = await this.jobsRepository.findOne({ where: { id: job.parent_job_id, tenant_id: tenantId } });
      if (rootJob) {
        const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = [];

        // Extra day charges
        const extraDays = Number(rootJob.extra_days) || 0;
        const extraDayRate = Number(rootJob.extra_day_rate) || 0;
        if (extraDays > 0 && extraDayRate > 0) {
          lineItems.push({ description: `Extra rental days: ${extraDays} days @ $${extraDayRate}/day`, quantity: extraDays, unitPrice: extraDayRate, amount: extraDays * extraDayRate });
        }

        // Uninvoiced dump ticket charges — check the root job's dump data
        const custCharges = Number(rootJob.customer_additional_charges) || 0;
        if (custCharges > 0) {
          const existingInvoice = await this.jobsRepository.query(
            `SELECT id FROM invoices WHERE job_id = $1 AND source = 'dump_slip' LIMIT 1`,
            [rootJob.id],
          );
          if (!existingInvoice || existingInvoice.length === 0) {
            lineItems.push({ description: `Disposal & overage charges`, quantity: 1, unitPrice: custCharges, amount: custCharges });
          }
        }

        if (lineItems.length > 0) {
          const total = lineItems.reduce((s, li) => s + li.amount, 0);
          const invNumber = `INV-${now.getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
          await this.jobsRepository.query(
            `INSERT INTO invoices (id, tenant_id, invoice_number, customer_id, job_id, status, source, invoice_type, subtotal, total, amount_paid, balance_due, line_items, due_date, notes, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sent', 'pickup_completion', 'final_charges', $5, $5, 0, $5, $6, $7, $8, NOW(), NOW())`,
            [tenantId, invNumber, rootJob.customer_id, rootJob.id, total, JSON.stringify(lineItems),
             new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
             `Final charges for rental #${rootJob.job_number}`],
          );
        }
      }
    }

    const savedJob = await this.jobsRepository.save(job);

    // Log admin status overrides (backward transitions)
    if (isAdmin && previousStatus !== dto.status) {
      try {
        await this.logRepo.save(this.logRepo.create({
          tenant_id: tenantId,
          job_id: job.id,
          type: 'status_override',
          status: 'completed',
          details: { from: previousStatus, to: dto.status, overriddenBy: userRole },
        }));
      } catch { /* best effort */ }
    }

    return savedJob;
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
      const newAssetId = (body.assetId as string) || null;
      updates.asset_id = newAssetId;

      // Release old asset if switching or unassigning
      if (job.asset_id && job.asset_id !== newAssetId) {
        await this.assetRepo.update(job.asset_id, {
          status: 'available',
          current_job_id: null,
        } as any);
      }

      // Reserve new asset
      if (newAssetId && newAssetId !== job.asset_id) {
        await this.assetRepo.update(newAssetId, {
          status: 'reserved',
          current_job_id: id,
        } as any);
      }
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

  async scheduleNextTask(tenantId: string, parentJobId: string, body: { type: string; scheduledDate: string; timeWindow?: string; newAssetSubtype?: string }) {
    const parent = await this.findOne(tenantId, parentJobId);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;

    let windowStart = '08:00', windowEnd = '17:00';
    if (body.timeWindow === 'morning') { windowStart = '08:00'; windowEnd = '12:00'; }
    else if (body.timeWindow === 'afternoon') { windowStart = '12:00'; windowEnd = '17:00'; }

    const baseJob = {
      tenant_id: tenantId, customer_id: parent.customer_id, service_address: parent.service_address,
      service_type: parent.service_type, priority: 'normal' as const, scheduled_date: body.scheduledDate,
      scheduled_window_start: windowStart, scheduled_window_end: windowEnd,
      status: 'pending', source: 'schedule_next', parent_job_id: parentJobId,
    };

    const jobs: Job[] = [];

    if (body.type === 'pickup') {
      const job = this.jobsRepository.create({ ...baseJob, job_number: `JOB-${dateStr}-${seq}`, job_type: 'pickup', asset_id: parent.asset_id });
      jobs.push(await this.jobsRepository.save(job));
    } else if (body.type === 'exchange') {
      const job = this.jobsRepository.create({ ...baseJob, job_number: `JOB-${dateStr}-${seq}`, job_type: 'exchange', asset_id: parent.asset_id });
      jobs.push(await this.jobsRepository.save(job));

      // Auto-create exchange invoice
      const exchangeFee = Number((body as any).exchangeFee || 0) || Number(job.base_price || 0);
      if (exchangeFee > 0) {
        const invNumber = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
        await this.jobsRepository.query(
          `INSERT INTO invoices (id, tenant_id, invoice_number, customer_id, job_id, status, source, invoice_type, subtotal, total, amount_paid, balance_due, line_items, due_date, notes, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sent', 'exchange', 'exchange', $5, $5, 0, $5, $6, $7, $8, NOW(), NOW())`,
          [tenantId, invNumber, parent.customer_id, jobs[jobs.length - 1].id, exchangeFee,
           JSON.stringify([{ description: `Dumpster Exchange`, quantity: 1, unitPrice: exchangeFee, amount: exchangeFee }]),
           new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
           `Exchange scheduled from job #${parent.job_number}`],
        );
      }
    } else if (body.type === 'dump_and_return') {
      const pickupJob = this.jobsRepository.create({ ...baseJob, job_number: `JOB-${dateStr}-${seq}`, job_type: 'pickup', asset_id: parent.asset_id });
      const saved1 = await this.jobsRepository.save(pickupJob);
      jobs.push(saved1);
      const deliveryJob = this.jobsRepository.create({ ...baseJob, job_number: `JOB-${dateStr}-${seq + 1}`, job_type: 'delivery', asset_id: parent.asset_id });
      const saved2 = await this.jobsRepository.save(deliveryJob);
      jobs.push(saved2);
    }

    // Update parent's linked_job_ids
    const linkedIds = Array.isArray(parent.linked_job_ids) ? [...parent.linked_job_ids] : [];
    jobs.forEach(j => linkedIds.push(j.id));
    await this.jobsRepository.update(parentJobId, { linked_job_ids: linkedIds });

    return { jobs, parentJobId };
  }

  async stageAtYard(tenantId: string, jobId: string, body: { wasteType?: string; notes?: string }) {
    const job = await this.findOne(tenantId, jobId);

    await this.jobsRepository.update(jobId, { dump_disposition: 'staged' });

    if (job.asset_id) {
      await this.assetRepo.update(job.asset_id, {
        status: 'full_staged',
        staged_at: new Date(),
        staged_from_job_id: jobId,
        staged_waste_type: body.wasteType || null,
        staged_notes: body.notes || null,
        needs_dump: true,
        current_location_type: 'yard',
      } as any);
    }

    return this.findOne(tenantId, jobId);
  }

  async updateAssetStatus(assetId: string, status: string): Promise<void> {
    await this.assetRepo.update(assetId, { status, current_job_id: null } as any);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.jobsRepository.update(
      { id, tenant_id: tenantId },
      { status: 'cancelled', cancelled_at: new Date() },
    );
  }

  async bulkReorder(tenantId: string, jobIds: string[]): Promise<void> {
    for (let i = 0; i < jobIds.length; i++) {
      await this.jobsRepository.update(
        { id: jobIds[i], tenant_id: tenantId },
        { route_order: i + 1 },
      );
    }
  }

  async createDumpRun(tenantId: string, body: { assetIds: string[]; dumpLocationId?: string; scheduledDate: string; timeWindow?: string; assignedDriverId?: string; notes?: string }) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;

    let windowStart = '08:00', windowEnd = '17:00';
    if (body.timeWindow === 'morning') { windowStart = '08:00'; windowEnd = '12:00'; }
    else if (body.timeWindow === 'afternoon') { windowStart = '12:00'; windowEnd = '17:00'; }

    const job = this.jobsRepository.create({
      tenant_id: tenantId,
      job_number: `JOB-${dateStr}-${seq}`,
      job_type: 'dump_run',
      service_type: 'dump_run',
      priority: 'normal',
      status: 'pending',
      scheduled_date: body.scheduledDate,
      scheduled_window_start: windowStart,
      scheduled_window_end: windowEnd,
      assigned_driver_id: body.assignedDriverId || undefined,
      placement_notes: body.notes,
      source: 'dispatch',
      linked_job_ids: body.assetIds,
    } as Partial<Job>);

    const saved = await this.jobsRepository.save(job);

    // Update assets to "scheduled_dump"
    for (const assetId of body.assetIds) {
      await this.assetRepo.update(assetId, { current_job_id: saved.id } as any);
    }

    return saved;
  }
}
