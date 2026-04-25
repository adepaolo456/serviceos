import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';

/**
 * Phase 7 — Centralized audit service for credit-control actions.
 *
 * Provides:
 *   1. `record(params)` — fire-and-forget write. Errors are logged but
 *      never thrown so the primary action is not blocked. Used by the
 *      original 7 credit-control call sites.
 *   2. `record(params, manager)` — Arc J.1: when an `EntityManager` is
 *      supplied, the audit row is saved through the trx-bound repo
 *      (`manager.getRepository(CreditAuditEvent)`) and failures
 *      propagate so the caller's transaction can roll back. Used by
 *      the cancellation orchestrator where audit atomicity is required.
 *   3. `findAll` — paginated read powering the audit dashboard.
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
  | 'credit_settings_updated'
  // Arc J.1 — cancellation orchestrator decision events. One row per
  // invoice decision, plus a synthetic `cancellation_no_financials`
  // when a job has no linked invoices or all invoices are zero-value.
  // Invariant locked by the J-suite: every Arc J cancellation produces
  // at least one row of these types.
  | 'cancellation_void_unpaid'
  | 'cancellation_refund_paid'
  | 'cancellation_credit_memo'
  | 'cancellation_keep_paid'
  | 'cancellation_no_financials';

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
   * Record an audit event.
   *
   * Without `manager` (default): fire-and-forget. The save is initiated
   * but unawaited; failures log a warning and do not propagate. The 7
   * pre-Arc-J callers use this path.
   *
   * With `manager`: the save is awaited through the trx-bound
   * repository (`manager.getRepository(CreditAuditEvent)`), so
   * failures propagate and any caller-managed transaction will roll
   * back. Used by `JobsService.cancelJobWithFinancials` so the
   * cancellation + audit row land atomically.
   *
   * Returns `Promise<void>`. Pre-Arc-J callers ignore the return value
   * — this is byte-equivalent to the prior synchronous-call,
   * async-execute, error-swallow semantics they relied on.
   */
  async record(params: RecordAuditParams, manager?: EntityManager): Promise<void> {
    if (manager) {
      const trxRepo = manager.getRepository(CreditAuditEvent);
      const event = trxRepo.create({
        tenant_id: params.tenantId,
        event_type: params.eventType,
        user_id: params.userId,
        customer_id: params.customerId ?? null,
        job_id: params.jobId ?? null,
        reason: params.reason ?? null,
        metadata: params.metadata ?? {},
      });
      await trxRepo.save(event);
      return;
    }

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
