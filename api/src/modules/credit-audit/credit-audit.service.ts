import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';

/**
 * Phase 7 — Centralized audit service for credit-control actions.
 *
 * Provides:
 *   1. Fire-and-forget write (`record`) — never blocks the primary
 *      action on audit failure.
 *   2. Paginated read (`findAll`) — powers the audit dashboard.
 *
 * All operations are tenant-scoped via `tenant_id` from JWT.
 * Append-only — no update or delete methods.
 */

export type CreditAuditEventType =
  | 'credit_hold_set'
  | 'credit_hold_released'
  | 'booking_override'
  | 'dispatch_override'
  | 'credit_policy_updated'
  | 'credit_settings_updated';

export interface RecordAuditParams {
  tenantId: string;
  eventType: CreditAuditEventType;
  userId: string;
  customerId?: string | null;
  jobId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class CreditAuditService {
  private readonly logger = new Logger(CreditAuditService.name);

  constructor(
    @InjectRepository(CreditAuditEvent)
    private readonly repo: Repository<CreditAuditEvent>,
  ) {}

  /**
   * Record an audit event. Fire-and-forget — errors are logged but
   * never thrown so the primary action is not blocked.
   */
  record(params: RecordAuditParams): void {
    const event = this.repo.create({
      tenant_id: params.tenantId,
      event_type: params.eventType,
      user_id: params.userId,
      customer_id: params.customerId ?? null,
      job_id: params.jobId ?? null,
      reason: params.reason ?? null,
      metadata: params.metadata ?? {},
    });
    this.repo.save(event).catch((err) => {
      this.logger.warn(`Failed to record credit audit event: ${err.message}`, {
        eventType: params.eventType,
        tenantId: params.tenantId,
      });
    });
  }

  /**
   * Paginated, filterable query for the audit dashboard.
   */
  async findAll(
    tenantId: string,
    query: {
      eventType?: string;
      userId?: string;
      customerId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId });

    if (query.eventType) {
      qb.andWhere('e.event_type = :eventType', {
        eventType: query.eventType,
      });
    }
    if (query.userId) {
      qb.andWhere('e.user_id = :userId', { userId: query.userId });
    }
    if (query.customerId) {
      qb.andWhere('e.customer_id = :customerId', {
        customerId: query.customerId,
      });
    }
    if (query.from) {
      qb.andWhere('e.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('e.created_at <= :to', { to: query.to });
    }

    qb.orderBy('e.created_at', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
