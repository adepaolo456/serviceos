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
import { Job } from '../../jobs/entities/job.entity';

@Entity('marketplace_bookings')
export class MarketplaceBooking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'marketplace_booking_id' })
  marketplace_booking_id!: string;

  @Column({ name: 'listing_type' })
  listing_type!: string;

  @Column({ name: 'asset_subtype', nullable: true })
  asset_subtype!: string;

  @Column({ name: 'customer_name' })
  customer_name!: string;

  @Column({ name: 'customer_email' })
  customer_email!: string;

  @Column({ name: 'customer_phone', nullable: true })
  customer_phone!: string;

  @Column({ name: 'service_address', type: 'jsonb', nullable: true })
  service_address!: Record<string, any>;

  @Column({ name: 'requested_date', type: 'date' })
  requested_date!: string;

  @Column({ name: 'rental_days', type: 'int', default: 7 })
  rental_days!: number;

  @Column({ name: 'special_instructions', type: 'text', nullable: true })
  special_instructions!: string;

  @Column({
    name: 'quoted_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  quoted_price!: number;

  @Column({
    name: 'marketplace_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  marketplace_fee!: number;

  @Column({
    name: 'net_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  net_price!: number;

  @Column({ default: 'pending' })
  status!: string;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  job_id!: string;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn({ name: 'job_id' })
  job!: Job;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejection_reason!: string;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processed_at!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
