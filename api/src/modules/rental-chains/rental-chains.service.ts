import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import { CreateRentalChainDto } from './dto/create-rental-chain.dto';
import { UpdateRentalChainDto } from './dto/update-rental-chain.dto';
import { CreateExchangeDto } from './dto/create-exchange.dto';

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
  ) {}

  // ─────────────────────────────────────────────────────────
  // TENANT RENTAL RULES
  // ─────────────────────────────────────────────────────────

  /**
   * Resolve the tenant's default rental duration. This is the single
   * source of truth for exchange pickup recalculation — never hardcode
   * 14 days. Falls back to 14 only when the row is absent entirely so
   * new tenants don't 500 before onboarding runs.
   */
  private async getTenantRentalDays(tenantId: string): Promise<number> {
    const settings = await this.tenantSettingsRepo.findOne({
      where: { tenant_id: tenantId },
    });
    const days = settings?.default_rental_period_days;
    return typeof days === 'number' && days > 0 ? days : 14;
  }

  // ─────────────────────────────────────────────────────────
  // CREATE CHAIN
  // ─────────────────────────────────────────────────────────

  async createChain(tenantId: string, dto: CreateRentalChainDto) {
    const rentalDays = dto.rental_days ?? 14;

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
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    const dropOffDateStr = dto.drop_off_date.replace(/-/g, '');

    const dropOffJob = this.jobRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      job_number: `JOB-${dropOffDateStr}-${rand}D`,
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
    const pickupDateStr = expectedPickupDate.replace(/-/g, '');
    const pickupJob = this.jobRepo.create({
      tenant_id: tenantId,
      customer_id: dto.customer_id,
      job_number: `JOB-${pickupDateStr}-${rand}P`,
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
      const dateStr = newPickupDateStr.replace(/-/g, '');
      const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
      const newPickupJob = this.jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: `JOB-${dateStr}-${rand}P`,
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

    if (dto.expected_pickup_date !== undefined) {
      // pickup cannot precede delivery
      if (
        chain.drop_off_date &&
        dto.expected_pickup_date <= chain.drop_off_date
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

      if (dto.expected_pickup_date !== undefined) {
        chain.expected_pickup_date = dto.expected_pickup_date;

        // Find the currently-scheduled terminal pickup link for this chain
        // and keep its job date in sync. A chain with an exchange in flight
        // has multiple pickup links — we only sync the non-cancelled one.
        const pickupLink = await linkRepo.findOne({
          where: {
            rental_chain_id: chain.id,
            task_type: 'pick_up',
            status: 'scheduled',
          },
          order: { sequence_number: 'DESC' },
        });

        if (pickupLink) {
          pickupLink.scheduled_date = dto.expected_pickup_date;
          await linkRepo.save(pickupLink);

          // Update the linked job's scheduled_date — tenant-scoped update
          await jobRepo.update(
            { id: pickupLink.job_id, tenant_id: tenantId },
            { scheduled_date: dto.expected_pickup_date },
          );
        }

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
  ): Promise<RentalChain> {
    const chain = await this.chainRepo.findOne({
      where: { id: chainId, tenant_id: tenantId },
    });
    if (!chain) throw new NotFoundException(`Rental chain ${chainId} not found`);

    // Resolve new pickup date: override wins, otherwise exchange_date + tenant rental days
    let newPickupDateStr: string;
    if (dto.override_pickup_date) {
      newPickupDateStr = dto.override_pickup_date;
    } else {
      const rentalDays = await this.getTenantRentalDays(tenantId);
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

      let previousLinkId: string | null = null;
      let previousSeq = 0;

      if (currentPickupLink) {
        currentPickupLink.status = 'cancelled';
        await linkRepo.save(currentPickupLink);
        await jobRepo.update(
          { id: currentPickupLink.job_id, tenant_id: tenantId },
          { status: 'cancelled', cancelled_at: new Date() },
        );
        // The exchange must slot in AFTER whatever came before the old pickup
        previousLinkId = currentPickupLink.previous_link_id ?? null;
        previousSeq = currentPickupLink.sequence_number - 1;
      } else {
        // No scheduled pickup — append to the tail
        const tail = await linkRepo
          .createQueryBuilder('l')
          .where('l.rental_chain_id = :id', { id: chain.id })
          .orderBy('l.sequence_number', 'DESC')
          .getOne();
        previousLinkId = tail?.id ?? null;
        previousSeq = tail?.sequence_number ?? 0;
      }

      // 2. Create the exchange job
      const exchangeDateStr = dto.exchange_date.replace(/-/g, '');
      const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
      const exchangeJob = jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: `JOB-${exchangeDateStr}-${rand}X`,
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
      const pickupDateStr = newPickupDateStr.replace(/-/g, '');
      const pickupJob = jobRepo.create({
        tenant_id: tenantId,
        customer_id: chain.customer_id,
        job_number: `JOB-${pickupDateStr}-${rand}P`,
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

  async getLifecycle(tenantId: string, chainId: string) {
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

    return {
      rentalChain: {
        id: chain.id,
        status: chain.status,
        dumpsterSize: chain.dumpster_size,
        rentalDays: chain.rental_days,
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
        jobNumber: l.job?.job_number,
        taskType: l.task_type,
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
