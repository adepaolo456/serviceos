import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @Column({ name: 'quote_number', unique: true })
  quote_number!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customer_id!: string | null;

  @Column({ name: 'customer_name', nullable: true })
  customer_name!: string;

  @Column({ name: 'customer_email', nullable: true })
  customer_email!: string;

  @Column({ name: 'customer_phone', nullable: true })
  customer_phone!: string;

  @Column({ name: 'delivery_address', type: 'jsonb', nullable: true })
  delivery_address!: Record<string, any> | null;

  @Column({ name: 'asset_subtype' })
  asset_subtype!: string;

  @Column({ name: 'base_price', type: 'decimal', precision: 10, scale: 2, default: 0 })
  base_price!: number;

  @Column({ name: 'included_tons', type: 'decimal', precision: 6, scale: 2, default: 0 })
  included_tons!: number;

  @Column({ name: 'rental_days', type: 'int', default: 14 })
  rental_days!: number;

  @Column({ name: 'overage_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
  overage_rate!: number;

  @Column({ name: 'extra_day_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
  extra_day_rate!: number;

  @Column({ name: 'distance_surcharge', type: 'decimal', precision: 10, scale: 2, default: 0 })
  distance_surcharge!: number;

  @Column({ name: 'total_quoted', type: 'decimal', precision: 10, scale: 2, default: 0 })
  total_quoted!: number;

  @Column({ default: 'draft' })
  status!: string;

  @Column({ nullable: true, unique: true })
  token!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expires_at!: Date;

  @Column({ name: 'booked_job_id', type: 'uuid', nullable: true })
  booked_job_id!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by!: string | null;

  @Column({ name: 'first_viewed_at', type: 'timestamptz', nullable: true })
  first_viewed_at!: Date | null;

  @Column({ name: 'last_viewed_at', type: 'timestamptz', nullable: true })
  last_viewed_at!: Date | null;

  @Column({ name: 'view_count', type: 'int', default: 0 })
  view_count!: number;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
