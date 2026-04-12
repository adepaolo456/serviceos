import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from '../entities/alert.entity';
import {
  ListAlertsQuery,
  AlertSummary,
  AlertSeverity,
  AlertType,
  AlertEntityType,
} from '../dto/alert.dto';
import { AlertDetectorService } from './alert-detector.service';

/**
 * Phase 14 — AlertService
 *
 * CRUD facade for the `alerts` table. Every read path runs the
 * detector first (cooldown-gated) so the response reflects live
 * truth without needing a background job. Writes (dismiss,
 * resolve) only transition stored rows.
 */
@Injectable()
export class AlertService {
  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly detector: AlertDetectorService,
  ) {}

  /**
   * List alerts for a tenant. Default view = active only, ordered
   * by severity (high → low) then recency. Detection runs up front
   * so new conditions show up without a manual trigger.
   */
  async list(tenantId: string, query: ListAlertsQuery): Promise<Alert[]> {
    await this.detector.detectAllForTenant(tenantId);

    const qb = this.alertRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId });

    if (!query.include_resolved) {
      qb.andWhere('a.status = :active', { active: 'active' });
    }
    if (query.severity) {
      qb.andWhere('a.severity = :sev', { sev: query.severity });
    }
    if (query.alert_type) {
      qb.andWhere('a.alert_type = :type', { type: query.alert_type });
    }
    if (query.entity_type) {
      qb.andWhere('a.entity_type = :et', { et: query.entity_type });
    }

    return qb
      .orderBy(
        "CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        'ASC',
      )
      .addOrderBy('a.created_at', 'DESC')
      .getMany();
  }

  /**
   * Active-only aggregate — powers the sidebar badge and the
   * stat-card row at the top of the /alerts page.
   */
  async getSummary(tenantId: string): Promise<AlertSummary> {
    await this.detector.detectAllForTenant(tenantId);

    const rows = await this.alertRepo
      .createQueryBuilder('a')
      .select('a.severity', 'severity')
      .addSelect('a.alert_type', 'alert_type')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status = :st', { st: 'active' })
      .groupBy('a.severity')
      .addGroupBy('a.alert_type')
      .getRawMany<{ severity: string; alert_type: string; count: string }>();

    const by_severity: Record<AlertSeverity, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };
    const by_type: Partial<Record<AlertType, number>> = {};
    let total = 0;

    for (const r of rows) {
      const n = Number(r.count) || 0;
      total += n;
      const sev = r.severity as AlertSeverity;
      if (sev in by_severity) by_severity[sev] += n;
      const t = r.alert_type as AlertType;
      by_type[t] = (by_type[t] ?? 0) + n;
    }

    return {
      total,
      by_severity,
      by_type,
      last_detected_at: this.detector.getLastDetectedAt(tenantId),
    };
  }

  /**
   * Phase 15 — fetch all ACTIVE alerts for a specific set of
   * (entity_type, entity_id) tuples, narrowly scoped. Used by the
   * Connected Job Lifecycle panel to inline alert indicators for
   * every job in a rental chain plus the chain itself in a single
   * round trip.
   *
   * Does NOT trigger the detector cooldown — Phase 15 is a
   * read-only surface and the /alerts page is still the canonical
   * trigger for detection. This method only reads the existing
   * stored state.
   *
   * Empty input → empty result (no wildcard query). An empty
   * `entity_ids` array on one of the pairs is silently skipped so
   * callers can pass the full shape without pre-filtering.
   */
  async findActiveForEntities(
    tenantId: string,
    pairs: Array<{ entity_type: AlertEntityType; entity_ids: string[] }>,
  ): Promise<Alert[]> {
    if (!pairs || pairs.length === 0) return [];

    const qb = this.alertRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status = :active', { active: 'active' });

    // Build the (entity_type, entity_id IN (...)) OR (...) clause.
    // Each non-empty pair contributes one sub-clause; empty pairs
    // are skipped. If every pair was empty, short-circuit.
    const nonEmpty = pairs.filter((p) => p.entity_ids && p.entity_ids.length > 0);
    if (nonEmpty.length === 0) return [];

    qb.andWhere(
      (qbInner) => {
        const orClauses: string[] = [];
        const params: Record<string, unknown> = {};
        nonEmpty.forEach((pair, idx) => {
          const etKey = `et_${idx}`;
          const idsKey = `ids_${idx}`;
          orClauses.push(
            `(a.entity_type = :${etKey} AND a.entity_id IN (:...${idsKey}))`,
          );
          params[etKey] = pair.entity_type;
          params[idsKey] = pair.entity_ids;
        });
        qbInner.where(orClauses.join(' OR '), params);
        return '';
      },
    );

    return qb
      .orderBy(
        "CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
        'ASC',
      )
      .addOrderBy('a.created_at', 'DESC')
      .getMany();
  }

  async getById(tenantId: string, id: string): Promise<Alert> {
    const alert = await this.alertRepo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  /**
   * Dismiss — acknowledged without action. Distinct from resolve.
   * RBAC: dispatcher+ (route-level).
   */
  async dismiss(
    tenantId: string,
    id: string,
    userId: string,
  ): Promise<Alert> {
    const alert = await this.getById(tenantId, id);
    if (alert.status !== 'active') {
      throw new BadRequestException(
        `Alert is ${alert.status}; cannot dismiss a non-active alert`,
      );
    }
    alert.status = 'dismissed';
    alert.dismissed_by = userId;
    alert.dismissed_at = new Date();
    alert.updated_at = new Date();
    return this.alertRepo.save(alert);
  }

  /**
   * Resolve — "the condition is fixed" (or override from
   * owner/admin). The normal clearing flow is auto-resolve via
   * AlertDetectorService.syncDerivedAlerts, so this path is
   * primarily for manual overrides when a user believes the
   * detector is wrong. RBAC: admin+ (route-level) — the spec
   * explicitly calls this "resolve overrides".
   *
   * We still log whether the condition was live at override time,
   * so the audit trail captures the override context.
   */
  async resolve(
    tenantId: string,
    id: string,
    userId: string,
  ): Promise<Alert> {
    const alert = await this.getById(tenantId, id);
    if (alert.status !== 'active') {
      throw new BadRequestException(
        `Alert is ${alert.status}; cannot resolve a non-active alert`,
      );
    }

    const stillActive = await this.detector.isConditionStillActive(
      tenantId,
      alert,
    );

    alert.status = 'resolved';
    alert.resolved_by = userId;
    alert.resolved_at = new Date();
    alert.updated_at = new Date();
    // Record override context in metadata for audit.
    alert.metadata = {
      ...(alert.metadata ?? {}),
      resolved_as_override: stillActive,
    };
    return this.alertRepo.save(alert);
  }
}
