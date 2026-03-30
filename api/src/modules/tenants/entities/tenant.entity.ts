import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ name: 'business_type', default: 'waste' })
  business_type!: string;

  @Column({ name: 'business_type_label', nullable: true })
  business_type_label!: string;

  @Column({ name: 'enabled_modules', type: 'jsonb', default: '[]' })
  enabled_modules!: string[];

  @Column({ type: 'jsonb', nullable: true })
  address!: Record<string, any>;

  @Column({ name: 'service_radius_miles', type: 'int', nullable: true })
  service_radius_miles!: number;

  @Column({ type: 'jsonb', nullable: true, default: '{}' })
  settings!: Record<string, any>;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripe_customer_id!: string;

  @Column({ name: 'stripe_connect_id', nullable: true })
  stripe_connect_id!: string;

  @Column({ name: 'stripe_onboarded', default: false })
  stripe_onboarded!: boolean;

  @Column({ name: 'subscription_tier', nullable: true, default: 'trial' })
  subscription_tier!: string;

  @Column({ name: 'subscription_status', nullable: true, default: 'trialing' })
  subscription_status!: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trial_ends_at!: Date;

  @Column({ name: 'website_enabled', default: false })
  website_enabled!: boolean;

  @Column({ name: 'website_headline', nullable: true })
  website_headline!: string;

  @Column({ name: 'website_description', type: 'text', nullable: true })
  website_description!: string;

  @Column({ name: 'website_hero_image_url', nullable: true })
  website_hero_image_url!: string;

  @Column({ name: 'website_logo_url', nullable: true })
  website_logo_url!: string;

  @Column({ name: 'website_primary_color', default: '#2ECC71' })
  website_primary_color!: string;

  @Column({ name: 'website_phone', nullable: true })
  website_phone!: string;

  @Column({ name: 'website_email', nullable: true })
  website_email!: string;

  @Column({ name: 'website_service_area', type: 'text', nullable: true })
  website_service_area!: string;

  @Column({ name: 'website_about', type: 'text', nullable: true })
  website_about!: string;

  @Column({ name: 'widget_enabled', default: false })
  widget_enabled!: boolean;

  @Column({ name: 'allowed_widget_domains', type: 'text', array: true, nullable: true })
  allowed_widget_domains!: string[];

  @Column({ name: 'stripe_subscription_id', nullable: true })
  stripe_subscription_id!: string;

  @Column({ name: 'subscription_started_at', type: 'timestamptz', nullable: true })
  subscription_started_at!: Date;

  @Column({ name: 'subscription_ends_at', type: 'timestamptz', nullable: true })
  subscription_ends_at!: Date;

  @Column({ name: 'billable_driver_count', type: 'int', default: 0 })
  billable_driver_count!: number;

  @Column({ name: 'peak_driver_count', type: 'int', default: 0 })
  peak_driver_count!: number;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
