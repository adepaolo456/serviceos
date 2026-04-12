import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Job } from './entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { ClientPricingOverride } from '../pricing/entities/client-pricing-override.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Route } from '../dispatch/entities/route.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { BillingIssue } from '../billing/entities/billing-issue.entity';
import { CreditMemo } from '../billing/entities/credit-memo.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { BillingService } from '../billing/billing.service';
import { BillingIssueDetectorService } from '../billing/services/billing-issue-detector.service';
import {
  RentalChainsService,
  daysBetween as rentalDaysBetween,
} from '../rental-chains/rental-chains.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import { AlertService } from '../alerts/services/alert.service';
import {
  LifecycleContextResponse,
  LifecycleNode,
  LifecycleAlert,
} from './dto/lifecycle-context.dto';
import { JobPricingAudit } from './entities/job-pricing-audit.entity';
import { hasPricingRelevantChanges } from './helpers/pricing-change-detector';
import { extractCoordinates, buildAddressString } from '../../common/helpers/coordinate-validator';
import {
  BLOCKED_JOBS_WHERE_CLAUSE,
  BLOCKED_JOBS_WHERE_PARAMS,
} from '../../common/helpers/blocked-jobs-predicate';
import {
  CreateJobDto,
  UpdateJobDto,
  ListJobsQueryDto,
  ChangeStatusDto,
} from './dto/job.dto';
import { UpdateScheduledDateDto } from './dto/update-scheduled-date.dto';

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
    @InjectRepository(ClientPricingOverride)
    private clientPricingRepo: Repository<ClientPricingOverride>,
    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
    @InjectRepository(Customer)
    private customerRepo: Repository<Customer>,
    @InjectRepository(Route)
    private routeRepo: Repository<Route>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectRepository(BillingIssue)
    private billingIssueRepo: Repository<BillingIssue>,
    @InjectRepository(CreditMemo)
    private creditMemoRepo: Repository<CreditMemo>,
    @InjectRepository(RentalChain)
    private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private taskChainLinkRepo: Repository<TaskChainLink>,
    @InjectRepository(DumpTicket)
    private dumpTicketRepo: Repository<DumpTicket>,
    @InjectRepository(JobPricingAudit)
    private pricingAuditRepo: Repository<JobPricingAudit>,
    private billingService: BillingService,
    private billingIssueDetector: BillingIssueDetectorService,
    private rentalChainsService: RentalChainsService,
    private notificationsService: NotificationsService,
    private pricingService: PricingService,
    // Phase 15 — Connected Job Lifecycle panel queries the `alerts`
    // table inline via this service so the single
    // /jobs/:id/lifecycle-context endpoint returns everything the
    // panel needs in one round trip.
    private alertService: AlertService,
    // Phase 16 — updatePickupDate wraps its writes in a single
    // transaction spanning `jobs` + `rental_chains`. Injecting
    // DataSource here rather than adding one more @InjectRepository
    // so every downstream mutation path uses the same helper.
    private dataSource: DataSource,
  ) {}

  async create(tenantId: string, dto: CreateJobDto): Promise<Job> {
    // Validate that the asset (if provided) belongs to this tenant before creating the job.
    if (dto.assetId) {
      const asset = await this.assetRepo.findOne({
        where: { id: dto.assetId, tenant_id: tenantId },
      });
      if (!asset) throw new NotFoundException('Asset not found');
    }

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
        // ── Client pricing override (Pass 1 scope: base_price only) ──
        // Tenant-scoped override lookup. Other fields (rental days, overage,
        // etc.) continue to fall back to the global rule unchanged.
        if (dto.customerId) {
          const today = new Date().toISOString().split('T')[0];
          const override = await this.clientPricingRepo
            .createQueryBuilder('o')
            .where('o.tenant_id = :tenantId', { tenantId })
            .andWhere('o.customer_id = :customerId', { customerId: dto.customerId })
            .andWhere('o.pricing_rule_id = :ruleId', { ruleId: rule.id })
            .andWhere('o.effective_from <= :today', { today })
            .andWhere('(o.effective_to IS NULL OR o.effective_to >= :today)', { today })
            .getOne();
          if (override?.base_price != null) {
            basePrice = Number(override.base_price);
          }
        }
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
      await this.assetRepo.update(
        { id: savedJob.asset_id, tenant_id: tenantId } as any,
        {
          status: 'reserved',
          current_job_id: savedJob.id,
        } as any,
      );
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

    // Opt-in operational-board enrichment. Zero effect on callers that
    // don't pass ?enrichment=board. Runs three parallel lookups scoped
    // to the paged job IDs — O(N) post-fetch, no N+1.
    if (query.enrichment === 'board' && data.length > 0) {
      const enriched = await this.enrichJobsForBoard(tenantId, data);
      return {
        data: enriched,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

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

  /**
   * Full tenant-scoped list of "Blocked" jobs for the Jobs page
   * drill-down view. Uses the shared blocked predicate from
   * src/common/helpers/blocked-jobs-predicate.ts so this list and
   * AnalyticsService.getJobsSummary().blocked cannot drift.
   *
   * Blocked is a computed layer — NOT a stored job.status value. No
   * rows are mutated here, no status is persisted.
   *
   * Date range semantics: filters on `j.scheduled_date` with inclusive
   * bounds, matching the existing `findAll` behavior so the frontend
   * Jobs page gets consistent date semantics across all filter
   * branches.
   *
   * Enrichment: runs through the same `enrichJobsForBoard` pipeline
   * that `findAll({ enrichment: 'board' })` uses, so the frontend sees
   * `linked_invoice`, `open_billing_issue_count`, `chain`, and
   * `dispatch_ready` on every row — identical shape to the existing
   * `/jobs?enrichment=board` response rows.
   *
   * Multi-tenant safety: `j.tenant_id = :tenantId` is applied on the
   * outer query, and the shared predicate's EXISTS subqueries
   * additionally constrain `bi.tenant_id = j.tenant_id` and
   * `inv.tenant_id = j.tenant_id` as belt-and-suspenders.
   */
  async findBlocked(
    tenantId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<Array<Job & Record<string, unknown>>> {
    const qb = this.jobsRepository
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .leftJoinAndSelect('j.asset', 'asset')
      .leftJoinAndSelect('j.assigned_driver', 'assigned_driver')
      .where('j.tenant_id = :tenantId', { tenantId });

    if (dateFrom) {
      qb.andWhere('j.scheduled_date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('j.scheduled_date <= :dateTo', { dateTo });
    }

    qb.andWhere(BLOCKED_JOBS_WHERE_CLAUSE, BLOCKED_JOBS_WHERE_PARAMS)
      .orderBy('j.scheduled_date', 'DESC')
      .addOrderBy('j.created_at', 'DESC');

    const jobs = await qb.getMany();
    if (jobs.length === 0) return [];
    return this.enrichJobsForBoard(tenantId, jobs);
  }

  /**
   * Attach operational-board fields to each job: linked invoice status,
   * rental-chain context (prev/next link), open billing issue count,
   * and a derived dispatch_ready flag. All lookups tenant-scoped via
   * the job IDs (which are already filtered by tenant in findAll).
   */
  private async enrichJobsForBoard(
    tenantId: string,
    jobs: Job[],
  ): Promise<Array<Job & Record<string, unknown>>> {
    const jobIds = jobs.map((j) => j.id);

    const [invoices, chainLinks, billingIssues] = await Promise.all([
      this.invoiceRepo.find({
        where: { tenant_id: tenantId, job_id: In(jobIds) },
        select: ['id', 'status', 'balance_due', 'job_id'],
      }),
      this.taskChainLinkRepo.find({
        where: { job_id: In(jobIds) },
        relations: ['previous_link', 'previous_link.job', 'next_link', 'next_link.job'],
      }),
      this.billingIssueRepo.find({
        where: { tenant_id: tenantId, status: 'open', job_id: In(jobIds) },
        select: ['id', 'job_id'],
      }),
    ]);

    // Index lookups by job_id for O(1) attach
    const invoiceByJob = new Map<string, (typeof invoices)[number]>();
    for (const inv of invoices) {
      // If multiple invoices exist for the same job, prefer the first
      // one encountered — matches existing dispatch board behavior.
      if (!invoiceByJob.has(inv.job_id)) invoiceByJob.set(inv.job_id, inv);
    }

    const chainLinkByJob = new Map<string, (typeof chainLinks)[number]>();
    for (const link of chainLinks) chainLinkByJob.set(link.job_id, link);

    const billingIssueCountByJob = new Map<string, number>();
    for (const issue of billingIssues) {
      billingIssueCountByJob.set(
        issue.job_id,
        (billingIssueCountByJob.get(issue.job_id) ?? 0) + 1,
      );
    }

    return jobs.map((job) => {
      const invoice = invoiceByJob.get(job.id) ?? null;
      const link = chainLinkByJob.get(job.id) ?? null;
      const openBillingIssueCount = billingIssueCountByJob.get(job.id) ?? 0;

      // Dispatch ready = not terminal AND (no invoice OR invoice paid/partial).
      // Mirrors the visibility predicate at dispatch.service.ts:39.
      const isTerminal = ['completed', 'cancelled', 'voided'].includes(
        job.status,
      );
      const invoicePaidOrMissing =
        !invoice ||
        invoice.status === 'paid' ||
        invoice.status === 'partial' ||
        invoice.status === 'voided';
      const dispatchReady = !isTerminal && invoicePaidOrMissing;

      const chainContext = link
        ? {
            chainId: link.rental_chain_id,
            sequenceNumber: link.sequence_number,
            previousLink: link.previous_link
              ? {
                  jobId: link.previous_link.job?.id ?? link.previous_link.job_id,
                  taskType: link.previous_link.task_type,
                  scheduledDate: link.previous_link.scheduled_date,
                  assetSubtype:
                    link.previous_link.job?.asset_subtype ?? null,
                }
              : null,
            nextLink: link.next_link
              ? {
                  jobId: link.next_link.job?.id ?? link.next_link.job_id,
                  taskType: link.next_link.task_type,
                  scheduledDate: link.next_link.scheduled_date,
                  assetSubtype: link.next_link.job?.asset_subtype ?? null,
                }
              : null,
          }
        : null;

      return {
        ...job,
        linked_invoice: invoice
          ? {
              id: invoice.id,
              status: invoice.status,
              balance_due: Number(invoice.balance_due) || 0,
            }
          : null,
        chain: chainContext,
        open_billing_issue_count: openBillingIssueCount,
        dispatch_ready: dispatchReady,
      };
    });
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

    // Phase 11A-fix: attach the rental chain context (id + booked
    // dumpster size) so the job detail view can derive the
    // "required size" for asset picking without a second API call.
    // Runs for every job type — the chain is the source of truth
    // for lifecycle jobs, and standalone jobs harmlessly return null.
    const chainCtx = await this.resolveJobChainContext(tenantId, job.id);
    if (chainCtx) {
      (job as Job & {
        rental_chain_id?: string | null;
        rental_chain_dumpster_size?: string | null;
      }).rental_chain_id = chainCtx.rentalChainId;
      (job as Job & {
        rental_chain_id?: string | null;
        rental_chain_dumpster_size?: string | null;
      }).rental_chain_dumpster_size = chainCtx.dumpsterSize;
    }

    // Phase 10A: for cancelled jobs, derive replacement tasks from the
    // rental chain so the UI can show "Cancelled due to exchange
    // replacement — replaced by Exchange JOB-... + Pickup JOB-...".
    // Non-cancelled jobs are untouched. All queries are tenant-scoped
    // via the parent chain ownership check.
    if (job.status === 'cancelled') {
      const replacements = await this.deriveReplacementJobs(tenantId, job.id);
      if (replacements) {
        (job as Job & {
          replacement_jobs?: unknown;
        }).replacement_jobs = replacements.jobs;
      }
    }

    // Phase 11A: for incomplete pickup/exchange tasks, surface the
    // expected on-site asset from the rental chain so the driver app
    // can pre-populate the picker and office staff can see the hint.
    if (
      job.status !== 'completed' &&
      job.status !== 'cancelled' &&
      (job.job_type === 'pickup' ||
        job.job_type === 'removal' ||
        job.job_type === 'exchange')
    ) {
      const expected = await this.deriveExpectedOnSiteAsset(tenantId, job.id);
      if (expected) {
        (job as Job & { expected_on_site_asset?: unknown }).expected_on_site_asset = expected;
      }
    }

    return job;
  }

  /**
   * Look up the replacement tasks for a cancelled job via the rental
   * chain. Returns null when the job is not part of a chain (legacy
   * data) so the caller can fall back to "cancelled as part of
   * lifecycle update" copy. Tenant-scoped: the parent chain ownership
   * is validated before any task_chain_links are exposed.
   */
  private async deriveReplacementJobs(
    tenantId: string,
    jobId: string,
  ): Promise<{
    rentalChainId: string;
    jobs: Array<{
      job_id: string;
      job_number: string;
      job_type: string;
      task_type: string;
      scheduled_date: string;
      status: string;
    }>;
  } | null> {
    const originLink = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });
    if (!originLink) return null;

    // Validate chain tenancy before exposing any related tasks.
    const chain = await this.rentalChainRepo.findOne({
      where: { id: originLink.rental_chain_id, tenant_id: tenantId },
    });
    if (!chain) return null;

    // Replacements = same chain, sequence >= origin sequence, not
    // cancelled, not the origin link itself.
    const replacementLinks = await this.taskChainLinkRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.job', 'job')
      .where('l.rental_chain_id = :chainId', { chainId: chain.id })
      .andWhere('l.sequence_number >= :seq', {
        seq: originLink.sequence_number,
      })
      .andWhere('l.id != :originId', { originId: originLink.id })
      .andWhere('l.status != :cancelled', { cancelled: 'cancelled' })
      .orderBy('l.sequence_number', 'ASC')
      .getMany();

    const jobs = replacementLinks
      .filter((l) => l.job && l.job.tenant_id === tenantId)
      .map((l) => ({
        job_id: l.job.id,
        job_number: l.job.job_number,
        job_type: l.job.job_type,
        task_type: l.task_type,
        scheduled_date: l.scheduled_date,
        status: l.job.status,
      }));

    return { rentalChainId: chain.id, jobs };
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
    userId?: string,
    userName?: string,
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

    // Phase 11A — if the driver is passing an asset in the same
    // transition (typical flow: tap Complete → asset picker → save),
    // assign it first so the completion gate below sees the new id.
    // Runs the full correction path (tenant-scope, active-conflict
    // guard, audit, inventory sync) so a mid-flight assignment is
    // treated identically to a later office correction.
    if (dto.assetId && dto.assetId !== job.asset_id) {
      await this.assignAssetToJob(
        tenantId,
        job,
        dto.assetId,
        {
          overrideConflict: !!dto.overrideAssetConflict,
          reason: dto.assetChangeReason ?? null,
          userId: userId ?? null,
          userName: userName ?? null,
          sizeMismatch: !!dto.assetSizeMismatch,
        },
      );
    }

    // Phase 11A — asset-required gate for completion. Server-
    // authoritative: frontend validation is a UX guard, this is the
    // truth. Applies to every job type (delivery, pickup, exchange,
    // drop_off, removal, dump_run, dump_and_return).
    if (dto.status === 'completed' && !job.asset_id) {
      throw new BadRequestException(
        'asset_required: An asset must be assigned before completing this job',
      );
    }

    // Phase 11B — dump slip required for pickup/exchange completion.
    // Runs AFTER the asset gate so the error ordering matches the
    // driver UX: first pick the dumpster, then record the dump slip,
    // then mark complete. Uses the existing `dump_tickets` table
    // (no parallel model, no duplicated audit). Voided tickets do
    // NOT satisfy the gate — only an active (non-voided, non-draft)
    // submitted ticket counts.
    if (
      dto.status === 'completed' &&
      (job.job_type === 'pickup' ||
        job.job_type === 'exchange' ||
        job.job_type === 'removal')
    ) {
      const ticket = await this.dumpTicketRepo
        .createQueryBuilder('t')
        .where('t.job_id = :jobId', { jobId: job.id })
        .andWhere('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.voided_at IS NULL')
        .getOne();
      if (!ticket) {
        throw new BadRequestException(
          'dump_slip_required: A dump slip is required before completing this job',
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
              await this.billingService.voidInternalInvoice(inv.id, tenantId, 'Failed trip charge reversed — job completed successfully');
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
      const asset = await this.assetRepo.findOne({ where: { id: job.asset_id, tenant_id: tenantId } });
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
          const pickupAsset = await this.assetRepo.findOne({ where: { id: pickupJob.asset_id, tenant_id: tenantId } });
          if (pickupAsset) {
            await this.assetRepo.update(
              { id: pickupJob.asset_id, tenant_id: tenantId } as any,
              {
                status: 'available',
                current_job_id: null,
              } as any,
            );
            assetsReleased.push({ id: pickupAsset.id, identifier: pickupAsset.identifier });
          }
        }
      }
    }

    // 4. Asset release for main task
    if (job.asset_id) {
      const asset = await this.assetRepo.findOne({ where: { id: job.asset_id, tenant_id: tenantId } });
      if (asset) {
        const preDeliveryStatuses = ['pending', 'confirmed'];
        if (preDeliveryStatuses.includes(previousStatus)) {
          // Not yet delivered — release back to available
          await this.assetRepo.update(
            { id: job.asset_id, tenant_id: tenantId } as any,
            {
              status: 'available',
              current_job_id: null,
            } as any,
          );
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
      await this.rentalChainRepo.update({ id: chainId, tenant_id: tenantId }, { status: 'cancelled' });
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
    const tenant_id = job.tenant_id;

    switch (newStatus) {
      case 'confirmed':
      case 'dispatched':
        await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
          status: 'reserved',
          current_job_id: job.id,
        } as any);
        break;

      case 'en_route':
        await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
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
        await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
          status: 'available',
          current_job_id: null,
          current_location_type: 'yard',
        } as any);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 11A — asset enforcement helpers
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  // PHASE 15 — Connected Job Lifecycle (read-only)
  // ─────────────────────────────────────────────────────────

  /**
   * Returns the full rental-chain context for a job: the chain
   * summary, all sibling jobs ordered by scheduled_date ASC, and
   * active alerts (chain-level + per-job) inlined. Single
   * round-trip contract consumed by the Job Detail page's
   * Connected Job Lifecycle panel.
   *
   * Standalone jobs (not part of any rental chain) return
   * `is_standalone: true` with empty `nodes` and empty
   * `chain_alerts` so the frontend can render a registry-driven
   * empty state without a second fetch.
   *
   * Spec rules enforced here:
   *   - Ordering by `jobs.scheduled_date ASC` only (no custom
   *     sequence invention — task_chain_links.sequence_number is
   *     returned as metadata but NOT used for ordering).
   *   - ALL exchanges included in sequence; no collapsing.
   *   - Tenant-scoped via the chain ownership check.
   *   - Alert data read from the existing `alerts` table via
   *     AlertService.findActiveForEntities — no parallel detector
   *     path, no duplicate logic.
   */
  async getLifecycleContext(
    tenantId: string,
    jobId: string,
  ): Promise<LifecycleContextResponse> {
    // 1. Validate the job belongs to this tenant (404 otherwise).
    const currentJob = await this.jobsRepository.findOne({
      where: { id: jobId, tenant_id: tenantId },
      select: ['id'],
    });
    if (!currentJob) {
      throw new NotFoundException('Job not found');
    }

    // 2. Find the task_chain_link for this job. If there isn't
    // one, the job is standalone — return the empty-chain shape.
    const currentLink = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });

    if (!currentLink) {
      return {
        current_job_id: jobId,
        is_standalone: true,
        chain: null,
        nodes: [],
        chain_alerts: [],
      };
    }

    // 3. Load the chain (validates tenant ownership — otherwise
    // also treated as standalone to avoid cross-tenant leakage).
    const chain = await this.rentalChainRepo.findOne({
      where: {
        id: currentLink.rental_chain_id,
        tenant_id: tenantId,
      },
    });
    if (!chain) {
      return {
        current_job_id: jobId,
        is_standalone: true,
        chain: null,
        nodes: [],
        chain_alerts: [],
      };
    }

    // 4. Fetch every link for this chain plus the linked jobs in
    // a single round trip via join. We SELECT only the columns
    // the panel needs — the denormalized asset_subtype is picked
    // up here so the panel doesn't have to join to assets again.
    const rows = await this.jobsRepository
      .createQueryBuilder('j')
      .innerJoin(
        TaskChainLink,
        'l',
        'l.job_id = j.id AND l.rental_chain_id = :chainId',
        { chainId: chain.id },
      )
      .where('j.tenant_id = :tenantId', { tenantId })
      .select([
        'j.id',
        'j.job_number',
        'j.job_type',
        'j.status',
        'j.scheduled_date',
        'j.completed_at',
        'j.cancelled_at',
        'j.cancellation_reason',
        'j.asset_id',
        'j.asset_subtype',
      ])
      .addSelect('l.task_type', 'l_task_type')
      .addSelect('l.sequence_number', 'l_sequence_number')
      .addSelect('l.status', 'l_status')
      // Spec: order by jobs.scheduled_date ASC. Nulls sort last
      // per Postgres default — acceptable since any chain job
      // without a scheduled_date is a data-integrity issue
      // already surfaced by LIFECYCLE_INTEGRITY.
      .orderBy('j.scheduled_date', 'ASC')
      .addOrderBy('l.sequence_number', 'ASC')
      .getRawAndEntities();

    const jobIds = rows.entities.map((j) => j.id);

    // 5. Fetch alerts for the chain + every job in one query.
    const alerts = await this.alertService.findActiveForEntities(
      tenantId,
      [
        { entity_type: 'rental_chain', entity_ids: [chain.id] },
        { entity_type: 'job', entity_ids: jobIds },
      ],
    );

    // Split alerts into chain-scoped vs per-job buckets.
    const chainAlerts: LifecycleAlert[] = [];
    const jobAlertsById = new Map<string, LifecycleAlert[]>();
    for (const a of alerts) {
      const mapped: LifecycleAlert = {
        id: a.id,
        alert_type: a.alert_type,
        severity: a.severity as 'high' | 'medium' | 'low',
        message: a.message,
        metadata: a.metadata ?? {},
      };
      if (a.entity_type === 'rental_chain') {
        chainAlerts.push(mapped);
      } else if (a.entity_type === 'job') {
        const list = jobAlertsById.get(a.entity_id) ?? [];
        list.push(mapped);
        jobAlertsById.set(a.entity_id, list);
      }
    }

    // 6. Assemble nodes. Zip the raw rows with the entities so we
    // can read the task_chain_link columns (not part of Job).
    const nodes: LifecycleNode[] = rows.entities.map((job, idx) => {
      const raw = rows.raw[idx];
      return {
        job_id: job.id,
        job_number: job.job_number,
        job_type: job.job_type,
        task_type: raw?.l_task_type ?? '',
        sequence_number: Number(raw?.l_sequence_number ?? 0),
        status: job.status,
        scheduled_date: job.scheduled_date ?? null,
        completed_at: job.completed_at
          ? new Date(job.completed_at).toISOString()
          : null,
        cancelled_at: job.cancelled_at
          ? new Date(job.cancelled_at).toISOString()
          : null,
        cancellation_reason: job.cancellation_reason ?? null,
        link_status: raw?.l_status ?? 'scheduled',
        asset_id: job.asset_id ?? null,
        asset_subtype: job.asset_subtype ?? null,
        is_current: job.id === jobId,
        alerts: jobAlertsById.get(job.id) ?? [],
      };
    });

    return {
      current_job_id: jobId,
      is_standalone: false,
      chain: {
        id: chain.id,
        status: chain.status,
        drop_off_date: chain.drop_off_date ?? null,
        expected_pickup_date: chain.expected_pickup_date ?? null,
        actual_pickup_date: chain.actual_pickup_date ?? null,
        dumpster_size: chain.dumpster_size ?? null,
        rental_days: chain.rental_days ?? null,
      },
      nodes,
      chain_alerts: chainAlerts,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 16.1 — scheduled-date edit (consolidated mutation)
  // ─────────────────────────────────────────────────────────

  /**
   * Update the scheduled date on an active delivery, pickup, or
   * exchange job and keep the parent rental chain in sync.
   * Single consolidated endpoint that replaces Phase 16's
   * pickup-only `updatePickupDate`.
   *
   * Common fields written for ALL three job types (the
   * reschedule audit trio encodes the "Manual Override" state
   * on existing fields):
   *
   *   jobs.scheduled_date            ← new date
   *   jobs.rescheduled_from_date     ← previous scheduled_date
   *   jobs.rescheduled_at            ← NOW()
   *   jobs.rescheduled_reason        ← "operator_override_lifecycle_panel"
   *   jobs.rescheduled_by_customer   ← false (operator, not customer)
   *
   * Per-type extras:
   *
   *   delivery  → + jobs.rental_days
   *             + rental_chains.drop_off_date
   *             + rental_chains.rental_days
   *             (new chain duration = daysBetween(new,
   *              chain.expected_pickup_date))
   *
   *   pickup    → + jobs.rental_days
   *             + rental_chains.expected_pickup_date
   *             + rental_chains.rental_days
   *             (new chain duration = daysBetween(
   *              chain.drop_off_date, new))
   *
   *   exchange  → job-only write. No chain mutation, no
   *             rental_days recalc.
   *
   * All chain-level duration math uses the exported
   * `daysBetween` helper from RentalChainsService so the job
   * row and chain row never disagree.
   *
   * Never runs pricing, touches invoices, or modifies
   * jobs.rental_start_date / rental_end_date — those describe
   * booking state and are out of scope.
   *
   * Validation error codes (all thrown as BadRequestException
   * with a registry feature key — the modal resolves them via
   * getFeatureLabel so copy lives in one place):
   *
   *   edit_job_date_error_invalid           (malformed body)
   *   edit_job_date_error_past_date         (new < today, all types)
   *   edit_job_date_error_before_drop_off   (new <= drop_off, pickup/exchange)
   *   edit_job_date_error_after_pickup      (new >= expected_pickup, delivery/exchange)
   *   edit_job_date_error_after_exchange    (delivery shifted past an existing exchange)
   *   edit_job_date_error_invalid_job_type  (not delivery/pickup/exchange)
   *   edit_job_date_error_cancelled         (job already cancelled)
   *
   * RBAC enforced at the controller layer via `@Roles('dispatcher')`.
   */
  async updateScheduledDate(
    tenantId: string,
    jobId: string,
    dto: UpdateScheduledDateDto,
    _userId: string,
  ): Promise<{ job: Job; chain: RentalChain | null }> {
    // 1. Format + basic input validation. We expect YYYY-MM-DD.
    const newDate = dto.scheduled_date;
    if (
      !newDate ||
      typeof newDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(newDate)
    ) {
      throw new BadRequestException('edit_job_date_error_invalid');
    }

    // 2. Tenant-scoped job load.
    const job = await this.jobsRepository.findOne({
      where: { id: jobId, tenant_id: tenantId },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // 3. Job-type + status preconditions shared across branches.
    const EDITABLE_TYPES = new Set(['delivery', 'pickup', 'exchange']);
    if (!EDITABLE_TYPES.has(job.job_type)) {
      throw new BadRequestException('edit_job_date_error_invalid_job_type');
    }
    if (job.cancelled_at) {
      throw new BadRequestException('edit_job_date_error_cancelled');
    }

    // 4. Common date floor — every branch enforces `new >= today`.
    const today = new Date().toISOString().split('T')[0];
    if (newDate < today) {
      throw new BadRequestException('edit_job_date_error_past_date');
    }

    // 5. Chain resolution via task_chain_links. Every editable
    // job is expected to be part of a chain (the panel only
    // renders the edit action on chain nodes). If we somehow
    // reach here for a standalone job, 404.
    const link = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });
    if (!link) {
      throw new NotFoundException('Rental chain not found for this job');
    }
    const chain = await this.rentalChainRepo.findOne({
      where: { id: link.rental_chain_id, tenant_id: tenantId },
    });
    if (!chain) {
      throw new NotFoundException('Rental chain not found');
    }

    // 6. Per-type validation + write plan.
    const previousScheduledDate = job.scheduled_date;
    let newChainRentalDays: number | null = null;

    if (job.job_type === 'delivery') {
      // Delivery: new date must land strictly BEFORE the chain's
      // expected pickup date.
      if (
        !chain.expected_pickup_date ||
        newDate >= chain.expected_pickup_date
      ) {
        throw new BadRequestException('edit_job_date_error_after_pickup');
      }

      // Delivery: reject any shift that would put an existing
      // exchange on or before the new delivery date. The panel's
      // lifecycle-context already shows exchanges grouped by
      // date, but we re-query here to avoid trusting client state
      // for a write.
      const chainExchangeJobs = await this.jobsRepository
        .createQueryBuilder('j')
        .innerJoin(
          TaskChainLink,
          'l',
          'l.job_id = j.id AND l.rental_chain_id = :chainId',
          { chainId: chain.id },
        )
        .where('j.tenant_id = :tenantId', { tenantId })
        .andWhere('j.job_type = :t', { t: 'exchange' })
        .andWhere('j.cancelled_at IS NULL')
        .andWhere('l.status != :cancelled', { cancelled: 'cancelled' })
        .select(['j.id', 'j.scheduled_date'])
        .getMany();
      for (const ex of chainExchangeJobs) {
        if (ex.scheduled_date && ex.scheduled_date <= newDate) {
          throw new BadRequestException(
            'edit_job_date_error_after_exchange',
          );
        }
      }

      newChainRentalDays = rentalDaysBetween(
        newDate,
        chain.expected_pickup_date,
      );
    } else if (job.job_type === 'pickup') {
      // Pickup: new date must land strictly AFTER the drop-off
      // date — same rule as Phase 16. Zero-day rentals not allowed.
      if (!chain.drop_off_date || newDate <= chain.drop_off_date) {
        throw new BadRequestException('edit_job_date_error_before_drop_off');
      }
      newChainRentalDays = rentalDaysBetween(chain.drop_off_date, newDate);
    } else {
      // Exchange: must fall strictly inside the drop_off → pickup
      // window. No rental_days recalc — the window stays fixed.
      if (!chain.drop_off_date || newDate <= chain.drop_off_date) {
        throw new BadRequestException('edit_job_date_error_before_drop_off');
      }
      if (
        !chain.expected_pickup_date ||
        newDate >= chain.expected_pickup_date
      ) {
        throw new BadRequestException('edit_job_date_error_after_pickup');
      }
      // Do NOT enforce ordering between multiple exchanges
      // (spec: "low-value complexity").
    }

    // 7. Single transaction — always writes the reschedule trio
    // on the job. Delivery + pickup additionally write the chain
    // row and mirror rental_days onto the job. Exchange is
    // job-only.
    await this.dataSource.transaction(async (manager) => {
      const jobUpdate: Partial<Job> = {
        scheduled_date: newDate,
        rescheduled_from_date: previousScheduledDate,
        rescheduled_at: new Date(),
        rescheduled_reason: 'operator_override_lifecycle_panel',
        rescheduled_by_customer: false,
      };

      if (job.job_type === 'delivery' || job.job_type === 'pickup') {
        jobUpdate.rental_days = newChainRentalDays as number;
      }

      await manager.update(
        Job,
        { id: jobId, tenant_id: tenantId },
        jobUpdate,
      );

      if (job.job_type === 'delivery') {
        await manager.update(
          RentalChain,
          { id: chain.id, tenant_id: tenantId },
          {
            drop_off_date: newDate,
            rental_days: newChainRentalDays as number,
          },
        );
      } else if (job.job_type === 'pickup') {
        await manager.update(
          RentalChain,
          { id: chain.id, tenant_id: tenantId },
          {
            expected_pickup_date: newDate,
            rental_days: newChainRentalDays as number,
          },
        );
      }
      // Exchange: no chain write.
    });

    // 8. Reload fresh state for the response. Exchange edits
    // still re-return the unchanged chain so the caller has a
    // consistent shape.
    const updatedJob = await this.jobsRepository.findOne({
      where: { id: jobId, tenant_id: tenantId },
    });
    const updatedChain = await this.rentalChainRepo.findOne({
      where: { id: chain.id, tenant_id: tenantId },
    });
    if (!updatedJob) {
      throw new NotFoundException('Updated job not found');
    }
    return { job: updatedJob, chain: updatedChain };
  }

  /**
   * Resolve a job's rental chain context (id + booked dumpster size).
   * Tenant-scoped via the chain ownership check; returns null for
   * standalone jobs that aren't part of any chain. The dumpster size
   * on the chain is the source of truth for "required size" on the
   * job detail asset picker.
   */
  private async resolveJobChainContext(
    tenantId: string,
    jobId: string,
  ): Promise<{ rentalChainId: string; dumpsterSize: string | null } | null> {
    const link = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });
    if (!link) return null;
    const chain = await this.rentalChainRepo.findOne({
      where: { id: link.rental_chain_id, tenant_id: tenantId },
    });
    if (!chain) return null;
    return {
      rentalChainId: chain.id,
      dumpsterSize: chain.dumpster_size ?? null,
    };
  }

  /**
   * Find any other active (non-completed, non-cancelled) job on the
   * same tenant that already has this asset assigned. Used by the
   * active-assignment guard (Step 7B).
   */
  async findActiveAssignmentConflict(
    tenantId: string,
    assetId: string,
    excludeJobId: string,
  ): Promise<{
    id: string;
    job_number: string;
    job_type: string;
    status: string;
    scheduled_date: string;
  } | null> {
    const conflict = await this.jobsRepository
      .createQueryBuilder('j')
      .select([
        'j.id',
        'j.job_number',
        'j.job_type',
        'j.status',
        'j.scheduled_date',
      ])
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.asset_id = :assetId', { assetId })
      .andWhere('j.id != :excludeId', { excludeId: excludeJobId })
      .andWhere('j.status NOT IN (:...terminal)', {
        terminal: ['completed', 'cancelled', 'failed'],
      })
      .orderBy('j.scheduled_date', 'ASC')
      .limit(1)
      .getOne();
    if (!conflict) return null;
    return {
      id: conflict.id,
      job_number: conflict.job_number,
      job_type: conflict.job_type,
      status: conflict.status,
      scheduled_date: conflict.scheduled_date,
    };
  }

  /**
   * Core asset assignment/correction path. Validates tenant scoping
   * on the new asset, runs the active-assignment conflict guard,
   * mutates `jobs.asset_id`, appends an audit entry to
   * `asset_change_history`, and — when the job is already completed —
   * re-runs the inventory sync for both the old and new assets so
   * yard/customer location state mirrors the correction.
   *
   * Called from two paths:
   *  - `changeStatus` when the driver passes `assetId` in the same
   *    transition (confirmation on arrival/completion)
   *  - `changeAsset` office correction endpoint
   */
  private async assignAssetToJob(
    tenantId: string,
    job: Job,
    newAssetId: string,
    opts: {
      overrideConflict: boolean;
      reason: string | null;
      userId: string | null;
      userName: string | null;
      sizeMismatch?: boolean;
    },
  ): Promise<Job> {
    // Tenant-scoped asset load
    const asset = await this.assetRepo.findOne({
      where: { id: newAssetId, tenant_id: tenantId },
    });
    if (!asset) {
      throw new BadRequestException(
        'asset_not_found: Asset does not exist in this tenant',
      );
    }

    // Active-assignment conflict guard (Step 7B)
    const conflict = await this.findActiveAssignmentConflict(
      tenantId,
      newAssetId,
      job.id,
    );
    if (conflict && !opts.overrideConflict) {
      throw new BadRequestException(
        `asset_active_conflict: Asset is already assigned to active job ${conflict.job_number} (${conflict.job_type}, ${conflict.scheduled_date}). Pass overrideAssetConflict=true to override.`,
      );
    }

    const previousAssetId = job.asset_id ?? null;

    // Mutate + audit (jsonb array append)
    job.asset_id = newAssetId;
    const history = Array.isArray(job.asset_change_history)
      ? [...job.asset_change_history]
      : [];
    history.push({
      previous_asset_id: previousAssetId,
      new_asset_id: newAssetId,
      changed_by: opts.userId,
      changed_by_name: opts.userName,
      changed_at: new Date().toISOString(),
      reason: opts.reason,
      ...(conflict ? { override_conflict: true } : {}),
      ...(opts.sizeMismatch ? { size_mismatch: true } : {}),
    });
    // Cap at 100 entries so the column can never explode
    if (history.length > 100) history.splice(0, history.length - 100);
    job.asset_change_history = history;

    return job;
  }

  /**
   * Office-side asset correction (`PATCH /jobs/:id/asset`). Applies
   * the new asset via `assignAssetToJob` and — when the job is
   * already completed — reverts the old asset's inventory state
   * (available / yard) and re-runs `handleCompletedAsset` to move the
   * new asset into the correct state for the job's type.
   */
  async changeAsset(
    tenantId: string,
    jobId: string,
    dto: {
      assetId: string;
      overrideAssetConflict?: boolean;
      reason?: string;
      sizeMismatch?: boolean;
    },
    userId: string | null,
    userName: string | null,
  ): Promise<Job> {
    const job = await this.findOne(tenantId, jobId);
    const previousAssetId = job.asset_id ?? null;
    const wasCompleted = job.status === 'completed';

    await this.assignAssetToJob(tenantId, job, dto.assetId, {
      overrideConflict: !!dto.overrideAssetConflict,
      reason: dto.reason ?? null,
      userId,
      userName,
      sizeMismatch: !!dto.sizeMismatch,
    });

    const saved = await this.jobsRepository.save(job);

    // If the job was completed, revert the previous asset's state and
    // reapply the new asset's state so the yard/customer location
    // books match the correction.
    if (wasCompleted) {
      if (previousAssetId) {
        await this.assetRepo.update(
          { id: previousAssetId, tenant_id: tenantId } as any,
          {
            status: 'available',
            current_job_id: null,
            current_location_type: 'yard',
          } as any,
        );
      }
      await this.handleCompletedAsset(saved);
    }

    return saved;
  }

  /**
   * Derive the asset the driver should expect to find on-site for a
   * pickup or exchange task. Walks the rental chain and returns the
   * asset from the most recently COMPLETED delivery or exchange.
   * Cancelled and future-scheduled jobs are intentionally excluded
   * because they do not represent physical reality. Returns null for
   * standalone jobs or chains with no completed prior task.
   */
  async deriveExpectedOnSiteAsset(
    tenantId: string,
    jobId: string,
  ): Promise<{
    asset_id: string;
    identifier: string;
    subtype: string | null;
    source_job_id: string;
    source_job_number: string;
    source_task_type: string;
  } | null> {
    // Look up the job's chain link
    const link = await this.taskChainLinkRepo.findOne({
      where: { job_id: jobId },
    });
    if (!link) return null;

    // Tenant-scope the chain
    const chain = await this.rentalChainRepo.findOne({
      where: { id: link.rental_chain_id, tenant_id: tenantId },
    });
    if (!chain) return null;

    // Walk earlier links in the same chain looking for a completed
    // delivery or exchange with an asset. Sorted DESC so the most
    // recent wins.
    const priorLinks = await this.taskChainLinkRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.job', 'job')
      .leftJoinAndSelect('job.asset', 'asset')
      .where('l.rental_chain_id = :chainId', { chainId: chain.id })
      .andWhere('l.sequence_number < :seq', { seq: link.sequence_number })
      .andWhere('l.task_type IN (:...types)', {
        types: ['drop_off', 'exchange'],
      })
      .andWhere('l.status != :cancelled', { cancelled: 'cancelled' })
      .orderBy('l.sequence_number', 'DESC')
      .getMany();

    for (const l of priorLinks) {
      const j = l.job;
      if (!j || j.tenant_id !== tenantId) continue;
      if (j.status !== 'completed') continue;
      if (!j.asset_id || !j.asset) continue;
      return {
        asset_id: j.asset_id,
        identifier: j.asset.identifier,
        subtype: j.asset.subtype ?? null,
        source_job_id: j.id,
        source_job_number: j.job_number,
        source_task_type: l.task_type,
      };
    }
    return null;
  }

  private async handleCompletedAsset(job: Job): Promise<void> {
    const jobType = job.job_type;
    const tenant_id = job.tenant_id;

    if (jobType === 'delivery' || jobType === 'drop_off') {
      await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
        status: 'on_site',
        current_job_id: job.id,
        current_location_type: 'customer_site',
      } as any);
    } else if (jobType === 'pickup' || jobType === 'removal') {
      await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
        needs_dump: true,
      } as any);
      // Log history
      const pickupAsset = await this.assetRepo.findOne({ where: { id: job.asset_id, tenant_id } });
      if (pickupAsset) {
        const hist = Array.isArray(pickupAsset.operational_history) ? [...pickupAsset.operational_history] : [];
        hist.push({ event: 'picked_up', timestamp: new Date().toISOString(), job_id: job.id, details: { from: 'customer_site' } });
        if (hist.length > 50) hist.splice(0, hist.length - 50);
        await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, { operational_history: hist } as any);
      }
    } else if (jobType === 'exchange') {
      // Old asset (main asset_id) returns to yard
      await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
      } as any);
      // New asset (drop_off_asset_id) goes to customer site
      if (job.drop_off_asset_id) {
        await this.assetRepo.update({ id: job.drop_off_asset_id, tenant_id } as any, {
          status: 'on_site',
          current_job_id: job.id,
          current_location_type: 'customer_site',
        } as any);
      }
    } else if (jobType === 'dump_run' || jobType === 'dump_and_return') {
      await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, {
        status: 'available',
        current_job_id: null,
        current_location_type: 'yard',
        needs_dump: false,
        staged_at: null,
        staged_from_job_id: null,
        staged_waste_type: null,
        staged_notes: null,
      } as any);
      const dumpAsset = await this.assetRepo.findOne({ where: { id: job.asset_id, tenant_id } });
      if (dumpAsset) {
        const hist = Array.isArray(dumpAsset.operational_history) ? [...dumpAsset.operational_history] : [];
        hist.push({ event: 'dump_run_completed', timestamp: new Date().toISOString(), job_id: job.id, details: { now: 'ready_for_rental' } });
        if (hist.length > 50) hist.splice(0, hist.length - 50);
        await this.assetRepo.update({ id: job.asset_id, tenant_id } as any, { operational_history: hist } as any);
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

  /**
   * Phase 5 — lightweight notes update for dispatch credit override
   * audit trail. Only updates the specified notes fields without
   * triggering any side effects.
   */
  async updateNotes(
    tenantId: string,
    id: string,
    notes: { dispatch_notes?: string; placement_notes?: string },
  ): Promise<void> {
    await this.jobsRepository.update(
      { id, tenant_id: tenantId },
      notes,
    );
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

  /**
   * Find active on-site dumpsters for a customer, optionally filtered by site address.
   * "Active onsite" = rental chain is active, no actual pickup date, and the delivery
   * job's service_address matches when an address filter is provided.
   */
  async getActiveOnsite(
    tenantId: string,
    customerId: string,
    address?: { street: string; city: string; state: string; zip?: string },
  ) {
    if (!customerId) {
      return { hasActiveOnsite: false, dumpsters: [] };
    }

    // Query active rental chains with their delivery jobs
    const rows: Array<{
      chain_id: string;
      asset_id: string | null;
      dumpster_size: string;
      drop_off_date: string;
      chain_status: string;
      job_id: string | null;
      job_service_address: Record<string, any> | null;
      asset_identifier: string | null;
    }> = await this.jobsRepository.manager.query(
      `SELECT
         rc.id            AS chain_id,
         rc.asset_id      AS asset_id,
         rc.dumpster_size AS dumpster_size,
         rc.drop_off_date AS drop_off_date,
         rc.status        AS chain_status,
         dj.id            AS job_id,
         dj.service_address AS job_service_address,
         a.identifier     AS asset_identifier
       FROM rental_chains rc
       LEFT JOIN task_chain_links tcl
         ON tcl.rental_chain_id = rc.id AND tcl.task_type = 'drop_off'
       LEFT JOIN jobs dj
         ON dj.id = tcl.job_id
       LEFT JOIN assets a
         ON a.id = rc.asset_id
       WHERE rc.tenant_id = $1
         AND rc.customer_id = $2
         AND rc.status = 'active'
         AND rc.actual_pickup_date IS NULL`,
      [tenantId, customerId],
    );

    let filtered = rows;

    // Component-level address matching: each component must match individually
    if (address) {
      const norm = (s: string | undefined | null) =>
        (s || '')
          .toLowerCase()
          .replace(/[.,#\-]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const qStreet = norm(address.street);
      const qCity = norm(address.city);
      const qState = norm(address.state);
      const qZip = norm(address.zip);

      filtered = rows.filter((r) => {
        if (!r.job_service_address) return false;
        const sa = r.job_service_address;

        // Street: normalize and compare (starts-with for abbreviation tolerance, e.g. "St" vs "Street")
        const sStreet = norm(sa.street);
        const streetMatch =
          sStreet === qStreet ||
          sStreet.startsWith(qStreet) ||
          qStreet.startsWith(sStreet);

        // City: exact normalized match (critical — prevents "Boston" vs "Brockton")
        const cityMatch = norm(sa.city) === qCity;

        // State: exact normalized match
        const stateMatch = norm(sa.state) === qState;

        // Zip: match if both present
        const sZip = norm(sa.zip);
        const zipMatch = !qZip || !sZip || sZip === qZip;

        return streetMatch && cityMatch && stateMatch && zipMatch;
      });
    }

    const dumpsters = filtered.map((r) => ({
      jobId: r.job_id,
      assetId: r.asset_id,
      size: r.dumpster_size,
      deliveredAt: r.drop_off_date,
      address: r.job_service_address
        ? [
            r.job_service_address.street,
            r.job_service_address.city,
            r.job_service_address.state,
            r.job_service_address.zip,
          ]
            .filter(Boolean)
            .join(', ')
        : null,
      rentalChainId: r.chain_id,
      assetIdentifier: r.asset_identifier,
    }));

    return { hasActiveOnsite: dumpsters.length > 0, dumpsters };
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
        await this.jobsRepository.update({ id: pickupJob.id, tenant_id: tenantId }, { scheduled_date: updates.rental_end_date as string });
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
    await this.jobsRepository.update({ id: parentJobId, tenant_id: tenantId }, { linked_job_ids: linkedIds });

    return { jobs, parentJobId };
  }

  /**
   * Create an exchange job directly from a rental chain, without requiring a parent delivery job.
   * Used for standalone/legacy rentals where chain links may not have a completed delivery job.
   */
  async exchangeFromRental(
    tenantId: string,
    body: { rentalChainId: string; scheduledDate: string; timeWindow?: string; newAssetSubtype?: string; exchangeFee?: number },
  ) {
    const chain = await this.rentalChainRepo.findOne({
      where: { id: body.rentalChainId, tenant_id: tenantId },
      relations: ['customer'],
    });
    if (!chain) {
      throw new NotFoundException(`Rental chain ${body.rentalChainId} not found`);
    }

    // Try to find the most recent job in this chain to get service_address
    const chainLink = await this.taskChainLinkRepo.findOne({
      where: { rental_chain_id: chain.id },
      relations: ['job'],
      order: { sequence_number: 'DESC' },
    });

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;

    let windowStart = '08:00', windowEnd = '17:00';
    if (body.timeWindow === 'morning') { windowStart = '08:00'; windowEnd = '12:00'; }
    else if (body.timeWindow === 'afternoon') { windowStart = '12:00'; windowEnd = '17:00'; }

    const exchangeJob = this.jobsRepository.create({
      tenant_id: tenantId,
      customer_id: chain.customer_id,
      job_number: `JOB-${dateStr}-${seq}`,
      job_type: 'exchange',
      service_type: 'dumpster_rental',
      asset_subtype: body.newAssetSubtype || chain.dumpster_size,
      asset_id: chain.asset_id || null,
      service_address: chainLink?.job?.service_address || null,
      status: 'pending',
      priority: 'normal',
      source: 'exchange_from_rental',
      scheduled_date: body.scheduledDate,
      scheduled_window_start: windowStart,
      scheduled_window_end: windowEnd,
    } as Partial<Job> as Job);
    const savedJob = await this.jobsRepository.save(exchangeJob);

    // Create exchange invoice
    const exchangeFee = Number(body.exchangeFee || 0);
    if (exchangeFee > 0) {
      await this.billingService.createInternalInvoice(tenantId, {
        customerId: chain.customer_id,
        jobId: savedJob.id,
        source: 'exchange',
        invoiceType: 'exchange',
        status: 'open',
        lineItems: [{ description: 'Dumpster Exchange', quantity: 1, unitPrice: exchangeFee, amount: exchangeFee }],
        notes: `Exchange scheduled for rental chain ${chain.id}`,
      });
    }

    // No chain link update needed — the rental chain was used only as source of truth
    // for customer/address/asset. handleTypeChange operates on existing chain links,
    // but this job was created outside the chain link system.

    return { jobs: [savedJob], rentalChainId: chain.id };
  }

  async stageAtYard(tenantId: string, jobId: string, body: { wasteType?: string; notes?: string }) {
    const job = await this.findOne(tenantId, jobId);

    await this.jobsRepository.update({ id: jobId, tenant_id: tenantId }, { dump_disposition: 'staged' });

    if (job.asset_id) {
      await this.assetRepo.update({ id: job.asset_id, tenant_id: tenantId } as any, {
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

  async updateAssetStatus(assetId: string, tenantId: string, status: string): Promise<void> {
    await this.assetRepo.update({ id: assetId, tenant_id: tenantId } as any, { status, current_job_id: null } as any);
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
      await this.assetRepo.update({ id: assetId, tenant_id: tenantId } as any, { current_job_id: saved.id } as any);
    }

    return saved;
  }
}
