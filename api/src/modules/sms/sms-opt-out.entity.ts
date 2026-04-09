import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tenant-scoped SMS suppression state.
 *
 * One row per (tenant_id, phone_e164). Opt-in is a state transition on the
 * same row (sets opted_in_at) — never a new row — so the unique index never
 * needs a partial predicate and the audit history is preserved.
 *
 * "Currently opted out" = row exists AND opted_in_at IS NULL.
 *
 * Storage is managed by a manual SQL migration (production runs
 * synchronize: false). See migrations/006_sms_opt_outs.sql.
 */
@Entity('sms_opt_outs')
@Index('uniq_sms_opt_outs_tenant_phone', ['tenant_id', 'phone_e164'], { unique: true })
export class SmsOptOut {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'phone_e164', length: 20 })
  phone_e164!: string;

  @Column({ name: 'opted_out_at', type: 'timestamptz' })
  opted_out_at!: Date;

  @Column({ name: 'opted_out_via_message_id', type: 'uuid', nullable: true })
  opted_out_via_message_id!: string | null;

  @Column({ name: 'opted_in_at', type: 'timestamptz', nullable: true })
  opted_in_at!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
