import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'uuid' })
  tenant_id!: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  token_hash!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  // 'self-serve' or 'admin:<admin_user_id>' — audit trail for who initiated.
  @Column({ length: 32 })
  requested_by!: string;

  @Column({ length: 45, nullable: true })
  requested_ip!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;
}
