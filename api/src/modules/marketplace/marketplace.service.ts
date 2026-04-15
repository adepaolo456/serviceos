import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceBooking } from './entities/marketplace-booking.entity';
import { MarketplaceIntegration } from './entities/marketplace-integration.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingService } from '../pricing/pricing.service';
import {
  CreateMarketplaceBookingDto,
  ListMarketplaceBookingsQueryDto,
  RejectBookingDto,
} from './dto/marketplace.dto';
import { issueNextJobNumber } from '../../common/utils/job-number.util';

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
    const booking = await this.bookingsRepository.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
    if (booking.status !== 'pending') {
      throw new BadRequestException(`Booking is already "${booking.status}"`);
    }

    // Find or create customer
    let customer = await this.customersRepository.findOne({
      where: { tenant_id: tenantId, email: booking.customer_email },
    });
    if (!customer) {
      const nameParts = booking.customer_name.split(' ');
      const firstName = nameParts[0] || booking.customer_name;
      const lastName = nameParts.slice(1).join(' ') || '';
      customer = await this.customersRepository.save(
        this.customersRepository.create({
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
    }

    // Generate job number. Prior to the tenants.next_job_sequence
    // migration this path issued its own sequence via a LIKE-prefix
    // count on `JOB-YYYYMMDD-%`, which was both fragile (a
    // concurrent booking could miss the count and collide) and
    // tightly coupled to the legacy format. Now every module draws
    // from the canonical tenant-scoped counter.
    const jobNumber = await issueNextJobNumber(this.jobsRepository.manager, tenantId, 'delivery');

    // Create job
    const job = await this.jobsRepository.save(
      this.jobsRepository.create({
        tenant_id: tenantId,
        job_number: jobNumber,
        customer_id: customer.id,
        job_type: 'delivery',
        service_type: booking.listing_type,
        scheduled_date: booking.requested_date,
        service_address: booking.service_address,
        placement_notes: booking.special_instructions,
        rental_days: booking.rental_days,
        base_price: booking.quoted_price,
        total_price: booking.quoted_price,
        source: 'marketplace',
        marketplace_booking_id: booking.marketplace_booking_id,
        status: 'confirmed',
      }),
    );

    // Update booking
    booking.status = 'accepted';
    booking.job_id = job.id;
    booking.processed_at = new Date();
    await this.bookingsRepository.save(booking);

    return { booking, customer, job };
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
