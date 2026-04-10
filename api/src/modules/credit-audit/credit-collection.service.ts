import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditCollectionEvent } from './credit-collection-event.entity';

/**
 * Phase 11 — Collections workflow service.
 *
 * Records manual operator actions (reminder sent, contacted, note,
 * escalate) and provides a chronological timeline per customer.
 * All operations are tenant-scoped. Writes are lightweight and
 * wrapped in try/catch at the caller level.
 */

export type CollectionEventType =
  | 'reminder_sent'
  | 'marked_contacted'
  | 'note_added'
  | 'escalated';

@Injectable()
export class CreditCollectionService {
  private readonly logger = new Logger(CreditCollectionService.name);

  constructor(
    @InjectRepository(CreditCollectionEvent)
    private readonly repo: Repository<CreditCollectionEvent>,
  ) {}

  /**
   * Record a collection action.
   */
  async recordAction(params: {
    tenantId: string;
    customerId: string;
    userId: string;
    eventType: CollectionEventType;
    note?: string | null;
  }): Promise<CreditCollectionEvent> {
    const event = this.repo.create({
      tenant_id: params.tenantId,
      customer_id: params.customerId,
      user_id: params.userId,
      event_type: params.eventType,
      note: params.note ?? null,
    });
    return this.repo.save(event);
  }

  /**
   * Get timeline for a customer, sorted newest first.
   */
  async getTimeline(
    tenantId: string,
    customerId: string,
    limit = 50,
  ): Promise<CreditCollectionEvent[]> {
    return this.repo
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere('e.customer_id = :customerId', { customerId })
      .orderBy('e.created_at', 'DESC')
      .limit(limit)
      .getMany();
  }
}
