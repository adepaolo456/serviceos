import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Invoice } from '../billing/entities/invoice.entity';

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(PricingRule) private pricingRepo: Repository<PricingRule>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
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
      name: string; subtype: string; basePrice: number;
      rentalDays: number; extraDayRate: number; deliveryFee: number;
      depositAmount: number; depositRequired: boolean;
    }>> = {};

    for (const r of rules) {
      const key = r.service_type;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
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

  async createBooking(slug: string, body: Record<string, unknown>) {
    const t = await this.findTenant(slug);

    const email = body.customerEmail as string | undefined;
    const phone = body.customerPhone as string | undefined;
    const name = (body.customerName as string) || '';
    const [firstName, ...lastParts] = name.split(' ');
    const lastName = lastParts.join(' ') || firstName;

    // Find or create customer
    let customer: Customer | null = null;
    if (email) {
      customer = await this.customerRepo.findOne({ where: { tenant_id: t.id, email } });
    }
    if (!customer && phone) {
      customer = await this.customerRepo.findOne({ where: { tenant_id: t.id, phone } });
    }
    if (!customer) {
      customer = this.customerRepo.create({
        tenant_id: t.id,
        first_name: firstName,
        last_name: lastName,
        email: email || undefined,
        phone: phone || undefined,
        type: 'residential',
        lead_source: (body.source as string) || 'website',
      });
      customer = await this.customerRepo.save(customer);
    }

    // Find pricing rule
    const assetSubtype = body.assetSubtype as string;
    const serviceType = (body.serviceType as string) || 'dumpster_rental';
    const rentalDays = (body.rentalDays as number) || 7;

    const rule = await this.pricingRepo.findOne({
      where: { tenant_id: t.id, service_type: serviceType, asset_subtype: assetSubtype, is_active: true },
    });

    const basePrice = rule ? Number(rule.base_price) : 0;
    const deliveryFee = rule ? Number(rule.delivery_fee) : 0;
    const extraDays = rule ? Math.max(0, rentalDays - rule.rental_period_days) : 0;
    const extraDayCost = rule ? extraDays * Number(rule.extra_day_rate) : 0;
    const totalPrice = basePrice + deliveryFee + extraDayCost;

    // Generate job number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = Math.floor(Math.random() * 9000) + 1000;
    const jobNumber = `JOB-${dateStr}-${seq}`;

    // Parse time window
    const timeWindow = body.timeWindow as string;
    let windowStart = '08:00';
    let windowEnd = '17:00';
    if (timeWindow === 'morning') { windowStart = '08:00'; windowEnd = '12:00'; }
    else if (timeWindow === 'afternoon') { windowStart = '12:00'; windowEnd = '17:00'; }

    const job = this.jobRepo.create({
      tenant_id: t.id,
      job_number: jobNumber,
      customer_id: customer.id,
      job_type: 'delivery',
      service_type: serviceType,
      priority: 'normal',
      scheduled_date: body.scheduledDate as string,
      scheduled_window_start: windowStart,
      scheduled_window_end: windowEnd,
      service_address: typeof body.serviceAddress === 'string'
        ? { street: body.serviceAddress }
        : (body.serviceAddress as Record<string, any>) || undefined,
      placement_notes: body.placementNotes as string,
      rental_days: rentalDays,
      rental_start_date: body.scheduledDate as string,
      base_price: basePrice,
      total_price: totalPrice,
      status: 'pending',
      source: (body.source as string) || 'website',
    });

    // Calculate rental end date
    if (body.scheduledDate) {
      const start = new Date(body.scheduledDate as string);
      start.setDate(start.getDate() + rentalDays);
      job.rental_end_date = start.toISOString().split('T')[0];
    }

    const saved = await this.jobRepo.save(job);

    // Create POS invoice (paid at booking)
    const invNumber = `INV-${dateStr}-${Math.floor(Math.random() * 9000) + 1000}`;
    const lineItems = [
      { description: `${assetSubtype || 'Dumpster'} Rental — ${rentalDays} day rental`, quantity: 1, unitPrice: basePrice, amount: basePrice },
    ];
    if (deliveryFee > 0) {
      lineItems.push({ description: 'Delivery Fee', quantity: 1, unitPrice: deliveryFee, amount: deliveryFee });
    }
    const invoice = this.invoiceRepo.create({
      tenant_id: t.id,
      invoice_number: invNumber,
      customer_id: customer.id,
      job_id: saved.id,
      status: 'paid',
      source: 'booking',
      invoice_type: 'rental',
      payment_method: 'card',
      due_date: new Date().toISOString().split('T')[0],
      subtotal: totalPrice,
      total: totalPrice,
      amount_paid: totalPrice,
      balance_due: 0,
      line_items: lineItems,
      notes: 'Paid at time of booking',
      paid_at: new Date(),
    } as Partial<Invoice>);
    const savedInvoice = await this.invoiceRepo.save(invoice);

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
}
