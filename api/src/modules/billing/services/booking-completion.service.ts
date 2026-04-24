import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../../rental-chains/entities/task-chain-link.entity';
import { TenantSettings } from '../../tenant-settings/entities/tenant-settings.entity';
import { issueNextJobNumber } from '../../../common/utils/job-number.util';
import type { JobSource } from '../../rental-chains/dto/create-rental-chain.dto';

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
  source?: JobSource;
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

    // 1. Generate job numbers. If the caller passed an outer
    // `manager` (transactional booking-completion path), the sequence
    // increment joins that transaction so rollback-on-failure discards
    // the skipped numbers as a single unit.
    const seqManager = manager ?? this.dataSource.manager;
    const deliveryNumber = await issueNextJobNumber(seqManager, tenantId, 'delivery');
    const pickupNumber = await issueNextJobNumber(seqManager, tenantId, 'pickup');

    // Phase B2 — read the tenant's pre-assignment flag up-front. When
    // enabled, the delivery job's asset_id and the asset's `reserved`
    // status are both left unset at booking time, and the asset is
    // captured at delivery completion via the existing `changeAsset`
    // path + `findCompletionConflict` (Phase B1) guard. Pickup-side
    // pre-assignment is intentionally retained — see step 4 of the
    // B2 spec. Default false for all tenants until explicitly
    // opted in.
    const preAssignmentDisabled =
      await this.isPreAssignmentDisabled(tenantId, manager);

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
        // Phase B2 — only mark the asset `reserved` when pre-
        // assignment is enabled. When disabled the asset stays
        // `available` until the delivery driver captures it on
        // completion, avoiding a state where the asset is reserved
        // for a delivery whose asset_id is null.
        if (!preAssignmentDisabled) {
          await assetRepo.update(availableAsset.id, { status: 'reserved' });
        }
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
      // Phase B2 — delivery-side asset gate. Pickup below is
      // unaffected per the B2 spec (pickup pre-assignment handling
      // is a separate future concern).
      ...((assignedAsset && !preAssignmentDisabled) ? { asset_id: assignedAsset.id } : {}),
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
    //
    // Order is load-bearing: `assignedAsset` is computed in step 2
    // above (auto-assigned available asset for this subtype). We
    // thread its id onto the chain payload FIRST, then run the
    // service-layer guard against the final value. Mirrors the DB
    // CHECK constraint `rental_chain_active_requires_asset` so
    // operators see a clean 400 instead of a raw 500 when no asset
    // was available to auto-assign.
    //
    // Guard + asset-id wiring live OUTSIDE the try/catch below because
    // that catch swallows every error as "non-fatal"; a guard inside
    // would be silently dropped.
    const chainAssetId = assignedAsset?.id ?? null;
    if (!chainAssetId) {
      throw new BadRequestException(
        'chain_activation_requires_asset: Cannot activate rental chain without an asset assigned',
      );
    }

    let rentalChainId: string | null = null;
    try {
      const rentalChain = rentalChainRepo.create({
        tenant_id: tenantId,
        customer_id: customerId,
        asset_id: chainAssetId,
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

  /**
   * Phase B2 — resolve the `pre_assignment_disabled` tenant flag.
   * Mirrors the pattern used by `JobsService.loadTenantTimezone`:
   * no new repo injection, resolved via the DataSource (or the
   * outer transaction manager when one is provided). Null-safe —
   * tenants without a `tenant_settings` row default to `false`,
   * preserving existing behavior until the flag is explicitly set.
   */
  private async isPreAssignmentDisabled(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager
      ? manager.getRepository(TenantSettings)
      : this.dataSource.getRepository(TenantSettings);
    const s = await repo.findOne({ where: { tenant_id: tenantId } });
    return s?.pre_assignment_disabled === true;
  }
}
