import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Append-only audit log for user lifecycle events. Matches the
// credit_audit_events convention: no FK constraints on actor_id / target_id
// so the audit trail survives soft-deletion of either party.
export type UserAuditAction =
  | 'deactivated'
  | 'reactivated'
  | 'deleted'
  | 'role_changed'
  | 'owner_transferred';

@Entity('user_audit_log')
export class UserAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actor_id!: string | null;

  @Column({ name: 'target_id', type: 'uuid' })
  target_id!: string;

  @Column({ type: 'text' })
  action!: UserAuditAction;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
