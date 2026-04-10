import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../../rental-chains/entities/task-chain-link.entity';

/* ------------------------------------------------------------------ */
/*  Input / output contracts                                           */
/* ------------------------------------------------------------------ */

export interface BookingCompletionParams {
  tenantId: string;
  customerId: string;
  dumpsterSize: string;
  serviceType: string;
  deliveryDate: string;
  pickupDate: string;
  rentalDays: number;
  siteAddress: Record<string, any>;
  basePrice: number;
  distanceSurcharge: number;
  totalPrice: number;
  taxAmount?: number;
  placementNotes?: string;
  pricingSnapshot?: Record<string, any>;
  pricingTierUsed?: string;
  source?: string;
}

export interface BookingCompletionResult {
  deliveryJob: Job;
  pickupJob: Job;
  invoice: Invoice;
  rentalChainId: string | null;
  autoApproved: boolean;
  assignedAsset: { id: string; identifier: string } | null;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class BookingCompletionService {
  private readonly logger = new Logger(BookingCompletionService.name);

  constructor(
    @InjectRepository(Job) private jobsRepo: Repository<Job>,
    @InjectRepository(Asset) private assetsRepo: Repository<Asset>,
    @InjectRepository(Invoice) private invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(RentalChain) private rentalChainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink) private taskChainLinkRepo: Repository<TaskChainLink>,
    private dataSource: DataSource,
  ) {}

