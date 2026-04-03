import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { BillingService } from '../billing/billing.service';
import { BillingIssueDetectorService } from '../billing/services/billing-issue-detector.service';
import { RentalChainsService } from '../rental-chains/rental-chains.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import { JobPricingAudit } from './entities/job-pricing-audit.entity';
import { hasPricingRelevantChanges } from './helpers/pricing-change-detector';
import { extractCoordinates, buildAddressString } from '../../common/helpers/coordinate-validator';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
} from './dto/job.dto';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled', 'failed', 'needs_reschedule'],
  dispatched: ['en_route', 'cancelled', 'failed', 'needs_reschedule'],
  en_route: ['arrived', 'cancelled', 'failed', 'needs_reschedule'],
  arrived: ['in_progress', 'cancelled', 'failed', 'needs_reschedule'],
  in_progress: ['completed', 'cancelled', 'failed', 'needs_reschedule'],
  needs_reschedule: ['pending', 'confirmed', 'dispatched', 'cancelled'],
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
    @InjectRepository(PricingRule)
    private pricingRepo: Repository<PricingRule>,
    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
    @InjectRepository(Route)
    private routeRepo: Repository<Route>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(CreditMemo)
    private creditMemoRepo: Repository<CreditMemo>,
    @InjectRepository(RentalChain)
    private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private taskChainLinkRepo: Repository<TaskChainLink>,
    @InjectRepository(JobPricingAudit)
    private pricingAuditRepo: Repository<JobPricingAudit>,
    private billingService: BillingService,
    private billingIssueDetector: BillingIssueDetectorService,
    private rentalChainsService: RentalChainsService,
    private notificationsService: NotificationsService,
    private pricingService: PricingService,
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
          const customer = await this.customerRepo.findOne({ where: { id: dto.customerId, tenant_id: tenantId } });
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
      const exists = await this.billingService.hasInvoice(tenantId, savedJob.id, 'booking');
      if (!exists) {
        const bp = Number(savedJob.base_price) || price;
        const disc = Number(savedJob.discount_amount) || 0;
        const discPct = Number(savedJob.discount_percentage) || 0;

        const lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }> = [
          { description: `${dto.assetSubtype || ''} Dumpster Rental`.trim(), quantity: 1, unitPrice: bp, amount: bp },
        ];
        if (disc > 0) {
          lineItems.push({ description: `Customer discount (${discPct}%)`, quantity: 1, unitPrice: -disc, amount: -disc });
        }

        await this.billingService.createInternalInvoice(tenantId, {
          customerId: savedJob.customer_id,
          jobId: savedJob.id,
          source: 'booking',
          invoiceType: 'rental',
          status: 'paid',
          paymentMethod: 'card',
          lineItems,
          discountAmount: disc,
          notes: 'Paid at time of booking',
        });
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

  async update(tenantId: string, id: string, dto: UpdateJobDto): Promise<Record<string, unknown>> {
    const job = await this.findOne(tenantId, id);

    // ── Apply non-pricing field updates ──
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
    if (dto.source !== undefined) job.source = dto.source;

    // ── Pricing lock enforcement ──
    const hasLockedPricing = job.pricing_snapshot && job.pricing_locked_at;
    const pricingChange = hasPricingRelevantChanges(job, dto as Record<string, unknown>);

    let pricingMeta: Record<string, unknown> = {};

    if (hasLockedPricing && !pricingChange.changed) {
      // No pricing-relevant fields changed — return locked snapshot, skip recalculation
      // Allow explicit base_price/total_price overrides if provided (manual price edit)
      if (dto.basePrice !== undefined) job.base_price = dto.basePrice;
      if (dto.totalPrice !== undefined) job.total_price = dto.totalPrice;
      if (dto.depositAmount !== undefined) job.deposit_amount = dto.depositAmount;

      pricingMeta = {
        used_locked_snapshot: true,
        recalculation_skipped_reason: 'no_pricing_fields_changed',
        pricing_snapshot_id: job.pricing_snapshot_id,
        pricing_config_version_id: job.pricing_config_version_id,
      };
    } else if (pricingChange.changed) {
      // Pricing-relevant field changed or explicit recalculate — recalculate
      const previousSnapshotId = job.pricing_snapshot_id;

      try {
        // Extract valid coordinates — NEVER fall back to 0,0
        const addr = job.service_address as Record<string, unknown> | null;
        const coords = extractCoordinates(addr);
        if (!coords) {
          const addrStr = buildAddressString(addr);
          throw new BadRequestException(
            addrStr
              ? `Service address "${addrStr}" has no valid coordinates. Geocode the address before pricing.`
              : 'Service address missing or has no valid coordinates. Cannot calculate distance-based pricing.',
          );
        }

        const calcResult = await this.pricingService.calculate(tenantId, {
          serviceType: job.service_type || 'dumpster_rental',
          assetSubtype: dto.assetSubtype || job.asset_subtype || '',
          jobType: job.job_type || 'delivery',
          customerType: dto.rentalType || undefined,
          customerLat: coords.lat,
          customerLng: coords.lng,
          yardId: dto.yardId || undefined,
          rentalDays: job.rental_days || undefined,
          rentalType: dto.rentalType || undefined,
          exchange_context: dto.exchange_context ? {
            pickup_asset_subtype: dto.exchange_context.pickup_asset_subtype || '',
            dropoff_asset_subtype: dto.exchange_context.dropoff_asset_subtype || '',
          } : undefined,
          persist_snapshot: true,
          jobId: job.id,
        });

        const breakdown = (calcResult as Record<string, unknown>).breakdown as Record<string, unknown>;

        // Update job pricing fields from new calculation
        job.base_price = breakdown.basePrice as number;
        job.total_price = breakdown.total as number;
        job.deposit_amount = breakdown.depositAmount as number;
        job.pricing_snapshot = calcResult as unknown as Record<string, unknown>;
        job.pricing_locked_at = new Date();
        job.pricing_config_version_id = (breakdown.pricingConfigVersionId as string) || null;
        job.pricing_snapshot_id = (calcResult as Record<string, unknown>).snapshot_id as string || null;

        // Write audit row
        await this.pricingAuditRepo.save(this.pricingAuditRepo.create({
          tenant_id: tenantId,
          job_id: job.id,
          previous_pricing_snapshot_id: previousSnapshotId || null,
          new_pricing_snapshot_id: job.pricing_snapshot_id,
          recalculation_reasons: pricingChange.reasons,
          triggered_by: null, // TODO: pass userId when available
        }));

        pricingMeta = {
          used_locked_snapshot: false,
          recalculation_reasons: pricingChange.reasons,
          pricing_snapshot_id: job.pricing_snapshot_id,
          pricing_config_version_id: job.pricing_config_version_id,
        };
      } catch (err) {
        // If pricing calculation fails, preserve existing pricing and warn
        if (dto.basePrice !== undefined) job.base_price = dto.basePrice;
        if (dto.totalPrice !== undefined) job.total_price = dto.totalPrice;
        if (dto.depositAmount !== undefined) job.deposit_amount = dto.depositAmount;

        pricingMeta = {
          used_locked_snapshot: true,
          recalculation_skipped_reason: 'pricing_calculation_failed',
          recalculation_error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    } else {
      // No locked pricing yet — allow direct field updates (backward compatible)
      if (dto.basePrice !== undefined) job.base_price = dto.basePrice;
      if (dto.totalPrice !== undefined) job.total_price = dto.totalPrice;
      if (dto.depositAmount !== undefined) job.deposit_amount = dto.depositAmount;

      pricingMeta = {};
    }

    const saved = await this.jobsRepository.save(job);

    // Return job with pricing metadata (additive, backward compatible)
    return { ...saved, ...pricingMeta } as Record<string, unknown>;
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
        // Failure is recorded but status transitions to needs_reschedule
        break;
    }

    // Handle failed trip — create failure invoice, set needs_reschedule
    if (dto.status === 'failed') {
      job.is_failed_trip = true;
      job.failed_reason = (dto as any).reason || (dto as any).cancellationReason || '';
      job.failed_reason_code = (dto as any).reasonCode || null;
      job.failed_at = now;
      job.attempt_count = ((job as any).attempt_count || 1) + 1;

      // Set to needs_reschedule instead of leaving as failed
      job.status = 'needs_reschedule';

      // Create failure charge invoice
      const pricingRule = await this.pricingRepo.findOne({
        where: { tenant_id: tenantId, asset_subtype: job.asset?.subtype || undefined, is_active: true },
      });
      const baseFee = pricingRule ? Number(pricingRule.failed_trip_base_fee) || 150 : 150;

      const savedInvoice = await this.billingService.createInternalInvoice(tenantId, {
        customerId: job.customer_id,
        jobId: job.id,
        source: 'failed_trip',
        invoiceType: 'failure_charge',
        status: 'open',
        lineItems: [{ description: 'Failed pickup/delivery charge', quantity: 1, unitPrice: baseFee, amount: baseFee }],
        notes: `Driver arrived but job could not be completed. Reason: ${job.failed_reason || 'Not specified'}`,
      });

      // Log notification
      await this.notifRepo.save(this.notifRepo.create({
        tenant_id: tenantId,
        job_id: job.id,
        channel: 'automation',
        type: 'failed_trip_charge',
        recipient: 'system',
        body: JSON.stringify({
          invoiceId: savedInvoice.id,
          invoiceNumber: savedInvoice.invoice_number,
          amount: baseFee,
          reason: job.failed_reason,
        }),
        status: 'logged',
        sent_at: new Date(),
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
          const hasDumpSlip = await this.billingService.hasInvoice(tenantId, rootJob.id, 'dump_slip');
          if (!hasDumpSlip) {
            lineItems.push({ description: `Disposal & overage charges`, quantity: 1, unitPrice: custCharges, amount: custCharges });
          }
        }

        if (lineItems.length > 0) {
          await this.billingService.createInternalInvoice(tenantId, {
            customerId: rootJob.customer_id,
            jobId: rootJob.id,
            source: 'pickup_completion',
            invoiceType: 'final_charges',
            status: 'open',
            lineItems,
            notes: `Final charges for rental #${rootJob.job_number}`,
          });
        }
      }
    }

    const savedJob = await this.jobsRepository.save(job);

    // Billing issue detection on job completion
    if (dto.status === 'completed') {
      try {
        const linkedInvoice = await this.jobsRepository.manager
          .getRepository(Invoice)
          .findOne({ where: { job_id: savedJob.id, tenant_id: tenantId } });
        if (linkedInvoice) {
          await this.billingIssueDetector.detectAllForInvoice(tenantId, linkedInvoice.id);
        } else {
          await this.billingIssueDetector.detectMissingInvoice(tenantId, savedJob.id);
        }
      } catch { /* billing issue detection is best-effort */ }

      // If this job was previously failed, reverse the failed-trip charge
      if (savedJob.is_failed_trip) {
        try {
          const failedInvoices = await this.invoiceRepo.find({
            where: { job_id: savedJob.id, tenant_id: tenantId },
            relations: ['line_items'],
          });
          for (const inv of failedInvoices) {
            const hasFailedLine = inv.line_items?.some(
              (li) => li.name?.toLowerCase().includes('failed'),
            );
            if (hasFailedLine && inv.status !== 'voided') {
              await this.billingService.voidInternalInvoice(inv.id, 'Failed trip charge reversed — job completed successfully');
            }
          }
        } catch { /* reversal is best-effort */ }
      }
    }

    // Rental chain reaction on job type change
    if (previousStatus !== dto.status && (dto as any).jobType && (dto as any).previousJobType) {
      try {
        await this.rentalChainsService.handleTypeChange(
          tenantId, savedJob.id, (dto as any).previousJobType, (dto as any).jobType,
        );
      } catch { /* chain reaction is best-effort */ }
    }

    // Auto-update asset status based on the new job status
    await this.updateAssetOnJobStatus(savedJob, dto.status);

    // Check if all jobs on this driver's route are done
    if (['completed', 'cancelled', 'failed', 'needs_reschedule'].includes(dto.status) && savedJob.assigned_driver_id && savedJob.scheduled_date) {
      await this.checkRouteCompletion(tenantId, savedJob.assigned_driver_id, savedJob.scheduled_date);
    }

    // Queue customer notifications for key status changes
    if (job.customer_id && job.customer) {
      const customerName = `${job.customer.first_name} ${job.customer.last_name}`;
      const recipient = job.customer.phone || job.customer.email || '';
      const channel = job.customer.phone ? 'sms' : 'email';

      try {
        if (dto.status === 'confirmed' && recipient) {
          await this.notificationsService.send(tenantId, {
            channel, type: 'booking_confirmation', recipient,
            subject: `Booking Confirmed - Job #${job.job_number}`,
            body: `Hi ${customerName}, your ${job.service_type || job.job_type} is confirmed for ${job.scheduled_date}. Job #${job.job_number}.`,
            jobId: job.id, customerId: job.customer_id,
          });
        } else if (dto.status === 'en_route' && recipient) {
          const window = [job.scheduled_window_start, job.scheduled_window_end].filter(Boolean).join(' – ');
          await this.notificationsService.send(tenantId, {
            channel, type: 'on_the_way', recipient,
            subject: `Driver On The Way - Job #${job.job_number}`,
            body: `Hi ${customerName}, your driver is on the way!${window ? ` Estimated arrival: ${window}.` : ''} Job #${job.job_number}.`,
            jobId: job.id, customerId: job.customer_id,
          });
        } else if (dto.status === 'completed' && recipient) {
          await this.notificationsService.send(tenantId, {
            channel, type: 'booking_confirmation', recipient,
            subject: `Service Completed - Job #${job.job_number}`,
            body: `Hi ${customerName}, your ${job.service_type || job.job_type} has been completed. Thank you!`,
            jobId: job.id, customerId: job.customer_id,
          });
        }
      } catch { /* best effort — don't block status transition */ }
    }

    // Log admin status overrides (backward transitions)
    if (isAdmin && previousStatus !== dto.status) {
      try {
        await this.notifRepo.save(this.notifRepo.create({
          tenant_id: tenantId,
          job_id: job.id,
          channel: 'automation',
          type: 'status_override',
          recipient: 'system',
          body: JSON.stringify({ from: previousStatus, to: dto.status, overriddenBy: userRole }),
          status: 'logged',
          sent_at: new Date(),
        }));
      } catch { /* best effort */ }
    }

    return savedJob;
  }

  async getCascadePreview(tenantId: string, id: string) {
    const job = await this.findOne(tenantId, id);

    // Task info
    const task = {
      id: job.id,
      job_number: job.job_number,
      job_type: job.job_type,
      status: job.status,
      asset_subtype: job.asset_subtype,
      scheduled_date: job.scheduled_date,
    };

    // Linked pickup task
    let linkedPickup: Record<string, any> | null = null;
    if (job.job_type === 'delivery') {
      // Try linked_job_ids first
      if (Array.isArray(job.linked_job_ids) && job.linked_job_ids.length > 0) {
        const linked = await this.jobsRepository.findOne({
          where: { id: In(job.linked_job_ids), job_type: 'pickup', tenant_id: tenantId },
        });
        if (linked) {
          linkedPickup = {
            id: linked.id,
            job_number: linked.job_number,
            status: linked.status,
            scheduled_date: linked.scheduled_date,
          };
        }
      }
      // Fallback: match by customer_id + asset_id + job_type
      if (!linkedPickup) {
        const pickup = await this.jobsRepository.findOne({
          where: {
            tenant_id: tenantId,
            customer_id: job.customer_id,
            ...(job.asset_id ? { asset_id: job.asset_id } : {}),
            job_type: 'pickup',
          },
        });
        if (pickup && !['completed', 'cancelled'].includes(pickup.status)) {
          linkedPickup = {
            id: pickup.id,
            job_number: pickup.job_number,
            status: pickup.status,
            scheduled_date: pickup.scheduled_date,
          };
        }
      }
    }

    // Linked invoices
    const invoices = await this.invoiceRepo.find({
      where: { job_id: job.id, tenant_id: tenantId },
    });
    const linkedInvoices = invoices.map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      status: inv.status,
      total: inv.total,
      amount_paid: inv.amount_paid,
    }));

    // Asset info
    let assetInfo: Record<string, any> | null = null;
    if (job.asset_id) {
      const asset = await this.assetRepo.findOne({ where: { id: job.asset_id } });
      if (asset) {
        assetInfo = { status: asset.status, identifier: asset.identifier };
      }
    }

    // Assigned driver
    let assignedDriver: Record<string, any> | null = null;
    if (job.assigned_driver_id && job.assigned_driver) {
      assignedDriver = {
        first_name: job.assigned_driver.first_name,
        last_name: job.assigned_driver.last_name,
      };
    }

    // Whether task is in progress
    const isInProgress = ['en_route', 'arrived', 'in_progress'].includes(job.status);

    // Customer info
    let customerInfo: Record<string, any> | null = null;
    if (job.customer) {
      customerInfo = {
        first_name: job.customer.first_name,
        last_name: job.customer.last_name,
        account_id: job.customer.account_id,
      };
    }

    return {
      task,
      linkedPickup,
      linkedInvoices,
      assetInfo,
      assignedDriver,
      isInProgress,
      customerInfo,
    };
  }

  async cascadeDelete(
    tenantId: string,
    id: string,
    userId: string,
    options: {
      deletePickup?: boolean;
      voidInvoices?: { invoiceId: string; void: boolean }[];
      voidReason?: string;
    },
  ) {
    const job = await this.findOne(tenantId, id);

    // 1. Validate
    if (['en_route', 'arrived', 'in_progress'].includes(job.status)) {
      throw new BadRequestException('Cannot delete a task that is currently in progress');
    }

    const now = new Date();
    const deletedTasks: { id: string; job_number: string }[] = [];
    const voidedInvoices: { id: string; invoice_number: number }[] = [];
    const creditMemos: { id: string; amount: number }[] = [];
    const assetsReleased: { id: string; identifier: string }[] = [];
    const rentalChainsCancelled: { id: string }[] = [];

    const previousStatus = job.status;

    // 2. Cancel main task
    await this.jobsRepository.update(
      { id: job.id, tenant_id: tenantId },
      { status: 'cancelled', cancelled_at: now },
    );
    deletedTasks.push({ id: job.id, job_number: job.job_number });

    // 7. Driver unassign on main task
    if (job.assigned_driver_id) {
      await this.jobsRepository.update(
        { id: job.id, tenant_id: tenantId },
        { assigned_driver_id: null as any },
      );
    }

    // 3. Pickup deletion
    if (options.deletePickup && job.job_type === 'delivery') {
      let pickupJob: Job | null = null;

      // Try linked_job_ids first
      if (Array.isArray(job.linked_job_ids) && job.linked_job_ids.length > 0) {
        pickupJob = await this.jobsRepository.findOne({
          where: { id: In(job.linked_job_ids), job_type: 'pickup', tenant_id: tenantId },
        });
      }

      // Fallback
      if (!pickupJob) {
        pickupJob = await this.jobsRepository.findOne({
          where: {
            tenant_id: tenantId,
            customer_id: job.customer_id,
            ...(job.asset_id ? { asset_id: job.asset_id } : {}),
            job_type: 'pickup',
          },
        });
        if (pickupJob && ['completed', 'cancelled'].includes(pickupJob.status)) {
          pickupJob = null;
        }
      }

      if (pickupJob) {
        await this.jobsRepository.update(
          { id: pickupJob.id, tenant_id: tenantId },
          { status: 'cancelled', cancelled_at: now },
        );
        deletedTasks.push({ id: pickupJob.id, job_number: pickupJob.job_number });

        // Unassign driver from pickup
        if (pickupJob.assigned_driver_id) {
          await this.jobsRepository.update(
            { id: pickupJob.id, tenant_id: tenantId },
            { assigned_driver_id: null as any },
          );
        }

        // Release pickup's asset
        if (pickupJob.asset_id) {
          const pickupAsset = await this.assetRepo.findOne({ where: { id: pickupJob.asset_id } });
          if (pickupAsset) {
            await this.assetRepo.update(pickupJob.asset_id, {
              status: 'available',
              current_job_id: null,
            } as any);
            assetsReleased.push({ id: pickupAsset.id, identifier: pickupAsset.identifier });
          }
        }
      }
    }

    // 4. Asset release for main task
    if (job.asset_id) {
      const asset = await this.assetRepo.findOne({ where: { id: job.asset_id } });
      if (asset) {
        const preDeliveryStatuses = ['pending', 'confirmed'];
        if (preDeliveryStatuses.includes(previousStatus)) {
          // Not yet delivered — release back to available
          await this.assetRepo.update(job.asset_id, {
            status: 'available',
            current_job_id: null,
          } as any);
          // Only add if not already in the released list
          if (!assetsReleased.find((a) => a.id === asset.id)) {
            assetsReleased.push({ id: asset.id, identifier: asset.identifier });
          }
        }
        // If dispatched or later with completed delivery or pickup type, keep as deployed
      }
    }

    // 5. Invoice voiding
    if (options.voidInvoices && options.voidInvoices.length > 0) {
      for (const inv of options.voidInvoices) {
        if (!inv.void) continue;

        const invoice = await this.invoiceRepo.findOne({
          where: { id: inv.invoiceId, tenant_id: tenantId },
        });
        if (!invoice) continue;

        await this.invoiceRepo.update(invoice.id, {
          status: 'voided',
          voided_at: now,
          balance_due: 0,
        });
        voidedInvoices.push({ id: invoice.id, invoice_number: invoice.invoice_number });

        // Create credit memo
        const memo = this.creditMemoRepo.create({
          tenant_id: tenantId,
          original_invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          amount: invoice.total,
          reason: options.voidReason || 'Task cancelled',
          status: 'issued',
          created_by: userId,
        });
        const savedMemo = await this.creditMemoRepo.save(memo);
        creditMemos.push({ id: savedMemo.id, amount: Number(savedMemo.amount) });
      }
    }

    // 6. Rental chain cancellation
    const allDeletedJobIds = deletedTasks.map((t) => t.id);
    const chainLinks = await this.taskChainLinkRepo.find({
      where: { job_id: In(allDeletedJobIds) },
    });

    const chainIds = [...new Set(chainLinks.map((l) => l.rental_chain_id))];
    for (const chainId of chainIds) {
      await this.rentalChainRepo.update(chainId, { status: 'cancelled' });
      rentalChainsCancelled.push({ id: chainId });
    }

    return {
      deletedTasks,
      voidedInvoices,
      creditMemos,
      assetsReleased,
      rentalChainsCancelled,
    };
  }

  private async updateAssetOnJobStatus(job: Job, newStatus: string): Promise<void> {
    if (!job.asset_id) return;

    switch (newStatus) {
      case 'confirmed':
      case 'dispatched':
        await this.assetRepo.update(job.asset_id, {
          status: 'reserved',
          current_job_id: job.id,
        } as any);
        break;

      case 'en_route':
        await this.assetRepo.update(job.asset_id, {
          status: 'in_transit',
          current_job_id: job.id,
          current_location_type: 'in_transit',
        } as any);
        break;

      case 'arrived':
      case 'in_progress':
        // Still in transit / work happening, no asset status change needed
        break;

      case 'completed':
        await this.handleCompletedAsset(job);
        break;

      case 'cancelled':
      case 'failed':
        await this.assetRepo.update(job.asset_id, {
          status: 'available',
          current_job_id: null,
          current_location_type: 'yard',
        } as any);
        break;
    }
  }

  private async handleCompletedAsset(job: Job): Promise<void> {
    const jobType = job.job_type;

    if (jobType === 'delivery' || jobType === 'drop_off') {
      await this.assetRepo.update(job.asset_id, {
        status: 'on_site',
        current_job_id: job.id,
        current_location_type: 'customer_site',
      } as any);
    } else if (jobType === 'pickup' || jobType === 'removal') {
      await this.assetRepo.update(job.asset_id, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
        needs_dump: true,
      } as any);
      // Log history
      const pickupAsset = await this.assetRepo.findOne({ where: { id: job.asset_id } });
      if (pickupAsset) {
        const hist = Array.isArray(pickupAsset.operational_history) ? [...pickupAsset.operational_history] : [];
        hist.push({ event: 'picked_up', timestamp: new Date().toISOString(), job_id: job.id, details: { from: 'customer_site' } });
        if (hist.length > 50) hist.splice(0, hist.length - 50);
        await this.assetRepo.update(job.asset_id, { operational_history: hist } as any);
      }
    } else if (jobType === 'exchange') {
      // Old asset (main asset_id) returns to yard
      await this.assetRepo.update(job.asset_id, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
      } as any);
      // New asset (drop_off_asset_id) goes to customer site
      if (job.drop_off_asset_id) {
        await this.assetRepo.update(job.drop_off_asset_id, {
          status: 'on_site',
          current_job_id: job.id,
          current_location_type: 'customer_site',
        } as any);
      }
    } else if (jobType === 'dump_run' || jobType === 'dump_and_return') {
      await this.assetRepo.update(job.asset_id, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
        needs_dump: false,
        staged_at: null,
        staged_from_job_id: null,
        staged_waste_type: null,
        staged_notes: null,
      } as any);
      const dumpAsset = await this.assetRepo.findOne({ where: { id: job.asset_id } });
      if (dumpAsset) {
        const hist = Array.isArray(dumpAsset.operational_history) ? [...dumpAsset.operational_history] : [];
        hist.push({ event: 'dump_run_completed', timestamp: new Date().toISOString(), job_id: job.id, details: { now: 'ready_for_rental' } });
        if (hist.length > 50) hist.splice(0, hist.length - 50);
        await this.assetRepo.update(job.asset_id, { operational_history: hist } as any);
      }
    }
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
        await this.assetRepo.update({ id: job.asset_id, tenant_id: tenantId } as any, {
          status: 'available',
          current_job_id: null,
        } as any);
      }

      // Reserve new asset
      if (newAssetId && newAssetId !== job.asset_id) {
        await this.assetRepo.update({ id: newAssetId, tenant_id: tenantId } as any, {
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
    body: { scheduledDate: string; reason?: string; source?: string; timeWindow?: string; scheduledWindowStart?: string; scheduledWindowEnd?: string; assignedDriverId?: string },
  ): Promise<Job> {
    const job = await this.findOne(tenantId, jobId);

    if (['completed', 'cancelled'].includes(job.status)) {
      throw new BadRequestException('Cannot reschedule a completed or cancelled job');
    }

    const isFromFailure = job.status === 'needs_reschedule';

    const oldDate = job.scheduled_date;
    const updates: Record<string, unknown> = {
      scheduled_date: body.scheduledDate,
      rescheduled_from_date: oldDate,
      rescheduled_reason: body.reason || null,
    };

    // Transition out of needs_reschedule
    if (isFromFailure) {
      updates.status = 'pending';
      updates.failed_at = null;
      updates.rescheduled_at = new Date();
    }

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
    if (body.scheduledWindowStart) updates.scheduled_window_start = body.scheduledWindowStart;
    if (body.scheduledWindowEnd) updates.scheduled_window_end = body.scheduledWindowEnd;
    if (!body.scheduledWindowStart && body.timeWindow) {
      if (body.timeWindow === 'morning') { updates.scheduled_window_start = '08:00'; updates.scheduled_window_end = '12:00'; }
      else if (body.timeWindow === 'afternoon') { updates.scheduled_window_start = '12:00'; updates.scheduled_window_end = '17:00'; }
      else { updates.scheduled_window_start = '08:00'; updates.scheduled_window_end = '17:00'; }
    }

    // If assignedDriverId provided (e.g. from needs_reschedule), dispatch immediately
    if (body.assignedDriverId && isFromFailure) {
      updates.assigned_driver_id = body.assignedDriverId;
      updates.status = 'dispatched';
      updates.dispatched_at = new Date();
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
        await this.billingService.createInternalInvoice(tenantId, {
          customerId: parent.customer_id,
          jobId: jobs[jobs.length - 1].id,
          source: 'exchange',
          invoiceType: 'exchange',
          status: 'open',
          lineItems: [{ description: 'Dumpster Exchange', quantity: 1, unitPrice: exchangeFee, amount: exchangeFee }],
          notes: `Exchange scheduled from job #${parent.job_number}`,
        });
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

  private async checkRouteCompletion(tenantId: string, driverId: string, date: string): Promise<void> {
    const jobs = await this.jobsRepository.find({
      where: { tenant_id: tenantId, assigned_driver_id: driverId, scheduled_date: date },
    });
    if (jobs.length === 0) return;
    const allDone = jobs.every(j => ['completed', 'cancelled', 'failed'].includes(j.status));
    if (!allDone) return;

    const route = await this.routeRepo.findOne({
      where: { tenant_id: tenantId, driver_id: driverId, route_date: date },
    });
    if (route && route.status !== 'completed') {
      route.status = 'completed';
      route.actual_end_time = new Date();
      await this.routeRepo.save(route);
    }
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
