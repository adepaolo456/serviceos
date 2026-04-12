import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Phase 14 — Alerts / Exceptions System
 *
 * An alert is a derived, tenant-scoped pointer at a condition that
 * needs attention. Alerts are never manually created. They are
 * upserted by AlertDetectorService from queries against existing
 * tables and auto-resolved when the underlying condition clears.
 *
 * Idempotency is enforced by a unique partial index on
 *   (tenant_id, alert_type, entity_type, entity_id) WHERE status='active'
 * so the detector can safely INSERT ... ON CONFLICT DO NOTHING on
 * every detection pass without creating duplicates.
 *
 * See migrations/2026-04-12-alerts-foundation.sql for the schema.
 */
@Entity('alerts')
@Index('idx_alerts_tenant_status', ['tenant_id', 'status'])
@Index('idx_alerts_tenant_type', ['tenant_id', 'alert_type'])
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'alert_type' })
  alert_type!: string;

  @Column()
  severity!: string;

  @Column({ name: 'entity_type' })
  entity_type!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entity_id!: string;

  /**
   * Registry-driven feature key (e.g. 'alerts_overdue_rental'). The
   * web layer resolves this to a human label via getFeatureLabel().
   * Never store user-facing copy here — changes would require a
   * data migration.
   */
  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @Column({ default: 'active' })
  status!: string;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolved_by!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolved_at!: Date | null;

  @Column({ name: 'dismissed_by', type: 'uuid', nullable: true })
  dismissed_by!: string | null;

  @Column({ name: 'dismissed_at', type: 'timestamptz', nullable: true })
  dismissed_at!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  created_at!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updated_at!: Date;
}
