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

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenant_id!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'password_hash', select: false })
  password_hash!: string;

  @Column({ name: 'first_name' })
  first_name!: string;

  @Column({ name: 'last_name' })
  last_name!: string;

  @Column({ nullable: true })
  phone!: string;

  @Column({ default: 'viewer' })
  role!: string;

  @Column({ name: 'is_active', default: true })
  is_active!: boolean;

  @Column({ name: 'is_billable', default: false })
  is_billable!: boolean;

  @Column({ name: 'billable_since', type: 'timestamptz', nullable: true })
  billable_since!: Date;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hire_date!: string;

  @Column({ name: 'pay_rate', type: 'decimal', precision: 8, scale: 2, nullable: true })
  pay_rate!: number;

  @Column({ name: 'pay_type', nullable: true, default: 'hourly' })
  pay_type!: string;

  @Column({ name: 'overtime_rate', type: 'decimal', precision: 8, scale: 2, nullable: true })
  overtime_rate!: number;

  @Column({ name: 'vehicle_info', type: 'jsonb', nullable: true })
  vehicle_info!: Record<string, string> | null;

  @Column({ name: 'emergency_contact', type: 'jsonb', nullable: true })
  emergency_contact!: Record<string, string> | null;

  @Column({ name: 'employee_status', nullable: true, default: 'active' })
  employee_status!: string;

  @Column({ name: 'driver_rates', type: 'jsonb', nullable: true, default: '{}' })
  driver_rates!: Record<string, unknown>;

  @Column({ name: 'permissions', type: 'jsonb', nullable: true, default: '{}' })
  permissions!: Record<string, unknown>;

  @Column({ name: 'additional_phones', type: 'jsonb', nullable: true, default: '[]' })
  additional_phones!: Array<{ label: string; number: string }>;

  @Column({ name: 'additional_emails', type: 'jsonb', nullable: true, default: '[]' })
  additional_emails!: Array<{ label: string; email: string }>;

  @Column({ name: 'sms_opt_in', default: false })
  sms_opt_in!: boolean;

  @Column({ name: 'address', type: 'jsonb', nullable: true })
  address!: Record<string, unknown> | null;

  @Column({ name: 'current_latitude', type: 'decimal', precision: 10, scale: 6, nullable: true })
  current_latitude!: number | null;

  @Column({ name: 'current_longitude', type: 'decimal', precision: 10, scale: 6, nullable: true })
  current_longitude!: number | null;

  @Column({ name: 'current_location_updated_at', type: 'timestamptz', nullable: true })
  current_location_updated_at!: Date | null;

  @Column({ name: 'current_status_text', nullable: true })
  current_status_text!: string | null;

  @Column({ name: 'is_clocked_in', default: false })
  is_clocked_in!: boolean;

  @Column({ name: 'clocked_in_at', type: 'timestamptz', nullable: true })
  clocked_in_at!: Date | null;

  @Column({ name: 'clocked_out_at', type: 'timestamptz', nullable: true })
  clocked_out_at!: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  last_login_at!: Date;

  @Column({ name: 'refresh_token_hash', nullable: true, select: false })
  refresh_token_hash!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
