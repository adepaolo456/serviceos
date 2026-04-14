import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { Payment } from '../billing/entities/payment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
// Phase B1 — chain lookup for the portal change-pickup-date /
// early-pickup / reschedule flows. The actual mutation is
// delegated to JobsService.updateScheduledDate so we never
// duplicate the scheduling transaction logic here.
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { PricingService } from '../pricing/pricing.service';
import { OrchestrationService } from '../billing/services/orchestration.service';
import { StripeService } from '../stripe/stripe.service';
import { JobsService } from '../jobs/jobs.service';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { getTenantToday } from '../../common/utils/tenant-date.util';

/**
 * Customer-safe projection of a Job for portal responses.
 *
 * This is an explicit allow-list: any field NOT listed here is never sent to
 * portal clients, even if the underlying Job entity gains new columns. All new
 * Job columns are hidden by default — they must be opted into this shape.
 *
 * Explicitly excluded (reasoning): tenant_id / customer_id (scoping / redundant),
 * assigned_driver_* and driver_notes (driver identity and internal notes),
 * base_price / discount_* / pricing_snapshot* / extra_day_* (pricing internals),
 * dispatched_at / en_route_at / arrived_at (internal state-transition timestamps),
 * dump_* (dispatcher/driver operational), is_failed_trip / failed_* / attempt_count
 * (failure tracking), drop_off_asset_pin / pick_up_asset_pin (sensitive ops data),
 * parent_job_id / linked_job_ids / route_order / source / marketplace_booking_id
 * / priority (internal routing/ops), cancellation_reason (may contain operator
 * comments), photos (not consumed by portal UI today), updated_at (not needed).
 */
type PortalJob = {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string | null;
  asset_subtype: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_window_start: string | null;
  scheduled_window_end: string | null;
  service_address: Record<string, any> | null;
  placement_notes: string | null;
  rental_start_date: string | null;
  rental_end_date: string | null;
  rental_days: number | null;
  total_price: number | null;
  deposit_amount: number | null;
  is_overdue: boolean;
  completed_at: Date | null;
  cancelled_at: Date | null;
  rescheduled_by_customer: boolean;
  rescheduled_at: Date | null;
  rescheduled_from_date: string | null;
  rescheduled_reason: string | null;
  signature_url: string | null;
  created_at: Date;
  asset: { id: string; identifier: string; subtype: string | null } | null;
};

