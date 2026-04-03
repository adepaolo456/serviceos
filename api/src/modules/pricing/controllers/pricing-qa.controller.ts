import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantId } from '../../../common/decorators';
import { Job } from '../../jobs/entities/job.entity';
import { PricingSnapshot } from '../entities/pricing-snapshot.entity';
import { JobPricingAudit } from '../../jobs/entities/job-pricing-audit.entity';
import { Invoice } from '../../billing/entities/invoice.entity';
import { hasValidServiceCoordinates } from '../../../common/helpers/coordinate-validator';

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

      if (!validCoords && addr && (addr.street || addr.city)) {
        issues.push({ type: 'geocode_blocked', severity: 'critical' });
        geocodeBlockedCount++;
      } else if (!validCoords && (!addr || (!addr.street && !addr.city))) {
        issues.push({ type: 'missing_address', severity: 'critical' });
        reviewQueueCount++;
      }

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

      // Build address summary
      const addrParts = addr ? [addr.street, addr.city, addr.state].filter(Boolean) : [];
      const addrSummary = addrParts.length > 0 ? addrParts.join(', ') as string : 'No address';

      // Customer name
      const cust = (job as any).customer;
      const custName = cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : 'Unknown';

      // Exchange context from snapshot
      const snapshot = job.pricing_snapshot as Record<string, any> | null;
      const breakdown = snapshot?.breakdown || {};

      // Only add to rows if there's at least one issue OR it's a notable job
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
        });
      }
    }

    // Sort: critical first, then warning, then info; within each, most recent first
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
