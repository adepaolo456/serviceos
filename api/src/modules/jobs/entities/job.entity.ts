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

  @Column({ name: 'asset_subtype', nullable: true })
  asset_subtype!: string;

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

  @Column({ name: 'extra_days', type: 'int', default: 0 })
  extra_days!: number;

  @Column({ name: 'extra_day_rate', type: 'decimal', precision: 10, scale: 2, nullable: true })
  extra_day_rate!: number;

  @Column({ name: 'extra_day_charges', type: 'decimal', precision: 10, scale: 2, default: 0 })
  extra_day_charges!: number;

  @Column({ name: 'extra_day_last_calculated_at', type: 'timestamptz', nullable: true })
  extra_day_last_calculated_at!: Date;

  @Column({ name: 'is_overdue', default: false })
  is_overdue!: boolean;

  @Column({ name: 'overdue_notified_at', type: 'timestamptz', nullable: true })
  overdue_notified_at!: Date;

  @Column({ name: 'overdue_notification_count', type: 'int', default: 0 })
  overdue_notification_count!: number;

  @Column({ name: 'discount_percentage', type: 'decimal', precision: 5, scale: 2, nullable: true })
  discount_percentage!: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  discount_amount!: number;

  @Column({ name: 'dump_disposition', default: 'pending' })
  dump_disposition!: string;

  @Column({ name: 'is_failed_trip', default: false })
  is_failed_trip!: boolean;

  @Column({ name: 'failed_reason', type: 'text', nullable: true })
  failed_reason!: string;

  @Column({ name: 'failed_reason_code', nullable: true })
  failed_reason_code!: string;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failed_at!: Date | null;

  @Column({ name: 'attempt_count', type: 'int', default: 1 })
  attempt_count!: number;

  @Column({ name: 'drop_off_asset_id', type: 'uuid', nullable: true })
  drop_off_asset_id!: string;

  @Column({ name: 'drop_off_asset_pin', nullable: true })
  drop_off_asset_pin!: string;

  @Column({ name: 'pick_up_asset_id', type: 'uuid', nullable: true })
  pick_up_asset_id!: string;

  @Column({ name: 'pick_up_asset_pin', nullable: true })
  pick_up_asset_pin!: string;

  @Column({ name: 'parent_job_id', type: 'uuid', nullable: true })
  parent_job_id!: string;

  @Column({ name: 'linked_job_ids', type: 'jsonb', default: '[]' })
  linked_job_ids!: string[];

  @Column({ name: 'dump_location_id', type: 'uuid', nullable: true })
  dump_location_id!: string;

  @Column({ name: 'dump_location_name', nullable: true })
  dump_location_name!: string;

  @Column({ name: 'dump_ticket_number', nullable: true })
  dump_ticket_number!: string;

  @Column({ name: 'dump_ticket_photo', type: 'text', nullable: true })
  dump_ticket_photo!: string;

  @Column({ name: 'dump_weight_tons', type: 'decimal', precision: 8, scale: 2, nullable: true })
  dump_weight_tons!: number;

  @Column({ name: 'dump_waste_type', nullable: true })
  dump_waste_type!: string;

  @Column({ name: 'dump_base_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dump_base_cost!: number;

  @Column({ name: 'dump_overage_items', type: 'jsonb', default: '[]' })
  dump_overage_items!: Array<{ type: string; label: string; quantity: number; chargePerUnit: number; total: number }>;

  @Column({ name: 'dump_overage_charges', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dump_overage_charges!: number;

  @Column({ name: 'dump_total_cost', type: 'decimal', precision: 10, scale: 2, default: 0 })
  dump_total_cost!: number;

  @Column({ name: 'customer_additional_charges', type: 'decimal', precision: 10, scale: 2, default: 0 })
  customer_additional_charges!: number;

  @Column({ name: 'dump_submitted_at', type: 'timestamptz', nullable: true })
  dump_submitted_at!: Date;

  @Column({ name: 'dump_submitted_by', type: 'uuid', nullable: true })
  dump_submitted_by!: string;

  @Column({ name: 'dump_status', default: 'none' })
  dump_status!: string;

  @Column({ name: 'rescheduled_by_customer', default: false })
  rescheduled_by_customer!: boolean;

  @Column({ name: 'rescheduled_at', type: 'timestamptz', nullable: true })
  rescheduled_at!: Date;

  @Column({ name: 'rescheduled_from_date', type: 'date', nullable: true })
  rescheduled_from_date!: string;

  @Column({ name: 'rescheduled_reason', nullable: true })
  rescheduled_reason!: string;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  photos!: Record<string, any>[];

  @Column({ name: 'signature_url', nullable: true })
  signature_url!: string;

  @Column({ name: 'driver_notes', type: 'text', nullable: true })
  driver_notes!: string;

  // Phase 11A — asset enforcement + audit trail.
  // Each entry is appended whenever an asset is assigned, corrected,
  // or overridden (active-conflict override). Stored directly on the
  // job so the job detail view can show a full asset history without
  // an extra query. Canonical asset state lives on the Asset entity
  // via `operational_history`; this is the job-side mirror.
  @Column({
    name: 'asset_change_history',
    type: 'jsonb',
    nullable: false,
    default: () => `'[]'::jsonb`,
  })
  asset_change_history!: Array<{
    previous_asset_id: string | null;
    new_asset_id: string;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_at: string;
    reason: string | null;
    override_conflict?: boolean;
  }>;

  @Column({ nullable: true })
  source!: string;

  @Column({ name: 'marketplace_booking_id', nullable: true })
  marketplace_booking_id!: string;

  @Column({ name: 'route_order', type: 'int', nullable: true })
  route_order!: number;

  // ── Placement pin (Phase 20) ──

  @Column({ name: 'placement_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  placement_lat!: number | null;

  @Column({ name: 'placement_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  placement_lng!: number | null;

  @Column({ name: 'placement_pin_notes', type: 'text', nullable: true })
  placement_pin_notes!: string | null;

  // ── Pricing lock fields (pricing engine v2) ──

  @Column({ name: 'pricing_snapshot', type: 'jsonb', nullable: true })
  pricing_snapshot!: Record<string, unknown> | null;

  @Column({ name: 'pricing_locked_at', type: 'timestamptz', nullable: true })
  pricing_locked_at!: Date | null;

  @Column({ name: 'pricing_config_version_id', type: 'uuid', nullable: true })
  pricing_config_version_id!: string | null;

  @Column({ name: 'pricing_snapshot_id', type: 'uuid', nullable: true })
  pricing_snapshot_id!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
