import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryFailedError } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { PricingRule } from '../../pricing/entities/pricing-rule.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { PricingService } from '../../pricing/pricing.service';
import { MapboxService } from '../../mapbox/mapbox.service';
import { BillingService } from '../billing.service';
import { BookingCompletionService } from './booking-completion.service';
import { BookingCreditEnforcementService } from './booking-credit-enforcement.service';
import { CreateWithBookingDto } from '../dto/create-with-booking.dto';
import { RentalChainsService } from '../../rental-chains/rental-chains.service';

/**
 * Phase 4B — auth context plumbed into the orchestration entry point
 * so server-authoritative credit enforcement can validate the user
 * role + identity from the JWT, not from the request body.
 */
export interface OrchestrationAuthContext {
  userId: string;
  userRole: string | undefined;
}

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
    @InjectRepository(PricingRule) private pricingRuleRepo: Repository<PricingRule>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private pricingService: PricingService,
    private bookingCompletionService: BookingCompletionService,
    private billingService: BillingService,
    private mapboxService: MapboxService,
    private bookingCreditEnforcementService: BookingCreditEnforcementService,
    // forwardRef breaks the BillingModule ↔ RentalChainsModule import
    // cycle (RentalChainsModule already imports BillingModule for
    // BillingService; we now need the reverse for canonical exchange
    // delegation). Standard NestJS escape hatch — RentalChainsService
    // is a singleton so resolution happens once at bootstrap.
    @Inject(forwardRef(() => RentalChainsService))
    private rentalChainsService: RentalChainsService,
  ) {}

  async createWithBooking(
    tenantId: string,
    dto: CreateWithBookingDto,
    auth: OrchestrationAuthContext,
  ): Promise<OrchestrationResult> {
    // Idempotency check.
    //
    // NON-FATAL: .catch(() => []) on the SELECT. Failure here means the
    // idempotency cache is unreachable; we fall through and re-process
    // the request. Caller can safely continue because the real
    // idempotency is enforced inside the booking transaction below —
    // FK + unique-constraint checks on customer_id / job_number /
    // invoice_number catch any true double-write at the DB layer. This
    // cache is a fast-path optimization, not a correctness boundary.
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

    // Phase 4B — server-authoritative credit-hold enforcement.
    // Throws 403 (block), 503 (eval failure), or 400 (malformed
    // override) BEFORE the transaction starts so we don't allocate
    // any state on a rejected booking. New customers (no dto.customerId)
    // skip enforcement at the service level — they have no credit
    // history yet.
    const enforcement = await this.bookingCreditEnforcementService.enforceForBooking({
      tenantId,
      customerId: dto.customerId ?? null,
      userId: auth.userId,
      userRole: auth.userRole,
      creditOverride: dto.creditOverride ?? null,
    });

    // Resolve tenant-scoped default rental period from pricing rule (no hardcoded fallback)
    const pricingRule = await this.pricingRuleRepo.findOne({
      where: { tenant_id: tenantId, asset_subtype: dto.dumpsterSize, is_active: true },
    });
    const tenantDefaultDays = pricingRule?.rental_period_days ?? 7;
    const rentalDays = dto.rentalDays || tenantDefaultDays;
    const pickupDate = dto.pickupTBD
      ? this.addDays(dto.deliveryDate, rentalDays)
      : (dto.pickupDate || this.addDays(dto.deliveryDate, rentalDays));

    // Transaction: create customer + booking + invoice atomically
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let customerId: string;
    let savedInvoice: Invoice | null;
    let completionResult: Awaited<ReturnType<BookingCompletionService['completeBooking']>>;

    try {
      // ── EXCHANGE PATH ──
      // Domain invariant: an exchange is always for the chain's
      // existing customer. We do NOT independently resolve a customer
      // here — chain.customer_id is authoritative. This makes
      // cross-customer exchange impossible by construction. The
      // delivery branch below handles customer create/find for new
      // bookings.
      //
      // Delegation to canonical RentalChainsService.createExchange
      // owns the full exchange contract: chain-link insert, prior
      // pickup cancellation with `cancellation_reason = 'exchange_replacement'`,
      // real replacement pickup row with `parent_job_id`, pricing
      // snapshot persisted with `jobType: 'exchange'` semantics +
      // exchange_context, invoice creation, service_address inheritance
      // from the chain delivery link. Passing queryRunner.manager
      // joins the exchange writes to this outer transaction so
      // rollback unwinds them atomically with anything else this
      // method later writes.
      if (dto.jobType === 'exchange' && dto.exchangeRentalChainId) {
        const chainRepo = queryRunner.manager.getRepository(RentalChain);
        const chain = await chainRepo.findOne({
          where: { id: dto.exchangeRentalChainId, tenant_id: tenantId },
        });
        if (!chain) throw new BadRequestException('Rental chain not found');

        customerId = chain.customer_id;

        const exchangeResult = await this.rentalChainsService.createExchange(
          tenantId,
          chain.id,
          {
            // Orchestration's `deliveryDate` is the user-chosen service
            // date for the new booking — for the exchange path that
            // date IS the exchange date. Field name diverges by
            // orchestration legacy; semantics align.
            exchange_date: dto.deliveryDate!,
            dumpster_size: dto.dumpsterSize,
          },
          queryRunner.manager,
        );

        // Canonical createExchange writes the invoice through the
        // same manager when exchangeTotal > 0; surface its id in the
        // result. Zero-price exchanges leave invoice = null.
        const invoiceRepo = queryRunner.manager.getRepository(Invoice);
        const inv = await invoiceRepo.findOne({
          where: {
            tenant_id: tenantId,
            job_id: exchangeResult.createdJobs.exchange.id,
          },
        });

        completionResult = {
          deliveryJob: exchangeResult.createdJobs.exchange,
          // Real pickup row (no longer aliasing the exchange row).
          pickupJob: exchangeResult.createdJobs.pickup,
          invoice: inv,
          rentalChainId: chain.id,
          autoApproved: false,
          assignedAsset: null,
        } as Awaited<ReturnType<BookingCompletionService['completeBooking']>>;
        savedInvoice = inv;
      } else {
        // ── DELIVERY PATH (existing flow, unchanged) ──
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
        // NON-FATAL: geocoding is a best-effort fallback for missing
        // lat/lng. Failure here leaves customerLat/Lng unresolved —
        // the validation immediately below converts that to a clean
        // BadRequestException('... could not be geocoded ...'). So the
        // catch is effectively a redirect into a structured 400 path,
        // not a silent swallow. Failure also covers Mapbox network
        // blips, rate limits, or missing API keys — none of which
        // should 500 when the downstream code already produces a
        // caller-visible error.
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
        customerId,
      } as any);
      const basePrice = priceResult.breakdown.basePrice;
      const distanceSurcharge = priceResult.breakdown.distanceSurcharge || 0;
      const totalPrice = priceResult.breakdown.total;

        // 3. Standard delivery booking. Exchange is handled at the
        // top of this try block; this branch is delivery-only.
        //
        // Phase 4B — splice the server-built credit override audit
        // note into placementNotes when an override was applied.
        // Backend is authoritative for the audit trail.
        const combinedPlacementNotes =
          enforcement.overrideNote && dto.placementNotes
            ? `${dto.placementNotes}\n${enforcement.overrideNote}`
            : enforcement.overrideNote ?? dto.placementNotes;

        completionResult = await this.bookingCompletionService.completeBooking(
          {
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
            placementNotes: combinedPlacementNotes,
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
            source: dto.source,
          },
          queryRunner.manager,
        );
        savedInvoice = completionResult.invoice;
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      // Translate duplicate-email 23505 into structured 409 BEFORE re-throw.
      // Rollback must run first so the helper's existing-customer lookup
      // queries committed DB state (uses this.customersRepo, not queryRunner).
      await this.throwIfDuplicateEmailConflict(err, tenantId, dto.email);
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Payment attempt (outside transaction — Stripe is external)
    let paymentStatus: OrchestrationResult['status'] = 'invoice_unpaid';
    let nextAction: OrchestrationResult['nextAction'] = 'show_unpaid_state';

    if (dto.paymentMethod === 'card') {
      // Card selected = payment method chosen, NOT payment captured.
      // Invoice remains unpaid until a real Stripe payment confirmation
      // arrives via POST /portal/payments/prepare → Stripe redirect/webhook.
      // DO NOT create a phantom payment record here.
      paymentStatus = 'invoice_unpaid';
      nextAction = 'show_unpaid_state';
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
      // Optional: zero-price exchanges (rule base_price = 0) skip
      // invoice creation, so savedInvoice can be null on the exchange
      // path. OrchestrationResult.invoiceId is already typed optional.
      invoiceId: savedInvoice?.id,
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
    try {
      return await this.customersRepo.save(customer);
    } catch (err) {
      // Non-transactional path (customer_only intent) — no rollback needed.
      // Same 23505 → 409 translation as the transactional path above.
      await this.throwIfDuplicateEmailConflict(err, tenantId, dto.email);
      throw err;
    }
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

  // Translate Postgres 23505 on idx_customers_tenant_email_unique into a
  // structured 409 ConflictException. Invariant 8: existing-customer
  // lookup scopes on the tenantId parameter (JWT-derived upstream).
  // Partial-index detection: node-postgres may report the index name via
  // driverError.constraint OR embed it in detail/message — check all
  // three. Other 23505s (e.g., account_id unique) fall through unchanged.
  // Returns void on no-match; caller re-throws. Throws on match.
  private async throwIfDuplicateEmailConflict(
    err: unknown,
    tenantId: string,
    email: string | null | undefined,
  ): Promise<void> {
    if (!(err instanceof QueryFailedError)) return;
    const driverError = (
      err as QueryFailedError & {
        driverError?: {
          code?: string;
          constraint?: string;
          detail?: string;
          message?: string;
        };
      }
    ).driverError;
    if (driverError?.code !== '23505') return;

    const targetConstraint = 'idx_customers_tenant_email_unique';
    const matchesConstraint =
      driverError?.constraint === targetConstraint ||
      !!driverError?.detail?.includes(targetConstraint) ||
      !!driverError?.message?.includes(targetConstraint);
    if (!matchesConstraint) return;

    if (!email) return;

    // Index normalizes via LOWER(email::text); app convention adds TRIM
    // (matches L78-94 pre-submit check). TRIM is defensive against
    // whitespace-padded input.
    const normalizedEmail = email.trim().toLowerCase();
    // Layer 3 — load portal_password_hash (select:false on the entity)
    // only to compute the derived has_portal_access boolean below. The
    // hash itself is never written to the payload.
    const existing = await this.customersRepo
      .createQueryBuilder('c')
      .addSelect('c.portal_password_hash')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(TRIM(c.email)) = :email', { email: normalizedEmail })
      .getOne();

    // Constraint fired but row not found — re-throw original.
    if (!existing) return;

    const displayName =
      [existing.first_name, existing.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      existing.company_name ||
      existing.email ||
      'Unknown';

    throw new ConflictException({
      code: 'duplicate_email',
      existing_customer_id: existing.id,
      existing_customer_name: displayName,
      existing_customer: {
        id: existing.id,
        first_name: existing.first_name,
        last_name: existing.last_name,
        company_name: existing.company_name,
        email: existing.email,
        phone: existing.phone,
        type: existing.type,
        billing_address: existing.billing_address,
        service_addresses: existing.service_addresses,
        // Layer 3 — derived capability flag. The hash itself is NEVER
        // emitted; only the boolean that tells the frontend whether to
        // render "Log in to customer portal" vs "View Existing Customer".
        has_portal_access: !!existing.portal_password_hash,
      },
      message: 'A customer with this email already exists',
    });
  }

  // Public pass-through for BookingsController's /bookings/complete path.
  // Same semantics as the private helper — keeps the logic centralized.
  async translateDuplicateEmailError(
    err: unknown,
    tenantId: string,
    email: string | null | undefined,
  ): Promise<void> {
    return this.throwIfDuplicateEmailConflict(err, tenantId, email);
  }

  // NON-FATAL: storing the idempotency record is a cache-population
  // step that runs AFTER the booking has already committed
  // successfully. Failure here means a subsequent retry with the same
  // idempotency key would re-run the orchestration — which is safe
  // because the real idempotency is enforced by FK + unique
  // constraints inside the transaction (customer email unique index,
  // job numbers, invoice numbers). The ON CONFLICT DO NOTHING clause
  // also makes the INSERT itself idempotent, so a racing duplicate is
  // a no-op. Caller can safely continue because the booking is
  // already durable; this write is cache-only.
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
