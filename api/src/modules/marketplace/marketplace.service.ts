import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { MarketplaceBooking } from './entities/marketplace-booking.entity';
import { MarketplaceIntegration } from './entities/marketplace-integration.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from '../pricing/pricing.service';
import { JobsService } from '../jobs/jobs.service';
import {
  CreateMarketplaceBookingDto,
  ListMarketplaceBookingsQueryDto,
  RejectBookingDto,
} from './dto/marketplace.dto';

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(MarketplaceBooking)
    private bookingsRepository: Repository<MarketplaceBooking>,
    @InjectRepository(MarketplaceIntegration)
    private integrationsRepository: Repository<MarketplaceIntegration>,
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Asset)
    private assetsRepository: Repository<Asset>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    private pricingService: PricingService,
    private jobsService: JobsService,
    private dataSource: DataSource,
  ) {}

  // Looks up a marketplace integration by its public key id. The controller
  // uses the returned row's signing_secret to verify the HMAC and the
  // tenant_id to scope the booking — never trusting the request body for
  // either value. 404 means the key id is unknown to this system; 403 means
  // the tenant has paused the integration. Both distinctions are intentional
  // so the caller can tell "wrong key" from "right key, off right now".
  async resolveIntegration(
    keyId: string,
    source = 'rentthis',
  ): Promise<MarketplaceIntegration> {
    const integration = await this.integrationsRepository.findOne({
      where: { source, key_id: keyId },
    });
    if (!integration) {
      throw new NotFoundException('Unknown marketplace integration key');
    }
    if (!integration.enabled) {
      throw new ForbiddenException('Marketplace integration is disabled');
    }
    return integration;
  }

  /**
   * Gate for public-facing marketplace reads (availability/pricing).
   * Returns 404 (not 403) regardless of whether the tenant doesn't exist,
   * has no integration, or has a disabled integration — to avoid leaking
   * enumeration signal about which tenants are on the marketplace.
   * Same response shape in all three cases by design.
   */
  private async resolveIntegrationByTenant(
    tenantId: string,
    source = 'rentthis',
  ): Promise<void> {
    const integration = await this.integrationsRepository.findOne({
      where: { tenant_id: tenantId, source, enabled: true },
    });
    if (!integration) {
      throw new NotFoundException('Marketplace data not available for this tenant');
    }
  }

  async createBooking(tenantId: string, dto: CreateMarketplaceBookingDto) {
    // Tenant-scoped existence check. The compound unique index on
    // (tenant_id, marketplace_booking_id) also enforces this at the DB layer,
    // but we check first so we can return a clean 409 instead of a raw
    // unique-violation.
    const existing = await this.bookingsRepository.findOne({
      where: {
        tenant_id: tenantId,
        marketplace_booking_id: dto.marketplaceBookingId,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Booking ${dto.marketplaceBookingId} already exists for this tenant`,
      );
    }

    // Fail closed if the resolved tenant is no longer active. The integration
    // can be enabled while its parent tenant is paused — we do not want to
    // accept new bookings in that window.
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId, is_active: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found or inactive');
    }

    const fee = dto.marketplaceFee ?? 0;
    const netPrice = Math.round((dto.quotedPrice - fee) * 100) / 100;

    const booking = this.bookingsRepository.create({
      tenant_id: tenantId,
      marketplace_booking_id: dto.marketplaceBookingId,
      listing_type: dto.listingType,
      asset_subtype: dto.assetSubtype,
      customer_name: dto.customerName,
      customer_email: dto.customerEmail,
      customer_phone: dto.customerPhone,
      service_address: dto.serviceAddress,
      requested_date: dto.requestedDate,
      rental_days: dto.rentalDays ?? 7,
      special_instructions: dto.specialInstructions,
      quoted_price: dto.quotedPrice,
      marketplace_fee: fee,
      net_price: netPrice,
    });

    return this.bookingsRepository.save(booking);
  }

  async findAll(tenantId: string, query: ListMarketplaceBookingsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.bookingsRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.job', 'job')
      .where('b.tenant_id = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('b.status = :status', { status: query.status });
    }

    qb.orderBy('b.created_at', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async accept(tenantId: string, id: string) {
    // Pre-TX validation. Fail fast on the two state-shape checks before
    // opening a transaction so the common "wrong status" / "not found"
    // path doesn't pay for a TX open/abort. Mirrors the pre-TX pattern
    // used by JobsService.create (Fix C) and BillingService.
    // createInternalInvoice (Fix A).
    const preBooking = await this.bookingsRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!preBooking) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
    if (preBooking.status !== 'pending') {
      throw new BadRequestException(`Booking is already "${preBooking.status}"`);
    }

    // SSoT handoff. Every write below — customer create, JobsService.
    // create's whole body, and the booking projection — runs inside one
    // transaction. A throw at any step (including inside JobsService.
    // create) rolls back every preceding write as a unit. Pre-refactor
    // each call ran on the default datasource and a mid-flow throw
    // could leave behind an orphan customer, an orphan job, or a job
    // whose marketplace_booking_id pointed at a booking row whose
    // status was still 'pending'.
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(MarketplaceBooking);
      const customerRepo = manager.getRepository(Customer);
      const jobRepo = manager.getRepository(Job);

      // Re-read inside the TX so the booking we mutate at the end of
      // the body is the manager-bound row, not a stale entity from the
      // pre-TX read above. PR-B Surface 4 — pessimistic-write lock on
      // the booking row serializes concurrent accept() calls. Two
      // operators clicking Accept in parallel previously both saw
      // status='pending' here and produced two Job rows referencing
      // the same booking. The lock makes the second caller wait for
      // the first to commit; on wake the post-lock status check at
      // line 198 observes status='accepted' and throws the matching
      // BadRequestException envelope from line 172. Tenant-scoped per
      // multi-tenant safety standing rule.
      const booking = await bookingRepo.findOne({
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) {
        // Defensive: a concurrent delete between pre-TX validation and
        // TX open is improbable but not impossible. 404 is the same
        // envelope the pre-check would have produced.
        throw new NotFoundException(`Booking ${id} not found`);
      }
      // PR-B Surface 4 — post-lock status re-check. The pre-TX check at
      // line 171 only covers the no-contention path; the second
      // concurrent accept() caller observes status='accepted' here
      // after waking from the row lock and throws the same envelope.
      if (booking.status !== 'pending') {
        throw new BadRequestException(
          `Booking is already "${booking.status}"`,
        );
      }

      // Find-or-create the customer scoped to (tenant_id, email).
      let customer = await customerRepo.findOne({
        where: { tenant_id: tenantId, email: booking.customer_email },
      });
      if (!customer) {
        const nameParts = booking.customer_name.split(' ');
        const firstName = nameParts[0] || booking.customer_name;
        const lastName = nameParts.slice(1).join(' ') || '';
        try {
          customer = await customerRepo.save(
            customerRepo.create({
              tenant_id: tenantId,
              first_name: firstName,
              last_name: lastName,
              email: booking.customer_email,
              phone: booking.customer_phone,
              lead_source: 'marketplace',
              service_addresses: booking.service_address
                ? [booking.service_address]
                : [],
            }),
          );
        } catch (err) {
          // Concurrency arc Surface 3: a parallel accept() flow with the
          // same (tenant_id, lower(email)) committed between our findOne
          // and our save. The unique constraint
          // idx_customers_tenant_email_unique caught it (Postgres
          // SQLSTATE 23505 = unique_violation). Re-run the lookup; the
          // parallel TX has committed, so the customer now exists and is
          // returnable. Anything other than 23505 is unexpected at this
          // call site and propagates unchanged.
          if (
            err instanceof QueryFailedError &&
            (err as QueryFailedError & { code?: string }).code === '23505'
          ) {
            customer = await customerRepo.findOne({
              where: { tenant_id: tenantId, email: booking.customer_email },
            });
            if (!customer) {
              // Theoretically impossible: if the unique constraint just
              // fired on (tenant_id, lower(email)), the parallel TX must
              // have committed a row with that exact key. If we see null
              // here anyway, re-throw the original error rather than
              // silently using null and crashing downstream.
              throw err;
            }
          } else {
            throw err;
          }
        }
      }

      // Delegate job creation to the SSoT path. JobsService.create
      // handles atomic job-number issuance, asset reservation, and
      // (when present) auto-invoicing. We pass `manager` so all of
      // its writes join this outer TX rather than opening a fresh one.
      //
      // Pricing fields (basePrice / totalPrice) and assetSubtype are
      // intentionally omitted from the DTO so JobsService.create's
      // auto-invoice gate (`job_type === 'delivery' && total_price > 0`)
      // does NOT trip — marketplace bookings invoice via the platform's
      // own settlement path, not the operator's POS path. The Job's
      // base_price / total_price are then projected from the booking's
      // quoted_price in the post-create UPDATE below, so the persisted
      // Job row matches its pre-refactor field-for-field shape.
      const createdJob = await this.jobsService.create(
        tenantId,
        {
          customerId: customer.id,
          jobType: 'delivery',
          serviceType: booking.listing_type,
          scheduledDate: booking.requested_date,
          serviceAddress: booking.service_address,
          placementNotes: booking.special_instructions,
          rentalDays: booking.rental_days,
          source: 'marketplace',
        },
        manager,
      );

      // Project fields with no CreateJobDto analog. `marketplace_booking_id`
      // and `status: 'confirmed'` are marketplace-flow specific; the price
      // fields are projected here (rather than passed through the DTO) to
      // keep the auto-invoice gate suppressed — see comment above. All
      // four columns are tenant-scoped via the WHERE id+tenant_id pair.
      await jobRepo.update(
        { id: createdJob.id, tenant_id: tenantId },
        {
          marketplace_booking_id: booking.marketplace_booking_id,
          status: 'confirmed',
          base_price: booking.quoted_price,
          total_price: booking.quoted_price,
        },
      );

      // Booking projection. Order matters only insofar as the booking
      // must reference the persisted job's id, which is now safe because
      // createdJob is from a row that committed via the same manager.
      booking.status = 'accepted';
      booking.job_id = createdJob.id;
      booking.processed_at = new Date();
      const savedBooking = await bookingRepo.save(booking);

      // Re-fetch the projected job so the response reflects the
      // post-UPDATE state (price fields, status, marketplace link).
      const job = await jobRepo.findOne({
        where: { id: createdJob.id, tenant_id: tenantId },
      });

      return { booking: savedBooking, customer, job };
    });
  }

  async reject(tenantId: string, id: string, dto: RejectBookingDto) {
    const booking = await this.bookingsRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
    if (booking.status !== 'pending') {
      throw new BadRequestException(`Booking is already "${booking.status}"`);
    }

    booking.status = 'rejected';
    booking.rejection_reason = dto.reason;
    booking.processed_at = new Date();
    return this.bookingsRepository.save(booking);
  }

  async getAvailability(
    tenantId: string,
    type: string,
    subtype: string | undefined,
    date: string,
  ) {
    await this.resolveIntegrationByTenant(tenantId);
    const qb = this.assetsRepository
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.asset_type = :type', { type })
      .andWhere('a.status = :status', { status: 'available' });

    if (subtype) {
      qb.andWhere('a.subtype = :subtype', { subtype });
    }

    const available = await qb.getCount();

    return { tenantId, type, subtype: subtype ?? null, date, available };
  }

  async getPricing(
    tenantId: string,
    serviceType: string,
    assetSubtype: string,
    lat: number,
    lng: number,
  ) {
    await this.resolveIntegrationByTenant(tenantId);
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Use tenant address or default yard coords
    const addr = tenant.address as Record<string, number> | null;
    const yardLat = addr?.lat ?? lat;
    const yardLng = addr?.lng ?? lng;

    return this.pricingService.calculate(tenantId, {
      serviceType,
      assetSubtype,
      jobType: 'delivery',
      customerLat: lat,
      customerLng: lng,
      yardLat,
      yardLng,
    });
  }
}
