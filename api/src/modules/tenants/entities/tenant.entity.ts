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

  @Column({ name: 'business_type', nullable: true })
  business_type!: string;

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

  @Column({ name: 'subscription_tier', nullable: true, default: 'trial' })
  subscription_tier!: string;

  @Column({ name: 'subscription_status', nullable: true, default: 'trialing' })
  subscription_status!: string;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trial_ends_at!: Date;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
