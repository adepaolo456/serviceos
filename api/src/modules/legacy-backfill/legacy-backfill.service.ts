import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Customer } from '../customers/entities/customer.entity';
import { RentalChain } from '../rental-chains/entities/rental-chain.entity';
import { TaskChainLink } from '../rental-chains/entities/task-chain-link.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

export type Confidence = 'high' | 'medium' | 'low';

export type InferredChainType =
  | 'delivery_pickup'
  | 'delivery_exchange_pickup'
  | 'delivery_only'
  | 'orphan';

export interface CandidateJob {
  job_id: string;
  job_number: string;
  job_type: string;
  status: string;
  scheduled_date: string | null;
}

export interface CandidateChain {
  id: string; // stable grouping key (not persisted)
  confidence: Confidence;
  customer_id: string;
  customer_name: string;
  address: string;
  asset_subtype: string | null;
  jobs: CandidateJob[];
  inferred_chain_type: InferredChainType;
}

export interface AuditSummary {
  total_jobs: number;
  chained_jobs: number;
  standalone_jobs: number;
  unlinked_exchanges: number;
  candidate_count: number;
  by_confidence: { high: number; medium: number; low: number };
  by_pattern: Record<InferredChainType, number>;
}

interface RejectedCandidate {
  key: string; // sorted jobIds joined by `|`
  job_ids: string[];
  rejected_by: string | null;
  rejected_at: string;
  reason: string | null;
}

const REJECTIONS_KEY = 'legacy_backfill_rejections';

function rejectionKey(jobIds: string[]): string {
  return [...jobIds].sort().join('|');
}

function groupKey(job: Job): string {
  const addr = (job.service_address as Record<string, string> | null) ?? {};
  const street = (addr.street || '').trim().toLowerCase();
  const city = (addr.city || '').trim().toLowerCase();
  return [job.customer_id ?? '', street, city].join('|');
}

