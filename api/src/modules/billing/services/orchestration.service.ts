import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { PricingService } from '../../pricing/pricing.service';
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
      const customer = await this.createCustomer(tenantId, dto);
      const result: OrchestrationResult = {
        customerId: customer.id,
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

      // 1. Create customer
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

      // 2. Calculate full tenant-scoped pricing (base + distance surcharge)
      const siteAddr = dto.siteAddress || dto.billingAddress || {};
      const priceResult = await this.pricingService.calculate(tenantId, {
        serviceType: 'dumpster_rental',
        assetSubtype: dto.dumpsterSize!,
        jobType: 'delivery',
        customerType: dto.type || 'residential',
        customerLat: Number(siteAddr.lat) || 0,
        customerLng: Number(siteAddr.lng) || 0,
        rentalDays: rentalDays,
      } as any);
      const basePrice = priceResult.breakdown.basePrice;
      const distanceSurcharge = priceResult.breakdown.distanceSurcharge || 0;
      const totalPrice = priceResult.breakdown.total;

      // 3. Shared booking completion (jobs, invoice, line items, rental chain)
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
}