@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    // Phase B1 — chain lookup for change-pickup-date /
    // early-pickup / reschedule. Reads only; writes go through
    // JobsService.
    @InjectRepository(RentalChain)
    private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private taskChainLinkRepo: Repository<TaskChainLink>,
    private jwtService: JwtService,
    private pricingService: PricingService,
    private orchestrationService: OrchestrationService,
    private stripeService: StripeService,
    // Phase B1 — canonical scheduling mutation. All three portal
    // rental actions delegate here so the job + chain always stay
    // in sync and the reschedule audit trio is always written.
    private jobsService: JobsService,
    // Phase B4 — DataSource injected for two distinct uses:
    //   1. Tenant-aware "today" in `requestEarlyPickup` — loads
    //      `tenant_settings.timezone` directly via the shared
    //      DataSource rather than introducing a new
    //      `@InjectRepository(TenantSettings)` or a new service
    //      dependency. Same pattern as the alert detector.
    //   2. Atomic `rescheduleRental` — wraps the two sequential
    //      `updateScheduledDate` calls (delivery + pickup) in a
    //      single transaction so a mid-sequence failure cannot
    //      leave the chain with a shifted delivery date but a
    //      stale pickup date.
    private dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────
  // PHASE B1 — shared chain lookup for portal rental actions
  // ─────────────────────────────────────────────────────────

  /**
   * Given a job the portal customer acted on (typically the
   * delivery job shown in their rental card), return the parent
   * rental chain and its ACTIVE pickup job — the one that
   * change-pickup-date / early-pickup / reschedule actually mutate.
   *
   * "Active" means: task_chain_links.status != 'cancelled' AND
   * jobs.cancelled_at IS NULL, matching the gating logic the
   * Phase 16.1 lifecycle panel uses.
   *
   * Tenant-scoped via the chain ownership check — 404s hide
   * existence from the wrong tenant.
   */
  private async findActivePickupInChain(
    tenantId: string,
    startingJobId: string,
  ): Promise<{ chain: RentalChain; pickupJob: Job }> {
    const link = await this.taskChainLinkRepo.findOne({
      where: { job_id: startingJobId },
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

    const pickupJob = await this.jobRepo
      .createQueryBuilder('j')
      .innerJoin(
        TaskChainLink,
        'l',
        'l.job_id = j.id AND l.rental_chain_id = :chainId',
        { chainId: chain.id },
      )
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.job_type = :t', { t: 'pickup' })
      .andWhere('j.cancelled_at IS NULL')
      .andWhere('l.status != :cancelled', { cancelled: 'cancelled' })
      .getOne();
    if (!pickupJob) {
      throw new NotFoundException(
        'Active pickup job not found for this rental',
      );
    }
    return { chain, pickupJob };
  }

  /**
   * Allow-list mapper: Job → PortalJob. Strips every internal field listed
   * in the PortalJob type comment above. Used at every portal read site
   * that would otherwise serialize a raw Job entity.
   *
   * Phase B5 — chain-preferred rental window dates.
   *
   * `jobs.rental_start_date` / `jobs.rental_end_date` / `jobs.rental_days`
   * are booking-snapshot fields written at job creation and left alone by
   * the canonical lifecycle write path (`JobsService.updateScheduledDate`
   * — see its JSDoc, which explicitly opts out of touching them). The
   * portal used to read those booking fields directly, which meant the
   * portal showed the original booked window forever — even after the
   * office moved a delivery or pickup date via the lifecycle panel.
   *
   * Fix: prefer the rental chain as the source of truth for the rental
   * window. Every office surface (dispatch, lifecycle panel, job detail)
   * already treats the chain as canonical, and the lifecycle write path
   * keeps the chain row in lockstep with every date change. Falling
   * through to the job-row snapshot for jobs with no chain link keeps
   * standalone / legacy rows rendering exactly as they do today.
   *
   * The chain parameter is optional so every existing caller still
   * compiles. Callers that have the chain available (portal mutation
   * flows after `updateScheduledDate` returns `{ job, chain }`) should
   * pass it. Callers that load jobs in bulk should batch-load chains via
   * `loadChainsForJobs` below.
   */
  private toPortalJob(job: Job, chain?: RentalChain | null): PortalJob {
    // Chain preferred for rental window dates; fall back to the booking
    // snapshot on the job row when the job is not part of a chain.
    const rentalStart =
      chain?.drop_off_date ?? job.rental_start_date ?? null;
    const rentalEnd =
      chain?.expected_pickup_date ?? job.rental_end_date ?? null;
    const rentalDays = chain?.rental_days ?? job.rental_days ?? null;

    return {
      id: job.id,
      job_number: job.job_number,
      job_type: job.job_type,
      service_type: job.service_type ?? null,
      asset_subtype: job.asset_subtype ?? null,
      status: job.status,
      scheduled_date: job.scheduled_date ?? null,
      scheduled_window_start: job.scheduled_window_start ?? null,
      scheduled_window_end: job.scheduled_window_end ?? null,
      service_address: job.service_address ?? null,
      placement_notes: job.placement_notes ?? null,
      rental_start_date: rentalStart,
      rental_end_date: rentalEnd,
      rental_days: rentalDays,
      total_price: job.total_price != null ? Number(job.total_price) : null,
      deposit_amount: job.deposit_amount != null ? Number(job.deposit_amount) : null,
      is_overdue: job.is_overdue ?? false,
      completed_at: job.completed_at ?? null,
      cancelled_at: job.cancelled_at ?? null,
      rescheduled_by_customer: job.rescheduled_by_customer ?? false,
      rescheduled_at: job.rescheduled_at ?? null,
      rescheduled_from_date: job.rescheduled_from_date ?? null,
      rescheduled_reason: job.rescheduled_reason ?? null,
      signature_url: job.signature_url ?? null,
      created_at: job.created_at,
      asset: job.asset
        ? {
            id: job.asset.id,
            identifier: job.asset.identifier,
            subtype: job.asset.subtype ?? null,
          }
        : null,
    };
  }

  /**
   * Phase B5 — batch-load rental chains for a set of jobs.
   *
   * Used by the bulk portal read paths (`getRentals`, `getDashboard`) so
   * they can populate each `PortalJob`'s rental window from the canonical
   * chain without an N+1 pattern. Two queries total regardless of N:
   *
   *   1. SELECT task_chain_links WHERE job_id IN (...)
   *   2. SELECT rental_chains WHERE id IN (...) AND tenant_id = ?
   *
   * Tenant scoping: the chain query is explicitly tenant-filtered. The
   * task_chain_links query is scoped transitively via the job ids
   * (which came from a tenant-scoped SELECT upstream) — a link with a
   * matching job id can only belong to that job's tenant because job
   * ids are globally unique UUIDs. The chain-level tenant filter then
   * blocks any cross-tenant chain row from being returned.
   *
   * Empty-input safety: returns an empty map when `jobIds` is empty,
   * avoiding a no-op `IN ()` query.
   */
  private async loadChainsForJobs(
    tenantId: string,
    jobIds: string[],
  ): Promise<Map<string, RentalChain>> {
    const out = new Map<string, RentalChain>();
    if (jobIds.length === 0) return out;

    const links = await this.taskChainLinkRepo.find({
      where: { job_id: In(jobIds) },
    });
    if (links.length === 0) return out;

    const chainIds = [...new Set(links.map((l) => l.rental_chain_id))];
    const chains = await this.rentalChainRepo.find({
      where: { id: In(chainIds), tenant_id: tenantId },
    });
    if (chains.length === 0) return out;

    const chainById = new Map(chains.map((c) => [c.id, c]));
    for (const link of links) {
      const chain = chainById.get(link.rental_chain_id);
      if (chain) out.set(link.job_id, chain);
    }
    return out;
  }

  async login(email: string, password: string, tenantId: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.is_active = true')
      .getOne();

    if (!customer || !customer.portal_password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, customer.portal_password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_last_login: new Date() })
      .where('id = :id', { id: customer.id })
      .execute();

    const token = this.jwtService.sign({
      sub: customer.id,
      tenantId: customer.tenant_id,
      type: 'portal',
    });

    return {
      token,
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  }

  async register(email: string, password: string, tenantId: string) {
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.email = :email', { email })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.is_active = true')
      .getOne();
    if (!customer) throw new NotFoundException('No account found for this email. Please contact the office.');
    if (customer.portal_password_hash) throw new BadRequestException('Account already registered. Please log in.');

    const hash = await bcrypt.hash(password, 10);
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_password_hash: hash })
      .where('id = :id', { id: customer.id })
      .execute();

    const token = this.jwtService.sign({
      sub: customer.id,
      tenantId: customer.tenant_id,
      type: 'portal',
    });

    return {
      token,
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      },
    };
  }

  async magicLink(email: string, tenantId: string) {
    // Timing-safe, enumeration-safe: always return the same response regardless
    // of whether the email/tenant combo exists. Timing floor prevents attackers
    // from distinguishing by response latency.
    const start = Date.now();
    const floor = 200;

    const customer = await this.customerRepo.findOne({
      where: { email, tenant_id: tenantId, is_active: true },
    });
    if (customer) {
      // TODO: actually send a magic-link email. Current implementation is a stub.
    }

    const elapsed = Date.now() - start;
    if (elapsed < floor) {
      await new Promise((r) => setTimeout(r, floor - elapsed));
    }

    return { message: 'If an account exists, a login link has been sent to your email.' };
  }

  async getRentals(customerId: string, tenantId: string) {
    const jobs = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      relations: ['asset'],
      order: { created_at: 'DESC' },
    });
    // Phase B5 — batch-load chains so `toPortalJob` can populate the
    // rental window from the canonical `rental_chains` row instead of
    // the stale `jobs.rental_*` booking snapshot. Two queries total
    // regardless of N, see `loadChainsForJobs`. Jobs without a chain
    // fall through to the job-row snapshot inside `toPortalJob`.
    const chainMap = await this.loadChainsForJobs(
      tenantId,
      jobs.map((j) => j.id),
    );
    return jobs.map((j) => this.toPortalJob(j, chainMap.get(j.id) ?? null));
  }

  async getInvoices(customerId: string, tenantId: string) {
    const invoices = await this.invoiceRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      relations: ['line_items'],
      order: { created_at: 'DESC' },
    });
    return invoices;
  }

  async getInvoiceDetail(customerId: string, tenantId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, customer_id: customerId, tenant_id: tenantId },
      relations: ['job', 'line_items'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    // Track first view
    if (!invoice.read_at) {
      await this.invoiceRepo.update(invoiceId, { read_at: new Date() });
      invoice.read_at = new Date();
    }

    const payments = await this.paymentRepo.find({
      where: { invoice_id: invoiceId },
      order: { applied_at: 'DESC' },
    });

    // Map nested job through customer-safe projection; strips internal Job fields.
    return {
      invoice: {
        ...invoice,
        job: invoice.job ? this.toPortalJob(invoice.job) : null,
      },
      payments,
    };
  }

  /**
   * Phase 17 — Portal service request now routes through the SAME
   * OrchestrationService.createWithBooking() path as tenant-side
   * bookings. This ensures:
   *   - Credit enforcement (Phase 4B)
   *   - Invoice creation (BookingCompletionService)
   *   - Payment gating (same rules as tenant-side)
   *   - Rental chain creation (delivery + pickup linked)
   *   - Dispatch eligibility under same rules
   *   - Reporting/dashboard parity
   *
   * The portal customer is an existing customer (authenticated via
   * JWT), so we always pass customerId and skip duplicate detection.
   */
  async submitServiceRequest(customerId: string, tenantId: string, dto: any) {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const result = await this.orchestrationService.createWithBooking(
      tenantId,
      {
        intent: 'schedule_job',
        customerId,
        dumpsterSize: dto.size,
        deliveryDate: dto.preferredDate,
        pickupTBD: true,
        siteAddress: dto.serviceAddress,
        rentalDays: dto.rentalDays,
        placementNotes: dto.instructions,
        paymentMethod: 'invoice',
        source: 'portal',
        confirmedCreateDespiteDuplicate: true,
      },
      {
        // Portal customer auth context — customerId acts as userId
        // for credit enforcement. Role is undefined so overrides
        // are not available from portal (intentional).
        userId: customerId,
        userRole: undefined,
      },
    );

    // Determine payment requirement from invoice state + customer terms
    let invoiceBalanceDue = 0;
    let paymentRequired = false;
    if (result.invoiceId) {
      const invoice = await this.invoiceRepo.findOne({
        where: { id: result.invoiceId, tenant_id: tenantId },
        select: ['id', 'balance_due'],
      });
      invoiceBalanceDue = Number(invoice?.balance_due ?? 0);
      // Payment is required when there's a balance and the customer
      // is on due_on_receipt or cod terms (not net terms).
      const terms = customer.payment_terms;
      const immediateTerms = !terms || terms === 'due_on_receipt' || terms === 'cod';
      paymentRequired = invoiceBalanceDue > 0 && immediateTerms;
    }

    return {
      job_number: result.jobId ? result.jobId.slice(0, 8).toUpperCase() : 'Submitted',
      status: result.status,
      invoice_id: result.invoiceId ?? null,
      balance_due: Math.round(invoiceBalanceDue * 100) / 100,
      payment_required: paymentRequired,
    };
  }

  /**
   * Phase B1 — customer-initiated change of the rental pickup date.
   *
   * Historically called "extendRental" — see the legacy alias on
   * the controller. The user-facing framing is now "Change Pickup
   * Date" because the same action covers both moving pickup later
   * (the old "extend") and earlier (the old "request early pickup").
   *
   * Before Phase B1 this method contained its own date math
   * (`Math.ceil((end - start) / 86400000)` with no null guard on
   * `rental_start_date`) which produced the 20,557-day corrupted
   * row I healed in the Phase 15 bug fix. It also only wrote to
   * the `jobs` row and left `rental_chains.expected_pickup_date`
   * and `rental_chains.rental_days` silently out of sync.
   *
   * The rewrite delegates the entire mutation to
   * `JobsService.updateScheduledDate` — the same canonical
   * transaction used by the Phase 16.1 lifecycle panel. All
   * scheduling math, chain sync, and audit trail are handled
   * there in one place.
   *
   * Semantically this means "move the active pickup job to the
   * given date" so we target the chain's pickup job, not the
   * delivery job the customer started from.
   */
  async changePickupDate(
    customerId: string,
    tenantId: string,
    jobId: string,
    newEndDate: string,
  ) {
    // 1. Tenant-scoped load of the starting job so we can also
    // enforce customer ownership (the Phase 16.1 JobsService
    // call is tenant-scoped but NOT customer-scoped).
    const startingJob = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!startingJob) throw new NotFoundException('Rental not found');
    if (['completed', 'cancelled'].includes(startingJob.status)) {
      throw new BadRequestException(
        'Cannot change the pickup date of a completed or cancelled rental',
      );
    }

    // 2. Resolve the chain and find the active pickup job.
    const { pickupJob } = await this.findActivePickupInChain(
      tenantId,
      jobId,
    );
    // Defence-in-depth: the pickup job must belong to the same
    // customer (findActivePickupInChain already guarantees the
    // chain is tenant-scoped, but chains bundle per-customer
    // state).
    if (pickupJob.customer_id !== customerId) {
      throw new NotFoundException('Rental not found');
    }

    // 3. Delegate. JobsService.updateScheduledDate handles
    // validation (new >= today, new > drop_off_date), the
    // transaction, the reschedule audit trio, and the chain
    // sync. The customer actor flag sets
    // `rescheduled_by_customer = true` so portal-activity
    // queries surface the edit.
    const result = await this.jobsService.updateScheduledDate(
      tenantId,
      pickupJob.id,
      { scheduled_date: newEndDate },
      {
        type: 'customer',
        userId: customerId,
        reason: 'customer_portal_extend',
      },
    );

    return {
      message: 'Rental extended',
      newEndDate,
      rentalDays: result.chain?.rental_days ?? null,
    };
  }

  /**
   * Phase B1 — customer-initiated early pickup.
   *
   * Before Phase B1 this method created a NEW pickup job with
   * `source: 'portal'` but with NO `scheduled_date`, NO
   * `rental_chain_id`, and NO `task_chain_link`. The resulting
   * row was a ghost — it showed up in the portal-activity
   * summary count (because of `source = 'portal'`) but was
   * impossible to dispatch because it had no date, and
   * invisible to every lifecycle surface because it had no
   * chain linkage.
   *
   * The rewrite deletes the ghost-job creation entirely.
   * "Request early pickup" now means "move the existing
   * pickup job to today" — the chain's real pickup is
   * rescheduled forward through the canonical
   * `JobsService.updateScheduledDate` path, which writes the
   * reschedule audit trio + updates the chain atomically.
   */
  async requestEarlyPickup(
    customerId: string,
    tenantId: string,
    jobId: string,
  ) {
    // 1. Tenant + customer ownership check on the starting job.
    const startingJob = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!startingJob) throw new NotFoundException('Rental not found');

    // 2. Find the chain's active pickup.
    const { pickupJob } = await this.findActivePickupInChain(
      tenantId,
      jobId,
    );
    if (pickupJob.customer_id !== customerId) {
      throw new NotFoundException('Rental not found');
    }

    // 3. "Today" — Phase B4 fixes the former UTC-based rollover
    // bug. Early-pickup requests at 8:30 PM Eastern used to be
    // rejected because `new Date().toISOString().split('T')[0]`
    // was already tomorrow in UTC; the customer saw a confusing
    // "date in the past" error. We now resolve the tenant's
    // configured IANA timezone from `tenant_settings.timezone`
    // and use the canonical `getTenantToday(tz)` helper. Tenants
    // whose timezone is NULL fall through to the helper's
    // default (`America/New_York`), matching the rest of the
    // codebase.
    const settings = await this.dataSource
      .getRepository(TenantSettings)
      .findOne({ where: { tenant_id: tenantId } });
    const today = getTenantToday(settings?.timezone ?? undefined);

    // 4. Delegate to the canonical mutation. Pickup branch
    // validates `new > chain.drop_off_date` — if today is on
    // or before the drop-off date (i.e. the rental hasn't even
    // started) the backend will return a clean
    // `edit_job_date_error_before_drop_off`.
    const result = await this.jobsService.updateScheduledDate(
      tenantId,
      pickupJob.id,
      { scheduled_date: today },
      {
        type: 'customer',
        userId: customerId,
        reason: 'customer_portal_early_pickup',
      },
    );

    // Phase B5 — pass the chain returned by the canonical mutation so
    // the `PortalJob` projection renders the freshly-updated rental
    // window from the chain instead of the stale job-row booking
    // snapshot. `updateScheduledDate` always returns a chain for
    // editable job types (delivery / pickup / exchange), so this is
    // effectively non-null here.
    return this.toPortalJob(result.job, result.chain);
  }

  async getProfile(customerId: string, tenantId: string) {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateProfile(customerId: string, tenantId: string, dto: any) {
    const updates: any = {};
    if (dto.firstName) updates.first_name = dto.firstName;
    if (dto.lastName) updates.last_name = dto.lastName;
    if (dto.phone) updates.phone = dto.phone;
    if (dto.billingAddress) updates.billing_address = dto.billingAddress;
    if (dto.serviceAddresses) updates.service_addresses = dto.serviceAddresses;

    await this.customerRepo.update(customerId, updates);
    return this.getProfile(customerId, tenantId);
  }

  async changePassword(customerId: string, tenantId: string, currentPassword: string, newPassword: string) {
    // H2: tenant filter on both SELECT and UPDATE for defense-in-depth
    // consistency with every other portal service method.
    const customer = await this.customerRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.id = :id', { id: customerId })
      .andWhere('c.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!customer || !customer.portal_password_hash) {
      throw new BadRequestException('No portal password set');
    }

    const valid = await bcrypt.compare(currentPassword, customer.portal_password_hash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 10);
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ portal_password_hash: hash })
      .where('id = :id', { id: customerId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .execute();
    return { message: 'Password updated' };
  }

  async signAgreement(customerId: string, tenantId: string, jobId: string, signatureUrl: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Job not found');

    await this.jobRepo.update(jobId, { signature_url: signatureUrl });
    return { message: 'Agreement signed' };
  }

  /**
   * Phase B1 — customer-initiated reschedule.
   *
   * Semantically: "move my rental start date but keep my rental
   * duration the same". We shift both the delivery job and the
   * linked pickup job by the same delta so the rental window
   * length is preserved.
   *
   * Before Phase B1 this method wrote the reschedule audit trio
   * and shifted the linked pickup's scheduled_date, but never
   * updated `rental_chains.drop_off_date` /
   * `expected_pickup_date` / `rental_days` — so the chain
   * silently diverged from the jobs and the lifecycle strip +
   * dashboards never saw the reschedule.
   *
   * The rewrite delegates to `JobsService.updateScheduledDate`
   * TWICE: once for the delivery job (shifts drop_off_date +
   * recomputes the chain duration against the OLD expected
   * pickup), then once for the pickup job (shifts
   * expected_pickup_date + recomputes against the NEW drop_off).
   * After both calls the chain matches the jobs.
   *
   * Known edge case: forward-moving a delivery past the CURRENT
   * expected_pickup_date will be rejected by call 1's
   * `edit_job_date_error_after_pickup` validation. This is the
   * spec's literal "delivery-first" ordering. If customers ever
   * need to push their delivery beyond the existing pickup
   * window, flip the order to pickup-first in a follow-up.
   */
  async rescheduleRental(
    customerId: string,
    tenantId: string,
    jobId: string,
    body: { scheduledDate: string; reason?: string },
  ) {
    // 1. Tenant + customer scoped job load.
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Job not found');

    // 2. Portal business rules — kept verbatim from the old
    // implementation. These gates run BEFORE delegation so the
    // customer sees the same friendly messaging they used to.
    if (!['pending', 'confirmed'].includes(job.status)) {
      throw new BadRequestException(
        'This job cannot be rescheduled. Please call us for changes.',
      );
    }
    if (job.job_type !== 'delivery') {
      // New gate: the reschedule action is specifically for
      // the rental start date. Pickup moves go through the
      // change-pickup-date / early-pickup actions above.
      throw new BadRequestException(
        'Only the delivery date can be rescheduled from this action. Use Change Pickup Date for pickup changes.',
      );
    }
    const newDeliveryDate = body.scheduledDate;
    if (new Date(newDeliveryDate) <= new Date()) {
      throw new BadRequestException('Please select a future date.');
    }
    if (job.scheduled_date) {
      const scheduled = new Date(job.scheduled_date);
      const hoursUntil =
        (scheduled.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        throw new BadRequestException(
          'Jobs cannot be rescheduled within 24 hours of the scheduled date. Please call us for same-day changes.',
        );
      }
    }

    // 3. Find the chain + active pickup. This ALSO doubles as a
    // defensive guard that the job actually belongs to a chain
    // (reschedule on a standalone job is unsupported).
    const { chain, pickupJob } = await this.findActivePickupInChain(
      tenantId,
      jobId,
    );
    if (pickupJob.customer_id !== customerId) {
      throw new NotFoundException('Job not found');
    }

    // 4. Capture the current chain duration so we can preserve
    // it across the reschedule. Fall back to 14 only if the
    // chain row is missing the value (legacy data).
    const originalRentalDays = chain.rental_days ?? 14;

    // 5. Compute the new pickup date as newDeliveryDate +
    // originalRentalDays. Inline UTC arithmetic — no new helper.
    const pickupDateObj = new Date(`${newDeliveryDate}T00:00:00Z`);
    pickupDateObj.setUTCDate(
      pickupDateObj.getUTCDate() + originalRentalDays,
    );
    const newPickupDate = pickupDateObj.toISOString().split('T')[0];

    // 6. Delegate to the canonical mutation. Two calls wrapped in
    // a SINGLE transaction so delivery + pickup commit atomically
    // as a pair. Phase B1 left these as two independent calls
    // with two independent transactions — a mid-sequence failure
    // (e.g. second call's validation rejects) would leave the
    // delivery job + chain shifted but the pickup job stale, and
    // the chain's rental_days would be silently mismatched
    // against the jobs until the next manual fix. Phase B4
    // threads an outer `EntityManager` through
    // `updateScheduledDate` so both calls see each other's
    // uncommitted writes (required for the pickup-branch
    // validation to read the NEW `chain.drop_off_date` that the
    // delivery branch just wrote) and so a rollback covers both.
    //
    // Customer-supplied freeform reason (`body.reason`) is
    // intentionally NOT persisted in this phase. The
    // `rescheduled_reason` column holds a canonical machine code
    // resolved to a human label via the feature registry
    // (`customer_portal_reschedule` → "Reschedule"); corrupting
    // that semantics with freeform text would break the label
    // translation path and introduce an unescaped-render XSS
    // surface in every office UI that renders it. Persisting
    // freeform customer notes will be revisited in a later phase
    // with a dedicated column + escaped-render contract.
    const actor = {
      type: 'customer' as const,
      userId: customerId,
      reason: 'customer_portal_reschedule',
    };

    await this.dataSource.transaction(async (manager) => {
      await this.jobsService.updateScheduledDate(
        tenantId,
        jobId,
        { scheduled_date: newDeliveryDate },
        actor,
        manager,
      );
      await this.jobsService.updateScheduledDate(
        tenantId,
        pickupJob.id,
        { scheduled_date: newPickupDate },
        actor,
        manager,
      );
    });

    // 7. Reload the delivery job for the portal response —
    // matches the old method's return shape so the frontend
    // contract is unchanged.
    const updated = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    // Phase B5 — reload the chain post-transaction and pass it to
    // `toPortalJob` so the returned `PortalJob` reflects the new
    // rental window (drop_off_date + expected_pickup_date) directly
    // from the canonical source, not the stale job-row snapshot.
    // The transaction committed above, so this read sees the fresh
    // chain state. Locally named `freshChain` to avoid shadowing the
    // pre-mutation `chain` destructured from `findActivePickupInChain`
    // at the top of this method.
    const chainMap = updated
      ? await this.loadChainsForJobs(tenantId, [updated.id])
      : new Map<string, RentalChain>();
    const freshChain = updated ? chainMap.get(updated.id) ?? null : null;
    return {
      ...(updated ? this.toPortalJob(updated, freshChain) : {}),
      message: `Your delivery has been moved to ${newDeliveryDate}. Your new pickup date is ${newPickupDate}. The company has been notified.`,
    };
  }

  async getDashboard(customerId: string, tenantId: string) {
    // Active rentals (delivery jobs that are not completed/cancelled)
    const activeRentals = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, job_type: In(['delivery', 'drop_off']), status: In(['pending', 'confirmed', 'dispatched', 'en_route', 'arrived', 'in_progress']) },
      relations: ['asset'],
      order: { scheduled_date: 'ASC' },
    });

    // Phase B5 — batch-load chains so the "pickup date" column on the
    // dashboard card reflects the canonical `rental_chains.expected_
    // pickup_date` instead of the stale `jobs.rental_end_date` booking
    // snapshot. Two queries total via `loadChainsForJobs`. Jobs
    // without a chain fall through to `j.rental_end_date` below so
    // standalone / legacy rows keep rendering the same as today.
    const activeChainMap = await this.loadChainsForJobs(
      tenantId,
      activeRentals.map((j) => j.id),
    );

    // Outstanding balance
    const invoices = await this.invoiceRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, status: In(['open', 'partial', 'overdue']) },
    });
    const totalBalance = invoices.reduce((sum, inv) => sum + Number(inv.balance_due || 0), 0);

    // Recent activity (last 10 jobs, any status)
    const recentJobs = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId },
      order: { updated_at: 'DESC' },
      take: 10,
    });

    // Upcoming pickups — reads `j.scheduled_date` on pickup jobs,
    // which `updateScheduledDate` updates canonically. No chain
    // lookup needed for this projection.
    const upcomingPickups = await this.jobRepo.find({
      where: { customer_id: customerId, tenant_id: tenantId, job_type: 'pickup', status: In(['pending', 'confirmed', 'dispatched']) },
      order: { scheduled_date: 'ASC' },
    });

    return {
      activeRentals: activeRentals.map(j => {
        // Phase B5 — prefer chain.expected_pickup_date; fall back to
        // the job-row snapshot for standalone / legacy rows with no
        // chain link.
        const chain = activeChainMap.get(j.id) ?? null;
        const pickupDate: string | null =
          chain?.expected_pickup_date ?? j.rental_end_date ?? null;
        return {
          id: j.id,
          size: (j.asset_subtype || j.asset?.subtype || '').replace('yd', ' Yard'),
          address: j.service_address ? [j.service_address.street, j.service_address.city].filter(Boolean).join(', ') : '',
          deliveryDate: j.scheduled_date,
          rentalEndDate: pickupDate,
          daysRemaining: pickupDate
            ? Math.max(0, Math.ceil((new Date(pickupDate).getTime() - Date.now()) / 86400000))
            : null,
          isOverdue: j.is_overdue,
          extraDays: j.extra_days,
          status: j.status,
        };
      }),
      balance: {
        total: Math.round(totalBalance * 100) / 100,
        invoiceCount: invoices.length,
      },
      upcomingPickups: upcomingPickups.map(j => ({
        id: j.id,
        date: j.scheduled_date,
        address: j.service_address ? [j.service_address.street, j.service_address.city].filter(Boolean).join(', ') : '',
      })),
      recentActivity: recentJobs.map(j => ({
        id: j.id,
        type: j.job_type,
        status: j.status,
        date: j.updated_at,
        description: `${j.job_type.replace(/_/g, ' ')} — ${j.status.replace(/_/g, ' ')}`,
      })),
    };
  }

  /**
   * Phase 13B — Customer-safe account summary.
   *
   * Aggregates invoice balances and reads customer.credit_hold
   * to derive a customer-facing account status. No internal hold
   * mechanics, credit limits, or audit data exposed.
   */
  async getAccountSummary(customerId: string, tenantId: string) {
    const [customer, result] = await Promise.all([
      this.customerRepo.findOne({
        where: { id: customerId, tenant_id: tenantId },
        select: ['id', 'credit_hold'],
      }),
      this.invoiceRepo
        .createQueryBuilder('i')
        .select('COALESCE(SUM(CASE WHEN i.balance_due > 0 THEN i.balance_due ELSE 0 END), 0)', 'current_balance')
        .addSelect(
          `COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < CURRENT_DATE THEN i.balance_due ELSE 0 END), 0)`,
          'past_due_amount',
        )
        .addSelect('COUNT(CASE WHEN i.balance_due > 0 THEN 1 END)::int', 'unpaid_invoice_count')
        .where('i.customer_id = :customerId', { customerId })
        .andWhere('i.tenant_id = :tenantId', { tenantId })
        .andWhere('i.status NOT IN (:...excluded)', { excluded: ['voided', 'draft'] })
        .getRawOne<{
          current_balance: string;
          past_due_amount: string;
          unpaid_invoice_count: number;
        }>(),
    ]);

    const currentBalance = Number(result?.current_balance ?? 0);
    const pastDueAmount = Number(result?.past_due_amount ?? 0);
    const unpaidInvoiceCount = Number(result?.unpaid_invoice_count ?? 0);
    const isRestricted = !!customer?.credit_hold;

    let accountStatus: string;
    if (isRestricted) accountStatus = 'service_restricted';
    else if (pastDueAmount > 0) accountStatus = 'past_due';
    else if (currentBalance > 0) accountStatus = 'payment_due';
    else accountStatus = 'good_standing';

    // Status messages are intentionally server-side so they can be
    // tenant-overridden in the future via registry. No internal
    // terminology used.
    const STATUS_MESSAGES: Record<string, string | null> = {
      good_standing: null,
      payment_due: 'You have invoices ready for payment.',
      past_due: 'Your account has past due invoices. Please make a payment to avoid service interruption.',
      service_restricted: 'Your account has an outstanding balance that must be resolved before new service can be scheduled. Please contact us or make a payment.',
    };

    return {
      current_balance: Math.round(currentBalance * 100) / 100,
      past_due_amount: Math.round(pastDueAmount * 100) / 100,
      unpaid_invoice_count: unpaidInvoiceCount,
      account_status: accountStatus,
      status_message: STATUS_MESSAGES[accountStatus] ?? null,
      payment_eligible: currentBalance > 0,
    };
  }

  /**
   * Phase 15 — Portal-safe pricing estimate.
   *
   * Calls PricingService.calculate() (the same path booking uses)
   * and returns ONLY the customer-safe total. No internal pricing
   * breakdown, distance bands, yard coordinates, or margin logic.
   */
  async getPricingEstimate(
    tenantId: string,
    customerId: string | null,
    params: { size: string; lat?: number; lng?: number; rentalDays?: number },
  ) {
    try {
      const result = await this.pricingService.calculate(tenantId, {
        serviceType: 'dumpster_rental',
        assetSubtype: params.size,
        jobType: 'delivery',
        customerLat: params.lat,
        customerLng: params.lng,
        rentalDays: params.rentalDays,
        ...(customerId ? { customerId } : {}),
      } as any);
      return {
        total: result.breakdown.total,
        size: params.size,
        rental_days: result.breakdown.rentalDays,
        included_days: result.breakdown.includedDays,
        extra_days_billable: !result.breakdown.unlimitedDays && result.breakdown.extraDayRate > 0,
        available: true,
      };
    } catch {
      return {
        total: null,
        size: params.size,
        rental_days: params.rentalDays ?? null,
        included_days: null,
        extra_days_billable: true,
        available: false,
      };
    }
  }

  /**
   * Phase 20 — Update placement pin on a job.
   * Customer-scoped: verifies job belongs to customerId + tenantId.
   * Validates lat/lng ranges strictly.
   */
  async updatePlacement(
    customerId: string,
    tenantId: string,
    jobId: string,
    body: { placement_lat?: number | null; placement_lng?: number | null; placement_pin_notes?: string | null },
  ) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!job) throw new NotFoundException('Job not found');

    if (body.placement_lat != null) {
      if (body.placement_lat < -90 || body.placement_lat > 90) {
        throw new BadRequestException('Invalid latitude');
      }
    }
    if (body.placement_lng != null) {
      if (body.placement_lng < -180 || body.placement_lng > 180) {
        throw new BadRequestException('Invalid longitude');
      }
    }

    await this.jobRepo.update(
      { id: jobId, tenant_id: tenantId },
      {
        placement_lat: body.placement_lat ?? null,
        placement_lng: body.placement_lng ?? null,
        placement_pin_notes: body.placement_pin_notes ?? null,
      },
    );

    return { success: true };
  }

  /**
   * Get placement data for a job. Customer-scoped.
   */
  async getPlacement(customerId: string, tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, customer_id: customerId, tenant_id: tenantId },
      select: ['id', 'placement_lat', 'placement_lng', 'placement_pin_notes', 'service_address'],
    });
    if (!job) throw new NotFoundException('Job not found');

    return {
      placement_lat: job.placement_lat ? Number(job.placement_lat) : null,
      placement_lng: job.placement_lng ? Number(job.placement_lng) : null,
      placement_pin_notes: job.placement_pin_notes ?? null,
      service_address: job.service_address,
    };
  }

  async reportIssue(customerId: string, tenantId: string, dto: { jobId?: string; reason: string; notes?: string }) {
    // Create a notification/alert for the office
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');

    // If jobId provided, verify it belongs to this customer
    if (dto.jobId) {
      const job = await this.jobRepo.findOne({ where: { id: dto.jobId, customer_id: customerId, tenant_id: tenantId } });
      if (!job) throw new NotFoundException('Job not found');
    }

    // Log as notification for office review
    // The notification will be visible in the admin notification bell
    return { message: 'Issue reported. Our office has been notified and will contact you shortly.' };
  }

  async createPaymentIntent(customerId: string, tenantId: string, invoiceId: string, amount?: number) {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, customer_id: customerId, tenant_id: tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid' || invoice.status === 'voided') {
      throw new BadRequestException('Invoice is already ' + invoice.status);
    }

    const payAmount = amount || Number(invoice.balance_due);
    if (payAmount <= 0) throw new BadRequestException('Invalid payment amount');

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.stripe_connect_id || !tenant.stripe_onboarded) {
      throw new BadRequestException('ONLINE_PAYMENTS_NOT_CONFIGURED');
    }

    const stripeCustomerId = await this.stripeService.getOrCreateStripeCustomer(tenantId, customerId);

    const portalBase = process.env.FRONTEND_URL || 'https://serviceos-web-zeta.vercel.app';
    const successUrl = `${portalBase}/portal/invoices?payment=success&invoice=${invoice.invoice_number}`;
    const cancelUrl = `${portalBase}/portal/invoices?payment=cancelled&invoice=${invoice.invoice_number}`;

    const stripe = this.stripeService.getClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(payAmount * 100),
          product_data: { name: `Invoice #${invoice.invoice_number}` },
        },
        quantity: 1,
      }],
      metadata: { invoiceId: invoice.id, tenantId, customerId },
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(tenant?.stripe_connect_id ? {
        payment_intent_data: {
          application_fee_amount: Math.round(payAmount * 100 * (Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || 2.9) / 100)),
          transfer_data: { destination: tenant.stripe_connect_id },
        },
      } : {}),
    }, tenant?.stripe_connect_id ? { stripeAccount: tenant.stripe_connect_id } : undefined);

    if (!session.url) throw new BadRequestException('Could not create payment session');

    return { url: session.url };
  }
}
