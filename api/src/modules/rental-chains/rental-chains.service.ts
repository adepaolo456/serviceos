import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RentalChain } from './entities/rental-chain.entity';
import { TaskChainLink } from './entities/task-chain-link.entity';
import { Job } from '../jobs/entities/job.entity';
import { CreateRentalChainDto } from './dto/create-rental-chain.dto';

@Injectable()
export class RentalChainsService {
  constructor(
    @InjectRepository(RentalChain)
    private chainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink)
    private linkRepo: Repository<TaskChainLink>,
    @InjectRepository(Job)
    private jobRepo: Repository<Job>,
  ) {}

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

    const chain = await this.chainRepo.findOne({
      where: { id: link.rental_chain_id },
    });
    if (!chain) return;

    // ── EXCHANGE → PICK_UP: collapse the chain ──
    if (
      oldType.includes('exchange') &&
      (newType.includes('pick_up') || newType.includes('pickup'))
    ) {
      // Cancel the next link (auto-scheduled pickup for new dumpster after exchange)
      if (link.next_link_id) {
        const nextLink = await this.linkRepo.findOne({
          where: { id: link.next_link_id },
        });
        if (nextLink && nextLink.status !== 'cancelled') {
          nextLink.status = 'cancelled';
          await this.linkRepo.save(nextLink);
          await this.jobRepo.update(nextLink.job_id, {
            status: 'cancelled',
            cancelled_at: new Date(),
          });
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
        await this.jobRepo.update(currentPickup.job_id, {
          status: 'cancelled',
          cancelled_at: new Date(),
        });
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

  async findAll(tenantId: string) {
    return this.chainRepo.find({
      where: { tenant_id: tenantId },
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
}
