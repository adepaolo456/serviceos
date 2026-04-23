import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreateRentalChainDto } from './dto/create-rental-chain.dto';
import { UpdateRentalChainDto } from './dto/update-rental-chain.dto';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { RescheduleExchangeDto } from './dto/reschedule-exchange.dto';
import { RentalChainLifecycleResponseDto } from './dto/lifecycle-response.dto';
import { issueNextJobNumber } from '../../common/utils/job-number.util';
import { getTenantRentalDays } from '../../common/utils/tenant-rental-days.util';
// Path α — lifecycle exchanges reuse the existing pricing engine +
// canonical billing path so they price/invoice identically to
// booking-wizard exchanges.
import { PricingService } from '../pricing/pricing.service';
import { BillingService } from '../billing/billing.service';

/**
 * Result of `createExchange`. Contains the updated chain plus explicit
 * references to the two newly-created jobs. Callers that need the jobs
 * (e.g. JobsService.scheduleNextTask and JobsService.exchangeFromRental
 * when delegating) read them directly instead of re-querying the DB
 * with heuristics like "most recent created_at" or "highest
 * sequence_number" — that pattern is fragile and was explicitly
 * rejected during the Path-B/Path-γ consolidation audit.
 *
 * `exchange` = the new exchange job (the dumpster swap itself)
 * `pickup`   = the fresh pickup job appended after the exchange
 *
 * Callers that only need the chain (e.g. the controller at
 * rental-chains.controller.ts) destructure `{ chain }` and discard
 * `createdJobs` so the over-the-wire response preserves the prior
 * `RentalChain` contract exactly.
 */
export interface CreateExchangeResult {
  chain: RentalChain;
  createdJobs: {
    exchange: Job;
    pickup: Job;
  };
}

// ── Date helpers (UTC, date-only) ──
function shiftDateStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Canonical rental duration helper. Promoted to an `export` in
 * Phase 16 so JobsService.updatePickupDate can reuse the exact
 * same calculation without duplicating the formula. Zero
 * behavior change for existing in-file callers.
 */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

const CORRECTION_CUTOFF = '2026-04-02T00:00:00Z';
function classifyRecord(createdAt: string | Date): 'legacy' | 'post-correction' {
  return new Date(createdAt) < new Date(CORRECTION_CUTOFF) ? 'legacy' : 'post-correction';
}

@Injectable()
export class RentalChainsService {
  constructor(
    @InjectRepository(RentalChain)
    private chainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private linkRepo: Repository<TaskChainLink>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
    @InjectRepository(TenantSettings)
    private tenantSettingsRepo: Repository<TenantSettings>,
    private dataSource: DataSource,
    // Path α injections — no new repos needed; both services are
    // already exported from their modules (see rental-chains.module.ts).
    private pricingService: PricingService,
    private billingService: BillingService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // CREATE CHAIN
  // ─────────────────────────────────────────────────────────

  async createChain(tenantId: string, dto: CreateRentalChainDto) {
    const rentalDays =
      dto.rental_days ??
      (await getTenantRentalDays(this.tenantSettingsRepo, tenantId));

    // Calculate expected pickup date
    const dropOff = new Date(dto.drop_off_date);
    const pickupDate = new Date(dropOff);
    pickupDate.setDate(pickupDate.getDate() + rentalDays);
    const expectedPickupDate = pickupDate.toISOString().split('T')[0];

    // Create the chain
    const chain = this.chainRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      asset_id: dto.asset_id || null,
      drop_off_date: dto.drop_off_date,
      expected_pickup_date: expectedPickupDate,
      pricing_rule_id: dto.pricing_rule_id || null,
      dumpster_size: dto.dumpster_size,
      rental_days: rentalDays,
      status: 'active',
    });
    const savedChain = await this.chainRepo.save(chain);

    // Create drop-off job
    const dropOffJobNumber = await issueNextJobNumber(this.dataSource.manager, tenantId, 'delivery');

