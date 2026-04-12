import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Alert } from '../entities/alert.entity';
import { RentalChain } from '../../rental-chains/entities/rental-chain.entity';
import { Job } from '../../jobs/entities/job.entity';
import { BillingIssue } from '../../billing/entities/billing-issue.entity';
import { DumpTicket } from '../../dump-locations/entities/dump-ticket.entity';
import { TenantSettings } from '../../tenant-settings/entities/tenant-settings.entity';
import { ReportingService } from '../../reporting/reporting.service';
import { DerivedAlert } from '../dto/alert.dto';
import { getDisposalThreshold } from '../helpers/disposal-thresholds';
import { getTenantToday } from '../../../common/utils/tenant-date.util';

/**
 * Phase 14 — AlertDetectorService
 *
 * Derives all alerts for a tenant from existing tables. Never
 * duplicates business logic from other services — reuses
 * ReportingService.getLifecycleReport for financials and reads
 * billing_issues for MISSING_DUMP_SLIP (already computed by
 * BillingIssueDetectorService with correct job_type gating).
 *
 * Runs on demand from AlertService.list / getSummary, guarded by a
 * 60-second per-tenant cooldown so the sidebar badge polling does
 * not hammer the database. No background jobs (spec non-goal).
 *
 * Reconciliation model per run:
 *   1. Each private detector returns DerivedAlert[] for the tenant.
 *   2. syncDerivedAlerts compares against stored status='active' rows.
 *   3. Missing keys → INSERT ... ON CONFLICT DO NOTHING (leans on the
 *      unique partial index for concurrency safety).
 *   4. Stored keys with no derived match → auto-transition to
 *      'resolved' with resolved_at = NOW().
 */
