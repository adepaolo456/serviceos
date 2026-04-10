import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Phase 11 — Collections workflow event. Records manual actions
 * taken by operators as part of the credit review/collections
 * process. Separate from credit_audit_events (system audit).
 */
@Entity('credit_collection_events')
export class CreditCollectionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customer_id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  user_id!: string;

  @Column({ name: 'event_type', type: 'text' })
  event_type!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
