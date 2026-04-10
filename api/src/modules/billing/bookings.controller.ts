import { Controller, Post, Body, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import type { Request } from 'express';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { Payment } from './entities/payment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OrchestrationService } from './services/orchestration.service';
import { BookingCompletionService } from './services/booking-completion.service';
import { BookingCreditEnforcementService } from './services/booking-credit-enforcement.service';
import { CreateWithBookingDto } from './dto/create-with-booking.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  private readonly logger = new Logger(BookingsController.name);

  constructor(
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    @InjectRepository(Asset) private assetsRepo: Repository<Asset>,
    @InjectRepository(Invoice) private invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(Tenant) private tenantsRepo: Repository<Tenant>,
    @InjectRepository(RentalChain) private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink) private taskChainLinkRepo: Repository<TaskChainLink>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private orchestrationService: OrchestrationService,
    private bookingCompletionService: BookingCompletionService,
    private bookingCreditEnforcementService: BookingCreditEnforcementService,
  ) {}

  @Post('create-with-booking')
  async createWithBooking(
    @Req() req: Request,
    @Body() dto: CreateWithBookingDto,
  ) {
    const user = req.user as { tenantId: string; sub: string; role?: string };
    return this.orchestrationService.createWithBooking(user.tenantId, dto, {
      userId: user.sub,
      userRole: user.role,
    });
  }

  @Post('complete')
  async completeBooking(
    @Req() req: Request,
    @Body()
    body: {
      customerId?: string;
      customer?: {
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
        type?: string;
        companyName?: string;
        billingAddress?: Record<string, unknown>;
        additionalContacts?: { value: string; role: string }[];
        county?: string;
      };
      serviceType: string;
      assetSubtype: string;
      serviceAddress: Record<string, unknown>;
      deliveryDate: string;
      pickupDate: string;
      rentalDays: number;
      scheduledWindowStart?: string;
      scheduledWindowEnd?: string;
      placementNotes?: string;
      basePrice: number;
      deliveryFee: number;
      taxAmount: number;
      totalPrice: number;
      depositAmount?: number;
      paymentMethod: 'card' | 'invoice';
      stripeToken?: string;
      sendInvoiceNow?: boolean;
      // Phase 4B — server-authoritative credit override payload.
      creditOverride?: { reason?: string };
    },
  ) {
    const user = req.user as { tenantId: string; sub: string; role?: string };
    const tenantId = user.tenantId;

    // Phase 4B — server-authoritative credit-hold enforcement.
    // Throws 403 with structured hold payload when blocked, 503 when
    // enforcement cannot be evaluated, 400 on malformed override
    // request. Returns an audit note string when override is applied,
    // null otherwise. We splice the note into placementNotes below
    // before forwarding to the booking completion service.
    //
    // Runs BEFORE any customer create/update so a held customer's
    // record is not touched on a rejected booking.
    const enforcement = await this.bookingCreditEnforcementService.enforceForBooking({
      tenantId,
      customerId: body.customerId ?? null,
      userId: user.sub,
      userRole: user.role,
      creditOverride: body.creditOverride ?? null,
    });

    // 1. Create or find customer
    let customerId = body.customerId;
    if (!customerId && body.customer) {
      const serviceAddresses = body.serviceAddress ? [body.serviceAddress] : [];
      const customerPreferences: Record<string, unknown> = {};
      if (body.customer.additionalContacts && body.customer.additionalContacts.length > 0) {
        customerPreferences.additionalContacts = body.customer.additionalContacts;
      }

      const c = this.customersRepo.create({
        tenant_id: tenantId,
        type: body.customer.type || 'residential',
        first_name: body.customer.firstName,
        last_name: body.customer.lastName,
        email: body.customer.email,
        phone: body.customer.phone,
        company_name: body.customer.companyName,
        billing_address: body.customer.billingAddress as Record<string, string>,
        service_addresses: serviceAddresses as Record<string, any>[],
        customer_preferences: customerPreferences,
      });
      const saved = await this.customersRepo.save(c);
      customerId = saved.id;
    } else if (customerId) {
      // Existing customer — store additional contacts and service address
      const existingCustomer = await this.customersRepo.findOne({ where: { id: customerId, tenant_id: tenantId } });
      if (existingCustomer) {
        let updated = false;

        // Store additional contacts in customer_preferences
        if (body.customer?.additionalContacts && body.customer.additionalContacts.length > 0) {
          const prefs = existingCustomer.customer_preferences || {};
          prefs.additionalContacts = body.customer.additionalContacts;
          existingCustomer.customer_preferences = prefs;
          updated = true;
        }

        // Add service address if not already on file
        if (body.serviceAddress) {
          const addresses = existingCustomer.service_addresses || [];
          const addrStr = JSON.stringify(body.serviceAddress);
          const alreadyExists = addresses.some(
            (a) => JSON.stringify(a) === addrStr,
          );
          if (!alreadyExists) {
            addresses.push(body.serviceAddress as Record<string, any>);
            existingCustomer.service_addresses = addresses;
            updated = true;
          }
        }

        if (updated) {
          await this.customersRepo.save(existingCustomer);
        }
      }
    }

    // 2. Build pricing snapshot (BW receives pre-calculated prices from frontend)
    let pricingSnapshot: Record<string, any> | undefined;
    try {
      const pricingRule = await this.dataSource.getRepository(PricingRule).findOne({
        where: { tenant_id: tenantId, asset_subtype: body.assetSubtype, is_active: true },
      });
      if (pricingRule) {
        pricingSnapshot = {
          capturedAt: new Date().toISOString(),
          pricingRuleId: pricingRule.id,
          pricingRuleName: pricingRule.name,
          basePrice: Number(pricingRule.base_price),
          includedTons: Number(pricingRule.included_tons),
          overagePerTon: Number(pricingRule.overage_per_ton),
          extraDayRate: Number(pricingRule.extra_day_rate),
          rentalPeriodDays: pricingRule.rental_period_days,
          exchangeFee: Number(pricingRule.exchange_fee),
          taxRate: Number(pricingRule.tax_rate),
          taxEnabled: Number(pricingRule.tax_rate) > 0,
          distanceCharge: body.deliveryFee || 0,
          distanceMiles: 0,
        };
      }
    } catch { /* non-fatal */ }

    // Phase 4B — splice the server-built credit override audit note
    // into placementNotes when an override was applied. Backend is
    // authoritative for the audit trail; the frontend no longer
    // builds or sends an override note.
    const combinedPlacementNotes =
      enforcement.overrideNote && body.placementNotes
        ? `${body.placementNotes}\n${enforcement.overrideNote}`
        : enforcement.overrideNote ?? body.placementNotes;

    // 3. Shared booking completion (jobs, invoice, line items, rental chain)
    const completion = await this.bookingCompletionService.completeBooking({
      tenantId,
      customerId: customerId!,
      dumpsterSize: body.assetSubtype,
      serviceType: body.serviceType,
      deliveryDate: body.deliveryDate,
      pickupDate: body.pickupDate,
      rentalDays: body.rentalDays,
      siteAddress: body.serviceAddress as Record<string, any>,
      basePrice: body.basePrice,
      distanceSurcharge: body.deliveryFee || 0,
      totalPrice: body.totalPrice,
      taxAmount: body.taxAmount || 0,
      placementNotes: combinedPlacementNotes,
      pricingSnapshot,
      pricingTierUsed: 'global',
    });

    const { deliveryJob: savedDelivery, pickupJob: savedPickup, invoice: savedInvoice, rentalChainId, autoApproved, assignedAsset } = completion;

    // 4. Payment recording (caller-specific)
    const isPaid = body.paymentMethod === 'card';
    if (isPaid) {
      const paymentRepo = this.dataSource.getRepository(Payment);
      await paymentRepo.save(paymentRepo.create({
        tenant_id: tenantId,
        invoice_id: savedInvoice.id,
        amount: body.totalPrice,
        payment_method: 'card',
        status: 'completed',
      }));
    }

    // 5. Opt-in invoice send (caller-specific — BW only)
    if (!isPaid && body.sendInvoiceNow) {
      await this.invoicesRepo.update(savedInvoice.id, { sent_at: new Date(), sent_method: 'email' });
      const customer = await this.customersRepo.findOne({ where: { id: customerId } });
      if (customer?.email) {
        try {
          await this.notificationsService.send(tenantId, {
            channel: 'email',
            type: 'invoice_sent',
            recipient: customer.email,
            subject: `Invoice #${savedInvoice.invoice_number} from your service provider`,
            body: `<p>Hello ${customer.first_name},</p><p>Invoice <strong>#${savedInvoice.invoice_number}</strong> for <strong>$${body.totalPrice.toFixed(2)}</strong> has been sent to you.</p><p>Due date: ${body.deliveryDate}</p><p>Summary: ${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental</p>`,
            customerId: customerId,
          });
        } catch (err) {
          this.logger.warn(`Failed to send invoice email for #${savedInvoice.invoice_number}: ${err}`);
        }
      }
    }

    // 6. Reconcile balance (caller-specific — BW handles payment inline)
    {
      const paymentRepo = this.dataSource.getRepository(Payment);
      const payments = await paymentRepo.find({ where: { invoice_id: savedInvoice.id, status: 'completed' } });
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balanceDue = Math.max(Math.round((body.totalPrice - totalPaid) * 100) / 100, 0);
      let status: string;
      if (totalPaid >= body.totalPrice && totalPaid > 0) status = 'paid';
      else if (totalPaid > 0) status = 'partial';
      else status = 'open';
      await this.invoicesRepo.update(savedInvoice.id, {
        amount_paid: Math.round(totalPaid * 100) / 100,
        balance_due: balanceDue,
        status,
        paid_at: status === 'paid' ? new Date() : null,
      });
    }

    this.logger.log(
      `Booking complete: delivery ${savedDelivery.job_number} scheduled for ${body.deliveryDate}, pickup ${savedPickup.job_number} for ${body.pickupDate}. Customer: ${customerId}`,
    );

    return {
      success: true,
      deliveryJob: { id: savedDelivery.id, jobNumber: savedDelivery.job_number },
      pickupJob: { id: savedPickup.id, jobNumber: savedPickup.job_number },
      invoice: { id: savedInvoice.id, invoiceNumber: savedInvoice.invoice_number },
      customerId,
      rentalChainId,
      autoApproved,
      asset: assignedAsset,
      assetWarning: null,
    };
  }
}
