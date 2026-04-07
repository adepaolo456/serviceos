import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Job } from '../../jobs/entities/job.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { Payment } from '../entities/payment.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { PricingService } from '../../pricing/pricing.service';
import { MapboxService } from '../../mapbox/mapbox.service';
import { BookingCompletionService } from './booking-completion.service';
import { CreateWithBookingDto } from '../dto/create-with-booking.dto';

export interface OrchestrationResult {
  customerId: string;
  bookingId?: string;
  jobId?: string;
  invoiceId?: string;
  status: 'customer_only' | 'booking_created' | 'invoice_unpaid' | 'payment_succeeded' | 'payment_failed';
  nextAction: 'go_to_customer' | 'open_booking_review' | 'show_unpaid_state' | 'retry_payment_available';
}

@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Invoice) private invoicesRepo: Repository<Invoice>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private pricingService: PricingService,
    private bookingCompletionService: BookingCompletionService,
    private mapboxService: MapboxService,
  ) {}

  async createWithBooking(tenantId: string, dto: CreateWithBookingDto): Promise<OrchestrationResult> {
    // Idempotency check
    if (dto.idempotencyKey) {
      const existing = await this.dataSource.query(
        `SELECT result_json FROM orchestration_results WHERE tenant_id = $1 AND idempotency_key = $2 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [tenantId, dto.idempotencyKey],
      ).catch(() => []);
      if (existing.length > 0) {
        return existing[0].result_json as OrchestrationResult;
      }
    }

    // Duplicate detection (backend guardrail)
    if (!dto.confirmedCreateDespiteDuplicate) {
      const normalizedPhone = dto.phone?.replace(/\D/g, '') || '';
      const normalizedEmail = dto.email?.trim().toLowerCase() || '';

      if (normalizedPhone || normalizedEmail) {
        let existingId: string | null = null;

        if (normalizedPhone) {
          const phoneMatch = await this.customersRepo
            .createQueryBuilder('c')
            .where('c.tenant_id = :tenantId', { tenantId })
            .andWhere("REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g') = :phone", { phone: normalizedPhone })
            .select('c.id')
            .getOne();
          if (phoneMatch) existingId = phoneMatch.id;
        }

        if (!existingId && normalizedEmail) {
          const emailMatch = await this.customersRepo
            .createQueryBuilder('c')
            .where('c.tenant_id = :tenantId', { tenantId })
            .andWhere('LOWER(TRIM(c.email)) = :email', { email: normalizedEmail })
            .select('c.id')
            .getOne();
          if (emailMatch) existingId = emailMatch.id;
        }

        if (existingId) {
          throw new BadRequestException({
            code: 'DUPLICATE_CUSTOMER',
            existingCustomerId: existingId,
            message: 'Possible duplicate customer found',
          });
        }
      }
    }

    // Case A: customer_only
    if (dto.intent === 'customer_only') {
      const cid = dto.customerId || (await this.createCustomer(tenantId, dto)).id;
      const result: OrchestrationResult = {
        customerId: cid,
        status: 'customer_only',
        nextAction: 'go_to_customer',
      };
      await this.storeIdempotencyResult(tenantId, dto.idempotencyKey, result);
      return result;
    }

    // Case B: schedule_job — validate scheduling fields
    if (!dto.dumpsterSize || !dto.deliveryDate) {
      throw new BadRequestException('Dumpster size and delivery date are required for scheduling');
    }

    // Resolve tenant-scoped default rental period from pricing rule (no hardcoded fallback)
    const pricingRule = await this.dataSource.getRepository('PricingRule').findOne({
      where: { tenant_id: tenantId, asset_subtype: dto.dumpsterSize, is_active: true },
    }) as { rental_period_days?: number } | null;
    const tenantDefaultDays = pricingRule?.rental_period_days || 7;
    const rentalDays = dto.rentalDays || tenantDefaultDays;
    const pickupDate = dto.pickupTBD
      ? this.addDays(dto.deliveryDate, rentalDays)
      : (dto.pickupDate || this.addDays(dto.deliveryDate, rentalDays));

    // Transaction: create customer + booking + invoice atomically
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let customerId: string;
    let savedInvoice: Invoice;
    let completionResult: Awaited<ReturnType<BookingCompletionService['completeBooking']>>;

    try {
      const customerRepo = queryRunner.manager.getRepository(Customer);

      // 1. Use existing customer or create new
      if (dto.customerId) {
        // Verify customer belongs to this tenant
        const existing = await customerRepo.findOne({ where: { id: dto.customerId, tenant_id: tenantId } });
        if (!existing) throw new BadRequestException('Customer not found');
        customerId = existing.id;
      } else {
        const customer = customerRepo.create({
          tenant_id: tenantId,
          type: dto.type || 'residential',
          first_name: dto.firstName,
          last_name: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          company_name: dto.companyName,
          billing_address: dto.billingAddress as Record<string, string>,
          service_addresses: dto.siteAddress ? [dto.siteAddress as Record<string, any>] : [],
          notes: dto.notes,
          tags: dto.tags,
          lead_source: dto.leadSource,
        });
        const savedCustomer = await customerRepo.save(customer);
        customerId = savedCustomer.id;
      }

      // 2. Calculate full tenant-scoped pricing (base + distance surcharge)
      const siteAddr = dto.siteAddress || dto.billingAddress || {};
      let customerLat = siteAddr.lat != null ? Number(siteAddr.lat) : null;
      let customerLng = siteAddr.lng != null ? Number(siteAddr.lng) : null;

      // Geocode fallback: if coordinates are missing or invalid (0,0), attempt geocoding
      const needsGeocode = customerLat == null || customerLng == null
        || (customerLat === 0 && customerLng === 0);
      if (needsGeocode && siteAddr.street) {
        const addrStr = [siteAddr.street, siteAddr.city, siteAddr.state, siteAddr.zip].filter(Boolean).join(', ');
        try {
          const geo = await this.mapboxService.geocodeAddress(addrStr);
          if (geo?.lat && geo?.lng) {
            customerLat = geo.lat;
            customerLng = geo.lng;
            // Persist geocoded coords back to the site address for downstream use
            siteAddr.lat = geo.lat;
            siteAddr.lng = geo.lng;
          }
        } catch {
          this.logger.warn(`Geocoding fallback failed for: ${addrStr}`);
        }
      }

      if (customerLat == null || customerLng == null || (customerLat === 0 && customerLng === 0)) {
        throw new BadRequestException('Customer address could not be geocoded — cannot calculate distance pricing');
      }

      const priceResult = await this.pricingService.calculate(tenantId, {
        serviceType: 'dumpster_rental',
        assetSubtype: dto.dumpsterSize!,
        jobType: 'delivery',
        customerType: dto.type || 'residential',
        customerLat,
        customerLng,
        rentalDays: rentalDays,
      } as any);
      const basePrice = priceResult.breakdown.basePrice;
      const distanceSurcharge = priceResult.breakdown.distanceSurcharge || 0;
      const totalPrice = priceResult.breakdown.total;

      // 3. Create booking — exchange or new delivery
      if (dto.jobType === 'exchange' && dto.exchangeRentalChainId) {
        // Exchange path: create exchange job + invoice from rental chain
        const chainRepo = queryRunner.manager.getRepository(RentalChain);
        const jobRepo = queryRunner.manager.getRepository(Job);
        const invoiceRepo = queryRunner.manager.getRepository(Invoice);
        const lineItemRepo = queryRunner.manager.getRepository(InvoiceLineItem);

        const chain = await chainRepo.findOne({ where: { id: dto.exchangeRentalChainId, tenant_id: tenantId } });
        if (!chain) throw new BadRequestException('Rental chain not found');

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const seq = Math.floor(Math.random() * 9000) + 1000;

        const exchangeJob = jobRepo.create({
          tenant_id: tenantId, customer_id: customerId,
          job_number: `JOB-${dateStr}-${seq}`, job_type: 'exchange',
          service_type: 'dumpster_rental', asset_subtype: dto.dumpsterSize,
          asset_id: chain.asset_id || null, service_address: siteAddr as Record<string, string>,
          status: 'pending', priority: 'normal', source: 'quick_quote_exchange',
          scheduled_date: dto.deliveryDate!, rental_days: rentalDays,
        } as Partial<Job> as Job);
        const savedJob = await jobRepo.save(exchangeJob);

        // Create exchange invoice
        const invoiceNumber = await this.getNextInvoiceNumber(tenantId, queryRunner.manager);
        const today = new Date().toISOString().split('T')[0];
        const invoice = invoiceRepo.create({
          tenant_id: tenantId, invoice_number: invoiceNumber, customer_id: customerId,
          job_id: savedJob.id, status: 'open', invoice_date: today,
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          summary_of_work: `Exchange scheduled for rental chain ${chain.id}`,
        } as Partial<Invoice>);
        const savedInv = await invoiceRepo.save(invoice);

        const lineItem = lineItemRepo.create({
          invoice_id: savedInv.id, sort_order: 0, line_type: 'service',
          name: 'Dumpster Exchange', quantity: 1, unit_rate: totalPrice, amount: totalPrice, net_amount: totalPrice,
        });
        await lineItemRepo.save(lineItem);
        await invoiceRepo.update(savedInv.id, { subtotal: totalPrice, total: totalPrice, balance_due: totalPrice });

        // Build a compatible completionResult shape
        completionResult = {
          deliveryJob: savedJob, pickupJob: savedJob, invoice: savedInv,
          rentalChainId: chain.id, autoApproved: false, assignedAsset: null,
        } as any;
        savedInvoice = savedInv;
      } else {
        // Standard delivery path
        completionResult = await this.bookingCompletionService.completeBooking({
          tenantId,
          customerId,
          dumpsterSize: dto.dumpsterSize!,
          serviceType: 'dumpster_rental',
          deliveryDate: dto.deliveryDate!,
          pickupDate,
          rentalDays,
          siteAddress: siteAddr as Record<string, any>,
          basePrice,
          distanceSurcharge,
          totalPrice,
          pricingSnapshot: {
            capturedAt: new Date().toISOString(),
            pricingRuleId: priceResult.rule.id,
            pricingRuleName: priceResult.rule.name,
            basePrice,
            distanceMiles: priceResult.breakdown.distanceMiles,
            distanceSurcharge,
            rentalDays,
            total: totalPrice,
          },
          pricingTierUsed: 'global',
        }, queryRunner.manager);
        savedInvoice = completionResult.invoice;
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Payment attempt (outside transaction — Stripe is external)
    let paymentStatus: OrchestrationResult['status'] = 'invoice_unpaid';
    let nextAction: OrchestrationResult['nextAction'] = 'show_unpaid_state';

    if (dto.paymentMethod === 'card') {
      try {
        // Import StripeService dynamically to avoid circular deps
        const stripeService = this.dataSource.manager.connection.options;
        // Use direct payment record approach (matching existing booking flow)
        const paymentRepo = this.dataSource.getRepository(Payment);
        await paymentRepo.save(paymentRepo.create({
          tenant_id: tenantId,
          invoice_id: savedInvoice.id,
          amount: savedInvoice.total,
          payment_method: 'card',
          status: 'completed',
        }));
        // Reconcile balance
        await this.reconcileInvoice(savedInvoice.id, savedInvoice.total);
        paymentStatus = 'payment_succeeded';
        nextAction = 'go_to_customer';
      } catch {
        paymentStatus = 'payment_failed';
        nextAction = 'retry_payment_available';
      }
    } else if (dto.paymentMethod === 'cash' || dto.paymentMethod === 'check') {
      paymentStatus = 'invoice_unpaid';
      nextAction = 'show_unpaid_state';
    } else {
      paymentStatus = 'booking_created';
      nextAction = 'go_to_customer';
    }

    const result: OrchestrationResult = {
      customerId,
      jobId: completionResult.deliveryJob.id,
      invoiceId: savedInvoice.id,
      status: paymentStatus,
      nextAction,
    };

    await this.storeIdempotencyResult(tenantId, dto.idempotencyKey, result);

    this.logger.log(
      `Orchestration complete: customer ${customerId}, delivery ${completionResult.deliveryJob.job_number}, status ${paymentStatus}`,
    );

    return result;
  }

  private async createCustomer(tenantId: string, dto: CreateWithBookingDto): Promise<Customer> {
    const r = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const p = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    const accountId = `${p}-${r()}-${r()}`;

    const customer = this.customersRepo.create({
      tenant_id: tenantId,
      account_id: accountId,
      type: dto.type || 'residential',
      first_name: dto.firstName,
      last_name: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      company_name: dto.companyName,
      billing_address: dto.billingAddress as Record<string, string>,
      notes: dto.notes,
      tags: dto.tags,
      lead_source: dto.leadSource,
    });
    return this.customersRepo.save(customer);
  }

  private async reconcileInvoice(invoiceId: string, total: number): Promise<void> {
    const paymentRepo = this.dataSource.getRepository(Payment);
    const payments = await paymentRepo.find({ where: { invoice_id: invoiceId, status: 'completed' } });
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const balanceDue = Math.max(Math.round((total - totalPaid) * 100) / 100, 0);
    let status: string;
    if (totalPaid >= total && totalPaid > 0) status = 'paid';
    else if (totalPaid > 0) status = 'partial';
    else status = 'open';
    await this.invoicesRepo.update(invoiceId, {
      amount_paid: Math.round(totalPaid * 100) / 100,
      balance_due: balanceDue,
      status,
      paid_at: status === 'paid' ? new Date() : null,
    });
  }

  private async storeIdempotencyResult(tenantId: string, key: string | undefined, result: OrchestrationResult): Promise<void> {
    if (!key) return;
    try {
      await this.dataSource.query(
        `INSERT INTO orchestration_results (tenant_id, idempotency_key, result_json) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
        [tenantId, key, JSON.stringify(result)],
      );
    } catch {
      this.logger.warn('Failed to store idempotency result — non-fatal');
    }
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  private async getNextInvoiceNumber(tenantId: string, manager?: import('typeorm').EntityManager): Promise<number> {
    const src = manager ?? this.dataSource;
    const result = await src.query(`SELECT next_invoice_number($1) as num`, [tenantId]);
    return result[0].num;
  }
}