    const dropOffJob = this.jobRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      job_number: dropOffJobNumber,
      job_type: 'delivery',
      service_type: 'dumpster_rental',
      asset_subtype: dto.dumpster_size,
      status: 'pending',
      priority: 'normal',
      scheduled_date: dto.drop_off_date,
      rental_days: rentalDays,
      rental_start_date: dto.drop_off_date,
      rental_end_date: expectedPickupDate,
      asset_id: dto.asset_id || null,
    } as Partial<Job> as Job);
    const savedDropOff = await this.jobRepo.save(dropOffJob);

    // Create pickup job
    const pickupJobNumber = await issueNextJobNumber(this.dataSource.manager, tenantId, 'pickup');
    const pickupJob = this.jobRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      job_number: pickupJobNumber,
      job_type: 'pickup',
      service_type: 'dumpster_rental',
      asset_subtype: dto.dumpster_size,
      status: 'pending',
      priority: 'normal',
      scheduled_date: expectedPickupDate,
      asset_id: dto.asset_id || null,
      parent_job_id: savedDropOff.id,
    } as Partial<Job> as Job);
    const savedPickup = await this.jobRepo.save(pickupJob);

    // Create task chain links
    const dropOffLink = this.linkRepo.create({
      rental_chain_id: savedChain.id,
      job_id: savedDropOff.id,
      sequence_number: 1,
      task_type: 'drop_off',
      status: 'scheduled',
      scheduled_date: dto.drop_off_date,
    });
    const savedDropOffLink = await this.linkRepo.save(dropOffLink);

    const pickupLink = this.linkRepo.create({
      rental_chain_id: savedChain.id,
      job_id: savedPickup.id,
      sequence_number: 2,
      task_type: 'pick_up',
      status: 'scheduled',
      scheduled_date: expectedPickupDate,
      previous_link_id: savedDropOffLink.id,
    });
    const savedPickupLink = await this.linkRepo.save(pickupLink);

    // Bidirectional link
    savedDropOffLink.next_link_id = savedPickupLink.id;
    await this.linkRepo.save(savedDropOffLink);

    return this.findOne(tenantId, savedChain.id);
  }

  // ─────────────────────────────────────────────────────────
  // HANDLE TYPE CHANGE (exchange ↔ pickup chain reactions)
  // ─────────────────────────────────────────────────────────

  async handleTypeChange(
    tenantId: string,
    jobId: string,
    oldType: string,
    newType: string,
  ) {
    const link = await this.linkRepo.findOne({ where: { job_id: jobId } });
    if (!link) return; // Job isn't part of a chain

    // Verify the parent chain belongs to this tenant (task_chain_links has no tenant_id column)
    const chain = await this.chainRepo.findOne({
      where: { id: link.rental_chain_id, tenant_id: tenantId },
    });
    if (!chain) return;

    // ── EXCHANGE → PICK_UP: collapse the chain ──
    if (
      oldType.includes('exchange') &&
      (newType.includes('pick_up') || newType.includes('pickup'))
    ) {
      // Cancel the next link (auto-scheduled pickup for new dumpster after exchange).
      // Chain ownership already validated above; nextLink is within the same chain.
      if (link.next_link_id) {
        const nextLink = await this.linkRepo.findOne({
          where: { id: link.next_link_id, rental_chain_id: chain.id },
        });
        if (nextLink && nextLink.status !== 'cancelled') {
          nextLink.status = 'cancelled';
          await this.linkRepo.save(nextLink);
          await this.jobRepo.update(
            { id: nextLink.job_id, tenant_id: tenantId },
            {
              status: 'cancelled',
              cancelled_at: new Date(),
              cancellation_reason: 'exchange_replacement',
            },
          );
        }
      }

      // This link becomes the terminal pickup
      link.next_link_id = null;
      link.task_type = 'pick_up';
      await this.linkRepo.save(link);

      chain.actual_pickup_date = link.scheduled_date;

      // Check if all non-cancelled links are completed or this is the last scheduled
      const scheduledCount = await this.linkRepo.count({
        where: {
          rental_chain_id: chain.id,
          status: 'scheduled',
        },
      });
      if (scheduledCount <= 1) {
        chain.status = 'completed';
      }
      await this.chainRepo.save(chain);
    }

    // ── Adding an EXCHANGE to an existing chain ──
    if (newType.includes('exchange') && !oldType.includes('exchange')) {
      // Cancel the current scheduled pickup
      const currentPickup = await this.linkRepo.findOne({
        where: {
          rental_chain_id: chain.id,
          task_type: 'pick_up',
          status: 'scheduled',
        },
      });

      if (currentPickup) {
        currentPickup.status = 'cancelled';
        await this.linkRepo.save(currentPickup);
        await this.jobRepo.update(
          { id: currentPickup.job_id, tenant_id: tenantId },
          {
            status: 'cancelled',
            cancelled_at: new Date(),
            cancellation_reason: 'exchange_replacement',
          },
        );
      }

      // Get max sequence number
      const maxSeqResult = await this.linkRepo
        .createQueryBuilder('l')
        .select('MAX(l.sequence_number)', 'max')
        .where('l.rental_chain_id = :chainId', { chainId: chain.id })
        .getRawOne();
      const nextSeq = (Number(maxSeqResult?.max) || 0) + 1;

      // Create exchange link (reuse the existing job)
      const exchangeLink = this.linkRepo.create({
        rental_chain_id: chain.id,
        job_id: jobId,
        sequence_number: nextSeq,
        task_type: 'exchange',
        status: 'scheduled',
        scheduled_date: link.scheduled_date,
        previous_link_id: link.id,
      });
      const savedExchangeLink = await this.linkRepo.save(exchangeLink);

      // New pickup = exchange date + rental days
      const exchangeDate = new Date(link.scheduled_date);
      const newPickupDate = new Date(exchangeDate);
      newPickupDate.setDate(newPickupDate.getDate() + chain.rental_days);
      const newPickupDateStr = newPickupDate.toISOString().split('T')[0];

      // Create new pickup job
      const newPickupJob = this.jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: await issueNextJobNumber(this.dataSource.manager, tenantId, 'pickup'),
        job_type: 'pickup',
        service_type: 'dumpster_rental',
        asset_subtype: chain.dumpster_size,
        status: 'pending',
        priority: 'normal',
        scheduled_date: newPickupDateStr,
        asset_id: chain.asset_id || null,
      } as Partial<Job> as Job);
      const savedNewPickup = await this.jobRepo.save(newPickupJob);

      // Create new pickup link
      const newPickupLink = this.linkRepo.create({
        rental_chain_id: chain.id,
        job_id: savedNewPickup.id,
        sequence_number: nextSeq + 1,
        task_type: 'pick_up',
        status: 'scheduled',
        scheduled_date: newPickupDateStr,
        previous_link_id: savedExchangeLink.id,
      });
      const savedNewPickupLink = await this.linkRepo.save(newPickupLink);

      // Bidirectional link: exchange → new pickup
      savedExchangeLink.next_link_id = savedNewPickupLink.id;
      await this.linkRepo.save(savedExchangeLink);

      // Update chain expected pickup
      chain.expected_pickup_date = newPickupDateStr;
      await this.chainRepo.save(chain);
    }
  }

  // ─────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────

  async findAll(tenantId: string, filters?: { customerId?: string; status?: string }) {
    const where: Record<string, any> = { tenant_id: tenantId };
    if (filters?.customerId) where.customer_id = filters.customerId;
    if (filters?.status) where.status = filters.status;
    return this.chainRepo.find({
      where,
      relations: ['links', 'links.job', 'customer', 'asset'],
      order: { created_at: 'DESC' },
    });
  }

  async findOne(tenantId: string, chainId: string) {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
      relations: ['links', 'links.job', 'customer', 'asset'],
    });
    if (!chain)
      throw new NotFoundException(`Rental chain ${chainId} not found`);

    // Sort links by sequence number
    if (chain.links) {
      chain.links.sort((a, b) => a.sequence_number - b.sequence_number);
    }

    return chain;
  }

  async getFinancials(tenantId: string, chainId: string) {
    const chain = await this.chainRepo.findOne({ where: { id: chainId, tenant_id: tenantId } });
    if (!chain) throw new NotFoundException('Rental chain not found');

    // Revenue: sum of all non-voided invoices for this chain
    const revenueResult = await this.chainRepo.manager.query(
      `SELECT COALESCE(SUM(total), 0) as revenue FROM invoices WHERE rental_chain_id = $1 AND tenant_id = $2 AND voided_at IS NULL`,
      [chainId, tenantId],
    );
    // Cost: sum of all job_costs for jobs in this chain (scoped to tenant via job_costs.tenant_id)
    const costResult = await this.chainRepo.manager.query(
      `SELECT COALESCE(SUM(jc.amount), 0) as cost FROM job_costs jc INNER JOIN task_chain_links tcl ON tcl.job_id = jc.job_id WHERE tcl.rental_chain_id = $1 AND jc.tenant_id = $2`,
      [chainId, tenantId],
    );

    const totalRevenue = Number(revenueResult[0]?.revenue || 0);
    const totalCost = Number(costResult[0]?.cost || 0);
    const profit = Math.round((totalRevenue - totalCost) * 100) / 100;
    const marginPercent = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 10000) / 100 : 0;

    return { totalRevenue, totalCost, profit, marginPercent };
  }

  // ─────────────────────────────────────────────────────────
  // UPDATE CHAIN (authoritative lifecycle update path)
  // ─────────────────────────────────────────────────────────

  /**
   * Authoritative lifecycle update. When `expected_pickup_date`
   * changes, the currently-scheduled pickup job's `scheduled_date` is
   * updated in the same transaction so chain + job never drift.
   *
   * Phase 8: `drop_off_date` reschedules the delivery. By default
   * (`shift_downstream !== false`) every downstream exchange/pickup
   * link is shifted by the same day-offset so the rental duration is
   * preserved. If the caller opts out of shifting, the handler
   * validates that no scheduled downstream link sits on/before the
   * new delivery date.
   */
  async updateChain(
    tenantId: string,
    chainId: string,
    dto: UpdateRentalChainDto,
  ): Promise<RentalChain> {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
    });
    if (!chain) throw new NotFoundException(`Rental chain ${chainId} not found`);

    // ── Pre-transaction validation ──
    // When both dates come in together, the pickup validation uses
    // the NEW delivery date.
    const effectiveDelivery = dto.drop_off_date ?? chain.drop_off_date;

    if (dto.expected_pickup_date !== undefined) {
      if (
        effectiveDelivery &&
        dto.expected_pickup_date <= effectiveDelivery
      ) {
        throw new BadRequestException(
          'expected_pickup_date must be after drop_off_date',
        );
      }
    }

    await this.dataSource.transaction(async (trx) => {
      const chainRepo = trx.getRepository(RentalChain);
      const linkRepo = trx.getRepository(TaskChainLink);
      const jobRepo = trx.getRepository(Job);

      // ── Delivery reschedule (runs first so a later
      //     expected_pickup_date update in the same call wins) ──
      if (dto.drop_off_date !== undefined) {
        // Post-Phase-2c Tier A #3 — fail fast when the chain has no
        // currently-scheduled delivery link. Symmetric to the pickup
        // guard on the sibling branch (Follow-Up #1, commit 5a658cc)
        // and to createExchange's guard (Tier A #2, commit 4a3a9e7).
        // Zero side effects on the failed path; any direct API caller
        // attempting to set drop_off_date on a chain without a
        // scheduled delivery lands here. Lookup is scheduled-filtered
        // (the existing unfiltered lookup a few lines down stays
        // untouched — it feeds the downstream-shift logic and the
        // rental_end_date sync that reference the same link row).
        const scheduledDeliveryLink = await linkRepo.findOne({
          where: {
            rental_chain_id: chain.id,
            task_type: 'drop_off',
            status: 'scheduled',
          },
          order: { sequence_number: 'ASC' },
        });
        if (!scheduledDeliveryLink) {
          throw new ConflictException({
            code: 'NO_SCHEDULED_DELIVERY',
            message:
              'Cannot update drop-off date: this rental chain has no scheduled delivery. The delivery may have been cancelled or completed; reopen it or cancel the chain first.',
          });
        }

        const oldDelivery = chain.drop_off_date;
        const newDelivery = dto.drop_off_date;
        const shiftDays =
          oldDelivery && newDelivery
            ? daysBetween(oldDelivery, newDelivery)
            : 0;
        const shiftDownstream = dto.shift_downstream !== false;

        // Update delivery link + job
        const deliveryLink = await linkRepo.findOne({
          where: { rental_chain_id: chain.id, task_type: 'drop_off' },
          order: { sequence_number: 'ASC' },
        });
        if (deliveryLink) {
          deliveryLink.scheduled_date = newDelivery;
          await linkRepo.save(deliveryLink);
          await jobRepo.update(
            { id: deliveryLink.job_id, tenant_id: tenantId },
            {
              scheduled_date: newDelivery,
              rental_start_date: newDelivery,
            },
          );
        }

        // Walk every scheduled (non-cancelled) downstream link
        const allLinks = await linkRepo.find({
          where: { rental_chain_id: chain.id },
          order: { sequence_number: 'ASC' },
        });
        const downstream = allLinks.filter(
          (l) => l.task_type !== 'drop_off' && l.status !== 'cancelled',
        );

        if (shiftDownstream && shiftDays !== 0) {
          for (const l of downstream) {
            if (!l.scheduled_date) continue;
            const shifted = shiftDateStr(l.scheduled_date, shiftDays);
            l.scheduled_date = shifted;
            await linkRepo.save(l);
            await jobRepo.update(
              { id: l.job_id, tenant_id: tenantId },
              { scheduled_date: shifted },
            );
            // Keep delivery job's rental_end_date in sync with the
            // terminal pickup
            if (l.task_type === 'pick_up' && !l.next_link_id && deliveryLink) {
              await jobRepo.update(
                { id: deliveryLink.job_id, tenant_id: tenantId },
                { rental_end_date: shifted },
              );
            }
          }
          if (chain.expected_pickup_date) {
            chain.expected_pickup_date = shiftDateStr(
              chain.expected_pickup_date,
              shiftDays,
            );
          }
        } else {
          // No shift — validate sequencing
          for (const l of downstream) {
            if (l.scheduled_date && l.scheduled_date <= newDelivery) {
              throw new BadRequestException(
                `Cannot move delivery to ${newDelivery}: ${l.task_type} on ${l.scheduled_date} would become invalid`,
              );
            }
          }
        }

        chain.drop_off_date = newDelivery;
      }

      if (dto.expected_pickup_date !== undefined) {
        // Phase 2c Follow-Up — fail fast when the chain has no
        // currently-scheduled pickup link to sync. Previously the
        // chain row was mutated in-memory before this lookup and
        // persisted at the trailing chainRepo.save, so a missing
        // pickup link silently diverged chain.expected_pickup_date
        // from any job.scheduled_date — dispatch/reporting read the
        // job, the operator saw a 200 OK, and the date "moved" only
        // on the chain row. Lookup BEFORE any chain mutation; throw
        // 409 with a stable code/message; the surrounding
        // dataSource.transaction rolls back any earlier drop-off
        // changes from this same call.
        const pickupLink = await linkRepo.findOne({
          where: {
            rental_chain_id: chain.id,
            task_type: 'pick_up',
            status: 'scheduled',
          },
          order: { sequence_number: 'DESC' },
        });

        if (!pickupLink) {
          throw new ConflictException({
            code: 'NO_SCHEDULED_PICKUP',
            message:
              'Cannot update pickup date: this rental chain has no scheduled pickup. Schedule an exchange or reopen the cancelled pickup first.',
          });
        }

        // Lookup confirmed → safe to mutate. Order:
        // (1) chain in-memory, (2) pickup link, (3) pickup job,
        // (4) delivery job rental_end_date. The chain.save fires at
        // the trailing chainRepo.save below.
        chain.expected_pickup_date = dto.expected_pickup_date;

        pickupLink.scheduled_date = dto.expected_pickup_date;
        await linkRepo.save(pickupLink);

        // Update the linked job's scheduled_date — tenant-scoped update
        await jobRepo.update(
          { id: pickupLink.job_id, tenant_id: tenantId },
          { scheduled_date: dto.expected_pickup_date },
        );

        // Keep the delivery job's rental_end_date in sync so the job
        // detail view doesn't show a stale end date.
        const deliveryLink = await linkRepo.findOne({
          where: {
            rental_chain_id: chain.id,
            task_type: 'drop_off',
          },
          order: { sequence_number: 'ASC' },
        });
        if (deliveryLink) {
          await jobRepo.update(
            { id: deliveryLink.job_id, tenant_id: tenantId },
            { rental_end_date: dto.expected_pickup_date },
          );
        }
      }

      if (dto.status !== undefined) {
        chain.status = dto.status;
      }

      await chainRepo.save(chain);
    });

    return this.findOne(tenantId, chainId);
  }

  // ─────────────────────────────────────────────────────────
  // CREATE EXCHANGE (chain-aware)
  // ─────────────────────────────────────────────────────────

  /**
   * Insert an exchange into an existing rental chain. Creates the new
   * exchange job + link, cancels the old scheduled pickup, and appends
   * a fresh pickup link. The new pickup date is computed from
   * `tenant_settings.default_rental_period_days` unless the caller
   * passes an explicit `override_pickup_date`.
   *
   * Chain ordering after this call is guaranteed to be:
   *   ...existing links → exchange(new) → pick_up(new)
   */
  async createExchange(
    tenantId: string,
    chainId: string,
    dto: CreateExchangeDto,
  ): Promise<CreateExchangeResult> {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
    });
    if (!chain) throw new NotFoundException(`Rental chain ${chainId} not found`);

    // Resolve new pickup date: override wins, otherwise exchange_date + tenant rental days
    let newPickupDateStr: string;
    if (dto.override_pickup_date) {
      newPickupDateStr = dto.override_pickup_date;
    } else {
      const rentalDays = await getTenantRentalDays(
        this.tenantSettingsRepo,
        tenantId,
      );
      const d = new Date(dto.exchange_date);
      d.setUTCDate(d.getUTCDate() + rentalDays);
      newPickupDateStr = d.toISOString().split('T')[0];
    }

    // Validate sequencing
    if (newPickupDateStr <= dto.exchange_date) {
      throw new BadRequestException(
        'new pickup date must be after exchange date',
      );
    }
    if (chain.drop_off_date && dto.exchange_date < chain.drop_off_date) {
      throw new BadRequestException(
        'exchange date cannot be before delivery date',
      );
    }

    const size = dto.dumpster_size || chain.dumpster_size;
    const assetId = dto.asset_id ?? chain.asset_id ?? null;

    // ── Path α: price the exchange via the existing pricing engine ──
    // All inputs derived server-side from chain context — zero frontend
    // payload change required. Uses the exact same pricing call the
    // booking wizard uses (`PricingService.calculate` with jobType:
    // 'exchange' + exchange_context), so lifecycle exchange pricing now
    // matches booking-wizard exchange pricing byte-for-byte, including
    // tenant-configured `rule.exchange_fee` discount behavior.
    //
    // Coordinates: sourced from the chain's drop-off job's
    // service_address. When missing/invalid, the pricing engine
    // detects invalid coord pair and falls through with zero distance
    // surcharge — the exchange still gets base_price + fees. Accepted
    // degradation for legacy rows without geocoded addresses.
    //
    // Customer type: loaded from the customer row (residential vs
    // commercial affects rental-period policy). Defaults to
    // 'residential' when absent.
    //
    // rentalDays: computed from the new segment (exchange_date →
    // newPickupDateStr) so extra-day charges price correctly when
    // the operator overrides the pickup.
    //
    // Pricing runs OUTSIDE the write transaction — the call is a pure
    // read over pricing_rules / client_pricing_overrides / tenant_fees
    // / yards. If it throws (e.g. no active rule for the dropoff size),
    // the caller sees the error before any chain mutation occurs —
    // correct by design: we never want an unpriced exchange to land.
    const deliveryLink = await this.linkRepo.findOne({
      where: { rental_chain_id: chain.id, task_type: 'drop_off' },
      relations: ['job'],
      order: { sequence_number: 'ASC' },
    });
    const svcAddr = (deliveryLink?.job?.service_address ?? null) as
      | { lat?: number | string | null; lng?: number | string | null }
      | null;
    const customerLat = Number(svcAddr?.lat) || 0;
    const customerLng = Number(svcAddr?.lng) || 0;

    const customer = await this.dataSource.getRepository(Customer).findOne({
      where: { id: chain.customer_id, tenant_id: tenantId },
    });
    const customerType: 'residential' | 'commercial' =
      customer?.type === 'commercial' ? 'commercial' : 'residential';

    const segmentDays = daysBetween(dto.exchange_date, newPickupDateStr);

    const quote = await this.pricingService.calculate(tenantId, {
      serviceType: 'dumpster_rental',
      assetSubtype: size,
      jobType: 'exchange',
      customerType,
      customerLat,
      customerLng,
      rentalDays: segmentDays,
      customerId: chain.customer_id,
      exchange_context: {
        pickup_asset_subtype: chain.dumpster_size ?? size,
        dropoff_asset_subtype: size,
      },
    });
    const exchangeTotal = Number(quote.breakdown?.total) || 0;
    const exchangeBasePrice = Number(quote.breakdown?.basePrice) || 0;

    return this.dataSource.transaction(async (trx) => {
      const chainRepo = trx.getRepository(RentalChain);
      const linkRepo = trx.getRepository(TaskChainLink);
      const jobRepo = trx.getRepository(Job);

      // 1. Cancel the currently-scheduled pickup (if any)
      const currentPickupLink = await linkRepo.findOne({
        where: {
          rental_chain_id: chain.id,
          task_type: 'pick_up',
          status: 'scheduled',
        },
        order: { sequence_number: 'DESC' },
      });

      // Post-Phase-2c Tier A #2 — fail fast when the chain has no
      // currently-scheduled pickup link. Mirrors Follow-Up #1's
      // guard in updateChain (commit 5a658cc). Any direct API caller
      // bypassing the UI's pickupJob gate (Follow-Up #2, commit c5b75c1)
      // lands here; zero side effects on the failed path (the throw
      // fires before any write inside this transaction, so TypeORM
      // rolls back the no-op transaction cleanly).
      //
      // The former else-branch below (append-to-tail when no pickup
      // exists) becomes unreachable after this guard. Leaving it in
      // place per the prompt's "no refactor beyond the guard" rule;
      // dead-code cleanup is tracked as a follow-up.
      if (!currentPickupLink) {
        throw new ConflictException({
          code: 'NO_SCHEDULED_PICKUP_FOR_EXCHANGE',
          message:
            'Cannot schedule exchange: this rental chain has no scheduled pickup to replace. Reopen the cancelled pickup or cancel the chain first.',
        });
      }

      let previousLinkId: string | null = null;
      let previousSeq = 0;

      // Tier A #2 guard above (commit 4a3a9e7) has proven
      // `currentPickupLink` is non-null. The former
      // `else { /* append to tail */ }` branch was unreachable and
      // has been removed. The body below was previously inside
      // `if (currentPickupLink) { ... }`; unconditional now.
      currentPickupLink.status = 'cancelled';
      await linkRepo.save(currentPickupLink);
      // Phase 10A: stamp the cancellation reason so the job detail
      // page can show "Cancelled due to exchange replacement" and
      // derive replacement tasks from the chain.
      await jobRepo.update(
        { id: currentPickupLink.job_id, tenant_id: tenantId },
        {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancellation_reason: 'exchange_replacement',
        },
      );
      // The exchange must slot in AFTER whatever came before the old pickup
      previousLinkId = currentPickupLink.previous_link_id ?? null;
      previousSeq = currentPickupLink.sequence_number - 1;

      // 2. Create the exchange job. Inside a transaction — pass `trx`
      // so the sequence increment joins the outer transaction and
      // rolls back as a unit if the commit fails later.
      const exchangeJob = jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: await issueNextJobNumber(trx, tenantId, 'exchange'),
        job_type: 'exchange',
        service_type: 'dumpster_rental',
        asset_subtype: size,
        status: 'pending',
        priority: 'normal',
        scheduled_date: dto.exchange_date,
        asset_id: assetId,
      } as Partial<Job> as Job);
      const savedExchangeJob = await jobRepo.save(exchangeJob);

      // 3. Create the exchange link
      const exchangeLink = linkRepo.create({
        rental_chain_id: chain.id,
        job_id: savedExchangeJob.id,
        sequence_number: previousSeq + 1,
        task_type: 'exchange',
        status: 'scheduled',
        scheduled_date: dto.exchange_date,
        previous_link_id: previousLinkId || undefined,
      });
      const savedExchangeLink = await linkRepo.save(exchangeLink);

      // 4. Create the fresh pickup job + link
      const pickupJob = jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: await issueNextJobNumber(trx, tenantId, 'pickup'),
        job_type: 'pickup',
        service_type: 'dumpster_rental',
        asset_subtype: size,
        status: 'pending',
        priority: 'normal',
        scheduled_date: newPickupDateStr,
        asset_id: assetId,
        parent_job_id: savedExchangeJob.id,
      } as Partial<Job> as Job);
      const savedPickupJob = await jobRepo.save(pickupJob);

      const pickupLink = linkRepo.create({
        rental_chain_id: chain.id,
        job_id: savedPickupJob.id,
        sequence_number: previousSeq + 2,
        task_type: 'pick_up',
        status: 'scheduled',
        scheduled_date: newPickupDateStr,
        previous_link_id: savedExchangeLink.id,
      });
      const savedPickupLink = await linkRepo.save(pickupLink);

      // 5. Wire bidirectional next_link_id pointers
      savedExchangeLink.next_link_id = savedPickupLink.id;
      await linkRepo.save(savedExchangeLink);

      if (previousLinkId) {
        // Re-point whatever previously fed into the cancelled pickup
        // to feed into the new exchange.
        await linkRepo.update(
          { id: previousLinkId },
          { next_link_id: savedExchangeLink.id },
        );
      }

      // 6. Update chain-level expected pickup (new pickup is now terminal)
      chain.expected_pickup_date = newPickupDateStr;
      if (dto.dumpster_size) chain.dumpster_size = dto.dumpster_size;
      await chainRepo.save(chain);

      // 7. Path α — persist computed price on the exchange job so
      // the per-job prepayment gate (`enforceJobPrepayment`) no
      // longer short-circuits on `price <= 0`. Mirrors how
      // booking-flow exchange jobs end up priced, but sourced from
      // the same pricing engine response we just computed above.
      await jobRepo.update(
        { id: savedExchangeJob.id, tenant_id: tenantId },
        {
          total_price: exchangeTotal,
          base_price: exchangeBasePrice,
        },
      );
      // Mirror the update onto the in-memory ref so callers that
      // receive `createdJobs.exchange` see fresh pricing without
      // a second round-trip.
      savedExchangeJob.total_price = exchangeTotal;
      savedExchangeJob.base_price = exchangeBasePrice;

      // 8. Path α — create a NEW invoice for the exchange via the
      // canonical billing path. Status defaults to 'open', which is
      // what the existing dispatch prepayment gate
      // (`hasPaidLinkedInvoice`) reads — unpaid lifecycle exchanges
      // now block assignment/dispatch the same way booking-flow
      // unpaid exchanges do. Passing `trx` joins the outer
      // transaction so the invoice + line items commit atomically
      // with the chain writes; a rollback anywhere in this block
      // unwinds everything together.
      //
      // Zero-price exchanges (edge case — e.g. rule base_price = 0
      // on a free promo size) skip invoice creation, matching the
      // booking-flow `if (exchangeFee > 0)` guard.
      if (exchangeTotal > 0) {
        await this.billingService.createInternalInvoice(
          tenantId,
          {
            customerId: chain.customer_id,
            jobId: savedExchangeJob.id,
            source: 'exchange',
            invoiceType: 'exchange',
            status: 'open',
            lineItems: [
              {
                description: 'Dumpster Exchange',
                quantity: 1,
                unitPrice: exchangeTotal,
                amount: exchangeTotal,
              },
            ],
            notes: `Exchange scheduled on rental chain ${chain.id}`,
          },
          trx,
        );
      }

      const updatedChain = await this.findOne(tenantId, chain.id);
      return {
        chain: updatedChain,
        createdJobs: {
          exchange: savedExchangeJob,
          pickup: savedPickupJob,
        },
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // RESCHEDULE EXCHANGE
  // ─────────────────────────────────────────────────────────

  /**
   * Reschedule an existing exchange link. Updates the exchange link
   * + its linked job, then updates the immediately-downstream pickup
   * link (if any, and if still scheduled) to exchange_date + tenant
   * rental days — or to `override_pickup_date` if supplied. When the
   * downstream pickup is the terminal pickup of the chain,
   * `rental_chains.expected_pickup_date` is updated too.
   *
   * Enforces: exchange >= delivery, exchange >= previous-link date,
   * new_pickup > exchange. Tenant-scoped at every step.
   */
  async rescheduleExchange(
    tenantId: string,
    chainId: string,
    linkId: string,
    dto: RescheduleExchangeDto,
  ): Promise<RentalChain> {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
    });
    if (!chain) throw new NotFoundException(`Rental chain ${chainId} not found`);

    const link = await this.linkRepo.findOne({
      where: { id: linkId, rental_chain_id: chain.id },
    });
    if (!link) {
      throw new NotFoundException(
        `Exchange link ${linkId} not found in chain ${chainId}`,
      );
    }
    if (link.task_type !== 'exchange') {
      throw new BadRequestException('link is not an exchange');
    }
    if (link.status === 'cancelled' || link.status === 'completed') {
      throw new BadRequestException(
        `cannot reschedule a ${link.status} exchange`,
      );
    }

    // Sequencing vs delivery
    if (chain.drop_off_date && dto.exchange_date < chain.drop_off_date) {
      throw new BadRequestException(
        'exchange date cannot be before delivery date',
      );
    }

    // Sequencing vs previous link (if not the delivery)
    if (link.previous_link_id) {
      const prev = await this.linkRepo.findOne({
        where: { id: link.previous_link_id, rental_chain_id: chain.id },
      });
      if (
        prev &&
        prev.scheduled_date &&
        dto.exchange_date < prev.scheduled_date
      ) {
        throw new BadRequestException(
          `exchange date cannot be before previous ${prev.task_type} (${prev.scheduled_date})`,
        );
      }
    }

    // Resolve new pickup date: override wins
    let newPickupDateStr: string;
    if (dto.override_pickup_date) {
      newPickupDateStr = dto.override_pickup_date;
    } else {
      const rentalDays = await getTenantRentalDays(
        this.tenantSettingsRepo,
        tenantId,
      );
      newPickupDateStr = shiftDateStr(dto.exchange_date, rentalDays);
    }
    if (newPickupDateStr <= dto.exchange_date) {
      throw new BadRequestException(
        'new pickup date must be after exchange date',
      );
    }

    return this.dataSource.transaction(async (trx) => {
      const chainRepo = trx.getRepository(RentalChain);
      const linkRepo = trx.getRepository(TaskChainLink);
      const jobRepo = trx.getRepository(Job);

      // 1. Update the exchange link + job
      link.scheduled_date = dto.exchange_date;
      await linkRepo.save(link);
      await jobRepo.update(
        { id: link.job_id, tenant_id: tenantId },
        { scheduled_date: dto.exchange_date },
      );

      // 2. Update the downstream pickup (if any, still scheduled)
      if (link.next_link_id) {
        const nextLink = await linkRepo.findOne({
          where: { id: link.next_link_id, rental_chain_id: chain.id },
        });
        if (nextLink && nextLink.status === 'scheduled') {
          nextLink.scheduled_date = newPickupDateStr;
          await linkRepo.save(nextLink);
          await jobRepo.update(
            { id: nextLink.job_id, tenant_id: tenantId },
            { scheduled_date: newPickupDateStr },
          );

          // If the downstream pickup is the terminal pickup of the
          // chain, sync chain.expected_pickup_date too.
          if (nextLink.task_type === 'pick_up' && !nextLink.next_link_id) {
            chain.expected_pickup_date = newPickupDateStr;
            await chainRepo.save(chain);
          }
        }
      }

      return this.findOne(tenantId, chain.id);
    });
  }

  async updateLinkStatus(
    tenantId: string,
    chainId: string,
    linkId: string,
    status: string,
  ) {
    const chain = await this.findOne(tenantId, chainId);
    const link = chain.links?.find((l) => l.id === linkId);
    if (!link)
      throw new NotFoundException(`Link ${linkId} not found in chain`);

    link.status = status;
    if (status === 'completed') {
      link.completed_at = new Date();
    }
    return this.linkRepo.save(link);
  }

  async getLifecycle(
    tenantId: string,
    chainId: string,
  ): Promise<RentalChainLifecycleResponseDto> {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
      relations: ['customer'],
    });
    if (!chain) throw new NotFoundException('Rental chain not found');

    // Get all links with jobs
    const links = await this.linkRepo.find({
      where: { rental_chain_id: chainId },
      relations: ['job', 'job.asset', 'job.assigned_driver'],
      order: { sequence_number: 'ASC' },
    });

    const jobIds = links.map(l => l.job_id).filter(Boolean);

    // Get invoices for this chain
    const invoices = jobIds.length > 0 ? await this.chainRepo.manager.query(
      `SELECT i.*, json_agg(json_build_object('id', li.id, 'line_type', li.line_type, 'name', li.name, 'amount', li.net_amount, 'sort_order', li.sort_order) ORDER BY li.sort_order) as line_items
       FROM invoices i LEFT JOIN invoice_line_items li ON li.invoice_id = i.id
       WHERE (i.rental_chain_id = $1 OR i.job_id = ANY($2)) AND i.tenant_id = $3
       GROUP BY i.id ORDER BY i.created_at`,
      [chainId, jobIds, tenantId],
    ) : [];

    const invoiceIds = invoices.map((i: any) => i.id);

    // Get payments
    const payments = invoiceIds.length > 0 ? await this.chainRepo.manager.query(
      `SELECT * FROM payments WHERE invoice_id = ANY($1) ORDER BY applied_at`,
      [invoiceIds],
    ) : [];

    // Get dump tickets
    const dumpTickets = jobIds.length > 0 ? await this.chainRepo.manager.query(
      `SELECT * FROM dump_tickets WHERE job_id = ANY($1) ORDER BY created_at`,
      [jobIds],
    ) : [];

    // Get job costs
    const jobCosts = jobIds.length > 0 ? await this.chainRepo.manager.query(
      `SELECT * FROM job_costs WHERE job_id = ANY($1) ORDER BY created_at`,
      [jobIds],
    ) : [];

    // Financials
    const financials = await this.getFinancials(tenantId, chainId);

    // Phase 10B — live tenant rental period (NOT chain.rental_days,
    // which is a historical snapshot at creation). The frontend uses
    // this to compute auto-vs-override previews that match what the
    // backend will actually enforce on the next mutation.
    const tenantRentalDays = await getTenantRentalDays(
      this.tenantSettingsRepo,
      tenantId,
    );

    return {
      rentalChain: {
        id: chain.id,
        status: chain.status,
        dumpsterSize: chain.dumpster_size,
        rentalDays: chain.rental_days,
        tenantRentalDays,
        dropOffDate: chain.drop_off_date,
        expectedPickupDate: chain.expected_pickup_date,
        createdAt: chain.created_at,
        classification: classifyRecord(chain.created_at),
      },
      customer: chain.customer ? {
        id: chain.customer.id,
        name: `${chain.customer.first_name} ${chain.customer.last_name}`,
        accountId: chain.customer.account_id,
      } : null,
      jobs: links.map(l => ({
        id: l.job?.id,
        linkId: l.id,
        linkStatus: l.status,
        jobNumber: l.job?.job_number,
        taskType: l.task_type,
        // Phase 2c-Prereq-0 — link.sequence_number (operator-intent
        // ordering within the chain) sourced from the link row, not the
        // job row. Lets the frontend pickup-node selector use the same
        // tiebreak rule LifecycleContextPanel already uses.
        sequence_number: l.sequence_number,
        status: l.job?.status,
        scheduledDate: l.scheduled_date,
        completedAt: l.completed_at,
        asset: l.job?.asset ? { subtype: l.job.asset.subtype, identifier: l.job.asset.identifier } : null,
        driver: l.job?.assigned_driver ? { name: `${l.job.assigned_driver.first_name} ${l.job.assigned_driver.last_name}` } : null,
        classification: l.job ? classifyRecord(l.job.created_at) : null,
      })),
      invoices: invoices.map((i: any) => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        total: Number(i.total),
        status: i.status,
        balanceDue: Number(i.balance_due),
        lineItems: (i.line_items || []).filter((li: any) => li.id),
        pricingSnapshot: i.pricing_rule_snapshot,
        classification: classifyRecord(i.created_at),
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        paymentMethod: p.payment_method,
        appliedAt: p.applied_at,
      })),
      dumpTickets: dumpTickets.map((t: any) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        weightTons: Number(t.weight_tons),
        totalCost: Number(t.total_cost),
        customerCharges: Number(t.customer_charges),
        wasteType: t.waste_type,
      })),
      jobCosts: jobCosts.map((jc: any) => ({
        id: jc.id,
        costType: jc.cost_type,
        amount: Number(jc.amount),
        description: jc.description,
      })),
      financials,
    };
  }
}
