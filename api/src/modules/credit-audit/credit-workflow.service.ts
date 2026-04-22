import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { excludeDemoCustomers } from '../../common/helpers/demo-customers-predicate';

/**
 * Phase 9 — Credit Workflow / Review Queue.
 *
 * Surfaces customers needing credit-related attention in a single
 * operational worklist. Read-only aggregation — no enforcement,
 * no automation, no mutation.
 *
 * Queue criteria (a customer appears if ANY match):
 *   1. Currently on manual hold (credit_hold = true)
 *   2. Has booking or dispatch overrides in the last 30 days
 *   3. Has 3+ credit audit events in the last 30 days
 *
 * Past-due AR is NOT included in the list query to keep it
 * lightweight. The detail panel fetches full credit-state on demand.
 */

export interface QueueCustomer {
  customer_id: string;
  customer_name: string;
  hold_status: 'on_hold' | 'normal';
  override_count_30d: number;
  event_count_30d: number;
  last_event_at: string | null;
  reason_summary: string;
}

@Injectable()
export class CreditWorkflowService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CreditAuditEvent)
    private readonly auditRepo: Repository<CreditAuditEvent>,
  ) {}

  /**
   * Paginated queue of customers needing credit attention.
   *
   * Single query with LEFT JOIN subquery for audit aggregation.
   * Uses existing indexes: customers(tenant_id), credit_audit_events
   * (tenant_id, created_at DESC), (tenant_id, customer_id).
   */
  async getQueue(
    tenantId: string,
    query: { page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const offset = (page - 1) * limit;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString();

    // Raw query for the aggregated queue. TypeORM QueryBuilder can't
    // cleanly express the LEFT JOIN lateral subquery pattern, so we
    // use a raw query with parameter binding for tenant isolation.
    const dataQuery = `
      SELECT
        c.id as customer_id,
        c.first_name,
        c.last_name,
        c.credit_hold,
        COALESCE(agg.override_count, 0)::int as override_count_30d,
        COALESCE(agg.event_count, 0)::int as event_count_30d,
        agg.last_event_at
      FROM customers c
      LEFT JOIN (
        SELECT
          e.customer_id,
          COUNT(*) FILTER (WHERE e.event_type IN ('booking_override', 'dispatch_override'))::int as override_count,
          COUNT(*)::int as event_count,
          MAX(e.created_at) as last_event_at
        FROM credit_audit_events e
        WHERE e.tenant_id = $1 AND e.created_at >= $2
        GROUP BY e.customer_id
      ) agg ON agg.customer_id = c.id
      WHERE c.tenant_id = $1
        AND ${excludeDemoCustomers('c')}
        AND (
          c.credit_hold = true
          OR COALESCE(agg.override_count, 0) > 0
          OR COALESCE(agg.event_count, 0) >= 3
        )
      ORDER BY
        CASE WHEN c.credit_hold = true THEN 0 ELSE 1 END,
        agg.last_event_at DESC NULLS LAST
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM customers c
      LEFT JOIN (
        SELECT
          e.customer_id,
          COUNT(*) FILTER (WHERE e.event_type IN ('booking_override', 'dispatch_override'))::int as override_count,
          COUNT(*)::int as event_count
        FROM credit_audit_events e
        WHERE e.tenant_id = $1 AND e.created_at >= $2
        GROUP BY e.customer_id
      ) agg ON agg.customer_id = c.id
      WHERE c.tenant_id = $1
        AND ${excludeDemoCustomers('c')}
        AND (
          c.credit_hold = true
          OR COALESCE(agg.override_count, 0) > 0
          OR COALESCE(agg.event_count, 0) >= 3
        )
    `;

    const [rows, countResult] = await Promise.all([
      this.customerRepo.query(dataQuery, [tenantId, since, limit, offset]),
      this.customerRepo.query(countQuery, [tenantId, since]),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    const data: QueueCustomer[] = rows.map((r: any) => {
      const reasons: string[] = [];
      if (r.credit_hold) reasons.push('On hold');
      if (r.override_count_30d > 0) reasons.push(`${r.override_count_30d} override${r.override_count_30d !== 1 ? 's' : ''}`);
      if (r.event_count_30d >= 3 && !r.credit_hold && r.override_count_30d === 0)
        reasons.push('Frequent activity');

      return {
        customer_id: r.customer_id,
        customer_name: `${r.first_name} ${r.last_name}`,
        hold_status: r.credit_hold ? 'on_hold' : 'normal',
        override_count_30d: Number(r.override_count_30d),
        event_count_30d: Number(r.event_count_30d),
        last_event_at: r.last_event_at
          ? new Date(r.last_event_at).toISOString()
          : null,
        reason_summary: reasons.join(' · ') || 'Review needed',
      };
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
