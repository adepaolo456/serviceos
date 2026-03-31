import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('dump_locations')
export class DumpLocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column({ nullable: true })
  city!: string;

  @Column({ nullable: true })
  state!: string;

  @Column({ nullable: true })
  zip!: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  latitude!: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  longitude!: number;

  @Column({ nullable: true })
  phone!: string;

  @Column({ name: 'contact_name', nullable: true })
  contact_name!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string;

  @Column({ name: 'operating_hours', nullable: true })
  operating_hours!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'fuel_env_surcharge_per_ton', type: 'decimal', precision: 10, scale: 2, default: 0 })
  fuel_env_surcharge_per_ton!: number;

  @OneToMany(() => DumpLocationRate, r => r.dump_location, { cascade: true })
  rates!: DumpLocationRate[];

  @OneToMany(() => DumpLocationSurcharge, s => s.dump_location, { cascade: true })
  surcharges!: DumpLocationSurcharge[];

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}

@Entity('dump_location_rates')
export class DumpLocationRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dump_location_id' })
  dump_location_id!: string;

  @ManyToOne(() => DumpLocation, d => d.rates)
  @JoinColumn({ name: 'dump_location_id' })
  dump_location!: DumpLocation;

  @Column({ name: 'waste_type' })
  waste_type!: string;

  @Column({ name: 'waste_type_label' })
  waste_type_label!: string;

  @Column({ name: 'rate_per_ton', type: 'decimal', precision: 10, scale: 2 })
  rate_per_ton!: number;

  @Column({ name: 'minimum_charge', type: 'decimal', precision: 10, scale: 2, nullable: true })
  minimum_charge!: number;

  @Column({ name: 'rate_type', default: 'per_ton' })
  rate_type!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;
}

@Entity('dump_location_surcharges')
export class DumpLocationSurcharge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dump_location_id' })
  dump_location_id!: string;

  @ManyToOne(() => DumpLocation, d => d.surcharges)
  @JoinColumn({ name: 'dump_location_id' })
  dump_location!: DumpLocation;

  @Column({ name: 'item_type' })
  item_type!: string;

  @Column()
  label!: string;

  @Column({ name: 'dump_charge', type: 'decimal', precision: 10, scale: 2 })
  dump_charge!: number;

  @Column({ name: 'customer_charge', type: 'decimal', precision: 10, scale: 2 })
  customer_charge!: number;

  @Column({ name: 'charge_type', default: 'flat' })
  charge_type!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sort_order!: number;
}
