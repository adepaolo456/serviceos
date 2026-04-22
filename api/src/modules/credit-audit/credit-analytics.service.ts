import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditAuditEvent } from './credit-audit-event.entity';
import { Customer } from '../customers/entities/customer.entity';
import {
  excludeDemoByCustomerIdNamed,
  excludeDemoCustomers,
} from '../../common/helpers/demo-customers-predicate';

/**
 * Phase 8 — Credit Control Analytics.
 *
 * Read-only aggregation queries over `credit_audit_events` and
 * `customers` for the analytics dashboard. All queries are
 * tenant-scoped and use existing indexes.
 */
@Injectable()
export class CreditAnalyticsService {
  constructor(
    @InjectRepository(CreditAuditEvent)
    private readonly auditRepo: Repository<CreditAuditEvent>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  /**
   * Summary metric counts for the dashboard cards.
   */
  async getSummary(tenantId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString();

    // Active holds from customers table (current state)
    const [holdCounts, eventCounts] = await Promise.all([
      this.customerRepo
        .createQueryBuilder('c')
        .select('COUNT(*)::int', 'total_holds')
        .addSelect(
          "COUNT(*) FILTER (WHERE c.credit_hold = true)::int",
          'manual_holds',
        )
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.credit_hold = true')
        .andWhere(excludeDemoCustomers('c'))
        .getRawOne<{ total_holds: number; manual_holds: number }>(),

      // Last 30 days event counts from audit table
      this.auditRepo
        .createQueryBuilder('e')
        .select(
          "COUNT(*) FILTER (WHERE e.event_type = 'booking_override')::int",
          'booking_overrides',
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE e.event_type = 'dispatch_override')::int",
          'dispatch_overrides',
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE e.event_type = 'credit_policy_updated')::int",
          'policy_changes',
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE e.event_type IN ('credit_hold_set', 'credit_hold_released'))::int",
          'hold_events',
        )
        .where('e.tenant_id = :tenantId', { tenantId })
        .andWhere('e.created_at >= :since', { since })
        .getRawOne<{
          booking_overrides: number;
          dispatch_overrides: number;
          policy_changes: number;
          hold_events: number;
        }>(),
    ]);

    return {
      active_holds: Number(holdCounts?.total_holds ?? 0),
      manual_holds: Number(holdCounts?.manual_holds ?? 0),
      booking_overrides_30d: Number(eventCounts?.booking_overrides ?? 0),
      dispatch_overrides_30d: Number(eventCounts?.dispatch_overrides ?? 0),
      policy_changes_30d: Number(eventCounts?.policy_changes ?? 0),
    };
  }

  /**
   * Daily time-series for the last 30 days, grouped by event type.
   */
  async getTrends(tenantId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString();

    const rows = await this.auditRepo
      .createQueryBuilder('e')
      .select("date_trunc('day', e.created_at)::date", 'day')
      .addSelect('e.event_type', 'event_type')
      .addSelect('COUNT(*)::int', 'count')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere('e.created_at >= :since', { since })
      .groupBy('day')
      .addGroupBy('e.event_type')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; event_type: string; count: number }>();

    return rows.map((r) => ({
      day: r.day,
      event_type: r.event_type,
      count: Number(r.count),
    }));
  }

  /**
   * Top 10 customers by audit event count.
   */
  async getTopCustomers(tenantId: string) {
    const rows = await this.auditRepo
      .createQueryBuilder('e')
      .select('e.customer_id', 'customer_id')
      .addSelect('COUNT(*)::int', 'event_count')
      .addSelect(
        "COUNT(*) FILTER (WHERE e.event_type IN ('credit_hold_set', 'credit_hold_released'))::int",
        'hold_events',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE e.event_type IN ('booking_override', 'dispatch_override'))::int",
        'override_events',
      )
      .addSelect('MAX(e.created_at)', 'last_event')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere('e.customer_id IS NOT NULL')
      .andWhere(excludeDemoByCustomerIdNamed('e.customer_id', 'tenantId'))
      .groupBy('e.customer_id')
      .orderBy('event_count', 'DESC')
      .limit(10)
      .getRawMany<{
        customer_id: string;
        event_count: number;
        hold_events: number;
        override_events: number;
        last_event: string;
      }>();

    // Enrich with customer names (batch — single query)
    const customerIds = rows.map((r) => r.customer_id);
    let customerMap: Record<string, { first_name: string; last_name: string }> =
      {};
    if (customerIds.length > 0) {
      const customers = await this.customerRepo
        .createQueryBuilder('c')
        .select(['c.id', 'c.first_name', 'c.last_name'])
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.id IN (:...ids)', { ids: customerIds })
        .getMany();
      customerMap = Object.fromEntries(
        customers.map((c) => [
          c.id,
          { first_name: c.first_name, last_name: c.last_name },
        ]),
      );
    }

    return rows.map((r) => ({
      customer_id: r.customer_id,
      customer_name: customerMap[r.customer_id]
        ? `${customerMap[r.customer_id].first_name} ${customerMap[r.customer_id].last_name}`
        : r.customer_id,
      event_count: Number(r.event_count),
      hold_events: Number(r.hold_events),
      override_events: Number(r.override_events),
      last_event: r.last_event,
    }));
  }

  /**
   * Top 10 users by override count.
   */
  async getTopUsers(tenantId: string) {
    const rows = await this.auditRepo
      .createQueryBuilder('e')
      .select('e.user_id', 'user_id')
      .addSelect(
        "COUNT(*) FILTER (WHERE e.event_type = 'booking_override')::int",
        'booking_overrides',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE e.event_type = 'dispatch_override')::int",
        'dispatch_overrides',
      )
      .addSelect('COUNT(*)::int', 'total')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere(
        "e.event_type IN ('booking_override', 'dispatch_override')",
      )
      .groupBy('e.user_id')
      .orderBy('total', 'DESC')
      .limit(10)
      .getRawMany<{
        user_id: string;
        booking_overrides: number;
        dispatch_overrides: number;
        total: number;
      }>();

    return rows.map((r) => ({
      user_id: r.user_id,
      booking_overrides: Number(r.booking_overrides),
      dispatch_overrides: Number(r.dispatch_overrides),
      total: Number(r.total),
    }));
  }
}
