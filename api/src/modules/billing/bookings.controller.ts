import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DataSource } from 'typeorm';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(
    @InjectRepository(Customer) private customersRepo: Repository<Customer>,
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    @InjectRepository(Asset) private assetsRepo: Repository<Asset>,
    @InjectRepository(Invoice) private invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(Tenant) private tenantsRepo: Repository<Tenant>,
    private dataSource: DataSource,
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
    const invoiceNumber = await this.dataSource.query(
      `SELECT next_invoice_number($1) as num`, [tenantId],
    );
    const invNum = invoiceNumber[0].num;
    const isPaid = body.paymentMethod === 'card';
    const today = new Date().toISOString().split('T')[0];

    const invoice = this.invoicesRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: savedDelivery.id,
      invoice_number: invNum,
      status: isPaid ? 'paid' : 'sent',
      customer_type: 'residential',
      invoice_date: today,
      due_date: body.deliveryDate,
      service_date: body.deliveryDate,
      subtotal: body.basePrice + body.deliveryFee,
      tax_amount: body.taxAmount,
      total: body.totalPrice,
      amount_paid: isPaid ? body.totalPrice : 0,
      balance_due: isPaid ? 0 : body.totalPrice,
      paid_at: isPaid ? new Date() : null,
      summary_of_work: `${body.assetSubtype} ${body.serviceType.replace(/_/g, ' ')} — ${body.rentalDays}-day rental`,
    } as Partial<Invoice> as Invoice);
    const savedInvoice = await this.invoicesRepo.save(invoice);

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
      const deliveryItem = this.lineItemRepo.create({
        invoice_id: savedInvoice.id,
        sort_order: 1,
        line_type: 'fee',
        name: 'Delivery fee',
        quantity: 1,
        unit_rate: body.deliveryFee,
        amount: body.deliveryFee,
        net_amount: body.deliveryFee,
      });
      await this.lineItemRepo.save(deliveryItem);
    }

    return {
      success: true,
      deliveryJob: { id: savedDelivery.id, jobNumber: savedDelivery.job_number },
      pickupJob: { id: savedPickup.id, jobNumber: savedPickup.job_number },
      invoice: { id: savedInvoice.id, invoiceNumber: savedInvoice.invoice_number },
      customerId,
      autoApproved,
      asset: assignedAsset,
      assetWarning,
    };
  }
}
