import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Quote } from '../quotes/quote.entity';
import { BillingService } from '../billing/billing.service';
import { CreatePublicBookingDto } from './dto/public-booking.dto';
import { haversineDistance } from '../pricing/pricing.utils';

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(PricingRule) private pricingRepo: Repository<PricingRule>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Quote) private quoteRepo: Repository<Quote>,
    private billingService: BillingService,
    private dataSource: DataSource,
  ) {}

  private async findTenant(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { slug, is_active: true } });
    if (!tenant) throw new NotFoundException('Company not found');
    return tenant;
  }

  async getTenantBySlug(slug: string) {
    const t = await this.findTenant(slug);
    if (!t.website_enabled) throw new NotFoundException('Website not available');
    return {
      name: t.name,
      slug: t.slug,
      businessType: t.business_type,
      headline: t.website_headline,
      description: t.website_description,
      heroImageUrl: t.website_hero_image_url,
      logoUrl: t.website_logo_url,
      primaryColor: t.website_primary_color,
      phone: t.website_phone,
      email: t.website_email,
      serviceArea: t.website_service_area,
      about: t.website_about,
    };
  }

  async getServices(slug: string) {
    const t = await this.findTenant(slug);
    const rules = await this.pricingRepo.find({
      where: { tenant_id: t.id, is_active: true },
      order: { service_type: 'ASC', base_price: 'ASC' },
    });

    // Group by service_type
    const grouped: Record<string, Array<{
      id: string; name: string; subtype: string; basePrice: number;
      rentalDays: number; extraDayRate: number; deliveryFee: number;
      depositAmount: number; depositRequired: boolean;
    }>> = {};

    for (const r of rules) {
      const key = r.service_type;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        id: r.id,
        name: r.name,
        subtype: r.asset_subtype,
        basePrice: Number(r.base_price),
        rentalDays: r.rental_period_days,
        extraDayRate: Number(r.extra_day_rate),
        deliveryFee: Number(r.delivery_fee),
        depositAmount: Number(r.deposit_amount),
        depositRequired: r.require_deposit,
      });
    }

    return { services: grouped };
  }

  async getAvailability(slug: string, date: string, serviceType: string, assetSubtype: string) {
    const t = await this.findTenant(slug);

    // Count total assets of this subtype
    const totalAssets = await this.assetRepo.count({
      where: { tenant_id: t.id, subtype: assetSubtype, status: In(['available', 'deployed']) },
    });

    // Count deployed assets for this date (jobs with delivery on or before date, no pickup before date)
    const deployedCount = await this.jobRepo
      .createQueryBuilder('j')
      .innerJoin('j.asset', 'a')
      .where('j.tenant_id = :tid', { tid: t.id })
      .andWhere('a.subtype = :subtype', { subtype: assetSubtype })
      .andWhere('j.job_type = :type', { type: 'delivery' })
      .andWhere('j.status NOT IN (:...excluded)', { excluded: ['cancelled', 'completed'] })
      .andWhere('j.scheduled_date <= :date', { date })
      .getCount();

    return {
      available: Math.max(0, totalAssets - deployedCount),
      total: totalAssets,
      date,
      assetSubtype,
    };
  }

  async createBooking(slug: string, body: CreatePublicBookingDto) {
    const t = await this.findTenant(slug);

    // --- Field mapping: accept both frontend and legacy field names ---
    const scheduledDate = body.deliveryDate || body.scheduledDate;
    if (!scheduledDate) {
      throw new BadRequestException('A delivery date (deliveryDate or scheduledDate) is required');
    }

    // Resolve address: frontend sends `address` object, legacy sends `serviceAddress`
    const addressObj = body.address;
    let serviceAddress: Record<string, any> | undefined;
    if (body.serviceAddress) {
      serviceAddress = typeof body.serviceAddress === 'string'
        ? { street: body.serviceAddress }
        : body.serviceAddress;
    } else if (addressObj) {
      serviceAddress = {
        street: addressObj.street,
        city: addressObj.city,
        state: addressObj.state,
        zip: addressObj.zip,
        lat: addressObj.lat,
        lng: addressObj.lng,
        formatted: `${addressObj.street}, ${addressObj.city}, ${addressObj.state} ${addressObj.zip}`,
      };
    }

    // Resolve service: frontend sends `serviceId` (pricing rule UUID), legacy sends assetSubtype + serviceType
    let assetSubtype: string | undefined = body.assetSubtype;
    let serviceType: string = body.serviceType || 'dumpster_rental';
    let rule: PricingRule | null = null;

    if (body.serviceId) {
      rule = await this.pricingRepo.findOne({
        where: { id: body.serviceId, tenant_id: t.id, is_active: true },
      });
      if (!rule) {
        throw new BadRequestException('Invalid serviceId — pricing rule not found');
      }
      assetSubtype = rule.asset_subtype;
      serviceType = rule.service_type;
    } else if (assetSubtype) {
      rule = await this.pricingRepo.findOne({
        where: { tenant_id: t.id, service_type: serviceType, asset_subtype: assetSubtype, is_active: true },
      });
    }

    if (!rule) {
      throw new BadRequestException(
        `No active pricing available for ${assetSubtype || 'unknown'} dumpsters. This size cannot be booked at this time.`,
      );
    }

    const rentalDays = body.rentalDays || rule.rental_period_days || 7;
    const basePrice = Number(rule.base_price);
    const deliveryFee = Number(rule.delivery_fee);
    const extraDays = Math.max(0, rentalDays - rule.rental_period_days);
    const extraDayCost = extraDays * Number(rule.extra_day_rate);
    // Distance charge — requires customer coordinates. Use address lat/lng if available.
    let distanceCharge = 0;
    if (serviceAddress?.lat && serviceAddress?.lng && t.yard_latitude && t.yard_longitude) {
      const dist = haversineDistance(
        Number(t.yard_latitude), Number(t.yard_longitude),
        Number(serviceAddress.lat), Number(serviceAddress.lng),
      );
      const extraMiles = Math.max(dist - 15, 0);
      const bands = Math.ceil(extraMiles / 5);
      distanceCharge = bands * 25;
    }
    const totalPrice = basePrice + deliveryFee + extraDayCost + distanceCharge;

    const email = body.customerEmail;
    const phone = body.customerPhone;
    const name = body.customerName || '';
    const [firstName, ...lastParts] = name.split(' ');
    const lastName = lastParts.join(' ') || firstName;

    // Parse time window
    const timeWindow = body.timeWindow;
    let windowStart = '08:00';
    let windowEnd = '17:00';
    if (timeWindow === 'morning') { windowStart = '08:00'; windowEnd = '12:00'; }
    else if (timeWindow === 'afternoon') { windowStart = '12:00'; windowEnd = '17:00'; }

    // Check asset availability before proceeding
    if (assetSubtype) {
      const availableCount = await this.assetRepo
        .createQueryBuilder('a')
        .where('a.tenant_id = :tid', { tid: t.id })
        .andWhere('a.subtype = :subtype', { subtype: assetSubtype })
        .andWhere('a.status NOT IN (:...excluded)', {
          excluded: ['reserved', 'deployed', 'on_site', 'in_transit'],
        })
        .andWhere('a.current_job_id IS NULL')
        .getCount();
      if (availableCount === 0) {
        throw new BadRequestException(
          `No ${assetSubtype} units available for the requested date. Please try a different date or size.`,
        );
      }
    }

    // --- Transaction: customer + job + invoice ---
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const customerRepo = queryRunner.manager.getRepository(Customer);
      const jobRepoTx = queryRunner.manager.getRepository(Job);

      // Find or create customer
      let customer: Customer | null = null;
      if (email) {
        customer = await customerRepo.findOne({ where: { tenant_id: t.id, email } });
      }
      if (!customer && phone) {
        customer = await customerRepo.findOne({ where: { tenant_id: t.id, phone } });
      }
      if (!customer) {
        customer = customerRepo.create({
          tenant_id: t.id,
          first_name: firstName,
          last_name: lastName,
          email: email || undefined,
          phone: phone || undefined,
          type: 'residential',
          lead_source: body.source || 'website',
        });
        customer = await customerRepo.save(customer);
      }

      // Generate job number
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = Math.floor(Math.random() * 9000) + 1000;
      const jobNumber = `JOB-${dateStr}-${seq}`;

      const job = jobRepoTx.create({
        tenant_id: t.id,
        job_number: jobNumber,
        customer_id: customer.id,
        job_type: 'delivery',
        service_type: serviceType,
        priority: 'normal',
        scheduled_date: scheduledDate,
        scheduled_window_start: windowStart,
        scheduled_window_end: windowEnd,
        service_address: serviceAddress,
        placement_notes: body.placementNotes,
        rental_days: rentalDays,
        rental_start_date: scheduledDate,
        base_price: basePrice,
        total_price: totalPrice,
        status: 'pending',
        source: body.source || 'website',
      });

      // Calculate rental end date
      const startDate = new Date(scheduledDate);
      startDate.setDate(startDate.getDate() + rentalDays);
      job.rental_end_date = startDate.toISOString().split('T')[0];

      const saved = await jobRepoTx.save(job);

      // Create POS invoice (paid at booking)
      const lineItems = [
        { description: `${assetSubtype || 'Dumpster'} Rental — ${rentalDays} day rental`, quantity: 1, unitPrice: basePrice, amount: basePrice },
      ];
      if (deliveryFee > 0) {
        lineItems.push({ description: 'Delivery Fee', quantity: 1, unitPrice: deliveryFee, amount: deliveryFee });
      }
      const savedInvoice = await this.billingService.createInternalInvoice(t.id, {
        customerId: customer.id,
        jobId: saved.id,
        source: 'booking',
        invoiceType: 'rental',
        status: 'paid',
        paymentMethod: 'card',
        lineItems,
        dueDate: new Date().toISOString().split('T')[0],
        notes: 'Paid at time of booking',
      }, queryRunner.manager);

      await queryRunner.commitTransaction();

      return {
        jobNumber: saved.job_number,
        jobId: saved.id,
        invoiceNumber: savedInvoice.invoice_number,
        status: saved.status,
        scheduledDate: saved.scheduled_date,
        pricing: {
          basePrice,
          deliveryFee,
          extraDays,
          extraDayCost,
          totalPrice,
        },
        customer: {
          id: customer.id,
          name: `${customer.first_name} ${customer.last_name}`,
          email: customer.email,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async getWidgetConfig(slug: string, origin: string) {
    const t = await this.findTenant(slug);
    if (!t.widget_enabled) throw new NotFoundException('Widget not available');

    // Validate origin domain
    if (t.allowed_widget_domains && t.allowed_widget_domains.length > 0 && origin) {
      const allowed = t.allowed_widget_domains.some(d => origin.includes(d));
      if (!allowed) throw new ForbiddenException('Domain not allowed');
    }

    // Get available services
    const rules = await this.pricingRepo.find({
      where: { tenant_id: t.id, is_active: true },
    });

    const services = rules.map(r => ({
      name: r.name,
      serviceType: r.service_type,
      subtype: r.asset_subtype,
      basePrice: Number(r.base_price),
    }));

    return {
      companyName: t.name,
      logoUrl: t.website_logo_url,
      primaryColor: t.website_primary_color,
      phone: t.website_phone,
      services,
    };
  }

  /**
   * Look up a quote by token for booking hydration.
   * Validates that the quote belongs to the tenant identified by slug.
   * Returns only safe fields needed for booking — no internal IDs or PII leakage across tenants.
   */
  async getQuoteByToken(slug: string, token: string) {
    const tenant = await this.findTenant(slug);

    const quote = await this.quoteRepo.findOne({ where: { token } });

    // If quote doesn't exist or belongs to a different tenant, return same generic error
    // to prevent cross-tenant enumeration
    if (!quote || quote.tenant_id !== tenant.id) {
      throw new NotFoundException('This quote is no longer available.');
    }

    if (new Date() > quote.expires_at) {
      return { valid: false, expired: true, message: 'This quote has expired.' };
    }

    if (quote.status === 'converted') {
      return { valid: false, converted: true, message: 'This quote has already been booked.' };
    }

    return {
      valid: true,
      quoteId: quote.id,
      size: quote.asset_subtype,
      deliveryAddress: quote.delivery_address,
      customerName: quote.customer_name,
      customerEmail: quote.customer_email,
      customerPhone: quote.customer_phone,
      totalQuoted: Number(quote.total_quoted),
      rentalDays: quote.rental_days,
      includedTons: Number(quote.included_tons),
      expiresAt: quote.expires_at,
    };
  }
}