  /**
   * Core booking completion logic shared between BookingWizard and orchestration.
   * Caller is responsible for: customer creation, pricing resolution, payment, notifications.
   * Accepts optional EntityManager for transaction support.
   */
  async completeBooking(
    params: BookingCompletionParams,
    manager?: EntityManager,
  ): Promise<BookingCompletionResult> {
    const jobRepo = manager?.getRepository(Job) ?? this.jobsRepo;
    const assetRepo = manager?.getRepository(Asset) ?? this.assetsRepo;
    const invoiceRepo = manager?.getRepository(Invoice) ?? this.invoicesRepo;
    const lineItemRepo = manager?.getRepository(InvoiceLineItem) ?? this.lineItemRepo;
    const rentalChainRepo = manager?.getRepository(RentalChain) ?? this.rentalChainRepo;
    const taskChainLinkRepo = manager?.getRepository(TaskChainLink) ?? this.taskChainLinkRepo;
    const querySource = manager ?? this.dataSource;

    const {
      tenantId, customerId, dumpsterSize, serviceType, deliveryDate,
      pickupDate, rentalDays, siteAddress, basePrice, distanceSurcharge,
      totalPrice, taxAmount, placementNotes, pricingSnapshot, pricingTierUsed,
    } = params;

    // 1. Generate job numbers
    const dateStr = deliveryDate.replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    const deliveryNumber = `JOB-${dateStr}-${rand}`;
    const pickupNumber = `JOB-${pickupDate.replace(/-/g, '')}-${rand}P`;

    // 2. Asset availability check + auto-approve
    let autoApproved = false;
    let assignedAsset: { id: string; identifier: string } | null = null;
    let jobStatus = 'pending';

    try {
      const availableAsset = await assetRepo.findOne({
        where: { tenant_id: tenantId, subtype: dumpsterSize, status: 'available' },
      });
      if (availableAsset) {
        autoApproved = true;
        jobStatus = 'confirmed';
        assignedAsset = { id: availableAsset.id, identifier: availableAsset.identifier };
        await assetRepo.update(availableAsset.id, { status: 'reserved' });
      } else {
        const pickupCount = await jobRepo
          .createQueryBuilder('j')
          .where('j.tenant_id = :tenantId', { tenantId })
          .andWhere('j.job_type = :type', { type: 'pickup' })
          .andWhere('j.status NOT IN (:...ex)', { ex: ['completed', 'cancelled'] })
          .andWhere('j.scheduled_date <= :date', { date: deliveryDate })
          .getCount();
        if (pickupCount > 0) {
          autoApproved = true;
          jobStatus = 'confirmed';
        }
      }
    } catch { /* non-fatal */ }

    // 3. Create delivery job
    const deliveryJob = jobRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_number: deliveryNumber,
      job_type: 'delivery',
      service_type: serviceType,
      asset_subtype: dumpsterSize,
      status: jobStatus,
      priority: 'normal',
      source: params.source ?? 'phone',
      scheduled_date: deliveryDate,
      service_address: siteAddress as Record<string, string>,
      placement_notes: placementNotes,
      base_price: basePrice,
      total_price: totalPrice,
      rental_days: rentalDays,
      ...(assignedAsset ? { asset_id: assignedAsset.id } : {}),
    } as Partial<Job> as Job);
    const savedDelivery = await jobRepo.save(deliveryJob);

    // 4. Create pickup job
    const pickupJob = jobRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_number: pickupNumber,
      job_type: 'pickup',
      service_type: serviceType,
      asset_subtype: dumpsterSize,
      status: 'pending',
      priority: 'normal',
      source: params.source ?? 'phone',
      scheduled_date: pickupDate,
      service_address: siteAddress as Record<string, string>,
      base_price: 0,
      total_price: 0,
      ...(assignedAsset ? { asset_id: assignedAsset.id } : {}),
    } as Partial<Job> as Job);
    const savedPickup = await jobRepo.save(pickupJob);

    // 5. Generate invoice
    const invoiceNumber = await (querySource as any).query(
      `SELECT next_invoice_number($1) as num`, [tenantId],
    );
    const invNum = invoiceNumber[0].num;
    const today = new Date().toISOString().split('T')[0];
    const rentalTotal = basePrice + distanceSurcharge;
    const serviceLabel = serviceType.replace(/_/g, ' ');

    const invoice = invoiceRepo.create({
      tenant_id: tenantId,
      customer_id: customerId,
      job_id: savedDelivery.id,
      invoice_number: invNum,
      status: 'open',
      customer_type: 'residential',
      invoice_date: today,
      due_date: deliveryDate,
      service_date: deliveryDate,
      subtotal: rentalTotal,
      tax_amount: taxAmount || 0,
      total: totalPrice,
      amount_paid: 0,
      balance_due: totalPrice,
      summary_of_work: `${dumpsterSize} ${serviceLabel} — ${rentalDays}-day rental`,
      rental_chain_id: null,
    } as Partial<Invoice> as Invoice);
    const savedInvoice = await invoiceRepo.save(invoice);

    // 6. Pricing snapshot
    if (pricingSnapshot) {
      try {
        await invoiceRepo.update(savedInvoice.id, {
          pricing_rule_snapshot: pricingSnapshot,
          pricing_tier_used: pricingTierUsed || 'global',
        } as Partial<Invoice>);
      } catch { /* non-fatal */ }
    }

    // 7. Single rental line item (distance folded in)
    const rentalItem = lineItemRepo.create({
      invoice_id: savedInvoice.id,
      sort_order: 0,
      line_type: 'rental',
      name: `${dumpsterSize} ${serviceLabel} — ${rentalDays}-day rental`,
      quantity: 1,
      unit_rate: rentalTotal,
      amount: rentalTotal,
      net_amount: rentalTotal,
    });
    await lineItemRepo.save(rentalItem);

    // 8. Create rental chain + task chain links
    let rentalChainId: string | null = null;
    try {
      const rentalChain = rentalChainRepo.create({
        tenant_id: tenantId,
        customer_id: customerId,
        drop_off_date: deliveryDate,
        expected_pickup_date: pickupDate,
        dumpster_size: dumpsterSize,
        rental_days: rentalDays,
        status: 'active',
      });
      const savedChain = await rentalChainRepo.save(rentalChain);
      rentalChainId = savedChain.id;

      await invoiceRepo.update(savedInvoice.id, { rental_chain_id: savedChain.id });

      const deliveryLink = taskChainLinkRepo.create({
        rental_chain_id: savedChain.id,
        job_id: savedDelivery.id,
        sequence_number: 1,
        task_type: 'drop_off',
        status: 'scheduled',
        scheduled_date: deliveryDate,
      });
      const savedDeliveryLink = await taskChainLinkRepo.save(deliveryLink);

      const pickupLink = taskChainLinkRepo.create({
        rental_chain_id: savedChain.id,
        job_id: savedPickup.id,
        sequence_number: 2,
        task_type: 'pick_up',
        status: 'scheduled',
        scheduled_date: pickupDate,
        previous_link_id: savedDeliveryLink.id,
      });
      const savedPickupLink = await taskChainLinkRepo.save(pickupLink);

      await taskChainLinkRepo.update(savedDeliveryLink.id, { next_link_id: savedPickupLink.id });
    } catch {
      this.logger.warn('Failed to create rental chain — non-fatal');
    }

    return {
      deliveryJob: savedDelivery,
      pickupJob: savedPickup,
      invoice: savedInvoice,
      rentalChainId,
      autoApproved,
      assignedAsset,
    };
  }
}
