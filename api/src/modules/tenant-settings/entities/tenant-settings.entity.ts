import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_settings')
export class TenantSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', unique: true })
  tenant_id!: string;

  @Column({ name: 'default_rental_period_days', type: 'int', default: 14 })
  default_rental_period_days!: number;

  @Column({ name: 'failed_trip_fee', type: 'decimal', precision: 10, scale: 2, default: 75.0 })
  failed_trip_fee!: number;

  @Column({ name: 'time_change_cutoff_hours', type: 'int', default: 24 })
  time_change_cutoff_hours!: number;

  @Column({ name: 'brand_color', length: 7, default: '#22C55E' })
  brand_color!: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logo_url!: string | null;

  @Column({ name: 'support_email', length: 255, nullable: true })
  support_email!: string | null;

  @Column({ name: 'support_phone', length: 20, nullable: true })
  support_phone!: string | null;

  @Column({ name: 'portal_slug', length: 100, nullable: true })
  portal_slug!: string | null;

  @Column({ name: 'portal_name', length: 255, nullable: true })
  portal_name!: string | null;

  @Column({ name: 'email_sender_name', length: 255, nullable: true })
  email_sender_name!: string | null;

  @Column({ name: 'sms_enabled', default: false })
  sms_enabled!: boolean;

  @Column({ name: 'email_enabled', default: false })
  email_enabled!: boolean;

  @Column({ name: 'driver_hourly_rate', type: 'decimal', precision: 8, scale: 2, nullable: true })
  driver_hourly_rate!: number | null;

  @Column({ name: 'helper_hourly_rate', type: 'decimal', precision: 8, scale: 2, nullable: true })
  helper_hourly_rate!: number | null;

  @Column({ name: 'onboarding_completed_at', type: 'timestamptz', nullable: true })
  onboarding_completed_at!: Date | null;

  // Quote & Follow-Up settings
  @Column({ name: 'quote_expiration_days', type: 'int', default: 30 })
  quote_expiration_days!: number;

  @Column({ name: 'hot_quote_view_threshold', type: 'int', default: 2 })
  hot_quote_view_threshold!: number;

  @Column({ name: 'follow_up_recency_minutes', type: 'int', default: 120 })
  follow_up_recency_minutes!: number;

  @Column({ name: 'expiring_soon_hours', type: 'int', default: 48 })
  expiring_soon_hours!: number;

  @Column({ name: 'quotes_email_enabled', default: true })
  quotes_email_enabled!: boolean;

  @Column({ name: 'quotes_sms_enabled', default: false })
  quotes_sms_enabled!: boolean;

  @Column({ name: 'default_quote_delivery_method', length: 10, default: 'email' })
  default_quote_delivery_method!: string;

  @Column({ name: 'quote_templates', type: 'jsonb', nullable: true })
  quote_templates!: Record<string, string> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
