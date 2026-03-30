import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'stripe_product_id', nullable: true })
  stripe_product_id!: string;

  @Column({ name: 'stripe_price_id_monthly', nullable: true })
  stripe_price_id_monthly!: string;

  @Column({ name: 'stripe_price_id_annual', nullable: true })
  stripe_price_id_annual!: string;

  @Column()
  tier!: string;

  @Column({ name: 'price_per_driver_monthly', type: 'decimal', precision: 10, scale: 2 })
  price_per_driver_monthly!: number;

  @Column({ name: 'price_per_driver_annual', type: 'decimal', precision: 10, scale: 2 })
  price_per_driver_annual!: number;

  @Column({ type: 'jsonb', default: '[]' })
  features!: string[];

  @Column({ name: 'enabled_modules', type: 'jsonb', default: '[]' })
  enabled_modules!: string[];

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
