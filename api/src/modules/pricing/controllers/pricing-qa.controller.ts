import { Controller, Get, Post, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId } from '../../../common/decorators';
import { Job } from '../../jobs/entities/job.entity';
import { PricingSnapshot } from '../entities/pricing-snapshot.entity';
import { JobPricingAudit } from '../../jobs/entities/job-pricing-audit.entity';
import { Invoice } from '../../billing/entities/invoice.entity';
import { PricingService } from '../pricing.service';
import {
  hasValidServiceCoordinates,
  extractCoordinates,
  buildAddressString,
} from '../../../common/helpers/coordinate-validator';

interface PricingQaRow {
  job_id: string;
  job_number: string;
  customer_name: string;
  service_address_summary: string;
  status: string;
  job_type: string;
  asset_subtype: string | null;
  issue_type: string;
  severity: 'critical' | 'warning' | 'info';
  has_locked_snapshot: boolean;
  pricing_snapshot_id: string | null;
  pricing_config_version_id: string | null;
  pricing_locked_at: string | null;
  last_recalculation_reasons: string[] | null;
  is_exchange: boolean;
  exchange_pickup_subtype: string | null;
  exchange_dropoff_subtype: string | null;
  has_valid_coordinates: boolean;
  geocode_blocked: boolean;
  invoice_id: string | null;
  invoice_status: string | null;
  created_at: string;
  updated_at: string;
  // Eligibility fields (additive)
  can_generate_snapshot: boolean;
  can_fix_address: boolean;
  action_blockers: string[];
}

interface SnapshotResult {
  job_id: string;
  job_number: string;
  status: 'success' | 'skipped' | 'failed';
  reason?: string;
  snapshot_id?: string;
}

@ApiTags('Pricing QA')
@ApiBearerAuth()
@Controller('pricing-qa')
export class PricingQaController {
  constructor(
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(PricingSnapshot) private snapshotRepo: Repository<PricingSnapshot>,
    @InjectRepository(JobPricingAudit) private auditRepo: Repository<JobPricingAudit>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    private pricingService: PricingService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Pricing QA summary stats for tenant' })
  async overview(@TenantId() tenantId: string) {
    const jobs = await this.jobRepo.find({
      where: { tenant_id: tenantId },
      relations: ['customer'],
      order: { updated_at: 'DESC' },
      take: 500,
    });

    const audits = await this.auditRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
      take: 100,
    });

    const invoices = await this.invoiceRepo.find({
      where: { tenant_id: tenantId },
      select: ['id', 'job_id', 'status', 'tenant_id'],
    });
    const invoiceByJob = new Map<string, { id: string; status: string }>();
    for (const inv of invoices) {
      if (inv.job_id) invoiceByJob.set(inv.job_id, { id: inv.id, status: inv.status });
    }

    const auditByJob = new Map<string, string[]>();
    for (const a of audits) {
      if (!auditByJob.has(a.job_id)) auditByJob.set(a.job_id, a.recalculation_reasons);
    }

    let lockedCount = 0;
    let recalcCount = 0;
    let exchangeCount = 0;
    let geocodeBlockedCount = 0;
    let missingSnapshotCount = 0;
    let reviewQueueCount = 0;

    const rows: PricingQaRow[] = [];

