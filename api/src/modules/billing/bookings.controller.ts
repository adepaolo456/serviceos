import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from './entities/invoice.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    @InjectRepository(Asset) private assetsRepo: Repository<Asset>,
    @InjectRepository(Invoice) private invoicesRepo: Repository<Invoice>,
    @InjectRepository(Tenant) private tenantsRepo: Repository<Tenant>,
  ) {}

  @Post('complete')
  async completeBooking(
    @Req() req: Request,
    @Body()
    body: {
      // Customer
      customerId?: string;
      customer?: {
        firstName: string;
        lastName: string;
        email?: string;
        phone?: string;
        type?: string;
        companyName?: string;
        billingAddress?: Record<string, unknown>;
      };
      // Service
      serviceType: string;
      assetSubtype: string;
      serviceAddress: Record<string, unknown>;
      // Schedule
      deliveryDate: string;
      pickupDate: string;
      rentalDays: number;
      scheduledWindowStart?: string;
      scheduledWindowEnd?: string;
      placementNotes?: string;
      // Pricing
      basePrice: number;
      deliveryFee: number;
      taxAmount: number;
      totalPrice: number;
      depositAmount?: number;
      // Payment
      paymentMethod: 'card' | 'invoice';
      stripeToken?: string;
    },
  ) {
    const user = req.user as { tenantId: string; sub: string };
    const tenantId = user.tenantId;

    // 1. Create or find customer
    let customerId = body.customerId;
    if (!customerId && body.customer) {
      const c = this.customersRepo.create({
        tenant_id: tenantId,
        type: body.customer.type || 'residential',
        first_name: body.customer.firstName,
        last_name: body.customer.lastName,
        email: body.customer.email,
        phone: body.customer.phone,
        company_name: body.customer.companyName,
        billing_address: body.customer.billingAddress as Record<string, string>,
      });
      const saved = await this.customersRepo.save(c);
      customerId = saved.id;
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
      // Check if an asset is available NOW
      const availableAsset = await this.assetsRepo.findOne({
        where: { tenant_id: tenantId, subtype: body.assetSubtype, status: 'available' },
      });

      if (availableAsset) {
        // Asset available now — auto-approve + assign + reserve
        autoApproved = true;
        jobStatus = 'confirmed';
        assignedAsset = { id: availableAsset.id, identifier: availableAsset.identifier };
        await this.assetsRepo.update(availableAsset.id, { status: 'reserved' });
      } else {
        // Check if a pickup is scheduled before delivery date that would free one up
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
    } catch { /* non-fatal — default to pending */ }

    // 3b. Create delivery job with auto-approved status
    const deliveryJob = this.jobsRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_number: deliveryNumber,
      job_type: 'delivery',
      service_type: body.serviceType,
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
    const invNumber = `INV-${dateStr}-${rand}`;
    const invoice = this.invoicesRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: savedDelivery.id,
      invoice_number: invNumber,
      status: body.paymentMethod === 'card' ? 'paid' : 'sent',
      source: 'booking',
      invoice_type: 'rental',
      payment_method: body.paymentMethod || 'card',
      subtotal: body.basePrice + body.deliveryFee,
      tax_rate: body.taxAmount > 0 ? body.taxAmount / (body.basePrice + body.deliveryFee) : 0,
      tax_amount: body.taxAmount,
      total: body.totalPrice,
      amount_paid: body.paymentMethod === 'card' ? body.totalPrice : 0,
      balance_due: body.paymentMethod === 'card' ? 0 : body.totalPrice,
      due_date: body.deliveryDate,
      line_items: [
        {
          description: `${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental`,
          quantity: 1,
          unitPrice: body.basePrice,
          amount: body.basePrice,
        },
        ...(body.deliveryFee > 0
          ? [{ description: 'Delivery fee', quantity: 1, unitPrice: body.deliveryFee, amount: body.deliveryFee }]
          : []),
      ],
    } as Partial<Invoice> as Invoice);
    const savedInvoice = await this.invoicesRepo.save(invoice);

    // 6. TODO: Process Stripe payment if card
    // 7. TODO: Send confirmation email

    return {
      success: true,
      deliveryJob: {
        id: savedDelivery.id,
        jobNumber: savedDelivery.job_number,
      },
      pickupJob: {
        id: savedPickup.id,
        jobNumber: savedPickup.job_number,
      },
      invoice: {
        id: savedInvoice.id,
        invoiceNumber: savedInvoice.invoice_number,
      },
      customerId,
      autoApproved,
      asset: assignedAsset,
      assetWarning,
    };
  }
}
