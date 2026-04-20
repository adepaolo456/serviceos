import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('rate_limit_log')
export class RateLimitLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ip_address', length: 45 })
  ip_address!: string;

  @Column({ length: 100 })
  endpoint!: string;

  // Phase 1 forgot-password sprint — generalized key for non-IP throttling
  // (email-keyed limits on /auth/forgot-password). Default 'ip' backfills
  // legacy rows so existing callers keep working unchanged.
  @Column({ length: 16, default: 'ip' })
  key_type!: string;

  // 320 = RFC 5321 max email length. Values for key_type='ip' mirror
  // ip_address; lookups use (endpoint, key_type, key_value).
  @Column({ length: 320 })
  key_value!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
