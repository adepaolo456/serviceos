import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * stripe_events: webhook event-id dedup table.
 *
 * Per PR #22 audit (docs/audits/2026-04-30-pr-c2-webhook-dedup-audit.md):
 *
 * D-1: surrogate UUID PK + unique compound index on (tenant_id, event_id).
 *      Nullable tenant_id supports account.updated (Connect events have no
 *      payload-derivable tenant) — best-effort dedup acceptable for those
 *      per audit rationale.
 *
 * D-3: row inserted via INSERT ... ON CONFLICT DO NOTHING RETURNING id at
 *      handleWebhook entry point (after signature verify, before switch).
 *      First-occurrence detection is atomic, not application-level.
 *
 * Money-movement events (payment_intent.*, checkout.session.completed) MUST
 * resolve tenant_id from event payload at handleWebhook — application-layer
 * enforcement, not DB-enforced.
 *
 * Out of scope (separate issues):
 *   - Retention/prune (issue #32)
 *   - account.updated tenant pre-resolution (issue #33)
 */
@Entity('stripe_events')
@Index('uq_stripe_events_tenant_event', ['tenant_id', 'event_id'], { unique: true })
export class StripeEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  event_id!: string;

  @Column({ type: 'varchar', length: 255 })
  event_type!: string;

  @Column({ type: 'uuid', nullable: true })
  tenant_id!: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  processed_at!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
