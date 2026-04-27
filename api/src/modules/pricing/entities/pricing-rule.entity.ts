import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('pricing_rules')
export class PricingRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column()
  name!: string;

  @Column({ name: 'service_type' })
  service_type!: string;

  @Column({ name: 'asset_subtype', nullable: true })
  asset_subtype!: string;

  @Column({ name: 'customer_type', nullable: true })
  customer_type!: string;

  @Column({
    name: 'base_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  base_price!: number;

  @Column({ name: 'rental_period_days', type: 'int', default: 7 })
  rental_period_days!: number;

  @Column({
    name: 'extra_day_rate',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  extra_day_rate!: number;

  @Column({
    name: 'included_miles',
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  included_miles!: number;

  @Column({
    name: 'per_mile_charge',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  per_mile_charge!: number;

  @Column({
    name: 'max_service_miles',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  max_service_miles!: number;

  @Column({
    name: 'included_tons',
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  included_tons!: number;

  @Column({
    name: 'overage_per_ton',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  overage_per_ton!: number;

  @Column({
    name: 'delivery_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  delivery_fee!: number;

  @Column({
    name: 'pickup_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  pickup_fee!: number;

  @Column({
    name: 'exchange_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  exchange_fee!: number;

  @Column({ name: 'require_deposit', default: false })
  require_deposit!: boolean;

  @Column({
    name: 'deposit_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  deposit_amount!: number;

  @Column({
    name: 'tax_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  tax_rate!: number;

  @Column({ name: 'failed_trip_base_fee', type: 'decimal', precision: 10, scale: 2, default: 150 })
  failed_trip_base_fee!: number;

  @Column({ name: 'min_rental_days', type: 'int', default: 1 })
  min_rental_days!: number;

  @Column({ name: 'max_rental_days', type: 'int', nullable: true })
  max_rental_days!: number;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'effective_date', type: 'date', nullable: true })
  effective_date!: string;

  @Column({ name: 'effective_until', type: 'date', nullable: true })
  effective_until!: string;

  // ── Config versioning (Step 2) ──

  @Column({ name: 'version_id', type: 'uuid', nullable: true, default: () => 'gen_random_uuid()' })
  version_id!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  published_at!: Date | null;

  @Column({ name: 'superseded_by', type: 'uuid', nullable: true })
  superseded_by!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by!: string | null;

  // ── Commercial vs residential rental policies (Step 6) ──

  @Column({ name: 'residential_included_days', type: 'int', nullable: true, default: 14 })
  residential_included_days!: number | null;

  @Column({ name: 'commercial_included_days', type: 'int', nullable: true, default: 14 })
  commercial_included_days!: number | null;

  @Column({ name: 'residential_extra_day_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  residential_extra_day_rate!: number | null;

  @Column({ name: 'commercial_extra_day_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  commercial_extra_day_rate!: number | null;

  @Column({ name: 'commercial_unlimited_days', default: false })
  commercial_unlimited_days!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