    for (const job of jobs) {
      const addr = job.service_address as Record<string, unknown> | null;
      const validCoords = hasValidServiceCoordinates(addr);
      const hasSnapshot = !!job.pricing_snapshot;
      const isExchange = job.job_type === 'exchange';
      const inv = invoiceByJob.get(job.id);
      const auditReasons = auditByJob.get(job.id) || null;

      const issues: Array<{ type: string; severity: 'critical' | 'warning' | 'info' }> = [];

      // Eligibility analysis
      const blockers: string[] = [];
      const hasAddress = !!addr && !!(addr.street || addr.city);
      const hasSubtype = !!job.asset_subtype;

      if (!validCoords && hasAddress) {
        issues.push({ type: 'geocode_blocked', severity: 'critical' });
        geocodeBlockedCount++;
        blockers.push('geocode_blocked');
      } else if (!validCoords && !hasAddress) {
        issues.push({ type: 'missing_address', severity: 'critical' });
        reviewQueueCount++;
        blockers.push('missing_address');
      }

      if (!hasSubtype) blockers.push('missing_asset_subtype');

      if (!hasSnapshot && job.base_price) {
        issues.push({ type: 'pricing_snapshot_missing', severity: 'warning' });
        missingSnapshotCount++;
      }

      if (hasSnapshot) {
        lockedCount++;
        issues.push({ type: 'pricing_locked_snapshot', severity: 'info' });
      }

      if (auditReasons) {
        recalcCount++;
        issues.push({ type: 'pricing_recalculated', severity: 'info' });
      }

      if (isExchange) {
        exchangeCount++;
        issues.push({ type: 'exchange_job', severity: 'info' });
      }

      const addrParts = addr ? [addr.street, addr.city, addr.state].filter(Boolean) : [];
      const addrSummary = addrParts.length > 0 ? addrParts.join(', ') as string : 'No address';

      const cust = (job as any).customer;
      const custName = cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : 'Unknown';

      const snapshot = job.pricing_snapshot as Record<string, any> | null;
      const breakdown = snapshot?.breakdown || {};

      const canGenerate = !hasSnapshot && validCoords && hasSubtype && blockers.length === 0;
      const canFixAddress = !validCoords;

      const primaryIssue = issues.length > 0 ? issues.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      })[0] : null;

      if (primaryIssue) {
        rows.push({
          job_id: job.id,
          job_number: job.job_number,
          customer_name: custName,
          service_address_summary: addrSummary,
          status: job.status,
          job_type: job.job_type,
          asset_subtype: job.asset_subtype || null,
          issue_type: primaryIssue.type,
          severity: primaryIssue.severity,
          has_locked_snapshot: hasSnapshot,
          pricing_snapshot_id: job.pricing_snapshot_id || null,
          pricing_config_version_id: job.pricing_config_version_id || null,
          pricing_locked_at: job.pricing_locked_at ? job.pricing_locked_at.toISOString() : null,
          last_recalculation_reasons: auditReasons,
          is_exchange: isExchange,
          exchange_pickup_subtype: breakdown.exchangePickupSubtype || null,
          exchange_dropoff_subtype: breakdown.exchangeDropoffSubtype || null,
          has_valid_coordinates: validCoords,
          geocode_blocked: !validCoords,
          invoice_id: inv?.id || null,
          invoice_status: inv?.status || null,
          created_at: job.created_at.toISOString(),
          updated_at: job.updated_at.toISOString(),
          can_generate_snapshot: canGenerate,
          can_fix_address: canFixAddress,
          action_blockers: blockers,
        });
      }
    }

    rows.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      const diff = order[a.severity] - order[b.severity];
      if (diff !== 0) return diff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return {
      summary: {
        total_jobs: jobs.length,
        locked_snapshots: lockedCount,
        recalculations: recalcCount,
        exchange_jobs: exchangeCount,
        geocode_blocked: geocodeBlockedCount,
        missing_address: reviewQueueCount,
        missing_snapshots: missingSnapshotCount,
      },
      rows,
    };
  }

  @Post('generate-snapshot/:jobId')
  @ApiOperation({ summary: 'Generate pricing snapshot for a single job' })
  async generateSnapshot(
    @TenantId() tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<SnapshotResult> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) return { job_id: jobId, job_number: '', status: 'failed', reason: 'job_not_found' };

    if (job.pricing_snapshot) {
      return { job_id: jobId, job_number: job.job_number, status: 'skipped', reason: 'already_has_snapshot' };
    }

    const addr = job.service_address as Record<string, unknown> | null;
    const coords = extractCoordinates(addr);
    if (!coords) {
      const addrStr = buildAddressString(addr);
      return {
        job_id: jobId,
        job_number: job.job_number,
        status: 'failed',
        reason: addrStr ? 'geocode_blocked' : 'missing_address',
      };
    }

    if (!job.asset_subtype) {
      return { job_id: jobId, job_number: job.job_number, status: 'failed', reason: 'missing_asset_subtype' };
    }

    try {
      const calcResult = await this.pricingService.calculate(tenantId, {
        serviceType: job.service_type || 'dumpster_rental',
        assetSubtype: job.asset_subtype,
        jobType: job.job_type || 'delivery',
        customerLat: coords.lat,
        customerLng: coords.lng,
        rentalDays: job.rental_days || undefined,
        persist_snapshot: true,
        jobId: job.id,
      });

      const result = calcResult as Record<string, any>;
      const breakdown = result.breakdown || {};

      // Update job with snapshot reference
      job.pricing_snapshot = result;
      job.pricing_locked_at = new Date();
      job.pricing_config_version_id = breakdown.pricingConfigVersionId || null;
      job.pricing_snapshot_id = result.snapshot_id || null;
      job.base_price = breakdown.basePrice;
      job.total_price = breakdown.total;
      await this.jobRepo.save(job);

      return {
        job_id: jobId,
        job_number: job.job_number,
        status: 'success',
        snapshot_id: result.snapshot_id,
      };
    } catch (err) {
      return {
        job_id: jobId,
        job_number: job.job_number,
        status: 'failed',
        reason: err instanceof Error ? err.message : 'pricing_calculation_failed',
      };
    }
  }

  @Post('generate-snapshots-bulk')
  @ApiOperation({ summary: 'Bulk generate pricing snapshots for eligible jobs' })
  async generateSnapshotsBulk(
    @TenantId() tenantId: string,
    @Body() body: { job_ids: string[]; dry_run?: boolean },
  ) {
    const dryRun = body.dry_run ?? false;
    const results: SnapshotResult[] = [];
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const jobId of (body.job_ids || [])) {
      if (dryRun) {
        // Check eligibility only
        const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
        if (!job) { results.push({ job_id: jobId, job_number: '', status: 'failed', reason: 'job_not_found' }); failedCount++; continue; }
        if (job.pricing_snapshot) { results.push({ job_id: jobId, job_number: job.job_number, status: 'skipped', reason: 'already_has_snapshot' }); skippedCount++; continue; }
        const coords = extractCoordinates(job.service_address as Record<string, unknown>);
        if (!coords) { results.push({ job_id: jobId, job_number: job.job_number, status: 'failed', reason: 'no_valid_coordinates' }); failedCount++; continue; }
        if (!job.asset_subtype) { results.push({ job_id: jobId, job_number: job.job_number, status: 'failed', reason: 'missing_asset_subtype' }); failedCount++; continue; }
        results.push({ job_id: jobId, job_number: job.job_number, status: 'success', reason: 'eligible' });
        successCount++;
      } else {
        const result = await this.generateSnapshot(tenantId, jobId);
        results.push(result);
        if (result.status === 'success') successCount++;
        else if (result.status === 'skipped') skippedCount++;
        else failedCount++;
      }
    }

    return {
      dry_run: dryRun,
      total: body.job_ids?.length || 0,
      success_count: successCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      results,
    };
  }

  @Get('audit-history')
  @ApiOperation({ summary: 'Recent pricing audit events for a job' })
  async auditHistory(
    @TenantId() tenantId: string,
    @Query('jobId') jobId: string,
  ) {
    if (!jobId) return [];
    return this.auditRepo.find({
      where: { tenant_id: tenantId, job_id: jobId },
      order: { created_at: 'DESC' },
      take: 20,
    });
  }
}
