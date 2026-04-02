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
  ) {}

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
    },
  ) {
    const user = req.user as { tenantId: string; sub: string };
    const tenantId = user.tenantId;

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
      const existingCustomer = await this.customersRepo.findOne({ where: { id: customerId } });
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

    // 2. Generate job number
    const dateStr = body.deliveryDate.replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    const deliveryNumber = `JOB-${dateStr}-${rand}`;
    const pickupNumber = `JOB-${body.pickupDate.replace(/-/g, '')}-${rand}P`;

    // 3. Check availability and auto-approve
    let autoApproved = false;
    let assignedAsset: { id: string; identifier: string } | null = null;
    let assetWarning: string | null = null;
    let jobStatus = 'pending';

    try {
      const availableAsset = await this.assetsRepo.findOne({
        where: { tenant_id: tenantId, subtype: body.assetSubtype, status: 'available' },
      });

      if (availableAsset) {
        autoApproved = true;
        jobStatus = 'confirmed';
        assignedAsset = { id: availableAsset.id, identifier: availableAsset.identifier };
        await this.assetsRepo.update(availableAsset.id, { status: 'reserved' });
      } else {
        const pickupCount = await this.jobsRepo
          .createQueryBuilder('j')
          .where('j.tenant_id = :tenantId', { tenantId })
          .andWhere('j.job_type = :type', { type: 'pickup' })
          .andWhere('j.status NOT IN (:...ex)', { ex: ['completed', 'cancelled'] })
          .andWhere('j.scheduled_date <= :date', { date: body.deliveryDate })
          .getCount();

        if (pickupCount > 0) {
          autoApproved = true;
          jobStatus = 'confirmed';
          assetWarning = `Auto-confirmed — ${body.assetSubtype} will be available via scheduled pickup before ${body.deliveryDate}.`;
        } else {
          assetWarning = `No ${body.assetSubtype} dumpsters projected available for ${body.deliveryDate}. Job needs manual approval.`;
        }
      }
    } catch { /* non-fatal */ }

    // 3b. Create delivery job
    const deliveryJob = this.jobsRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_number: deliveryNumber,
      job_type: 'delivery',
      service_type: body.serviceType,
      asset_subtype: body.assetSubtype,
      status: jobStatus,
      priority: 'normal',
      source: 'phone',
      scheduled_date: body.deliveryDate,
      scheduled_window_start: body.scheduledWindowStart,
      scheduled_window_end: body.scheduledWindowEnd,
      service_address: body.serviceAddress as Record<string, string>,
      placement_notes: body.placementNotes,
      base_price: body.basePrice,
      total_price: body.totalPrice,
      rental_days: body.rentalDays,
      ...(assignedAsset ? { asset_id: assignedAsset.id } : {}),
    } as Partial<Job> as Job);
    const savedDelivery = await this.jobsRepo.save(deliveryJob);

    // 4. Create pickup job
    const pickupJob = this.jobsRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_number: pickupNumber,
      job_type: 'pickup',
      service_type: body.serviceType,
      asset_subtype: body.assetSubtype,
      status: 'pending',
      priority: 'normal',
      source: 'phone',
      scheduled_date: body.pickupDate,
      service_address: body.serviceAddress as Record<string, string>,
      base_price: 0,
      total_price: 0,
      ...(assignedAsset ? { asset_id: assignedAsset.id } : {}),
    } as Partial<Job> as Job);
    const savedPickup = await this.jobsRepo.save(pickupJob);

    // 5. Generate invoice
    const invoiceNumber = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`, [tenantId],
    );
    const invNum = invoiceNumber[0].num;
    const isPaid = body.paymentMethod === 'card';
    const today = new Date().toISOString().split('T')[0];
    const taxAmt = body.taxAmount || 0;

    const invoice = this.invoicesRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: savedDelivery.id,
      invoice_number: invNum,
      status: 'draft',
      customer_type: 'residential',
      invoice_date: today,
      due_date: body.deliveryDate,
      service_date: body.deliveryDate,
      subtotal: body.basePrice + body.deliveryFee,
      tax_amount: taxAmt,
      total: body.totalPrice,
      amount_paid: 0,
      balance_due: body.totalPrice,
      summary_of_work: `${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental`,
      rental_chain_id: null,
    } as Partial<Invoice> as Invoice);
    const savedInvoice = await this.invoicesRepo.save(invoice);

    // Pricing snapshot for historical accuracy
    try {
      const pricingRule = await this.dataSource.getRepository(PricingRule).findOne({
        where: { tenant_id: tenantId, asset_subtype: body.assetSubtype, is_active: true },
      });
      if (pricingRule) {
        const snapshot = {
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
          distanceMiles: 0, // Haversine distance not passed from frontend; charge is accurate
        };
        await this.invoicesRepo.update(savedInvoice.id, {
          pricing_rule_snapshot: snapshot,
          pricing_tier_used: 'global',
        } as Partial<Invoice>);
      }
    } catch { /* non-fatal */ }

    // Create line items
    const rentalItem = this.lineItemRepo.create({
      invoice_id: savedInvoice.id,
      sort_order: 0,
      line_type: 'rental',
      name: `${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental`,
      quantity: 1,
      unit_rate: body.basePrice,
      amount: body.basePrice,
      net_amount: body.basePrice,
    });
    await this.lineItemRepo.save(rentalItem);

    if (body.deliveryFee > 0) {
      const distanceItem = this.lineItemRepo.create({
        invoice_id: savedInvoice.id,
        sort_order: 1,
        line_type: 'fee',
        name: 'Distance charge',
        quantity: 1,
        unit_rate: body.deliveryFee,
        amount: body.deliveryFee,
        net_amount: body.deliveryFee,
        is_taxable: false,
        tax_rate: 0,
        tax_amount: 0,
      });
      await this.lineItemRepo.save(distanceItem);
    }

    // 5b. If paid by card, create a Payment record and reconcile
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

    // 5c. Opt-in invoice send — only if explicitly requested and not card-paid
    if (!isPaid && body.sendInvoiceNow) {
      await this.invoicesRepo.update(savedInvoice.id, { sent_at: new Date(), sent_method: 'email' });

      // Send email to customer if they have one
      const customer = await this.customersRepo.findOne({ where: { id: customerId } });
      if (customer?.email) {
        try {
          await this.notificationsService.send(tenantId, {
            channel: 'email',
            type: 'invoice_sent',
            recipient: customer.email,
            subject: `Invoice #${invNum} from your service provider`,
            body: `<p>Hello ${customer.first_name},</p><p>Invoice <strong>#${invNum}</strong> for <strong>$${body.totalPrice.toFixed(2)}</strong> has been sent to you.</p><p>Due date: ${body.deliveryDate}</p><p>Summary: ${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental</p>`,
            customerId: customerId,
          });
        } catch (err) {
          this.logger.warn(`Failed to send invoice email for #${invNum}: ${err}`);
        }
      }
    }

    // Derive status/balance from payment records (reconcileBalance pattern)
    {
      const paymentRepo = this.dataSource.getRepository(Payment);
      const payments = await paymentRepo.find({ where: { invoice_id: savedInvoice.id, status: 'completed' } });
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const balanceDue = Math.max(Math.round((body.totalPrice - totalPaid) * 100) / 100, 0);
      const inv = await this.invoicesRepo.findOneOrFail({ where: { id: savedInvoice.id } });
      let status: string;
      if (totalPaid >= body.totalPrice && totalPaid > 0) status = 'paid';
      else if (totalPaid > 0) status = 'partial';
      else if (inv.sent_at) status = 'open';
      else status = 'draft';
      await this.invoicesRepo.update(savedInvoice.id, {
        amount_paid: Math.round(totalPaid * 100) / 100,
        balance_due: balanceDue,
        status,
        paid_at: status === 'paid' ? new Date() : null,
      });
    }

    // 6. Create RentalChain and TaskChainLinks
    let rentalChainId: string | null = null;
    try {
      const rentalChain = this.rentalChainRepo.create({
        tenant_id: tenantId,
        customer_id: customerId,
        drop_off_date: body.deliveryDate,
        expected_pickup_date: body.pickupDate,
        dumpster_size: body.assetSubtype,
        rental_days: body.rentalDays,
        status: 'active',
      });
      const savedChain = await this.rentalChainRepo.save(rentalChain);
      rentalChainId = savedChain.id;

      // Link invoice to rental chain
      await this.invoicesRepo.update(savedInvoice.id, { rental_chain_id: savedChain.id });

      const deliveryLink = this.taskChainLinkRepo.create({
        rental_chain_id: savedChain.id,
        job_id: savedDelivery.id,
        sequence_number: 1,
        task_type: 'drop_off',
        status: 'scheduled',
        scheduled_date: body.deliveryDate,
      });
      const savedDeliveryLink = await this.taskChainLinkRepo.save(deliveryLink);

      const pickupLink = this.taskChainLinkRepo.create({
        rental_chain_id: savedChain.id,
        job_id: savedPickup.id,
        sequence_number: 2,
        task_type: 'pick_up',
        status: 'scheduled',
        scheduled_date: body.pickupDate,
        previous_link_id: savedDeliveryLink.id,
      });
      await this.taskChainLinkRepo.save(pickupLink);

      // Update delivery link with next_link_id
      await this.taskChainLinkRepo.update(savedDeliveryLink.id, { next_link_id: pickupLink.id });
    } catch {
      this.logger.warn(`Failed to create rental chain for booking — non-fatal`);
    }

    // 7. Schedule delivery reminder notification (best-effort)
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
      assetWarning,
    };
  }
}
