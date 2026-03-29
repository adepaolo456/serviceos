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
import { Customer } from '../../customers/entities/customer.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'job_number' })
  job_number!: string;

  @Column({ name: 'customer_id' })
  customer_id!: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  asset_id!: string;

  @ManyToOne(() => Asset, { nullable: true })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;

  @Column({ name: 'assigned_driver_id', type: 'uuid', nullable: true })
  assigned_driver_id!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_driver_id' })
  assigned_driver!: User;

  @Column({ name: 'job_type' })
  job_type!: string;

  @Column({ name: 'service_type', nullable: true })
  service_type!: string;

  @Column({ default: 'normal' })
  priority!: string;

  @Column({ name: 'scheduled_date', type: 'date', nullable: true })
  scheduled_date!: string;

  @Column({ name: 'scheduled_window_start', type: 'time', nullable: true })
  scheduled_window_start!: string;

  @Column({ name: 'scheduled_window_end', type: 'time', nullable: true })
  scheduled_window_end!: string;

  @Column({ name: 'service_address', type: 'jsonb', nullable: true })
  service_address!: Record<string, any>;

  @Column({ name: 'placement_notes', type: 'text', nullable: true })
  placement_notes!: string;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatched_at!: Date;

  @Column({ name: 'en_route_at', type: 'timestamptz', nullable: true })
  en_route_at!: Date;

  @Column({ name: 'arrived_at', type: 'timestamptz', nullable: true })
  arrived_at!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completed_at!: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelled_at!: Date;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellation_reason!: string;

  @Column({ name: 'rental_start_date', type: 'date', nullable: true })
  rental_start_date!: string;

  @Column({ name: 'rental_end_date', type: 'date', nullable: true })
  rental_end_date!: string;

  @Column({ name: 'rental_days', type: 'int', nullable: true })
  rental_days!: number;

  @Column({
    name: 'base_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  base_price!: number;

  @Column({
    name: 'total_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  total_price!: number;

  @Column({
    name: 'deposit_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  deposit_amount!: number;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  photos!: Record<string, any>[];

  @Column({ name: 'signature_url', nullable: true })
  signature_url!: string;

  @Column({ name: 'driver_notes', type: 'text', nullable: true })
  driver_notes!: string;

  @Column({ nullable: true })
  source!: string;

  @Column({ name: 'marketplace_booking_id', nullable: true })
  marketplace_booking_id!: string;

  @Column({ name: 'route_order', type: 'int', nullable: true })
  route_order!: number;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
