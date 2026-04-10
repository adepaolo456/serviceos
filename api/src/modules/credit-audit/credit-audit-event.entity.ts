import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Phase 7 — Centralized audit event for all credit-control actions.
 *
 * One row per sensitive action (hold set/release, overrides, policy
 * changes, credit settings changes). Tenant-scoped. Append-only —
 * no UPDATE or DELETE operations.
 *
 * Table managed by migration, not synchronize.
 */
@Entity('credit_audit_events')
export class CreditAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'event_type', type: 'text' })
  event_type!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  user_id!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customer_id!: string | null;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;
}