function formatAddress(job: Job): string {
  const addr = (job.service_address as Record<string, string> | null) ?? {};
  const parts = [addr.street, addr.city, addr.state].filter(Boolean);
  return parts.join(', ') || '(no address)';
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${a}T00:00:00Z`).getTime();
  const t2 = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(Math.round((t2 - t1) / 86400000));
}

function inferChainType(jobs: CandidateJob[]): InferredChainType {
  const types = jobs.map((j) => j.job_type);
  const hasDelivery = types.includes('delivery') || types.includes('drop_off');
  const hasPickup = types.includes('pickup') || types.includes('removal');
  const hasExchange = types.includes('exchange');
  if (hasDelivery && hasExchange && hasPickup) return 'delivery_exchange_pickup';
  if (hasDelivery && hasPickup) return 'delivery_pickup';
  if (hasDelivery && !hasPickup) return 'delivery_only';
  return 'orphan';
}

function taskTypeFromJobType(jobType: string): 'drop_off' | 'exchange' | 'pick_up' {
  if (jobType === 'delivery' || jobType === 'drop_off') return 'drop_off';
  if (jobType === 'exchange') return 'exchange';
  return 'pick_up';
}

function sequenceOrder(jobType: string): number {
  if (jobType === 'delivery' || jobType === 'drop_off') return 0;
  if (jobType === 'exchange') return 1;
  return 2; // pickup / removal
}

@Injectable()
export class LegacyBackfillService {
  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(RentalChain) private chainRepo: Repository<RentalChain>,
    @InjectRepository(TaskChainLink) private linkRepo: Repository<TaskChainLink>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    private dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────
  // READ-ONLY DETECTION
  // ─────────────────────────────────────────────────────────

  /**
   * Return an audit of how many jobs are chained vs standalone on
   * this tenant, plus the number of candidate chains the detection
   * logic would surface. Everything here is read-only.
   */
  async getAudit(tenantId: string): Promise<AuditSummary> {
    const total = await this.jobRepo.count({ where: { tenant_id: tenantId } });
    const chainedIds = await this.chainedJobIds(tenantId);
    const chained = chainedIds.size;
    const standalone = total - chained;
    const unlinkedExchanges = await this.jobRepo
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.job_type = :type', { type: 'exchange' })
      .andWhere('j.id NOT IN (:...ids)', {
        ids: chainedIds.size > 0 ? [...chainedIds] : ['00000000-0000-0000-0000-000000000000'],
      })
      .getCount();

    const candidates = await this.getCandidates(tenantId);
    const byConfidence = { high: 0, medium: 0, low: 0 };
    const byPattern: Record<InferredChainType, number> = {
      delivery_pickup: 0,
      delivery_exchange_pickup: 0,
      delivery_only: 0,
      orphan: 0,
    };
    for (const c of candidates) {
      byConfidence[c.confidence] += 1;
      byPattern[c.inferred_chain_type] += 1;
    }

    return {
      total_jobs: total,
      chained_jobs: chained,
      standalone_jobs: standalone,
      unlinked_exchanges: unlinkedExchanges,
      candidate_count: candidates.length,
      by_confidence: byConfidence,
      by_pattern: byPattern,
    };
  }

  /**
   * Return the list of candidate chains detected from this tenant's
   * standalone jobs. Read-only. Groups are sorted by confidence
   * (high first) then by customer name. Already-rejected candidates
   * are filtered out.
   */
  async getCandidates(tenantId: string): Promise<CandidateChain[]> {
    const chainedIds = await this.chainedJobIds(tenantId);
    const standalone = await this.jobRepo
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.customer', 'customer')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere(
        chainedIds.size > 0
          ? 'j.id NOT IN (:...chainedIds)'
          : '1 = 1',
        chainedIds.size > 0 ? { chainedIds: [...chainedIds] } : {},
      )
      .getMany();

    // Load rejection tracking
    const rejections = await this.getRejections(tenantId);
    const rejectedKeys = new Set(rejections.map((r) => r.key));

    // Group by tenant + customer_id + street + city
    const groups = new Map<string, Job[]>();
    for (const j of standalone) {
      if (!j.customer_id) continue; // skip orphan jobs without a customer
      const key = groupKey(j);
      const list = groups.get(key) ?? [];
      list.push(j);
      groups.set(key, list);
    }

    const candidates: CandidateChain[] = [];
    for (const [key, jobs] of groups) {
      // Sort by scheduled_date ASC (null dates sink to the bottom)
      jobs.sort((a, b) => {
        if (!a.scheduled_date && !b.scheduled_date) return 0;
        if (!a.scheduled_date) return 1;
        if (!b.scheduled_date) return -1;
        return a.scheduled_date < b.scheduled_date ? -1 : 1;
      });

      // Skip groups with only one job that isn't a delivery —
      // orphan pickups/exchanges need manual review, not automatic
      // candidate creation.
      if (jobs.length < 1) continue;

      // Pick the primary subtype — the delivery's if any, otherwise
      // the most common non-null subtype.
      const delivery = jobs.find((j) => j.job_type === 'delivery' || j.job_type === 'drop_off');
      const subtypes = jobs.map((j) => j.asset_subtype).filter(Boolean) as string[];
      const primarySubtype =
        delivery?.asset_subtype ||
        (subtypes.length > 0 ? subtypes[0] : null);

      // Confidence scoring
      const allSameSubtype =
        primarySubtype &&
        jobs.every((j) => !j.asset_subtype || j.asset_subtype === primarySubtype);
      const allHaveDate = jobs.every((j) => !!j.scheduled_date);
      const dated = jobs.filter((j) => !!j.scheduled_date);
      const gap =
        dated.length >= 2
          ? daysBetween(
              dated[0].scheduled_date,
              dated[dated.length - 1].scheduled_date,
            )
          : 0;
      const hasCompleteChain =
        jobs.some((j) => j.job_type === 'delivery' || j.job_type === 'drop_off') &&
        jobs.some((j) => j.job_type === 'pickup' || j.job_type === 'removal');

      let confidence: Confidence;
      if (hasCompleteChain && allSameSubtype && allHaveDate && gap <= 60) {
        confidence = 'high';
      } else if (hasCompleteChain && (gap > 60 || !allSameSubtype || !allHaveDate)) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      const candidateJobs: CandidateJob[] = jobs.map((j) => ({
        job_id: j.id,
        job_number: j.job_number,
        job_type: j.job_type,
        status: j.status,
        scheduled_date: j.scheduled_date ?? null,
      }));

      // Skip previously rejected candidate (by sorted job-id fingerprint)
      if (rejectedKeys.has(rejectionKey(candidateJobs.map((j) => j.job_id)))) {
        continue;
      }

      const customer = jobs[0].customer;
      candidates.push({
        id: key,
        confidence,
        customer_id: jobs[0].customer_id,
        customer_name: customer
          ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || '(no name)'
          : '(no customer)',
        address: formatAddress(jobs[0]),
        asset_subtype: primarySubtype,
        jobs: candidateJobs,
        inferred_chain_type: inferChainType(candidateJobs),
      });
    }

    // Sort: high > medium > low, then by customer name
    const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
    candidates.sort((a, b) => {
      if (rank[a.confidence] !== rank[b.confidence]) {
        return rank[a.confidence] - rank[b.confidence];
      }
      return a.customer_name.localeCompare(b.customer_name);
    });

    return candidates;
  }

  // ─────────────────────────────────────────────────────────
  // APPROVE — create the rental chain + task_chain_links
  // ─────────────────────────────────────────────────────────

  async approve(
    tenantId: string,
    userId: string | null,
    userEmail: string | null,
    jobIds: string[],
  ): Promise<{ rental_chain_id: string; linked_job_ids: string[] }> {
    if (jobIds.length === 0) {
      throw new BadRequestException('job_ids must not be empty');
    }

    // ── Identity checks (before any writes) ──
    const jobs = await this.jobRepo.find({
      where: { id: In(jobIds), tenant_id: tenantId },
    });
    if (jobs.length !== jobIds.length) {
      throw new BadRequestException(
        'One or more jobs are missing or do not belong to this tenant',
      );
    }
    const customerIds = new Set(jobs.map((j) => j.customer_id));
    if (customerIds.size !== 1) {
      throw new BadRequestException(
        'Cannot link jobs from different customers or tenants',
      );
    }
    const customerId = [...customerIds][0];
    if (!customerId) {
      throw new BadRequestException('Jobs have no customer attached');
    }

    // ── None of the jobs can already be chained ──
    const existingLinks = await this.linkRepo.find({
      where: { job_id: In(jobIds) },
    });
    if (existingLinks.length > 0) {
      // Verify the existing link's chain belongs to this tenant so
      // the error doesn't leak cross-tenant info.
      const existingChainIds = existingLinks.map((l) => l.rental_chain_id);
      const existingChains = await this.chainRepo.find({
        where: { id: In(existingChainIds), tenant_id: tenantId },
      });
      if (existingChains.length > 0) {
        throw new ConflictException(
          'One or more jobs are already part of a rental chain',
        );
      }
    }

    // ── Determine sequence + dates ──
    const sorted = [...jobs].sort((a, b) => {
      // Primary: job type (delivery, exchange, pickup)
      const diff = sequenceOrder(a.job_type) - sequenceOrder(b.job_type);
      if (diff !== 0) return diff;
      // Secondary: scheduled_date
      if (!a.scheduled_date && !b.scheduled_date) return 0;
      if (!a.scheduled_date) return 1;
      if (!b.scheduled_date) return -1;
      return a.scheduled_date < b.scheduled_date ? -1 : 1;
    });

    const delivery = sorted.find(
      (j) => j.job_type === 'delivery' || j.job_type === 'drop_off',
    );
    const terminalPickup = [...sorted]
      .reverse()
      .find((j) => j.job_type === 'pickup' || j.job_type === 'removal');

    const dropOffDate = delivery?.scheduled_date ?? sorted[0].scheduled_date ?? null;
    const expectedPickupDate =
      terminalPickup?.scheduled_date ?? sorted[sorted.length - 1].scheduled_date ?? null;

    // Derive chain status: active if any job is not terminal,
    // completed if every job is completed/cancelled.
    const terminalStatuses = new Set(['completed', 'cancelled', 'failed']);
    const allTerminal = jobs.every((j) => terminalStatuses.has(j.status));
    const allCompleted = jobs.every((j) => j.status === 'completed');
    const chainStatus = allCompleted
      ? 'completed'
      : allTerminal
        ? 'cancelled'
        : 'active';

    // Derive rental_days from dates, fall back to 14
    const rentalDays =
      dropOffDate && expectedPickupDate
        ? daysBetween(dropOffDate, expectedPickupDate)
        : 14;

    const dumpsterSize =
      delivery?.asset_subtype ||
      sorted.find((j) => j.asset_subtype)?.asset_subtype ||
      '';

    // ── Transactional writes ──
    return this.dataSource.transaction(async (trx) => {
      const chainRepo = trx.getRepository(RentalChain);
      const linkRepo = trx.getRepository(TaskChainLink);

      // Double-check inside the transaction that no job was chained
      // between the pre-check and now (race with concurrent approvals).
      const raceLinks = await linkRepo.find({ where: { job_id: In(jobIds) } });
      if (raceLinks.length > 0) {
        const raceChainIds = raceLinks.map((l) => l.rental_chain_id);
        const raceChains = await chainRepo.find({
          where: { id: In(raceChainIds), tenant_id: tenantId },
        });
        if (raceChains.length > 0) {
          throw new ConflictException(
            'One or more jobs were linked by another request before this approval completed',
          );
        }
      }

      // Guard: mirror the DB CHECK `rental_chain_active_requires_asset`.
      // Only applies when backfill derives `chainStatus === 'active'`
      // (i.e. at least one non-terminal job) — completed/cancelled
      // derivations are unaffected.
      const backfillAssetId = delivery?.asset_id ?? null;
      if (chainStatus === 'active' && !backfillAssetId) {
        throw new BadRequestException(
          'chain_activation_requires_asset: Cannot activate rental chain without an asset assigned',
        );
      }

      const chain = chainRepo.create({
        tenant_id: tenantId,
        customer_id: customerId,
        asset_id: backfillAssetId,
        drop_off_date: dropOffDate || new Date().toISOString().split('T')[0],
        expected_pickup_date: expectedPickupDate,
        dumpster_size: dumpsterSize,
        rental_days: rentalDays > 0 ? rentalDays : 14,
        status: chainStatus,
      });
      const savedChain = await chainRepo.save(chain);

      // Create links in sequence order with forward + backward wiring
      const savedLinks: TaskChainLink[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const job = sorted[i];
        const link = linkRepo.create({
          rental_chain_id: savedChain.id,
          job_id: job.id,
          sequence_number: i + 1,
          task_type: taskTypeFromJobType(job.job_type),
          status:
            job.status === 'completed'
              ? 'completed'
              : job.status === 'cancelled' || job.status === 'failed'
                ? 'cancelled'
                : 'scheduled',
          scheduled_date:
            job.scheduled_date ?? dropOffDate ?? new Date().toISOString().split('T')[0],
          previous_link_id: i > 0 ? savedLinks[i - 1].id : undefined,
        });
        const saved = await linkRepo.save(link);
        savedLinks.push(saved);

        // Wire the previous link's next_link_id now that we have the id
        if (i > 0) {
          savedLinks[i - 1].next_link_id = saved.id;
          await linkRepo.save(savedLinks[i - 1]);
        }
      }

      // Audit log on tenant.settings so the super-admin can trace
      // which owner approved which backfill and when. Stored as an
      // append-only array; capped at 200 entries.
      await this.appendAudit(tenantId, {
        type: 'approved',
        chain_id: savedChain.id,
        job_ids: jobIds,
        user_id: userId,
        user_email: userEmail,
        at: new Date().toISOString(),
      });

      return {
        rental_chain_id: savedChain.id,
        linked_job_ids: sorted.map((j) => j.id),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // REJECT — record so candidate doesn't re-surface
  // ─────────────────────────────────────────────────────────

  async reject(
    tenantId: string,
    userId: string | null,
    userEmail: string | null,
    jobIds: string[],
    reason: string | null,
  ): Promise<{ rejected: boolean; key: string }> {
    if (jobIds.length === 0) {
      throw new BadRequestException('job_ids must not be empty');
    }
    // Tenant-scope validation: every job must belong to this tenant
    const jobs = await this.jobRepo.find({
      where: { id: In(jobIds), tenant_id: tenantId },
    });
    if (jobs.length !== jobIds.length) {
      throw new BadRequestException(
        'One or more jobs are missing or do not belong to this tenant',
      );
    }

    const key = rejectionKey(jobIds);
    const rejections = await this.getRejections(tenantId);
    if (rejections.some((r) => r.key === key)) {
      return { rejected: true, key };
    }
    const entry: RejectedCandidate = {
      key,
      job_ids: [...jobIds].sort(),
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      reason: reason ?? null,
    };
    rejections.push(entry);
    await this.saveRejections(tenantId, rejections);
    await this.appendAudit(tenantId, {
      type: 'rejected',
      job_ids: jobIds,
      user_id: userId,
      user_email: userEmail,
      reason: reason ?? null,
      at: new Date().toISOString(),
    });
    return { rejected: true, key };
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * All job ids that are currently part of a rental chain on this
   * tenant. Single query — used by every detection path so we don't
   * thread a big IN clause through multiple calls.
   */
  private async chainedJobIds(tenantId: string): Promise<Set<string>> {
    const rows = await this.linkRepo
      .createQueryBuilder('l')
      .innerJoin('rental_chains', 'c', 'c.id = l.rental_chain_id')
      .where('c.tenant_id = :tenantId', { tenantId })
      .select('l.job_id', 'job_id')
      .getRawMany<{ job_id: string }>();
    return new Set(rows.map((r) => r.job_id));
  }

  private async getRejections(tenantId: string): Promise<RejectedCandidate[]> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
    const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
    const blob = settings[REJECTIONS_KEY];
    return Array.isArray(blob) ? (blob as RejectedCandidate[]) : [];
  }

  private async saveRejections(
    tenantId: string,
    rejections: RejectedCandidate[],
  ): Promise<void> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
    const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
    // Cap at 500 entries so the JSONB column can't grow unbounded
    const trimmed = rejections.slice(-500);
    const next = {
      ...settings,
      [REJECTIONS_KEY]: trimmed,
    } as Record<string, unknown>;
    await this.tenantRepo.update(tenantId, { settings: next as Record<string, any> });
  }

  private async appendAudit(
    tenantId: string,
    entry: Record<string, unknown>,
  ): Promise<void> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return;
    const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
    const existing = Array.isArray(settings.legacy_backfill_audit)
      ? (settings.legacy_backfill_audit as Array<Record<string, unknown>>)
      : [];
    existing.push(entry);
    const trimmed = existing.slice(-200);
    const next = {
      ...settings,
      legacy_backfill_audit: trimmed,
    } as Record<string, unknown>;
    await this.tenantRepo.update(tenantId, { settings: next as Record<string, any> });
  }
}
