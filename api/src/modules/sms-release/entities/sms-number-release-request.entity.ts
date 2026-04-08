import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type SmsNumberReleaseStatus =
  | 'pending'
  | 'rejected'
  | 'released'
  | 'failed';

@Entity('sms_number_release_requests')
@Index('idx_sms_release_status_created', ['status', 'created_at'])
@Index('idx_sms_release_tenant_created', ['tenant_id', 'created_at'])
export class SmsNumberReleaseRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @Column({ name: 'sms_phone_number', length: 20 })
  sms_phone_number!: string;

  @Column({ length: 20, default: 'pending' })
  status!: SmsNumberReleaseStatus;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requested_by_user_id!: string;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'NOW()' })
  requested_at!: Date;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewed_by_user_id!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewed_at!: Date | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  review_notes!: string | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  released_at!: Date | null;

  @Column({ name: 'provider_phone_sid', length: 64, nullable: true })
  provider_phone_sid!: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failure_reason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