@Injectable()
export class AlertDetectorService {
  private readonly logger = new Logger(AlertDetectorService.name);
  private readonly DETECTION_COOLDOWN_MS = 60_000;
  private readonly lastDetectedAt = new Map<string, number>();

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(RentalChain)
    private readonly chainRepo: Repository<RentalChain>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(BillingIssue)
    private readonly billingIssueRepo: Repository<BillingIssue>,
    @InjectRepository(DumpTicket)
    private readonly dumpTicketRepo: Repository<DumpTicket>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepo: Repository<TenantSettings>,
    private readonly reportingService: ReportingService,
    private readonly dataSource: DataSource,
  ) {}

  getLastDetectedAt(tenantId: string): string | null {
    const t = this.lastDetectedAt.get(tenantId);
    return t ? new Date(t).toISOString() : null;
  }

  /**
   * Main entry point. Runs all 7 detectors, upserts new active
   * alerts, and auto-resolves any stale ones whose conditions no
   * longer hold. Cooldown-gated; pass `force = true` to bypass.
   */
  /**
   * Phase B3 — tenant-wide timezone loader for day-boundary
   * detectors. One DB read per `detectAllForTenant` run, passed
   * down to the detectors that actually compute "today". Falls
   * back to undefined so `getTenantToday(tz)` uses its own
   * canonical default ('America/New_York').
   */
  private async loadTenantTimezone(
    tenantId: string,
  ): Promise<string | undefined> {
    const s = await this.tenantSettingsRepo.findOne({
      where: { tenant_id: tenantId },
    });
    return s?.timezone ?? undefined;
  }

  async detectAllForTenant(tenantId: string, force = false): Promise<void> {
    if (!force) {
      const last = this.lastDetectedAt.get(tenantId) ?? 0;
      if (Date.now() - last < this.DETECTION_COOLDOWN_MS) return;
    }
    this.lastDetectedAt.set(tenantId, Date.now());

    const derived: DerivedAlert[] = [];
    const tz = await this.loadTenantTimezone(tenantId);

    // Run detectors sequentially — each one is cheap enough that
    // parallelism would not win much, and the sequential order
    // makes logs readable during debugging.
    try {
      derived.push(...(await this.detectOverdueRental(tenantId, tz)));
      derived.push(...(await this.detectMissingDumpSlip(tenantId)));
      derived.push(...(await this.detectMissingAsset(tenantId)));
      derived.push(...(await this.detectAbnormalDisposal(tenantId)));
      derived.push(...(await this.detectLowMarginChain(tenantId, tz)));
      derived.push(...(await this.detectLifecycleIntegrity(tenantId)));
      derived.push(...(await this.detectDateRuleConflict(tenantId)));
    } catch (err) {
      this.logger.error(
        `Alert detection failed for tenant ${tenantId}: ${(err as Error).message}`,
      );
      // Do not throw — a broken detector should never hide alerts
      // the other detectors produced. syncDerivedAlerts runs with
      // whatever we collected so partial state is still useful.
    }

    await this.syncDerivedAlerts(tenantId, derived);
  }

  /**
   * Re-check whether a specific stored alert's condition still
   * holds. Used by AlertService.resolve() as a soft guard — the
   * route is RBAC-protected to owner/admin (override privilege),
   * so this is a sanity signal, not a hard block.
   */
  async isConditionStillActive(
    tenantId: string,
    alert: Alert,
  ): Promise<boolean> {
    const target = `${alert.alert_type}|${alert.entity_type}|${alert.entity_id}`;
    // Only loaded on the alert types that need tenant-local
    // "today" for re-evaluation — skipped for the others to avoid
    // an extra DB read on resolve().
    const needsTz =
      alert.alert_type === 'overdue_rental' ||
      alert.alert_type === 'low_margin_chain';
    const tz = needsTz ? await this.loadTenantTimezone(tenantId) : undefined;
    let candidates: DerivedAlert[] = [];
    switch (alert.alert_type) {
      case 'overdue_rental':
        candidates = await this.detectOverdueRental(tenantId, tz);
        break;
      case 'missing_dump_slip':
        candidates = await this.detectMissingDumpSlip(tenantId);
        break;
      case 'missing_asset':
        candidates = await this.detectMissingAsset(tenantId);
        break;
      case 'abnormal_disposal':
        candidates = await this.detectAbnormalDisposal(tenantId);
        break;
      case 'low_margin_chain':
        candidates = await this.detectLowMarginChain(tenantId, tz);
        break;
      case 'lifecycle_integrity':
        candidates = await this.detectLifecycleIntegrity(tenantId);
        break;
      case 'date_rule_conflict':
        candidates = await this.detectDateRuleConflict(tenantId);
        break;
    }
    return candidates.some(
      (c) => `${c.alert_type}|${c.entity_type}|${c.entity_id}` === target,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Reconciliation — insert new actives, auto-resolve stale ones
  // ─────────────────────────────────────────────────────────────

  private keyOf(a: {
    alert_type: string;
    entity_type: string;
    entity_id: string;
  }): string {
    return `${a.alert_type}|${a.entity_type}|${a.entity_id}`;
  }

  private async syncDerivedAlerts(
    tenantId: string,
    derived: DerivedAlert[],
  ): Promise<void> {
    const existing = await this.alertRepo.find({
      where: { tenant_id: tenantId, status: 'active' },
    });

    const derivedKeys = new Set(derived.map((d) => this.keyOf(d)));
    const existingMap = new Map(existing.map((e) => [this.keyOf(e), e]));

    // ── INSERT missing ─────────────────────────────────────────
    // De-duplicate the derived list in-memory first (a detector
    // could theoretically emit the same key twice, and ON CONFLICT
    // DO NOTHING alone is not enough because a multi-row INSERT
    // with duplicate keys fails before the ON CONFLICT clause
    // fires on the second row).
    const dedupedDerived = new Map<string, DerivedAlert>();
    for (const d of derived) {
      const k = this.keyOf(d);
      if (!dedupedDerived.has(k)) dedupedDerived.set(k, d);
    }

    const toInsert: DerivedAlert[] = [];
    for (const [key, d] of dedupedDerived) {
      if (!existingMap.has(key)) toInsert.push(d);
    }

    if (toInsert.length > 0) {
      const rows = toInsert.map((d) => ({
        tenant_id: tenantId,
        alert_type: d.alert_type,
        severity: d.severity,
        entity_type: d.entity_type,
        entity_id: d.entity_id,
        message: d.message,
        metadata: d.metadata,
        status: 'active',
      }));
      await this.alertRepo
        .createQueryBuilder()
        .insert()
        .into(Alert)
        .values(rows)
        .orIgnore()
        .execute();
    }

    // ── AUTO-RESOLVE stale (condition no longer holds) ─────────
    const stale = existing.filter((e) => !derivedKeys.has(this.keyOf(e)));
    if (stale.length > 0) {
      await this.alertRepo
        .createQueryBuilder()
        .update(Alert)
        .set({
          status: 'resolved',
          resolved_at: new Date(),
          updated_at: new Date(),
        })
        .where('id IN (:...ids)', { ids: stale.map((s) => s.id) })
        .execute();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Detectors — one per alert_type
  // ─────────────────────────────────────────────────────────────

  /**
   * 1. OVERDUE_RENTAL — an active rental chain whose expected
   * pickup date is in the past. Queries `rental_chains` directly.
   * Kept separate from the billing-layer `overdue_days` check,
   * which is about billable days beyond the rental window rather
   * than operational pickup lateness.
   */
  private async detectOverdueRental(
    tenantId: string,
    timezone?: string,
  ): Promise<DerivedAlert[]> {
    // Phase B3 — tenant-local "today" instead of UTC. Prevents
    // rental chains from flipping to "overdue" at 8pm Eastern
    // because the UTC day already rolled forward.
    const today = getTenantToday(timezone);
    const chains = await this.chainRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.status = :active', { active: 'active' })
      .andWhere('c.expected_pickup_date IS NOT NULL')
      .andWhere('c.expected_pickup_date < :today', { today })
      .getMany();

    return chains.map<DerivedAlert>((c) => ({
      alert_type: 'overdue_rental',
      severity: 'high',
      entity_type: 'rental_chain',
      entity_id: c.id,
      message: 'alerts_overdue_rental',
      metadata: {
        expected_pickup_date: c.expected_pickup_date,
        days_overdue: Math.max(
          0,
          Math.floor(
            (new Date(today).getTime() -
              new Date(c.expected_pickup_date).getTime()) /
              86_400_000,
          ),
        ),
        customer_id: c.customer_id,
        asset_id: c.asset_id,
      },
    }));
  }

  /**
   * 2. MISSING_DUMP_SLIP — projects open `billing_issues` rows of
   * type 'missing_dump_slip' as alerts. Avoids duplicating
   * BillingIssueDetectorService.checkMissingDumpSlip, which
   * already has the correct DUMP_ELIGIBLE_TYPES gating and status
   * filter. When the billing issue is resolved/dismissed, this
   * detector's next pass will not see it, so the alert
   * auto-resolves.
   */
  private async detectMissingDumpSlip(
    tenantId: string,
  ): Promise<DerivedAlert[]> {
    const issues = await this.billingIssueRepo
      .createQueryBuilder('bi')
      .where('bi.tenant_id = :tenantId', { tenantId })
      .andWhere('bi.issue_type = :t', { t: 'missing_dump_slip' })
      .andWhere('bi.status = :s', { s: 'open' })
      .andWhere('bi.job_id IS NOT NULL')
      .getMany();

    return issues.map<DerivedAlert>((i) => ({
      alert_type: 'missing_dump_slip',
      severity: 'high',
      entity_type: 'job',
      entity_id: i.job_id,
      message: 'alerts_missing_dump_slip',
      metadata: {
        billing_issue_id: i.id,
        invoice_id: i.invoice_id ?? null,
      },
    }));
  }

  /**
   * 3. MISSING_ASSET — a completed or in-progress job with no
   * asset linked. Jobs can record the asset in three different
   * columns depending on job_type (primary, drop-off-side,
   * pick-up-side), so we only flag when all three are NULL.
   */
  private async detectMissingAsset(tenantId: string): Promise<DerivedAlert[]> {
    const jobs = await this.jobRepo
      .createQueryBuilder('j')
      .where('j.tenant_id = :tenantId', { tenantId })
      .andWhere('j.status IN (:...statuses)', {
        statuses: ['completed', 'in_progress'],
      })
      .andWhere('j.asset_id IS NULL')
      .andWhere('j.drop_off_asset_id IS NULL')
      .andWhere('j.pick_up_asset_id IS NULL')
      .getMany();

    return jobs.map<DerivedAlert>((j) => ({
      alert_type: 'missing_asset',
      severity: 'high',
      entity_type: 'job',
      entity_id: j.id,
      message: 'alerts_missing_asset',
      metadata: {
        job_status: j.status,
        job_type: j.job_type,
        job_number: j.job_number,
      },
    }));
  }

  /**
   * 4. ABNORMAL_DISPOSAL — a non-voided dump ticket whose weight
   * or total cost exceeds the conservative threshold for its
   * associated job's size. Windowed to the last 90 days so we do
   * not re-scan years of history on every request.
   *
   * Thresholds are hardcoded fallbacks today; Phase 14.1 will
   * move them to per-tenant config.
   */
  private async detectAbnormalDisposal(
    tenantId: string,
  ): Promise<DerivedAlert[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const rows = await this.dataSource.query<
      Array<{
        ticket_id: string;
        job_id: string;
        size: string | null;
        weight_tons: string | null;
        total_cost: string | null;
      }>
    >(
      `SELECT dt.id AS ticket_id,
              dt.job_id,
              j.asset_subtype AS size,
              dt.weight_tons,
              dt.total_cost
       FROM dump_tickets dt
       INNER JOIN jobs j ON j.id = dt.job_id
       WHERE dt.tenant_id = $1
         AND dt.voided_at IS NULL
         AND dt.created_at >= $2
         AND j.tenant_id = $1`,
      [tenantId, cutoff.toISOString()],
    );

    const out: DerivedAlert[] = [];
    for (const row of rows) {
      const thr = getDisposalThreshold(row.size);
      const weight = Number(row.weight_tons) || 0;
      const cost = Number(row.total_cost) || 0;
      const abnormalWeight = weight > thr.max_weight_tons;
      const abnormalCost = cost > thr.max_cost_usd;
      if (!abnormalWeight && !abnormalCost) continue;

      out.push({
        alert_type: 'abnormal_disposal',
        severity: 'medium',
        entity_type: 'job',
        entity_id: row.job_id,
        message: 'alerts_abnormal_disposal',
        metadata: {
          dump_ticket_id: row.ticket_id,
          size: row.size,
          weight_tons: weight,
          cost_usd: cost,
          threshold_weight_tons: thr.max_weight_tons,
          threshold_cost_usd: thr.max_cost_usd,
          abnormal_weight: abnormalWeight,
          abnormal_cost: abnormalCost,
        },
      });
    }
    return out;
  }

  /**
   * 5. LOW_MARGIN_CHAIN — rental chains whose profit is below
   * the LOW_MARGIN_THRESHOLD_USD or negative. Uses the existing
   * ReportingService.getLifecycleReport so we never duplicate the
   * profit math.
   *
   * Windowed to the last 90 days to keep the report cheap and to
   * avoid flagging old/archived chains that are no longer
   * actionable.
   */
  private async detectLowMarginChain(
    tenantId: string,
    timezone?: string,
  ): Promise<DerivedAlert[]> {
    const LOW_MARGIN_THRESHOLD_USD = 50;

    // Phase B3 — tenant-local "today" anchors the 90-day window.
    // The start date is pure UTC arithmetic on the tenant-today
    // YYYY-MM-DD string: no UTC-vs-local drift because we
    // constructed the date from explicit Y/M/D ints with
    // Date.UTC(), not from a "now" instant.
    const end = getTenantToday(timezone);
    const [endY, endM, endD] = end.split('-').map(Number);
    const startDate = new Date(Date.UTC(endY, endM - 1, endD));
    startDate.setUTCDate(startDate.getUTCDate() - 90);
    const start = `${startDate.getUTCFullYear()}-${String(
      startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    let report: Awaited<ReturnType<ReportingService['getLifecycleReport']>>;
    try {
      report = await this.reportingService.getLifecycleReport(
        tenantId,
        start,
        end,
        'all',
        'month',
      );
    } catch (err) {
      this.logger.warn(
        `LOW_MARGIN_CHAIN detector: lifecycle report failed — ${(err as Error).message}`,
      );
      return [];
    }

    const out: DerivedAlert[] = [];
    for (const chain of report.chains || []) {
      const profit = Number(chain.profit) || 0;
      if (profit > LOW_MARGIN_THRESHOLD_USD) continue;
      out.push({
        alert_type: 'low_margin_chain',
        severity: 'high',
        entity_type: 'rental_chain',
        entity_id: chain.chain_id,
        message: 'alerts_low_margin_chain',
        metadata: {
          profit,
          revenue: Number(chain.revenue) || 0,
          cost: Number(chain.cost) || 0,
          is_negative: profit <= 0,
          threshold_usd: LOW_MARGIN_THRESHOLD_USD,
        },
      });
    }
    return out;
  }

  /**
   * 6. LIFECYCLE_INTEGRITY — two concrete structural checks:
   *   (a) a rental chain with zero task_chain_links (orphaned
   *       chain — something created the chain but never attached
   *       any jobs to it).
   *   (b) multiple active rental chains pointing at the same
   *       asset_id — a double-booking state that will confuse
   *       every downstream view.
   *
   * Both are genuine data-integrity red flags and map cleanly to
   * a rental_chain entity.
   */
  private async detectLifecycleIntegrity(
    tenantId: string,
  ): Promise<DerivedAlert[]> {
    const out: DerivedAlert[] = [];

    // (a) chains with zero links
    const orphanRows = await this.dataSource.query<
      Array<{ chain_id: string; status: string }>
    >(
      `SELECT c.id AS chain_id, c.status
       FROM rental_chains c
       LEFT JOIN task_chain_links l ON l.rental_chain_id = c.id
       WHERE c.tenant_id = $1
         AND c.status != 'cancelled'
       GROUP BY c.id, c.status
       HAVING COUNT(l.id) = 0`,
      [tenantId],
    );
    for (const r of orphanRows) {
      out.push({
        alert_type: 'lifecycle_integrity',
        severity: 'high',
        entity_type: 'rental_chain',
        entity_id: r.chain_id,
        message: 'alerts_lifecycle_integrity',
        metadata: {
          integrity_issue: 'no_task_chain_links',
          chain_status: r.status,
        },
      });
    }

    // (b) multiple active chains on the same asset
    const dupRows = await this.dataSource.query<
      Array<{ asset_id: string; chain_ids: string[] }>
    >(
      `SELECT asset_id, ARRAY_AGG(id) AS chain_ids
       FROM rental_chains
       WHERE tenant_id = $1
         AND status = 'active'
         AND asset_id IS NOT NULL
       GROUP BY asset_id
       HAVING COUNT(*) > 1`,
      [tenantId],
    );
    for (const r of dupRows) {
      for (const chainId of r.chain_ids) {
        out.push({
          alert_type: 'lifecycle_integrity',
          severity: 'high',
          entity_type: 'rental_chain',
          entity_id: chainId,
          message: 'alerts_lifecycle_integrity',
          metadata: {
            integrity_issue: 'duplicate_active_asset',
            asset_id: r.asset_id,
            conflicting_chain_ids: r.chain_ids,
          },
        });
      }
    }

    return out;
  }

  /**
   * 7. DATE_RULE_CONFLICT — SCAFFOLDED but not yet implemented.
   *
   * The spec condition ("pickup date overridden outside rental
   * rule expectations, inconsistent recalculation chain") does
   * not currently map to a concrete field on rental_chains or
   * task_chain_links. Rather than ship a guessed rule that
   * produces false positives, this detector returns an empty
   * array. The alert_type, CHECK constraint, feature registry
   * entry, and help guide are all wired up so Phase 14.1 can drop
   * in the real implementation without touching the schema or UI.
   *
   * TODO(phase-14.1): implement once the override-tracking field
   * (likely a `pickup_date_overridden_by_user_id` or similar) is
   * identified and added to rental_chains.
   */
  private async detectDateRuleConflict(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _tenantId: string,
  ): Promise<DerivedAlert[]> {
    return [];
  }
}
